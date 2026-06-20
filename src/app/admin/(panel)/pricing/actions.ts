"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, tables } from "@/db";
import { requireSession } from "@/lib/auth";
import { setSetting } from "@/lib/settings";
import { getCurrentShopId } from "@/lib/tenant";

const targetSchema = z
  .object({
    scope: z.enum(["category", "set", "product"]),
    category: z.enum(["singles", "sealed", "graded"]).nullable(),
    groupId: z.coerce.number().int().positive().nullable(),
    productId: z.coerce.number().int().positive().nullable(),
  })
  .refine(
    (r) =>
      (r.scope === "category" && r.category) ||
      (r.scope === "set" && r.groupId) ||
      (r.scope === "product" && r.productId),
    { message: "Pick what the rule applies to" },
  );

const optionalMoney = z
  .union([z.literal(""), z.coerce.number().min(0).max(1_000_000)])
  .transform((v) => (v === "" ? null : v));

const optionalPercent = z
  .union([z.literal(""), z.coerce.number().min(0).max(200)])
  .transform((v) => (v === "" ? null : v));

export type RuleActionState = { error?: string; success?: boolean };

/** Update-or-insert the active rule for one (target, rateType). */
async function upsertRule(
  shopId: string,
  target: z.infer<typeof targetSchema>,
  rateType: "store_credit" | "cash",
  values: { percentage: number; flatAmount: number | null },
  notes: string | null,
) {
  const category = target.scope === "category" ? target.category : null;
  const groupId = target.scope === "set" ? target.groupId : null;
  const productId = target.scope === "product" ? target.productId : null;
  const where = and(
    eq(tables.pricingRules.shopId, shopId),
    eq(tables.pricingRules.active, true),
    eq(tables.pricingRules.scope, target.scope),
    eq(tables.pricingRules.rateType, rateType),
    category
      ? eq(tables.pricingRules.category, category)
      : isNull(tables.pricingRules.category),
    groupId
      ? eq(tables.pricingRules.groupId, groupId)
      : isNull(tables.pricingRules.groupId),
    productId
      ? eq(tables.pricingRules.productId, productId)
      : isNull(tables.pricingRules.productId),
  );
  const set = {
    percentage: values.percentage.toFixed(2),
    flatAmount:
      values.flatAmount === null ? null : values.flatAmount.toFixed(2),
    notes,
  };
  const updated = await db
    .update(tables.pricingRules)
    .set(set)
    .where(where)
    .returning({ id: tables.pricingRules.id });
  if (updated.length === 0) {
    await db.insert(tables.pricingRules).values({
      shopId,
      scope: target.scope,
      rateType,
      category,
      groupId,
      productId,
      ...set,
    });
  }
}

/**
 * Save a rule for both payout types at once. In percent mode the form sends
 * creditPercent / cashPercent; in flat mode (product scope only) it sends
 * creditFlat / cashFlat. Blank fields skip that payout type.
 */
export async function saveRule(
  _prev: RuleActionState,
  formData: FormData,
): Promise<RuleActionState> {
  await requireSession();
  const shopId = await getCurrentShopId();
  const target = targetSchema.safeParse({
    scope: formData.get("scope"),
    category: formData.get("category") || null,
    groupId: formData.get("groupId") || null,
    productId: formData.get("productId") || null,
  });
  if (!target.success) {
    return { error: target.error.issues[0]?.message ?? "Invalid rule" };
  }
  const mode = formData.get("mode") === "flat" ? "flat" : "percent";
  if (mode === "flat" && target.data.scope !== "product") {
    return { error: "Flat dollar pricing is only for product overrides" };
  }
  const notes = String(formData.get("notes") ?? "").slice(0, 500) || null;

  if (mode === "flat") {
    const credit = optionalMoney.safeParse(formData.get("creditFlat") ?? "");
    const cash = optionalMoney.safeParse(formData.get("cashFlat") ?? "");
    if (!credit.success || !cash.success) {
      return { error: "Invalid dollar amount" };
    }
    if (credit.data === null && cash.data === null) {
      return { error: "Enter at least one dollar amount" };
    }
    if (credit.data !== null) {
      await upsertRule(
        shopId,
        target.data,
        "store_credit",
        { percentage: 0, flatAmount: credit.data },
        notes,
      );
    }
    if (cash.data !== null) {
      await upsertRule(
        shopId,
        target.data,
        "cash",
        { percentage: 0, flatAmount: cash.data },
        notes,
      );
    }
  } else {
    const credit = optionalPercent.safeParse(formData.get("creditPercent") ?? "");
    const cash = optionalPercent.safeParse(formData.get("cashPercent") ?? "");
    if (!credit.success || !cash.success) {
      return { error: "Invalid percentage" };
    }
    if (credit.data === null && cash.data === null) {
      return { error: "Enter at least one percentage" };
    }
    if (credit.data !== null) {
      await upsertRule(
        shopId,
        target.data,
        "store_credit",
        { percentage: credit.data, flatAmount: null },
        notes,
      );
    }
    if (cash.data !== null) {
      await upsertRule(
        shopId,
        target.data,
        "cash",
        { percentage: cash.data, flatAmount: null },
        notes,
      );
    }
  }
  revalidatePath("/admin/pricing");
  return { success: true };
}

/** Inline edit of one rule's value (percentage, or $ for flat rules). */
export async function updateRuleValue(formData: FormData) {
  await requireSession();
  const shopId = await getCurrentShopId();
  const id = String(formData.get("id"));
  const isFlat = formData.get("isFlat") === "1";
  const where = and(
    eq(tables.pricingRules.shopId, shopId),
    eq(tables.pricingRules.id, id),
  );
  if (isFlat) {
    const value = z.coerce
      .number()
      .min(0)
      .max(1_000_000)
      .parse(formData.get("value"));
    await db
      .update(tables.pricingRules)
      .set({ flatAmount: value.toFixed(2) })
      .where(where);
  } else {
    const value = z.coerce.number().min(0).max(200).parse(formData.get("value"));
    await db
      .update(tables.pricingRules)
      .set({ percentage: value.toFixed(2), flatAmount: null })
      .where(where);
  }
  revalidatePath("/admin/pricing");
}

export async function deleteRule(formData: FormData) {
  await requireSession();
  const shopId = await getCurrentShopId();
  const id = String(formData.get("id"));
  // Deactivate rather than delete: submissions reference applied_rule_id.
  await db
    .update(tables.pricingRules)
    .set({ active: false })
    .where(
      and(
        eq(tables.pricingRules.shopId, shopId),
        eq(tables.pricingRules.id, id),
      ),
    );
  revalidatePath("/admin/pricing");
}

/** Shop-wide rounding for credits and cash-outs. */
export async function saveRoundingMode(formData: FormData) {
  await requireSession();
  const shopId = await getCurrentShopId();
  const mode = z
    .enum(["step", "nearest_dollar", "up_dollar"])
    .parse(formData.get("mode"));
  await setSetting(shopId, "rounding_mode", mode);
  revalidatePath("/admin/pricing");
  revalidatePath("/trade");
}
