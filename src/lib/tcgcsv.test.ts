import { describe, expect, it } from "vitest";
import {
  effectiveMarketPrice,
  serializePrintings,
  type TcgcsvPrice,
} from "./tcgcsv";

function price(over: Partial<TcgcsvPrice>): TcgcsvPrice {
  return {
    productId: 1,
    lowPrice: null,
    midPrice: null,
    highPrice: null,
    marketPrice: null,
    directLowPrice: null,
    subTypeName: "Normal",
    ...over,
  };
}

describe("effectiveMarketPrice", () => {
  it("prefers marketPrice, falls back to midPrice", () => {
    expect(effectiveMarketPrice(price({ marketPrice: 5, midPrice: 6 }))).toBe(5);
    expect(effectiveMarketPrice(price({ midPrice: 6 }))).toBe(6);
    expect(effectiveMarketPrice(price({}))).toBeNull();
  });

  it("rejects stale market figures far below the current low ask", () => {
    // Real case: Entei Star market $0.99, low $1,600, mid $2,034.85
    const stale = price({ marketPrice: 0.99, lowPrice: 1600, midPrice: 2034.85 });
    expect(effectiveMarketPrice(stale)).toBe(2034.85);
    // ...even without a mid
    expect(
      effectiveMarketPrice(price({ marketPrice: 0.99, lowPrice: 1600 })),
    ).toBe(1600);
  });

  it("keeps market figures that are merely below low (normal lag)", () => {
    expect(
      effectiveMarketPrice(price({ marketPrice: 9, lowPrice: 12 })),
    ).toBe(9);
    // Penny cards: low under $1 never triggers the guard
    expect(
      effectiveMarketPrice(price({ marketPrice: 0.02, lowPrice: 0.5 })),
    ).toBe(0.02);
  });
});

describe("serializePrintings", () => {
  it("returns each printing with its effective price, headline first", () => {
    // pickPrice prefers Normal; both editions should still be present
    const rows = [
      price({ subTypeName: "1st Edition Holofoil", marketPrice: 131.07, lowPrice: 130 }),
      price({ subTypeName: "Unlimited Holofoil", marketPrice: 60.71, lowPrice: 30.84 }),
      price({ subTypeName: "Normal", marketPrice: 2.5, lowPrice: 2 }),
    ];
    const out = serializePrintings(rows);
    expect(out).toHaveLength(3);
    // Normal is the headline (pickPrice), so it sorts first
    expect(out[0].subType).toBe("Normal");
    expect(out.map((p) => p.subType)).toEqual(
      expect.arrayContaining([
        "1st Edition Holofoil",
        "Unlimited Holofoil",
        "Normal",
      ]),
    );
    const firstEd = out.find((p) => p.subType === "1st Edition Holofoil")!;
    expect(firstEd.market).toBe(131.07);
    expect(firstEd.low).toBe(130);
  });

  it("handles a single printing", () => {
    const out = serializePrintings([
      price({ subTypeName: "Holofoil", marketPrice: 630.39, lowPrice: 534.99 }),
    ]);
    expect(out).toEqual([
      { subType: "Holofoil", market: 630.39, low: 534.99 },
    ]);
  });
});
