/**
 * TCGCSV (tcgcsv.com) client — free daily mirrors of TCGplayer catalog + prices.
 * Pokémon is category 3. Data is ~24h behind TCGplayer's live API.
 *
 * This module is only used by the sync script (and admin-triggered re-syncs).
 * The app itself always reads from our own database — TCGCSV is never fetched
 * at request time, so an outage degrades to "slightly stale prices".
 */

const BASE_URL = "https://tcgcsv.com/tcgplayer";
export const POKEMON_CATEGORY_ID = 3;

// TCGCSV's usage guidelines require a versioned User-Agent ("Name/X.Y.Z");
// unversioned agents get a 401.
const USER_AGENT = "pokemon-trader/0.1.0";

export type TcgcsvGroup = {
  groupId: number;
  name: string;
  abbreviation: string | null;
  isSupplemental: boolean;
  publishedOn: string | null;
  modifiedOn: string;
  categoryId: number;
};

export type TcgcsvExtendedData = {
  name: string;
  displayName: string;
  value: string;
};

export type TcgcsvProduct = {
  productId: number;
  name: string;
  cleanName: string | null;
  imageUrl: string | null;
  categoryId: number;
  groupId: number;
  url: string | null;
  modifiedOn: string;
  extendedData?: TcgcsvExtendedData[];
};

export type TcgcsvPrice = {
  productId: number;
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  marketPrice: number | null;
  directLowPrice: number | null;
  subTypeName: string;
};

type TcgcsvResponse<T> = {
  totalItems?: number;
  success: boolean;
  errors: unknown[];
  results: T[];
};

async function fetchJson<T>(path: string, retries = 3): Promise<T[]> {
  const url = `${BASE_URL}/${path}`;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
      const body = (await res.json()) as TcgcsvResponse<T>;
      if (!body.success) throw new Error(`${url} -> success=false`);
      return body.results;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

export function fetchGroups(): Promise<TcgcsvGroup[]> {
  return fetchJson<TcgcsvGroup>(`${POKEMON_CATEGORY_ID}/groups`);
}

export function fetchProducts(groupId: number): Promise<TcgcsvProduct[]> {
  return fetchJson<TcgcsvProduct>(`${POKEMON_CATEGORY_ID}/${groupId}/products`);
}

export function fetchPrices(groupId: number): Promise<TcgcsvPrice[]> {
  return fetchJson<TcgcsvPrice>(`${POKEMON_CATEGORY_ID}/${groupId}/prices`);
}

/**
 * Sealed classification heuristic.
 *
 * In TCGplayer data, single cards virtually always carry a "Number"
 * extendedData entry (card number); sealed products never do. We classify by
 * that signal alone rather than requiring a name-keyword match, because a
 * false negative hides a real sealed product from the public trade builder,
 * while false positives (code cards, accessories) are cheap junk that the
 * min_item_price setting filters out. Admins can flip any product via
 * category_override.
 */
export function classifyProduct(product: TcgcsvProduct): "singles" | "sealed" {
  const hasCardNumber = (product.extendedData ?? []).some(
    (e) => e.name === "Number",
  );
  if (hasCardNumber) return "singles";
  // Online code cards have no card number but aren't sealed product either;
  // keep them out of the public sealed picker.
  if (/^code card\b/i.test(product.name)) return "singles";
  return "sealed";
}

/**
 * Pick the price row to use when a product has multiple printings/subtypes.
 * Sealed products are "Normal"; for singles prefer Normal, then Holofoil.
 */
export function pickPrice(rows: TcgcsvPrice[]): TcgcsvPrice | undefined {
  if (rows.length <= 1) return rows[0];
  const order = ["Normal", "Holofoil", "Reverse Holofoil"];
  for (const subType of order) {
    const match = rows.find((r) => r.subTypeName === subType);
    if (match) return match;
  }
  return rows[0];
}

export type ProductPrinting = {
  subType: string;
  market: number | null;
  low: number | null;
};

/**
 * All printings for a product, ordered headline-first (the one pickPrice
 * mirrors into market_price), each with its effective market + low price.
 * This is what lets the customer pick "1st Edition Holofoil" vs "Unlimited"
 * etc. and be quoted against the right price.
 */
export function serializePrintings(rows: TcgcsvPrice[]): ProductPrinting[] {
  const headline = pickPrice(rows);
  const ordered =
    headline && rows.length > 1
      ? [headline, ...rows.filter((r) => r !== headline)]
      : rows;
  return ordered.map((r) => ({
    subType: r.subTypeName,
    market: effectiveMarketPrice(r),
    low: r.lowPrice,
  }));
}

/**
 * Market price with midPrice fallback for products TCGplayer has no market
 * figure for yet.
 *
 * Sanity guard: TCGplayer's marketPrice is occasionally ancient-stale garbage
 * on low-velocity vintage products (observed live: Entei Star marketPrice
 * $0.99 against lowPrice $1,600 / midPrice $2,034). When market is under 10%
 * of the current low ask, trust mid/low instead.
 */
export function effectiveMarketPrice(price: TcgcsvPrice): number | null {
  const { marketPrice, midPrice, lowPrice } = price;
  if (
    marketPrice !== null &&
    lowPrice !== null &&
    lowPrice >= 1 &&
    marketPrice < lowPrice * 0.1
  ) {
    return midPrice ?? lowPrice;
  }
  return marketPrice ?? midPrice ?? null;
}

/** Run an async task over items with bounded concurrency. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}
