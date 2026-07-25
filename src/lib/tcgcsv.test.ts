import { describe, expect, it } from "vitest";
import {
  effectiveMarketPrice,
  pickPrice,
  priceForPrinting,
  resolvePrinting,
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

describe("pickPrice", () => {
  it("prefers Normal, then Holofoil", () => {
    const rows = [
      price({ subTypeName: "Reverse Holofoil", marketPrice: 3.5 }),
      price({ subTypeName: "Normal", marketPrice: 0.25 }),
    ];
    expect(pickPrice(rows)?.subTypeName).toBe("Normal");
  });

  it("headlines Unlimited, never 1st Edition, on vintage holos", () => {
    // Real data: Base Set (Shadowless) Charizard. Neither row is
    // Normal/Holofoil, so the old code fell through to rows[0] = 1st Edition
    // and stored $100,000 as the card's market price.
    const rows = [
      price({ subTypeName: "1st Edition Holofoil", marketPrice: 100000 }),
      price({ subTypeName: "Unlimited Holofoil", marketPrice: 2146.38 }),
    ];
    expect(pickPrice(rows)?.subTypeName).toBe("Unlimited Holofoil");
    // ...regardless of the order the feed returns them in
    expect(pickPrice([...rows].reverse())?.subTypeName).toBe(
      "Unlimited Holofoil",
    );
  });

  it("headlines Unlimited for non-holo vintage", () => {
    const rows = [
      price({ subTypeName: "1st Edition", marketPrice: 40 }),
      price({ subTypeName: "Unlimited", marketPrice: 6 }),
    ];
    expect(pickPrice(rows)?.subTypeName).toBe("Unlimited");
  });

  it("avoids a 1st Edition row even under unfamiliar naming", () => {
    const rows = [
      price({ subTypeName: "1st Edition Reverse Holofoil", marketPrice: 900 }),
      price({ subTypeName: "Some Future Subtype", marketPrice: 12 }),
    ];
    expect(pickPrice(rows)?.subTypeName).toBe("Some Future Subtype");
  });

  it("uses a lone 1st Edition printing when it is the only one", () => {
    const rows = [price({ subTypeName: "1st Edition Holofoil", marketPrice: 55 })];
    expect(pickPrice(rows)?.subTypeName).toBe("1st Edition Holofoil");
  });
});

describe("resolvePrinting", () => {
  const vintage = [
    { subType: "1st Edition Holofoil", market: 100000, low: null },
    { subType: "Unlimited Holofoil", market: 2146.38, low: null },
  ];
  const modern = [
    { subType: "Normal", market: 0.25, low: null },
    { subType: "Reverse Holofoil", market: 3.5, low: null },
    { subType: "Holofoil", market: 12, low: null },
  ];

  it("matches exact subtypes", () => {
    expect(resolvePrinting(modern, "Reverse Holofoil")).toBe("Reverse Holofoil");
  });

  it("matches the shorthand real lists actually use", () => {
    // Collectr and pasted lists write "Reverse Holo", never the full subtype
    expect(resolvePrinting(modern, "Reverse Holo")).toBe("Reverse Holofoil");
    expect(resolvePrinting(modern, "reverse holo")).toBe("Reverse Holofoil");
    expect(resolvePrinting(modern, "rev holo")).toBe("Reverse Holofoil");
    expect(resolvePrinting(modern, "holo")).toBe("Holofoil");
    expect(resolvePrinting(modern, "NORMAL")).toBe("Normal");
  });

  it("expands a bare edition to the matching printing", () => {
    expect(resolvePrinting(vintage, "Unlimited")).toBe("Unlimited Holofoil");
    expect(resolvePrinting(vintage, "1st Edition")).toBe("1st Edition Holofoil");
    expect(resolvePrinting(vintage, "1st ed")).toBe("1st Edition Holofoil");
    expect(resolvePrinting(vintage, "First Edition")).toBe(
      "1st Edition Holofoil",
    );
  });

  it("never upgrades an unspecified hint to 1st Edition", () => {
    // "Holofoil" fits both vintage rows — resolve to the cheaper Unlimited
    expect(resolvePrinting(vintage, "Holofoil")).toBe("Unlimited Holofoil");
  });

  it("returns null when nothing plausibly matches", () => {
    expect(resolvePrinting(modern, "Gold Star")).toBeNull();
    expect(resolvePrinting(modern, "")).toBeNull();
    expect(resolvePrinting(null, "Holofoil")).toBeNull();
  });
});

describe("priceForPrinting", () => {
  const vintage = [
    { subType: "1st Edition Holofoil", market: 100000, low: null },
    { subType: "Unlimited Holofoil", market: 2146.38, low: null },
  ];

  it("prices loose edition text against the right row", () => {
    expect(priceForPrinting(vintage, "Unlimited", 2146.38)).toBe(2146.38);
    expect(priceForPrinting(vintage, "1st Edition", 2146.38)).toBe(100000);
  });

  it("falls back to the headline when the hint is unusable", () => {
    expect(priceForPrinting(vintage, "Gold Star", 2146.38)).toBe(2146.38);
    expect(priceForPrinting(vintage, null, 2146.38)).toBe(2146.38);
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
