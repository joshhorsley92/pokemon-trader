/**
 * Daily TCGCSV → database sync.
 *
 * - Upserts all Pokémon groups (sets) and products
 * - Skips a group's products fetch when its modifiedOn is unchanged (delta)
 * - Always refreshes prices
 * - Records a sealed-only daily price snapshot, pruned to 90 days
 * - Audited via the sync_runs table
 *
 * Idempotent: the initial backfill is just the first run.
 *
 * Usage:  npx tsx scripts/sync-tcgcsv.ts [--full]
 *   --full  ignore modifiedOn deltas and re-upsert every group's products
 */
import "dotenv/config";
import dns from "node:dns";
import { sql, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as tables from "../src/db/schema";
import {
  classifyProduct,
  effectiveMarketPrice,
  fetchGroups,
  fetchPrices,
  fetchProducts,
  mapWithConcurrency,
  pickPrice,
  serializePrintings,
} from "../src/lib/tcgcsv";

// Avoid fetch failures on Windows networks where unroutable IPv6 wins the
// default DNS ordering.
dns.setDefaultResultOrder("ipv4first");

const connectionString =
  process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DIRECT_DATABASE_URL or DATABASE_URL must be set");
  process.exit(1);
}
const client = postgres(connectionString, { prepare: false, max: 5 });
const db = drizzle(client, { schema: tables });

const FULL = process.argv.includes("--full");
const CONCURRENCY = 5;
const BATCH_SIZE = 500;
const SNAPSHOT_RETENTION_DAYS = 90;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const [run] = await db
    .insert(tables.syncRuns)
    .values({ status: "running" })
    .returning();
  let groupsProcessed = 0;
  let productsUpserted = 0;

  try {
    const groups = await fetchGroups();
    console.log(`Fetched ${groups.length} groups`);

    const existing = await db
      .select({
        id: tables.catalogGroups.id,
        modifiedOn: tables.catalogGroups.modifiedOn,
      })
      .from(tables.catalogGroups);
    const existingModified = new Map(existing.map((g) => [g.id, g.modifiedOn]));

    for (const batch of chunk(groups, BATCH_SIZE)) {
      await db
        .insert(tables.catalogGroups)
        .values(
          batch.map((g) => ({
            id: g.groupId,
            name: g.name,
            abbreviation: g.abbreviation,
            publishedOn: g.publishedOn?.slice(0, 10) ?? null,
            modifiedOn: g.modifiedOn,
            syncedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: tables.catalogGroups.id,
          set: {
            name: sql`excluded.name`,
            abbreviation: sql`excluded.abbreviation`,
            publishedOn: sql`excluded.published_on`,
            modifiedOn: sql`excluded.modified_on`,
            syncedAt: sql`excluded.synced_at`,
          },
        });
    }

    await mapWithConcurrency(groups, CONCURRENCY, async (group) => {
      const unchanged =
        !FULL && existingModified.get(group.groupId) === group.modifiedOn;

      if (!unchanged) {
        const products = await fetchProducts(group.groupId);
        for (const batch of chunk(products, BATCH_SIZE)) {
          await db
            .insert(tables.catalogProducts)
            .values(
              batch.map((p) => ({
                id: p.productId,
                groupId: p.groupId,
                name: p.name,
                cleanName: p.cleanName,
                category: classifyProduct(p),
                imageUrl: p.imageUrl,
                tcgplayerUrl: p.url,
                extData: p.extendedData ?? [],
              })),
            )
            .onConflictDoUpdate({
              target: tables.catalogProducts.id,
              set: {
                name: sql`excluded.name`,
                cleanName: sql`excluded.clean_name`,
                category: sql`excluded.category`,
                imageUrl: sql`excluded.image_url`,
                tcgplayerUrl: sql`excluded.tcgplayer_url`,
                extData: sql`excluded.ext_data`,
                // category_override is intentionally untouched
              },
            });
          productsUpserted += batch.length;
        }
      }

      const prices = await fetchPrices(group.groupId);
      const byProduct = new Map<number, typeof prices>();
      for (const row of prices) {
        const list = byProduct.get(row.productId) ?? [];
        list.push(row);
        byProduct.set(row.productId, list);
      }
      const priceRows: {
        id: number;
        market: number | null;
        low: number | null;
        printings: ReturnType<typeof serializePrintings>;
      }[] = [];
      for (const [productId, rows] of byProduct) {
        const picked = pickPrice(rows);
        if (!picked) continue;
        priceRows.push({
          id: productId,
          market: effectiveMarketPrice(picked),
          low: picked.lowPrice,
          printings: serializePrintings(rows),
        });
      }
      for (const batch of chunk(priceRows, BATCH_SIZE)) {
        // Parameterized bulk update (market/low/printings). Products feed may
        // lag prices feed, so only update rows that already exist.
        const tuples = batch.map(
          (r) =>
            sql`(${r.id}::int, ${r.market}::numeric, ${r.low}::numeric, ${JSON.stringify(r.printings)}::jsonb)`,
        );
        await db.execute(sql`
          UPDATE catalog_products AS cp
          SET market_price = v.market_price,
              low_price = v.low_price,
              printings = v.printings,
              price_updated_at = now()
          FROM (VALUES ${sql.join(tuples, sql`,`)}) AS v(id, market_price, low_price, printings)
          WHERE cp.id = v.id
        `);
      }

      groupsProcessed++;
      if (groupsProcessed % 25 === 0) {
        console.log(`Processed ${groupsProcessed}/${groups.length} groups`);
      }
    });

    // Sealed-only daily snapshot + prune
    await db.execute(sql`
      INSERT INTO price_snapshots (product_id, snapshot_date, market_price)
      SELECT id, CURRENT_DATE, market_price
      FROM catalog_products
      WHERE COALESCE(category_override, category) = 'sealed'
        AND market_price IS NOT NULL
      ON CONFLICT (product_id, snapshot_date)
      DO UPDATE SET market_price = excluded.market_price
    `);
    await db.execute(
      sql`DELETE FROM price_snapshots WHERE snapshot_date < CURRENT_DATE - ${SNAPSHOT_RETENTION_DAYS}::int`,
    );

    await db
      .update(tables.syncRuns)
      .set({
        status: "success",
        finishedAt: new Date(),
        groupsProcessed,
        productsUpserted,
      })
      .where(eq(tables.syncRuns.id, run.id));
    console.log(
      `Sync complete: ${groupsProcessed} groups, ${productsUpserted} products upserted`,
    );
  } catch (err) {
    await db
      .update(tables.syncRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        groupsProcessed,
        productsUpserted,
        error: err instanceof Error ? err.message : String(err),
      })
      .where(eq(tables.syncRuns.id, run.id));
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
