import { describe, expect, it } from "vitest";
import {
  analyze,
  adjustOffer,
  DEFAULT_ANALYZER_ECONOMICS,
  netTcgUnit,
  offerMatchesPrinting,
  printingBucket,
  type AnalyzerItem,
  type VendorOffer,
} from "./engine";
import { DEFAULT_CONDITION_MULTIPLIERS } from "@/lib/conditions";
import { DEFAULT_CONDITION_CURVE } from "@/lib/condition-curve";

const eco = { ...DEFAULT_ANALYZER_ECONOMICS };
const mult = DEFAULT_CONDITION_MULTIPLIERS;

function item(over: Partial<AnalyzerItem>): AnalyzerItem {
  return {
    productId: 1,
    name: "Test Card",
    quantity: 1,
    condition: "NM",
    marketPrice: 10,
    offers: [],
    ...over,
  };
}

function offer(over: Partial<VendorOffer>): VendorOffer {
  return {
    vendor: "card_cavern",
    cashPrice: 5,
    creditPrice: 5.75,
    buying: true,
    ...over,
  };
}

describe("netTcgUnit", () => {
  it("subtracts percentage fee and per-order overhead", () => {
    // $10 sale: fee 13.85% = $1.385 -> $1.39; overhead 0.30+1.00+0.50 = $1.80
    expect(netTcgUnit(10, "NM", eco, mult)).toBeCloseTo(10 - 1.39 - 1.8, 2);
  });

  it("applies condition multiplier to the sale price", () => {
    const nm = netTcgUnit(10, "NM", eco, mult);
    const lp = netTcgUnit(10, "LP", eco, mult);
    expect(lp).toBeLessThan(nm);
  });

  it("splits per-order overhead across cards per order", () => {
    const solo = netTcgUnit(10, "NM", eco, mult);
    const bundled = netTcgUnit(10, "NM", { ...eco, tcg_cards_per_order: 4 }, mult);
    expect(bundled).toBeGreaterThan(solo);
  });
});

describe("adjustOffer", () => {
  it("uses the vendor's published condition ladder when present", () => {
    const o = offer({
      cashPrice: 2.51,
      conditionPrices: { NM: 2.51, LP: 2.26, MP: 1.76, HP: 1.51 },
    });
    expect(adjustOffer(o, "LP", mult).cash).toBe(2.26);
  });

  it("estimates with our multipliers when no ladder exists", () => {
    const o = offer({ cashPrice: 10, creditPrice: 13 });
    const adj = adjustOffer(o, "MP", mult); // singles MP = 0.7
    expect(adj.cash).toBeCloseTo(7, 2);
    expect(adj.credit).toBeCloseTo(9.1, 2);
  });

  it("treats null condition as NM", () => {
    const o = offer({ cashPrice: 10 });
    expect(adjustOffer(o, null, mult).cash).toBe(10);
  });
});

