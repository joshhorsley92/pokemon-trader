/**
 * Show mode data layer: booth sessions plus on-the-spot buy/sell transactions.
 *
 * The transaction log is the source of truth for end-of-show reconciliation;
 * inventory effects (a buy becoming stock, a sell drawing stock down) are
 * derived here so the ledger and the inventory never disagree.
 *
 * Money is computed server-side (see sellUnitPrice / the buy path in the show
 * actions, which reuses the quote engine) and may be overridden by hand —
 * show mode is staff-only, so an operator's manual price is trusted.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, tables } from "@/db";
import { conditionMultiplier } from "@/lib/conditions";
import { effectiveInventoryPrice } from "@/lib/inventory";
import {
  dollarsUp,
  type ProductCategory,
  type RateType,
  toMoneyString,
} from "@/lib/pricing";
import { quoteFromDb } from "@/lib/quote";
import { getSettings, type AppSettings } from "@/lib/settings";
import type { ProductPrinting } from "@/lib/tcgcsv";
import type {
  InventoryAction,
  ShowSession,
  ShowTransaction,
  ShowTxnKind,
} from "@/lib/show-reconcile";

export type {
  InventoryAction,
  SessionTotals,
  ShowSession,
  ShowTransaction,
  ShowTxnKind,
} from "@/lib/show-reconcile";
export { sessionCsv, sessionTotals } from "@/lib/show-reconcile";

// ===== Sessions =====

export async function getOpenSession(
  shopId: string,
): Promise<ShowSession | null> {
  const [row] = await db
    .select()
    .from(tables.showSessions)
    .where(
      and(
        eq(tables.showSessions.shopId, shopId),
        eq(tables.showSessions.status, "open"),
      ),
    )
    .orderBy(desc(tables.showSessions.openedAt))
    .limit(1);
  return row ? toSession(row) : null;
}

export async function getSession(
  shopId: string,
  sessionId: string,
): Promise<ShowSession | null> {
  const [row] = await db
    .select()
    .from(tables.showSessions)
    .where(
      and(
        eq(tables.showSessions.shopId, shopId),
        eq(tables.showSessions.id, sessionId),
      ),
    );
  return row ? toSession(row) : null;
}

export async function listRecentSessions(
  shopId: string,
  limit = 20,
): Promise<ShowSession[]> {
  const rows = await db
    .select()
    .from(tables.showSessions)
    .where(eq(tables.showSessions.shopId, shopId))
    .orderBy(desc(tables.showSessions.openedAt))
    .limit(limit);
  return rows.map(toSession);
}

/** Open a session, reusing an already-open one rather than stacking them. */
export async function openSession(
  shopId: string,
  name: string,
  userId: string | null,
): Promise<ShowSession> {
  const existing = await getOpenSession(shopId);
  if (existing) return existing;
  const [row] = await db
    .insert(tables.showSessions)
    .values({ shopId, name, openedBy: userId, joinToken: nanoid(12) })
    .returning();
  return toSession(row);
}

/** The open booth session resolved from its QR join token (public path). */
export async function getSessionByToken(token: string): Promise<{
  session: ShowSession;
  shopId: string;
} | null> {
  const [row] = await db
    .select()
    .from(tables.showSessions)
    .where(eq(tables.showSessions.joinToken, token));
  if (!row) return null;
  return { session: toSession(row), shopId: row.shopId };
}

export async function closeSession(
  shopId: string,
  sessionId: string,
): Promise<void> {
  await db
    .update(tables.showSessions)
    .set({ status: "closed", closedAt: new Date() })
    .where(
      and(
        eq(tables.showSessions.shopId, shopId),
        eq(tables.showSessions.id, sessionId),
      ),
    );
}

/**
 * Delete a session entirely, reversing every inventory effect first (a bought
 * item that became stock is removed; a sold item is restocked) so a discarded
 * test run leaves no trace. Cascades its transactions and pending piles.
 */
