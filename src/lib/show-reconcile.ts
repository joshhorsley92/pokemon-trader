/**
 * Pure show-mode types and reconciliation math — no DB imports, so it's
 * unit-testable on its own. The db-backed session/transaction operations live
 * in show.ts and re-export everything here for callers.
 */
import type { ProductCategory } from "@/lib/pricing";

export type ShowSession = {
  id: string;
  name: string;
  status: "open" | "closed";
  joinToken: string | null;
  openedAt: Date | null;
  closedAt: Date | null;
};

export type ShowTxnKind = "buy" | "sell";
export type InventoryAction = "queued" | "added";

export type ShowTransaction = {
  id: string;
  kind: ShowTxnKind;
  productId: number | null;
  title: string;
  category: ProductCategory;
  condition: string | null;
  printing: string | null;
  quantity: number;
  rateType: "store_credit" | "cash" | null;
  unitPrice: number;
  lineTotal: number;
  manualPrice: boolean;
  inventoryAction: InventoryAction | null;
  inventoryItemId: string | null;
  createdAt: Date | null;
};

export type SessionTotals = {
  /** Cards bought (acquired) and total paid out */
  boughtUnits: number;
  paidOut: number;
  /** Cards sold (out of the case) and total taken in */
  soldUnits: number;
  takenIn: number;
  /** takenIn − paidOut: positive = cash gained on the day */
  net: number;
  /** Buys still waiting to be added to inventory */
  queuedLines: number;
};

export function sessionTotals(txns: ShowTransaction[]): SessionTotals {
  let boughtUnits = 0;
  let paidOutCents = 0;
  let soldUnits = 0;
  let takenInCents = 0;
  let queuedLines = 0;
  for (const t of txns) {
    const cents = Math.round(t.lineTotal * 100);
    if (t.kind === "buy") {
      boughtUnits += t.quantity;
      paidOutCents += cents;
      if (t.inventoryAction === "queued") queuedLines++;
    } else {
      soldUnits += t.quantity;
      takenInCents += cents;
    }
  }
  return {
    boughtUnits,
    paidOut: paidOutCents / 100,
    soldUnits,
    takenIn: takenInCents / 100,
    net: (takenInCents - paidOutCents) / 100,
    queuedLines,
  };
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per transaction — the session's audit/reconciliation file. */
export function sessionCsv(
  session: ShowSession,
  txns: ShowTransaction[],
): string {
  const header = [
    "Time",
    "Kind",
    "Title",
    "Category",
    "Condition",
    "Printing",
    "Qty",
    "Pay Type",
    "Unit Price",
    "Line Total",
    "Manual Price",
    "Inventory",
  ];
  // Oldest first reads naturally as a day's run.
  const ordered = [...txns].sort(
    (a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
  );
  const rows = ordered.map((t) => [
    t.createdAt?.toISOString() ?? "",
    t.kind === "buy" ? "Bought" : "Sold",
    t.title,
    t.category,
    t.condition ?? "",
    t.printing ?? "",
    t.quantity,
    t.kind === "buy" ? (t.rateType === "cash" ? "Cash" : "Credit") : "",
    t.unitPrice.toFixed(2),
    t.lineTotal.toFixed(2),
    t.manualPrice ? "yes" : "",
    t.kind === "buy" ? (t.inventoryAction ?? "") : "",
  ]);
  const totals = sessionTotals(txns);
  const summary = [
    [],
    ["Session", session.name],
    ["Bought units", totals.boughtUnits, "Paid out", totals.paidOut.toFixed(2)],
    ["Sold units", totals.soldUnits, "Taken in", totals.takenIn.toFixed(2)],
    ["Net cash", totals.net.toFixed(2)],
  ];
  return [header, ...rows, ...summary]
    .map((r) => r.map(csvCell).join(","))
    .join("\n");
}
