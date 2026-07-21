"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CONDITIONS } from "@/lib/conditions";
import { quickAddItem } from "./actions";

type Printing = { subType: string; market: number | null };
type Hit = {
  id: number;
  name: string;
  groupName: string;
  marketPrice: number | null;
  category: "singles" | "sealed" | "graded";
  printings: Printing[];
};

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Type → Enter → added. Category and title come from the catalog product, so
 * the only things the operator can set are the ones the catalog can't know:
 * quantity, condition, and an optional fixed price. Those are "sticky" — they
 * persist between adds so a stack of LP cards is one keystroke each.
 */
export function QuickAdd() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const [qty, setQty] = useState(1);
  const [condition, setCondition] = useState("NM");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState<{ tone: "ok" | "err"; text: string } | null>(
    null,
  );
  // A card with >1 printing (1st Ed / Unlimited / Reverse) must be disambiguated
  // before it's added, so it pauses here for a one-tap printing choice.
  const [picking, setPicking] = useState<Hit | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

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
        if (res.ok) {
          setHits((await res.json()).results);
          setActive(0);
        }
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  /** Picking a search result: multi-printing cards pause for a printing choice. */
  function choose(hit: Hit) {
    if (hit.printings.length > 1) {
      setPicking(hit);
      setHits([]);
      return;
    }
    add(hit, hit.printings[0]?.subType ?? null);
  }

  function add(hit: Hit, printing: string | null) {
    setNote(null);
    const asking = price.trim() === "" ? null : Number(price);
    if (asking !== null && (Number.isNaN(asking) || asking < 0)) {
      setNote({ tone: "err", text: "Price must be a number" });
      return;
    }
    startTransition(async () => {
      const res = await quickAddItem({
        productId: hit.id,
        quantity: qty,
        // Singles carry a card grade; sealed/graded rows don't.
        condition: hit.category === "singles" ? condition : null,
        printing,
        askingPrice: asking,
      });
      if (res.error) {
        setNote({ tone: "err", text: res.error });
        return;
      }
      setNote({
        tone: "ok",
        text: `Added ${qty}× ${res.added}${printing ? ` (${printing})` : ""}${asking !== null ? ` at ${money(asking)}` : ""}`,
      });
      // Clear for the next card but keep qty/condition/price sticky.
      setQuery("");
      setHits([]);
      setPicking(null);
      inputRef.current?.focus();
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[active];
      if (hit) choose(hit);
    } else if (e.key === "Escape") {
      setHits([]);
    }
  }

  return (
    <div className="rounded-lg border bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Add to inventory</h2>
        <span className="text-xs text-neutral-400">
          type → ↵ to add · settings below stay for the next card
        </span>
      </div>

      <div className="relative">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={pending}
          placeholder="Search a card or sealed product — try “Blastoise” or “151 ETB”…"
          className="w-full rounded-lg border px-3 py-2.5 text-base outline-none ring-emerald-300 focus:ring-2 disabled:opacity-60"
        />
        {hits.length > 0 && (
          <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border bg-white shadow-lg">
            {hits.map((hit, i) => (
              <li key={hit.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(hit)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                    i === active ? "bg-emerald-50" : "hover:bg-neutral-50"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {hit.name}
                    </span>
                    <span className="block truncate text-xs text-neutral-500">
                      {hit.groupName} · {hit.category}
                    </span>
                  </span>
                  {hit.marketPrice !== null && (
                    <span className="shrink-0 text-xs tabular-nums text-neutral-500">
                      mkt {money(hit.marketPrice)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Which printing? — forced for multi-printing cards so 1st Ed and
          Unlimited never get stored as the same thing. */}
      {picking && (
        <div className="mt-2 rounded-lg border border-emerald-300 bg-emerald-50/60 p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-medium">
              {picking.name}
              <span className="ml-1 text-neutral-500">— which printing?</span>
            </span>
            <button
              type="button"
              onClick={() => setPicking(null)}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-100"
              aria-label="Cancel"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {picking.printings.map((p) => (
              <button
                key={p.subType}
                type="button"
                disabled={pending}
                onClick={() => add(picking, p.subType)}
                className="rounded-md border border-emerald-400 bg-white px-2.5 py-1.5 text-sm font-medium hover:bg-emerald-600 hover:text-white disabled:opacity-50"
              >
                {p.subType}
                {p.market !== null && (
                  <span className="ml-1 text-xs opacity-70">
                    {money(p.market)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sticky per-add settings — everything else is derived from the card */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-neutral-600">
        <label className="flex items-center gap-1.5">
          Qty
          <input
            type="number"
            min={1}
            max={9999}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
            className="w-16 rounded border px-2 py-1 text-sm tabular-nums"
          />
        </label>
        <label className="flex items-center gap-1.5">
          Condition
          <select
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            className="rounded border px-2 py-1 text-sm"
          >
            {CONDITIONS.singles.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <span className="text-neutral-400">(singles only)</span>
        </label>
        <label className="flex items-center gap-1.5">
          Price $
          <input
            type="number"
            min={0}
            step="1"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="track market"
            className="w-28 rounded border px-2 py-1 text-sm"
          />
        </label>
        {searching && <span className="text-neutral-400">searching…</span>}
        {pending && <span className="text-neutral-400">adding…</span>}
        {note && (
          <span
            className={
              note.tone === "ok"
                ? "font-medium text-emerald-700"
                : "font-medium text-red-600"
            }
          >
            {note.text}
          </span>
        )}
      </div>
    </div>
  );
}
