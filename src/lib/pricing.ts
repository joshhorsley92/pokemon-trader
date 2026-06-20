/**
 * Pricing engine — the single source of truth for trade-in credit math.
 *
 * Used by BOTH the live quote preview and the submission handler so quotes
 * can never diverge. The client never computes money.
 *
 * Rule resolution, most specific wins (per rate type):
 *   product rule → set rule → category rule → settings.fallback_percentage
 *
 * All money math is done in integer cents to avoid float drift.
 */
import { conditionMultiplier } from "@/lib/conditions";
import type { AppSettings } from "@/lib/settings";

export type RateType = "store_credit" | "cash";
export type ProductCategory = "singles" | "sealed" | "graded";

export type PricingRule = {
  id: string;
  scope: "category" | "set" | "product";
  rateType: RateType;
  category: ProductCategory | null;
  groupId: number | null;
  productId: number | null;
  percentage: number;
  /** Product-scope only: flat $ per unit instead of a market percentage */
  flatAmount: number | null;
};

export type QuotableProduct = {
  id: number;
  groupId: number;
  name: string;
  category: ProductCategory;
  marketPrice: number; // dollars
};

export type QuoteLine = {
  productId: number;
  productName: string;
  /** Chosen printing/edition (subType), echoed for line matching; null = default */
  printing: string | null;
  condition: string | null;
  conditionMultiplier: number;
  quantity: number;
  unitMarketPrice: number;
  appliedPercentage: number;
  appliedRuleId: string | null;
  /** Hot-buy bonus in percentage points, already included in appliedPercentage */
  hotBuyBonus: number;
  unitCredit: number;
  lineCredit: number;
};

export type Quote = {
  rateType: RateType;
  lines: QuoteLine[];
  total: number;
};

/** Round a dollar amount down to the nearest step (e.g. 0.25). */
export function roundToStep(amount: number, step: number): number {
  if (step <= 0) return Math.round(amount * 100) / 100;
  const stepCents = Math.round(step * 100);
  const cents = Math.round(amount * 100);
  return (Math.floor(cents / stepCents) * stepCents) / 100;
}

export type RoundingSettings = {
  rounding_mode: "step" | "nearest_dollar" | "up_dollar";
  rounding_step: number;
};

/**
 * Shop-wide rounding for trade-in credits and cash-outs. Pure — safe for both
 * server quoting and client display.
 */
export function applyRounding(
  amount: number,
  settings: RoundingSettings,
): number {
  switch (settings.rounding_mode) {
    case "nearest_dollar":
      return Math.round(amount);
    case "up_dollar":
      return Math.ceil(amount - 1e-9);
    default:
      return roundToStep(amount, settings.rounding_step);
  }
}

/** Find the most specific active rule for a product. Pure — unit testable. */
export function resolveRule(
  product: Pick<QuotableProduct, "id" | "groupId" | "category">,
  rules: PricingRule[],
  rateType: RateType,
): PricingRule | null {
  const candidates = rules.filter((r) => r.rateType === rateType);
  return (
    candidates.find(
      (r) => r.scope === "product" && r.productId === product.id,
    ) ??
    candidates.find((r) => r.scope === "set" && r.groupId === product.groupId) ??
    candidates.find(
      (r) => r.scope === "category" && r.category === product.category,
    ) ??
    null
  );
}

/** Compute a full quote from in-memory data. Pure — unit testable. */
export function computeQuote(
  items: {
    product: QuotableProduct;
    quantity: number;
    condition?: string | null;
    /** Chosen printing/edition (subType), echoed onto the line for matching */
    printing?: string | null;
    /** Hot-buy bonus in percentage points (e.g. 10 = pay 10 points more of market) */
    hotBuyBonus?: number;
  }[],
  rules: PricingRule[],
  rateType: RateType,
  settings: Pick<
    AppSettings,
    | "rounding_step"
    | "rounding_mode"
    | "fallback_percentage"
    | "condition_multipliers"
  >,
): Quote {
  const lines: QuoteLine[] = items.map(
    ({ product, quantity, condition, printing = null, hotBuyBonus = 0 }) => {
      const rule = resolveRule(product, rules, rateType);
      const multiplier = conditionMultiplier(
        settings.condition_multipliers,
        product.category,
        condition,
      );
      let unitCredit: number;
      let percentage: number;
      if (rule?.flatAmount != null) {
        // Flat per-unit price; condition multipliers still apply, and a
        // hot-buy bonus scales the flat amount. Record the implied
        // percentage so submission snapshots stay meaningful.
        const flat = rule.flatAmount * (1 + hotBuyBonus / 100);
        unitCredit = applyRounding(flat * multiplier, settings);
        percentage =
          product.marketPrice > 0
            ? Math.round((flat / product.marketPrice) * 10000) / 100
            : 0;
      } else {
        const base = rule ? rule.percentage : settings.fallback_percentage;
        percentage = base + hotBuyBonus;
        unitCredit = applyRounding(
          (product.marketPrice * percentage * multiplier) / 100,
          settings,
        );
      }
      const lineCreditCents = Math.round(unitCredit * 100) * quantity;
      return {
        productId: product.id,
        productName: product.name,
        printing,
        condition: condition ?? null,
        conditionMultiplier: multiplier,
        quantity,
        unitMarketPrice: product.marketPrice,
        appliedPercentage: percentage,
        appliedRuleId: rule?.id ?? null,
        hotBuyBonus,
        unitCredit,
        lineCredit: lineCreditCents / 100,
      };
    },
  );
  const totalCents = lines.reduce(
    (sum, l) => sum + Math.round(l.lineCredit * 100),
    0,
  );
  return { rateType, lines, total: totalCents / 100 };
}

/** Format a dollar amount for display/storage in numeric columns. */
export function toMoneyString(amount: number): string {
  return amount.toFixed(2);
}
