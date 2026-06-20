"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, tables } from "@/db";
import { requireSession } from "@/lib/auth";

export async function setCategoryOverride(formData: FormData) {
  await requireSession();
  const productId = z.coerce.number().int().parse(formData.get("productId"));
  const raw = String(formData.get("override") ?? "");
  const override =
    raw === "none"
      ? null
      : z.enum(["singles", "sealed", "graded"]).parse(raw);
  await db
    .update(tables.catalogProducts)
    .set({ categoryOverride: override })
    .where(eq(tables.catalogProducts.id, productId));
  revalidatePath("/admin/catalog");
}
