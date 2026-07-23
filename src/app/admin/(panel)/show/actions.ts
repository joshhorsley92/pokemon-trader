"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { ALL_CONDITION_VALUES } from "@/lib/conditions";
import { quoteFromDb } from "@/lib/quote";
import { getSettings } from "@/lib/settings";
import {
  acceptPendingItem,
  acceptPendingTrade,
  addPendingItem,
  addQueuedToInventory,
  closeSession,
  countPendingTrades,
  createPendingTrade,
  deleteSession,
  dismissPendingTrade,
  deleteDeal,
  getSession,
  openSession,
  recordTransaction,
  removePendingItem,
  sellInventoryRow,
  sellUnitPrice,
  setPendingTradeCash,
  updatePendingItem,
  voidTransaction,
} from "@/lib/show";
import { getCurrentShopId } from "@/lib/tenant";

const categoryEnum = z.enum(["singles", "sealed", "graded"]);
const conditionField = z
  .union([z.literal(""), z.enum(ALL_CONDITION_VALUES as [string, ...string[]])])
  .nullish()
  .transform((v) => (v ? v : null));

// ===== Sessions =====

export async function openShowSession(formData: FormData) {
  const session = await requireSession();
  const shopId = await getCurrentShopId();
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  await openSession(shopId, name || "Show", session.userId);
  revalidatePath("/admin/show");
}

export async function closeShowSession(formData: FormData) {
  await requireSession();
  const shopId = await getCurrentShopId();
  const id = z.string().uuid().parse(formData.get("sessionId"));
  await closeSession(shopId, id);
  revalidatePath("/admin/show");
  revalidatePath(`/admin/show/${id}`);
}

export async function deleteShowSession(formData: FormData) {
  await requireSession();
  const shopId = await getCurrentShopId();
  const id = z.string().uuid().parse(formData.get("sessionId"));
  await deleteSession(shopId, id);
  revalidatePath("/admin/show");
  revalidatePath("/admin/inventory");
  redirect("/admin/show");
}

// ===== Pricing preview (called from the client when a card is picked) =====

const priceSchema = z.object({
  productId: z.number().int().positive(),
  condition: conditionField,
  printing: z.string().max(60).nullish().transform((v) => v ?? null),
});

export type LinePrices = {
  sellUnit: number | null;
  buyCashUnit: number | null;
  buyCreditUnit: number | null;
};

/** Unit sell price + cash/credit buy offers for a single catalog product. */
export async function priceLine(
  input: z.infer<typeof priceSchema>,
): Promise<LinePrices> {
  await requireSession();
  const shopId = await getCurrentShopId();
  const parsed = priceSchema.safeParse(input);
  if (!parsed.success) {
    return { sellUnit: null, buyCashUnit: null, buyCreditUnit: null };
  }
  const { productId, condition, printing } = parsed.data;
  const settings = await getSettings(shopId);

  const sellUnit = await sellUnitPrice(settings, productId, printing, condition);

  const item = { productId, quantity: 1, condition, printing };
  const [cashQ, creditQ] = await Promise.all([
    quoteFromDb([item], "cash", settings, shopId).catch(() => null),
    quoteFromDb([item], "store_credit", settings, shopId).catch(() => null),
  ]);
  return {
    sellUnit,
    buyCashUnit: cashQ?.lines[0]?.unitCredit ?? null,
    buyCreditUnit: creditQ?.lines[0]?.unitCredit ?? null,
  };
}

// ===== Recording transactions =====

const lineBase = {
  sessionId: z.string().uuid(),
  productId: z.number().int().positive().nullable(),
  title: z.string().min(1).max(300),
  category: categoryEnum,
  condition: conditionField,
  printing: z.string().max(60).nullish().transform((v) => v ?? null),
  quantity: z.number().int().min(1).max(999),
  // When set, trust the operator's hand-keyed price instead of the engine.
  manualUnitPrice: z.number().min(0).max(1_000_000).nullish(),
};

