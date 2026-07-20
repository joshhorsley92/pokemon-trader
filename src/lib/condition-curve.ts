/**
 * Age- and value-bucketed condition curve for singles.
 *
 * Replaces the old flat multiplier table, which applied one ladder
 * (LP 0.85 / MP 0.70 / HP 0.55 / DMG 0.40) to every card regardless of era.
 * That badly overpays vintage: measured July 2026 from ~15,600 live
 * TCGplayer listings across 134 products, the real ratio-to-NM is
 *
 *   WOTC 1999-2000 (n=90):  LP 0.63  MP 0.42  HP 0.33  DMG 0.22
 *   Modern 2021-2025 (n=44): LP 0.95  MP 0.67   —        —
 *
 * so a flat 0.85 overpaid vintage LP by ~45% and vintage Damaged by ~82%.
 * The gradient is continuous, not binary — it softens set by set through
 * the 2000s (Base 0.54 → Fossil 0.60 → Gym Heroes 0.65 → Neo 0.71) — hence
 * an era ladder rather than a vintage flag.
 *
 * The shipped numbers sit deliberately BELOW those measurements:
 *
 *  - The measurements are ASK prices, not completed sales. Vintage NM asks
 *    are aspirational (Base Set Charizard NM median ask $1,499 vs $798
 *    market), so the true spread is probably a little narrower than 0.63.
 *    We do not want to be the one absorbing that uncertainty.
 *  - Off-condition stock sells slowly. Modern LP measures 0.95 of NM but is
 *    quoted at 0.85 because holding cost is real and unpriced above.
 *  - Seller-assigned conditions are self-reported and drift optimistic.
 *
 * Every rung is rounded DOWN to a 5% step. When a bucket can't be resolved
 * we fall to the harshest one — an unmapped card must never overpay.
 */
import type { ProductCategory } from "@/lib/pricing";

export type ConditionEraKey = "vintage" | "retro" | "modern";

export type ConditionEra = {
  key: ConditionEraKey;
  label: string;
  /** Inclusive upper bound on set release year; null = everything newer. */
  maxYear: number | null;
  /** Ratio to Near Mint, per singles condition value. */
  ratios: Record<string, number>;
};

export type ConditionCurve = {
  eras: ConditionEra[];
  /**
   * Market-price bands that ADJUST the era ratio. Deltas are only ever
   * negative: measured data shows low-value cards hold condition value
   * worst (vintage LP 0.59 under $50 vs 0.65 over $150), and we decline to
   * pay a premium for the high-value end we're least sure about.
   */
  valueBands: { maxMarket: number; delta: number }[];
  /** Never quote below this ratio, whatever the buckets say. */
  floor: number;
  /**
   * Singles at or below this condition go to manual review instead of an
   * automatic quote — thin, slow-moving stock the engine shouldn't commit
   * money to unattended.
   */
  reviewAtOrBelow: string | null;
};

/** Worst-to-best ordering; index drives the manual-review cutoff. */
export const SINGLES_CONDITION_ORDER = ["Damaged", "HP", "MP", "LP", "NM"];

export const DEFAULT_CONDITION_CURVE: ConditionCurve = {
  eras: [
    {
      key: "vintage",
      label: "Vintage (WOTC, 2003 & earlier)",
      maxYear: 2003,
      // Measured 0.63/0.42/0.33/0.22 → held below it.
      ratios: { NM: 1, LP: 0.6, MP: 0.4, HP: 0.3, Damaged: 0.2 },
    },
    {
      key: "retro",
      label: "Retro (2004-2015)",
      maxYear: 2015,
      // Unmeasured middle. Interpolated toward vintage on purpose.
      ratios: { NM: 1, LP: 0.7, MP: 0.5, HP: 0.35, Damaged: 0.25 },
    },
    {
      key: "modern",
      label: "Modern (2016+)",
      maxYear: null,
      // Measured LP 0.95 → quoted 0.85 to price slow off-condition turnover.
      ratios: { NM: 1, LP: 0.85, MP: 0.65, HP: 0.5, Damaged: 0.3 },
    },
  ],
  valueBands: [{ maxMarket: 25, delta: -0.05 }],
  floor: 0.1,
  reviewAtOrBelow: "MP",
};

/** The era a set release year falls in. Unknown year → harshest era. */
export function resolveEra(
  curve: ConditionCurve,
  releaseYear: number | null | undefined,
): ConditionEra {
  const ordered = [...curve.eras].sort(
    (a, b) => (a.maxYear ?? Infinity) - (b.maxYear ?? Infinity),
  );
  if (releaseYear == null) return ordered[0];
  return (
    ordered.find((e) => e.maxYear === null || releaseYear <= e.maxYear) ??
    ordered[ordered.length - 1]
  );
}

/**
 * True when a singles condition is at or below the manual-review cutoff.
 * Off-condition stock below LP moves slowly enough that a human should set
 * the number.
 */
export function requiresManualReview(
  curve: ConditionCurve,
  category: ProductCategory,
  condition: string | null | undefined,
): boolean {
  if (category !== "singles" || !condition || !curve.reviewAtOrBelow) {
    return false;
  }
  const cutoff = SINGLES_CONDITION_ORDER.indexOf(curve.reviewAtOrBelow);
  const idx = SINGLES_CONDITION_ORDER.indexOf(condition);
  if (cutoff < 0 || idx < 0) return false;
  return idx <= cutoff;
}

export type ConditionResolution = {
  multiplier: number;
  era: ConditionEraKey | null;
  requiresReview: boolean;
};

/**
 * Resolve the condition multiplier for a singles line. Sealed and graded
 * don't use the curve — callers keep passing those through the flat
 * per-category table in `conditions.ts`.
 */
export function resolveSinglesMultiplier(
  curve: ConditionCurve,
  condition: string | null | undefined,
  releaseYear: number | null | undefined,
  marketPrice: number,
): ConditionResolution {
  if (!condition || condition === "NM") {
    return { multiplier: 1, era: null, requiresReview: false };
  }
  const era = resolveEra(curve, releaseYear);
  const base = era.ratios[condition];
  if (base === undefined) {
    // Unknown condition string: don't silently pay full market.
    return {
      multiplier: curve.floor,
      era: era.key,
      requiresReview: true,
    };
  }
  const band = [...curve.valueBands]
    .sort((a, b) => a.maxMarket - b.maxMarket)
    .find((b) => marketPrice <= b.maxMarket);
  const adjusted = base + (band?.delta ?? 0);
  return {
    multiplier: Math.max(curve.floor, Math.round(adjusted * 1000) / 1000),
    era: era.key,
    requiresReview: requiresManualReview(curve, "singles", condition),
  };
}
