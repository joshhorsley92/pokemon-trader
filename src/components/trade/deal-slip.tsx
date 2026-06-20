"use client";

import { useState } from "react";
import { applyRounding, type RoundingSettings } from "@/lib/pricing";
import type { QuoteDto, TradeInLine, WantLine } from "./types";

function money(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

/**
 * Section header with the +/− expander. Sections are abbreviated (item lines
 * hidden) until expanded; expanding shows full, wrapped item detail.
 */
function SectionToggle({
  label,
  count,
  expanded,
  onToggle,
}: {
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const clickable = count > 0;
  return (
    <button
      type="button"
      onClick={clickable ? onToggle : undefined}
      aria-expanded={expanded}
      aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
      className={`flex w-full items-center justify-between gap-2 ${clickable ? "" : "cursor-default"}`}
      disabled={!clickable}
    >
      <span className="text-left text-xs font-semibold uppercase text-neutral-500">
        {label}
        {count > 0 && (
          <span className="ml-1.5 font-normal normal-case text-neutral-400">
            · {count} item{count === 1 ? "" : "s"}
          </span>
        )}
      </span>
      {clickable && (
        <span
          aria-hidden="true"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-neutral-300 text-sm leading-none text-neutral-500"
        >
          {expanded ? "−" : "+"}
        </span>
      )}
    </button>
  );
}

export function DealSlip({
  shopName,
  tradeIn,
  wants,
  quote,
  quoteLoading,
  rateType,
  cashRemainder,
  onCashRemainder,
  quoteValidityDays,
  rounding,
}: {
  shopName: string;
  tradeIn: TradeInLine[];
  wants: WantLine[];
  quote: QuoteDto | null;
  quoteLoading: boolean;
  rateType: "store_credit" | "cash";
  cashRemainder: boolean;
  onCashRemainder: (v: boolean) => void;
  quoteValidityDays: number;
  rounding: RoundingSettings;
}) {
  // Sections start abbreviated — totals only — until expanded with the +.
  const [tradeInOpen, setTradeInOpen] = useState(false);
  const [wantsOpen, setWantsOpen] = useState(false);

  const credit = quote?.total ?? 0;
  const wantsTotal =
    wants.reduce((sum, w) => sum + Math.round(w.item.price * 100) * w.quantity, 0) /
    100;
  const balance = Math.round((credit - wantsTotal) * 100) / 100;

  // Leftover credit can be taken as cash, valued at the cash rate
  const creditTotal = quote?.totals?.store_credit ?? credit;
  const cashTotal = quote?.totals?.cash ?? 0;
  const remainderCash =
    creditTotal > 0
      ? applyRounding((cashTotal * balance) / creditTotal, rounding)
      : 0;
  const offerCashRemainder =
    rateType === "store_credit" && wants.length > 0 && balance > 0;
  const showCashRemainder = offerCashRemainder && cashRemainder;

  const listClass = (open: boolean) =>
    `mt-1 space-y-1.5 ${open ? "" : "hidden"}`;

  return (
    <div>
      <div className="deal-slip rounded-t-md px-4 pb-3 pt-3 font-slip text-sm lg:px-5 lg:pb-4 lg:pt-5">
        <div className="hidden text-center lg:block">
          <p className="font-semibold uppercase tracking-widest">{shopName}</p>
          <p className="text-xs text-neutral-500">— deal slip —</p>
        </div>

        <div className="lg:mt-4 lg:border-t lg:border-dashed lg:border-neutral-300 lg:pt-3">
          <SectionToggle
            label="Your side of the counter"
            count={tradeIn.length}
            expanded={tradeInOpen}
            onToggle={() => setTradeInOpen((o) => !o)}
          />
          {tradeIn.length === 0 ? (
            <p className="py-1 text-xs italic text-neutral-400">
              nothing on the counter yet
            </p>
          ) : (
            <ul className={listClass(tradeInOpen)}>
              {tradeIn.map((line, idx) => {
                const quoted = quote?.lines.find(
                  (l) =>
                    l.productId === line.product.id &&
                    l.printing === line.printing &&
                    l.condition === line.condition,
                );
                const showPrinting =
                  line.printing && line.product.printings.length > 1;
                return (
                  <li key={idx} className="flex justify-between gap-2">
                    <span className="min-w-0 flex-1 break-words leading-snug">
                      {line.quantity}× {line.product.name}
                      <span className="block text-[11px] text-neutral-400">
                        {line.graded
                          ? `${line.grader ?? ""} ${line.grade ?? ""} · graded`
                          : line.condition}
                        {showPrinting && (
                          <span className="text-neutral-400">
                            {" "}
                            · {line.printing}
                          </span>
                        )}
                        {quoted && quoted.hotBuyBonus > 0 && (
                          <span className="ml-1 font-semibold text-orange-600">
                            · 🔥 hot buy +{quoted.hotBuyBonus}%
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="whitespace-nowrap tabular-nums">
                      {line.graded
                        ? "custom offer"
                        : quoted
                          ? money(quoted.lineCredit)
                          : "…"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-1.5 flex items-baseline justify-between border-t border-neutral-200 pt-1.5">
            <span className="text-xs uppercase text-neutral-500">
              {rateType === "store_credit" ? "Trade credit" : "Cash offer"}
            </span>
            <span
              className={`text-base font-semibold tabular-nums ${quoteLoading ? "opacity-40" : ""}`}
            >
              {money(credit)}
            </span>
          </div>
        </div>

        <div className="mt-2 border-t border-dashed border-neutral-300 pt-2 lg:mt-3 lg:pt-3">
          <SectionToggle
            label="From our case"
            count={wants.length}
            expanded={wantsOpen}
            onToggle={() => setWantsOpen((o) => !o)}
          />
          {wants.length === 0 ? (
            <p className="py-1 text-xs italic text-neutral-400">
              nothing picked out yet
            </p>
          ) : (
            <>
              <ul className={listClass(wantsOpen)}>
                {wants.map((w) => (
                  <li key={w.item.id} className="flex justify-between gap-2">
                    <span className="min-w-0 flex-1 break-words leading-snug">
                      {w.quantity}× {w.item.title}
                    </span>
                    <span className="whitespace-nowrap tabular-nums">
                      {money(w.item.price * w.quantity)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-1.5 flex items-baseline justify-between border-t border-neutral-200 pt-1.5">
                <span className="text-xs uppercase text-neutral-500">
                  Items total
                </span>
                <span className="text-base font-semibold tabular-nums">
                  {money(wantsTotal)}
                </span>
              </div>
            </>
          )}
        </div>

        <div className="mt-2 rounded-md p-[2px] holo-chip lg:mt-3">
          <div className="rounded-[4px] bg-[var(--slip)] px-3 py-1.5 lg:py-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-semibold uppercase">
                {balance < 0
                  ? "You'd owe"
                  : showCashRemainder
                    ? "Cash for the rest"
                    : "Credit left over"}
              </span>
              <span className="text-lg font-bold tabular-nums">
                {money(showCashRemainder ? remainderCash : Math.abs(balance))}
              </span>
            </div>
            {balance < 0 && (
              <p className="mt-1 hidden text-[11px] leading-snug text-neutral-500 lg:block">
                That&apos;s fine — propose it anyway and we&apos;ll settle the
                difference when we talk.
              </p>
            )}
            {offerCashRemainder && (
              <label className="mt-1.5 flex cursor-pointer items-start gap-2 border-t border-neutral-200 pt-1.5 text-[12px] leading-snug">
                <input
                  type="checkbox"
                  checked={cashRemainder}
                  onChange={(e) => onCashRemainder(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Take cash for the remaining
                  <span className="block text-[11px] text-neutral-500">
                    leftover credit paid out at our cash rate
                    {!showCashRemainder && ` (${money(remainderCash)})`}
                  </span>
                </span>
              </label>
            )}
          </div>
        </div>

        <p className="mt-3 hidden text-center text-[11px] text-neutral-400 lg:block">
          quote good for {quoteValidityDays} days · all trades reviewed by a human
        </p>
      </div>
      <div className="deal-slip-tear hidden lg:block" />
    </div>
  );
}
