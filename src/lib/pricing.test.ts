import { describe, expect, it } from "vitest";
import {
  applyRounding,
  computeQuote,
  dollarsDown,
  dollarsUp,
  resolveRule,
  roundToStep,
  type PricingRule,
  type QuotableProduct,
} from "./pricing";

const etb: QuotableProduct = {
  id: 654136,
  groupId: 24448,
  name: "Phantasmal Flames Elite Trainer Box",
  category: "sealed",
  marketPrice: 150.2,
};

const boosterBox: QuotableProduct = {
  id: 111,
  groupId: 999,
  name: "Some Other Booster Box",
  category: "sealed",
  marketPrice: 100,
};

function rule(partial: Partial<PricingRule>): PricingRule {
  return {
    id: partial.id ?? crypto.randomUUID(),
    scope: "category",
    rateType: "store_credit",
    category: null,
    groupId: null,
    productId: null,
    percentage: 50,
    flatAmount: null,
    ...partial,
  };
}

const settings = {
  rounding_step: 0.25,
  rounding_mode: "step" as const,
  fallback_percentage: 50,
  condition_multipliers: {
    sealed: { Perfect: 1, Great: 0.9, "Rips/Dents/Tears": 0.75 },
    singles: { NM: 1, LP: 0.85 },
  },
};

describe("roundToStep", () => {
  it("rounds down to the nearest step", () => {
    expect(roundToStep(127.67, 0.25)).toBe(127.5);
    expect(roundToStep(127.99, 0.25)).toBe(127.75);
    expect(roundToStep(128.0, 0.25)).toBe(128.0);
  });

  it("handles dollar steps", () => {
    expect(roundToStep(127.67, 1)).toBe(127);
  });

  it("falls back to cent rounding for zero step", () => {
    expect(roundToStep(127.678, 0)).toBe(127.68);
  });

  it("avoids float drift", () => {
    expect(roundToStep(0.1 + 0.2, 0.05)).toBe(0.3);
  });
});

describe("whole-dollar deal rounding", () => {
  it("rounds sell prices up to the next dollar", () => {
    expect(dollarsUp(3.01)).toBe(4);
    expect(dollarsUp(3.99)).toBe(4);
    expect(dollarsUp(3.0)).toBe(3); // exact dollar stays
  });
  it("rounds buy prices down to the dollar", () => {
    expect(dollarsDown(3.99)).toBe(3);
    expect(dollarsDown(3.01)).toBe(3);
    expect(dollarsDown(3.0)).toBe(3);
  });
  it("normalizes cents so float drift can't bump a whole dollar", () => {
    expect(dollarsUp(0.1 + 0.2 + 2.7)).toBe(3); // 2.9999... → 3, not 4
    expect(dollarsDown(3.0)).toBe(3);
  });
});

describe("resolveRule precedence", () => {
  const categoryRule = rule({ id: "cat", scope: "category", category: "sealed", percentage: 85 });
  const setRule = rule({ id: "set", scope: "set", groupId: 24448, percentage: 80 });
  const productRule = rule({ id: "prod", scope: "product", productId: 654136, percentage: 75 });

  it("product rule beats set and category", () => {
    expect(resolveRule(etb, [categoryRule, setRule, productRule], "store_credit")?.id).toBe("prod");
  });

  it("set rule beats category", () => {
    expect(resolveRule(etb, [categoryRule, setRule], "store_credit")?.id).toBe("set");
  });

  it("category rule applies when nothing more specific matches", () => {
    expect(resolveRule(boosterBox, [categoryRule, setRule, productRule], "store_credit")?.id).toBe("cat");
  });

  it("returns null when nothing matches", () => {
    const singlesRule = rule({ scope: "category", category: "singles" });
    expect(resolveRule(etb, [singlesRule], "store_credit")).toBeNull();
  });

  it("filters by rate type", () => {
    const cashRule = rule({ id: "cash", scope: "category", category: "sealed", rateType: "cash", percentage: 70 });
    expect(resolveRule(etb, [cashRule], "store_credit")).toBeNull();
    expect(resolveRule(etb, [cashRule], "cash")?.id).toBe("cash");
  });
});

