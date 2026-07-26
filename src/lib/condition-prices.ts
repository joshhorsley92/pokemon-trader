/**
 * Real per-condition prices, cached in card_condition_prices.
 *
 * Read path is DB-only (safe on a request); refresh is explicit and metered,
 * because the upstream plans are small. When a card has no cached row the
 * caller falls back to the estimated era curve, so this is purely additive.
 */
import { inArray, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import {
  fetchConditionPrices,
  justTcgConfigured,
  type ConditionPrice,
} from "@/lib/pricing-data/justtcg";
import { printingBucket } from "@/lib/analyzer/engine";

/** condition -> price, for one product+printing */
export type ConditionLadder = Record<string, number>;

/**
 * Cached ladders keyed by productId. Each product maps printing-bucket ->
 * (condition -> price), so a lookup can match "Reverse Holofoil" to the
 * vendor/list wording ("Reverse Foil", "Reverse Holo") the same way the
 * buylist matcher does.
 */
export type ConditionPriceMap = Map<number, Map<string, ConditionLadder>>;

export async function loadConditionPrices(
  productIds: number[],
): Promise<ConditionPriceMap> {
  const out: ConditionPriceMap = new Map();
  const ids = [...new Set(productIds.filter((id) => Number.isInteger(id)))];
  if (ids.length === 0) return out;

  const rows = await db
    .select()
    .from(tables.cardConditionPrices)
    .where(inArray(tables.cardConditionPrices.productId, ids));

  for (const r of rows) {
    if (r.price === null) continue;
    const bucket = printingBucket(r.printing) ?? "normal";
    const byPrinting = out.get(r.productId) ?? new Map<string, ConditionLadder>();
    const ladder = byPrinting.get(bucket) ?? {};
    ladder[r.condition] = Number(r.price);
    byPrinting.set(bucket, ladder);
    out.set(r.productId, byPrinting);
  }
  return out;
}

/**
 * The condition ladder for one card's chosen printing. Falls back to the
 * product's only ladder when the printing can't be matched — most products
 * have exactly one, and a near-miss beats dropping to a guess.
 */
export function ladderFor(
  map: ConditionPriceMap,
  productId: number | null,
  printing: string | null | undefined,
): ConditionLadder | null {
  if (productId === null) return null;
  const byPrinting = map.get(productId);
  if (!byPrinting || byPrinting.size === 0) return null;
  const bucket = printingBucket(printing);
  if (bucket) {
    const exact = byPrinting.get(bucket);
    if (exact) return exact;
    // Asked for a specific printing we have no data for — don't silently
    // return a different printing's prices; they differ by 40x on some cards.
    return null;
  }
  if (byPrinting.size === 1) return [...byPrinting.values()][0];
  // Unknown printing on a multi-printing card: the headline is "normal" when
  // present, else nothing (guessing here is what caused the Exeggcute bug).
  return byPrinting.get("normal") ?? null;
}

export type RefreshResult = {
  productsRequested: number;
  pricesStored: number;
  callsUsed: number;
  requestsRemaining: number | null;
  plan: string | null;
  errors: string[];
};

/** Fetch fresh condition prices for these products and upsert the cache. */
export async function refreshConditionPrices(
  productIds: number[],
): Promise<RefreshResult> {
  const ids = [...new Set(productIds.filter((id) => Number.isInteger(id)))];
  const result: RefreshResult = {
    productsRequested: ids.length,
    pricesStored: 0,
    callsUsed: 0,
    requestsRemaining: null,
    plan: null,
    errors: [],
  };
  if (!justTcgConfigured()) {
    result.errors.push("JUSTTCG_API_KEY not set — condition prices disabled");
    return result;
  }
  if (ids.length === 0) return result;

  const fetched = await fetchConditionPrices(ids);
  result.callsUsed = fetched.callsUsed;
  result.requestsRemaining = fetched.requestsRemaining;
  result.plan = fetched.plan;
  result.errors = fetched.errors;
  if (fetched.prices.length === 0) return result;

  // Only store prices for products we actually carry — the FK would reject
  // anything else, and a stray id shouldn't fail the whole batch.
  const known = new Set(
    (
      await db
        .select({ id: tables.catalogProducts.id })
        .from(tables.catalogProducts)
        .where(
          inArray(tables.catalogProducts.id, [
            ...new Set(fetched.prices.map((p) => p.productId)),
          ]),
        )
    ).map((r) => r.id),
  );
  const storable: ConditionPrice[] = fetched.prices.filter((p) =>
    known.has(p.productId),
  );
  if (storable.length === 0) return result;

  await db
    .insert(tables.cardConditionPrices)
    .values(
      storable.map((p) => ({
        productId: p.productId,
        condition: p.condition,
        printing: p.printing,
        price: p.price.toFixed(2),
        skuId: p.skuId,
        source: "justtcg",
        pricedAt: p.pricedAt,
        fetchedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [
        tables.cardConditionPrices.productId,
        tables.cardConditionPrices.condition,
        tables.cardConditionPrices.printing,
      ],
      set: {
        price: sql`excluded.price`,
        skuId: sql`excluded.sku_id`,
        source: sql`excluded.source`,
        pricedAt: sql`excluded.priced_at`,
        fetchedAt: sql`excluded.fetched_at`,
      },
    });
  result.pricesStored = storable.length;
  return result;
}
