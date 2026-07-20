import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import type { LowValueTier } from "@/lib/pricing";
import {
  DEFAULT_CONDITION_MULTIPLIERS,
  type ConditionMultipliers,
} from "@/lib/conditions";
import {
  DEFAULT_CONDITION_CURVE,
  type ConditionCurve,
} from "@/lib/condition-curve";
import {
  DEFAULT_ANALYZER_ECONOMICS,
  type AnalyzerEconomics,
} from "@/lib/analyzer/engine";

export type AppSettings = {
  quote_validity_days: number;
  notify_emails: string[];
  /** Round credit amounts to this step, e.g. 0.25 (used when rounding_mode = 'step') */
  rounding_step: number;
  /** 'step' = round down to rounding_step; 'nearest_dollar'; 'up_dollar' */
  rounding_mode: "step" | "nearest_dollar" | "up_dollar";
  /** Used when no pricing rule matches at all */
  fallback_percentage: number;
  /** Hide catalog products below this market price from the public picker */
  min_item_price: number;
  /**
   * Minimum market price for a *single* card to be offered in the public
   * trade builder. Higher than min_item_price so customers can't dump
   * low-value bulk commons on us. Sealed/other categories use min_item_price.
   */
  min_single_price: number;
  /**
   * What we pay customers for singles below the price floor
   * (min_single_price) when they import a list, in dollars PER 1,000 cards
   * (typical range $5–10). Customer-facing — distinct from
   * analyzer_economics.bulk_rate_per_card (our internal bulk cost).
   */
  bulk_rate_per_thousand: number;
  /**
   * Fixed payouts for singles whose market price sits below the floor but
   * above bulk territory, e.g. $2–2.99 market → $0.25 flat. Condition and
   * rounding do NOT apply — the payout is exact. Singles below the lowest
   * tier are bulk-only; at/above min_single_price normal percentage rules
   * take over.
   */
  low_value_tiers: LowValueTier[];
  /** Markup multiplier applied to market price for inventory items without a fixed asking price, e.g. 1.0 = market */
  inventory_market_markup: number;
  /** Shop display name used on public pages and emails */
  shop_name: string;
  /**
   * Credit multiplier per category+condition, e.g. sealed.Great = 0.9.
   * Singles no longer read this — see condition_curve.
   */
  condition_multipliers: ConditionMultipliers;
  /**
   * Age- and value-bucketed condition ladder for SINGLES. Replaces the flat
   * singles entry in condition_multipliers, which overpaid vintage badly.
   */
  condition_curve: ConditionCurve;
  /** Fee/shipping/threshold knobs for the internal buylist analyzer */
  analyzer_economics: AnalyzerEconomics;
};

export const DEFAULT_SETTINGS: AppSettings = {
  quote_validity_days: 7,
  notify_emails: [],
  rounding_step: 0.25,
  rounding_mode: "step",
  fallback_percentage: 50,
  min_item_price: 5,
  min_single_price: 10,
  bulk_rate_per_thousand: 7,
  low_value_tiers: [
    { min: 2, max: 2.99, payout: 0.25 },
    { min: 3, max: 3.99, payout: 0.5 },
    { min: 4, max: 4.99, payout: 0.75 },
    { min: 5, max: 6.99, payout: 1 },
    { min: 7, max: 8.49, payout: 2 },
    { min: 8.5, max: 9.99, payout: 3 },
  ],
  inventory_market_markup: 1.0,
  shop_name: "RareFind TCG Trader",
  condition_multipliers: DEFAULT_CONDITION_MULTIPLIERS,
  condition_curve: DEFAULT_CONDITION_CURVE,
  analyzer_economics: DEFAULT_ANALYZER_ECONOMICS,
};

export async function getSettings(shopId: string): Promise<AppSettings> {
  const rows = await db
    .select()
    .from(tables.shopSettings)
    .where(eq(tables.shopSettings.shopId, shopId));
  const merged: AppSettings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key in merged) {
      (merged as Record<string, unknown>)[row.key] = row.value;
    }
  }
  return merged;
}

export async function setSetting<K extends keyof AppSettings>(
  shopId: string,
  key: K,
  value: AppSettings[K],
): Promise<void> {
  await db
    .insert(tables.shopSettings)
    .values({ shopId, key, value })
    .onConflictDoUpdate({
      target: [tables.shopSettings.shopId, tables.shopSettings.key],
      set: { value },
    });
}
