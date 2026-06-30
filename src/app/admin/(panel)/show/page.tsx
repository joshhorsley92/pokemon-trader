import { headers } from "next/headers";
import Link from "next/link";
import QRCode from "qrcode";
import { reachableBaseUrl } from "@/lib/lan";
import {
  getOpenSession,
  listPendingTrades,
  listRecentSessions,
  listTransactions,
  sessionTotals,
} from "@/lib/show";
import { getCurrentShopId } from "@/lib/tenant";
import { openShowSession } from "./actions";
import { ShowClient } from "./show-client";

export const metadata = { title: "Show Mode" };
export const dynamic = "force-dynamic";

export default async function ShowPage() {
  const shopId = await getCurrentShopId();
  const open = await getOpenSession(shopId);

  if (!open) {
    const recent = await listRecentSessions(shopId, 10);
    return (
      <div className="mx-auto max-w-lg space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Show Mode</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Start a session to buy and sell at the booth. Everything is logged
            for end-of-show reconciliation.
          </p>
        </div>
        <form
          action={openShowSession}
          className="flex gap-2 rounded-lg border bg-white p-4 shadow-sm"
        >
          <input
            name="name"
            required
            maxLength={120}
            placeholder="e.g. Spring Card Show — Sat"
            className="min-w-0 flex-1 rounded-lg border px-3 py-2.5 text-base outline-none ring-emerald-300 focus:ring-2"
          />
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-emerald-600 px-5 py-2.5 font-semibold text-white hover:bg-emerald-700"
          >
            Start
          </button>
        </form>

        {recent.length > 0 && (
          <div>
            <h2 className="mb-2 text-sm font-semibold text-neutral-700">
              Past sessions
            </h2>
            <ul className="space-y-1.5">
              {recent.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/admin/show/${s.id}`}
                    className="flex items-center justify-between rounded-lg border bg-white px-3 py-2.5 text-sm hover:border-emerald-400"
                  >
                    <span className="font-medium">{s.name}</span>
                    <span className="text-xs text-neutral-500">
                      {s.openedAt?.toLocaleDateString() ?? ""}
                      {s.status === "open" ? " · open" : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  const [transactions, pending] = await Promise.all([
    listTransactions(shopId, open.id),
    listPendingTrades(shopId, open.id),
  ]);
  const totals = sessionTotals(transactions);

  // Booth link + QR (offline-generated SVG). The base URL is resolved to
  // something another device can reach — if admin was opened on localhost, the
  // machine's LAN IP is swapped in so a phone scan actually loads.
  let boothUrl: string | null = null;
  let qrSvg: string | null = null;
  if (open.joinToken) {
    const h = await headers();
    const base = reachableBaseUrl(
      h.get("host"),
      h.get("x-forwarded-proto") ?? "http",
    );
    if (base) {
      boothUrl = `${base}/booth/${open.joinToken}`;
      qrSvg = await QRCode.toString(boothUrl, {
        type: "svg",
        margin: 1,
        width: 220,
      });
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <ShowClient
        sessionId={open.id}
        sessionName={open.name}
        transactions={transactions}
        totals={totals}
        pending={pending}
        boothUrl={boothUrl}
        qrSvg={qrSvg}
      />
    </div>
  );
}
