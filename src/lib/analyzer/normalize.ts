/**
 * Normalization helpers shared by the list parsers (customer input) and the
 * buylist matchers (vendor listings). Everything funnels into the same
 * normalized keys so both sides land on the same catalog product.
 */

/** Lowercase, strip diacritics ("Pokémon" -> "pokemon") and non-alphanumerics. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Canonical card number: strips leading zeros on each segment and the
 * denominator when present. "060/182" -> "60/182", "TG01/TG30" -> "tg1/tg30",
 * "SWSH123" -> "swsh123", "#25" -> "25".
 */
export function normalizeCardNumber(raw: string): string {
  const cleaned = raw.trim().replace(/^#/, "").toLowerCase();
  return cleaned
    .split("/")
    .map((part) =>
      part.replace(/^([a-z]*)0*(\d)/, "$1$2").trim(),
    )
    .join("/");
}

/** The numerator alone ("60" from "060/182") for sources that omit the total. */
export function cardNumberNumerator(raw: string): string {
  return normalizeCardNumber(raw).split("/")[0];
}

/**
 * Set-name key. TCGCSV group names sometimes carry prefixes/suffixes vendors
 * omit ("SV10: Destined Rivals" vs "Destined Rivals"), so matching uses
 * containment over these keys rather than equality.
 */
export function normalizeSetName(s: string): string {
  return normalizeText(s)
    .replace(/\bpokemon\b/g, "")
    .replace(/\btcg\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when one normalized set name contains the other (and neither is empty). */
export function setNamesCompatible(a: string, b: string): boolean {
  const na = normalizeSetName(a);
  const nb = normalizeSetName(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}
