/**
 * Email via Resend. All sends are best-effort: a failed or unconfigured email
 * never blocks a submission — owners can still see everything in the admin.
 */
import { Resend } from "resend";

function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

const FROM = () => process.env.EMAIL_FROM ?? "onboarding@resend.dev";
const SITE = () => process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export async function sendOwnerNewSubmission(opts: {
  notifyEmails: string[];
  shopName: string;
  customerName: string;
  submissionId: string;
  tradeInTotal: number;
  tradeForTotal: number;
  itemSummary: string;
}): Promise<void> {
  const client = getClient();
  if (!client || opts.notifyEmails.length === 0) return;
  try {
    await client.emails.send({
      from: FROM(),
      to: opts.notifyEmails,
      subject: `New trade proposal from ${opts.customerName} — $${opts.tradeInTotal.toFixed(2)} credit`,
      text: [
        `${opts.customerName} submitted a trade proposal.`,
        ``,
        `Trade-in credit: $${opts.tradeInTotal.toFixed(2)}`,
        `Requested items: $${opts.tradeForTotal.toFixed(2)}`,
        ``,
        opts.itemSummary,
        ``,
        `Review: ${SITE()}/admin/submissions/${opts.submissionId}`,
      ].join("\n"),
    });
  } catch (err) {
    console.error("Owner notification email failed:", err);
  }
}

export async function sendOwnerNote(opts: {
  notifyEmails: string[];
  subject: string;
  lines: string[];
}): Promise<void> {
  const client = getClient();
  if (!client || opts.notifyEmails.length === 0) return;
  try {
    await client.emails.send({
      from: FROM(),
      to: opts.notifyEmails,
      subject: opts.subject,
      text: opts.lines.join("\n"),
    });
  } catch (err) {
    console.error("Owner note email failed:", err);
  }
}

export async function sendCustomerStatusEmail(opts: {
  shopName: string;
  customerEmail: string;
  customerName: string;
  status: string;
  publicToken: string;
  note?: string | null;
}): Promise<void> {
  const client = getClient();
  if (!client) return;
  const statusLine: Record<string, string> = {
    pending: "We received your trade proposal and will review it shortly.",
    accepted: "Good news — your trade proposal was accepted!",
    declined: "Unfortunately we had to decline your trade proposal.",
    countered:
      "We reviewed your trade and made a counter-offer. Take a look and let us know.",
    completed: "Your trade is complete. Thanks for trading with us!",
  };
  try {
    await client.emails.send({
      from: FROM(),
      to: opts.customerEmail,
      subject: `${opts.shopName} — trade proposal ${opts.status.replace("_", " ")}`,
      text: [
        `Hi ${opts.customerName},`,
        ``,
        statusLine[opts.status] ?? `Your trade status is now: ${opts.status}.`,
        ...(opts.note ? [``, `Note from the shop: ${opts.note}`] : []),
        ``,
        `View your trade: ${SITE()}/quote/${opts.publicToken}`,
      ].join("\n"),
    });
  } catch (err) {
    console.error("Customer status email failed:", err);
  }
}