const saleSchema = z.object(lineBase);
const purchaseSchema = z.object({
  ...lineBase,
  rateType: z.enum(["store_credit", "cash"]),
  inventoryAction: z.enum(["queued", "added"]),
});

export type TxnResult = { error?: string; ok?: boolean };

/** Guard: the session must exist for this shop and still be open. */
async function requireOpenSession(shopId: string, sessionId: string) {
  const session = await getSession(shopId, sessionId);
  if (!session) return { error: "Session not found" as const };
  if (session.status !== "open") return { error: "Session is closed" as const };
  return { ok: true as const };
}

export async function recordSale(
  input: z.infer<typeof saleSchema>,
): Promise<TxnResult> {
  await requireSession();
  const shopId = await getCurrentShopId();
  const parsed = saleSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid sale" };
  const d = parsed.data;

  const guard = await requireOpenSession(shopId, d.sessionId);
  if (guard.error) return { error: guard.error };

  const settings = await getSettings(shopId);
  let unitPrice: number | null;
  let manualPrice = false;
  if (d.manualUnitPrice != null) {
    unitPrice = d.manualUnitPrice;
    manualPrice = true;
  } else if (d.productId !== null) {
    unitPrice = await sellUnitPrice(
      settings,
      d.productId,
      d.printing,
      d.condition,
    );
  } else {
    unitPrice = null;
  }
  if (unitPrice === null) {
    return { error: "No price for this item — enter one by hand." };
  }

  await recordTransaction({
    shopId,
    sessionId: d.sessionId,
    kind: "sell",
    productId: d.productId,
    title: d.title,
    category: d.category,
    condition: d.condition,
    printing: d.printing,
    quantity: d.quantity,
    rateType: null,
    unitPrice,
    manualPrice,
    inventoryAction: null,
  });
  revalidatePath("/admin/show");
  return { ok: true };
}

export async function recordPurchase(
  input: z.infer<typeof purchaseSchema>,
): Promise<TxnResult> {
  await requireSession();
  const shopId = await getCurrentShopId();
  const parsed = purchaseSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid purchase" };
  const d = parsed.data;

  const guard = await requireOpenSession(shopId, d.sessionId);
  if (guard.error) return { error: guard.error };

  const settings = await getSettings(shopId);
  let unitPrice: number | null;
  let manualPrice = false;
  if (d.manualUnitPrice != null) {
    unitPrice = d.manualUnitPrice;
    manualPrice = true;
  } else if (d.productId !== null) {
    const quote = await quoteFromDb(
      [
        {
          productId: d.productId,
          quantity: 1,
          condition: d.condition,
          printing: d.printing,
        },
      ],
      d.rateType,
      settings,
      shopId,
    ).catch(() => null);
    unitPrice = quote?.lines[0]?.unitCredit ?? null;
  } else {
    unitPrice = null;
  }
  if (unitPrice === null) {
    return { error: "No price for this item — enter one by hand." };
  }

  await recordTransaction({
    shopId,
    sessionId: d.sessionId,
    kind: "buy",
    productId: d.productId,
    title: d.title,
    category: d.category,
    condition: d.condition,
    printing: d.printing,
    quantity: d.quantity,
    rateType: d.rateType,
    unitPrice,
    manualPrice,
    inventoryAction: d.inventoryAction,
  });
  revalidatePath("/admin/show");
  return { ok: true };
}

const inventorySaleSchema = z.object({
  sessionId: z.string().uuid(),
  inventoryItemId: z.string().uuid(),
  quantity: z.number().int().min(1).max(999).optional().default(1),
});

