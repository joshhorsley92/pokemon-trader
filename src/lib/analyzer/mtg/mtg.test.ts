import { describe, expect, it } from "vitest";
import { buildCkLookup, ckKey, type CkLookup } from "./card-kingdom";
import {
  normalizeMtgCondition,
  parseManaboxCsv,
  parseMtgList,
  parseMtgTextLine,
  type MtgParsedLine,
} from "./parse";
import { buildMtgItems, syntheticProductId } from "./run";
import type { ResolvedCard } from "./scryfall";

// Real ManaBox export header order (extra columns we ignore included)
const MANABOX_CSV = [
  "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency",
  'Lightning Bolt,2X2,Double Masters 2022,117,normal,uncommon,3,12345,77c6fa74-5543-42ac-9ead-0e890b188e99,0.99,false,false,near_mint,en,USD',
  'Sol Ring,CMM,Commander Masters,464,foil,uncommon,1,23456,11111111-2222-3333-4444-555555555555,1.50,false,false,good,en,USD',
  'Counterspell,2XM,Double Masters,267,etched,common,2,34567,99999999-8888-7777-6666-555555555555,0.50,false,false,poor,en,USD',
].join("\n");

describe("parseManaboxCsv", () => {
  it("handles the real 19-column 'with Prices' export layout", () => {
    // Exact header row from a live ManaBox "Collection with Prices" export
    const csv = [
      "Binder Name,Binder Type,Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency,Added,Ext. Price",
      "Personal Collection,binder,Counterspell,3ED,Revised Edition,54,normal,uncommon,2,12345,00000000-0000-0000-0000-000000000001,5.00,FALSE,FALSE,good,en,USD,2025-08-02T21:28:38.810Z,10.00",
      "Personal Collection,binder,Shivan Dragon,3ED,Revised Edition,175,foil,rare,1,12346,00000000-0000-0000-0000-000000000002,20.00,FALSE,FALSE,played,en,USD,2025-08-02T21:28:38.810Z,20.00",
    ].join("\n");
    const lines = parseManaboxCsv(csv);
    expect(lines).toHaveLength(2);
    // "Binder Name" must not shadow the "Name" column
    expect(lines[0].name).toBe("Counterspell");
    expect(lines[0].quantity).toBe(2);
    expect(lines[0].condition).toBe("MP"); // ManaBox "good"
    expect(lines[0].scryfallId).toBe("00000000-0000-0000-0000-000000000001");
    expect(lines[1].foil).toBe(true);
    expect(lines[1].condition).toBe("HP"); // ManaBox "played"
  });

  it("parses rows with foil/etched/condition normalization", () => {
    const lines = parseManaboxCsv("﻿" + MANABOX_CSV);
    expect(lines).toHaveLength(3);

    const [bolt, ring, counter] = lines;
    expect(bolt.name).toBe("Lightning Bolt");
    expect(bolt.setCode).toBe("2x2"); // lowercased for Scryfall
    expect(bolt.setName).toBe("Double Masters 2022");
    expect(bolt.collectorNumber).toBe("117");
    expect(bolt.quantity).toBe(3);
    expect(bolt.foil).toBe(false);
    expect(bolt.finish).toBe("normal");
    expect(bolt.condition).toBe("NM");
    expect(bolt.scryfallId).toBe("77c6fa74-5543-42ac-9ead-0e890b188e99");

    expect(ring.foil).toBe(true);
    expect(ring.finish).toBe("foil");
    expect(ring.condition).toBe("MP"); // ManaBox "good" ≈ MP

    expect(counter.foil).toBe(true); // etched counts as foil (CK/Python parity)
    expect(counter.finish).toBe("etched");
    expect(counter.quantity).toBe(2);
    expect(counter.condition).toBe("Damaged"); // ManaBox "poor"
  });

  it("keeps rows without a Scryfall ID (name+set still resolvable)", () => {
    const csv =
      "Name,Set code,Quantity,Foil,Condition,Scryfall ID\nBrainstorm,ice,4,normal,near_mint,";
    const lines = parseManaboxCsv(csv);
    expect(lines).toHaveLength(1);
    expect(lines[0].scryfallId).toBeNull();
    expect(lines[0].name).toBe("Brainstorm");
  });

  it("defaults bad quantities to 1 and skips blank rows", () => {
    const csv = "Name,Quantity,Scryfall ID\nSol Ring,zero,abc\n,,";
    const lines = parseManaboxCsv(csv);
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(1);
  });
});

