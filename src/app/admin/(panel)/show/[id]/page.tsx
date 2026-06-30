import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getSession,
  listTransactions,
  sessionTotals,
} from "@/lib/show";
import { getCurrentShopId } from "@/lib/tenant";
import { addQueuedBuys, closeShowSession } from "../actions";
import { DeleteSessionButton } from "./delete-session-button";

export const dynamic = "force-dynamic";

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const shopId = await getCurrentShopId();
  const session = await getSession(shopId, id);
  if (!session) notFound();

  const transactions = await listTransactions(shopId, id);
  const totals = sessionTotals(transactions);
  const isOpen = session.status === "open";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/admin/show"
            className="text-sm text-emerald-700 hover:underline"
          >
            ← Show Mode
          </Link>
          <h1 className="text-xl font-semibold">{session.name}</h1>
          <p className="text-sm text-neutral-500">
            {session.openedAt?.toLocaleString() ?? ""}
            {" · "}
            <span className={isOpen ? "text-emerald-700" : "text-neutral-500"}>
              {isOpen ? "open" : "closed"}
            </span>
          </p>
        </div>
        <a
          href={`/admin/show/${id}/export`}
          className="rounded-lg border bg-white px-4 py-2 text-sm font-medium shadow-sm hover:border-emerald-400"
        >
          Export CSV
        </a>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Bought" value={`${totals.boughtUnits}`} />
        <Stat label="Paid out" value={money(totals.paidOut)} tone="out" />
        <Stat label="Sold" value={`${totals.soldUnits}`} />
        <Stat label="Taken in" value={money(totals.takenIn)} tone="in" />
      </div>
      <div className="rounded-lg border bg-white p-4 text-center shadow-sm">
        <p className="text-xs uppercase tracking-wide text-neutral-400">
          Net cash on the day
        </p>
        <p
          className={`text-2xl font-bold tabular-nums ${
            totals.net >= 0 ? "text-emerald-700" : "text-red-600"
          }`}
        >
          {money(totals.net)}
        </p>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        {totals.queuedLines > 0 && (
          <form action={addQueuedBuys}>
            <input type="hidden" name="sessionId" value={id} />
            <button
              type="submit"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Add {totals.queuedLines} queued buy
              {totals.queuedLines === 1 ? "" : "s"} to inventory
            </button>
          </form>
        )}
        {isOpen ? (
          <form action={closeShowSession}>
            <input type="hidden" name="sessionId" value={id} />
            <button
              type="submit"
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              End show
            </button>
          </form>
        ) : (
          <Link
            href="/admin/show"
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
          >
            Start a new session
          </Link>
        )}
        <DeleteSessionButton sessionId={id} />
      </div>

      {/* Ledger */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">
          Transactions ({transactions.length})
        </h2>
        {transactions.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-neutral-500">
            No transactions in this session.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full text-sm">
              <thead className="border-b bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Qty</th>
                  <th className="px-3 py-2">Pay</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                          t.kind === "buy"
                            ? "bg-neutral-800 text-white"
                            : "bg-emerald-600 text-white"
                        }`}
                      >
                        {t.kind}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-medium">{t.title}</span>
                      <span className="block text-xs text-neutral-500">
                        {t.condition ?? ""}
                        {t.printing ? ` · ${t.printing}` : ""}
                        {t.manualPrice ? " · manual" : ""}
                        {t.kind === "buy" && t.inventoryAction
                          ? ` · ${t.inventoryAction}`
                          : ""}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{t.quantity}</td>
                    <td className="px-3 py-2 text-xs text-neutral-500">
                      {t.kind === "buy"
                        ? t.rateType === "cash"
                          ? "cash"
                          : "credit"
                        : "—"}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-semibold tabular-nums ${
                        t.kind === "buy" ? "text-red-600" : "text-emerald-700"
                      }`}
                    >
                      {t.kind === "buy" ? "−" : "+"}
                      {money(t.lineTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "in" | "out";
}) {
  const color =
    tone === "in"
      ? "text-emerald-700"
      : tone === "out"
        ? "text-red-600"
        : "text-neutral-800";
  return (
    <div className="rounded-lg border bg-white p-3 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-neutral-400">
        {label}
      </p>
      <p className={`text-lg font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}
