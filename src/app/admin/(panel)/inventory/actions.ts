"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ilike, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db, tables } from "@/db";
import { requireSession } from "@/lib/auth";
import { effectiveInventoryPrice } from "@/lib/inventory";
import { getSettings, setSetting } from "@/lib/settings";
import { getCurrentShopId } from "@/lib/tenant";

// Quick sell-pricing knob: "market + X%". Stored as a multiplier
// (e.g. +3% → 1.03). Negative values discount below market.
const markupPercentSchema = z.coerce.number().min(-90).max(1000);

export async function setInventoryMarkup(formData: FormData): Promise<void> {
  await requireSession();
  const shopId = await getCurrentShopId();
  const pct = markupPercentSchema.parse(formData.get("percent"));
  const multiplier = Math.round((1 + pct / 100) * 1000) / 1000;
  await setSetting(shopId, "inventory_market_markup", multiplier);
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/show");
}

const itemSchema = z.object({
  title: z.string().min(1).max(300),
  category: z.enum(["singles", "sealed", "graded"]),
  condition: z.string().max(50).nullable(),
  printing: z
    .union([z.literal(""), z.string().max(60)])
    .transform((v) => v || null),
  quantity: z.coerce.number().int().min(0).max(9999),
  askingPrice: z
    .union([z.literal(""), z.coerce.number().min(0).max(1_000_000)])
    .transform((v) => (v === "" ? null : v)),
  photoUrl: z.union([z.literal(""), z.string().url()]).transform((v) => v || null),
  productId: z
    .union([z.literal(""), z.coerce.number().int().positive()])
    .transform((v) => (v === "" ? null : v)),
  status: z.enum(["available", "reserved", "sold", "hidden"]),
});

export type ItemActionState = { error?: string; success?: boolean };

function parseItemForm(formData: FormData) {
  return itemSchema.safeParse({
    title: formData.get("title"),
    category: formData.get("category"),
    condition: formData.get("condition") || null,
    printing: formData.get("printing") ?? "",
    quantity: formData.get("quantity"),
    askingPrice: formData.get("askingPrice") ?? "",
    photoUrl: formData.get("photoUrl") ?? "",
    productId: formData.get("productId") ?? "",
    status: formData.get("status") ?? "available",
  });
}

const quickAddSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.coerce.number().int().min(1).max(9999).default(1),
  condition: z.string().max(50).nullish(),
  printing: z.string().max(60).nullish(),
  askingPrice: z.number().min(0).max(1_000_000).nullish(),
});

export type QuickAddState = { error?: string; added?: string };

/**
 * One-shot add from the catalog: everything the product already tells us
 * (title, category) is derived server-side, so the operator only picks a card.
 */
export async function quickAddItem(
  input: z.infer<typeof quickAddSchema>,
): Promise<QuickAddState> {
  await requireSession();
  const shopId = await getCurrentShopId();
  const parsed = quickAddSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid item" };
  const { productId, quantity, condition, printing, askingPrice } = parsed.data;

  const [product] = await db
    .select({
      name: tables.catalogProducts.name,
      category: tables.catalogProducts.category,
      categoryOverride: tables.catalogProducts.categoryOverride,
    })
    .from(tables.catalogProducts)
    .where(eq(tables.catalogProducts.id, productId));
  if (!product) return { error: "Card not found in catalog" };

  const category = product.categoryOverride ?? product.category;
  await db.insert(tables.inventoryItems).values({
    shopId,
    productId,
    title: product.name,
    category,
    // Sealed/graded rows carry no card condition unless one is given.
    condition: condition || null,
    printing: printing || null,
    quantity,
    askingPrice: askingPrice == null ? null : askingPrice.toFixed(2),
    status: "available",
    source: "manual",
  });
  revalidatePath("/admin/inventory");
  return { added: product.name };
}

const setQtySchema = z.object({
  id: z.string().uuid(),
  quantity: z.coerce.number().int().min(0).max(9999),
});

