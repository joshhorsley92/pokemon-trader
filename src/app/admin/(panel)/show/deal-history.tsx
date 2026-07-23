import type { DealView } from "@/lib/show";
import { DeleteDealButton } from "./delete-deal-button";

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Reopenable history of closed deals. Native <details> so it renders the same
 * from the live Show screen (client tree) and the session summary (server).
 */
export function DealHistory({
  deals,
  sessionId,
}: {
  deals: DealView[];
  sessionId: string;
}) {
  if (deals.length === 0) return null;
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-neutral-700">
        Past deals ({deals.length})
      </h2>
      <ul className="space-y-1.5">
        {deals.map((d) => (
          <li key={d.id}>
            <DealCard deal={d} sessionId={sessionId} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function DealCard({ deal, sessionId }: { deal: DealView; sessionId: string }) {
  const dismissed = deal.status === "dismissed";
  const net = deal.takenIn - deal.paidOut;
  return (
    <details className="rounded-lg border bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
            dismissed
              ? "bg-neutral-200 text-neutral-500"
              : "bg-emerald-600 text-white"
          }`}
        >
          {dismissed ? "Dismissed" : "Done"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {deal.label || "Walk-up"}
          </span>
          <span className="block text-xs text-neutral-500">
            {deal.createdAt
              ? deal.createdAt.toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })
              : ""}
            {" · "}
            {deal.items.length} line{deal.items.length === 1 ? "" : "s"}
          </span>
        </span>
        {!dismissed && (
          <span
            className={`shrink-0 text-sm font-semibold tabular-nums ${
              net >= 0 ? "text-emerald-700" : "text-red-600"
            }`}
          >
            {net >= 0 ? "+" : "−"}
            {money(Math.abs(net))}
          </span>
        )}
        <span aria-hidden="true" className="shrink-0 text-neutral-400">
          ▸
        </span>
        <DeleteDealButton sessionId={sessionId} dealId={deal.id} />
      </summary>

      <div className="border-t px-3 py-2.5">
        {dismissed ? (
          <>
            <p className="mb-1.5 text-xs text-neutral-500">
              Dismissed — nothing was recorded. The pile contained:
            </p>
            <ul className="space-y-0.5 text-sm">
              {deal.items.map((it) => (
                <li key={it.id} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate text-neutral-600">
                    {it.quantity}× {it.title}
                    {it.condition ? ` · ${it.condition}` : ""}
                    {it.graded ? " · graded" : ""}
                  </span>
                  <span className="shrink-0 text-xs uppercase text-neutral-400">
                    {it.side === "give" ? "theirs" : "yours"}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : deal.txns.length === 0 ? (
          <p className="text-xs text-neutral-500">
            Recorded before deal-linking — see the session ledger for its
            lines.
          </p>
        ) : (
          <>
            <ul className="space-y-1 text-sm">
              {deal.txns.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      t.kind === "buy"
                        ? "bg-neutral-800 text-white"
                        : "bg-emerald-600 text-white"
                    }`}
                  >
                    {t.kind}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {t.quantity}× {t.title}
                    {t.condition ? (
                      <span className="text-neutral-400"> · {t.condition}</span>
                    ) : null}
                    {t.manualPrice ? (
                      <span className="text-neutral-400"> · manual</span>
                    ) : null}
                  </span>
                  <span
                    className={`shrink-0 font-semibold tabular-nums ${
                      t.kind === "buy" ? "text-red-600" : "text-emerald-700"
                    }`}
                  >
                    {t.kind === "buy" ? "−" : "+"}
                    {money(t.lineTotal)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-baseline justify-between border-t pt-1.5 text-xs text-neutral-500">
              <span>
                Paid {money(deal.paidOut)} · collected {money(deal.takenIn)}
              </span>
              <span
                className={`text-sm font-bold tabular-nums ${
                  net >= 0 ? "text-emerald-700" : "text-red-600"
                }`}
              >
                net {net >= 0 ? "+" : "−"}
                {money(Math.abs(net))}
              </span>
            </div>
          </>
        )}
      </div>
    </details>
  );
}
