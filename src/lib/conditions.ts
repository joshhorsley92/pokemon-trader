/**
 * Item conditions per category. Sealed uses a packaging scale; singles use
 * the standard TCGplayer card scale (wired up now so phase-2 singles inherit
 * it without schema or engine changes).
 */
import type { ProductCategory } from "@/lib/pricing";

export type ConditionOption = {
  value: string;
  label: string;
  description?: string;
};

export const CONDITIONS: Record<ProductCategory, ConditionOption[]> = {
  sealed: [
    { value: "Perfect", label: "Perfect", description: "Factory fresh, clean packaging" },
    {
      value: "Great",
      label: "Great",
      description: "Loose packaging but no damage",
    },
    {
      value: "Rips/Dents/Tears",
      label: "Rips / Dents / Tears",
      description: "Visible damage to the packaging",
    },
  ],
  singles: [
    { value: "NM", label: "Near Mint" },
    { value: "LP", label: "Lightly Played" },
    { value: "MP", label: "Moderately Played" },
    { value: "HP", label: "Heavily Played" },
    { value: "Damaged", label: "Damaged" },
  ],
  graded: [],
};

/** All valid condition values across categories (for request validation). */
export const ALL_CONDITION_VALUES = Object.values(CONDITIONS)
  .flat()
  .map((c) => c.value);

export function defaultCondition(category: ProductCategory): string | null {
  return CONDITIONS[category][0]?.value ?? null;
}

export type ConditionMultipliers = Partial<
  Record<ProductCategory, Record<string, number>>
>;

export const DEFAULT_CONDITION_MULTIPLIERS: ConditionMultipliers = {
  sealed: {
    Perfect: 1,
    Great: 0.9,
    "Rips/Dents/Tears": 0.75,
  },
  singles: {
    NM: 1,
    LP: 0.85,
    MP: 0.7,
    HP: 0.55,
    Damaged: 0.4,
  },
};

export function conditionMultiplier(
  multipliers: ConditionMultipliers,
  category: ProductCategory,
  condition: string | null | undefined,
): number {
  if (!condition) return 1;
  return multipliers[category]?.[condition] ?? 1;
}
