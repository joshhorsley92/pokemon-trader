/**
 * JustTCG client — real per-condition prices.
 *
 * Why this exists: TCGCSV (our catalog/price backbone) explicitly does not
 * publish TCGplayer's SKU layer, and condition lives on the SKU. Everything
 * off-NM was therefore an estimate from the era curve. JustTCG sells that
 * layer keyed to the same TCGplayer product ids we already store, so it drops
 * in as an overlay rather than a replacement.
 *
 * Entirely optional: with no JUSTTCG_API_KEY set, every function no-ops and
 * callers fall back to the estimated curve. Nothing breaks without a key.
 *
 * Docs (verified 2026-07): GET/POST https://api.justtcg.com/v1/cards,
 * auth via the `x-api-key` header, response
 *   { data: [{ tcgplayerId, variants: [{ condition, printing, price, ... }] }] }
 * where a variant is one condition × printing combination.
 */

const BASE_URL = "https://api.justtcg.com/v1";
const TIMEOUT_MS = 20_000;

/**
 * Cards per batch request. The free (evaluation) tier caps this at 20; paid
 * plans allow up to 200. Override with JUSTTCG_BATCH_SIZE when upgrading —
 * fewer, larger requests burn less of the monthly call budget.
 */
const BATCH_SIZE = Number(process.env.JUSTTCG_BATCH_SIZE ?? 20);

/**
 * Requests per minute allowed by the plan (Free 10, Starter 50, Pro 100).
 * Batches are paced to stay under it — exceeding it returns 429 and wastes
 * the call. Raise JUSTTCG_RPM when upgrading.
 */
/**
 * Requests per minute the plan allows (Free 10, Starter 50, Pro 100). This is
 * a budget, not a spacing rule — a whole window's worth can be spent at once,
 * so we fire concurrently and only pause between windows.
 */
const RPM = Math.max(1, Number(process.env.JUSTTCG_RPM ?? 10));

/** How long to wait out a tripped per-minute window before retrying. */
const RETRY_AFTER_MS = 61_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** JustTCG's condition wording → our stored values. */
const CONDITION_MAP: Record<string, string> = {
  "near mint": "NM",
  "lightly played": "LP",
  "moderately played": "MP",
  "heavily played": "HP",
  damaged: "Damaged",
};

export function normalizeJustTcgCondition(raw: string | null): string | null {
  if (!raw) return null;
  return CONDITION_MAP[raw.trim().toLowerCase()] ?? null;
}

export type ConditionPrice = {
  productId: number;
  /** Normalized: NM | LP | MP | HP | Damaged */
  condition: string;
  printing: string;
  price: number;
  skuId: string | null;
  /** Source's own last-updated time */
  pricedAt: Date | null;
};

type JustTcgVariant = {
  condition?: string | null;
  printing?: string | null;
  price?: number | null;
  tcgplayerSkuId?: string | null;
  lastUpdated?: number | null;
};

type JustTcgCard = {
  tcgplayerId?: string | number | null;
  variants?: JustTcgVariant[] | null;
};

type JustTcgResponse = {
  data?: JustTcgCard[] | null;
  _metadata?: { apiPlan?: string; apiRequestsRemaining?: number } | null;
};

export function justTcgConfigured(): boolean {
  return Boolean(process.env.JUSTTCG_API_KEY);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Flatten one card payload into our per-condition rows. */
function rowsFromCard(card: JustTcgCard): ConditionPrice[] {
  const productId = Number(card.tcgplayerId);
  if (!Number.isInteger(productId) || productId <= 0) return [];
  const out: ConditionPrice[] = [];
  for (const v of card.variants ?? []) {
    const condition = normalizeJustTcgCondition(v.condition ?? null);
    // Unknown conditions (graded slabs, sealed grades) aren't ours to price.
    if (!condition) continue;
    if (typeof v.price !== "number" || !Number.isFinite(v.price)) continue;
    out.push({
      productId,
      condition,
      printing: (v.printing ?? "Normal").trim() || "Normal",
      price: v.price,
      skuId: v.tcgplayerSkuId ?? null,
      pricedAt: v.lastUpdated ? new Date(v.lastUpdated * 1000) : null,
    });
  }
  return out;
}

export type FetchResult = {
  prices: ConditionPrice[];
  /** Calls actually spent — the metered resource worth logging */
  callsUsed: number;
  requestsRemaining: number | null;
  plan: string | null;
  errors: string[];
  /** True when the plan quota/rate limit stopped the run early */
  quotaExhausted: boolean;
};

/**
 * Fetch per-condition prices for TCGplayer product ids. Batched, and tolerant:
 * a failed batch is recorded and the rest still return, because a partial
 * refresh beats none.
 */
export async function fetchConditionPrices(
  productIds: number[],
  onProgress?: (done: number, total: number) => void,
): Promise<FetchResult> {
  const apiKey = process.env.JUSTTCG_API_KEY;
  const result: FetchResult = {
    prices: [],
    callsUsed: 0,
    requestsRemaining: null,
    plan: null,
    errors: [],
    quotaExhausted: false,
  };
  if (!apiKey) {
    result.errors.push("JUSTTCG_API_KEY not set");
    return result;
  }
  const unique = [...new Set(productIds.filter((id) => Number.isInteger(id)))];

  const batches = chunk(unique, Math.max(1, BATCH_SIZE));

  /** One batch, with a single retry if we trip the per-minute window. */
  async function sendBatch(batch: number[]): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${BASE_URL}/cards`, {
          method: "POST",
          headers: { "x-api-key": apiKey!, "Content-Type": "application/json" },
          body: JSON.stringify(batch.map((id) => ({ tcgplayerId: String(id) }))),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        result.callsUsed += 1;
        if (res.status === 429 && attempt === 0) {
          // The window is per-minute, so waiting it out is the whole fix.
          await sleep(RETRY_AFTER_MS);
          continue;
        }
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          result.errors.push(
            `HTTP ${res.status} on ${batch.length} ids: ${body.slice(0, 160)}`,
          );
          if (res.status === 429) result.quotaExhausted = true;
          return;
        }
        const body = (await res.json()) as JustTcgResponse;
        for (const card of body.data ?? []) {
          result.prices.push(...rowsFromCard(card));
        }
        if (body._metadata?.apiRequestsRemaining != null) {
          // Concurrent batches each report their own count; keep the lowest,
          // which is the truest "left after this run".
          result.requestsRemaining =
            result.requestsRemaining === null
              ? body._metadata.apiRequestsRemaining
              : Math.min(
                  result.requestsRemaining,
                  body._metadata.apiRequestsRemaining,
                );
        }
        if (body._metadata?.apiPlan) result.plan = body._metadata.apiPlan;
        return;
      } catch (err) {
        result.callsUsed += 1;
        result.errors.push(err instanceof Error ? err.message : String(err));
        return;
      }
    }
  }

  // Fire the whole run at once. The plan's limit is a per-minute BUDGET, not a
  // spacing requirement — measured: 10 concurrent batches (200 cards) all
  // returned 200 in 1.2s. Callers cap the card count so one run can't exceed a
  // window's worth of calls, which keeps this well inside a serverless
  // function's timeout instead of the ~60s an evenly-paced run would take.
  onProgress?.(0, batches.length);
  for (const group of chunk(batches, Math.max(1, RPM))) {
    await Promise.all(group.map(sendBatch));
    // A second group would spend another window's budget; pause between them.
    if (batches.length > RPM) await sleep(RETRY_AFTER_MS);
    if (result.quotaExhausted) break;
  }
  onProgress?.(batches.length, batches.length);
  return result;
}
