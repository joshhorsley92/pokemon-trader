"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ilike } from "drizzle-orm";
import { z } from "zod";
import { db, tables } from "@/db";
import { requireSession } from "@/lib/auth";
import { getCurrentShopId } from "@/lib/tenant";

const itemSchema = z.object({
  title: z.string().min(1).max(300),
  category: z.enum(["singles", "sealed", "graded"]),
  condition: z.string().max(50).nullable(),
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
    quantity: formData.get("quantity"),
    askingPrice: formData.get("askingPrice") ?? "",
    photoUrl: formData.get("photoUrl") ?? "",
    productId: formData.get("productId") ?? "",
    status: formData.get("status") ?? "available",
  });
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
