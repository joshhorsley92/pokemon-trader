import { describe, expect, it } from "vitest";
import {
  sessionCsv,
  sessionTotals,
  type ShowSession,
  type ShowTransaction,
} from "./show-reconcile";

function txn(over: Partial<ShowTransaction>): ShowTransaction {
  return {
    id: "t",
    kind: "sell",
    productId: 1,
    title: "Card",
    category: "singles",
    condition: "NM",
    printing: null,
    quantity: 1,
    rateType: null,
    unitPrice: 0,
    lineTotal: 0,
    manualPrice: false,
    inventoryAction: null,
    inventoryItemId: null,
    createdAt: new Date("2026-06-29T15:00:00Z"),
    ...over,
  };
}

describe("sessionTotals", () => {
  it("sums buys as paid-out and sells as taken-in, nets them", () => {
    const totals = sessionTotals([
      txn({ kind: "sell", quantity: 2, lineTotal: 20 }),
      txn({ kind: "buy", quantity: 3, lineTotal: 12, rateType: "cash" }),
    ]);
    expect(totals.soldUnits).toBe(2);
    expect(totals.takenIn).toBe(20);
    expect(totals.boughtUnits).toBe(3);
    expect(totals.paidOut).toBe(12);
    expect(totals.net).toBe(8);
  });

  it("counts queued buys awaiting inventory", () => {
    const totals = sessionTotals([
      txn({ kind: "buy", lineTotal: 5, inventoryAction: "queued" }),
      txn({ kind: "buy", lineTotal: 5, inventoryAction: "added" }),
      txn({ kind: "buy", lineTotal: 5, inventoryAction: "queued" }),
    ]);
    expect(totals.queuedLines).toBe(2);
  });

  it("nets negative when payouts exceed takings", () => {
    const totals = sessionTotals([
      txn({ kind: "buy", lineTotal: 50, rateType: "cash" }),
      txn({ kind: "sell", lineTotal: 10 }),
    ]);
    expect(totals.net).toBe(-40);
  });

  it("uses integer-cent math (no float drift)", () => {
    const totals = sessionTotals([
      txn({ kind: "sell", lineTotal: 0.1 }),
      txn({ kind: "sell", lineTotal: 0.2 }),
    ]);
    expect(totals.takenIn).toBe(0.3);
  });
});

describe("sessionCsv", () => {
  const session: ShowSession = {
    id: "s",
    name: "Spring Show",
    status: "open",
    joinToken: "tok123",
    openedAt: new Date("2026-06-29T14:00:00Z"),
    closedAt: null,
  };

  it("emits a header, one row per txn, and a totals summary", () => {
    const csv = sessionCsv(session, [
      txn({ kind: "sell", title: "Pikachu", quantity: 1, lineTotal: 12.5 }),
      txn({
        kind: "buy",
        title: "Charizard",
        quantity: 2,
        unitPrice: 5,
        lineTotal: 10,
        rateType: "store_credit",
      }),
    ]);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("Kind");
    expect(csv).toContain("Pikachu");
    expect(csv).toContain("Charizard");
    expect(csv).toContain("Net cash,2.50");
  });

  it("quotes cells containing commas", () => {
    const csv = sessionCsv(session, [
      txn({ title: "Lugia, Neo Genesis", lineTotal: 3 }),
    ]);
    expect(csv).toContain('"Lugia, Neo Genesis"');
  });
});
