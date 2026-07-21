/**
 * Customer-facing list import for the trade builder.
 *
 * Reuses the internal analyzer's parsers and catalog matcher, but the output
 * is strictly customer-safe: cart-ready items priced by the normal trade-in
 * rules, plus a bulk lot for singles below the price floor. No vendor
 * buylists, no internal economics.
 */
import { inArray, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { normalizeCondition, parseList } from "@/lib/analyzer/parse";
import { getCatalogIndex } from "@/lib/analyzer/match";
import { findLowValueTier, lowestTierMin } from "@/lib/pricing";
import type { AppSettings } from "@/lib/settings";

/**
 * Singles below this market price are bulk-only. With low-value tiers
 * configured this is the bottom of the ladder (e.g. $2); otherwise the hard
 * floor.
 */
export function bulkCutoff(settings: AppSettings): number {
  return lowestTierMin(settings.low_value_tiers) ?? settings.min_single_price;
}

export type ImportedCartItem = {
  // CatalogHit shape the trade builder cart expects
  product: {
    id: number;
    name: string;
    groupId: number;
    groupName: string;
    imageUrl: string | null;
    marketPrice: number | null;
    cardNumber: string | null;
    category: "singles" | "sealed" | "graded";
    printings: { subType: string; market: number | null; low: number | null }[];
  };
  quantity: number;
  condition: string;
  printing: string | null;
};

export type BulkCard = {
  productId: number;
  name: string;
  setName: string | null;
  quantity: number;
  marketPrice: number | null;
};

export type ImportRejection = { raw: string; reason: string };

export type ListImportResult = {
  regular: ImportedCartItem[];
  bulk: { cards: BulkCard[]; ratePerThousand: number };
  rejected: ImportRejection[];
  parsedCount: number;
  matchedCount: number;
  /** Original list ran past the per-import cap and was trimmed to MAX_LINES. */
  truncatedTo: number | null;
};

/** Cap a single customer import — more than this and they should split it. */
const MAX_LINES = 250;

function defaultCondition(category: string): string {
  return category === "sealed" ? "Perfect" : "NM";
}

/** Pick the printing option matching the parsed hint, if any. */
function resolvePrinting(
  hint: string | null,
  printings: { subType: string }[],
): string | null {
  if (!hint || printings.length === 0) return null;
  const h = hint.toLowerCase();
  const match = printings.find((p) => {
    const s = p.subType.toLowerCase();
    if (h.includes("reverse")) return s.includes("reverse");
    if (h.includes("holo") || h.includes("foil")) {
      return s.includes("holo") && !s.includes("reverse");
    }
    return s === h;
  });
  return match?.subType ?? null;
}

export async function importCustomerList(
  text: string,
  settings: AppSettings,
): Promise<ListImportResult> {
  const allParsed = parseList(text);
  const parsed = allParsed.slice(0, MAX_LINES);
  const truncatedTo = allParsed.length > MAX_LINES ? MAX_LINES : null;
  const index = await getCatalogIndex(db);

  const rejected: ImportRejection[] = [];
  type MatchedLine = {
    raw: string;
    productId: number;
    quantity: number;
    condition: string | null;
    printingHint: string | null;
  };
  const matchedLines: MatchedLine[] = [];

  for (const line of parsed) {
    const match = index.match(line, { allowSealed: true });
    if (!match) {
      rejected.push({ raw: line.raw, reason: "not found in our catalog" });
      continue;
    }
    matchedLines.push({
      raw: line.raw,
      productId: match.entry.id,
      quantity: Math.min(Math.max(line.quantity, 1), 99),
      condition: normalizeCondition(line.condition),
      printingHint: line.printing,
    });
  }

  // Full catalog rows for cart-ready product objects (matcher entries are thin)
  const ids = [...new Set(matchedLines.map((l) => l.productId))];
  const rows = ids.length
    ? await db
        .select({
          id: tables.catalogProducts.id,
          name: tables.catalogProducts.name,
          groupId: tables.catalogProducts.groupId,
          groupName: tables.catalogGroups.name,
          imageUrl: tables.catalogProducts.imageUrl,
          marketPrice: tables.catalogProducts.marketPrice,
          cardNumber: sql<string | null>`(
            SELECT e->>'value' FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(${tables.catalogProducts.extData}) = 'array'
                   THEN ${tables.catalogProducts.extData} ELSE '[]'::jsonb END
            ) e WHERE e->>'name' = 'Number' LIMIT 1
          )`,
          category: sql<string>`COALESCE(${tables.catalogProducts.categoryOverride}, ${tables.catalogProducts.category})`,
          printings: tables.catalogProducts.printings,
        })
        .from(tables.catalogProducts)
        .innerJoin(
          tables.catalogGroups,
          sql`${tables.catalogGroups.id} = ${tables.catalogProducts.groupId}`,
        )
        .where(inArray(tables.catalogProducts.id, ids))
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));

  const regular: ImportedCartItem[] = [];
  const bulkByProduct = new Map<number, BulkCard>();

  for (const line of matchedLines) {
    const row = byId.get(line.productId);
    if (!row) {
      rejected.push({ raw: line.raw, reason: "not found in our catalog" });
      continue;
    }
    const market = row.marketPrice === null ? null : Number(row.marketPrice);
    const category = row.category as "singles" | "sealed" | "graded";
    const floor =
      category === "singles"
        ? settings.min_single_price
        : settings.min_item_price;

    if (market === null) {
      rejected.push({ raw: line.raw, reason: "no current market price" });
      continue;
    }

    if (market < floor) {
      if (category !== "singles") {
        rejected.push({
          raw: line.raw,
          reason: `below our $${floor.toFixed(2)} minimum for sealed items`,
        });
        continue;
      }
      // Singles under the floor: ladder tiers price as regular cart lines
      // (the quote engine pays the fixed tier amount); below the ladder
      // they're bulk.
      const tier = findLowValueTier(market, settings.low_value_tiers);
      if (!tier) {
        const existing = bulkByProduct.get(row.id);
        if (existing) {
          existing.quantity += line.quantity;
        } else {
          bulkByProduct.set(row.id, {
            productId: row.id,
            name: row.name,
            setName: row.groupName,
            quantity: line.quantity,
            marketPrice: market,
          });
        }
        continue;
      }
      // fall through: tiered card becomes a regular item
    }

    const printings = (row.printings ?? []) as {
      subType: string;
      market: number | null;
      low: number | null;
    }[];
    regular.push({
      product: {
        id: row.id,
        name: row.name,
        groupId: row.groupId,
        groupName: row.groupName,
        imageUrl: row.imageUrl,
        marketPrice: market,
        cardNumber: row.cardNumber ?? null,
        category,
        printings,
      },
      quantity: line.quantity,
      condition: line.condition ?? defaultCondition(category),
      printing: resolvePrinting(line.printingHint, printings),
    });
  }

  return {
    regular,
    bulk: {
      cards: [...bulkByProduct.values()],
      ratePerThousand: settings.bulk_rate_per_thousand,
    },
    rejected,
    parsedCount: parsed.length,
    matchedCount: matchedLines.length,
    truncatedTo,
  };
}

