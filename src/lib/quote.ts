/**
 * DB-backed quoting: loads products + applicable pricing rules and delegates
 * the math to the pure engine in pricing.ts.
 *
 * Two kinds of trade-in line:
 *  - raw cards — auto-priced. The customer's chosen printing selects which of
 *    the product's per-printing prices to quote against.
 *  - manual lines — NOT auto-priced. These come back as `manualLines` for an
 *    admin to make a custom offer on; they don't count toward the quote
 *    total. Two things land here: graded slabs (free data can't value slabs)
 *    and unpriced sealed (see lib/manual-quote.ts — the feed's price gap
 *    covers vintage booster boxes, so "no price" often means "very valuable").
 */
import { and, eq, inArray, or } from "drizzle-orm";
import { db, tables } from "@/db";
import { hotBuyBonuses } from "@/lib/hot-buys";
import { isManualQuoteCandidate } from "@/lib/manual-quote";
import {
  computeQuote,
  dollarsDown,
  type PricingRule,
  type ProductCategory,
  type Quote,
  type QuotableProduct,
  type RateType,
} from "@/lib/pricing";
import { priceForPrinting, type ProductPrinting } from "@/lib/tcgcsv";
import type { AppSettings } from "@/lib/settings";

export type TradeInInput = {
  productId: number;
  quantity: number;
  condition?: string | null;
  /** Chosen TCGplayer printing/edition (subType); null = product default */
  printing?: string | null;
  graded?: boolean;
  grader?: string | null;
  grade?: string | null;
};

export type ManualLine = {
  productId: number;
  productName: string;
  printing: string | null;
  grader: string | null;
  grade: string | null;
  quantity: number;
  /** Raw printing market price, for admin reference only (not an offer) */
  refMarketPrice: number | null;
  /**
   * Why this needs a human. 'graded' = slab; 'unpriced' = no market price in
   * the feed, which for sealed skews toward high-value vintage.
   */
  reason: "graded" | "unpriced";
};

export type DbQuote = Quote & { manualLines: ManualLine[] };

export async function quoteFromDb(
  items: TradeInInput[],
  rateType: RateType,
  settings: AppSettings,
  shopId: string,
): Promise<DbQuote> {
  if (items.length === 0) {
    return { rateType, lines: [], total: 0, manualLines: [] };
  }
  const productIds = items.map((i) => i.productId);
  const products = await db
    .select({
      id: tables.catalogProducts.id,
      groupId: tables.catalogProducts.groupId,
      name: tables.catalogProducts.name,
      category: tables.catalogProducts.category,
      categoryOverride: tables.catalogProducts.categoryOverride,
      marketPrice: tables.catalogProducts.marketPrice,
      printings: tables.catalogProducts.printings,
      // Drives the singles condition curve — vintage LP is worth far less
      // of NM than modern LP, so the set's release year is price-relevant.
      publishedOn: tables.catalogGroups.publishedOn,
    })
    .from(tables.catalogProducts)
    .leftJoin(
      tables.catalogGroups,
      eq(tables.catalogGroups.id, tables.catalogProducts.groupId),
    )
    .where(inArray(tables.catalogProducts.id, productIds));

  const byId = new Map(products.map((p) => [p.id, p]));
  const bonuses = await hotBuyBonuses(shopId, productIds);

  const quotable: {
    product: QuotableProduct;
    quantity: number;
    condition: string | null;
    printing: string | null;
    hotBuyBonus: number;
  }[] = [];
  const manualLines: ManualLine[] = [];

  for (const item of items) {
    const p = byId.get(item.productId);
    if (!p) throw new Error(`Unknown product ${item.productId}`);
    const printings = (p.printings ?? null) as ProductPrinting[] | null;
    const headline = p.marketPrice === null ? null : Number(p.marketPrice);
    const printingPrice = priceForPrinting(printings, item.printing, headline);

    if (item.graded) {
      // Manual quote — never auto-priced.
      manualLines.push({
        productId: p.id,
        productName: p.name,
        printing: item.printing ?? null,
        grader: item.grader ?? null,
        grade: item.grade ?? null,
        quantity: item.quantity,
        refMarketPrice: printingPrice,
        reason: "graded",
      });
      continue;
    }

    // No market price: the feed has no listings for it. For sealed that
    // usually means a scarce vintage box, so hand it to an admin rather than
    // failing the whole quote.
    if (printingPrice === null) {
      const category = (p.categoryOverride ?? p.category) as ProductCategory;
      if (isManualQuoteCandidate(p.name, category, null)) {
        manualLines.push({
          productId: p.id,
          productName: p.name,
          printing: item.printing ?? null,
          grader: null,
          grade: null,
          quantity: item.quantity,
          refMarketPrice: null,
          reason: "unpriced",
        });
        continue;
      }
      throw new Error(`No market price for "${p.name}"`);
    }
    quotable.push({
      product: {
        id: p.id,
        groupId: p.groupId,
        name: p.name,
        category: (p.categoryOverride ?? p.category) as ProductCategory,
        marketPrice: printingPrice,
        releaseYear: p.publishedOn
          ? new Date(p.publishedOn).getUTCFullYear()
          : null,
      },
      quantity: item.quantity,
      condition: item.condition ?? null,
      printing: item.printing ?? null,
      hotBuyBonus: bonuses.get(item.productId) ?? 0,
    });
  }

  if (quotable.length === 0) {
    return { rateType, lines: [], total: 0, manualLines };
  }

  const groupIds = [...new Set(quotable.map((q) => q.product.groupId))];
  const ruleRows = await db
    .select()
    .from(tables.pricingRules)
    .where(
      and(
        eq(tables.pricingRules.shopId, shopId),
        eq(tables.pricingRules.active, true),
        eq(tables.pricingRules.rateType, rateType),
        or(
          inArray(tables.pricingRules.productId, productIds),
          inArray(tables.pricingRules.groupId, groupIds),
          eq(tables.pricingRules.scope, "category"),
        ),
      ),
    );
  const rules: PricingRule[] = ruleRows.map((r) => ({
    id: r.id,
    scope: r.scope,
    rateType: r.rateType,
    category: r.category,
    groupId: r.groupId,
    productId: r.productId,
    percentage: Number(r.percentage),
    flatAmount: r.flatAmount === null ? null : Number(r.flatAmount),
  }));

  const quote = computeQuote(quotable, rules, rateType, settings);
  // Whole-dollar payout: the shop never hands a customer cents, so every
  // trade-in credit/cash line rounds DOWN to the dollar. (computeQuote stays
  // pure/configurable; this is the real-money chokepoint.)
  const lines = quote.lines.map((l) => {
    // Tiered low-value payouts are exact by design ($0.25 etc.) — flooring
    // them to whole dollars would zero them out.
    if (l.tiered) return l;
    const unitCredit = dollarsDown(l.unitCredit);
    return { ...l, unitCredit, lineCredit: unitCredit * l.quantity };
  });
  const total =
    lines.reduce((sum, l) => sum + Math.round(l.lineCredit * 100), 0) / 100;
  return { ...quote, lines, total, manualLines };
}
