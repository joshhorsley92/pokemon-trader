import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import type { AppSettings } from "@/lib/settings";
import { dollarsUp } from "@/lib/pricing";

export type InventoryListing = {
  id: string;
  title: string;
  category: "singles" | "sealed" | "graded";
  condition: string | null;
  quantity: number;
  price: number; // effective price
  priceSource: "fixed" | "market";
  photoUrl: string | null;
  imageUrl: string | null; // linked catalog image
  status: "available" | "reserved" | "sold" | "hidden";
};

/**
 * Effective sale price for an inventory item: a fixed asking price wins;
 * otherwise the linked catalog product's market price × the configured markup.
 * Returns null when neither is available (unlinked item with no price set).
 */
export function effectiveInventoryPrice(
  askingPrice: number | null,
  marketPrice: number | null,
  markup: number,
): { price: number; source: "fixed" | "market" } | null {
  // Fixed asking prices are the operator's explicit call — left as set. The
  // market-derived sell price rounds UP to the whole dollar (no cents at the
  // table).
  if (askingPrice !== null) return { price: askingPrice, source: "fixed" };
  if (marketPrice !== null) {
    return {
      price: dollarsUp(marketPrice * markup),
      source: "market",
    };
  }
  return null;
}

/** All inventory rows joined with their linked catalog product, priced. */
export async function listInventory(
  shopId: string,
  settings: AppSettings,
  opts: { availableOnly?: boolean } = {},
): Promise<InventoryListing[]> {
  const rows = await db
    .select({
      id: tables.inventoryItems.id,
      title: tables.inventoryItems.title,
      category: tables.inventoryItems.category,
      condition: tables.inventoryItems.condition,
      quantity: tables.inventoryItems.quantity,
      askingPrice: tables.inventoryItems.askingPrice,
      photoUrl: tables.inventoryItems.photoUrl,
      status: tables.inventoryItems.status,
      marketPrice: tables.catalogProducts.marketPrice,
      imageUrl: tables.catalogProducts.imageUrl,
    })
    .from(tables.inventoryItems)
    .leftJoin(
      tables.catalogProducts,
      eq(tables.catalogProducts.id, tables.inventoryItems.productId),
    )
    .where(eq(tables.inventoryItems.shopId, shopId))
    .orderBy(tables.inventoryItems.createdAt);

  const listings: InventoryListing[] = [];
  for (const row of rows) {
    if (opts.availableOnly && (row.status !== "available" || row.quantity < 1)) {
      continue;
    }
    const priced = effectiveInventoryPrice(
      row.askingPrice === null ? null : Number(row.askingPrice),
      row.marketPrice === null ? null : Number(row.marketPrice),
      settings.inventory_market_markup,
    );
    if (opts.availableOnly && !priced) continue; // unpriced items stay admin-only
    listings.push({
      id: row.id,
      title: row.title,
      category: row.category,
      condition: row.condition,
      quantity: row.quantity,
      price: priced?.price ?? 0,
      priceSource: priced?.source ?? "fixed",
      photoUrl: row.photoUrl,
      imageUrl: row.imageUrl,
      status: row.status,
    });
  }
  return listings;
}
