/**
 * Adapter parsing tests against real captured vendor responses in /.samples
 * (fetched 2026-06-11). If a vendor changes layout, refresh the fixture and
 * fix the parser here before the nightly sync starts failing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listingFromShopifyProduct, parseCavernTitle } from "./card-cavern";
import { parseBuylistForms, parseSetLinks } from "./full-grip";
import { listingFromCsiRow } from "./coolstuff";

const SAMPLES = join(__dirname, "../../../.samples");

describe("card cavern", () => {
  type Product = Parameters<typeof listingFromShopifyProduct>[0];
  const page = JSON.parse(
    readFileSync(join(SAMPLES, "cardcavern-page1.json"), "utf8"),
  ) as { products: Product[] };

  it("parses every product on a real page", () => {
    const listings = page.products
      .map(listingFromShopifyProduct)
      .filter((l) => l !== null);
    // Nearly all products should parse (some may lack an NM price)
    expect(listings.length).toBeGreaterThan(page.products.length * 0.9);
    for (const l of listings) {
      expect(l.cashPrice).toBeGreaterThan(0);
      expect(l.creditPrice).toBeGreaterThan(l.cashPrice!);
      expect(l.name).toBeTruthy();
      expect(l.setName).toBeTruthy();
    }
  });

  it("extracts card numbers from most titles", () => {
    const listings = page.products
      .map(listingFromShopifyProduct)
      .filter((l) => l !== null);
    const withNumber = listings.filter((l) => l.cardNumber);
    expect(withNumber.length).toBeGreaterThan(listings.length * 0.85);
  });

  it("handles title edge cases", () => {
    expect(
      parseCavernTitle("Radiant Greninja - TG14/TG30 - Astral Radiance - Holo", []),
    ).toMatchObject({ name: "Radiant Greninja", cardNumber: "TG14/TG30" });
    expect(
      parseCavernTitle("Snorlax - SM187 - Promo", ["Set_Promo"]),
    ).toMatchObject({ name: "Snorlax", cardNumber: "SM187", setName: "Promo" });
    expect(
      parseCavernTitle(
        "M Charizard EX Secret Rare - 108/106 - Flashfire - Holo",
        ["Set_Flashfire", "Print_Holo"],
      ),
    ).toMatchObject({
      name: "M Charizard EX Secret Rare",
      cardNumber: "108/106",
      setName: "Flashfire",
      printing: "Holo",
    });
  });
});

describe("full grip", () => {
  const html = readFileSync(join(SAMPLES, "fullgrip-set-page.html"), "utf8");

  it("parses buylist forms from a real set page, deduped by variant", () => {
    const listings = parseBuylistForms(html);
    expect(listings.length).toBeGreaterThan(0);
    // 24 products per page max; triplicated layouts must not inflate this
    expect(listings.length).toBeLessThanOrEqual(24);
    for (const l of listings) {
      expect(l.cashPrice).toBeGreaterThan(0);
      expect(l.creditPrice).toBeCloseTo(l.cashPrice! * 1.3, 1);
      expect(l.name).toBeTruthy();
      expect(l.setName).toBeTruthy();
    }
  });

  it("extracts set links from category hrefs", () => {
    const links = parseSetLinks(
      `<a href="/buylist/pokemon_singles-surging_sparks/3142">Surging Sparks</a>
       <a href="/buylist/pokemon_promos-scarlet__violet_promos/3015">Promos</a>
       <a href="/buylist/pokemon_singles-surging_sparks/pikachu_123/999">product page</a>
       <a href="/buylist/pokemon_singles/226">index</a>`,
    );
    expect(links.map((l) => l.path)).toEqual([
      "/buylist/pokemon_singles-surging_sparks/3142",
      "/buylist/pokemon_promos-scarlet__violet_promos/3015",
    ]);
  });
});

describe("coolstuffinc", () => {
  // The capture is the filtered getCards response: {"status":1,"rows":[...]}
  type Row = Parameters<typeof listingFromCsiRow>[0];
  const body = JSON.parse(
    readFileSync(join(SAMPLES, "csi-results.html"), "utf8"),
  ) as { rows: Row[] };

  it("parses real sell-list rows", () => {
    const listings = body.rows
      .map(listingFromCsiRow)
      .filter((l) => l !== null);
    expect(listings.length).toBeGreaterThan(body.rows.length * 0.8);
    for (const l of listings) {
      expect(l.cashPrice).toBeGreaterThan(0);
      expect(l.name).toBeTruthy();
      expect(l.cardNumber).toBeTruthy();
    }
  });

  it("splits printing parens out of names", () => {
    const reverse = listingFromCsiRow({
      PPQID: 1,
      Name: "Charizard - 4/102 (Reverse Foil)",
      ItemSet: "Base Set",
      Number: "4",
      Price: "100.00",
      CreditPrice: "125.00",
      tName: "Near Mint",
    })!;
    expect(reverse.name).toBe("Charizard");
    expect(reverse.cardNumber).toBe("4/102");
    expect(reverse.printing?.toLowerCase()).toBe("reverse foil");
  });

  it("skips bulk lots and sealed rows", () => {
    expect(
      listingFromCsiRow({
        PPQID: 2,
        Name: "1,000 Bulk Commons/Uncommons",
        Price: "8.00",
        tName: "Near Mint",
      }),
    ).toBeNull();
    expect(
      listingFromCsiRow({
        PPQID: 3,
        Name: "Booster Box - 36/36",
        Price: "90.00",
        tName: "New",
      }),
    ).toBeNull();
  });
});
