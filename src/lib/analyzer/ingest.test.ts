import { describe, expect, it } from "vitest";
import {
  normalizeCardNumber,
  normalizeSetName,
  setNamesCompatible,
} from "./normalize";
import { parseCsvList, parseList, parseTextLine } from "./parse";
import { CatalogIndex, normalizeCardName, type CatalogEntry } from "./match";

describe("normalize", () => {
  it("canonicalizes card numbers", () => {
    expect(normalizeCardNumber("060/182")).toBe("60/182");
    expect(normalizeCardNumber("199/165")).toBe("199/165");
    expect(normalizeCardNumber("TG01/TG30")).toBe("tg1/tg30");
    expect(normalizeCardNumber("#25")).toBe("25");
    expect(normalizeCardNumber("SWSH123")).toBe("swsh123");
  });

  it("strips diacritics and noise from set names", () => {
    expect(normalizeSetName("Pokémon GO")).toBe("go");
    expect(setNamesCompatible("SV10: Destined Rivals", "Destined Rivals")).toBe(true);
    expect(setNamesCompatible("Pokémon GO", "Pokemon GO")).toBe(true);
    expect(setNamesCompatible("Obsidian Flames", "Paldea Evolved")).toBe(false);
  });

  it("strips embedded numbers from card names", () => {
    expect(normalizeCardName("Iono - 185/193")).toBe("iono");
    expect(normalizeCardName("Charizard ex (199/165)")).toBe("charizard ex");
    expect(normalizeCardName("Pikachu")).toBe("pikachu");
  });
});

describe("parseTextLine", () => {
  it("parses qty, name, number, set", () => {
    const l = parseTextLine("2x Charizard ex 199/165 Obsidian Flames")!;
    expect(l.quantity).toBe(2);
    expect(l.name).toBe("Charizard ex");
    expect(l.cardNumber).toBe("199/165");
    expect(l.setName).toBe("Obsidian Flames");
  });

  it("parses trailing condition and foil hints", () => {
    const l = parseTextLine("1 Radiant Greninja TG14/TG30 LP")!;
    expect(l.condition).toBe("LP");
    expect(l.cardNumber).toBe("TG14/TG30");

    const f = parseTextLine("Giratina V Alt Art 186/196 Lost Origin")!;
    expect(f.printing?.toLowerCase()).toBe("alt art");
    expect(f.name).toBe("Giratina V");
  });

  it("handles promo numbers and bare names", () => {
    expect(parseTextLine("Pikachu SVP062")!.cardNumber).toBe("SVP062");
    const bare = parseTextLine("Umbreon VMAX")!;
    expect(bare.name).toBe("Umbreon VMAX");
    expect(bare.cardNumber).toBeNull();
    expect(parseTextLine("   ")).toBeNull();
  });

  it("parses dash-separated lines", () => {
    const l = parseTextLine("3 Iono - 185/193 - Paldea Evolved")!;
    expect(l.quantity).toBe(3);
    expect(l.name).toBe("Iono");
    expect(l.setName).toBe("Paldea Evolved");
  });
});

describe("parseCsvList", () => {
  const csv = [
    "Quantity,Name,Set,Card Number,Printing,Condition,Product ID",
    '2,"Charizard ex",Obsidian Flames,199/165,Holofoil,Near Mint,517043',
    '1,"Iono",Paldea Evolved,185/193,Normal,Lightly Played,',
  ].join("\n");

  it("maps headers and rows", () => {
    const rows = parseCsvList(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      quantity: 2,
      name: "Charizard ex",
      setName: "Obsidian Flames",
      cardNumber: "199/165",
      condition: "NM",
      productId: 517043,
    });
    expect(rows[1].condition).toBe("LP");
    expect(rows[1].productId).toBeNull();
  });

  it("extracts printing folded into condition values", () => {
    const folded = [
      "Quantity,Name,Set,Condition",
      "1,Pikachu,Jungle,Near Mint Holofoil",
    ].join("\n");
    const rows = parseCsvList(folded);
    expect(rows[0].condition).toBe("NM");
    expect(rows[0].printing).toMatch(/holofoil/i);
  });

  it("parseList auto-detects CSV vs text", () => {
    expect(parseList(csv)).toHaveLength(2);
    expect(parseList("2 Charizard ex 199/165")).toHaveLength(1);
  });
});

describe("CatalogIndex", () => {
  const entries: CatalogEntry[] = [
    { id: 1, name: "Charizard ex - 199/165", setName: "SV03: Obsidian Flames", cardNumber: "199/165", rarity: null, marketPrice: 89.5, category: "singles" },
    { id: 2, name: "Iono - 185/193", setName: "SV02: Paldea Evolved", cardNumber: "185/193", rarity: null, marketPrice: 28, category: "singles" },
    { id: 3, name: "Pikachu - 025/165", setName: "SV03.5: 151", cardNumber: "025/165", rarity: null, marketPrice: 1.5, category: "singles" },
    { id: 4, name: "Pikachu - 25/102", setName: "Base Set", cardNumber: "25/102", rarity: null, marketPrice: 12, category: "singles" },
    { id: 5, name: "Radiant Charizard - 011/078", setName: "Pokemon GO", cardNumber: "011/078", rarity: null, marketPrice: 13, category: "singles" },
    { id: 6, name: "Charizard ex Premium Collection", setName: "SV: Scarlet & Violet Promo Cards", cardNumber: null, rarity: null, marketPrice: 65, category: "sealed" },
  ];
  const idx = CatalogIndex.build(entries);

  it("matches by product id with full confidence", () => {
    const m = idx.match({ productId: 2 })!;
    expect(m.entry.id).toBe(2);
    expect(m.via).toBe("id");
    expect(m.confidence).toBe(1);
  });

  it("matches by number with leading-zero differences", () => {
    const m = idx.match({ name: "Radiant Charizard", cardNumber: "11/78", setName: "Pokémon GO" })!;
    expect(m.entry.id).toBe(5);
    expect(m.via).toBe("number");
  });

  it("disambiguates shared numerators by set", () => {
    const m = idx.match({ name: "Pikachu", cardNumber: "25/102", setName: "Base Set" })!;
    expect(m.entry.id).toBe(4);
  });

  it("falls back to name search with set corroboration", () => {
    const m = idx.match({ name: "Iono", setName: "Paldea Evolved" })!;
    expect(m.entry.id).toBe(2);
    expect(m.via).toBe("name");
  });

  it("matches sealed only when allowed (customer lists, not vendor sync)", () => {
    const input = { name: "Charizard ex Premium Collection" };
    const allowed = idx.match(input, { allowSealed: true })!;
    expect(allowed.entry.id).toBe(6);
    expect(allowed.entry.category).toBe("sealed");
    // Vendor-sync path (singles only) must not land on the sealed box
    expect(idx.match(input)?.entry.id).not.toBe(6);
  });

  it("returns null for garbage", () => {
    expect(idx.match({ name: "Blastoise" })).toBeNull();
    expect(idx.match({})).toBeNull();
  });
});
