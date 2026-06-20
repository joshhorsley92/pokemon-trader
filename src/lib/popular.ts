import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import type { AppSettings } from "@/lib/settings";

export type PopularPick = {
  id: number;
  name: string;
  groupId: number;
  groupName: string;
  imageUrl: string | null;
  marketPrice: number;
  // Always sealed (this picker only surfaces sealed staples), but carried so
  // a pick is assignable to CatalogHit in the trade builder.
  category: "sealed";
  printings: { subType: string; market: number | null; low: number | null }[];
};

/**
 * "Popular picks" for the trade builder: the staple sealed products (ETBs,
 * booster boxes/bundles) from the most recently released sets. Pure
 * heuristic — gives customers an idea of what to trade without searching.
 */
export async function getPopularPicks(
  settings: AppSettings,
  opts: { maxSets?: number; perSet?: number; total?: number } = {},
): Promise<PopularPick[]> {
  const { maxSets = 6, perSet = 2, total = 8 } = opts;

  const rows = await db
    .select({
      id: tables.catalogProducts.id,
      name: tables.catalogProducts.name,
      groupId: tables.catalogProducts.groupId,
      groupName: tables.catalogGroups.name,
      publishedOn: tables.catalogGroups.publishedOn,
      imageUrl: tables.catalogProducts.imageUrl,
      marketPrice: tables.catalogProducts.marketPrice,
      printings: tables.catalogProducts.printings,
    })
    .from(tables.catalogProducts)
    .innerJoin(
      tables.catalogGroups,
      eq(tables.catalogGroups.id, tables.catalogProducts.groupId),
    )
    .where(
      and(
        sql`COALESCE(${tables.catalogProducts.categoryOverride}, ${tables.catalogProducts.category}) = 'sealed'`,
        isNotNull(tables.catalogProducts.marketPrice),
        sql`${tables.catalogProducts.marketPrice} >= ${settings.min_item_price}`,
        sql`${tables.catalogGroups.publishedOn} <= CURRENT_DATE`,
        // The "Miscellaneous Cards & Products" catch-all group is constantly
        // re-dated, so it would otherwise always rank as the newest set.
        sql`${tables.catalogGroups.name} !~* '(miscellaneous|promo)'`,
        sql`${tables.catalogProducts.name} ~* '(elite trainer box|booster box|booster bundle)'`,
        sql`${tables.catalogProducts.name} !~* '(case|carton|exclusive|display)'`,
      ),
    )
    .orderBy(
      desc(tables.catalogGroups.publishedOn),
      desc(tables.catalogProducts.marketPrice),
    )
    .limit(120);

  // Up to `perSet` per set, newest sets first, capped at `total`.
  const picks: PopularPick[] = [];
  const perGroup = new Map<number, number>();
  const groupsUsed = new Set<number>();
  for (const row of rows) {
    if (!groupsUsed.has(row.groupId) && groupsUsed.size >= maxSets) continue;
    const used = perGroup.get(row.groupId) ?? 0;
    if (used >= perSet) continue;
    groupsUsed.add(row.groupId);
    perGroup.set(row.groupId, used + 1);
    picks.push({
      id: row.id,
      name: row.name,
      groupId: row.groupId,
      groupName: row.groupName,
      imageUrl: row.imageUrl,
      marketPrice: Number(row.marketPrice),
      category: "sealed",
      printings: (row.printings ?? []) as PopularPick["printings"],
    });
    if (picks.length >= total) break;
  }
  return picks;
}