export async function deleteSession(
  shopId: string,
  sessionId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: tables.showSessions.id })
      .from(tables.showSessions)
      .where(
        and(
          eq(tables.showSessions.shopId, shopId),
          eq(tables.showSessions.id, sessionId),
        ),
      );
    if (!owned) return;

    const txns = await tx
      .select()
      .from(tables.showTransactions)
      .where(eq(tables.showTransactions.sessionId, sessionId));
    for (const txn of txns) {
      if (!txn.inventoryItemId) continue;
      if (txn.kind === "buy" && txn.inventoryAction === "added") {
        await tx
          .delete(tables.inventoryItems)
          .where(eq(tables.inventoryItems.id, txn.inventoryItemId));
      } else if (txn.kind === "sell") {
        await tx
          .update(tables.inventoryItems)
          .set({
            quantity: sql`${tables.inventoryItems.quantity} + ${txn.quantity}`,
            status: "available",
            updatedAt: new Date(),
          })
          .where(eq(tables.inventoryItems.id, txn.inventoryItemId));
      }
    }

    await tx
      .delete(tables.showSessions)
      .where(eq(tables.showSessions.id, sessionId));
  });
}

// ===== Transactions =====

export async function listTransactions(
  shopId: string,
  sessionId: string,
): Promise<ShowTransaction[]> {
  const rows = await db
    .select()
    .from(tables.showTransactions)
    .where(
      and(
        eq(tables.showTransactions.shopId, shopId),
        eq(tables.showTransactions.sessionId, sessionId),
      ),
    )
    .orderBy(desc(tables.showTransactions.createdAt));
  return rows.map(toTransaction);
}

export type RecordTxnInput = {
  shopId: string;
  sessionId: string;
  kind: ShowTxnKind;
  productId: number | null;
  title: string;
  category: ProductCategory;
  condition: string | null;
  printing: string | null;
  quantity: number;
  /** Buys only */
  rateType: "store_credit" | "cash" | null;
  unitPrice: number;
  manualPrice: boolean;
  /** Buys only: queue for later, or add to live inventory now */
  inventoryAction: InventoryAction | null;
  /** Sells only: draw down THIS specific inventory row (booth "want" lines) */
  sellInventoryItemId?: string | null;
};

/**
 * Append a transaction and apply its inventory effect in one DB transaction:
 *  - buy + 'added'  → create an available inventory row, link it
 *  - buy + 'queued' → nothing now (added later in bulk)
 *  - sell           → draw down a matching available inventory row if one
 *                     exists (untracked loose stock just records the sale)
 */
export async function recordTransaction(
  input: RecordTxnInput,
): Promise<ShowTransaction> {
  const lineTotal =
    Math.round(input.unitPrice * 100) * input.quantity / 100;

  return db.transaction(async (tx) => {
    let inventoryItemId: string | null = null;

    if (input.kind === "buy" && input.inventoryAction === "added") {
      const [item] = await tx
        .insert(tables.inventoryItems)
        .values({
          shopId: input.shopId,
          productId: input.productId,
          title: input.title,
          category: input.category,
          condition: input.condition,
          quantity: input.quantity,
          // null asking price = track market × markup; operator can fix later
          askingPrice: null,
          status: "available",
          source: "manual",
        })
        .returning({ id: tables.inventoryItems.id });
      inventoryItemId = item.id;
    }

    if (input.kind === "sell") {
      if (input.sellInventoryItemId) {
        inventoryItemId = await drawDownSpecificItem(
          tx,
          input.shopId,
          input.sellInventoryItemId,
          input.quantity,
        );
      } else if (input.productId !== null) {
        inventoryItemId = await drawDownInventory(tx, input);
      }
    }

    const [row] = await tx
      .insert(tables.showTransactions)
      .values({
        sessionId: input.sessionId,
        shopId: input.shopId,
        kind: input.kind,
        productId: input.productId,
        title: input.title,
        category: input.category,
        condition: input.condition,
        printing: input.printing,
        quantity: input.quantity,
        rateType: input.kind === "buy" ? input.rateType : null,
        unitPrice: toMoneyString(input.unitPrice),
        lineTotal: toMoneyString(lineTotal),
        manualPrice: input.manualPrice,
        inventoryAction: input.kind === "buy" ? input.inventoryAction : null,
        inventoryItemId,
      })
      .returning();
    return toTransaction(row);
  });
}

