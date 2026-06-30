"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CONDITIONS, defaultCondition } from "@/lib/conditions";
import { GRADERS, GRADES } from "@/lib/grading";
import { applyRounding, type RoundingSettings } from "@/lib/pricing";
import { DealSlip } from "./deal-slip";
import { PhotoInput } from "./photo-input";
import type {
  CatalogHit,
  HotBuyDto,
  QuoteDto,
  ShopItem,
  TradeInLine,
  WantLine,
} from "./types";

const STEPS = [
  { n: 1, label: "Your side" },
  { n: 2, label: "Our case" },
  { n: 3, label: "Shake on it" },
] as const;

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function TradeCounter({
  shopName,
  inventory,
  popularPicks,
  hotBuys,
  initialWantId,
  quoteValidityDays,
  rounding,
  booth,
}: {
  shopName: string;
  inventory: ShopItem[];
  popularPicks: CatalogHit[];
  hotBuys: HotBuyDto[];
  initialWantId: string | null;
  quoteValidityDays: number;
  rounding: RoundingSettings;
  /** When set, the builder submits into a live booth session instead of the
      async submissions queue — no contact form, lands as a pending trade. */
  booth?: { token: string };
}) {
  const router = useRouter();
  const [boothDone, setBoothDone] = useState(false);
  // Mobile: the docked deal slip collapses to a one-line bar so it doesn't eat
  // the screen. Desktop shows it as a full side column regardless.
  const [slipOpen, setSlipOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [rateType, setRateType] = useState<"store_credit" | "cash">(
    "store_credit",
  );
  const [tradeIn, setTradeIn] = useState<TradeInLine[]>([]);
  // "Trade for this" deep link from /case pre-loads the wanted item
  const [wants, setWants] = useState<WantLine[]>(() => {
    const item = initialWantId
      ? inventory.find((i) => i.id === initialWantId)
      : undefined;
    return item ? [{ item, quantity: 1 }] : [];
  });
  const [quote, setQuote] = useState<QuoteDto | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [cashRemainder, setCashRemainder] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const startedAt = useRef(0);
  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  // Live quote: recompute server-side whenever the counter changes
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (tradeIn.length === 0) {
        setQuote(null);
        return;
      }
      setQuoteLoading(true);
      try {
        const res = await fetch("/api/quote/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rateType,
            items: tradeIn.map((l) => ({
              productId: l.product.id,
              quantity: l.quantity,
              condition: l.graded ? undefined : l.condition,
              printing: l.printing,
              graded: l.graded,
              grader: l.grader,
              grade: l.grade,
            })),
          }),
        });
        if (res.ok) setQuote(await res.json());
      } finally {
        setQuoteLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [tradeIn, rateType]);

  // Lines are identified by index — a card can be on the counter several times
  // (different printing, condition, or graded slab), so product id alone is not
  // a key.
  function lineIdentity(l: TradeInLine): string {
    return l.graded
      ? `${l.product.id}|${l.printing}|g|${l.grader}|${l.grade}`
      : `${l.product.id}|${l.printing}|${l.condition}`;
  }

  function addTradeIn(product: CatalogHit) {
    const condition =
      defaultCondition(product.category) ?? defaultCondition("sealed") ?? "Perfect";
    const printing = product.printings[0]?.subType ?? null;
    const fresh: TradeInLine = {
      product,
      quantity: 1,
      condition,
      printing,
      graded: false,
      grader: null,
      grade: null,
    };
    setTradeIn((prev) => {
      const id = lineIdentity(fresh);
      const existing = prev.find((l) => lineIdentity(l) === id);
      if (existing) {
        return prev.map((l) =>
          l === existing ? { ...l, quantity: Math.min(l.quantity + 1, 99) } : l,
        );
      }
      return [...prev, fresh];
    });
  }

  function setLineAt(idx: number, patch: Partial<TradeInLine>) {
    setTradeIn((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    );
  }

  function setTradeInQty(idx: number, quantity: number) {
    setTradeIn((prev) =>
      quantity <= 0
        ? prev.filter((_, i) => i !== idx)
        : prev.map((l, i) =>
            i === idx ? { ...l, quantity: Math.min(quantity, 99) } : l,
          ),
    );
  }

  function setTradeInGraded(idx: number, graded: boolean) {
    // Toggling graded on seeds a grader + grade so the selects have a value.
    setLineAt(
      idx,
      graded
        ? { graded: true, grader: "PSA", grade: "10" }
        : { graded: false, grader: null, grade: null },
    );
  }

  function toggleWant(item: ShopItem) {
    setWants((prev) => {
      const existing = prev.find((w) => w.item.id === item.id);
      if (existing) return prev.filter((w) => w.item.id !== item.id);
      return [...prev, { item, quantity: 1 }];
    });
  }

  function setWantQty(itemId: string, quantity: number) {
    setWants((prev) =>
      quantity <= 0
        ? prev.filter((w) => w.item.id !== itemId)
        : prev.map((w) =>
            w.item.id === itemId
              ? {
                  ...w,
                  quantity: Math.min(quantity, w.item.quantity, 99),
                }
              : w,
          ),
    );
  }

  async function submit(form: FormData) {
    setSubmitting(true);
    setSubmitError(null);

    // Booth mode: drop the pile into the live session as a pending trade.
    if (booth) {
      try {
        const res = await fetch(`/api/booth/${booth.token}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: form.get("name") ?? "",
            rateType,
            gives: tradeIn.map((l) => ({
              productId: l.product.id,
              title: l.product.name,
              category: l.product.category,
              condition: l.graded ? null : l.condition,
              printing: l.printing,
              quantity: l.quantity,
              graded: l.graded,
              grader: l.grader,
              grade: l.grade,
            })),
            wants: wants.map((w) => ({
              inventoryItemId: w.item.id,
              title: w.item.title,
              category: w.item.category,
              condition: w.item.condition,
              quantity: w.quantity,
            })),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setSubmitError(data.error ?? "Something went wrong — try again.");
          return;
        }
        setBoothDone(true);
      } catch {
        setSubmitError("Network problem — please try again.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: form.get("name"),
          customerEmail: form.get("email"),
          customerPhone: form.get("phone") ?? "",
          customerMessage: form.get("message") ?? "",
          rateType,
          tradeInItems: tradeIn.map((l) => ({
            productId: l.product.id,
            quantity: l.quantity,
            condition: l.graded ? undefined : l.condition,
            printing: l.printing,
            graded: l.graded,
            grader: l.grader,
            grade: l.grade,
          })),
          tradeForItems: wants.map((w) => ({
            inventoryItemId: w.item.id,
            quantity: w.quantity,
          })),
          takeCashRemainder: rateType === "store_credit" && cashRemainder,
          photos,
          website: form.get("website") ?? "",
          startedAt: startedAt.current,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error ?? "Something went wrong — try again.");
        return;
      }
      router.push(`/quote/${data.token}`);
    } catch {
      setSubmitError("Network problem — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (boothDone) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <div className="felt-stitch p-8">
          <p className="text-5xl">🤝</p>
          <h2 className="mt-4 font-display text-2xl font-semibold text-white">
            Sent to the counter
          </h2>
          <p className="mt-2 text-sm text-emerald-100/80">
            Hand your cards to the seller — your list is on their screen with
            prices ready. They&apos;ll finish the deal with you.
          </p>
          <button
            type="button"
            onClick={() => {
              setTradeIn([]);
              setWants([]);
              setQuote(null);
              setStep(1);
              setBoothDone(false);
            }}
            className="mt-6 rounded-md bg-[var(--manila)] px-5 py-2.5 font-display text-base font-semibold text-[var(--ink)] shadow"
          >
            Start another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 pb-24 lg:grid-cols-[1fr_330px] lg:pb-12">
      <div className="min-w-0">
        {/* Step rail */}
        <ol className="mb-6 flex items-center gap-1 text-sm">
          {STEPS.map((s, i) => (
            <li key={s.n} className="flex items-center gap-1">
              {i > 0 && <span className="mx-1 text-emerald-200/40">—</span>}
              <button
                type="button"
                onClick={() => setStep(s.n)}
                className={`rounded-full px-3 py-1 font-medium transition-colors ${
                  step === s.n
                    ? "bg-[var(--manila)] text-[var(--ink)]"
                    : "text-emerald-100/70 hover:text-white"
                }`}
              >
                {s.n}. {s.label}
              </button>
            </li>
          ))}
        </ol>

        {step === 1 && (
          <StepTradeIn
            tradeIn={tradeIn}
            quote={quote}
            rateType={rateType}
            popularPicks={popularPicks}
            hotBuys={hotBuys}
            onRateType={setRateType}
            onAdd={addTradeIn}
            onQty={setTradeInQty}
            onLine={setLineAt}
            onGraded={setTradeInGraded}
            onNext={() => setStep(2)}
            booth={!!booth}
          />
        )}
        {step === 2 && (
          <StepOurCase
            inventory={inventory}
            wants={wants}
            onToggle={toggleWant}
            onQty={setWantQty}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <StepShake
            tradeIn={tradeIn}
            wants={wants}
            quote={quote}
            rateType={rateType}
            cashRemainder={cashRemainder}
            rounding={rounding}
            submitting={submitting}
            submitError={submitError}
            photos={photos}
            onPhotos={setPhotos}
            onBack={() => setStep(2)}
            onSubmit={submit}
            booth={!!booth}
          />
        )}
      </div>

      {/* Deal slip: sticky right column on lg+; on mobile it docks at the
          bottom collapsed to a one-line bar, tap to expand. */}
      <aside className="fixed inset-x-0 bottom-0 z-20 lg:static">
        <div className="mx-auto max-w-md lg:sticky lg:top-6">
          {/* Mobile-only summary bar */}
          <button
            type="button"
            onClick={() => setSlipOpen((o) => !o)}
            aria-expanded={slipOpen}
            className="flex w-full items-center justify-between gap-3 border-t border-neutral-300 bg-[var(--slip)] px-4 py-2.5 text-left shadow-[0_-6px_16px_-6px_rgba(0,0,0,0.5)] lg:hidden"
          >
            <span className="text-sm font-semibold text-[var(--ink)]">
              {slipOpen ? "Hide deal slip" : "Deal slip"}
              {tradeIn.length + wants.length > 0 && (
                <span className="ml-1 font-normal text-neutral-500">
                  · {tradeIn.length + wants.length} item
                  {tradeIn.length + wants.length === 1 ? "" : "s"}
                </span>
              )}
            </span>
            <span className="flex items-center gap-2">
              <span className="font-slip text-base font-bold tabular-nums text-[var(--ink)]">
                {money(quote?.total ?? 0)}
              </span>
              <span aria-hidden="true" className="text-neutral-500">
                {slipOpen ? "▾" : "▴"}
              </span>
            </span>
          </button>
          <div
            className={`${
              slipOpen ? "max-h-[55vh] overflow-y-auto" : "hidden"
            } lg:block lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto`}
          >
            <DealSlip
              shopName={shopName}
              tradeIn={tradeIn}
              wants={wants}
              quote={quote}
              quoteLoading={quoteLoading}
              rateType={rateType}
              cashRemainder={cashRemainder}
              onCashRemainder={setCashRemainder}
              quoteValidityDays={quoteValidityDays}
              rounding={rounding}
            />
          </div>
        </div>
      </aside>
    </div>
  );
}

// ===== Step 1: what the customer slides across =====

function StepTradeIn({
  tradeIn,
  quote,
  rateType,
  popularPicks,
  hotBuys,
  onRateType,
  onAdd,
  onQty,
  onLine,
  onGraded,
  onNext,
  booth = false,
}: {
  tradeIn: TradeInLine[];
  quote: QuoteDto | null;
  rateType: "store_credit" | "cash";
  popularPicks: CatalogHit[];
  hotBuys: HotBuyDto[];
  onRateType: (r: "store_credit" | "cash") => void;
  onAdd: (p: CatalogHit) => void;
  onQty: (idx: number, qty: number) => void;
  onLine: (idx: number, patch: Partial<TradeInLine>) => void;
  onGraded: (idx: number, graded: boolean) => void;
  onNext: () => void;
  booth?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [searching, setSearching] = useState(false);

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
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <section className="felt-stitch p-4 sm:p-6">
      <h2 className="font-display text-2xl font-semibold text-white">
        What are you sliding across the counter?
      </h2>
      <p className="mt-1 text-sm text-emerald-100/80">
        Search sealed product or single cards — booster boxes, ETBs, tins, or
        any card by name. Prices come straight from the market, updated daily.
      </p>

      <div className="mt-4 flex gap-2 rounded-md bg-emerald-950/40 p-1 text-sm">
        {(
          [
            ["store_credit", "Trade-in Credit"],
            ["cash", "Cash Offer"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => onRateType(value)}
            className={`flex-1 rounded px-3 py-1.5 font-medium transition-colors ${
              rateType === value
                ? "bg-[var(--manila)] text-[var(--ink)]"
                : "text-emerald-100/70 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Try “Charizard ex Obsidian Flames” or “Phantasmal Flames ETB”…"
          className="w-full min-w-0 flex-1 rounded-md border-0 bg-white px-4 py-3 text-[15px] text-[var(--ink)] shadow-inner outline-none ring-emerald-300 focus:ring-2"
        />
        <button
          type="button"
          onClick={onNext}
          disabled={tradeIn.length === 0}
          title={
            tradeIn.length === 0
              ? "Put something on the counter first"
              : undefined
          }
          className="shrink-0 rounded-md bg-[var(--manila)] px-5 py-3 font-display text-base font-semibold text-[var(--ink)] shadow transition-transform hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0"
        >
          Browse our case →
        </button>
      </div>

      {searching && (
        <p className="mt-2 text-sm text-emerald-100/60">Checking the price list…</p>
      )}
      {hits.length > 0 && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {hits.map((hit) => {
            const below = hit.belowFloor === true;
            return (
              <li key={hit.id}>
                <button
                  type="button"
                  disabled={below}
                  title={
                    below
                      ? `Below our ${money(hit.floor ?? 0)} trade-in minimum`
                      : undefined
                  }
                  onClick={() => {
                    if (below) return;
                    onAdd(hit);
                    setHits([]);
                    setQuery("");
                  }}
                  className={`flex w-full items-center gap-3 rounded-md p-2 text-left shadow transition-transform ${
                    below
                      ? "cursor-not-allowed bg-neutral-200/80"
                      : "bg-white/95 hover:-translate-y-0.5"
                  }`}
                >
                  {hit.imageUrl ? (
                    <Image
                      src={hit.imageUrl}
                      alt=""
                      width={44}
                      height={44}
                      className={`h-11 w-11 shrink-0 rounded object-contain ${
                        below ? "opacity-50 grayscale" : ""
                      }`}
                      unoptimized
                    />
                  ) : (
                    <div className="h-11 w-11 shrink-0 rounded bg-neutral-100" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block text-sm font-medium leading-snug ${
                        below ? "text-neutral-500" : "text-[var(--ink)]"
                      }`}
                    >
                      {hit.name}
                    </span>
                    <span className="block text-xs text-neutral-500">
                      {hit.groupName}
                    </span>
                    {below && (
                      <span className="mt-0.5 block text-[11px] font-medium text-red-600/80">
                        Below {money(hit.floor ?? 0)} value — no trade-in credit
                      </span>
                    )}
                  </span>
                  {hit.marketPrice !== null && (
                    <span
                      className={`shrink-0 text-xs ${
                        below
                          ? "font-medium text-neutral-400 line-through"
                          : "price-tag"
                      }`}
                    >
                      {money(hit.marketPrice)}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {query.trim().length < 2 && hotBuys.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-100/80">
            🔥 Hot buys
            <span className="ml-2 font-normal normal-case tracking-normal text-emerald-100/60">
              we&apos;re hunting these — bonus credit on top of our normal rate
            </span>
          </h3>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {hotBuys.map((hb) => {
              const onCounter = tradeIn
                .filter((l) => l.product.id === hb.productId)
                .reduce((sum, l) => sum + l.quantity, 0);
              return (
                <li key={hb.productId}>
                  <button
                    type="button"
                    onClick={() =>
                      onAdd({
                        id: hb.productId,
                        name: hb.name,
                        groupId: hb.groupId,
                        groupName: hb.groupName,
                        imageUrl: hb.imageUrl,
                        marketPrice: hb.marketPrice,
                        category: hb.category,
                        printings: hb.printings,
                      })
                    }
                    className="flex w-full items-center gap-3 rounded-md bg-white/95 p-2 text-left shadow ring-1 ring-orange-400/60 transition-transform hover:-translate-y-0.5"
                  >
                    {hb.imageUrl ? (
                      <Image
                        src={hb.imageUrl}
                        alt=""
                        width={44}
                        height={44}
                        className="h-11 w-11 shrink-0 rounded object-contain"
                        unoptimized
                      />
                    ) : (
                      <div className="h-11 w-11 shrink-0 rounded bg-neutral-100" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-snug text-[var(--ink)]">
                        {hb.name}
                      </span>
                      <span className="block text-xs text-neutral-500">
                        {hb.groupName}
                        {hb.notes && <span className="italic"> · {hb.notes}</span>}
                        {onCounter > 0 && (
                          <span className="ml-1.5 font-semibold text-emerald-700">
                            · {onCounter} on the counter
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="hot-tag shrink-0">
                      +{hb.bonusPercent}% bonus
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {query.trim().length < 2 && popularPicks.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-100/80">
            Popular picks
            <span className="ml-2 font-normal normal-case tracking-normal text-emerald-100/60">
              from recent sets — tap to put one on the counter
            </span>
          </h3>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {popularPicks.map((pick) => {
              const onCounter = tradeIn
                .filter((l) => l.product.id === pick.id)
                .reduce((sum, l) => sum + l.quantity, 0);
              return (
                <li key={pick.id}>
                  <button
                    type="button"
                    onClick={() => onAdd(pick)}
                    className="flex w-full items-center gap-3 rounded-md bg-white/95 p-2 text-left shadow transition-transform hover:-translate-y-0.5"
                  >
                    {pick.imageUrl ? (
                      <Image
                        src={pick.imageUrl}
                        alt=""
                        width={44}
                        height={44}
                        className="h-11 w-11 shrink-0 rounded object-contain"
                        unoptimized
                      />
                    ) : (
                      <div className="h-11 w-11 shrink-0 rounded bg-neutral-100" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-snug text-[var(--ink)]">
                        {pick.name}
                      </span>
                      <span className="block text-xs text-neutral-500">
                        {pick.groupName}
                        {onCounter > 0 && (
                          <span className="ml-1.5 font-semibold text-emerald-700">
                            · {onCounter} on the counter
                          </span>
                        )}
                      </span>
                    </span>
                    {pick.marketPrice !== null && (
                      <span className="price-tag shrink-0 text-xs">
                        {money(pick.marketPrice)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {tradeIn.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-100/80">
            On the counter
          </h3>
          <div className="counter-mat mt-2 space-y-5 p-4 sm:p-5">
            {tradeIn.map((line, idx) => {
              const quoted = quote?.lines.find(
                (l) =>
                  l.productId === line.product.id &&
                  l.printing === line.printing &&
                  l.condition === line.condition,
              );
              const printings = line.product.printings;
              const canGrade = line.product.category === "singles";
              const selectClass =
                "rounded border border-neutral-400/60 bg-white px-2 py-1 text-xs text-[var(--ink)]";
              return (
                <div key={idx} className="flex items-end gap-3 sm:gap-4">
                  <div className="standing-item shrink-0">
                    {line.product.imageUrl ? (
                      <Image
                        src={line.product.imageUrl}
                        alt=""
                        width={80}
                        height={80}
                        className="h-20 w-20 object-contain drop-shadow-[0_5px_4px_rgba(0,0,0,0.35)]"
                        unoptimized
                      />
                    ) : (
                      <div className="h-20 w-20 rounded bg-emerald-950/40" />
                    )}
                  </div>
                  <div
                    className={`manila-tag min-w-0 flex-1 p-3 pl-6 ${
                      idx % 2 === 0 ? "-rotate-[0.4deg]" : "rotate-[0.5deg]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold leading-snug text-[var(--ink)]">
                          {line.product.name}
                        </p>
                        <p className="mt-0.5 font-slip text-xs text-neutral-600">
                          {line.graded ? (
                            <span className="font-semibold text-amber-700">
                              {booth ? "Priced by the seller" : "Custom offer after review"}
                            </span>
                          ) : quoted ? (
                            `${money(quoted.unitCredit)} each in ${
                              rateType === "store_credit" ? "credit" : "cash"
                            }`
                          ) : (
                            "pricing…"
                          )}
                          {!line.graded && quoted && quoted.hotBuyBonus > 0 && (
                            <span className="hot-tag ml-2">
                              🔥 +{quoted.hotBuyBonus}%
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <QtyButton onClick={() => onQty(idx, line.quantity - 1)}>
                          −
                        </QtyButton>
                        <span className="w-7 text-center text-sm font-semibold tabular-nums text-[var(--ink)]">
                          {line.quantity}
                        </span>
                        <QtyButton onClick={() => onQty(idx, line.quantity + 1)}>
                          +
                        </QtyButton>
                      </div>
                    </div>

                    {/* Printing / edition — only when the card has a choice */}
                    {!line.graded && printings.length > 1 && (
                      <div className="mt-2">
                        <select
                          aria-label="Printing"
                          value={line.printing ?? ""}
                          onChange={(e) =>
                            onLine(idx, { printing: e.target.value })
                          }
                          className={selectClass}
                        >
                          {printings.map((p) => (
                            <option key={p.subType} value={p.subType}>
                              {p.subType}
                              {p.market !== null ? ` — ${money(p.market)}` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Condition — raw cards / sealed only */}
                    {!line.graded && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {CONDITIONS[line.product.category].map((c) => (
                          <button
                            key={c.value}
                            type="button"
                            title={c.description}
                            onClick={() => onLine(idx, { condition: c.value })}
                            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                              line.condition === c.value
                                ? "border-[var(--felt)] bg-[var(--felt)] text-white"
                                : "border-neutral-400/60 text-neutral-700 hover:bg-black/5"
                            }`}
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Graded slab — singles only */}
                    {canGrade && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink)]">
                          <input
                            type="checkbox"
                            checked={line.graded}
                            onChange={(e) => onGraded(idx, e.target.checked)}
                          />
                          Graded slab
                        </label>
                        {line.graded && (
                          <>
                            <select
                              aria-label="Grader"
                              value={line.grader ?? ""}
                              onChange={(e) =>
                                onLine(idx, { grader: e.target.value })
                              }
                              className={selectClass}
                            >
                              {GRADERS.map((g) => (
                                <option key={g} value={g}>
                                  {g}
                                </option>
                              ))}
                            </select>
                            <select
                              aria-label="Grade"
                              value={line.grade ?? ""}
                              onChange={(e) =>
                                onLine(idx, { grade: e.target.value })
                              }
                              className={selectClass}
                            >
                              {GRADES.map((g) => (
                                <option key={g} value={g}>
                                  {g}
                                </option>
                              ))}
                            </select>
                          </>
                        )}
                      </div>
                    )}

                    {line.graded && (
                      <p className="mt-1 text-[11px] text-neutral-500">
                        {booth
                          ? "The seller prices graded slabs by hand at the table."
                          : "Graded cards are quoted by hand — we'll send a custom offer after you submit."}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </section>
  );
}

// ===== Step 2: the shop's display case =====

function StepOurCase({
  inventory,
  wants,
  onToggle,
  onQty,
  onBack,
  onNext,
}: {
  inventory: ShopItem[];
  wants: WantLine[];
  onToggle: (item: ShopItem) => void;
  onQty: (itemId: string, qty: number) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return inventory;
    return inventory.filter((i) => i.title.toLowerCase().includes(f));
  }, [inventory, filter]);

  return (
    <section className="felt-stitch p-4 sm:p-6">
      <h2 className="font-display text-2xl font-semibold text-white">
        Point at anything in the case
      </h2>
      <p className="mt-1 text-sm text-emerald-100/80">
        Put your credit toward whatever catches your eye. You can also skip
        this and just take the credit — we&apos;ll sort it out together.
      </p>

      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search the case…"
        className="mt-4 w-full rounded-md border-0 bg-white px-4 py-3 text-[15px] text-[var(--ink)] shadow-inner outline-none ring-emerald-300 focus:ring-2"
      />

      {inventory.length === 0 ? (
        <p className="mt-6 rounded-md bg-emerald-950/40 p-4 text-sm text-emerald-100/80">
          The case is being restocked — submit your trade-in for credit and
          we&apos;ll show you what we&apos;ve got.
        </p>
      ) : (
        <div className="case-frame mt-4">
          <div className="case-glass p-4 sm:p-5">
            <ul className="relative z-[2] grid gap-x-3 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((item) => {
            const want = wants.find((w) => w.item.id === item.id);
            const img = item.photoUrl ?? item.imageUrl;
            return (
              <li
                key={item.id}
                className={`shelf-item rounded-md bg-white/95 p-3 shadow-[0_12px_16px_-9px_rgba(0,0,0,0.55)] transition-shadow ${
                  want ? "ring-2 ring-[var(--tag)]" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  {img ? (
                    <Image
                      src={img}
                      alt=""
                      width={56}
                      height={56}
                      className="h-14 w-14 shrink-0 rounded object-contain"
                      unoptimized
                    />
                  ) : (
                    <div className="h-14 w-14 shrink-0 rounded bg-neutral-100" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug text-[var(--ink)]">
                      {item.title}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {item.condition ? `${item.condition} · ` : ""}
                      {item.quantity > 1 ? `${item.quantity} in stock` : "1 in stock"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
                      <span className="price-tag text-xs">{money(item.price)}</span>
                      {want ? (
                        <span className="flex shrink-0 items-center gap-1">
                          <QtyButton onClick={() => onQty(item.id, want.quantity - 1)}>
                            −
                          </QtyButton>
                          <span className="w-6 text-center text-sm font-semibold tabular-nums text-[var(--ink)]">
                            {want.quantity}
                          </span>
                          <QtyButton
                            onClick={() => onQty(item.id, want.quantity + 1)}
                            disabled={want.quantity >= item.quantity}
                          >
                            +
                          </QtyButton>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onToggle(item)}
                          className="rounded bg-[var(--felt)] px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-900"
                        >
                          I&apos;ll take it
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
            </ul>
          </div>
        </div>
      )}

      <div className="mt-6 flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md px-4 py-2.5 text-sm font-medium text-emerald-100/80 hover:text-white"
        >
          ← Back to your side
        </button>
        <button
          type="button"
          onClick={onNext}
          className="rounded-md bg-[var(--manila)] px-5 py-2.5 font-display text-base font-semibold text-[var(--ink)] shadow transition-transform hover:-translate-y-0.5"
        >
          Shake on it →
        </button>
      </div>
    </section>
  );
}

// ===== Step 3: contact + submit =====

function SynopsisPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-white/95 p-3 shadow-[0_12px_16px_-9px_rgba(0,0,0,0.55)]">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
        {title}
      </p>
      <div className="mt-2 space-y-2">{children}</div>
    </div>
  );
}

function SynopsisItem({
  image,
  name,
  detail,
  amount,
}: {
  image: string | null;
  name: string;
  detail: string;
  amount: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      {image ? (
        <Image
          src={image}
          alt=""
          width={40}
          height={40}
          className="h-10 w-10 shrink-0 rounded object-contain"
          unoptimized
        />
      ) : (
        <div className="h-10 w-10 shrink-0 rounded bg-neutral-100" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[var(--ink)]" title={name}>
          {name}
        </p>
        <p className="text-[11px] text-neutral-500">{detail}</p>
      </div>
      <span className="shrink-0 font-slip text-xs font-semibold tabular-nums text-[var(--ink)]">
        {amount}
      </span>
    </div>
  );
}

function StepShake({
  tradeIn,
  wants,
  quote,
  rateType,
  cashRemainder,
  rounding,
  submitting,
  submitError,
  photos,
  onPhotos,
  onBack,
  onSubmit,
  booth = false,
}: {
  tradeIn: TradeInLine[];
  wants: WantLine[];
  quote: QuoteDto | null;
  rateType: "store_credit" | "cash";
  cashRemainder: boolean;
  rounding: RoundingSettings;
  submitting: boolean;
  submitError: string | null;
  photos: string[];
  onPhotos: (photos: string[]) => void;
  onBack: () => void;
  onSubmit: (form: FormData) => void;
  /** Booth flow: skip the contact form, name optional, "send to counter" */
  booth?: boolean;
}) {
  const tradeInCount = tradeIn.length;
  const credit = quote?.total ?? 0;
  const wantsTotal =
    wants.reduce(
      (sum, w) => sum + Math.round(w.item.price * 100) * w.quantity,
      0,
    ) / 100;
  const balance = Math.round((credit - wantsTotal) * 100) / 100;
  const creditTotal = quote?.totals?.store_credit ?? credit;
  const cashTotal = quote?.totals?.cash ?? 0;
  const remainderCash =
    creditTotal > 0
      ? applyRounding((cashTotal * balance) / creditTotal, rounding)
      : 0;
  const payoutAsCash = rateType === "store_credit" && cashRemainder && balance > 0;

  return (
    <section className="felt-stitch p-4 sm:p-6">
      <h2 className="font-display text-2xl font-semibold text-white">
        Let&apos;s shake on it
      </h2>
      <p className="mt-1 text-sm text-emerald-100/80">
        {booth
          ? "Send this list to the seller's screen — they'll price it up and finish the deal with you at the table."
          : "Leave your details and we'll look the deal over — usually within a day. Nothing ships and nothing's final until we've talked."}
      </p>

      {booth && tradeInCount > 0 && (
        <div className="mt-3 rounded-md bg-emerald-950/50 p-3 text-center">
          {wants.length === 0 ? (
            <p className="text-sm text-emerald-50">
              You get{" "}
              <span className="font-bold">{money(credit)}</span>{" "}
              {rateType === "cash" ? "cash" : "in store credit"} for your cards.
            </p>
          ) : balance < 0 ? (
            <p className="text-sm text-emerald-50">
              You pay <span className="font-bold">{money(Math.abs(balance))}</span>{" "}
              at the table.
            </p>
          ) : balance > 0 ? (
            <p className="text-sm text-emerald-50">
              You get back{" "}
              <span className="font-bold">
                {money(payoutAsCash ? remainderCash : balance)}
              </span>{" "}
              {rateType === "cash" || payoutAsCash ? "cash" : "in store credit"}.
            </p>
          ) : (
            <p className="text-sm text-emerald-50">
              Even trade — nothing changes hands.
            </p>
          )}
          <p className="mt-0.5 text-[11px] text-emerald-100/60">
            graded slabs are priced by the seller and added on top
          </p>
        </div>
      )}

      {tradeInCount === 0 ? (
        <p className="mt-6 rounded-md bg-emerald-950/40 p-4 text-sm text-emerald-100/80">
          Your side of the counter is empty — go back and add what you&apos;re
          trading in first.
        </p>
      ) : (
        <form
          className="mt-5 space-y-4"
          action={(formData) => onSubmit(formData)}
        >
          {/* Honeypot — humans never see this */}
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            className="absolute -left-[9999px] h-0 w-0 opacity-0"
            aria-hidden="true"
          />
          {booth ? (
            <label className="block">
              <span className="text-sm font-medium text-emerald-50">
                Your first name{" "}
                <span className="text-emerald-100/60">(optional)</span>
              </span>
              <input
                name="name"
                maxLength={60}
                placeholder="So the seller can call you over"
                className="mt-1 w-full rounded-md border-0 bg-white px-3 py-2.5 text-[15px] text-[var(--ink)] shadow-inner outline-none ring-emerald-300 focus:ring-2 sm:max-w-xs"
              />
            </label>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-emerald-50">
                    Name
                  </span>
                  <input
                    name="name"
                    required
                    maxLength={120}
                    className="mt-1 w-full rounded-md border-0 bg-white px-3 py-2.5 text-[15px] text-[var(--ink)] shadow-inner outline-none ring-emerald-300 focus:ring-2"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-emerald-50">
                    Email
                  </span>
                  <input
                    name="email"
                    type="email"
                    required
                    maxLength={200}
                    className="mt-1 w-full rounded-md border-0 bg-white px-3 py-2.5 text-[15px] text-[var(--ink)] shadow-inner outline-none ring-emerald-300 focus:ring-2"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-sm font-medium text-emerald-50">
                  Phone <span className="text-emerald-100/60">(optional)</span>
                </span>
                <input
                  name="phone"
                  type="tel"
                  maxLength={40}
                  className="mt-1 w-full rounded-md border-0 bg-white px-3 py-2.5 text-[15px] text-[var(--ink)] shadow-inner outline-none ring-emerald-300 focus:ring-2 sm:max-w-xs"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-emerald-50">
                  Anything we should know?{" "}
                  <span className="text-emerald-100/60">(optional)</span>
                </span>
                <textarea
                  name="message"
                  rows={3}
                  maxLength={2000}
                  placeholder="Condition notes, what you're after, best time to reach you…"
                  className="mt-1 w-full rounded-md border-0 bg-white px-3 py-2.5 text-[15px] text-[var(--ink)] shadow-inner outline-none ring-emerald-300 focus:ring-2"
                />
              </label>

              <PhotoInput photos={photos} onChange={onPhotos} />
            </>
          )}

          {/* The deal, laid out across the counter */}
          <div className="border-t border-emerald-200/20 pt-5">
            <h3 className="text-center text-sm font-semibold uppercase tracking-wide text-emerald-100/80">
              The deal on the counter
            </h3>
            <div className="mt-4 grid items-center gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
              <SynopsisPanel title="You slide across">
                {tradeIn.map((line, idx) => {
                  const quoted = quote?.lines.find(
                    (l) =>
                      l.productId === line.product.id &&
                      l.printing === line.printing &&
                      l.condition === line.condition,
                  );
                  const showPrinting =
                    line.printing && line.product.printings.length > 1;
                  const detail = line.graded
                    ? `${line.quantity}× · ${line.grader ?? ""} ${line.grade ?? ""}`
                    : `${line.quantity}× · ${line.condition}${
                        showPrinting ? ` · ${line.printing}` : ""
                      }`;
                  return (
                    <SynopsisItem
                      key={idx}
                      image={line.product.imageUrl}
                      name={line.product.name}
                      detail={detail}
                      amount={
                        line.graded
                          ? "custom offer"
                          : quoted
                            ? money(quoted.lineCredit)
                            : "…"
                      }
                    />
                  );
                })}
                <div className="flex items-baseline justify-between border-t border-neutral-100 pt-2">
                  <span className="text-[11px] font-semibold uppercase text-neutral-400">
                    {rateType === "store_credit" ? "Trade credit" : "Cash offer"}
                  </span>
                  <span className="font-slip text-sm font-bold tabular-nums text-[var(--ink)]">
                    {money(credit)}
                  </span>
                </div>
              </SynopsisPanel>

              <div className="flex flex-col items-center justify-center py-1">
                <button
                  type="submit"
                  disabled={submitting}
                  aria-label="Send the trade"
                  className="group flex h-20 w-20 flex-col items-center justify-center rounded-full bg-[var(--tag)] text-[var(--ink)] shadow-xl ring-4 ring-emerald-950/30 transition-transform hover:-translate-y-1 hover:scale-105 disabled:opacity-50"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-8 w-8 rotate-90 transition-transform group-hover:scale-110 lg:rotate-0"
                  >
                    <path d="M7 4 3 8l4 4" />
                    <path d="M3 8h13" />
                    <path d="m17 20 4-4-4-4" />
                    <path d="M21 16H8" />
                  </svg>
                  <span className="mt-0.5 font-display text-[11px] font-bold leading-tight">
                    {submitting ? "Sending…" : "Send it"}
                  </span>
                </button>
                <p className="mt-2 max-w-28 text-center text-[11px] leading-snug text-emerald-100/70">
                  Click the swap to send the trade
                </p>
              </div>

              <SynopsisPanel title="You walk away with">
                {wants.map((w) => (
                  <SynopsisItem
                    key={w.item.id}
                    image={w.item.photoUrl ?? w.item.imageUrl}
                    name={w.item.title}
                    detail={`${w.quantity}×${w.item.condition ? ` · ${w.item.condition}` : ""}`}
                    amount={money(w.item.price * w.quantity)}
                  />
                ))}
                {balance > 0 && (
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-emerald-50 text-lg">
                      {payoutAsCash ? "💵" : "🎟️"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--ink)]">
                        {payoutAsCash ? "Cash for the rest" : "Store credit"}
                      </p>
                      <p className="text-[11px] text-neutral-500">
                        {payoutAsCash
                          ? "leftover paid at our cash rate"
                          : "to spend with us later"}
                      </p>
                    </div>
                    <span className="shrink-0 font-slip text-xs font-semibold tabular-nums text-[var(--ink)]">
                      {money(payoutAsCash ? remainderCash : balance)}
                    </span>
                  </div>
                )}
                {balance < 0 && (
                  <p className="rounded bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800">
                    You&apos;d settle the {money(Math.abs(balance))} difference
                    with us when we talk.
                  </p>
                )}
                {wants.length > 0 && (
                  <div className="flex items-baseline justify-between border-t border-neutral-100 pt-2">
                    <span className="text-[11px] font-semibold uppercase text-neutral-400">
                      Items total
                    </span>
                    <span className="font-slip text-sm font-bold tabular-nums text-[var(--ink)]">
                      {money(wantsTotal)}
                    </span>
                  </div>
                )}
              </SynopsisPanel>
            </div>
          </div>

          {submitError && (
            <p className="rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-200">
              {submitError}
            </p>
          )}

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={onBack}
              className="rounded-md px-4 py-2.5 text-sm font-medium text-emerald-100/80 hover:text-white"
            >
              ← Back to the case
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function QtyButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-neutral-300 text-base font-semibold leading-none text-[var(--ink)] hover:bg-neutral-100 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-100 disabled:text-neutral-300 disabled:hover:bg-neutral-100"
    >
      {children}
    </button>
  );
}
