/**
 * Nightly vendor buylist → database sync.
 *
 * For each vendor adapter: stream listing pages, match each listing to a
 * catalog product (same CatalogIndex the analyzer uses), upsert into
 * buylist_prices, then drop rows the vendor no longer lists. Audited via
 * buylist_sync_runs per vendor — one vendor failing doesn't kill the others.
 *
 * Usage:  npx tsx scripts/sync-buylists.ts [vendor ...]
 *   e.g.  npx tsx scripts/sync-buylists.ts card_cavern
 */
import "dotenv/config";
import dns from "node:dns";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as tables from "../src/db/schema";
import { loadCatalogIndex } from "../src/lib/analyzer/match";
import type { VendorAdapter } from "../src/lib/buylists/types";
import { cardCavernAdapter } from "../src/lib/buylists/card-cavern";
import { coolstuffAdapter } from "../src/lib/buylists/coolstuff";
import { fullGripAdapter } from "../src/lib/buylists/full-grip";

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

const ADAPTERS: VendorAdapter[] = [
  cardCavernAdapter,
  coolstuffAdapter,
  fullGripAdapter,
];
const BATCH_SIZE = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function syncVendor(
  adapter: VendorAdapter,
  index: Awaited<ReturnType<typeof loadCatalogIndex>>,
): Promise<void> {
  const [run] = await db
    .insert(tables.buylistSyncRuns)
    .values({ vendor: adapter.vendor, status: "running" })
    .returning();
  let seen = 0;
  let matched = 0;
  const seenKeys: string[] = [];

  try {
    for await (const page of adapter.fetchListings()) {
      const rows = page.map((listing) => {
        const match = index.match({
          name: listing.name,
          setName: listing.setName,
          cardNumber: listing.cardNumber,
        });
        if (match) matched++;
        seenKeys.push(listing.vendorKey);
        return {
          vendor: adapter.vendor,
          vendorKey: listing.vendorKey,
          productId: match?.entry.id ?? null,
          listingTitle: listing.title,
          setName: listing.setName,
          cardNumber: listing.cardNumber,
          printing: listing.printing,
          cashPrice: listing.cashPrice?.toFixed(2) ?? null,
          creditPrice: listing.creditPrice?.toFixed(2) ?? null,
          conditionPrices: listing.conditionPrices,
          buying: listing.buying,
          vendorUrl: listing.url,
          syncedAt: new Date(),
        };
      });
      seen += rows.length;

      for (const batch of chunk(rows, BATCH_SIZE)) {
        await db
          .insert(tables.buylistPrices)
          .values(batch)
          .onConflictDoUpdate({
            target: [tables.buylistPrices.vendor, tables.buylistPrices.vendorKey],
            set: {
              productId: sql`excluded.product_id`,
              listingTitle: sql`excluded.listing_title`,
              setName: sql`excluded.set_name`,
              cardNumber: sql`excluded.card_number`,
              printing: sql`excluded.printing`,
              cashPrice: sql`excluded.cash_price`,
              creditPrice: sql`excluded.credit_price`,
              conditionPrices: sql`excluded.condition_prices`,
              buying: sql`excluded.buying`,
              vendorUrl: sql`excluded.vendor_url`,
              syncedAt: sql`excluded.synced_at`,
            },
          });
      }
      if (seen % 2500 < page.length) {
        console.log(`[${adapter.vendor}] ${seen} listings (${matched} matched)`);
      }
    }

    // Listings that vanished from the vendor's buylist are no longer wanted:
    // every row touched this run carries a fresh synced_at, so sweep the rest.
    // Guard: a crawl that yields nothing is a failure, not "vendor buys nothing".
    if (seenKeys.length === 0) {
      throw new Error("crawl returned zero listings");
    }
    await db
      .delete(tables.buylistPrices)
      .where(
        and(
          eq(tables.buylistPrices.vendor, adapter.vendor),
          sql`${tables.buylistPrices.syncedAt} < (
            SELECT max(${tables.buylistPrices.syncedAt})
            FROM ${tables.buylistPrices}
            WHERE ${tables.buylistPrices.vendor} = ${adapter.vendor}
          ) - interval '6 hours'`,
        ),
      );

    await db
      .update(tables.buylistSyncRuns)
      .set({
        status: "success",
        finishedAt: new Date(),
        listingsSeen: seen,
        listingsMatched: matched,
      })
      .where(eq(tables.buylistSyncRuns.id, run.id));
    console.log(
      `[${adapter.vendor}] done: ${seen} listings, ${matched} matched (${((matched / Math.max(1, seen)) * 100).toFixed(1)}%)`,
    );
  } catch (err) {
    await db
      .update(tables.buylistSyncRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        listingsSeen: seen,
        listingsMatched: matched,
        error: err instanceof Error ? err.message : String(err),
      })
      .where(eq(tables.buylistSyncRuns.id, run.id));
    console.error(`[${adapter.vendor}] FAILED:`, err);
    process.exitCode = 1;
  }
}

async function main() {
  const requested = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const adapters = requested.length
    ? ADAPTERS.filter((a) => requested.includes(a.vendor))
    : ADAPTERS;
  if (adapters.length === 0) {
    console.error(
      `Unknown vendor(s): ${requested.join(", ")}. Known: ${ADAPTERS.map((a) => a.vendor).join(", ")}`,
    );
    process.exit(1);
  }

  console.log("Loading catalog index…");
  const index = await loadCatalogIndex(db);
  console.log(`Catalog index: ${index.size.toLocaleString()} singles`);

  for (const adapter of adapters) {
    await syncVendor(adapter, index);
  }
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