describe("parseMtgTextLine", () => {
  it("parses the full <qty> <name> (<set>) <collector> format", () => {
    const line = parseMtgTextLine("2 Lightning Bolt (2x2) 117");
    expect(line).toMatchObject({
      quantity: 2,
      name: "Lightning Bolt",
      setCode: "2x2",
      collectorNumber: "117",
      foil: false,
      finish: "normal",
    });
  });

  it("flags *F* foil markers", () => {
    const line = parseMtgTextLine("1 Sol Ring (cmm) 464 *F*");
    expect(line).toMatchObject({
      quantity: 1,
      name: "Sol Ring",
      setCode: "cmm",
      collectorNumber: "464",
      foil: true,
      finish: "foil",
    });
  });

  it("keeps split-card names intact", () => {
    const line = parseMtgTextLine("1 Fire // Ice (apc) 128");
    expect(line?.name).toBe("Fire // Ice");
  });

  it("falls back to <qty> <name> (<set>) without a collector number", () => {
    const line = parseMtgTextLine("3x Brainstorm (mh3)");
    expect(line).toMatchObject({
      quantity: 3,
      name: "Brainstorm",
      setCode: "mh3",
      collectorNumber: null,
    });
  });

  it("falls back to bare qty + name, with or without 'x'", () => {
    expect(parseMtgTextLine("2 Lightning Bolt")).toMatchObject({
      quantity: 2,
      name: "Lightning Bolt",
      setCode: null,
    });
    expect(parseMtgTextLine("4x Dark Ritual *F*")).toMatchObject({
      quantity: 4,
      name: "Dark Ritual",
      foil: true,
    });
  });

  it("treats a bare name as quantity 1 and skips blank lines", () => {
    expect(parseMtgTextLine("Sol Ring")).toMatchObject({ quantity: 1, name: "Sol Ring" });
    expect(parseMtgTextLine("   ")).toBeNull();
  });
});

describe("parseMtgList auto-detect", () => {
  it("routes ManaBox headers to the CSV parser", () => {
    const lines = parseMtgList(MANABOX_CSV);
    expect(lines).toHaveLength(3);
    expect(lines[0].scryfallId).toBe("77c6fa74-5543-42ac-9ead-0e890b188e99");
  });

  it("routes plain text to the text parser", () => {
    const lines = parseMtgList("2 Lightning Bolt (2x2) 117\n1 Sol Ring");
    expect(lines).toHaveLength(2);
    expect(lines[0].collectorNumber).toBe("117");
    expect(lines[1].name).toBe("Sol Ring");
  });
});

describe("normalizeMtgCondition", () => {
  it("maps ManaBox underscore values and defaults to NM", () => {
    expect(normalizeMtgCondition("near_mint")).toBe("NM");
    expect(normalizeMtgCondition("excellent")).toBe("LP");
    expect(normalizeMtgCondition("light_played")).toBe("MP");
    expect(normalizeMtgCondition("played")).toBe("HP");
    expect(normalizeMtgCondition("poor")).toBe("Damaged");
    expect(normalizeMtgCondition(null)).toBe("NM");
    expect(normalizeMtgCondition("???")).toBe("NM");
  });
});

// Small inline fixture mirroring the live CK envelope: { meta, data: [...] }
const CK_FIXTURE = {
  meta: { created_at: "2026-06-11" },
  data: [
    {
      id: 1,
      name: "Lightning Bolt",
      edition: "Double Masters 2022",
      variation: "",
      scryfall_id: "bolt-id",
      is_foil: false,
      price_buy: "1.50",
      qty_buying: 8,
      price_retail: "2.99",
    },
    {
      id: 2,
      name: "Lightning Bolt",
      edition: "Double Masters 2022",
      variation: "",
      scryfall_id: "bolt-id",
      is_foil: "true", // CK sometimes sends booleans as strings
      price_buy: 4,
      qty_buying: "0",
      price_retail: "7.99",
    },
    {
      // sealed product: no scryfall_id, must be skipped
      id: 3,
      name: "Double Masters 2022 Booster Box",
      edition: "Double Masters 2022",
      price_buy: "150.00",
      qty_buying: 2,
    },
  ],
};

