import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { isQuoteExpired } from "@/lib/expiry";
import { getSettings } from "@/lib/settings";
import { RespondButtons } from "./respond-buttons";

export const metadata = { title: "Your deal slip" };
export const dynamic = "force-dynamic";

function money(n: number | string): string {
  return Number(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

const STATUS_COPY: Record<string, { stamp: string; line: string }> = {
  pending: {
    stamp: "Received",
    line: "Your proposal is on the counter. We'll look it over and get back to you, usually within a day.",
  },
  under_review: {
    stamp: "Reviewing",
    line: "We've got your proposal in hand and we're checking everything over.",
  },
  countered: {
    stamp: "Counter-offer",
    line: "We've adjusted some numbers — check your email and let us know if the new deal works.",
  },
  accepted: {
    stamp: "Deal!",
    line: "We accepted your trade. Check your email for next steps on getting your items to us.",
  },
  declined: {
    stamp: "No deal",
    line: "We couldn't make this one work. Check your email for the why — and feel free to bring something else to the counter.",
  },
  expired: {
    stamp: "Expired",
    line: "This quote has expired — prices move fast. Build a fresh trade any time.",
  },
  completed: {
    stamp: "Traded",
    line: "This trade is done and dusted. Pleasure doing business with you!",
  },
};

export default async function QuoteStatusPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [submission] = await db
    .select()
    .from(tables.submissions)
    .where(eq(tables.submissions.publicToken, token));
  if (!submission) notFound();

  const [tradeInItems, tradeForItems, settings] = await Promise.all([
    db
      .select()
      .from(tables.submissionTradeInItems)
      .where(eq(tables.submissionTradeInItems.submissionId, submission.id)),
    db
      .select()
      .from(tables.submissionTradeForItems)
      .where(eq(tables.submissionTradeForItems.submissionId, submission.id)),
    getSettings(submission.shopId),
  ]);

  const isExpired = isQuoteExpired(submission.status, submission.quoteExpiresAt);
  const status = isExpired ? "expired" : submission.status;
  const copy = STATUS_COPY[status] ?? STATUS_COPY.pending;
  const useCounter = status === "countered" || submission.counterTotal !== null;

  const creditTotal = useCounter && submission.counterTotal !== null
    ? Number(submission.counterTotal)
    : Number(submission.tradeInTotal);
  const wantsTotal = Number(submission.tradeForTotal);
  const balance = Math.round((creditTotal - wantsTotal) * 100) / 100;

  return (
    <div className="counter-felt flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-2xl items-center justify-between px-4 py-5">
        <Link
          href="/"
          className="font-display text-xl font-bold text-white hover:text-emerald-100"
        >
          {settings.shop_name}
        </Link>
        <Link
          href="/trade"
          className="text-sm text-emerald-100/80 hover:text-white"
        >
          Start another trade →
        </Link>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-16">
        <div className="deal-slip rounded-t-md px-6 pt-6 pb-5 font-slip text-sm">
          <div className="text-center">
            <p className="font-semibold uppercase tracking-widest">
              {settings.shop_name}
            </p>
            <p className="text-xs text-neutral-500">— deal slip —</p>
            <p className="mt-1 text-xs text-neutral-400">
              #{submission.publicToken.slice(0, 8)} ·{" "}
              {submission.createdAt?.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>

          <div className="mt-5 text-center">
            <span className="stamp text-xl">{copy.stamp}</span>
          </div>
          <p className="mx-auto mt-4 max-w-md text-center text-[13px] leading-relaxed text-neutral-600">
            {copy.line}
          </p>

          <div className="mt-6 border-t border-dashed border-neutral-300 pt-4">
            <p className="text-xs font-semibold uppercase text-neutral-500">
              You&apos;re trading in
            </p>
            <ul className="mt-2 space-y-1">
              {tradeInItems.map((item) => {
                const unit =
                  useCounter && item.counterUnitCredit !== null
                    ? Number(item.counterUnitCredit)
                    : Number(item.unitCredit);
                return (
                  <li key={item.id} className="flex justify-between gap-2">
                    <span className="min-w-0 flex-1 break-words leading-snug">
                      {item.quantity}× {item.productName}
                      <span className="block text-[11px] text-neutral-400">
                        {item.graded
                          ? `${item.grader ?? ""} ${item.grade ?? ""} · graded`
                          : item.condition}
                        {item.printing && ` · ${item.printing}`}
                      </span>
                    </span>
                    <span className="whitespace-nowrap tabular-nums">
                      {item.graded && item.counterUnitCredit === null
                        ? "custom offer"
                        : money(unit * item.quantity)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-2 flex items-baseline justify-between border-t border-neutral-200 pt-2">
              <span className="text-xs uppercase text-neutral-500">
                {submission.rateType === "store_credit"
                  ? "Trade credit"
                  : "Cash offer"}
                {useCounter && " (countered)"}
              </span>
              <span className="text-base font-semibold tabular-nums">
                {money(creditTotal)}
              </span>
            </div>
          </div>

          {tradeForItems.length > 0 && (
            <div className="mt-4 border-t border-dashed border-neutral-300 pt-4">
              <p className="text-xs font-semibold uppercase text-neutral-500">
                You picked from the case
              </p>
              <ul className="mt-2 space-y-1">
                {tradeForItems.map((item) => (
                  <li key={item.id} className="flex justify-between gap-2">
                    <span className="min-w-0 flex-1 break-words leading-snug">
                      {item.quantity}× {item.itemTitle}
                    </span>
                    <span className="whitespace-nowrap tabular-nums">
                      {money(Number(item.unitPrice) * item.quantity)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-baseline justify-between border-t border-neutral-200 pt-2">
                <span className="text-xs uppercase text-neutral-500">
                  Items total
                </span>
                <span className="text-base font-semibold tabular-nums">
                  {money(wantsTotal)}
                </span>
              </div>
            </div>
          )}

          <div className="mt-4 rounded-md p-[2px] holo-chip">
            <div className="rounded-[4px] bg-[var(--slip)] px-3 py-2">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-semibold uppercase">
                  {balance < 0
                    ? "Difference to settle"
                    : submission.takeCashRemainder &&
                        submission.remainderCashValue !== null
                      ? "Cash for the rest"
                      : "Credit left over"}
                </span>
                <span className="text-lg font-bold tabular-nums">
                  {money(
                    balance >= 0 &&
                      submission.takeCashRemainder &&
                      submission.remainderCashValue !== null
                      ? submission.remainderCashValue
                      : Math.abs(balance),
                  )}
                </span>
              </div>
              {balance >= 0 &&
                submission.takeCashRemainder &&
                submission.remainderCashValue !== null && (
                  <p className="mt-1 text-[11px] text-neutral-500">
                    leftover credit of {money(balance)} paid out at our cash
                    rate
                  </p>
                )}
            </div>
          </div>

          {status === "countered" && <RespondButtons token={token} />}

          <p className="mt-4 text-center text-[11px] text-neutral-400">
            quote good through{" "}
            {submission.quoteExpiresAt.toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
            })}{" "}
            · questions? just reply to your confirmation email
          </p>
        </div>
        <div className="deal-slip-tear" />
      </main>
    </div>
  );
}
