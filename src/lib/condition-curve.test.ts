import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONDITION_CURVE as CURVE,
  requiresManualReview,
  resolveEra,
  resolveSinglesMultiplier,
} from "./condition-curve";
import { computeQuote, type QuotableProduct } from "./pricing";

const settings = {
  condition_curve: CURVE,
  rounding_step: 0.25,
  rounding_mode: "step" as const,
  fallback_percentage: 50,
  min_single_price: 10,
  low_value_tiers: [],
  condition_multipliers: { singles: { LP: 0.85 } },
};

// $100 keeps us clear of the sub-$25 value-band penalty.
function card(releaseYear: number | null, marketPrice = 100): QuotableProduct {
  return {
    id: 1,
    groupId: 1,
    name: "Test Card",
    category: "singles",
    marketPrice,
    releaseYear,
  };
}

describe("resolveEra", () => {
  it("buckets by set release year", () => {
    expect(resolveEra(CURVE, 1999).key).toBe("vintage");
    expect(resolveEra(CURVE, 2003).key).toBe("vintage");
    expect(resolveEra(CURVE, 2004).key).toBe("retro");
    expect(resolveEra(CURVE, 2015).key).toBe("retro");
    expect(resolveEra(CURVE, 2016).key).toBe("modern");
    expect(resolveEra(CURVE, 2025).key).toBe("modern");
  });

  it("treats an unknown year as vintage, never modern", () => {
    // A card with no release date must not be quoted at modern rates.
    expect(resolveEra(CURVE, null).key).toBe("vintage");
    expect(resolveEra(CURVE, undefined).key).toBe("vintage");
  });
});

describe("resolveSinglesMultiplier", () => {
  it("pays vintage well below the flat 0.85 it replaced", () => {
    const r = resolveSinglesMultiplier(CURVE, "LP", 1999, 100);
    expect(r.multiplier).toBe(0.6);
    expect(r.era).toBe("vintage");
  });

  it("separates vintage from modern at the same condition", () => {
    expect(resolveSinglesMultiplier(CURVE, "LP", 1999, 100).multiplier).toBe(
      0.6,
    );
    expect(resolveSinglesMultiplier(CURVE, "LP", 2015, 100).multiplier).toBe(
      0.7,
    );
    expect(resolveSinglesMultiplier(CURVE, "LP", 2024, 100).multiplier).toBe(
      0.85,
    );
  });

  it("never pays more than the curve for a lower condition", () => {
    for (const year of [1999, 2010, 2024]) {
      const ladder = ["NM", "LP", "MP", "HP", "Damaged"].map(
        (c) => resolveSinglesMultiplier(CURVE, c, year, 100).multiplier,
      );
      const sorted = [...ladder].sort((a, b) => b - a);
      expect(ladder).toEqual(sorted);
    }
  });

  it("applies the low-value penalty and never a high-value bonus", () => {
    expect(resolveSinglesMultiplier(CURVE, "LP", 1999, 20).multiplier).toBe(
      0.55,
    );
    expect(resolveSinglesMultiplier(CURVE, "LP", 1999, 500).multiplier).toBe(
      0.6,
    );
  });

  it("floors an unrecognised condition instead of paying full market", () => {
    const r = resolveSinglesMultiplier(CURVE, "Mint-ish", 2024, 100);
    expect(r.multiplier).toBe(CURVE.floor);
    expect(r.requiresReview).toBe(true);
  });

  it("leaves NM at full market", () => {
    expect(resolveSinglesMultiplier(CURVE, "NM", 1999, 100).multiplier).toBe(1);
  });
});

describe("requiresManualReview", () => {
  it("flags MP and worse, leaves NM/LP automatic", () => {
    expect(requiresManualReview(CURVE, "singles", "NM")).toBe(false);
    expect(requiresManualReview(CURVE, "singles", "LP")).toBe(false);
    expect(requiresManualReview(CURVE, "singles", "MP")).toBe(true);
    expect(requiresManualReview(CURVE, "singles", "HP")).toBe(true);
    expect(requiresManualReview(CURVE, "singles", "Damaged")).toBe(true);
  });

  it("does not apply to sealed", () => {
    expect(requiresManualReview(CURVE, "sealed", "Rips/Dents/Tears")).toBe(
      false,
    );
  });
});

describe("computeQuote with the condition curve", () => {
  it("quotes vintage LP far below modern LP for the same market price", () => {
    const q = computeQuote(
      [
        { product: card(1999), quantity: 1, condition: "LP" },
        { product: { ...card(2024), id: 2 }, quantity: 1, condition: "LP" },
      ],
      [],
      "store_credit",
      settings,
    );
    // 50% of $100 market, then the era ratio.
    expect(q.lines[0].unitCredit).toBe(30); // 50 * 0.60
    expect(q.lines[1].unitCredit).toBe(42.5); // 50 * 0.85
    expect(q.lines[0].conditionEra).toBe("vintage");
    expect(q.lines[1].conditionEra).toBe("modern");
  });

  it("marks off-condition singles for review", () => {
    const q = computeQuote(
      [
        { product: card(2024), quantity: 1, condition: "LP" },
        { product: { ...card(2024), id: 2 }, quantity: 1, condition: "MP" },
      ],
      [],
      "store_credit",
      settings,
    );
    expect(q.lines[0].requiresReview).toBe(false);
    expect(q.lines[1].requiresReview).toBe(true);
  });

  it("keeps sealed on the flat table, unaffected by release year", () => {
    const sealed: QuotableProduct = {
      id: 9,
      groupId: 9,
      name: "Vintage Booster Box",
      category: "sealed",
      marketPrice: 100,
      releaseYear: 1999,
    };
    const q = computeQuote(
      [{ product: sealed, quantity: 1, condition: "Great" }],
      [],
      "store_credit",
      { ...settings, condition_multipliers: { sealed: { Great: 0.9 } } },
    );
    expect(q.lines[0].conditionMultiplier).toBe(0.9);
    expect(q.lines[0].conditionEra).toBe(null);
  });
});
