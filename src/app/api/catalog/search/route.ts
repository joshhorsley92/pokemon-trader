import { NextRequest, NextResponse } from "next/server";
import { and, desc, ilike, isNotNull, or, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { getSettings } from "@/lib/settings";
import { getCurrentShopId } from "@/lib/tenant";

/**
 * Public catalog search for the trade builder.
 *   GET /api/catalog/search?q=phantasmal+flames[&category=sealed|singles|all]
 *
 * category defaults to 'sealed' so existing callers (admin product combobox)
 * are unchanged; the public trade builder passes 'all' to surface sealed and
 * singles together. Each category has its own value floor: singles use
 * min_single_price (kept higher to keep bulk commons out), everything else
 * uses min_item_price. The effective category (override-aware) is returned so
 * the UI knows which condition scale to show.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const category = request.nextUrl.searchParams.get("category") ?? "sealed";
  // Public trade builder passes includeBelow=1 to surface sub-floor cards as
  // disabled "below minimum" rows (so the floor is visible) instead of hiding
  // them. Admin callers omit it and keep the clean, floor-filtered list.
  const includeBelow =
    request.nextUrl.searchParams.get("includeBelow") === "1";
  const settings = await getSettings(await getCurrentShopId());

  // Each word must match the card name, the set name, OR the card number —
  // so "Charizard Base Set" or "Iono 185" narrow down instead of returning
  // nothing (the set name and number aren't in the product name).
  const tokens = q.split(/\s+/).filter(Boolean).slice(0, 8);
  const conditions = tokens.map((t) => {
    const like = `%${t}%`;
    return or(
      ilike(tables.catalogProducts.name, like),
      ilike(tables.catalogGroups.name, like),
      sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(${tables.catalogProducts.extData}) = 'array'
               THEN ${tables.catalogProducts.extData} ELSE '[]'::jsonb END
        ) e
        WHERE e->>'name' = 'Number' AND e->>'value' ILIKE ${like}
      )`,
    );
  });

  const effectiveCategory = sql`COALESCE(${tables.catalogProducts.categoryOverride}, ${tables.catalogProducts.category})`;
  const singlesMember = sql`${effectiveCategory} = 'singles'`;
  const sealedMember = sql`${effectiveCategory} = 'sealed'`;
  // With includeBelow, filter only by category (price floor becomes a flag);
  // otherwise keep the floor as a hard filter.
  const singlesOk = includeBelow
    ? singlesMember
    : sql`(${singlesMember} AND ${tables.catalogProducts.marketPrice} >= ${settings.min_single_price})`;
  const sealedOk = includeBelow
    ? sealedMember
    : sql`(${sealedMember} AND ${tables.catalogProducts.marketPrice} >= ${settings.min_item_price})`;
  const categoryFilter =
    category === "singles"
      ? singlesOk
      : category === "all"
        ? sql`(${singlesOk} OR ${sealedOk})`
        : sealedOk;

  // The trade-in floor that applies to each row, and whether it's under it.
  // Casts are required: bare bind params inside CASE THEN have no type for
  // Postgres to infer ("could not determine data type of parameter").
  const floor = sql<string>`CASE WHEN ${singlesMember} THEN ${settings.min_single_price}::numeric ELSE ${settings.min_item_price}::numeric END`;
  const belowFloor = sql<boolean>`(${tables.catalogProducts.marketPrice} < CASE WHEN ${singlesMember} THEN ${settings.min_single_price}::numeric ELSE ${settings.min_item_price}::numeric END)`;

  const results = await db
    .select({
      id: tables.catalogProducts.id,
      name: tables.catalogProducts.name,
      groupId: tables.catalogProducts.groupId,
      groupName: tables.catalogGroups.name,
      imageUrl: tables.catalogProducts.imageUrl,
      marketPrice: tables.catalogProducts.marketPrice,
      category: effectiveCategory,
      printings: tables.catalogProducts.printings,
      floor,
      belowFloor,
    })
    .from(tables.catalogProducts)
    .innerJoin(
      tables.catalogGroups,
      sql`${tables.catalogGroups.id} = ${tables.catalogProducts.groupId}`,
    )
    .where(
      and(
        categoryFilter,
        isNotNull(tables.catalogProducts.marketPrice),
        ...conditions,
      ),
    )
    // Tradeable (above-floor) cards always rank before "below minimum" ones.
    .orderBy(belowFloor, desc(tables.catalogProducts.marketPrice))
    .limit(20);

  return NextResponse.json({
    results: results.map((r) => ({
      ...r,
      marketPrice: r.marketPrice ? Number(r.marketPrice) : null,
      printings: r.printings ?? [],
      floor: Number(r.floor),
      belowFloor: Boolean(r.belowFloor),
    })),
  });
}