describe("computeQuote", () => {
  it("computes credit with rounding and quantity", () => {
    const sealedRule = rule({ scope: "category", category: "sealed", percentage: 85 });
    const quote = computeQuote(
      [{ product: etb, quantity: 2 }],
      [sealedRule],
      "store_credit",
      settings,
    );
    // 150.20 * 0.85 = 127.67 → rounds to 127.50; ×2 = 255.00
    expect(quote.lines[0].unitCredit).toBe(127.5);
    expect(quote.lines[0].lineCredit).toBe(255.0);
    expect(quote.total).toBe(255.0);
    expect(quote.lines[0].appliedPercentage).toBe(85);
  });

  it("uses fallback percentage when no rule matches", () => {
    const quote = computeQuote(
      [{ product: etb, quantity: 1 }],
      [],
      "store_credit",
      settings,
    );
    // 150.20 * 0.50 = 75.10 → 75.00 at 0.25 step
    expect(quote.lines[0].unitCredit).toBe(75.0);
    expect(quote.lines[0].appliedRuleId).toBeNull();
    expect(quote.lines[0].appliedPercentage).toBe(50);
  });

  it("applies the most specific rule per line independently", () => {
    const categoryRule = rule({ id: "cat", scope: "category", category: "sealed", percentage: 85 });
    const productRule = rule({ id: "prod", scope: "product", productId: 654136, percentage: 90 });
    const quote = computeQuote(
      [
        { product: etb, quantity: 1 },
        { product: boosterBox, quantity: 1 },
      ],
      [categoryRule, productRule],
      "store_credit",
      settings,
    );
    expect(quote.lines[0].appliedRuleId).toBe("prod");
    expect(quote.lines[1].appliedRuleId).toBe("cat");
    // 150.20*0.9=135.18 → 135.00 ; 100*0.85=85.00
    expect(quote.total).toBe(220.0);
  });

  it("returns empty quote for no items", () => {
    const quote = computeQuote([], [], "cash", settings);
    expect(quote.total).toBe(0);
    expect(quote.lines).toHaveLength(0);
  });

  it("applies condition multipliers", () => {
    const sealedRule = rule({ scope: "category", category: "sealed", percentage: 85 });
    const quote = computeQuote(
      [
        { product: etb, quantity: 1, condition: "Perfect" },
        { product: etb, quantity: 1, condition: "Great" },
        { product: etb, quantity: 1, condition: "Rips/Dents/Tears" },
      ],
      [sealedRule],
      "store_credit",
      settings,
    );
    // 150.20 * 0.85 = 127.67 → 127.50
    expect(quote.lines[0].unitCredit).toBe(127.5);
    // 150.20 * 0.85 * 0.9 = 114.903 → 114.75
    expect(quote.lines[1].unitCredit).toBe(114.75);
    expect(quote.lines[1].conditionMultiplier).toBe(0.9);
    // 150.20 * 0.85 * 0.75 = 95.7525 → 95.75
    expect(quote.lines[2].unitCredit).toBe(95.75);
  });

  it("uses a flat dollar amount when the rule has one", () => {
    const flatRule = rule({
      scope: "product",
      productId: 654136,
      percentage: 0,
      flatAmount: 100,
    });
    const quote = computeQuote(
      [
        { product: etb, quantity: 2, condition: "Perfect" },
        { product: etb, quantity: 1, condition: "Great" },
      ],
      [flatRule],
      "store_credit",
      settings,
    );
    expect(quote.lines[0].unitCredit).toBe(100);
    // condition multipliers still apply to flat amounts: 100 × 0.9 = 90
    expect(quote.lines[1].unitCredit).toBe(90);
    // implied percentage recorded: 100 / 150.20 ≈ 66.58%
    expect(quote.lines[0].appliedPercentage).toBeCloseTo(66.58, 1);
    expect(quote.total).toBe(290);
  });

  it("rounds per rounding mode", () => {
    expect(applyRounding(127.67, { rounding_mode: "step", rounding_step: 0.25 })).toBe(127.5);
    expect(applyRounding(127.4, { rounding_mode: "nearest_dollar", rounding_step: 0.25 })).toBe(127);
    expect(applyRounding(127.6, { rounding_mode: "nearest_dollar", rounding_step: 0.25 })).toBe(128);
    expect(applyRounding(127.01, { rounding_mode: "up_dollar", rounding_step: 0.25 })).toBe(128);
    expect(applyRounding(127.0, { rounding_mode: "up_dollar", rounding_step: 0.25 })).toBe(127);
  });

  it("applies up_dollar rounding to quotes", () => {
    const sealedRule = rule({ scope: "category", category: "sealed", percentage: 85 });
    const quote = computeQuote(
      [{ product: etb, quantity: 1 }],
      [sealedRule],
      "store_credit",
      { ...settings, rounding_mode: "up_dollar" },
    );
    // 150.20 * 0.85 = 127.67 → up to 128
    expect(quote.lines[0].unitCredit).toBe(128);
  });

  it("adds hot-buy bonus points to the applied percentage", () => {
    const sealedRule = rule({ scope: "category", category: "sealed", percentage: 85 });
    const quote = computeQuote(
      [
        { product: etb, quantity: 1, condition: "Perfect", hotBuyBonus: 10 },
        { product: etb, quantity: 1, condition: "Great", hotBuyBonus: 10 },
      ],
      [sealedRule],
      "store_credit",
      settings,
    );
    // 150.20 × 0.95 = 142.69 → 142.50
    expect(quote.lines[0].appliedPercentage).toBe(95);
    expect(quote.lines[0].hotBuyBonus).toBe(10);
    expect(quote.lines[0].unitCredit).toBe(142.5);
    // condition multiplier still applies: 150.20 × 0.95 × 0.9 = 128.421 → 128.25
    expect(quote.lines[1].unitCredit).toBe(128.25);
  });

  it("scales flat amounts by the hot-buy bonus", () => {
    const flatRule = rule({
      scope: "product",
      productId: 654136,
      percentage: 0,
      flatAmount: 100,
    });
    const quote = computeQuote(
      [{ product: etb, quantity: 1, condition: "Perfect", hotBuyBonus: 10 }],
      [flatRule],
      "store_credit",
      settings,
    );
    // 100 × 1.10 = 110
    expect(quote.lines[0].unitCredit).toBe(110);
  });

  it("treats unknown or missing conditions as full value", () => {
    const quote = computeQuote(
      [
        { product: etb, quantity: 1 },
        { product: etb, quantity: 1, condition: "Mystery" },
      ],
      [],
      "store_credit",
      settings,
    );
    expect(quote.lines[0].conditionMultiplier).toBe(1);
    expect(quote.lines[1].conditionMultiplier).toBe(1);
  });
});
