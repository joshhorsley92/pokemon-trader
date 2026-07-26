/**
 * Refresh real per-condition prices (JustTCG) for the cards that matter.
 *
 * The upstream plans are metered (free/evaluation tier: 1,000 calls/month,
 * 100/day, 20 cards per call), so this deliberately does NOT walk the whole
 * 149k-product catalog. It refreshes a working set, most valuable first:
 *
 *   1. everything currently in inventory
 *   2. products seen on recent trade-ins / submissions
 *   3. products vendors are actively buying (analyzer decisions hinge on them)
 *
 * Usage:
 *   npx tsx scripts/sync-condition-prices.ts [--limit N] [--stale-days N] [--dry]
 *     --limit       max products to refresh this run (default 200)
 *     --stale-days  skip products refreshed more recently than this (default 7)
 *     --dry         show what would be fetched, spend no API calls
 */
import "dotenv/config";
import dns from "node:dns";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as tables from "../src/db/schema";

dns.setDefaultResultOrder("ipv4first");

const connectionString =
  process.env.DIRECT_DATABASE_URL ??
  process.env.NETLIFY_DATABASE_URL_UNPOOLED ??
  process.env.DATABASE_URL ??
  process.env.NETLIFY_DATABASE_URL;
if (!connectionString) {
  console.error("DIRECT_DATABASE_URL or DATABASE_URL must be set");
  process.exit(1);
}

function flag(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}
const LIMIT = flag("limit", 200);
const STALE_DAYS = flag("stale-days", 7);
const DRY = process.argv.includes("--dry");

const client = postgres(connectionString, { prepare: false, max: 5 });
const db = drizzle(client, { schema: tables });

async function main() {
  if (!process.env.JUSTTCG_API_KEY && !DRY) {
    console.error("JUSTTCG_API_KEY not set — nothing to do.");
    process.exit(1);
  }

  // Working set, priority-ordered, excluding anything refreshed recently.
  const rows = await db.execute(sql`
    WITH candidates AS (
      SELECT DISTINCT i.product_id AS id, 1 AS priority
        FROM inventory_items i
       WHERE i.product_id IS NOT NULL AND i.quantity > 0
      UNION
      SELECT DISTINCT s.product_id, 2
        FROM submission_trade_in_items s
       WHERE s.product_id IS NOT NULL
      UNION
      SELECT DISTINCT b.product_id, 3
        FROM buylist_prices b
       WHERE b.product_id IS NOT NULL AND b.buying = true
    )
    SELECT c.id, min(c.priority) AS priority
      FROM candidates c
      LEFT JOIN (
        SELECT product_id, max(fetched_at) AS fetched_at
          FROM card_condition_prices GROUP BY product_id
      ) f ON f.product_id = c.id
     WHERE f.fetched_at IS NULL
        OR f.fetched_at < now() - (${STALE_DAYS}::int * interval '1 day')
     GROUP BY c.id
     ORDER BY min(c.priority), c.id
     LIMIT ${LIMIT}
  `);

  const ids = (rows as unknown as { id: number }[]).map((r) => Number(r.id));
  console.log(
    `${ids.length} product(s) need condition prices (limit ${LIMIT}, stale after ${STALE_DAYS}d)`,
  );
  if (ids.length === 0 || DRY) {
    if (DRY) console.log("dry run — no API calls spent. First 20:", ids.slice(0, 20));
    await client.end();
    return;
  }

  // Imported lazily so --dry works without the key present.
  const { refreshConditionPrices } = await import("../src/lib/condition-prices");
  const res = await refreshConditionPrices(ids);
  console.log(
    `stored ${res.pricesStored} prices for ${res.productsRequested} products ` +
      `using ${res.callsUsed} call(s)` +
      (res.requestsRemaining !== null
        ? `, ${res.requestsRemaining} remaining on ${res.plan ?? "plan"}`
        : ""),
  );
  for (const e of res.errors) console.error("  !", e);
  await client.end();
  if (res.errors.length && res.pricesStored === 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
