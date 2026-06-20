import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, tables } from "@/db";

export type HotBuyListing = {
  id: string;
  productId: number;
  productName: string;
  groupId: number;
  groupName: string;
  imageUrl: string | null;
  marketPrice: number | null;
  category: "singles" | "sealed" | "graded";
  printings: { subType: string; market: number | null; low: number | null }[];
  bonusPercent: number;
  notes: string | null;
};

/** Active hot buys with product info, for the public showcase and admin list. */
export async function listHotBuys(shopId: string): Promise<HotBuyListing[]> {
  const rows = await db
    .select({
      id: tables.hotBuys.id,
      productId: tables.hotBuys.productId,
      productName: tables.catalogProducts.name,
      groupId: tables.catalogProducts.groupId,
      groupName: tables.catalogGroups.name,
      imageUrl: tables.catalogProducts.imageUrl,
      marketPrice: tables.catalogProducts.marketPrice,
      category: sql<"singles" | "sealed" | "graded">`COALESCE(${tables.catalogProducts.categoryOverride}, ${tables.catalogProducts.category})`,
      printings: tables.catalogProducts.printings,
      bonusPercent: tables.hotBuys.bonusPercent,
      notes: tables.hotBuys.notes,
    })
    .from(tables.hotBuys)
    .innerJoin(
      tables.catalogProducts,
      eq(tables.catalogProducts.id, tables.hotBuys.productId),
    )
    .innerJoin(
      tables.catalogGroups,
      eq(tables.catalogGroups.id, tables.catalogProducts.groupId),
    )
    .where(
      and(
        eq(tables.hotBuys.shopId, shopId),
        eq(tables.hotBuys.active, true),
        isNotNull(tables.catalogProducts.marketPrice),
      ),
    )
    .orderBy(tables.hotBuys.createdAt);

  return rows.map((r) => ({
    ...r,
    marketPrice: r.marketPrice === null ? null : Number(r.marketPrice),
    printings: (r.printings ?? []) as HotBuyListing["printings"],
    bonusPercent: Number(r.bonusPercent),
  }));
}

/** productId → bonus percentage points, for quoting. */
export async function hotBuyBonuses(
  shopId: string,
  productIds: number[],
): Promise<Map<number, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await db
    .select({
      productId: tables.hotBuys.productId,
      bonusPercent: tables.hotBuys.bonusPercent,
    })
    .from(tables.hotBuys)
    .where(
      and(
        eq(tables.hotBuys.shopId, shopId),
        eq(tables.hotBuys.active, true),
        inArray(tables.hotBuys.productId, productIds),
      ),
    );
  return new Map(rows.map((r) => [r.productId, Number(r.bonusPercent)]));
}
