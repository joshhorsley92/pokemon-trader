/**
 * Analyzer orchestration: raw customer list text → parsed lines → catalog
 * matches → vendor offers from buylist_prices → decision engine summary.
 */
import { inArray, and, eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { getSettings } from "@/lib/settings";
import { analyze, type AnalyzerItem, type AnalyzerSummary, type VendorOffer } from "./engine";
import { getCatalogIndex } from "./match";
import { parseList, type ParsedLine } from "./parse";

export type AnalyzedLine = {
  raw: string;
  matched: boolean;
  via: "id" | "number" | "name" | null;
  confidence: number;
  productId: number | null;
  productName: string | null;
  setName: string | null;
};

export type AnalyzeListResult = {
  summary: AnalyzerSummary;
  lines: AnalyzedLine[];
  parsedCount: number;
  matchedCount: number;
};

export type ExtraItem = {
  productId: number;
  quantity: number;
  condition?: string | null;
};

export async function analyzeListText(
  shopId: string,
  text: string,
  extra: ExtraItem[] = [],
  onProgress?: (message: string) => void,
): Promise<AnalyzeListResult> {
  const parsed = [
    ...parseList(text),
    // Manually added rows from the admin UI search — already exact
    ...extra.map(
      (e): ParsedLine => ({
        raw: `(manual) product ${e.productId}`,
        quantity: e.quantity,
        name: null,
        setName: null,
        cardNumber: null,
        printing: null,
        condition: e.condition ?? null,
        productId: e.productId,
      }),
    ),
  ];
  if (parsed.length === 0) {
    return {
      summary: analyze([]),
      lines: [],
      parsedCount: 0,
      matchedCount: 0,
    };
  }

  onProgress?.(
    `Parsed ${parsed.length.toLocaleString()} lines — loading the catalog index…`,
  );
  const index = await getCatalogIndex(db);
  onProgress?.(`Matching ${parsed.length.toLocaleString()} lines against the catalog…`);
  // Customer lists may include sealed product — let those match sealed
  // catalog entries so they're labeled instead of landing in "bulk".
  const matches = parsed.map((line) => index.match(line, { allowSealed: true }));

  const productIds = [
    ...new Set(
      matches
        .filter((m) => m !== null)
        .map((m) => m.entry.id),
    ),
  ];

  onProgress?.("Loading vendor offers + computing decisions…");
  const offerRows = productIds.length
    ? await db
        .select()
        .from(tables.buylistPrices)
        .where(
          and(
            inArray(tables.buylistPrices.productId, productIds),
            eq(tables.buylistPrices.buying, true),
          ),
        )
    : [];
  const offersByProduct = new Map<number, VendorOffer[]>();
  for (const row of offerRows) {
    if (row.productId === null) continue;
    const list = offersByProduct.get(row.productId) ?? [];
    list.push({
      vendor: row.vendor,
      cashPrice: row.cashPrice === null ? null : Number(row.cashPrice),
      creditPrice: row.creditPrice === null ? null : Number(row.creditPrice),
      conditionPrices: (row.conditionPrices ?? null) as Record<string, number> | null,
      buying: row.buying,
      url: row.vendorUrl,
    });
    offersByProduct.set(row.productId, list);
  }

  const items: AnalyzerItem[] = parsed.map((line: ParsedLine, i) => {
    const match = matches[i];
    return {
      productId: match?.entry.id ?? null,
      name: match?.entry.name ?? line.name ?? line.raw,
      setName: match?.entry.setName ?? line.setName,
      quantity: line.quantity,
      condition: line.condition,
      marketPrice: match?.entry.marketPrice ?? null,
      category: match?.entry.category,
      cardNumber: match?.entry.cardNumber ?? line.cardNumber,
      rarity: match?.entry.rarity ?? null,
      printing: line.printing,
      tcgplayerId: match?.entry.id ?? null,
      offers: match ? (offersByProduct.get(match.entry.id) ?? []) : [],
    };
  });

  const settings = await getSettings(shopId);
  const summary = analyze(
    items,
    settings.analyzer_economics,
    settings.condition_multipliers,
  );

  const lines: AnalyzedLine[] = parsed.map((line, i) => {
    const match = matches[i];
    return {
      raw: line.raw,
      matched: match !== null,
      via: match?.via ?? null,
      confidence: match?.confidence ?? 0,
      productId: match?.entry.id ?? null,
      productName: match?.entry.name ?? null,
      setName: match?.entry.setName ?? null,
    };
  });

  return {
    summary,
    lines,
    parsedCount: parsed.length,
    matchedCount: matches.filter((m) => m !== null).length,
  };
}
