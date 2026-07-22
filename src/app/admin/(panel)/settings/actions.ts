"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import type { ConditionMultipliers } from "@/lib/conditions";
import {
  SINGLES_CONDITION_ORDER,
  type ConditionCurve,
} from "@/lib/condition-curve";
import {
  DEFAULT_ANALYZER_ECONOMICS,
  type AnalyzerEconomics,
} from "@/lib/analyzer/engine";
import { getSettings, setSetting } from "@/lib/settings";
import { getCurrentShopId } from "@/lib/tenant";

// Singles conditions the curve prices, worst-to-best excluding NM (always 1).
const CURVE_CONDITIONS = SINGLES_CONDITION_ORDER.filter((c) => c !== "NM");

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
  bulk_rate_per_thousand: z.coerce.number().min(0).max(1000),
  inventory_market_markup: z.coerce.number().min(0.1).max(5),
  manual_review_threshold: z.coerce.number().min(0).max(100_000),
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
    bulk_rate_per_thousand: formData.get("bulk_rate_per_thousand"),
    inventory_market_markup: formData.get("inventory_market_markup"),
    manual_review_threshold: formData.get("manual_review_threshold"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid settings" };
  }

  // Low-value payout tiers: fields named lvt:<index>:min|max|payout.
  // The lvt:present marker distinguishes "no tiers submitted" (older form)
  // from "all tiers deliberately removed".
  let lowValueTiers: { min: number; max: number; payout: number }[] | null =
    null;
  if (formData.get("lvt:present") === "1") {
    const byIndex = new Map<
      number,
      { min?: number; max?: number; payout?: number }
    >();
    for (const [name, raw] of formData.entries()) {
      const match = /^lvt:(\d+):(min|max|payout)$/.exec(name);
      if (!match) continue;
      const idx = Number(match[1]);
      const value = z.coerce.number().min(0).max(100_000).safeParse(raw);
      if (!value.success) {
        return { error: "Invalid tier value" };
      }
      const row = byIndex.get(idx) ?? {};
      row[match[2] as "min" | "max" | "payout"] = value.data;
      byIndex.set(idx, row);
    }
    lowValueTiers = [...byIndex.values()]
      .filter(
        (r): r is { min: number; max: number; payout: number } =>
          r.min !== undefined && r.max !== undefined && r.payout !== undefined,
      )
      .sort((a, b) => a.min - b.min);
    for (const tier of lowValueTiers) {
      if (tier.max < tier.min) {
        return { error: "A tier's 'to' price is below its 'from' price" };
      }
    }
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

  // Singles condition curve: cc:era:<eraKey>:<condition> (ratios),
  // cc:floor, cc:band:maxMarket, cc:band:delta, cc:review. Reconstructed by
  // overlaying edited fields onto the shop's current curve so era boundaries
  // and labels are preserved (only the tunable numbers come from the form).
  const settings = await getSettings(shopId);
  const curve: ConditionCurve = structuredClone(settings.condition_curve);
  let sawCurve = false;
  const ratioSchema = z.coerce.number().min(0).max(2);
  for (const era of curve.eras) {
    era.ratios.NM = 1; // NM is always full value; not user-editable
    for (const cond of CURVE_CONDITIONS) {
      const raw = formData.get(`cc:era:${era.key}:${cond}`);
      if (raw == null) continue;
      const v = ratioSchema.safeParse(raw);
      if (!v.success) {
        return { error: `Invalid curve value for ${era.label} · ${cond}` };
      }
      era.ratios[cond] = v.data;
      sawCurve = true;
    }
  }
  const floorRaw = formData.get("cc:floor");
  if (floorRaw != null) {
    const v = z.coerce.number().min(0).max(1).safeParse(floorRaw);
    if (!v.success) return { error: "Invalid curve floor" };
    curve.floor = v.data;
    sawCurve = true;
  }
  const bandMaxRaw = formData.get("cc:band:maxMarket");
  const bandDeltaRaw = formData.get("cc:band:delta");
  if (bandMaxRaw != null && bandDeltaRaw != null) {
    const maxV = z.coerce.number().min(0).max(100_000).safeParse(bandMaxRaw);
    // Delta only ever discounts — never let the low-value band pay a premium.
    const deltaV = z.coerce.number().min(-1).max(0).safeParse(bandDeltaRaw);
    if (!maxV.success || !deltaV.success) {
      return { error: "Invalid low-value band" };
    }
    // maxMarket 0 or delta 0 = band disabled (no adjustment).
    curve.valueBands =
      maxV.data > 0 && deltaV.data < 0
        ? [{ maxMarket: maxV.data, delta: deltaV.data }]
        : [];
    sawCurve = true;
  }
  const reviewRaw = formData.get("cc:review");
  if (reviewRaw != null) {
    const s = String(reviewRaw);
    if (s !== "none" && !SINGLES_CONDITION_ORDER.includes(s)) {
      return { error: "Invalid manual-review condition" };
    }
    curve.reviewAtOrBelow = s === "none" ? null : s;
    sawCurve = true;
  }

  for (const [key, value] of Object.entries(parsed.data)) {
    await setSetting(shopId, key as keyof typeof parsed.data, value as never);
  }
  if (sawCurve) {
    await setSetting(shopId, "condition_curve", curve);
  }
  if (Object.keys(multipliers).length > 0) {
    await setSetting(shopId, "condition_multipliers", multipliers);
  }
  if (sawEconomics) {
    await setSetting(shopId, "analyzer_economics", economics);
  }
  if (lowValueTiers !== null) {
    await setSetting(shopId, "low_value_tiers", lowValueTiers);
  }
  revalidatePath("/admin/settings");
  revalidatePath("/");
  revalidatePath("/trade");
  return { success: true };
}
