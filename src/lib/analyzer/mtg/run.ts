/**
 * MTG analyzer orchestration: raw list text → parsed lines → Scryfall
 * resolution + market prices → Card Kingdom buylist offers → the shared
 * decision engine. Returns the same AnalyzeListResult shape as the Pokemon
 * analyzer so the admin UI can render either.
 */
import {
  analyze,
  DEFAULT_ANALYZER_ECONOMICS,
  type AnalyzerEconomics,
  type AnalyzerItem,
  type VendorOffer,
} from "@/lib/analyzer/engine";
import {
  DEFAULT_CONDITION_MULTIPLIERS,
  type ConditionMultipliers,
} from "@/lib/conditions";
import type { AnalyzedLine, AnalyzeListResult } from "@/lib/analyzer/run";
import { ckKey, CREDIT_MULTIPLIER, getCkLookup, type CkLookup } from "./card-kingdom";
import { parseMtgList, type MtgParsedLine } from "./parse";
import { resolveAndFetchPrices, type ResolvedCard } from "./scryfall";

/**
 * Stable synthetic product id from a Scryfall UUID (FNV-1a, 32-bit). The
 * engine only checks productId !== null for "matched"; when Scryfall has no
 * tcgplayer_id we still need a non-null number for resolved cards.
 */
export function syntheticProductId(scryfallId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < scryfallId.length; i++) {
    hash ^= scryfallId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) || 1;
}

/** Market price for the line's finish (etched/foil/normal), like the Python. */
function marketPriceFor(line: MtgParsedLine, card: ResolvedCard): number | null {
  if (line.finish === "etched") return card.prices.usd_etched;
  if (line.finish === "foil") return card.prices.usd_foil;
  return card.prices.usd;
}

/**
 * Map parsed+resolved lines to engine items. Pure (lookup passed in) —
 * exported for unit tests.
 */
export function buildMtgItems(
  parsed: MtgParsedLine[],
  resolved: (ResolvedCard | null)[],
  ckLookup: CkLookup,
): AnalyzerItem[] {
  return parsed.map((line, i) => {
    const card = resolved[i];
    if (!card) {
      return {
        productId: null,
        name: line.name ?? line.raw,
        setName: line.setName,
        quantity: line.quantity,
        condition: line.condition,
        marketPrice: null,
        cardNumber: line.collectorNumber,
        rarity: line.rarity,
        printing: line.finish === "normal" ? null : line.finish,
        tcgplayerId: null,
        offers: [],
      };
    }

    const offers: VendorOffer[] = [];
    // CK keys only foil/non-foil; etched printings match the foil entry
    const ck = ckLookup.get(ckKey(card.scryfallId, line.foil));
    if (ck) {
      offers.push({
        vendor: "card_kingdom",
        cashPrice: ck.priceBuy,
        // Credit = cash + 30% trade bonus, rounded to cents
        creditPrice: Math.round(ck.priceBuy * CREDIT_MULTIPLIER * 100) / 100,
        conditionPrices: null,
        buying: ck.qtyBuying > 0,
        url: null,
      });
    }

    return {
      productId: card.tcgplayerId ?? syntheticProductId(card.scryfallId),
      name: card.name,
      setName: card.setName || line.setName,
      quantity: line.quantity,
      condition: line.condition,
      marketPrice: marketPriceFor(line, card),
      cardNumber: line.collectorNumber,
      rarity: line.rarity,
      printing: line.finish === "normal" ? null : line.finish,
      tcgplayerId: card.tcgplayerId, // real id only — never the synthetic hash
      offers,
    };
  });
}

export async function analyzeMtgList(
  text: string,
  economics: AnalyzerEconomics = DEFAULT_ANALYZER_ECONOMICS,
  multipliers: ConditionMultipliers = DEFAULT_CONDITION_MULTIPLIERS,
  onProgress?: (message: string) => void,
): Promise<AnalyzeListResult> {
  const parsed = parseMtgList(text);
  if (parsed.length === 0) {
    return {
      summary: analyze([], economics, multipliers),
      lines: [],
      parsedCount: 0,
      matchedCount: 0,
    };
  }
  onProgress?.(
    `Parsed ${parsed.length.toLocaleString()} lines — fetching Card Kingdom buylist + resolving via Scryfall…`,
  );

  // Scryfall resolution and the CK pricelist are independent — fetch both at
  // once (the CK list is cached in-module after the first call of the day).
  const [resolved, ckLookup] = await Promise.all([
    resolveAndFetchPrices(
      parsed.map((line) => ({
        scryfallId: line.scryfallId,
        name: line.name,
        setCode: line.setCode,
      })),
      (done, total) =>
        onProgress?.(
          `Resolving prices via Scryfall… ${done.toLocaleString()}/${total.toLocaleString()} cards`,
        ),
    ),
    getCkLookup(),
  ]);

  onProgress?.("Computing decisions…");
  const items = buildMtgItems(parsed, resolved, ckLookup);
  const summary = analyze(items, economics, multipliers);

  const lines: AnalyzedLine[] = parsed.map((line, i) => {
    const card = resolved[i];
    return {
      raw: line.raw,
      matched: card !== null,
      via: card === null ? null : line.scryfallId ? "id" : "name",
      confidence: card === null ? 0 : 1,
      productId: items[i].productId,
      productName: card?.name ?? null,
      setName: card?.setName ?? null,
    };
  });

  return {
    summary,
    lines,
    parsedCount: parsed.length,
    matchedCount: resolved.filter((c) => c !== null).length,
  };
}
