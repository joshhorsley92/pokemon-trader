"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import type { ConditionMultipliers } from "@/lib/conditions";
import {
  DEFAULT_ANALYZER_ECONOMICS,
  type AnalyzerEconomics,
} from "@/lib/analyzer/engine";
import { setSetting } from "@/lib/settings";
import { getCurrentShopId } from "@/lib/tenant";

const settingsSchema = z.object({
  shop_name: z.string().min(1).max(100),
  quote_validity_days: z.coerce.number().int().min(1).max(60),
  notify_emails: z
    .string()
    .transform((s) =>
      s
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().email()).max(5)),
  rounding_step: z.coerce.number().min(0).max(10),
  fallback_percentage: z.coerce.number().min(0).max(200),
  min_item_price: z.coerce.number().min(0).max(10_000),
  min_single_price: z.coerce.number().min(0).max(10_000),
  inventory_market_markup: z.coerce.number().min(0.1).max(5),
});

const multiplierKeySchema = z.tuple([
  z.enum(["sealed", "singles", "graded"]),
  z.string().max(40),
]);

// Per-field ranges for analyzer economics (ae:<key> form fields)
const analyzerFieldSchemas: Record<keyof AnalyzerEconomics, z.ZodType<number>> = {
  tcg_fee_pct: z.coerce.number().min(0).max(50),
  tcg_fixed_per_order: z.coerce.number().min(0).max(10),
  tcg_materials_per_order: z.coerce.number().min(0).max(20),
  tcg_labor_per_order: z.coerce.number().min(0).max(50),
  tcg_cards_per_order: z.coerce.number().min(1).max(100),
  buylist_shipping_flat: z.coerce.number().min(0).max(100),
  buylist_min_offer: z.coerce.number().min(0).max(100),
  bulk_market_threshold: z.coerce.number().min(0).max(100),
  bulk_rate_per_card: z.coerce.number().min(0).max(5),
  high_value_flag: z.coerce.number().min(0).max(100_000),
};

export type SettingsState = { error?: string; success?: boolean };

export async function saveSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  await requireSession();
  const shopId = await getCurrentShopId();
  const parsed = settingsSchema.safeParse({
    shop_name: formData.get("shop_name"),
    quote_validity_days: formData.get("quote_validity_days"),
    notify_emails: formData.get("notify_emails") ?? "",
    rounding_step: formData.get("rounding_step"),
    fallback_percentage: formData.get("fallback_percentage"),
    min_item_price: formData.get("min_item_price"),
    min_single_price: formData.get("min_single_price"),
    inventory_market_markup: formData.get("inventory_market_markup"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid settings" };
  }

  // Condition multiplier fields are named cm:<category>:<condition>
  const multipliers: ConditionMultipliers = {};
  for (const [name, raw] of formData.entries()) {
    if (!name.startsWith("cm:")) continue;
    const parts = name.split(":");
    const key = multiplierKeySchema.safeParse([parts[1], parts.slice(2).join(":")]);
    const value = z.coerce.number().min(0).max(2).safeParse(raw);
    if (!key.success || !value.success) {
      return { error: `Invalid condition multiplier: ${name}` };
    }
    const [category, condition] = key.data;
    (multipliers[category] ??= {})[condition] = value.data;
  }

  // Analyzer economics fields are named ae:<key>
  const economics: AnalyzerEconomics = { ...DEFAULT_ANALYZER_ECONOMICS };
  let sawEconomics = false;
  for (const [name, raw] of formData.entries()) {
    if (!name.startsWith("ae:")) continue;
    const key = name.slice(3) as keyof AnalyzerEconomics;
    const schema = analyzerFieldSchemas[key];
    if (!schema) return { error: `Unknown analyzer setting: ${name}` };
    const value = schema.safeParse(raw);
    if (!value.success) {
      return { error: `Invalid analyzer setting: ${name}` };
    }
    economics[key] = value.data;
    sawEconomics = true;
  }

  for (const [key, value] of Object.entries(parsed.data)) {
    await setSetting(shopId, key as keyof typeof parsed.data, value as never);
  }
  if (Object.keys(multipliers).length > 0) {
    await setSetting(shopId, "condition_multipliers", multipliers);
  }
  if (sawEconomics) {
    await setSetting(shopId, "analyzer_economics", economics);
  }
  revalidatePath("/admin/settings");
  revalidatePath("/");
  revalidatePath("/trade");
  return { success: true };
}