describe("buildCkLookup", () => {
  it("keys entries by scryfall id + finish and coerces numbers", () => {
    const lookup = buildCkLookup(CK_FIXTURE);
    expect(lookup.size).toBe(2);

    const normal = lookup.get(ckKey("bolt-id", false));
    expect(normal).toMatchObject({ priceBuy: 1.5, qtyBuying: 8, priceRetail: 2.99 });

    const foil = lookup.get(ckKey("bolt-id", true)); // string "true" coerced
    expect(foil).toMatchObject({ priceBuy: 4, qtyBuying: 0 });
  });

  it("throws when expected fields are missing", () => {
    expect(() => buildCkLookup({ data: [{ name: "x" }] })).toThrow(/price_buy/);
    expect(() => buildCkLookup({ nothing: true })).toThrow(/product list/);
  });

  it("accepts a bare product array", () => {
    expect(buildCkLookup(CK_FIXTURE.data).size).toBe(2);
  });
});

function parsedLine(overrides: Partial<MtgParsedLine>): MtgParsedLine {
  return {
    raw: "1 Test Card",
    quantity: 1,
    name: "Test Card",
    setCode: null,
    setName: null,
    collectorNumber: null,
    foil: false,
    finish: "normal",
    condition: "NM",
    scryfallId: null,
    rarity: null,
    ...overrides,
  };
}

function resolvedCard(overrides: Partial<ResolvedCard>): ResolvedCard {
  return {
    scryfallId: "bolt-id",
    name: "Lightning Bolt",
    setName: "Double Masters 2022",
    prices: { usd: 1.0, usd_foil: 3.0, usd_etched: 5.0 },
    tcgplayerId: 555,
    ...overrides,
  };
}

describe("buildMtgItems", () => {
  const lookup: CkLookup = buildCkLookup(CK_FIXTURE);

  it("maps a resolved non-foil card to an item with a CK offer", () => {
    const [item] = buildMtgItems(
      [parsedLine({ quantity: 3, condition: "LP" })],
      [resolvedCard({})],
      lookup,
    );
    expect(item.productId).toBe(555); // tcgplayer id preferred
    expect(item.name).toBe("Lightning Bolt");
    expect(item.quantity).toBe(3);
    expect(item.condition).toBe("LP");
    expect(item.marketPrice).toBe(1.0); // usd for normal finish
    expect(item.offers).toHaveLength(1);
    expect(item.offers[0]).toEqual({
      vendor: "card_kingdom",
      cashPrice: 1.5,
      creditPrice: 1.95, // 1.50 * 1.3, rounded to cents
      conditionPrices: null,
      buying: true, // qty_buying 8 > 0
      url: null,
    });
  });

  it("uses foil price + foil CK entry, with buying=false when qty is 0", () => {
    const [item] = buildMtgItems(
      [parsedLine({ foil: true, finish: "foil" })],
      [resolvedCard({})],
      lookup,
    );
    expect(item.marketPrice).toBe(3.0); // usd_foil
    expect(item.offers[0]).toMatchObject({
      cashPrice: 4,
      creditPrice: 5.2,
      buying: false, // CK qty_buying 0
    });
  });

  it("prices etched lines from usd_etched but matches the CK foil entry", () => {
    const [item] = buildMtgItems(
      [parsedLine({ foil: true, finish: "etched" })],
      [resolvedCard({})],
      lookup,
    );
    expect(item.marketPrice).toBe(5.0);
    expect(item.offers[0]?.cashPrice).toBe(4);
  });

  it("rounds the 30% credit bonus to whole cents", () => {
    const lk: CkLookup = buildCkLookup([
      { scryfall_id: "x", is_foil: false, price_buy: "1.33", qty_buying: 1 },
    ]);
    const [item] = buildMtgItems(
      [parsedLine({})],
      [resolvedCard({ scryfallId: "x" })],
      lk,
    );
    expect(item.offers[0]?.creditPrice).toBe(1.73); // 1.729 → 1.73
  });

  it("falls back to a stable synthetic productId without a tcgplayer id", () => {
    const [item] = buildMtgItems(
      [parsedLine({})],
      [resolvedCard({ tcgplayerId: null })],
      lookup,
    );
    expect(item.productId).toBe(syntheticProductId("bolt-id"));
    expect(item.productId).toBeGreaterThan(0);
  });

  it("leaves unresolved lines unmatched with no offers", () => {
    const [item] = buildMtgItems(
      [parsedLine({ name: "Mystery Card" })],
      [null],
      lookup,
    );
    expect(item.productId).toBeNull();
    expect(item.marketPrice).toBeNull();
    expect(item.offers).toEqual([]);
    expect(item.name).toBe("Mystery Card");
  });

  it("omits offers for cards CK does not list", () => {
    const [item] = buildMtgItems(
      [parsedLine({})],
      [resolvedCard({ scryfallId: "not-in-ck" })],
      lookup,
    );
    expect(item.offers).toEqual([]);
  });
});
