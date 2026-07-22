import { NextRequest, NextResponse } from "next/server";
import { and, desc, ilike, sql } from "drizzle-orm";
import { db, tables } from "@/db";

/**
 * Set autocomplete for the trade builder's filter row.
 *   GET /api/catalog/sets?q=obsidian[&game=3]
 * Returns newest-first; empty q lists the most recent sets so the picker has
 * content before the customer types.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const gameParam = Number(request.nextUrl.searchParams.get("game"));
  const gameId = Number.isInteger(gameParam) && gameParam > 0 ? gameParam : null;

  const tokens = q.split(/\s+/).filter(Boolean).slice(0, 6);
  const results = await db
    .select({
      id: tables.catalogGroups.id,
      name: tables.catalogGroups.name,
      gameId: tables.catalogGroups.categoryId,
    })
    .from(tables.catalogGroups)
    .where(
      and(
        ...(gameId !== null
          ? [sql`${tables.catalogGroups.categoryId} = ${gameId}`]
          : []),
        ...tokens.map((t) => ilike(tables.catalogGroups.name, `%${t}%`)),
        // Only sets that actually have something tradeable
        sql`EXISTS (
          SELECT 1 FROM catalog_products cp
          WHERE cp.group_id = ${tables.catalogGroups.id}
            AND cp.market_price IS NOT NULL
        )`,
      ),
    )
    .orderBy(desc(tables.catalogGroups.publishedOn))
    .limit(15);

  return NextResponse.json({ results });
}
