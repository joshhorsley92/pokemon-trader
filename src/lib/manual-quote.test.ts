import { describe, expect, it } from "vitest";
import { isManualQuoteCandidate } from "./manual-quote";

describe("isManualQuoteCandidate", () => {
  it("surfaces unpriced vintage sealed — the reason this exists", () => {
    // Every one of these is real: present in the catalog, absent from the
    // price feed, and worth four to six figures.
    for (const name of [
      "Pokemon Base Set (Shadowless) [1st Edition] Booster Box",
      "Neo Genesis Booster Box [1st Edition]",
      "Team Rocket Booster Box [1st Edition]",
      "Legendary Collection Booster Box",
      "Skyridge Booster Pack",
    ]) {
      expect(isManualQuoteCandidate(name, "sealed", null)).toBe(true);
    }
  });

  it("ignores the low-value unpriced tail", () => {
    for (const name of [
      "XY Single Pack Blister [Dragonite]",
      "Checklane 2-Pack Blister [Pawmot] (1-tab)",
      "Phantom Forces Collector's Pin 3 Pack Blister [Mega Gengar]",
      "Alola Trio Pin Collection",
    ]) {
      expect(isManualQuoteCandidate(name, "sealed", null)).toBe(false);
    }
  });

  it("never diverts a product that already has a price", () => {
    expect(
      isManualQuoteCandidate("Neo Genesis Booster Box", "sealed", 4200),
    ).toBe(false);
    // Zero is a price, not a missing one.
    expect(isManualQuoteCandidate("Some Box", "sealed", 0)).toBe(false);
  });

  it("does not apply to singles", () => {
    // An unpriced single is a data gap, not a scarce-item signal.
    expect(isManualQuoteCandidate("Charizard", "singles", null)).toBe(false);
  });

  it("is case insensitive", () => {
    expect(isManualQuoteCandidate("XY SINGLE PACK BLISTER", "sealed", null)).toBe(
      false,
    );
  });
});
