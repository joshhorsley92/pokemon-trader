import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import {
  DEFAULT_CONDITION_MULTIPLIERS,
  type ConditionMultipliers,
} from "@/lib/conditions";
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
  /** Markup multiplier applied to market price for inventory items without a fixed asking price, e.g. 1.0 = market */
  inventory_market_markup: number;
  /** Shop display name used on public pages and emails */
  shop_name: string;
  /** Credit multiplier per category+condition, e.g. sealed.Great = 0.9 */
  condition_multipliers: ConditionMultipliers;
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
  inventory_market_markup: 1.0,
  shop_name: "Pokémon Trader",
  condition_multipliers: DEFAULT_CONDITION_MULTIPLIERS,
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