/** One-tap "My case" sale: sell a specific inventory row at its list price. */
export async function recordInventorySale(
  input: z.infer<typeof inventorySaleSchema>,
): Promise<TxnResult> {
  await requireSession();
  const shopId = await getCurrentShopId();
  const parsed = inventorySaleSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid sale" };
  const { sessionId, inventoryItemId, quantity } = parsed.data;

  const guard = await requireOpenSession(shopId, sessionId);
  if (guard.error) return { error: guard.error };

  const res = await sellInventoryRow(shopId, sessionId, inventoryItemId, quantity);
  if (!res.ok) return { error: res.error };
  revalidatePath("/admin/show");
  return { ok: true };
}

/** Operator starts a multi-card trade at the counter: an empty pending pile
    built with the same add/edit/accept flow customer QR piles use. */
export async function startOperatorTrade(formData: FormData) {
  await requireSession();
  const shopId = await getCurrentShopId();
  const sessionId = z.string().uuid().parse(formData.get("sessionId"));
  const guard = await requireOpenSession(shopId, sessionId);
  if (guard.error) return;
  await createPendingTrade({
    shopId,
    sessionId,
    label: "Counter trade",
    rateType: "store_credit",
    lines: [],
  });
  revalidatePath("/admin/show");
}

const pileCashSchema = z.object({
  pendingId: z.string().uuid(),
  toThem: z.number().min(0).max(1_000_000).optional().default(0),
  fromThem: z.number().min(0).max(1_000_000).optional().default(0),
});

/**
 * Set the cash settle ON a trade — the negotiation fudge factor. Stored with
 * the pile and shown in its net; the ledger transactions are recorded once,
 * automatically, when the trade closes (all lines accepted).
 */
export async function setPileCash(
  input: z.infer<typeof pileCashSchema>,
): Promise<TxnResult> {
  await requireSession();
  const shopId = await getCurrentShopId();
  const parsed = pileCashSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid amount" };
  const { pendingId, toThem, fromThem } = parsed.data;
  const res = await setPendingTradeCash(shopId, pendingId, toThem, fromThem);
  if (!res.ok) return { error: res.error };
  revalidatePath("/admin/show");
  return { ok: true };
}

export async function voidShowTransaction(formData: FormData) {
  await requireSession();
  const shopId = await getCurrentShopId();
  const sessionId = z.string().uuid().parse(formData.get("sessionId"));
  const txnId = z.string().uuid().parse(formData.get("txnId"));
  await voidTransaction(shopId, sessionId, txnId);
  revalidatePath("/admin/show");
  revalidatePath(`/admin/show/${sessionId}`);
}

export async function deleteDealAction(formData: FormData) {
  await requireSession();
  const shopId = await getCurrentShopId();
  const sessionId = z.string().uuid().parse(formData.get("sessionId"));
  const dealId = z.string().uuid().parse(formData.get("dealId"));
  await deleteDeal(shopId, sessionId, dealId);
  revalidatePath("/admin/show");
  revalidatePath(`/admin/show/${sessionId}`);
  revalidatePath("/admin/inventory");
}

export async function addQueuedBuys(formData: FormData) {
  await requireSession();
  const shopId = await getCurrentShopId();
  const sessionId = z.string().uuid().parse(formData.get("sessionId"));
  await addQueuedToInventory(shopId, sessionId);
  revalidatePath("/admin/show");
  revalidatePath(`/admin/show/${sessionId}`);
  revalidatePath("/admin/inventory");
}

// ===== Booth: reviewing customer-built pending trades =====

/** Live count of pending piles — polled by the Show client. */
export async function pendingCount(sessionId: string): Promise<number> {
  await requireSession();
  const shopId = await getCurrentShopId();
  const id = z.string().uuid().safeParse(sessionId);
  if (!id.success) return 0;
  return countPendingTrades(shopId, id.data);
}

const acceptLineSchema = z.object({
  itemId: z.string().uuid(),
  inventoryAction: z.enum(["added", "queued"]).optional().default("added"),
  manualUnitPrice: z.number().min(0).max(1_000_000).nullish(),
});

