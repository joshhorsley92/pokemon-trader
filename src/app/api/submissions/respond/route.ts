import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, tables } from "@/db";
import { sendOwnerNote } from "@/lib/email";
import { getSettings } from "@/lib/settings";

const respondSchema = z.object({
  token: z.string().min(10).max(40),
  action: z.enum(["accept", "decline"]),
});

/**
 * Customer response to a counter-offer, authorized by their private quote
 * token. Only valid while the submission is in "countered" status.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = respondSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { token, action } = parsed.data;

  const [submission] = await db
    .select()
    .from(tables.submissions)
    .where(eq(tables.submissions.publicToken, token));
  if (!submission) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (submission.status !== "countered") {
    return NextResponse.json(
      { error: "This trade is no longer awaiting your response." },
      { status: 409 },
    );
  }

  const newStatus = action === "accept" ? "accepted" : "declined";
  await db
    .update(tables.submissions)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(tables.submissions.id, submission.id));

  const settings = await getSettings(submission.shopId);
  await sendOwnerNote({
    notifyEmails: settings.notify_emails,
    subject: `${submission.customerName} ${action === "accept" ? "ACCEPTED" : "declined"} your counter-offer`,
    lines: [
      `${submission.customerName} ${action === "accept" ? "accepted" : "declined"} the counter-offer of $${Number(
        submission.counterTotal ?? submission.tradeInTotal,
      ).toFixed(2)}.`,
      "",
      `Review: ${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/admin/submissions/${submission.id}`,
    ],
  });

  return NextResponse.json({ status: newStatus });
}
