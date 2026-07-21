/**
 * Which unpriced catalog products are worth a manual offer.
 *
 * TCGCSV's price feed omits products TCGplayer has no active listings for.
 * That omission correlates with VALUE at the top end: essentially every
 * vintage WOTC sealed booster box (Base Set Shadowless 1st Edition, Fossil
 * 1st Edition, Team Rocket, Gym Heroes, Neo Genesis...) has no price row,
 * because items that scarce trade through auction houses rather than being
 * listed. Filtering on `market_price IS NOT NULL` therefore made the single
 * most valuable trade-ins invisible to both the customer picker and admin
 * catalog — not mispriced, absent.
 *
 * So unpriced sealed is surfaced as a manual-quote lead instead of hidden,
 * the same path graded slabs already take. The exception is the low-value
 * tail (blisters, pins, checklane packs), which is unpriced simply because
 * nobody cares — surfacing that as a "request an offer" lead is noise.
 */

/** Unpriced sealed matching these is junk, not a lead. */
const LOW_VALUE_SEALED = [
  "blister",
  "checklane",
  "pin collection",
  "collector's pin",
  "collectors pin",
  "code card",
];

/** SQL ILIKE patterns for the same list, for use in catalog queries. */
export const LOW_VALUE_SEALED_PATTERNS = LOW_VALUE_SEALED.map((s) => `%${s}%`);

/**
 * True when a product has no market price but is still worth putting in
 * front of an admin as a manual offer.
 */
export function isManualQuoteCandidate(
  name: string,
  category: string,
  marketPrice: number | null,
): boolean {
  if (marketPrice !== null) return false;
  if (category !== "sealed") return false;
  const lower = name.toLowerCase();
  return !LOW_VALUE_SEALED.some((s) => lower.includes(s));
}