/** Delete a mis-keyed line and reverse its inventory effect. */
export async function voidTransaction(
  shopId: string,
  sessionId: string,
  txnId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [txn] = await tx
      .select()
      .from(tables.showTransactions)
      .where(
        and(
          eq(tables.showTransactions.shopId, shopId),
          eq(tables.showTransactions.sessionId, sessionId),
          eq(tables.showTransactions.id, txnId),
        ),
      );
    if (!txn) return;

    // Reverse the inventory effect: a buy that became stock is removed; a sell
    // that drew stock down is restocked.
    if (txn.inventoryItemId) {
      if (txn.kind === "buy" && txn.inventoryAction === "added") {
        await tx
          .delete(tables.inventoryItems)
          .where(eq(tables.inventoryItems.id, txn.inventoryItemId));
      } else if (txn.kind === "sell") {
        await tx
          .update(tables.inventoryItems)
          .set({
            quantity: sql`${tables.inventoryItems.quantity} + ${txn.quantity}`,
            status: "available",
            updatedAt: new Date(),
          })
          .where(eq(tables.inventoryItems.id, txn.inventoryItemId));
      }
    }

    await tx
      .delete(tables.showTransactions)
      .where(eq(tables.showTransactions.id, txnId));
  });
}

/**
 * Add every still-queued buy from a session to live inventory in one go (the
 * end-of-show "add what I bought to stock" checkbox).
 */
export async function addQueuedToInventory(
  shopId: string,
  sessionId: string,
): Promise<number> {
  return db.transaction(async (tx) => {
    const queued = await tx
      .select()
      .from(tables.showTransactions)
      .where(
        and(
          eq(tables.showTransactions.shopId, shopId),
          eq(tables.showTransactions.sessionId, sessionId),
          eq(tables.showTransactions.kind, "buy"),
          eq(tables.showTransactions.inventoryAction, "queued"),
        ),
      );
    let added = 0;
    for (const txn of queued) {
      const [item] = await tx
        .insert(tables.inventoryItems)
        .values({
          shopId,
          productId: txn.productId,
          title: txn.title,
          category: txn.category,
          condition: txn.condition,
          quantity: txn.quantity,
          askingPrice: null,
          status: "available",
          source: "manual",
        })
        .returning({ id: tables.inventoryItems.id });
      await tx
        .update(tables.showTransactions)
        .set({ inventoryAction: "added", inventoryItemId: item.id })
        .where(eq(tables.showTransactions.id, txn.id));
      added++;
    }
    return added;
  });
}

// ===== Booth: customer-built pending trades =====

export type PendingSide = "give" | "want";
export type PendingStatus = "pending" | "accepted" | "dismissed";

export type PendingItemView = {
  id: string;
  side: PendingSide;
  productId: number | null;
  inventoryItemId: string | null;
  title: string;
  category: ProductCategory;
  condition: string | null;
  printing: string | null;
  quantity: number;
  graded: boolean;
  grader: string | null;
  grade: string | null;
  status: PendingStatus;
  /** Server-computed unit price for review display (null = needs manual) */
  unitPrice: number | null;
};

export type PendingTradeView = {
  id: string;
  label: string | null;
  rateType: RateType;
  status: PendingStatus;
  createdAt: Date | null;
  items: PendingItemView[];
  /** Sum of give line totals (what you'd pay) and want line totals (their cart) */
  giveTotal: number;
  wantTotal: number;
};

export type PendingLineInput = {
  side: PendingSide;
  productId: number | null;
  inventoryItemId: string | null;
  title: string;
  category: ProductCategory;
  condition: string | null;
  printing: string | null;
  quantity: number;
  graded?: boolean;
  grader?: string | null;
  grade?: string | null;
};

/** Persist a customer-built pile against an open booth session. */
export async function createPendingTrade(input: {
  shopId: string;
  sessionId: string;
  label: string | null;
  rateType: RateType;
  lines: PendingLineInput[];
}): Promise<string> {
  return db.transaction(async (tx) => {
    const [trade] = await tx
      .insert(tables.showPendingTrades)
      .values({
        sessionId: input.sessionId,
        shopId: input.shopId,
        label: input.label,
        rateType: input.rateType,
      })
      .returning({ id: tables.showPendingTrades.id });
    if (input.lines.length > 0) {
      await tx.insert(tables.showPendingItems).values(
        input.lines.map((l) => ({
          pendingId: trade.id,
          side: l.side,
          productId: l.productId,
          inventoryItemId: l.inventoryItemId,
          title: l.title,
          category: l.category,
          condition: l.condition,
          printing: l.printing,
          quantity: l.quantity,
          graded: l.graded ?? false,
          grader: l.grader ?? null,
          grade: l.grade ?? null,
        })),
      );
    }
    return trade.id;
  });
}

