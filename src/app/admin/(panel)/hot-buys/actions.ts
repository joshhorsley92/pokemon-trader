"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, tables } from "@/db";
import { requireSession } from "@/lib/auth";
import { getCurrentShopId } from "@/lib/tenant";

export type HotBuyActionState = { error?: string; success?: boolean };

export async function addHotBuy(
  _prev: HotBuyActionState,
  formData: FormData,
): Promise<HotBuyActionState> {
  await requireSession();
  const shopId = await getCurrentShopId();
  const parsed = z
    .object({
      productId: z.coerce.number().int().positive(),
      bonusPercent: z.coerce.number().min(0.5).max(100),
      notes: z.string().max(300).optional().default(""),
    })
    .safeParse({
      productId: formData.get("productId"),
      bonusPercent: formData.get("bonusPercent"),
      notes: formData.get("notes") ?? "",
    });
  if (!parsed.success) {
    return { error: "Pick a product and a bonus between 0.5 and 100" };
  }
  const { productId, bonusPercent, notes } = parsed.data;

  // One active hot buy per product: update in place or insert
  const updated = await db
    .update(tables.hotBuys)
    .set({ bonusPercent: bonusPercent.toFixed(2), notes: notes || null })
    .where(
      and(
        eq(tables.hotBuys.shopId, shopId),
        eq(tables.hotBuys.active, true),
        eq(tables.hotBuys.productId, productId),
      ),
    )
    .returning({ id: tables.hotBuys.id });
  if (updated.length === 0) {
    await db.insert(tables.hotBuys).values({
      shopId,
      productId,
      bonusPercent: bonusPercent.toFixed(2),
      notes: notes || null,
    });
  }
  revalidatePath("/admin/hot-buys");
  revalidatePath("/trade");
  return { success: true };
}

export async function updateHotBuyBonus(formData: FormData) {
  await requireSession();
  const shopId = await getCurrentShopId();
  const id = String(formData.get("id"));
  const bonusPercent = z.coerce
    .number()
    .min(0.5)
    .max(100)
    .parse(formData.get("bonusPercent"));
  await db
    .update(tables.hotBuys)
    .set({ bonusPercent: bonusPercent.toFixed(2) })
    .where(and(eq(tables.hotBuys.shopId, shopId), eq(tables.hotBuys.id, id)));
  revalidatePath("/admin/hot-buys");
  revalidatePath("/trade");
}

export async function removeHotBuy(formData: FormData) {
  await requireSession();
  const shopId = await getCurrentShopId();
  const id = String(formData.get("id"));
  await db
    .update(tables.hotBuys)
    .set({ active: false })
    .where(and(eq(tables.hotBuys.shopId, shopId), eq(tables.hotBuys.id, id)));
  revalidatePath("/admin/hot-buys");
  revalidatePath("/trade");
}
