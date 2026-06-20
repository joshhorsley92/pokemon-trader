/**
 * DB-backed quoting: loads products + applicable pricing rules and delegates
 * the math to the pure engine in pricing.ts.
 *
 * Two kinds of trade-in line:
 *  - raw cards — auto-priced. The customer's chosen printing selects which of
 *    the product's per-printing prices to quote against.
 *  - graded slabs — NOT auto-priced (free data can't value slabs). These come
 *    back as `manualLines` for an admin to make a custom offer on; they don't
 *    count toward the quote total.
 */
import { and, eq, inArray, or } from "drizzle-orm";
import { db, tables } from "@/db";
import { hotBuyBonuses } from "@/lib/hot-buys";
import {
  computeQuote,
  type PricingRule,
  type ProductCategory,
  type Quote,
  type QuotableProduct,
  type RateType,
} from "@/lib/pricing";
import type { ProductPrinting } from "@/lib/tcgcsv";
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
};

export type DbQuote = Quote & { manualLines: ManualLine[] };

/** Resolve the market price for a chosen printing, falling back to headline. */
function priceForPrinting(
  printings: ProductPrinting[] | null,
  printing: string | null | undefined,
  headline: number | null,
): number | null {
  if (printing && printings) {
    const match = printings.find((p) => p.subType === printing);
    if (match && match.market !== null) return match.market;
  }
  return headline;
}

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
    })
    .from(tables.catalogProducts)
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
      });
      continue;
    }

    if (printingPrice === null) {
      throw new Error(`No market price for "${p.name}"`);
    }
    quotable.push({
      product: {
        id: p.id,
        groupId: p.groupId,
        name: p.name,
        category: (p.categoryOverride ?? p.category) as ProductCategory,
        marketPrice: printingPrice,
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
  return { ...quote, manualLines };
}