export async function countPendingTrades(
  shopId: string,
  sessionId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tables.showPendingTrades)
    .where(
      and(
        eq(tables.showPendingTrades.shopId, shopId),
        eq(tables.showPendingTrades.sessionId, sessionId),
        eq(tables.showPendingTrades.status, "pending"),
      ),
    );
  return row?.n ?? 0;
}

/** Pending piles for a session, each line priced for operator review. */
export async function listPendingTrades(
  shopId: string,
  sessionId: string,
): Promise<PendingTradeView[]> {
  const trades = await db
    .select()
    .from(tables.showPendingTrades)
    .where(
      and(
        eq(tables.showPendingTrades.shopId, shopId),
        eq(tables.showPendingTrades.sessionId, sessionId),
        eq(tables.showPendingTrades.status, "pending"),
      ),
    )
    .orderBy(desc(tables.showPendingTrades.createdAt));
  if (trades.length === 0) return [];

  const settings = await getSettings(shopId);
  const views: PendingTradeView[] = [];
  for (const trade of trades) {
    const items = await db
      .select()
      .from(tables.showPendingItems)
      .where(eq(tables.showPendingItems.pendingId, trade.id));
    const priced = await Promise.all(
      items.map(async (it) => {
        const unitPrice =
          it.side === "give"
            ? await priceGiveItem(shopId, settings, it, trade.rateType)
            : await priceWantItem(shopId, settings, it);
        return {
          id: it.id,
          side: it.side,
          productId: it.productId,
          inventoryItemId: it.inventoryItemId,
          title: it.title,
          category: it.category,
          condition: it.condition,
          printing: it.printing,
          quantity: it.quantity,
          graded: it.graded,
          grader: it.grader,
          grade: it.grade,
          status: it.status,
          unitPrice,
        } satisfies PendingItemView;
      }),
    );
    const onlyPending = priced.filter((p) => p.status === "pending");
    const giveTotal = sumLines(onlyPending.filter((p) => p.side === "give"));
    const wantTotal = sumLines(onlyPending.filter((p) => p.side === "want"));
    views.push({
      id: trade.id,
      label: trade.label,
      rateType: trade.rateType,
      status: trade.status,
      createdAt: trade.createdAt,
      items: priced,
      giveTotal,
      wantTotal,
    });
  }
  return views;
}

function sumLines(items: PendingItemView[]): number {
  const cents = items.reduce(
    (sum, i) =>
      sum + Math.round((i.unitPrice ?? 0) * 100) * i.quantity,
    0,
  );
  return cents / 100;
}

/**
 * Accept one pending line: give → buy txn, want → sell txn; mark it accepted.
 * A graded slab or a price that floors to $0 has no auto price — pass
 * `manualUnitPrice` (the operator's hand-keyed value) to accept those; without
 * one they return `needsManual` so the caller can leave them for review.
 */
export async function acceptPendingItem(
  shopId: string,
  itemId: string,
  opts: { inventoryAction?: InventoryAction; manualUnitPrice?: number } = {},
): Promise<{ ok: boolean; error?: string; needsManual?: boolean }> {
  const [it] = await db
    .select()
    .from(tables.showPendingItems)
    .innerJoin(
      tables.showPendingTrades,
      eq(tables.showPendingTrades.id, tables.showPendingItems.pendingId),
    )
    .where(
      and(
        eq(tables.showPendingItems.id, itemId),
        eq(tables.showPendingTrades.shopId, shopId),
      ),
    );
  if (!it) return { ok: false, error: "Line not found" };
  const item = it.show_pending_items;
  const trade = it.show_pending_trades;
  if (item.status !== "pending") return { ok: true }; // already handled
  if (trade.status === "dismissed") return { ok: false, error: "Trade dismissed" };

  const settings = await getSettings(shopId);
  const hasManual = opts.manualUnitPrice != null && opts.manualUnitPrice > 0;
  let unitPrice: number | null;
  if (hasManual) {
    unitPrice = opts.manualUnitPrice!;
  } else {
    unitPrice =
      item.side === "give"
        ? await priceGiveItem(shopId, settings, item, trade.rateType)
        : await priceWantItem(shopId, settings, item);
  }
  // No auto price (graded, unmatched) or floored to $0 → must be hand-quoted.
  if (unitPrice === null || unitPrice <= 0) {
    return { ok: false, needsManual: true, error: `Needs a price: "${item.title}"` };
  }

  if (item.side === "give") {
    await recordTransaction({
      shopId,
      sessionId: trade.sessionId,
      kind: "buy",
      productId: item.productId,
      title: item.title,
      category: item.category,
      condition: item.condition,
      printing: item.printing,
      quantity: item.quantity,
      rateType: trade.rateType,
      unitPrice,
      manualPrice: hasManual,
      inventoryAction: opts.inventoryAction ?? "added",
    });
  } else {
    await recordTransaction({
      shopId,
      sessionId: trade.sessionId,
      kind: "sell",
      productId: item.productId,
      title: item.title,
      category: item.category,
      condition: item.condition,
      printing: item.printing,
      quantity: item.quantity,
      rateType: null,
      unitPrice,
      manualPrice: hasManual,
      inventoryAction: null,
      sellInventoryItemId: item.inventoryItemId,
    });
  }

  await db
    .update(tables.showPendingItems)
    .set({ status: "accepted" })
    .where(eq(tables.showPendingItems.id, itemId));
  await closeTradeIfResolved(trade.id);
  return { ok: true };
}

