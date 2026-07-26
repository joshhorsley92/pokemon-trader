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

export type EnsureLine = {
  productId: number | null;
  /** Sealed product has no card condition — never worth a call */
  category?: "singles" | "sealed" | null;
  condition: string | null | undefined;
  printing: string | null | undefined;
  marketPrice: number | null | undefined;
};

/**
 * Cache-first read that lazily fills gaps for the lines that actually need it.
 *
 * The upstream plans are metered, so we never bulk-fetch. Two filters keep the
 * spend tiny:
 *  - NM needs nothing. Its price is TCGCSV's market price, refreshed nightly
 *    for the whole catalog at no cost.
 *  - Cheap cards need nothing. Being 30% off on a $0.40 common cannot change
 *    a decision; being 30% off on a $60 holo can.
 *
 * Whatever's left is capped per run, most valuable first, so one big list
 * can't drain a day's quota. Failures are swallowed — a missing ladder just
 * falls back to the era curve.
 */
/**
 * What the overlay managed to cover this run. Surfaced to the operator so a
 * partial refresh is visible — silently falling back to estimates is worse
 * than saying "these 40 rows are estimated, re-run to fetch them".
 */
export type ConditionCoverage = {
  /** Lines that wanted real data (off-NM, above the value floor) */
  eligible: number;
  /** Of those, how many ended up backed by real per-condition prices */
  covered: number;
  /** Wanted data but deferred by the per-run cap — re-run to pick them up */
  deferredByCap: number;
  /** Stopped early because the plan's rate/quota limit was hit */
  quotaExhausted: boolean;
  requestsRemaining: number | null;
  errors: string[];
};

export async function ensureConditionPrices(
  lines: EnsureLine[],
  opts: {
    minMarketPrice?: number;
    maxCards?: number;
    /** Don't re-fetch a card touched more recently than this. */
    ttlHours?: number;
  } = {},
): Promise<{ map: ConditionPriceMap; coverage: ConditionCoverage }> {
  const minMarket = opts.minMarketPrice ?? 5;
  const maxCards = opts.maxCards ?? 60;
  const ttlHours = opts.ttlHours ?? 24;

  const productIds = [
    ...new Set(
      lines
        .map((l) => l.productId)
        .filter((id): id is number => Number.isInteger(id as number)),
    ),
  ];
  const cached = await loadConditionPrices(productIds);

  // Lines that want real data at all — the denominator for coverage.
  const eligibleLines = lines.filter(
    (l) =>
      l.productId !== null &&
      Number.isInteger(l.productId) &&
      l.category !== "sealed" &&
      (l.condition ?? "NM") !== "NM" &&
      (l.marketPrice ?? 0) >= minMarket,
  );
  const coverageOf = (
    map: ConditionPriceMap,
    extra: Partial<ConditionCoverage> = {},
  ): ConditionCoverage => ({
    eligible: eligibleLines.length,
    covered: eligibleLines.filter((l) =>
      Boolean(ladderFor(map, l.productId, l.printing)),
    ).length,
    deferredByCap: 0,
    quotaExhausted: false,
    requestsRemaining: null,
    errors: [],
    ...extra,
  });

  if (!justTcgConfigured()) {
    return { map: cached, coverage: coverageOf(cached) };
  }

  // When each product was last fetched — the guard against hammering the API
  // with the same card every time a list is re-run.
  const freshness = new Map<number, Date>();
  if (productIds.length > 0) {
    const rows = await db
      .select({
        productId: tables.cardConditionPrices.productId,
        fetchedAt: sql<Date | null>`max(${tables.cardConditionPrices.fetchedAt})`,
      })
      .from(tables.cardConditionPrices)
      .where(inArray(tables.cardConditionPrices.productId, productIds))
      .groupBy(tables.cardConditionPrices.productId);
    for (const r of rows) {
      if (r.fetchedAt) freshness.set(r.productId, new Date(r.fetchedAt));
    }
  }
  const cutoff = Date.now() - ttlHours * 60 * 60 * 1000;

  // Worth fetching: off-condition, valuable enough to matter, and either
  // unknown or past its TTL.
  const wanted = new Map<number, number>(); // productId -> market price
  for (const l of lines) {
    if (l.productId === null || !Number.isInteger(l.productId)) continue;
    if (l.category === "sealed") continue;
    const cond = l.condition ?? "NM";
    if (cond === "NM") continue;
    const market = l.marketPrice ?? 0;
    if (market < minMarket) continue;
    const lastFetched = freshness.get(l.productId);
    // Known and still fresh -> leave it alone until the TTL lapses.
    if (lastFetched !== undefined && lastFetched.getTime() > cutoff) continue;
    if (!lastFetched && ladderFor(cached, l.productId, l.printing)) continue;
    // Caveat: a card the source has no data for stores nothing, so it has no
    // fetchedAt and can be retried on a later run. Cheap in practice — those
    // retries ride along in an existing batch and the per-run cap bounds them.
    wanted.set(l.productId, Math.max(wanted.get(l.productId) ?? 0, market));
  }
  if (wanted.size === 0) return { map: cached, coverage: coverageOf(cached) };

  const ranked = [...wanted.entries()].sort((a, b) => b[1] - a[1]); // priciest first
  const toFetch = ranked.slice(0, maxCards).map(([id]) => id);
  const deferredByCap = Math.max(0, ranked.length - toFetch.length);

  try {
    const res = await refreshConditionPrices(toFetch);
    const map =
      res.pricesStored > 0 ? await loadConditionPrices(productIds) : cached;
    return {
      map,
      coverage: coverageOf(map, {
        deferredByCap,
        quotaExhausted: res.quotaExhausted,
        requestsRemaining: res.requestsRemaining,
        errors: res.errors,
      }),
    };
  } catch (err) {
    // Never let a pricing-overlay hiccup break the run — but say so.
    return {
      map: cached,
      coverage: coverageOf(cached, {
        deferredByCap,
        errors: [err instanceof Error ? err.message : String(err)],
      }),
    };
  }
}

export type RefreshResult = {
  quotaExhausted: boolean;
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
    quotaExhausted: false,
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
  result.quotaExhausted = fetched.quotaExhausted;
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
