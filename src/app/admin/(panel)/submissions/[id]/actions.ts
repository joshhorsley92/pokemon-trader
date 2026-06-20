"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, tables } from "@/db";
import { requireSession } from "@/lib/auth";
import { sendCustomerStatusEmail } from "@/lib/email";
import { getSettings } from "@/lib/settings";
import { getCurrentShopId } from "@/lib/tenant";

const statusSchema = z.enum([
  "pending",
  "under_review",
  "countered",
  "accepted",
  "declined",
  "expired",
  "completed",
]);

async function notifyCustomer(
  shopId: string,
  submissionId: string,
  note?: string | null,
) {
  const [s] = await db
    .select()
    .from(tables.submissions)
    .where(
      and(
        eq(tables.submissions.shopId, shopId),
        eq(tables.submissions.id, submissionId),
      ),
    );
  if (!s) return;
  const settings = await getSettings(shopId);
  await sendCustomerStatusEmail({
    shopName: settings.shop_name,
    customerEmail: s.customerEmail,
    customerName: s.customerName,
    status: s.status,
    publicToken: s.publicToken,
    note,
  });
}

export async function updateStatus(formData: FormData) {
  const session = await requireSession();
  const shopId = await getCurrentShopId();
  const id = String(formData.get("id"));
  const status = statusSchema.parse(formData.get("status"));
  const notify = formData.get("notify") === "on";
  const adminNotes = String(formData.get("adminNotes") ?? "") || null;

  await db
    .update(tables.submissions)
    .set({
      status,
      adminNotes,
      reviewedBy: session.userId,
      updatedAt: new Date(),
    })
    .where(
      and(eq(tables.submissions.shopId, shopId), eq(tables.submissions.id, id)),
    );

  if (notify) await notifyCustomer(shopId, id, adminNotes);
  revalidatePath(`/admin/submissions/${id}`);
  revalidatePath("/admin");
}

const counterSchema = z.object({
  id: z.string().uuid(),
  notify: z.boolean(),
  adminNotes: z.string().max(2000).nullable(),
  lines: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        counterUnitCredit: z.number().min(0).max(1_000_000),
      }),
    )
    .min(1),
});

export type CounterState = { error?: string; success?: boolean };

export async function saveCounterOffer(
  _prev: CounterState,
  formData: FormData,
): Promise<CounterState> {
  const session = await requireSession();
  const linesRaw = formData.getAll("lineId").map((lineId, i) => ({
    lineId: String(lineId),
    counterUnitCredit: Number(formData.getAll("counterUnitCredit")[i]),
  }));
  const parsed = counterSchema.safeParse({
    id: formData.get("id"),
    notify: formData.get("notify") === "on",
    adminNotes: String(formData.get("adminNotes") ?? "") || null,
    lines: linesRaw,
  });
  if (!parsed.success) {
    return { error: "Invalid counter-offer values" };
  }
  const { id, notify, adminNotes, lines } = parsed.data;
  const shopId = await getCurrentShopId();

  // Verify the submission belongs to this shop before touching its lines.
  const [owned] = await db
    .select({ id: tables.submissions.id })
    .from(tables.submissions)
    .where(
      and(eq(tables.submissions.shopId, shopId), eq(tables.submissions.id, id)),
    );
  if (!owned) return { error: "Submission not found" };

  const items = await db
    .select()
    .from(tables.submissionTradeInItems)
    .where(eq(tables.submissionTradeInItems.submissionId, id));
  const itemById = new Map(items.map((i) => [i.id, i]));

  let totalCents = 0;
  for (const line of lines) {
    const item = itemById.get(line.lineId);
    if (!item) return { error: "Line item mismatch" };
    totalCents += Math.round(line.counterUnitCredit * 100) * item.quantity;
  }

  await db.transaction(async (tx) => {
    for (const line of lines) {
      await tx
        .update(tables.submissionTradeInItems)
        .set({ counterUnitCredit: line.counterUnitCredit.toFixed(2) })
        .where(eq(tables.submissionTradeInItems.id, line.lineId));
    }
    await tx
      .update(tables.submissions)
      .set({
        status: "countered",
        counterTotal: (totalCents / 100).toFixed(2),
        adminNotes,
        reviewedBy: session.userId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tables.submissions.shopId, shopId),
          eq(tables.submissions.id, id),
        ),
      );
  });

  if (notify) await notifyCustomer(shopId, id, adminNotes);
  revalidatePath(`/admin/submissions/${id}`);
  revalidatePath("/admin");
  return { success: true };
}