/**
 * Accept every auto-priceable line in a pile, and REPORT (don't silently drop)
 * the lines that need a hand price — they stay pending for the operator.
 */
export async function acceptPendingTrade(
  shopId: string,
  pendingId: string,
  opts: { inventoryAction?: InventoryAction } = {},
): Promise<{ ok: boolean; accepted: number; skipped: string[]; error?: string }> {
  const items = await db
    .select({
      id: tables.showPendingItems.id,
      title: tables.showPendingItems.title,
    })
    .from(tables.showPendingItems)
    .innerJoin(
      tables.showPendingTrades,
      eq(tables.showPendingTrades.id, tables.showPendingItems.pendingId),
    )
    .where(
      and(
        eq(tables.showPendingItems.pendingId, pendingId),
        eq(tables.showPendingTrades.shopId, shopId),
        eq(tables.showPendingItems.status, "pending"),
      ),
    );
  let accepted = 0;
  const skipped: string[] = [];
  for (const { id, title } of items) {
    const res = await acceptPendingItem(shopId, id, opts);
    if (res.ok) accepted++;
    else if (res.needsManual) skipped.push(title);
    else return { ok: false, accepted, skipped, error: res.error };
  }
  await closeTradeIfResolved(pendingId);
  return { ok: true, accepted, skipped };
}

/** Edit a still-pending line in place (operator re-grades / adjusts quantity). */
export async function updatePendingItem(
  shopId: string,
  itemId: string,
  patch: { condition?: string | null; quantity?: number; printing?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const [row] = await db
    .select({
      status: tables.showPendingItems.status,
      tradeStatus: tables.showPendingTrades.status,
    })
    .from(tables.showPendingItems)
    .innerJoin(
      tables.showPendingTrades,
      eq(tables.showPendingTrades.id, tables.showPendingItems.pendingId),
    )
    .where(
      and(
        eq(tables.showPendingItems.id, itemId),
        eq(tables.showPendingTrades.shopId, shopId),
      ),
    );
  if (!row) return { ok: false, error: "Line not found" };
  if (row.status !== "pending" || row.tradeStatus !== "pending") {
    return { ok: false, error: "Already handled" };
  }
  const set: Partial<typeof tables.showPendingItems.$inferInsert> = {};
  if (patch.condition !== undefined) set.condition = patch.condition;
  if (patch.quantity !== undefined) set.quantity = patch.quantity;
  if (patch.printing !== undefined) set.printing = patch.printing;
  if (Object.keys(set).length === 0) return { ok: true };
  await db
    .update(tables.showPendingItems)
    .set(set)
    .where(eq(tables.showPendingItems.id, itemId));
  return { ok: true };
}

/** Add a line to a pending pile (customer changed their mind at the table). */
export async function addPendingItem(
  shopId: string,
  pendingId: string,
  line: PendingLineInput,
): Promise<{ ok: boolean; error?: string }> {
  const [trade] = await db
    .select({ status: tables.showPendingTrades.status })
    .from(tables.showPendingTrades)
    .where(
      and(
        eq(tables.showPendingTrades.shopId, shopId),
        eq(tables.showPendingTrades.id, pendingId),
      ),
    );
  if (!trade) return { ok: false, error: "Pile not found" };
  if (trade.status !== "pending") return { ok: false, error: "Already handled" };
  await db.insert(tables.showPendingItems).values({
    pendingId,
    side: line.side,
    productId: line.productId,
    inventoryItemId: line.inventoryItemId,
    title: line.title,
    category: line.category,
    condition: line.condition,
    printing: line.printing,
    quantity: line.quantity,
    graded: line.graded ?? false,
    grader: line.grader ?? null,
    grade: line.grade ?? null,
  });
  return { ok: true };
}

/** Drop a line from a pending pile before accepting. */
export async function removePendingItem(
  shopId: string,
  itemId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: tables.showPendingItems.id })
    .from(tables.showPendingItems)
    .innerJoin(
      tables.showPendingTrades,
      eq(tables.showPendingTrades.id, tables.showPendingItems.pendingId),
    )
    .where(
      and(
        eq(tables.showPendingItems.id, itemId),
        eq(tables.showPendingTrades.shopId, shopId),
      ),
    );
  if (!row) return;
  await db
    .delete(tables.showPendingItems)
    .where(eq(tables.showPendingItems.id, itemId));
}