/** Inline quantity edit from the inventory table (+/− buttons). */
export async function setItemQuantity(
  input: z.infer<typeof setQtySchema>,
): Promise<{ error?: string }> {
  await requireSession();
  const shopId = await getCurrentShopId();
  const parsed = setQtySchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid quantity" };
  await db
    .update(tables.inventoryItems)
    .set({ quantity: parsed.data.quantity, updatedAt: new Date() })
    .where(
      and(
        eq(tables.inventoryItems.shopId, shopId),
        eq(tables.inventoryItems.id, parsed.data.id),
      ),
    );
  revalidatePath("/admin/inventory");
  return {};
}

const setPriceSchema = z.object({
  id: z.string().uuid(),
  // null clears the fixed price → back to tracking market.
  askingPrice: z.number().min(0).max(1_000_000).nullable(),
});

/** Inline price edit from the inventory table (sets a fixed asking price). */
export async function setItemPrice(
  input: z.infer<typeof setPriceSchema>,
): Promise<{ error?: string }> {
  await requireSession();
  const shopId = await getCurrentShopId();
  const parsed = setPriceSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid price" };
  await db
    .update(tables.inventoryItems)
    .set({
      askingPrice:
        parsed.data.askingPrice === null
          ? null
          : parsed.data.askingPrice.toFixed(2),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(tables.inventoryItems.shopId, shopId),
        eq(tables.inventoryItems.id, parsed.data.id),
      ),
    );
  revalidatePath("/admin/inventory");
  return {};
}

const bulkPriceSchema = z.object({
  // null = every item; otherwise just the checked rows
  ids: z.array(z.string().uuid()).max(5000).nullable(),
  mode: z.enum(["all", "raise", "lower"]),
});

/**
 * Bulk-align fixed asking prices with the market sell price (market × markup,
 * rounded up to the dollar like every market-tracked item).
 *   all   — CLEAR the fixed price so the item floats with live market pricing
 *   raise — only items priced BELOW market come up to it (price floor;
 *           stays a fixed price so it can't drift back down)
 *   lower — only items priced ABOVE market come down to it (price ceiling;
 *           stays fixed likewise)
 * Market-tracking items (no fixed price) are already at market and untouched.
 */
export async function bulkPriceToMarket(
  input: z.infer<typeof bulkPriceSchema>,
): Promise<{ updated: number; skipped: number; error?: string }> {
  await requireSession();
  const shopId = await getCurrentShopId();
  const parsed = bulkPriceSchema.safeParse(input);
  if (!parsed.success) return { updated: 0, skipped: 0, error: "Invalid request" };
  const { ids, mode } = parsed.data;
  const settings = await getSettings(shopId);

  const rows = await db
    .select({
      id: tables.inventoryItems.id,
      askingPrice: tables.inventoryItems.askingPrice,
      marketPrice: tables.catalogProducts.marketPrice,
    })
    .from(tables.inventoryItems)
    .innerJoin(
      tables.catalogProducts,
      eq(tables.catalogProducts.id, tables.inventoryItems.productId),
    )
    .where(
      and(
        eq(tables.inventoryItems.shopId, shopId),
        isNotNull(tables.inventoryItems.askingPrice),
        isNotNull(tables.catalogProducts.marketPrice),
        ...(ids !== null ? [inArray(tables.inventoryItems.id, ids)] : []),
      ),
    );

  // target null = clear the override (float with market)
  const updates: { id: string; target: number | null }[] = [];
  let skipped = 0;
  for (const row of rows) {
    const current = Number(row.askingPrice);
    const target = effectiveInventoryPrice(
      null,
      Number(row.marketPrice),
      settings.inventory_market_markup,
    )?.price;
    if (target === undefined) {
      skipped++;
      continue;
    }
    if (mode === "all") {
      updates.push({ id: row.id, target: null });
      continue;
    }
    const eligible =
      (mode === "raise" && current < target) ||
      (mode === "lower" && current > target);
    if (!eligible || current === target) {
      skipped++;
      continue;
    }
    updates.push({ id: row.id, target });
  }

  if (updates.length > 0) {
    await db.transaction(async (tx) => {
      for (const u of updates) {
        await tx
          .update(tables.inventoryItems)
          .set({
            askingPrice: u.target === null ? null : u.target.toFixed(2),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(tables.inventoryItems.shopId, shopId),
              eq(tables.inventoryItems.id, u.id),
            ),
          );
      }
    });
  }
  revalidatePath("/admin/inventory");
  return { updated: updates.length, skipped };
}

