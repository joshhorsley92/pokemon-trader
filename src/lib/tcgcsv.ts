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
export const MAGIC_CATEGORY_ID = 1;

/**
 * TCGCSV game categories mirrored into our catalog, in display order. The id is
 * TCGplayer's categoryId (the natural upstream key); the label is what the
 * customer sees in the "Product line" filter. Add a row here — and re-run the
 * sync — to bring another game online (e.g. Lorcana = 71).
 */
export const SYNCED_CATEGORIES = [
  { id: POKEMON_CATEGORY_ID, label: "Pokémon" },
  { id: MAGIC_CATEGORY_ID, label: "Magic" },
] as const;

/** Human game label for a stored category id; "Other" for anything unmapped. */
export function gameLabel(categoryId: number | null | undefined): string {
  return SYNCED_CATEGORIES.find((c) => c.id === categoryId)?.label ?? "Other";
}

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

// categoryId defaults to Pokémon so existing single-game callers keep working;
// the sync passes it explicitly per game.
export function fetchGroups(
  categoryId: number = POKEMON_CATEGORY_ID,
): Promise<TcgcsvGroup[]> {
  return fetchJson<TcgcsvGroup>(`${categoryId}/groups`);
}

export function fetchProducts(
  groupId: number,
  categoryId: number = POKEMON_CATEGORY_ID,
): Promise<TcgcsvProduct[]> {
  return fetchJson<TcgcsvProduct>(`${categoryId}/${groupId}/products`);
}

export function fetchPrices(
  groupId: number,
  categoryId: number = POKEMON_CATEGORY_ID,
): Promise<TcgcsvPrice[]> {
  return fetchJson<TcgcsvPrice>(`${categoryId}/${groupId}/prices`);
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

/** Matches "1st Edition", "1st Edition Holofoil", "First Edition", ... */
const FIRST_EDITION_RE = /\b(?:1st|first)\s*edition\b/i;

/**
 * Pick the price row to use when a product has multiple printings/subtypes.
 * Sealed products are "Normal"; for singles prefer Normal, then Holofoil.
 *
 * Vintage WOTC cards carry no Normal/Holofoil row at all — their subtypes are
 * "1st Edition Holofoil" and "Unlimited Holofoil". Unlimited must win: 1st
 * Edition asks run 4x-160x higher, so defaulting to them would quote a
 * trade-in at wild multiples of what the card is (Dark Porygon2: $9,999 vs
 * $80). Unlimited is also what most circulating copies actually are, and
 * erring low fails safe — an operator can flip a confirmed 1st Edition up,
 * but nobody can claw back an overpayment.
 */
export function pickPrice(rows: TcgcsvPrice[]): TcgcsvPrice | undefined {
  if (rows.length <= 1) return rows[0];
  // Pokémon subtypes first, then MTG's "Foil" (harmless for Pokémon, which
  // never carries that subtype; correct for a foil-only Magic printing).
  const order = [
    "Normal",
    "Holofoil",
    "Reverse Holofoil",
    "Foil",
    "Unlimited",
    "Unlimited Holofoil",
  ];
  for (const subType of order) {
    const match = rows.find((r) => r.subTypeName === subType);
    if (match) return match;
  }
  // Unrecognized naming: still refuse to headline a 1st Edition row when any
  // other printing exists.
  return rows.find((r) => !FIRST_EDITION_RE.test(r.subTypeName)) ?? rows[0];
}

/**
 * Canonical form of a printing/edition label, so loosely-written list input
 * ("Reverse Holo", "1st Ed", "unlimited") lines up with TCGplayer's exact
 * subtype names ("Reverse Holofoil", "1st Edition Holofoil", ...).
 */
function canonPrinting(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\bfirst\s*edition\b/g, "1st edition")
    .replace(/\b1st\s*ed\b\.?/g, "1st edition")
    .replace(/\bunltd\b|\bunlim\b/g, "unlimited")
    .replace(/\brev\b/g, "reverse")
    // "holo" -> "holofoil", but leave an already-complete "holofoil" alone
    .replace(/\bholo(?!foil)\b/g, "holofoil")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve a free-text printing hint to one of the product's real subtypes.
 * Returns null when nothing plausibly matches (caller falls back to headline).
 *
 * Exact-string comparison is not enough here: customer lists and vendor
 * exports write "Reverse Holo" for "Reverse Holofoil" and bare "Unlimited"
 * for "Unlimited Holofoil", and silently falling through to the headline
 * price is how a $3.50 reverse holo got quoted at $0.25 — or a $2,146
 * Unlimited Charizard at $100,000.
 */
export function resolvePrinting(
  printings: ProductPrinting[] | null | undefined,
  raw: string | null | undefined,
): string | null {
  if (!raw || !printings || printings.length === 0) return null;
  const want = canonPrinting(raw);
  if (!want) return null;
  const candidates = printings.map((p) => ({
    subType: p.subType,
    canon: canonPrinting(p.subType),
  }));

  const exact = candidates.filter((c) => c.canon === want);
  if (exact.length > 0) return pick(exact);
  // Partial both ways: "unlimited" -> "unlimited holofoil", and
  // "unlimited holofoil edition" -> "unlimited holofoil".
  const partial = candidates.filter(
    (c) => c.canon.includes(want) || want.includes(c.canon),
  );
  if (partial.length > 0) return pick(partial);
  return null;

  /** Unless the hint explicitly said 1st Edition, never resolve to one. */
  function pick(list: { subType: string; canon: string }[]): string {
    if (!FIRST_EDITION_RE.test(want)) {
      const safe = list.find((c) => !FIRST_EDITION_RE.test(c.canon));
      if (safe) return safe.subType;
    }
    return list[0].subType;
  }
}

export type ProductPrinting = {
  subType: string;
  market: number | null;
  low: number | null;
};

/**
 * Market price for a chosen printing subType (e.g. "1st Edition Holofoil",
 * "Reverse Holofoil"), falling back to the product's headline price when no
 * printing is chosen or the chosen one has no market figure.
 */
export function priceForPrinting(
  printings: ProductPrinting[] | null | undefined,
  printing: string | null | undefined,
  headline: number | null,
): number | null {
  if (printing && printings) {
    // Loose match: list imports write "Reverse Holo" / "Unlimited", not
    // TCGplayer's exact subtype. An exact-only compare quietly fell back to
    // the headline price, which is the whole edition-mispricing bug.
    const subType = resolvePrinting(printings, printing);
    const match = subType
      ? printings.find((p) => p.subType === subType)
      : undefined;
    if (match && match.market !== null) return match.market;
  }
  return headline;
}

/**
 * Lowest live listing for a chosen printing, falling back to the product's
 * headline low. Market price trails completed sales and on vintage often sits
 * far above what's actually for sale, so this is the realistic sale ceiling.
 */
export function lowForPrinting(
  printings: ProductPrinting[] | null | undefined,
  printing: string | null | undefined,
  headline: number | null,
): number | null {
  if (printing && printings) {
    const subType = resolvePrinting(printings, printing);
    const match = subType
      ? printings.find((p) => p.subType === subType)
      : undefined;
    if (match && match.low !== null) return match.low;
  }
  return headline;
}

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
