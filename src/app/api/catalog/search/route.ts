import { NextRequest, NextResponse } from "next/server";
import { and, ilike, or, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { LOW_VALUE_SEALED_PATTERNS } from "@/lib/manual-quote";
import { getSettings } from "@/lib/settings";
import { getCurrentShopId } from "@/lib/tenant";
import { bulkCutoff } from "@/lib/trade-import";

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
  // Narrowing filters: game = TCGplayer categoryId (1 Magic, 3 Pokémon),
  // set = catalog groupId. offset pages through results ("Show more").
  const gameParam = Number(request.nextUrl.searchParams.get("game"));
  const gameId = Number.isInteger(gameParam) && gameParam > 0 ? gameParam : null;
  const setParam = Number(request.nextUrl.searchParams.get("set"));
  const setId = Number.isInteger(setParam) && setParam > 0 ? setParam : null;
  const offsetParam = Number(request.nextUrl.searchParams.get("offset"));
  const offset =
    Number.isInteger(offsetParam) && offsetParam > 0
      ? Math.min(offsetParam, 500)
      : 0;
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
  // Singles are tradeable down to the bottom of the low-value payout ladder
  // (fixed tier payouts fill the gap below min_single_price); only cards
  // under the ladder are bulk-only and count as below-floor.
  const singlesFloor = bulkCutoff(settings);
  // With includeBelow, filter only by category (price floor becomes a flag);
  // otherwise keep the floor as a hard filter.
  const singlesOk = includeBelow
    ? singlesMember
    : sql`(${singlesMember} AND ${tables.catalogProducts.marketPrice} >= ${singlesFloor})`;
  // Sealed with no market price isn't cheap — it's usually unlisted because
  // it's scarce (vintage booster boxes). Surface it as a manual-quote lead
  // rather than hiding it, minus the low-value tail. See lib/manual-quote.ts.
  const notLowValue = sql.join(
    LOW_VALUE_SEALED_PATTERNS.map(
      (p) => sql`${tables.catalogProducts.name} NOT ILIKE ${p}`,
    ),
    sql` AND `,
  );
  const manualQuote = sql<boolean>`(${sealedMember} AND ${tables.catalogProducts.marketPrice} IS NULL AND ${notLowValue})`;
  const sealedOk = includeBelow
    ? sealedMember
    : sql`((${sealedMember} AND ${tables.catalogProducts.marketPrice} >= ${settings.min_item_price}) OR ${manualQuote})`;
  const categoryFilter =
    category === "singles"
      ? singlesOk
      : category === "all"
        ? sql`(${singlesOk} OR ${sealedOk})`
        : sealedOk;

  // The trade-in floor that applies to each row, and whether it's under it.
  // Casts are required: bare bind params inside CASE THEN have no type for
  // Postgres to infer ("could not determine data type of parameter").
  const floor = sql<string>`CASE WHEN ${singlesMember} THEN ${singlesFloor}::numeric ELSE ${settings.min_item_price}::numeric END`;
  const belowFloor = sql<boolean>`(${tables.catalogProducts.marketPrice} < CASE WHEN ${singlesMember} THEN ${singlesFloor}::numeric ELSE ${settings.min_item_price}::numeric END)`;

  const cardNumber = sql<string | null>`(
    SELECT e->>'value' FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(${tables.catalogProducts.extData}) = 'array'
           THEN ${tables.catalogProducts.extData} ELSE '[]'::jsonb END
    ) e WHERE e->>'name' = 'Number' LIMIT 1
  )`;

  const PAGE = 20;
  const rows = await db
    .select({
      id: tables.catalogProducts.id,
      name: tables.catalogProducts.name,
      groupId: tables.catalogProducts.groupId,
      groupName: tables.catalogGroups.name,
      gameId: tables.catalogGroups.categoryId,
      imageUrl: tables.catalogProducts.imageUrl,
      marketPrice: tables.catalogProducts.marketPrice,
      cardNumber,
      category: effectiveCategory,
      printings: tables.catalogProducts.printings,
      floor,
      belowFloor,
      manualQuote,
    })
    .from(tables.catalogProducts)
    .innerJoin(
      tables.catalogGroups,
      sql`${tables.catalogGroups.id} = ${tables.catalogProducts.groupId}`,
    )
    .where(
      and(
        categoryFilter,
        ...(gameId !== null
          ? [sql`${tables.catalogGroups.categoryId} = ${gameId}`]
          : []),
        ...(setId !== null
          ? [sql`${tables.catalogProducts.groupId} = ${setId}`]
          : []),
        // Unpriced rows are allowed through only when they qualify as a
        // manual-quote lead; low-value unpriced junk stays hidden.
        sql`(${tables.catalogProducts.marketPrice} IS NOT NULL OR ${manualQuote})`,
        ...conditions,
      ),
    )
    // Tradeable (above-floor) cards always rank before "below minimum" ones.
    // NULLS LAST keeps manual-quote leads below real priced matches rather
    // than letting Postgres float them to the top of a DESC sort.
    .orderBy(belowFloor, sql`${tables.catalogProducts.marketPrice} DESC NULLS LAST`)
    .offset(offset)
    // One extra row = cheap hasMore probe for the "Show more" button
    .limit(PAGE + 1);

  const hasMore = rows.length > PAGE;
  const results = hasMore ? rows.slice(0, PAGE) : rows;

  return NextResponse.json({
    hasMore,
    results: results.map((r) => ({
      ...r,
      marketPrice: r.marketPrice ? Number(r.marketPrice) : null,
      printings: r.printings ?? [],
      floor: Number(r.floor),
      belowFloor: Boolean(r.belowFloor),
      manualQuote: Boolean(r.manualQuote),
    })),
  });
}