export async function dismissPendingTrade(
  shopId: string,
  pendingId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: tables.showPendingTrades.id })
      .from(tables.showPendingTrades)
      .where(
        and(
          eq(tables.showPendingTrades.shopId, shopId),
          eq(tables.showPendingTrades.id, pendingId),
        ),
      );
    if (!owned) return;
    await tx
      .update(tables.showPendingItems)
      .set({ status: "dismissed" })
      .where(
        and(
          eq(tables.showPendingItems.pendingId, pendingId),
          eq(tables.showPendingItems.status, "pending"),
        ),
      );
    await tx
      .update(tables.showPendingTrades)
      .set({ status: "dismissed" })
      .where(eq(tables.showPendingTrades.id, pendingId));
  });
}

/** Mark a pile accepted once no pending lines remain. */
async function closeTradeIfResolved(pendingId: string): Promise<void> {
  const [stillPending] = await db
    .select({ id: tables.showPendingItems.id })
    .from(tables.showPendingItems)
    .where(
      and(
        eq(tables.showPendingItems.pendingId, pendingId),
        eq(tables.showPendingItems.status, "pending"),
      ),
    )
    .limit(1);
  if (!stillPending) {
    await db
      .update(tables.showPendingTrades)
      .set({ status: "accepted" })
      .where(eq(tables.showPendingTrades.id, pendingId));
  }
}

type PendingItemRow = typeof tables.showPendingItems.$inferSelect;

/** Buy-side price for a customer's give line (reuses the quote engine). */
async function priceGiveItem(
  shopId: string,
  settings: AppSettings,
  item: PendingItemRow,
  rateType: RateType,
): Promise<number | null> {
  // Graded slabs are never auto-priced — free data can't value them. Null here
  // forces the operator to quote by hand instead of pricing it as a raw card.
  if (item.graded) return null;
  if (item.productId === null) return null;
  const quote = await quoteFromDb(
    [
      {
        productId: item.productId,
        quantity: 1,
        condition: item.condition,
        printing: item.printing,
      },
    ],
    rateType,
    settings,
    shopId,
  ).catch(() => null);
  return quote?.lines[0]?.unitCredit ?? null;
}

/** Sell-side price for a want line: the picked inventory item's effective price. */
async function priceWantItem(
  shopId: string,
  settings: AppSettings,
  item: PendingItemRow,
): Promise<number | null> {
  if (item.inventoryItemId) {
    const [row] = await db
      .select({
        askingPrice: tables.inventoryItems.askingPrice,
        marketPrice: tables.catalogProducts.marketPrice,
      })
      .from(tables.inventoryItems)
      .leftJoin(
        tables.catalogProducts,
        eq(tables.catalogProducts.id, tables.inventoryItems.productId),
      )
      .where(
        and(
          eq(tables.inventoryItems.shopId, shopId),
          eq(tables.inventoryItems.id, item.inventoryItemId),
        ),
      );
    if (row) {
      const priced = effectiveInventoryPrice(
        row.askingPrice === null ? null : Number(row.askingPrice),
        row.marketPrice === null ? null : Number(row.marketPrice),
        settings.inventory_market_markup,
      );
      if (priced) return priced.price;
    }
  }
  if (item.productId !== null) {
    return sellUnitPrice(settings, item.productId, item.printing, item.condition);
  }
  return null;
}

// ===== Pricing =====

