import { NextRequest, NextResponse } from "next/server";
import { and, desc, ilike, isNotNull, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireSession } from "@/lib/auth";

/**
 * Admin-only singles search for the analyzer's manual-add box.
 * GET /api/analyzer/search?q=charizard+ex
 */
export async function GET(request: NextRequest) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ results: [] });

  const tokens = q.split(/\s+/).filter(Boolean).slice(0, 8);
  const results = await db
    .select({
      id: tables.catalogProducts.id,
      name: tables.catalogProducts.name,
      groupName: tables.catalogGroups.name,
      imageUrl: tables.catalogProducts.imageUrl,
      marketPrice: tables.catalogProducts.marketPrice,
    })
    .from(tables.catalogProducts)
    .innerJoin(
      tables.catalogGroups,
      sql`${tables.catalogGroups.id} = ${tables.catalogProducts.groupId}`,
    )
    .where(
      and(
        sql`COALESCE(${tables.catalogProducts.categoryOverride}, ${tables.catalogProducts.category}) = 'singles'`,
        isNotNull(tables.catalogProducts.marketPrice),
        ...tokens.map((t) => ilike(tables.catalogProducts.name, `%${t}%`)),
      ),
    )
    .orderBy(desc(tables.catalogProducts.marketPrice))
    .limit(20);

  return NextResponse.json({
    results: results.map((r) => ({
      ...r,
      marketPrice: r.marketPrice ? Number(r.marketPrice) : null,
    })),
  });
}
