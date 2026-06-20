import { describe, expect, it } from "vitest";
import {
  analyze,
  adjustOffer,
  DEFAULT_ANALYZER_ECONOMICS,
  netTcgUnit,
  type AnalyzerItem,
  type VendorOffer,
} from "./engine";
import { DEFAULT_CONDITION_MULTIPLIERS } from "@/lib/conditions";

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