describe("analyze decisions", () => {
  it("picks BUYLIST when the buylist net beats TCG net", () => {
    // Market $10 -> TCG net ~$6.92. Offer $9 cash, batch big enough that
    // shipping share is negligible.
    const items = Array.from({ length: 10 }, (_, i) =>
      item({ productId: i + 1, offers: [offer({ cashPrice: 9 })] }),
    );
    const out = analyze(items, eco, mult);
    expect(out.results.every((r) => r.decision === "BUYLIST")).toBe(true);
    expect(out.totals.buylistCash).toBeCloseTo(90, 2);
  });

  it("picks TCG when market sale nets more than the best offer", () => {
    const out = analyze(
      [item({ marketPrice: 50, offers: [offer({ cashPrice: 20 })] })],
      eco,
      mult,
    );
    expect(out.results[0].decision).toBe("TCG");
    expect(out.results[0].netTcg).toBeGreaterThan(40);
  });

  it("sends sub-threshold cards with no offers to BULK", () => {
    const out = analyze([item({ marketPrice: 0.15, offers: [] })], eco, mult);
    expect(out.results[0].decision).toBe("BULK");
  });

  it("ignores offers below buylist_min_offer", () => {
    const out = analyze(
      [item({ marketPrice: 0.2, offers: [offer({ cashPrice: 0.05 })] })],
      eco,
      mult,
    );
    expect(out.results[0].bestOffer).toBeNull();
    expect(out.results[0].decision).toBe("BULK");
  });

  it("drops a lone cheap card from a buylist batch once shipping eats it", () => {
    // One $3 offer vs $5 flat shipping: net -$2, so TCG (market $4 nets ~$1.39).
    const out = analyze(
      [item({ marketPrice: 4, offers: [offer({ cashPrice: 3 })] })],
      eco,
      mult,
    );
    expect(out.results[0].decision).toBe("TCG");
  });

  it("keeps the same card on BUYLIST when batch-mates absorb shipping", () => {
    const anchor = item({
      productId: 99,
      marketPrice: 30,
      offers: [offer({ cashPrice: 28 })],
    });
    const cheap = item({ marketPrice: 4, offers: [offer({ cashPrice: 3 })] });
    const out = analyze([anchor, cheap], eco, mult);
    const cheapResult = out.results.find((r) => r.item === cheap)!;
    expect(cheapResult.decision).toBe("BUYLIST");
  });

  it("picks the best vendor per card and batches by vendor", () => {
    const out = analyze(
      [
        item({
          marketPrice: 10,
          quantity: 4,
          offers: [
            offer({ vendor: "card_cavern", cashPrice: 7 }),
            offer({ vendor: "full_grip", cashPrice: 9 }),
          ],
        }),
      ],
      eco,
      mult,
    );
    expect(out.results[0].bestOffer?.vendor).toBe("full_grip");
    expect(out.vendorBatches.full_grip.cards).toBe(4);
    expect(out.vendorBatches.card_cavern).toBeUndefined();
  });

  it("skips vendors flagged as not buying", () => {
    const out = analyze(
      [
        item({
          marketPrice: 10,
          offers: [offer({ cashPrice: 9, buying: false })],
        }),
      ],
      eco,
      mult,
    );
    expect(out.results[0].bestOffer).toBeNull();
  });

  it("never sends sealed product to bulk", () => {
    const out = analyze(
      [
        // Cheap sealed item below the bulk threshold — still a sale, not bulk
        item({ marketPrice: 0.2, category: "sealed", offers: [] }),
        item({ marketPrice: 65, category: "sealed", offers: [] }),
      ],
      eco,
      mult,
    );
    expect(out.results[0].decision).toBe("TCG");
    expect(out.results[1].decision).toBe("TCG");
    expect(out.results[1].flags).toContain("sealed");
  });

  it("flags unmatched and high-value items", () => {
    const out = analyze(
      [
        item({ productId: null, marketPrice: null, offers: [] }),
        item({ marketPrice: 120, offers: [] }),
      ],
      eco,
      mult,
    );
    expect(out.results[0].flags).toContain("unmatched");
    expect(out.results[0].flags).toContain("no market price");
    expect(out.results[1].flags).toContain("high value — verify");
  });

  it("multiplies totals by quantity", () => {
    const out = analyze(
      [
        item({
          marketPrice: 10,
          quantity: 5,
          offers: [offer({ cashPrice: 9, creditPrice: 10.35 })],
        }),
      ],
      eco,
      mult,
    );
    expect(out.totals.buylistCash).toBeCloseTo(45, 2);
    expect(out.totals.buylistCredit).toBeCloseTo(51.75, 2);
    expect(out.totals.cards).toBe(5);
  });
});

