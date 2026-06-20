import { describe, expect, it } from "vitest";
import {
  buildAllExports,
  bulkCsv,
  decisionsCsv,
  tcgImportCsv,
  vendorPickListCsv,
  type ExportRow,
} from "./export";

function row(over: {
  decision: ExportRow["decision"];
  name?: string;
  vendor?: string;
  cash?: number;
  qty?: number;
  condition?: string;
  market?: number;
  tcgplayerId?: number | null;
  printing?: string | null;
}): ExportRow {
  return {
    item: {
      name: over.name ?? "Charizard ex",
      setName: "SV03: Obsidian Flames",
      quantity: over.qty ?? 1,
      condition: over.condition ?? "NM",
      marketPrice: over.market ?? 10,
      cardNumber: "199/165",
      rarity: "Special Illustration Rare",
      printing: over.printing ?? null,
      tcgplayerId: over.tcgplayerId === undefined ? 517043 : over.tcgplayerId,
    },
    decision: over.decision,
    estSalePrice: over.market ?? 10,
    bestOffer: over.vendor
      ? { vendor: over.vendor, cash: over.cash ?? 5, credit: (over.cash ?? 5) * 1.25 }
      : null,
    netTcg: 6,
    flags: [],
  };
}

describe("vendorPickListCsv", () => {
  it("includes only BUYLIST rows for that vendor", () => {
    const rows = [
      row({ decision: "BUYLIST", vendor: "coolstuff", cash: 9, qty: 3 }),
      row({ decision: "BUYLIST", vendor: "full_grip", cash: 4 }),
      row({ decision: "TCG", vendor: "coolstuff" }),
    ];
    const csv = vendorPickListCsv(rows, "coolstuff");
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2); // header + 1
    expect(lines[1]).toContain("Charizard ex");
    expect(lines[1]).toContain("9.00");
    expect(lines[1]).toContain("3");
  });
});

describe("tcgImportCsv", () => {
  it("writes the Staged Inventory columns with full condition names", () => {
    const csv = tcgImportCsv(
      [row({ decision: "TCG", condition: "LP", market: 12.5 })],
      "Pokemon",
    );
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "TCGplayer Id,Product Line,Set Name,Product Name,Number,Rarity,Condition,Printing,Add to Quantity,TCG Marketplace Price",
    );
    expect(lines[1]).toContain("517043,Pokemon,SV03: Obsidian Flames,Charizard ex,199/165");
    expect(lines[1]).toContain("Lightly Played");
    expect(lines[1]).toContain("Normal");
    expect(lines[1]).toContain("12.50");
  });

  it("leaves synthetic/unknown TCGplayer ids blank and maps foil finishes", () => {
    const csv = tcgImportCsv(
      [row({ decision: "TCG", tcgplayerId: null, printing: "foil" })],
      "Magic: The Gathering",
    );
    const dataLine = csv.split("\n")[1];
    expect(dataLine.startsWith(",Magic: The Gathering")).toBe(true);
    expect(dataLine).toContain("Foil");
  });
});

describe("bulkCsv / decisionsCsv", () => {
  it("filters bulk and escapes commas", () => {
    const rows = [
      row({ decision: "BULK", name: "Pikachu, the Mouse" }),
      row({ decision: "TCG" }),
    ];
    const csv = bulkCsv(rows);
    expect(csv.split("\n")).toHaveLength(2);
    expect(csv).toContain('"Pikachu, the Mouse"');
  });

  it("decisionsCsv covers every row", () => {
    const rows = [
      row({ decision: "BUYLIST", vendor: "coolstuff" }),
      row({ decision: "TCG" }),
      row({ decision: "BULK" }),
    ];
    expect(decisionsCsv(rows).split("\n")).toHaveLength(4);
  });
});

describe("buildAllExports", () => {
  it("produces one pick list per vendor plus the three standard files", () => {
    const rows = [
      row({ decision: "BUYLIST", vendor: "coolstuff" }),
      row({ decision: "BUYLIST", vendor: "card_cavern" }),
      row({ decision: "TCG" }),
      row({ decision: "BULK" }),
    ];
    const files = buildAllExports(rows, "Pokemon", "20260611");
    expect(files.map((f) => f.filename)).toEqual([
      "pick-list-card-cavern-20260611.csv",
      "pick-list-coolstuff-20260611.csv",
      "tcgplayer-import-20260611.csv",
      "bulk-20260611.csv",
      "decisions-20260611.csv",
    ]);
  });
});
