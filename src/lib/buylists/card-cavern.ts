/**
 * Card Cavern Trading Cards — Pokemon-specialist buylist on Shopify.
 * The buylist is exposed as ordinary Shopify products, so
 * /collections/pokemon-singles-buylist/products.json pages cleanly.
 *
 * Listing shape (verified 2026-06-11):
 *   title:    "Abomasnow - 060/182 - Destined Rivals - Reverse Holo"
 *   tags:     ["Set_Destined Rivals", "Print_Reverse Holo", ...]
 *   variants: one per condition (Near Mint / Lightly Played / ...) where
 *             variant.price is what they PAY for that condition.
 *
 * Payment policy (site terms, not in the feed): payouts are store credit
 * +15% on the listed price; cash at the listed price only on submissions
 * of $500 or less. We store listed = cash, listed × 1.15 = credit.
 *
 * variant.available is meaningful: false = NOT currently buying that
 * condition (the Automatik app gates submission through Shopify inventory).
 * Only ~6% of variants are typically active, so rows are kept with
 * buying=false as reference prices and the engine skips them as offers.
 */
import { fetchWithRetry, sleep, type VendorAdapter, type VendorListing } from "./types";

const COLLECTION_URL =
  "https://www.cardcaverntradingcards.com/collections/pokemon-singles-buylist/products.json";
const PAGE_LIMIT = 250;
const THROTTLE_MS = 1100;
const CREDIT_BONUS = 1.15;

const CONDITION_KEYS: Record<string, string> = {
  "near mint": "NM",
  "lightly played": "LP",
  "moderately played": "MP",
  "heavily played": "HP",
  damaged: "Damaged",
};

type ShopifyVariant = {
  id: number;
  title: string;
  price: string;
  available: boolean;
};

type ShopifyProduct = {
  id: number;
  title: string;
  handle: string;
  tags: string[];
  variants: ShopifyVariant[];
};

// Number segment formats seen live: "060/182", "TG24/TG30", "GG16/GG70",
// "SV81/SV94", "RC24/RC32", bare promos "SM187", bare "007".
const NUMBER_SEGMENT = /^[a-zA-Z]{0,4}\d{1,3}[a-zA-Z]?(\s*\/\s*[a-zA-Z]{0,4}\d{1,3})?$/;

export function parseCavernTitle(
  title: string,
  tags: string[],
): { name: string | null; setName: string | null; cardNumber: string | null; printing: string | null } {
  const setTag = tags.find((t) => t.startsWith("Set_"))?.slice(4) ?? null;
  const printTag = tags.find((t) => t.startsWith("Print_"))?.slice(6) ?? null;

  // Title is "Name - Number - Set[ - Print]" but Name itself can contain
  // " - "-free qualifiers and curly apostrophes; find the number segment and
  // treat everything before it as the name.
  const segments = title.split(" - ").map((s) => s.trim());
  const numberIdx = segments.findIndex((s) => NUMBER_SEGMENT.test(s));
  let name: string | null;
  let cardNumber: string | null = null;
  let setName = setTag;
  if (numberIdx > 0) {
    name = segments.slice(0, numberIdx).join(" - ");
    cardNumber = segments[numberIdx].replace(/\s+/g, "");
    if (!setName && segments[numberIdx + 1]) setName = segments[numberIdx + 1];
  } else {
    // No number segment (some promos/trainers): first segment is the name
    name = segments[0] || null;
    if (!setName && segments[1]) setName = segments[1];
  }
  return { name, setName, cardNumber, printing: printTag };
}

export function listingFromShopifyProduct(
  p: ShopifyProduct,
): VendorListing | null {
  const ladder: Record<string, number> = {};
  let anyAvailable = false;
  for (const v of p.variants) {
    const key = CONDITION_KEYS[v.title.trim().toLowerCase()];
    const price = parseFloat(v.price);
    if (key && Number.isFinite(price)) ladder[key] = price;
    if (v.available) anyAvailable = true;
  }
  const nm = ladder.NM;
  if (nm === undefined || nm <= 0) return null;

  const { name, setName, cardNumber, printing } = parseCavernTitle(
    p.title,
    p.tags,
  );
  return {
    vendorKey: String(p.id),
    title: p.title,
    name,
    setName,
    cardNumber,
    printing,
    cashPrice: nm,
    creditPrice: Math.round(nm * CREDIT_BONUS * 100) / 100,
    conditionPrices: Object.keys(ladder).length > 1 ? ladder : null,
    buying: anyAvailable,
    url: `https://www.cardcaverntradingcards.com/products/${p.handle}`,
  };
}

export const cardCavernAdapter: VendorAdapter = {
  vendor: "card_cavern",
  label: "Card Cavern",
  async *fetchListings() {
    for (let page = 1; ; page++) {
      const res = await fetchWithRetry(
        `${COLLECTION_URL}?limit=${PAGE_LIMIT}&page=${page}`,
      );
      if (!res.ok) throw new Error(`Card Cavern page ${page}: HTTP ${res.status}`);
      const body = (await res.json()) as { products: ShopifyProduct[] };
      if (!body.products?.length) return;
      yield body.products
        .map(listingFromShopifyProduct)
        .filter((l): l is VendorListing => l !== null);
      await sleep(THROTTLE_MS);
    }
  },
};
