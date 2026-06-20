/**
 * Full Grip Games — Crystal Commerce buylist, HTML only (no JSON API:
 * .json -> 415, Accept header -> 500).
 *
 * Crawl shape (verified 2026-06-11):
 * - Index /buylist/pokemon_singles/226 links ~156 set categories as
 *   /buylist/<category-slug>/<id> (3 path segments; 4 segments = product page)
 * - Set pages paginate ?page=N&sort_by_price=0 at 24 products/page; an
 *   out-of-range page still returns HTTP 200 with zero products — terminate
 *   on an empty page, not on status.
 * - Each card the store is BUYING renders a form.add-to-cart-form whose
 *   data attributes carry everything needed; cards listed but not wanted
 *   render a "Not on buylist / $0.00" row with a wishlist button and no
 *   form, so harvesting forms naturally skips them.
 * - The same variant markup repeats up to 3x per card (grid/list/detail
 *   layouts) — dedupe by data-vid.
 * - Store credit is consistently cash × 1.30 (verified across sets).
 * - Conditions: NM-Mint only on every page sampled.
 */
import { fetchWithRetry, sleep, type VendorAdapter, type VendorListing } from "./types";

const BASE = "https://www.fullgripgames.com";
const INDEX_PATH = "/buylist/pokemon_singles/226";
const THROTTLE_MS = 450;
const CREDIT_MULTIPLIER = 1.3;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Set-category links: exactly /buylist/<slug>/<id>, not product detail pages. */
export function parseSetLinks(indexHtml: string): { path: string; id: string }[] {
  const out = new Map<string, { path: string; id: string }>();
  const re = /href="(\/buylist\/[a-z0-9_]+(?:-[a-z0-9_]+)?\/(\d+))"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(indexHtml)) !== null) {
    const path = m[1];
    // Skip the index page itself
    if (path === INDEX_PATH) continue;
    out.set(path, { path, id: m[2] });
  }
  return [...out.values()];
}

const NUMBER_PART = /^[a-zA-Z]{0,4}\d{1,3}[a-zA-Z]?(\s*\/\s*[a-zA-Z]{0,4}\d{1,3})?$/;

export function parseBuylistForms(pageHtml: string): VendorListing[] {
  const listings = new Map<string, VendorListing>();
  const formRe = /<form\b[^>]*class="[^"]*add-to-cart-form[^"]*"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = formRe.exec(pageHtml)) !== null) {
    const tag = m[0];
    const attr = (name: string): string | null => {
      const a = tag.match(new RegExp(`data-${name}="([^"]*)"`, "i"));
      return a ? decodeEntities(a[1]).trim() : null;
    };
    const vid = attr("vid");
    const rawName = attr("name");
    const priceRaw = attr("price");
    if (!vid || !rawName || !priceRaw) continue;
    if (listings.has(vid)) continue; // same variant rendered in another layout

    const cash = parseFloat(priceRaw.replace(/[$,]/g, ""));
    if (!Number.isFinite(cash) || cash <= 0) continue;

    // "Iono - 185/193 - Ultra Rare" / "Charizard ex - SVP196 - Holo - SVP..."
    const parts = rawName.split(" - ").map((p) => p.trim());
    const numberIdx = parts.findIndex((p) => NUMBER_PART.test(p));
    const name = numberIdx > 0 ? parts.slice(0, numberIdx).join(" - ") : parts[0];
    const cardNumber =
      numberIdx > 0 ? parts[numberIdx].replace(/\s+/g, "") : null;
    // data-category is the set ("SV - Surging Sparks")
    const setName = attr("category");

    listings.set(vid, {
      vendorKey: vid,
      title: rawName,
      name: name || null,
      setName,
      cardNumber,
      printing: null, // printing folded into rarity/name; matcher ignores it
      cashPrice: cash,
      creditPrice: Math.round(cash * CREDIT_MULTIPLIER * 100) / 100,
      conditionPrices: null, // NM-Mint only
      buying: true,
      url: null,
    });
  }
  return [...listings.values()];
}

export const fullGripAdapter: VendorAdapter = {
  vendor: "full_grip",
  label: "Full Grip Games",
  async *fetchListings() {
    const indexRes = await fetchWithRetry(`${BASE}${INDEX_PATH}`);
    if (!indexRes.ok) {
      throw new Error(`Full Grip index: HTTP ${indexRes.status}`);
    }
    const sets = parseSetLinks(await indexRes.text());
    if (sets.length === 0) {
      throw new Error("Full Grip index: no set links found (layout change?)");
    }

    for (const set of sets) {
      for (let page = 1; ; page++) {
        const res = await fetchWithRetry(
          `${BASE}${set.path}?page=${page}&sort_by_price=0`,
        );
        if (!res.ok) {
          throw new Error(`Full Grip ${set.path} p${page}: HTTP ${res.status}`);
        }
        const html = await res.text();
        // Empty pages return 200 with no products — stop on absence of any
        // product <li>, buying or not, to avoid crawling past the end.
        const hasProducts = /<li class="product"/i.test(html);
        const listings = parseBuylistForms(html).map((l) => ({
          ...l,
          url: `${BASE}${set.path}`,
        }));
        if (listings.length > 0) yield listings;
        await sleep(THROTTLE_MS);
        if (!hasProducts) break;
      }
    }
  },
};