/**
 * Server-side validation for submitted bulk items: every card must exist,
 * be a single, and sit below the floor. Returns priced rows or throws.
 */
export async function validateBulkItems(
  items: { productId: number; quantity: number }[],
  settings: AppSettings,
): Promise<
  { productId: number; name: string; quantity: number; marketPrice: number }[]
> {
  if (items.length === 0) return [];
  const ids = items.map((i) => i.productId);
  const rows = await db
    .select({
      id: tables.catalogProducts.id,
      name: tables.catalogProducts.name,
      marketPrice: tables.catalogProducts.marketPrice,
      category: sql<string>`COALESCE(${tables.catalogProducts.categoryOverride}, ${tables.catalogProducts.category})`,
    })
    .from(tables.catalogProducts)
    .where(inArray(tables.catalogProducts.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const cutoff = bulkCutoff(settings);
  return items.map((item) => {
    const row = byId.get(item.productId);
    if (!row) throw new Error(`Unknown bulk product ${item.productId}`);
    const market = row.marketPrice === null ? null : Number(row.marketPrice);
    if (row.category !== "singles" || market === null) {
      throw new Error(`"${row.name}" is not eligible for bulk pricing`);
    }
    if (market >= cutoff) {
      throw new Error(
        `"${row.name}" is above the bulk cutoff — add it as a regular item`,
      );
    }
    return {
      productId: row.id,
      name: row.name,
      quantity: Math.min(Math.max(item.quantity, 1), 999),
      marketPrice: market,
    };
  });
}
