/**
 * Projected resale value of a submission — admin-only.
 *
 * Runs the internal buylist analyzer's decision engine over a submission's
 * trade-in lines: for each card, the best of (vendor buylist net, TCGplayer
 * net after fees, bulk) at current prices. DB-only lookups, safe on the
 * request path.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import {
  analyze,
  type AnalyzerItem,
  type AnalyzerSummary,
  type VendorOffer,
} from "@/lib/analyzer/engine";
import { priceForPrinting, type ProductPrinting } from "@/lib/tcgcsv";
import type { AppSettings } from "@/lib/settings";

export type ProjectedInputLine = {
  productId: number;
  productName: string;
  quantity: number;
  condition: string | null;
  printing: string | null;
  graded: boolean;
};

export type ProjectedValue = {
  summary: AnalyzerSummary;
  /** Cash-basis projected revenue: buylist cash + TCG net + bulk */
  projectedRevenue: number;
  /** Graded lines excluded from the projection (custom offers) */
  skippedGraded: number;
};

export async function projectSubmissionValue(
  lines: ProjectedInputLine[],
  settings: AppSettings,
): Promise<ProjectedValue | null> {
  const skippedGraded = lines.filter((l) => l.graded).length;
  const usable = lines.filter((l) => !l.graded);
  if (usable.length === 0) return null;

  const productIds = [...new Set(usable.map((l) => l.productId))];

  const [products, offerRows] = await Promise.all([
    db
      .select({
        id: tables.catalogProducts.id,
        name: tables.catalogProducts.name,
        groupName: tables.catalogGroups.name,
        marketPrice: tables.catalogProducts.marketPrice,
        printings: tables.catalogProducts.printings,
        publishedOn: tables.catalogGroups.publishedOn,
        category: sql<string>`COALESCE(${tables.catalogProducts.categoryOverride}, ${tables.catalogProducts.category})`,
      })
      .from(tables.catalogProducts)
      .innerJoin(
        tables.catalogGroups,
        eq(tables.catalogGroups.id, tables.catalogProducts.groupId),
      )
      .where(inArray(tables.catalogProducts.id, productIds)),
    db
      .select()
      .from(tables.buylistPrices)
      .where(
        and(
          inArray(tables.buylistPrices.productId, productIds),
          eq(tables.buylistPrices.buying, true),
        ),
      ),
  ]);

  const productById = new Map(products.map((p) => [p.id, p]));
  const offersByProduct = new Map<number, VendorOffer[]>();
  for (const row of offerRows) {
    if (row.productId === null) continue;
    const list = offersByProduct.get(row.productId) ?? [];
    list.push({
      vendor: row.vendor,
      cashPrice: row.cashPrice === null ? null : Number(row.cashPrice),
      creditPrice: row.creditPrice === null ? null : Number(row.creditPrice),
      conditionPrices:
        (row.conditionPrices as Record<string, number> | null) ?? null,
      printing: row.printing,
      buying: row.buying,
      url: row.vendorUrl,
    });
    offersByProduct.set(row.productId, list);
  }

  const items: AnalyzerItem[] = usable.map((line) => {
    const product = productById.get(line.productId);
    return {
      productId: line.productId,
      name: line.productName,
      setName: product?.groupName ?? null,
      quantity: line.quantity,
      condition: line.condition,
      // Price against the customer's chosen printing (1st Ed vs Unlimited, holo
      // vs reverse) rather than the headline, so the resale estimate is right.
      marketPrice: priceForPrinting(
        (product?.printings as ProductPrinting[] | null) ?? null,
        line.printing,
        product?.marketPrice == null ? null : Number(product.marketPrice),
      ),
      category:
        product?.category === "sealed" ? ("sealed" as const) : ("singles" as const),
      printing: line.printing,
      // Drives the condition-curve era so played vintage isn't overvalued.
      releaseYear: product?.publishedOn
        ? Number(String(product.publishedOn).slice(0, 4))
        : null,
      tcgplayerId: line.productId,
      offers: offersByProduct.get(line.productId) ?? [],
    };
  });

  const summary = analyze(
    items,
    settings.analyzer_economics,
    settings.condition_multipliers,
    settings.condition_curve,
  );
  const projectedRevenue =
    Math.round(
      (summary.totals.buylistCash + summary.totals.tcgNet + summary.totals.bulk) *
        100,
    ) / 100;

  return { summary, projectedRevenue, skippedGraded };
}