/** Resolve the market price for a chosen printing, falling back to headline. */
function priceForPrinting(
  printings: ProductPrinting[] | null,
  printing: string | null | undefined,
  headline: number | null,
): number | null {
  if (printing && printings) {
    const match = printings.find((p) => p.subType === printing);
    if (match && match.market !== null) return match.market;
  }
  return headline;
}

/**
 * What the shop should ask when SELLING a catalog product out of the case:
 * market(printing) × markup × condition multiplier, then shop rounding.
 * Returns null when the product has no market price.
 */
export async function sellUnitPrice(
  settings: AppSettings,
  productId: number,
  printing: string | null,
  condition: string | null,
): Promise<number | null> {
  const [p] = await db
    .select({
      category: tables.catalogProducts.category,
      categoryOverride: tables.catalogProducts.categoryOverride,
      marketPrice: tables.catalogProducts.marketPrice,
      printings: tables.catalogProducts.printings,
    })
    .from(tables.catalogProducts)
    .where(eq(tables.catalogProducts.id, productId));
  if (!p) return null;
  const headline = p.marketPrice === null ? null : Number(p.marketPrice);
  const market = priceForPrinting(
    (p.printings ?? null) as ProductPrinting[] | null,
    printing,
    headline,
  );
  if (market === null) return null;
  const category = (p.categoryOverride ?? p.category) as ProductCategory;
  const mult = conditionMultiplier(
    settings.condition_multipliers,
    category,
    condition,
  );
  // Sell price rounds up to the whole dollar.
  return dollarsUp(market * settings.inventory_market_markup * mult);
}

// ===== row mappers =====

function toSession(row: typeof tables.showSessions.$inferSelect): ShowSession {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    joinToken: row.joinToken,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
  };
}

function toTransaction(
  row: typeof tables.showTransactions.$inferSelect,
): ShowTransaction {
  return {
    id: row.id,
    kind: row.kind,
    productId: row.productId,
    title: row.title,
    category: row.category,
    condition: row.condition,
    printing: row.printing,
    quantity: row.quantity,
    rateType: row.rateType,
    unitPrice: Number(row.unitPrice),
    lineTotal: Number(row.lineTotal),
    manualPrice: row.manualPrice,
    inventoryAction: row.inventoryAction as InventoryAction | null,
    inventoryItemId: row.inventoryItemId,
    createdAt: row.createdAt,
  };
}

// drizzle transaction type used by the in-transaction helper below
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Draw down the best-matching available inventory row for a sell. */
async function drawDownInventory(
  tx: Tx,
  input: RecordTxnInput,
): Promise<string | null> {
  if (input.productId === null) return null;
  const conds = [
    eq(tables.inventoryItems.shopId, input.shopId),
    eq(tables.inventoryItems.productId, input.productId),
    eq(tables.inventoryItems.status, "available"),
  ];
  // Match condition for singles, where it materially changes the item.
  if (input.category === "singles" && input.condition) {
    conds.push(eq(tables.inventoryItems.condition, input.condition));
  }
  const [match] = await tx
    .select({
      id: tables.inventoryItems.id,
      quantity: tables.inventoryItems.quantity,
    })
    .from(tables.inventoryItems)
    .where(and(...conds))
    .orderBy(desc(tables.inventoryItems.quantity))
    .limit(1);
  if (!match) return null;
  const remaining = match.quantity - input.quantity;
  await tx
    .update(tables.inventoryItems)
    .set({
      quantity: Math.max(remaining, 0),
      status: remaining <= 0 ? "sold" : "available",
      updatedAt: new Date(),
    })
    .where(eq(tables.inventoryItems.id, match.id));
  return match.id;
}

/** Draw down one specific inventory row (a booth "want" line picked the item). */
async function drawDownSpecificItem(
  tx: Tx,
  shopId: string,
  itemId: string,
  quantity: number,
): Promise<string | null> {
  const [match] = await tx
    .select({ quantity: tables.inventoryItems.quantity })
    .from(tables.inventoryItems)
    .where(
      and(
        eq(tables.inventoryItems.shopId, shopId),
        eq(tables.inventoryItems.id, itemId),
      ),
    );
  if (!match) return null;
  const remaining = match.quantity - quantity;
  await tx
    .update(tables.inventoryItems)
    .set({
      quantity: Math.max(remaining, 0),
      status: remaining <= 0 ? "sold" : "available",
      updatedAt: new Date(),
    })
    .where(eq(tables.inventoryItems.id, itemId));
  return itemId;
}