/** Accept one pending line; pass manualUnitPrice for graded/$0/unpriced lines. */
export async function acceptPendingLine(
  input: z.infer<typeof acceptLineSchema>,
): Promise<TxnResult & { needsManual?: boolean }> {
  await requireSession();
  const shopId = await getCurrentShopId();
  const parsed = acceptLineSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid line" };
  const { itemId, inventoryAction, manualUnitPrice } = parsed.data;
  const res = await acceptPendingItem(shopId, itemId, {
    inventoryAction,
    manualUnitPrice: manualUnitPrice ?? undefined,
  });
  revalidatePath("/admin/show");
  if (!res.ok) return { error: res.error, needsManual: res.needsManual };
  return { ok: true };
}

const acceptPileSchema = z.object({
  pendingId: z.string().uuid(),
  inventoryAction: z.enum(["added", "queued"]).optional().default("added"),
});

export type AcceptPileResult = {
  ok?: boolean;
  error?: string;
  accepted?: number;
  skipped?: string[];
};

/** Accept all auto-priceable lines; returns which lines still need a hand price. */
export async function acceptPendingPile(
  input: z.infer<typeof acceptPileSchema>,
): Promise<AcceptPileResult> {
  await requireSession();
  const shopId = await getCurrentShopId();
  const parsed = acceptPileSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid pile" };
  const res = await acceptPendingTrade(shopId, parsed.data.pendingId, {
    inventoryAction: parsed.data.inventoryAction,
  });
  revalidatePath("/admin/show");
  if (!res.ok) return { error: res.error };
  return { ok: true, accepted: res.accepted, skipped: res.skipped };
}

export async function dismissPendingPile(formData: FormData) {
  await requireSession();
  const shopId = await getCurrentShopId();
  const pendingId = z.string().uuid().parse(formData.get("pendingId"));
  await dismissPendingTrade(shopId, pendingId);
  revalidatePath("/admin/show");
}

const updatePendingSchema = z.object({
  itemId: z.string().uuid(),
  condition: conditionField.optional(),
  quantity: z.number().int().min(1).max(999).optional(),
});

/** Re-grade or re-quantify a pending line; it reprices on the next render. */
export async function updatePendingLine(
  input: z.infer<typeof updatePendingSchema>,
): Promise<TxnResult> {
  await requireSession();
  const shopId = await getCurrentShopId();
  const parsed = updatePendingSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid edit" };
  const { itemId, condition, quantity } = parsed.data;
  const res = await updatePendingItem(shopId, itemId, { condition, quantity });
  if (!res.ok) return { error: res.error };
  revalidatePath("/admin/show");
  return { ok: true };
}

const addPendingSchema = z.object({
  pendingId: z.string().uuid(),
  side: z.enum(["give", "want"]),
  productId: z.number().int().positive(),
  title: z.string().min(1).max(300),
  category: categoryEnum,
  condition: conditionField,
  printing: z.string().max(60).nullish().transform((v) => v ?? null),
  quantity: z.number().int().min(1).max(999),
});

/** Add a card to a pending pile (last-minute change of heart at the table). */
export async function addPendingLine(
  input: z.infer<typeof addPendingSchema>,
): Promise<TxnResult> {
  await requireSession();
  const shopId = await getCurrentShopId();
  const parsed = addPendingSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid card" };
  const d = parsed.data;
  const res = await addPendingItem(shopId, d.pendingId, {
    side: d.side,
    productId: d.productId,
    inventoryItemId: null,
    title: d.title,
    category: d.category,
    condition: d.condition,
    printing: d.printing,
    quantity: d.quantity,
  });
  if (!res.ok) return { error: res.error };
  revalidatePath("/admin/show");
  return { ok: true };
}

export async function removePendingLine(formData: FormData) {
  await requireSession();
  const shopId = await getCurrentShopId();
  const itemId = z.string().uuid().parse(formData.get("itemId"));
  await removePendingItem(shopId, itemId);
  revalidatePath("/admin/show");
}