export async function createItem(
  _prev: ItemActionState,
  formData: FormData,
): Promise<ItemActionState> {
  await requireSession();
  const shopId = await getCurrentShopId();
  const parsed = parseItemForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid item" };
  }
  const v = parsed.data;
  await db.insert(tables.inventoryItems).values({
    shopId,
    title: v.title,
    category: v.category,
    condition: v.condition,
    printing: v.printing,
    quantity: v.quantity,
    askingPrice: v.askingPrice === null ? null : v.askingPrice.toFixed(2),
    photoUrl: v.photoUrl,
    productId: v.productId,
    status: v.status,
    source: "manual",
  });
  revalidatePath("/admin/inventory");
  return { success: true };
}

export async function updateItem(
  _prev: ItemActionState,
  formData: FormData,
): Promise<ItemActionState> {
  await requireSession();
  const shopId = await getCurrentShopId();
  const id = String(formData.get("id"));
  const parsed = parseItemForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid item" };
  }
  const v = parsed.data;
  await db
    .update(tables.inventoryItems)
    .set({
      title: v.title,
      category: v.category,
      condition: v.condition,
      printing: v.printing,
      quantity: v.quantity,
      askingPrice: v.askingPrice === null ? null : v.askingPrice.toFixed(2),
      photoUrl: v.photoUrl,
      productId: v.productId,
      status: v.status,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(tables.inventoryItems.shopId, shopId),
        eq(tables.inventoryItems.id, id),
      ),
    );
  revalidatePath("/admin/inventory");
  return { success: true };
}

export async function deleteItem(formData: FormData) {
  await requireSession();
  const shopId = await getCurrentShopId();
  const id = String(formData.get("id"));
  await db
    .delete(tables.inventoryItems)
    .where(
      and(
        eq(tables.inventoryItems.shopId, shopId),
        eq(tables.inventoryItems.id, id),
      ),
    );
  revalidatePath("/admin/inventory");
}

// ===== CSV import =====

const importRowSchema = z.object({
  title: z.string().min(1).max(300),
  category: z.enum(["singles", "sealed", "graded"]),
  quantity: z.number().int().min(1).max(9999),
  askingPrice: z.number().min(0).max(1_000_000).nullable(),
  condition: z.string().max(50).nullable(),
  raw: z.record(z.string(), z.unknown()),
});

export type ImportRow = z.infer<typeof importRowSchema>;

export type ImportResult = {
  inserted: number;
  matched: number;
  error?: string;
};

/**
 * Bulk-insert reviewed CSV rows. Each row gets a best-effort link to the
 * catalog by exact (case-insensitive) product name so it can track market
 * price; unmatched rows import unlinked and rely on their asking price.
 */
export async function importInventory(rows: ImportRow[]): Promise<ImportResult> {
  await requireSession();
  const shopId = await getCurrentShopId();
  const parsed = z.array(importRowSchema).max(2000).safeParse(rows);
  if (!parsed.success) {
    return { inserted: 0, matched: 0, error: "Invalid import data" };
  }
  let inserted = 0;
  let matched = 0;
  for (const row of parsed.data) {
    const [match] = await db
      .select({ id: tables.catalogProducts.id })
      .from(tables.catalogProducts)
      .where(ilike(tables.catalogProducts.name, row.title.trim()))
      .limit(1);
    if (match) matched++;
    await db.insert(tables.inventoryItems).values({
      shopId,
      title: row.title.trim(),
      category: row.category,
      condition: row.condition,
      quantity: row.quantity,
      askingPrice: row.askingPrice === null ? null : row.askingPrice.toFixed(2),
      productId: match?.id ?? null,
      source: "collectr_csv",
      sourceData: row.raw,
    });
    inserted++;
  }
  revalidatePath("/admin/inventory");
  return { inserted, matched };
}