describe("printing-aware buylist offers", () => {
  it("buckets vendor and catalog printing labels to comparable values", () => {
    expect(printingBucket("Reverse Holofoil")).toBe("reverse");
    expect(printingBucket("Reverse Foil")).toBe("reverse");
    expect(printingBucket("Holofoil")).toBe("holo");
    expect(printingBucket("Holo")).toBe("holo");
    expect(printingBucket("1st Edition Holofoil")).toBe("holo");
    expect(printingBucket("Normal")).toBe("normal");
    expect(printingBucket("NON-HOLO")).toBe("normal");
    expect(printingBucket(null)).toBeNull();
    // Distinct specials stay distinct
    expect(printingBucket("Master Ball Foil")).not.toBe(
      printingBucket("Poke Ball Foil"),
    );
  });

  it("keeps offers the vendor didn't label, or when our printing is unknown", () => {
    expect(offerMatchesPrinting(null, "Normal")).toBe(true);
    expect(offerMatchesPrinting("Reverse Foil", null)).toBe(true);
  });

  it("rejects an offer for a different printing", () => {
    expect(offerMatchesPrinting("Reverse Foil", "Normal")).toBe(false);
    expect(offerMatchesPrinting("Holo", "Normal")).toBe(false);
    expect(offerMatchesPrinting("Reverse Foil", "Reverse Holofoil")).toBe(true);
  });

  it("prices a Normal card off the Normal offer, not the Reverse Holo one", () => {
    // Real case: CoolStuff pays $10 for Exeggcute (76) Reverse Foil but only
    // $0.50 for the Normal. Matching on product id alone used the $10.
    const out = analyze(
      [
        item({
          printing: "Normal",
          marketPrice: 2.33,
          offers: [
            offer({ vendor: "coolstuff", printing: "Reverse Foil", cashPrice: 10, creditPrice: 12.5 }),
            offer({ vendor: "coolstuff", printing: null, cashPrice: 0.5, creditPrice: 0.63 }),
          ],
        }),
      ],
      eco,
      mult,
    );
    expect(out.results[0].bestOffer?.cash).toBeCloseTo(0.5, 2);
  });
});

describe("era condition curve in the analyzer", () => {
  const vintage = (condition: string, releaseYear = 1999) =>
    item({ condition, releaseYear, marketPrice: 8.88, category: "singles" });

  it("prices played vintage off the era curve, not the flat ladder", () => {
    // Real case: Electrode (Base Set 1999), NM market $8.88. The flat ladder
    // valued MP at 0.70 -> $6.22; TCGplayer's actual MP sits at ~$2.78-2.86.
    const flat = analyze([vintage("MP")], eco, mult);
    const curved = analyze([vintage("MP")], eco, mult, DEFAULT_CONDITION_CURVE);
    expect(flat.results[0].estSalePrice).toBeCloseTo(6.22, 2);
    expect(curved.results[0].estSalePrice).toBeCloseTo(3.11, 2);
  });

  it("keeps the era gradient — modern holds condition value better", () => {
    const est = (year: number) =>
      analyze([vintage("MP", year)], eco, mult, DEFAULT_CONDITION_CURVE)
        .results[0].estSalePrice!;
    expect(est(1999)).toBeLessThan(est(2010));
    expect(est(2010)).toBeLessThan(est(2024));
  });

  it("discounts vendor buylist offers on the same curve", () => {
    const withOffer = {
      ...vintage("MP"),
      offers: [offer({ vendor: "coolstuff", cashPrice: 10, creditPrice: 12.5 })],
    };
    const flat = analyze([withOffer], eco, mult);
    const curved = analyze([withOffer], eco, mult, DEFAULT_CONDITION_CURVE);
    expect(flat.results[0].bestOffer?.cash).toBeCloseTo(7, 2); // 10 * 0.70
    expect(curved.results[0].bestOffer?.cash).toBeCloseTo(3.5, 2); // 10 * 0.35
  });

  it("leaves NM untouched", () => {
    const curved = analyze([vintage("NM")], eco, mult, DEFAULT_CONDITION_CURVE);
    expect(curved.results[0].estSalePrice).toBeCloseTo(8.88, 2);
  });
});

