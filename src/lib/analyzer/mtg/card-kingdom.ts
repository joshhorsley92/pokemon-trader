/**
 * Card Kingdom buylist client, ported from Josh's mtg-sell-helper
 * (fetch_ck_pricelist / build_ck_lookup).
 *
 * CK publishes its entire buylist as one large JSON document at
 * https://api.cardkingdom.com/api/v2/pricelist (tens of MB, refreshed daily).
 * Products carry: scryfall_id, is_foil (bool or "true"/"false" string),
 * price_buy / price_retail (decimal strings), qty_buying, name, edition,
 * variation. Products without a scryfall_id (sealed, supplies) are skipped.
 *
 * The whole list is cached in-module for 24h — never fetch more than once a
 * day per process. CK has no per-condition ladder in this feed; the engine
 * applies our own condition multipliers to the NM buy price.
 */

const CK_PRICELIST_URL = "https://api.cardkingdom.com/api/v2/pricelist";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RETRIES = 5;
const RETRY_BACKOFF_MS = 2_000; // doubles each retry: 2s, 4s, 8s, 16s
const USER_AGENT = "pokemon-trader-mtg-analyzer/1.0 (internal buylist tool)";

/** CK store-credit bonus over cash (trade-in pays 30% more in credit) */
export const CREDIT_MULTIPLIER = 1.3;

export type CkEntry = {
  name: string;
  edition: string;
  variation: string;
  /** NM cash buy price, dollars */
  priceBuy: number;
  /** How many copies CK currently wants (0 = not buying) */
  qtyBuying: number;
  /** CK retail price, dollars (informational) */
  priceRetail: number;
};

export type CkOffer = {
  cashPrice: number;
  qtyBuying: number;
};

export type CkLookup = Map<string, CkEntry>;

/** Lookup key: scryfall id + finish. CK only distinguishes foil/non-foil. */
export function ckKey(scryfallId: string, foil: boolean): string {
  return `${scryfallId}|${foil ? "foil" : "normal"}`;
}

function safeFloat(val: unknown, fallback = 0): number {
  if (val === null || val === undefined || val === "") return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function safeInt(val: unknown, fallback = 0): number {
  const n = safeFloat(val, fallback);
  return Math.trunc(n);
}

/**
 * Navigate the CK response to find the product array (mirrors the Python
 * _find_product_list). The live shape is { meta: {...}, data: [...] } but
 * we tolerate a few wrappers in case the envelope changes.
 */
function findProductList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data === null || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  for (const key of ["data", "results", "products", "list", "meta"]) {
    if (key in obj) {
      const val = obj[key];
      if (Array.isArray(val)) return val as Record<string, unknown>[];
      if (val !== null && typeof val === "object") {
        const nested = findProductList(val);
        if (nested.length) return nested;
      }
    }
  }
  return [];
}

/**
 * Build the scryfall_id+finish lookup from a raw pricelist document.
 * Pure function — exported for unit tests.
 */
export function buildCkLookup(pricelistData: unknown): CkLookup {
  const products = findProductList(pricelistData);
  if (products.length === 0) {
    throw new Error("Card Kingdom pricelist: could not find product list in response");
  }

  // Fail loudly if CK renames the fields we depend on (like the Python does)
  const sample = products[0];
  const missing = ["price_buy", "qty_buying"].filter((f) => !(f in sample));
  if (missing.length) {
    throw new Error(
      `Card Kingdom pricelist missing expected fields: ${missing.join(", ")}`,
    );
  }

  const lookup: CkLookup = new Map();
  for (const product of products) {
    const sid = String(product.scryfall_id ?? "").trim();
    if (!sid) continue; // sealed product / supplies rows have no scryfall_id

    const isFoilRaw = product.is_foil ?? false;
    const isFoil =
      typeof isFoilRaw === "string"
        ? ["true", "1", "yes"].includes(isFoilRaw.toLowerCase())
        : Boolean(isFoilRaw);

    lookup.set(ckKey(sid, isFoil), {
      name: String(product.name ?? ""),
      edition: String(product.edition ?? ""),
      variation: String(product.variation ?? ""),
      priceBuy: safeFloat(product.price_buy),
      qtyBuying: safeInt(product.qty_buying),
      priceRetail: safeFloat(product.price_retail),
    });
  }
  return lookup;
}

// ── Module-level cache ───────────────────────────────────────────────────

let cache: { lookup: CkLookup; fetchedAt: number } | null = null;
let inflight: Promise<CkLookup> | null = null;

async function fetchPricelist(): Promise<CkLookup> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(CK_PRICELIST_URL, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
      if (resp.status === 429 || resp.status >= 500) {
        lastErr = new Error(`Card Kingdom HTTP ${resp.status}`);
      } else if (!resp.ok) {
        throw new Error(`Card Kingdom HTTP ${resp.status}`);
      } else {
        return buildCkLookup(await resp.json());
      }
    } catch (err) {
      lastErr = err;
      if (err instanceof Error && /HTTP 4/.test(err.message)) throw err;
    }
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * 2 ** (attempt - 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Card Kingdom pricelist fetch failed");
}

/**
 * The cached buylist lookup, fetching at most once per 24h per process.
 * Concurrent callers share one in-flight fetch (the file is big).
 */
export async function getCkLookup(): Promise<CkLookup> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.lookup;
  if (!inflight) {
    inflight = fetchPricelist()
      .then((lookup) => {
        cache = { lookup, fetchedAt: Date.now() };
        return lookup;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** CK's current offer for one printing, or null when CK doesn't list it. */
export async function getCkOffer(
  scryfallId: string,
  foil: boolean,
): Promise<CkOffer | null> {
  const lookup = await getCkLookup();
  const entry = lookup.get(ckKey(scryfallId, foil));
  if (!entry) return null;
  return { cashPrice: entry.priceBuy, qtyBuying: entry.qtyBuying };
}
