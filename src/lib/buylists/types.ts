/**
 * Vendor buylist adapter contract. Each adapter streams pages of normalized
 * listings; the sync script owns matching, upserts, and bookkeeping.
 */

export type VendorListing = {
  /** Vendor's stable id for this listing (Shopify product id, CC listing id) */
  vendorKey: string;
  /** Raw listing title, kept for match auditing */
  title: string;
  name: string | null;
  setName: string | null;
  cardNumber: string | null;
  printing: string | null;
  /** NM cash buy price, dollars */
  cashPrice: number | null;
  /** NM store-credit buy price, dollars */
  creditPrice: number | null;
  /** Published per-condition cash ladder, when the vendor has one */
  conditionPrices: Record<string, number> | null;
  buying: boolean;
  url: string | null;
};

export type VendorAdapter = {
  /** Stable slug stored in buylist_prices.vendor */
  vendor: string;
  label: string;
  /** Yields batches (pages) of listings; the caller controls persistence. */
  fetchListings(): AsyncGenerator<VendorListing[]>;
};

/**
 * Shared polite-fetch helper: versioned UA, retries with backoff, throttle.
 * Retries generously on network-level failures (Josh's dev machine has
 * intermittent DNS flaps — ENOTFOUND on hosts that resolve seconds later).
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  retries = 5,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          "User-Agent": "pokemon-trader/0.1.0",
          ...init.headers,
        },
      });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`${url} -> HTTP ${res.status}`);
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(Math.min(30_000, 2000 * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
