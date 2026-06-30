"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { CONDITIONS, defaultCondition } from "@/lib/conditions";
import type { CatalogHit } from "@/components/trade/types";
import type {
  PendingTradeView,
  ShowTransaction,
  SessionTotals,
} from "@/lib/show";
import {
  acceptPendingLine,
  acceptPendingPile,
  addPendingLine,
  closeShowSession,
  dismissPendingPile,
  pendingCount,
  priceLine,
  recordCashAdjustment,
  recordPurchase,
  recordSale,
  removePendingLine,
  updatePendingLine,
  voidShowTransaction,
  type LinePrices,
} from "./actions";

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

type Category = "singles" | "sealed" | "graded";

export function ShowClient({
  sessionId,
  sessionName,
  transactions,
  totals,
  pending,
  boothUrl,
  qrSvg,
}: {
  sessionId: string;
  sessionName: string;
  transactions: ShowTransaction[];
  totals: SessionTotals;
  pending: PendingTradeView[];
  boothUrl: string | null;
  qrSvg: string | null;
}) {
  const [selected, setSelected] = useState<CatalogHit | null>(null);
  const router = useRouter();

  // Poll for new customer-submitted piles; refresh when the count changes.
  useEffect(() => {
    const seen = pending.length;
    const timer = setInterval(async () => {
      const n = await pendingCount(sessionId).catch(() => seen);
      if (n !== seen) router.refresh();
    }, 6000);
    return () => clearInterval(timer);
  }, [sessionId, pending.length, router]);

  return (
    <div className="space-y-4">
      {/* Running tally */}
      <div className="sticky top-0 z-10 -mx-4 border-b bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{sessionName}</p>
            <p className="text-xs text-neutral-500">
              {totals.boughtUnits} bought · {totals.soldUnits} sold
            </p>
          </div>
          <div className="flex items-center gap-3 text-right">
            <Tally label="Paid out" value={-totals.paidOut} tone="out" />
            <Tally label="Taken in" value={totals.takenIn} tone="in" />
            <Tally label="Net" value={totals.net} tone="net" big />
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-xs">
          {totals.queuedLines > 0 ? (
            <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
              {totals.queuedLines} buy{totals.queuedLines === 1 ? "" : "s"}{" "}
              queued for inventory
            </span>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Link
              href={`/admin/show/${sessionId}`}
              className="rounded-md border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Summary
            </Link>
            <form
              action={closeShowSession}
              onSubmit={(e) => {
                const warn =
                  totals.queuedLines > 0
                    ? `End the show? This stops the booth QR. You still have ${totals.queuedLines} buy${
                        totals.queuedLines === 1 ? "" : "s"
                      } queued — add them to inventory from the Summary after.`
                    : "End the show? This closes the session and stops the booth QR.";
                if (!confirm(warn)) e.preventDefault();
              }}
            >
              <input type="hidden" name="sessionId" value={sessionId} />
              <button
                type="submit"
                className="rounded-md bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-700"
              >
                End show
              </button>
            </form>
          </div>
        </div>
      </div>

      {boothUrl && qrSvg && <BoothPanel url={boothUrl} qrSvg={qrSvg} />}

      <CashPanel sessionId={sessionId} />

      {pending.length > 0 && <PendingPiles pending={pending} />}

      {selected ? (
        <EntryCard
          sessionId={sessionId}
          hit={selected}
          onDone={() => setSelected(null)}
        />
      ) : (
        <SearchBox onPick={setSelected} />
      )}

      {/* Recent activity */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">
          This session
        </h2>
        {transactions.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-neutral-500">
            No transactions yet — search a card to buy or sell.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {transactions.map((t) => (
              <TxnRow key={t.id} sessionId={sessionId} txn={t} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Tally({
  label,
  value,
  tone,
  big,
}: {
  label: string;
  value: number;
  tone: "in" | "out" | "net";
  big?: boolean;
}) {
  const color =
    tone === "net"
      ? value >= 0
        ? "text-emerald-700"
        : "text-red-600"
      : tone === "in"
        ? "text-emerald-700"
        : "text-red-600";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-neutral-400">
        {label}
      </p>
      <p
        className={`tabular-nums font-bold ${color} ${big ? "text-lg" : "text-sm"}`}
      >
        {money(value)}
      </p>
    </div>
  );
}

// ===== Search =====

function SearchBox({ onPick }: { onPick: (hit: CatalogHit) => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (query.trim().length < 2) {
        setHits([]);
        return;
      }
      setSearching(true);
      try {
        const res = await fetch(
          `/api/catalog/search?category=all&includeBelow=1&q=${encodeURIComponent(query)}`,
        );
        if (res.ok) setHits((await res.json()).results);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div>
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a card or sealed product…"
        className="w-full rounded-lg border bg-white px-4 py-3 text-base shadow-sm outline-none ring-emerald-300 focus:ring-2"
      />
      {searching && (
        <p className="mt-2 text-sm text-neutral-400">Searching…</p>
      )}
      {hits.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                onClick={() => onPick(hit)}
                className="flex w-full items-center gap-3 rounded-lg border bg-white p-2.5 text-left shadow-sm hover:border-emerald-400"
              >
                {hit.imageUrl ? (
                  <Image
                    src={hit.imageUrl}
                    alt=""
                    width={48}
                    height={48}
                    className="h-12 w-12 shrink-0 rounded object-contain"
                    unoptimized
                  />
                ) : (
                  <div className="h-12 w-12 shrink-0 rounded bg-neutral-100" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {hit.name}
                  </span>
                  <span className="block truncate text-xs text-neutral-500">
                    {hit.groupName}
                  </span>
                </span>
                {hit.marketPrice !== null && (
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-neutral-600">
                    mkt {money(hit.marketPrice)}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ===== Entry card =====

function EntryCard({
  sessionId,
  hit,
  onDone,
}: {
  sessionId: string;
  hit: CatalogHit;
  onDone: () => void;
}) {
  const category = hit.category as Category;
  const conditionOpts = CONDITIONS[category] ?? [];
  const [condition, setCondition] = useState<string | null>(
    defaultCondition(category),
  );
  const printingOpts = hit.printings ?? [];
  const [printing, setPrinting] = useState<string | null>(
    printingOpts[0]?.subType ?? null,
  );
  const [quantity, setQuantity] = useState(1);
  const [override, setOverride] = useState("");
  const [addToStock, setAddToStock] = useState(true);
  // Keyed to the priced inputs so stale prices clear automatically when the
  // condition/printing changes — no synchronous reset inside the effect.
  const priceKey = `${hit.id}|${condition ?? ""}|${printing ?? ""}`;
  const [priced, setPriced] = useState<{ key: string; prices: LinePrices } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Re-price whenever the condition/printing changes.
  useEffect(() => {
    let live = true;
    priceLine({ productId: hit.id, condition, printing }).then((p) => {
      if (live) setPriced({ key: priceKey, prices: p });
    });
    return () => {
      live = false;
    };
  }, [hit.id, condition, printing, priceKey]);

  const prices = priced?.key === priceKey ? priced.prices : null;

  const manual = override.trim() === "" ? null : Number(override);
  const manualValid = manual === null || (!Number.isNaN(manual) && manual >= 0);

  function commit(kind: "sell" | "buy", rate: "cash" | "store_credit" | null) {
    setError(null);
    startTransition(async () => {
      const base = {
        sessionId,
        productId: hit.id,
        title: hit.name,
        category,
        condition,
        printing,
        quantity,
        manualUnitPrice: manual,
      };
      const res =
        kind === "sell"
          ? await recordSale(base)
          : await recordPurchase({
              ...base,
              rateType: rate ?? "cash",
              inventoryAction: addToStock ? "added" : "queued",
            });
      if (res.error) {
        setError(res.error);
        return;
      }
      onDone();
    });
  }

  const sellUnit = manual ?? prices?.sellUnit ?? null;
  const buyCashUnit = manual ?? prices?.buyCashUnit ?? null;
  const buyCreditUnit = manual ?? prices?.buyCreditUnit ?? null;

  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        {hit.imageUrl ? (
          <Image
            src={hit.imageUrl}
            alt=""
            width={64}
            height={64}
            className="h-16 w-16 shrink-0 rounded object-contain"
            unoptimized
          />
        ) : (
          <div className="h-16 w-16 shrink-0 rounded bg-neutral-100" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug">{hit.name}</p>
          <p className="text-xs text-neutral-500">{hit.groupName}</p>
        </div>
        <button
          type="button"
          onClick={onDone}
          className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100"
          aria-label="Cancel"
        >
          ✕
        </button>
      </div>

      {/* Printing */}
      {printingOpts.length > 1 && (
        <select
          value={printing ?? ""}
          onChange={(e) => setPrinting(e.target.value)}
          className="mt-3 w-full rounded border px-2 py-1.5 text-sm"
        >
          {printingOpts.map((p) => (
            <option key={p.subType} value={p.subType}>
              {p.subType}
              {p.market !== null ? ` — ${money(p.market)}` : ""}
            </option>
          ))}
        </select>
      )}

      {/* Condition */}
      {conditionOpts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {conditionOpts.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCondition(c.value)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                condition === c.value
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "border-neutral-300 text-neutral-700 hover:bg-neutral-50"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* Qty + override */}
      <div className="mt-3 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">Qty</span>
          <Stepper value={quantity} onChange={setQuantity} />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-neutral-500">
          Override $
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.25"
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            placeholder="auto"
            className="w-20 rounded border px-2 py-1 text-sm"
          />
        </label>
      </div>

      {/* Buy destination toggle */}
      <div className="mt-3 flex items-center gap-1.5 text-xs">
        <span className="text-neutral-500">Bought cards:</span>
        <button
          type="button"
          onClick={() => setAddToStock(true)}
          className={`rounded px-2 py-1 font-medium ${
            addToStock ? "bg-emerald-100 text-emerald-800" : "text-neutral-500"
          }`}
        >
          Add to stock
        </button>
        <button
          type="button"
          onClick={() => setAddToStock(false)}
          className={`rounded px-2 py-1 font-medium ${
            !addToStock ? "bg-amber-100 text-amber-800" : "text-neutral-500"
          }`}
        >
          Queue
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded bg-red-50 px-2 py-1.5 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <ActionButton
          tone="sell"
          label="Sold"
          unit={sellUnit}
          qty={quantity}
          disabled={pending || !manualValid || sellUnit === null || sellUnit <= 0}
          onClick={() => commit("sell", null)}
        />
        <ActionButton
          tone="buy"
          label="Buy cash"
          unit={buyCashUnit}
          qty={quantity}
          disabled={
            pending || !manualValid || buyCashUnit === null || buyCashUnit <= 0
          }
          onClick={() => commit("buy", "cash")}
        />
        <ActionButton
          tone="buy"
          label="Buy credit"
          unit={buyCreditUnit}
          qty={quantity}
          disabled={
            pending ||
            !manualValid ||
            buyCreditUnit === null ||
            buyCreditUnit <= 0
          }
          onClick={() => commit("buy", "store_credit")}
        />
      </div>
      {!prices && manual === null && (
        <p className="mt-2 text-center text-xs text-neutral-400">Pricing…</p>
      )}
    </div>
  );
}

function ActionButton({
  tone,
  label,
  unit,
  qty,
  disabled,
  onClick,
}: {
  tone: "sell" | "buy";
  label: string;
  unit: number | null;
  qty: number;
  disabled: boolean;
  onClick: () => void;
}) {
  const base =
    tone === "sell"
      ? "bg-emerald-600 hover:bg-emerald-700"
      : "bg-neutral-800 hover:bg-neutral-900";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex flex-col items-center justify-center rounded-lg px-2 py-3 text-white shadow-sm transition-colors disabled:opacity-40 ${base}`}
    >
      <span className="text-xs font-medium">{label}</span>
      <span className="text-sm font-bold tabular-nums">
        {unit === null || unit <= 0 ? "—" : money(unit * qty)}
      </span>
    </button>
  );
}

function Stepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <StepBtn onClick={() => onChange(Math.max(1, value - 1))}>−</StepBtn>
      <span className="w-8 text-center text-sm font-semibold tabular-nums">
        {value}
      </span>
      <StepBtn onClick={() => onChange(Math.min(999, value + 1))}>+</StepBtn>
    </div>
  );
}

function StepBtn({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded border text-lg leading-none hover:bg-neutral-100"
    >
      {children}
    </button>
  );
}

// ===== Booth QR =====

function BoothPanel({ url, qrSvg }: { url: string; qrSvg: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium"
      >
        <span>📲 Customer self-checkout (QR)</span>
        <span className="text-neutral-400">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="border-t px-4 py-4 text-center">
          <p className="mb-3 text-xs text-neutral-500">
            Let the customer scan this to build their own trade — it lands here
            as a pile to approve.
          </p>
          <div
            className="mx-auto h-52 w-52 [&>svg]:h-full [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
          <p className="mt-3 break-all text-xs text-neutral-400">{url}</p>
        </div>
      )}
    </div>
  );
}

// ===== Cash adjustment (the negotiation fudge factor) =====

function CashPanel({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [toThem, setToThem] = useState("");
  const [fromThem, setFromThem] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    setError(null);
    const t = toThem.trim() === "" ? 0 : Number(toThem);
    const f = fromThem.trim() === "" ? 0 : Number(fromThem);
    if (Number.isNaN(t) || Number.isNaN(f) || t < 0 || f < 0) {
      setError("Enter a valid amount");
      return;
    }
    if (t <= 0 && f <= 0) {
      setError("Enter an amount");
      return;
    }
    startTransition(async () => {
      const res = await recordCashAdjustment({
        sessionId,
        toThem: t,
        fromThem: f,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setToThem("");
      setFromThem("");
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-lg border bg-white px-4 py-2.5 text-sm font-medium shadow-sm"
      >
        <span>💵 Cash adjustment</span>
        <span className="text-neutral-400">Add</span>
      </button>
    );
  }

  return (
    <div className="rounded-lg border bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">Final cash on the deal</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded p-1 text-neutral-400 hover:bg-neutral-100"
          aria-label="Cancel"
        >
          ✕
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-red-600">
            To them (you pay)
          </span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="1"
            value={toThem}
            onChange={(e) => setToThem(e.target.value)}
            placeholder="0"
            className="mt-1 w-full rounded border px-2 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-emerald-700">
            From them (you collect)
          </span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="1"
            value={fromThem}
            onChange={(e) => setFromThem(e.target.value)}
            placeholder="0"
            className="mt-1 w-full rounded border px-2 py-2 text-sm"
          />
        </label>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <button
        type="button"
        onClick={add}
        disabled={pending}
        className="mt-3 w-full rounded-lg bg-neutral-800 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-900 disabled:opacity-50"
      >
        Add to deal
      </button>
    </div>
  );
}

// ===== Pending piles (customer-built trades awaiting review) =====

function money2(n: number | null): string {
  return n === null ? "—" : money(n);
}

function PendingPiles({ pending }: { pending: PendingTradeView[] }) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-neutral-700">
        Waiting piles ({pending.length})
      </h2>
      {pending.map((p) => (
        <PendingPile key={p.id} pile={p} />
      ))}
    </div>
  );
}

function PendingPile({ pile }: { pile: PendingTradeView }) {
  const [addToStock, setAddToStock] = useState(true);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<
    { tone: "warn" | "error"; text: string } | null
  >(null);
  const liveItems = pile.items.filter((i) => i.status === "pending");
  const gives = liveItems.filter((i) => i.side === "give");
  const wants = liveItems.filter((i) => i.side === "want");
  // Net from the customer's side: what they give (you pay) minus what they take.
  const net = pile.giveTotal - pile.wantTotal;

  function acceptAll() {
    setNotice(null);
    startTransition(async () => {
      const res = await acceptPendingPile({
        pendingId: pile.id,
        inventoryAction: addToStock ? "added" : "queued",
      });
      if (res.error) {
        setNotice({ tone: "error", text: res.error });
      } else if (res.skipped && res.skipped.length > 0) {
        setNotice({
          tone: "warn",
          text: `Accepted ${res.accepted ?? 0}. Still need a hand price: ${res.skipped.join(", ")}`,
        });
      }
    });
  }

  return (
    <div className="rounded-lg border-2 border-amber-300 bg-amber-50/40 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            {pile.label || "Walk-up"}{" "}
            <span className="text-xs font-normal text-neutral-500">
              · wants {pile.rateType === "cash" ? "cash" : "credit"}
            </span>
          </p>
          <p className="text-xs text-neutral-500">
            They give {money2(pile.giveTotal)} · take {money2(pile.wantTotal)} ·{" "}
            <span className={net >= 0 ? "text-emerald-700" : "text-red-600"}>
              {net >= 0 ? "you pay " : "they owe "}
              {money(Math.abs(net))}
            </span>
          </p>
        </div>
      </div>

      {gives.length > 0 && (
        <PileSection title="They give (you buy)" tone="give">
          {gives.map((it) => (
            <PendingLine key={it.id} item={it} addToStock={addToStock} />
          ))}
        </PileSection>
      )}
      {wants.length > 0 && (
        <PileSection title="They want (you sell)" tone="want">
          {wants.map((it) => (
            <PendingLine key={it.id} item={it} addToStock={addToStock} />
          ))}
        </PileSection>
      )}

      <AddToPile pendingId={pile.id} />

      {gives.length > 0 && (
        <label className="mt-2 flex items-center gap-1.5 text-xs text-neutral-600">
          <input
            type="checkbox"
            checked={addToStock}
            onChange={(e) => setAddToStock(e.target.checked)}
          />
          Add bought cards to inventory now (uncheck to queue)
        </label>
      )}

      {notice && (
        <p
          className={`mt-2 rounded px-2 py-1.5 text-xs ${
            notice.tone === "error"
              ? "bg-red-50 text-red-700"
              : "bg-amber-100 text-amber-800"
          }`}
        >
          {notice.text}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={acceptAll}
          disabled={pending}
          className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Accept all
        </button>
        <form
          action={dismissPendingPile}
          onSubmit={(e) => {
            if (!confirm("Dismiss this customer's whole pile? It can't be undone."))
              e.preventDefault();
          }}
        >
          <input type="hidden" name="pendingId" value={pile.id} />
          <button
            type="submit"
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
          >
            Dismiss
          </button>
        </form>
      </div>
    </div>
  );
}

function PileSection({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "give" | "want";
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2">
      <p
        className={`text-[11px] font-semibold uppercase tracking-wide ${
          tone === "give" ? "text-neutral-700" : "text-emerald-700"
        }`}
      >
        {title}
      </p>
      <ul className="mt-1 space-y-1">{children}</ul>
    </div>
  );
}

function PendingLine({
  item,
  addToStock,
}: {
  item: PendingTradeView["items"][number];
  addToStock: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [override, setOverride] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isGive = item.side === "give";
  // Re-grading only makes sense for the customer's own cards (give side).
  const conditionOpts =
    isGive && !item.graded ? (CONDITIONS[item.category] ?? []) : [];
  const lineTotal =
    item.unitPrice === null ? null : item.unitPrice * item.quantity;
  // Graded slabs, unmatched cards, and $0-floored offers can't be auto-taken —
  // the operator types a price before this line can be accepted.
  const needsManual =
    item.graded || item.unitPrice === null || item.unitPrice <= 0;
  const overrideNum = override.trim() === "" ? null : Number(override);
  const overrideValid =
    overrideNum !== null && !Number.isNaN(overrideNum) && overrideNum > 0;
  const canAccept = !needsManual || overrideValid;

  function edit(patch: { condition?: string | null; quantity?: number }) {
    startTransition(async () => {
      await updatePendingLine({ itemId: item.id, ...patch });
    });
  }

  function accept() {
    setError(null);
    startTransition(async () => {
      const res = await acceptPendingLine({
        itemId: item.id,
        inventoryAction: addToStock ? "added" : "queued",
        manualUnitPrice: overrideValid ? overrideNum : undefined,
      });
      if (res.error) setError(res.error);
    });
  }

  return (
    <li
      className={`rounded border bg-white px-2 py-1.5 text-sm ${
        pending ? "opacity-60" : ""
      } ${needsManual ? "border-amber-400" : ""}`}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">
          {item.title}
          {item.graded && (
            <span className="ml-1.5 rounded bg-amber-200 px-1 py-0.5 text-[10px] font-bold uppercase text-amber-800">
              {item.grader ?? "Graded"} {item.grade ?? ""}
            </span>
          )}
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums">
          {needsManual && !overrideValid ? (
            <span className="text-amber-700">price it</span>
          ) : overrideValid ? (
            money(overrideNum * item.quantity)
          ) : (
            money2(lineTotal)
          )}
        </span>
        <button
          type="button"
          onClick={accept}
          disabled={!canAccept || pending}
          className="shrink-0 rounded bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          title={
            needsManual
              ? item.graded
                ? "Graded slab — type a price to accept"
                : "No auto price — type a price to accept"
              : "Accept this line"
          }
        >
          ✓
        </button>
        <form
          action={removePendingLine}
          onSubmit={(e) => {
            if (!confirm("Remove this line?")) e.preventDefault();
          }}
        >
          <input type="hidden" name="itemId" value={item.id} />
          <button
            type="submit"
            className="shrink-0 rounded p-1 text-neutral-300 hover:bg-red-50 hover:text-red-500"
            aria-label="Remove line"
          >
            ✕
          </button>
        </form>
      </div>

      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}

      {/* Hand price for graded / unpriced / $0 lines */}
      {needsManual && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="text-xs text-amber-700">
            {item.graded ? "Slab price $" : "Set price $"}
          </span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="1"
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            placeholder="0"
            className="w-20 rounded border px-2 py-1 text-sm"
          />
          <span className="text-[11px] text-neutral-400">each</span>
        </div>
      )}

      {/* Re-grade the customer's card on the spot */}
      {conditionOpts.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {conditionOpts.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => edit({ condition: c.value })}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                item.condition === c.value
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "border-neutral-300 text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              {c.value}
            </button>
          ))}
        </div>
      )}

      <div className="mt-1.5 flex items-center gap-2 text-xs text-neutral-500">
        <span>Qty</span>
        <StepBtn onClick={() => edit({ quantity: Math.max(1, item.quantity - 1) })}>
          −
        </StepBtn>
        <span className="w-6 text-center font-semibold tabular-nums text-neutral-800">
          {item.quantity}
        </span>
        <StepBtn
          onClick={() => edit({ quantity: Math.min(999, item.quantity + 1) })}
        >
          +
        </StepBtn>
        {item.printing && (
          <span className="truncate text-neutral-400">· {item.printing}</span>
        )}
      </div>
    </li>
  );
}

// ===== Add a card to a pending pile =====

function AddToPile({ pendingId }: { pendingId: string }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<CatalogHit | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 w-full rounded-lg border border-dashed border-neutral-300 py-2 text-sm font-medium text-neutral-600 hover:border-emerald-400 hover:text-emerald-700"
      >
        ＋ Add a card
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-dashed border-neutral-300 p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-neutral-600">
          Add a card to this deal
        </span>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setPicked(null);
          }}
          className="rounded p-1 text-neutral-400 hover:bg-neutral-100"
          aria-label="Cancel"
        >
          ✕
        </button>
      </div>
      {picked ? (
        <AddConfig
          pendingId={pendingId}
          hit={picked}
          onBack={() => setPicked(null)}
          onDone={() => {
            setPicked(null);
            setOpen(false);
          }}
        />
      ) : (
        <SearchBox onPick={setPicked} />
      )}
    </div>
  );
}

function AddConfig({
  pendingId,
  hit,
  onBack,
  onDone,
}: {
  pendingId: string;
  hit: CatalogHit;
  onBack: () => void;
  onDone: () => void;
}) {
  const category = hit.category as Category;
  const conditionOpts = CONDITIONS[category] ?? [];
  const [side, setSide] = useState<"give" | "want">("give");
  const [condition, setCondition] = useState<string | null>(
    defaultCondition(category),
  );
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    setError(null);
    startTransition(async () => {
      const res = await addPendingLine({
        pendingId,
        side,
        productId: hit.id,
        title: hit.name,
        category,
        condition: side === "give" ? condition : null,
        printing: hit.printings[0]?.subType ?? null,
        quantity,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      onDone();
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{hit.name}</p>
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-neutral-500 hover:underline"
        >
          change
        </button>
      </div>

      <div className="mt-2 flex gap-1 text-xs">
        <button
          type="button"
          onClick={() => setSide("give")}
          className={`flex-1 rounded px-2 py-1.5 font-medium ${
            side === "give"
              ? "bg-neutral-800 text-white"
              : "border border-neutral-300 text-neutral-600"
          }`}
        >
          They give (you buy)
        </button>
        <button
          type="button"
          onClick={() => setSide("want")}
          className={`flex-1 rounded px-2 py-1.5 font-medium ${
            side === "want"
              ? "bg-emerald-600 text-white"
              : "border border-neutral-300 text-neutral-600"
          }`}
        >
          They want (you sell)
        </button>
      </div>

      {side === "give" && conditionOpts.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {conditionOpts.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCondition(c.value)}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                condition === c.value
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "border-neutral-300 text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              {c.value}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span>Qty</span>
          <Stepper value={quantity} onChange={setQuantity} />
        </div>
        {error && <span className="text-xs text-red-600">{error}</span>}
        <button
          type="button"
          onClick={add}
          disabled={pending}
          className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ===== Transaction row =====

function TxnRow({
  sessionId,
  txn,
}: {
  sessionId: string;
  txn: ShowTransaction;
}) {
  const isBuy = txn.kind === "buy";
  return (
    <li className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm">
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
          isBuy ? "bg-neutral-800 text-white" : "bg-emerald-600 text-white"
        }`}
      >
        {isBuy ? "Buy" : "Sell"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{txn.title}</span>
        <span className="block truncate text-xs text-neutral-500">
          {txn.quantity}×{txn.condition ? ` · ${txn.condition}` : ""}
          {isBuy ? ` · ${txn.rateType === "cash" ? "cash" : "credit"}` : ""}
          {txn.manualPrice ? " · manual" : ""}
          {isBuy && txn.inventoryAction === "queued" ? " · queued" : ""}
        </span>
      </span>
      <span
        className={`shrink-0 font-semibold tabular-nums ${
          isBuy ? "text-red-600" : "text-emerald-700"
        }`}
      >
        {isBuy ? "−" : "+"}
        {money(txn.lineTotal)}
      </span>
      <form
        action={voidShowTransaction}
        onSubmit={(e) => {
          if (
            !confirm(
              "Void this transaction? It reverses any inventory it added or sold.",
            )
          )
            e.preventDefault();
        }}
      >
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="txnId" value={txn.id} />
        <button
          type="submit"
          className="shrink-0 rounded p-1 text-neutral-300 hover:bg-red-50 hover:text-red-500"
          aria-label="Void"
        >
          ✕
        </button>
      </form>
    </li>
  );
}
