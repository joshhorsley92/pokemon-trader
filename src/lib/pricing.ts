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
import {
  resolveSinglesMultiplier,
  type ConditionEraKey,
} from "@/lib/condition-curve";
import type { AppSettings } from "@/lib/settings";

export type RateType = "store_credit" | "cash";
export type ProductCategory = "singles" | "sealed" | "graded";

/** Reasons a trade-in line needs a human before it's a binding offer. */
export type ReviewReason = "off_condition" | "high_value";

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
  /**
   * Set release year, from catalog_groups.published_on. Drives the singles
   * condition curve. Null (unknown set / undated group) is treated as the
   * harshest era — never assume a card is modern.
   */
  releaseYear?: number | null;
};

export type QuoteLine = {
  productId: number;
  productName: string;
  /** Chosen printing/edition (subType), echoed for line matching; null = default */
  printing: string | null;
  condition: string | null;
  conditionMultiplier: number;
  /** Which era bucket set the multiplier; null for NM and non-singles. */
  conditionEra: ConditionEraKey | null;
  /**
   * Why (if at all) a human should handle this line before it's binding:
   *   'off_condition' — MP or worse; slow-moving, verify grade in hand
   *   'high_value'    — payout ≥ manual_review_threshold; a team member
   *                     finalizes it (the estimate still stands as a ballpark)
   * Empty = fully auto-quotable.
   */
  reviewReasons: ReviewReason[];
  /** Convenience: reviewReasons.length > 0. */
  requiresReview: boolean;
  quantity: number;
  unitMarketPrice: number;
  appliedPercentage: number;
  appliedRuleId: string | null;
  /** Hot-buy bonus in percentage points, already included in appliedPercentage */
  hotBuyBonus: number;
  /** Fixed low-value ladder payout — exact amount, exempt from dollar flooring */
  tiered: boolean;
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

/** A fixed payout for singles in a market-price band below the floor. */
export type LowValueTier = {
  min: number;
  max: number;
  payout: number;
};

export function findLowValueTier(
  marketPrice: number,
  tiers: LowValueTier[],
): LowValueTier | null {
  return (
    tiers.find((t) => marketPrice >= t.min && marketPrice <= t.max) ?? null
  );
}

/** Lowest market price we'll pay a fixed tier payout for (below = bulk only). */
export function lowestTierMin(tiers: LowValueTier[]): number | null {
  if (tiers.length === 0) return null;
  return Math.min(...tiers.map((t) => t.min));
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
    | "condition_curve"
    | "low_value_tiers"
    | "min_single_price"
    | "manual_review_threshold"
  >,
): Quote {
  const lines: QuoteLine[] = items.map(
    ({ product, quantity, condition, printing = null, hotBuyBonus = 0 }) => {
      const rule = resolveRule(product, rules, rateType);
      // Singles use the age/value curve; sealed and graded keep the flat
      // per-category table (packaging damage doesn't scale with set age).
      const resolved =
        product.category === "singles"
          ? resolveSinglesMultiplier(
              settings.condition_curve,
              condition,
              product.releaseYear ?? null,
              product.marketPrice,
            )
          : {
              multiplier: conditionMultiplier(
                settings.condition_multipliers,
                product.category,
                condition,
              ),
              era: null,
              requiresReview: false,
            };
      const multiplier = resolved.multiplier;

      // Low-value singles ladder: below the floor, fixed payouts win over
      // percentage rules. Exact amounts — no condition multiplier, no
      // rounding, no hot-buy bonus.
      if (
        product.category === "singles" &&
        product.marketPrice < settings.min_single_price
      ) {
        const tier = findLowValueTier(
          product.marketPrice,
          settings.low_value_tiers ?? [],
        );
        if (tier) {
          const unitCredit = Math.round(tier.payout * 100) / 100;
          return {
            productId: product.id,
            productName: product.name,
            printing,
            condition: condition ?? null,
            conditionMultiplier: 1,
            conditionEra: null,
            // Tier payouts are fixed and tiny (never high-value), but
            // off-condition stock is still slow to move — a human confirms
            // it like any other.
            reviewReasons: resolved.requiresReview
              ? (["off_condition"] as ReviewReason[])
              : [],
            requiresReview: resolved.requiresReview,
            quantity,
            unitMarketPrice: product.marketPrice,
            appliedPercentage:
              product.marketPrice > 0
                ? Math.round((unitCredit / product.marketPrice) * 10000) / 100
                : 0,
            appliedRuleId: null,
            hotBuyBonus: 0,
            tiered: true,
            unitCredit,
            lineCredit: (Math.round(unitCredit * 100) * quantity) / 100,
          };
        }
      }

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
      // A payout at/above the threshold is quoted by a team member by hand;
      // the estimate here still stands as the ballpark they start from.
      // Threshold is on the per-unit payout, not the card's market value.
      const highValue =
        settings.manual_review_threshold > 0 &&
        unitCredit >= settings.manual_review_threshold;
      const reviewReasons: ReviewReason[] = [
        ...(resolved.requiresReview ? (["off_condition"] as const) : []),
        ...(highValue ? (["high_value"] as const) : []),
      ];
      return {
        productId: product.id,
        productName: product.name,
        printing,
        condition: condition ?? null,
        conditionMultiplier: multiplier,
        conditionEra: resolved.era,
        reviewReasons,
        requiresReview: reviewReasons.length > 0,
        quantity,
        unitMarketPrice: product.marketPrice,
        appliedPercentage: percentage,
        appliedRuleId: rule?.id ?? null,
        hotBuyBonus,
        tiered: false,
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

// Vendors don't deal in cents. Sell prices (what the customer pays) round UP to
// the next dollar; buy prices (what the shop pays out) round DOWN. Cents are
// normalized first to avoid float drift turning $3.00 into $4.
/** Round a sell price up to the nearest whole dollar. */
export function dollarsUp(amount: number): number {
  return Math.ceil(Math.round(amount * 100) / 100);
}
/** Round a buy/payout price down to the nearest whole dollar. */
export function dollarsDown(amount: number): number {
  return Math.floor(Math.round(amount * 100) / 100);
}