describe("sale estimate capped at the lowest live listing", () => {
  const card = (over: Partial<AnalyzerItem>) =>
    item({ category: "singles", releaseYear: 1999, ...over });

  it("uses the low ask when market sits above it", () => {
    // Real case: Chansey (Base Set) market $65.45 but the cheapest live
    // listing is $20.99 — you can't sell above the competition.
    const out = analyze(
      [card({ condition: "LP", marketPrice: 65.45, lowPrice: 20.99 })],
      eco,
      mult,
      DEFAULT_CONDITION_CURVE,
    );
    expect(out.results[0].estSalePrice).toBeCloseTo(20.99, 2);
  });

  it("uses the condition-adjusted market when it is the lower of the two", () => {
    // Rising market: low ask above market -> market wins, still the minimum.
    const out = analyze(
      [card({ condition: "NM", marketPrice: 10, lowPrice: 14, releaseYear: 2024 })],
      eco,
      mult,
      DEFAULT_CONDITION_CURVE,
    );
    expect(out.results[0].estSalePrice).toBeCloseTo(10, 2);
  });

  it("falls back to market x condition when there is no low price", () => {
    const out = analyze(
      [card({ condition: "MP", marketPrice: 100, lowPrice: null, releaseYear: 2024 })],
      eco,
      mult,
      DEFAULT_CONDITION_CURVE,
    );
    expect(out.results[0].estSalePrice).toBeCloseTo(65, 2); // modern MP 0.65
  });

  it("keeps the TCG net consistent with the capped sale price", () => {
    const out = analyze(
      [card({ condition: "LP", marketPrice: 65.45, lowPrice: 20.99 })],
      eco,
      mult,
      DEFAULT_CONDITION_CURVE,
    );
    const r = out.results[0];
    // Net is fees/overhead off the capped sale price, never off raw market.
    expect(r.netTcg!).toBeLessThan(r.estSalePrice!);
    expect(r.netTcg!).toBeGreaterThan(0);
  });
});

describe("real per-condition prices override every estimate", () => {
  // Live JustTCG data for Chansey (Base Set, productId 42371), Holofoil.
  const CHANSEY = { NM: 65.45, LP: 25.8, MP: 15.64, HP: 9.24, Damaged: 7.93 };
  const chansey = (condition: string) =>
    item({
      condition,
      category: "singles",
      releaseYear: 1999,
      marketPrice: 65.45,
      lowPrice: 20.99,
      printing: "Holofoil",
      conditionLadder: CHANSEY,
    });

  it("prices straight off the ladder, ignoring curve and low-ask cap", () => {
    for (const [condition, expected] of Object.entries(CHANSEY)) {
      const out = analyze([chansey(condition)], eco, mult, DEFAULT_CONDITION_CURVE);
      expect(out.results[0].estSalePrice).toBeCloseTo(expected, 2);
    }
  });

  it("fixes the NM undervaluation the low-ask cap caused", () => {
    const capped = analyze(
      [{ ...chansey("NM"), conditionLadder: null }],
      eco,
      mult,
      DEFAULT_CONDITION_CURVE,
    );
    const real = analyze([chansey("NM")], eco, mult, DEFAULT_CONDITION_CURVE);
    expect(capped.results[0].estSalePrice).toBeCloseTo(20.99, 2);
    expect(real.results[0].estSalePrice).toBeCloseTo(65.45, 2);
  });

  it("discounts vendor offers by the measured ratio, not the curve", () => {
    // Real MP/NM = 15.64/65.45 = 0.239; the vintage curve would say 0.35.
    const withOffer = {
      ...chansey("MP"),
      offers: [offer({ vendor: "coolstuff", cashPrice: 20, creditPrice: 25 })],
    };
    const out = analyze([withOffer], eco, mult, DEFAULT_CONDITION_CURVE);
    expect(out.results[0].bestOffer?.cash).toBeCloseTo(20 * (15.64 / 65.45), 1);
  });

  it("falls back to the estimate when a card has no ladder", () => {
    const out = analyze(
      [{ ...chansey("MP"), conditionLadder: null }],
      eco,
      mult,
      DEFAULT_CONDITION_CURVE,
    );
    expect(out.results[0].estSalePrice).toBeCloseTo(20.99, 2);
  });
});
