/**
 * Analyzer orchestration: raw customer list text → parsed lines → catalog
 * matches → vendor offers from buylist_prices → decision engine summary.
 */
import { inArray, and, eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { getSettings } from "@/lib/settings";
import {
  ensureConditionPrices,
  ladderFor,
  type ConditionCoverage,
} from "@/lib/condition-prices";
import {
  lowForPrinting,
  priceForPrinting,
  type ProductPrinting,
} from "@/lib/tcgcsv";
import { analyze, type AnalyzerItem, type AnalyzerSummary, type VendorOffer } from "./engine";
import { getCatalogIndex } from "./match";
import { parseList, type ParsedLine } from "./parse";

/** Per-card operator overrides from the manual analyzer (condition/printing). */
export type AnalyzerOverride = {
  condition?: string | null;
  printing?: string | null;
};

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
  /** How much of the run is backed by real per-condition prices */
  conditionCoverage?: ConditionCoverage;
  lines: AnalyzedLine[];
  parsedCount: number;
  matchedCount: number;
};

export type ExtraItem = {
  productId: number;
  quantity: number;
  condition?: string | null;
  printing?: string | null;
};

export async function analyzeListText(
  shopId: string,
  text: string,
  extra: ExtraItem[] = [],
  onProgress?: (message: string) => void,
  /** Per-productId operator overrides (manual analyzer reprice) */
  overrides: Record<number, AnalyzerOverride> = {},
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
        printing: e.printing ?? null,
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
  // Per-product printings + TCGplayer link for the matched cards only (keeps
  // this off the big cached catalog index). Printings let the operator switch
  // holo/reverse/1st-edition and reprice; the URL is the "check it live" link.
  const [offerRows, productMeta] = await Promise.all([
    productIds.length
      ? db
          .select()
          .from(tables.buylistPrices)
          .where(
            and(
              inArray(tables.buylistPrices.productId, productIds),
              eq(tables.buylistPrices.buying, true),
            ),
          )
      : Promise.resolve([]),
    productIds.length
      ? db
          .select({
            id: tables.catalogProducts.id,
            printings: tables.catalogProducts.printings,
            tcgplayerUrl: tables.catalogProducts.tcgplayerUrl,
            lowPrice: tables.catalogProducts.lowPrice,
            publishedOn: tables.catalogGroups.publishedOn,
          })
          .from(tables.catalogProducts)
          .leftJoin(
            tables.catalogGroups,
            eq(tables.catalogGroups.id, tables.catalogProducts.groupId),
          )
          .where(inArray(tables.catalogProducts.id, productIds))
      : Promise.resolve([]),
  ]);
  const printingsByProduct = new Map<number, ProductPrinting[]>();
  const tcgUrlByProduct = new Map<number, string | null>();
  const yearByProduct = new Map<number, number | null>();
  const lowByProduct = new Map<number, number | null>();
  for (const p of productMeta) {
    printingsByProduct.set(p.id, (p.printings as ProductPrinting[] | null) ?? []);
    tcgUrlByProduct.set(p.id, p.tcgplayerUrl);
    lowByProduct.set(p.id, p.lowPrice === null ? null : Number(p.lowPrice));
    // Release year drives the condition-curve era (vintage vs modern).
    const year = p.publishedOn ? Number(String(p.publishedOn).slice(0, 4)) : null;
    yearByProduct.set(p.id, Number.isFinite(year) ? year : null);
  }
  const offersByProduct = new Map<number, VendorOffer[]>();
  for (const row of offerRows) {
    if (row.productId === null) continue;
    const list = offersByProduct.get(row.productId) ?? [];
    list.push({
      vendor: row.vendor,
      cashPrice: row.cashPrice === null ? null : Number(row.cashPrice),
      creditPrice: row.creditPrice === null ? null : Number(row.creditPrice),
      conditionPrices: (row.conditionPrices ?? null) as Record<string, number> | null,
      printing: row.printing,
      buying: row.buying,
      url: row.vendorUrl,
    });
    offersByProduct.set(row.productId, list);
  }

  const items: AnalyzerItem[] = parsed.map((line: ParsedLine, i) => {
    const match = matches[i];
    const productId = match?.entry.id ?? null;
    const override = productId !== null ? overrides[productId] : undefined;
    // Operator overrides win over whatever the list line said.
    const condition =
      override?.condition !== undefined ? override.condition : line.condition;
    const printing =
      override?.printing !== undefined ? override.printing : line.printing;
    const printingList =
      productId !== null ? (printingsByProduct.get(productId) ?? null) : null;
    // Price against the chosen printing (holo/reverse/1st ed), not just the
    // headline — this is what makes the reprice accurate.
    const marketPrice = priceForPrinting(
      printingList,
      printing,
      match?.entry.marketPrice ?? null,
    );
    // Lowest live listing for the same printing — caps the sale estimate.
    const lowPrice = lowForPrinting(
      printingList,
      printing,
      productId !== null ? (lowByProduct.get(productId) ?? null) : null,
    );
    return {
      productId,
      name: match?.entry.name ?? line.name ?? line.raw,
      setName: match?.entry.setName ?? line.setName,
      quantity: line.quantity,
      condition,
      marketPrice,
      lowPrice,
      category: match?.entry.category,
      cardNumber: match?.entry.cardNumber ?? line.cardNumber,
      rarity: match?.entry.rarity ?? null,
      printing,
      releaseYear: productId !== null ? (yearByProduct.get(productId) ?? null) : null,
      tcgplayerId: productId,
      tcgUrl: productId !== null ? (tcgUrlByProduct.get(productId) ?? null) : null,
      availablePrintings:
        printingList && printingList.length > 1
          ? printingList.map((p) => ({ subType: p.subType, market: p.market }))
          : null,
      offers: match ? (offersByProduct.get(match.entry.id) ?? []) : [],
    };
  });

  // Real per-condition prices, cache-first. Only off-NM lines worth enough to
  // change a decision trigger a fetch, capped per run and TTL'd, so a big list
  // can't drain the metered quota. NM never needs one — it's TCGCSV market.
  onProgress?.("Checking per-condition prices…");
  const { map: conditionPrices, coverage: conditionCoverage } = await ensureConditionPrices(
    items.map((it) => ({
      productId: it.productId,
      condition: it.condition,
      printing: it.printing,
      marketPrice: it.marketPrice,
    })),
  );
  for (const it of items) {
    it.conditionLadder = ladderFor(conditionPrices, it.productId, it.printing);
  }

  const settings = await getSettings(shopId);
  const summary = analyze(
    items,
    settings.analyzer_economics,
    settings.condition_multipliers,
    settings.condition_curve,
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
    conditionCoverage,
    lines,
    parsedCount: parsed.length,
    matchedCount: matches.filter((m) => m !== null).length,
  };
}
