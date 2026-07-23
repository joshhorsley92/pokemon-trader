"use client";

import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { bulkPriceToMarket, setItemPrice, setItemQuantity } from "./actions";
import { DeleteItemButton, ItemDialog } from "./item-forms";

export type InventoryRow = {
  id: string;
  title: string;
  category: "singles" | "sealed" | "graded";
  condition: string | null;
  printing: string | null;
  quantity: number;
  askingPrice: number | null;
  photoUrl: string | null;
  status: "available" | "reserved" | "sold" | "hidden";
  productId: number | null;
  setName: string | null;
  cardNumber: string | null;
  /** Effective sell price, resolved server-side; null = unpriced */
  price: number | null;
  priceSource: "fixed" | "market" | null;
  /** What this item WOULD sell for if it tracked market (market × markup) */
  marketSell: number | null;
  /** TCGplayer product page — price verification, one click away */
  tcgplayerUrl: string | null;
  createdAtMs: number;
};

const PAGE_SIZES = [10, 25, 50, 100] as const;

const SORTS = {
  newest: {
    label: "Recently added",
    cmp: (a: InventoryRow, b: InventoryRow) => b.createdAtMs - a.createdAtMs,
  },
  oldest: {
    label: "Oldest first",
    cmp: (a: InventoryRow, b: InventoryRow) => a.createdAtMs - b.createdAtMs,
  },
  az: {
    label: "Name A–Z",
    cmp: (a: InventoryRow, b: InventoryRow) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  },
  za: {
    label: "Name Z–A",
    cmp: (a: InventoryRow, b: InventoryRow) =>
      b.title.localeCompare(a.title, undefined, { sensitivity: "base" }),
  },
  "price-high": {
    label: "Price high → low",
    // Unpriced rows sink to the bottom either direction
    cmp: (a: InventoryRow, b: InventoryRow) =>
      (b.price ?? -Infinity) - (a.price ?? -Infinity),
  },
  "price-low": {
    label: "Price low → high",
    cmp: (a: InventoryRow, b: InventoryRow) =>
      (a.price ?? Infinity) - (b.price ?? Infinity),
  },
  "qty-high": {
    label: "Qty high → low",
    cmp: (a: InventoryRow, b: InventoryRow) => b.quantity - a.quantity,
  },
} satisfies Record<string, { label: string; cmp: (a: InventoryRow, b: InventoryRow) => number }>;

type SortKey = keyof typeof SORTS;

/**
 * Inventory list: instant client-side filter, selectable sort, pagination,
 * and inline quantity/price editing so common tweaks don't need the dialog.
 */
export function InventoryTable({ rows }: { rows: InventoryRow[] }) {
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPending, startBulk] = useTransition();
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runBulk(mode: "all" | "raise" | "lower", label: string) {
    const ids = selected.size > 0 ? [...selected] : null;
    const scope =
      ids !== null ? `the ${ids.length} selected item(s)` : `ALL ${rows.length} items`;
    if (!confirm(`${label} for ${scope}? Only fixed prices change — market-tracked items are already at market.`)) {
      return;
    }
    setBulkResult(null);
    startBulk(async () => {
      const res = await bulkPriceToMarket({ ids, mode });
      setBulkResult(
        res.error ??
          `Updated ${res.updated} price${res.updated === 1 ? "" : "s"}${
            res.skipped > 0 ? ` (${res.skipped} already in line or not eligible)` : ""
          }.`,
      );
      setSelected(new Set());
    });
  }

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const matched = !f
      ? rows
      : rows.filter((r) =>
          [
            r.title,
            r.condition ?? "",
            r.printing ?? "",
            r.setName ?? "",
            r.cardNumber ?? "",
            r.category,
            r.status,
          ]
            .join(" ")
            .toLowerCase()
            .includes(f),
        );
    return [...matched].sort(SORTS[sortKey].cmp);
  }, [rows, filter, sortKey]);

  // Clamp the page during render (derived, not stateful) so a shrinking filter
  // can't leave us on an out-of-range page.
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const shown = filtered.slice(start, start + pageSize);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          type="search"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
          placeholder="Search my inventory — name, condition, status…"
          className="w-full max-w-md rounded-lg border px-3 py-2 text-sm outline-none ring-emerald-300 focus:ring-2"
        />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-neutral-500">
            Sort
            <select
              value={sortKey}
              onChange={(e) => {
                setSortKey(e.target.value as SortKey);
                setPage(1);
              }}
              className="rounded border px-2 py-1 text-sm"
            >
              {(Object.keys(SORTS) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORTS[k].label}
                </option>
              ))}
            </select>
          </label>
        <label className="flex items-center gap-1.5 text-xs text-neutral-500">
          Show
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="rounded border px-2 py-1 text-sm"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          per page
        </label>
        </div>
      </div>

      {/* Bulk pricing: acts on the checked rows, or everything when none are
          checked. Only fixed prices move — market-tracked rows already float. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white px-3 py-2 shadow-sm">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Bulk pricing
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={bulkPending}
          onClick={() =>
            runBulk("all", "Clear fixed prices so items float with live market")
          }
          title="Removes the fixed price — the item tracks market (× markup) from then on"
        >
          Float with market
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={bulkPending}
          onClick={() => runBulk("raise", "Raise below-market prices to market")}
          title="Only items priced BELOW market move up — a price floor"
        >
          Raise to market ↑
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={bulkPending}
          onClick={() => runBulk("lower", "Lower above-market prices to market")}
          title="Only items priced ABOVE market move down — a price ceiling"
        >
          Lower to market ↓
        </Button>
        <span className="text-xs text-neutral-500">
          {bulkPending
            ? "Updating…"
            : selected.size > 0
              ? `applies to ${selected.size} selected`
              : `nothing selected — applies to all ${rows.length}`}
        </span>
        {bulkResult && (
          <span className="text-xs font-medium text-emerald-700">{bulkResult}</span>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <input
                type="checkbox"
                aria-label="Select all filtered items"
                checked={filtered.length > 0 && selected.size >= filtered.length}
                ref={(el) => {
                  if (el) {
                    el.indeterminate =
                      selected.size > 0 && selected.size < filtered.length;
                  }
                }}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? new Set(filtered.map((r) => r.id))
                      : new Set(),
                  )
                }
              />
            </TableHead>
            <TableHead>Item</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-center">Qty</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="w-8">
                <input
                  type="checkbox"
                  aria-label={`Select ${row.title}`}
                  checked={selected.has(row.id)}
                  onChange={() => toggleRow(row.id)}
                />
              </TableCell>
              <TableCell className="max-w-md">
                {row.tcgplayerUrl ? (
                  <a
                    href={row.tcgplayerUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Open on TCGplayer to verify pricing"
                    className="block truncate font-medium underline-offset-2 hover:underline"
                  >
                    {row.title}
                    <span className="ml-1 text-xs text-neutral-400">↗</span>
                  </a>
                ) : (
                  <span className="block truncate font-medium">{row.title}</span>
                )}
                <span className="block truncate text-xs text-neutral-400">
                  {[
                    row.setName,
                    row.cardNumber ? `#${row.cardNumber}` : null,
                    row.printing,
                    row.condition,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </TableCell>
              <TableCell>
                <Badge variant="secondary" className="capitalize">
                  {row.category}
                </Badge>
              </TableCell>
              <TableCell>
                <QtyCell
                  key={`${row.id}:${row.quantity}`}
                  id={row.id}
                  quantity={row.quantity}
                />
              </TableCell>
              <TableCell className="text-right">
                <PriceCell
                  key={`${row.id}:${row.priceSource}:${row.price}`}
                  id={row.id}
                  price={row.price}
                  priceSource={row.priceSource}
                />
                {row.priceSource === "fixed" &&
                  row.price !== null &&
                  row.marketSell !== null &&
                  row.marketSell > row.price && (
                    <span
                      className="mt-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                      title="Market has moved above your fixed price"
                    >
                      ↑ mkt ${row.marketSell.toFixed(0)}
                    </span>
                  )}
              </TableCell>
              <TableCell>
                <Badge
                  variant={row.status === "available" ? "default" : "outline"}
                  className="capitalize"
                >
                  {row.status}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <ItemDialog
                    mode="edit"
                    item={{
                      id: row.id,
                      title: row.title,
                      category: row.category,
                      condition: row.condition,
                      printing: row.printing,
                      quantity: row.quantity,
                      askingPrice: row.askingPrice,
                      photoUrl: row.photoUrl,
                      productId: row.productId,
                      status: row.status,
                    }}
                  />
                  <DeleteItemButton id={row.id} />
                </div>
              </TableCell>
            </TableRow>
          ))}
          {shown.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-neutral-500">
                {rows.length === 0
                  ? "No inventory yet — add a card above or import a Collectr CSV."
                  : "Nothing matches that search."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-neutral-500">
          <span>
            {start + 1}–{Math.min(start + pageSize, filtered.length)} of{" "}
            {filtered.length}
            {filter.trim() ? ` (filtered from ${rows.length})` : ""}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(Math.max(1, safePage - 1))}
              disabled={safePage <= 1}
              className="rounded border px-2.5 py-1 hover:bg-neutral-50 disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="px-1 tabular-nums">
              {safePage} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage(Math.min(pageCount, safePage + 1))}
              disabled={safePage >= pageCount}
              className="rounded border px-2.5 py-1 hover:bg-neutral-50 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function QtyCell({ id, quantity }: { id: string; quantity: number }) {
  const [pending, startTransition] = useTransition();
  // Typed edits live here until blur/Enter; +/- commit immediately. Remounted
  // via `key` when the server sends a new quantity, so this stays in sync.
  const [value, setValue] = useState(String(quantity));

  function commit(next: number) {
    if (!Number.isFinite(next) || next < 0) {
      setValue(String(quantity)); // reject junk, restore server truth
      return;
    }
    const whole = Math.floor(next);
    setValue(String(whole));
    if (whole === quantity) return;
    startTransition(async () => {
      await setItemQuantity({ id, quantity: whole });
    });
  }

  // Step from what's on screen, not the server value, so +/- after typing
  // does what it looks like it will.
  const shown = Number(value.trim());
  const base =
    value.trim() !== "" && Number.isFinite(shown) && shown >= 0
      ? Math.floor(shown)
      : quantity;

  return (
    <div className="flex items-center justify-center gap-1">
      <button
        type="button"
        onClick={() => commit(base - 1)}
        disabled={pending || base <= 0}
        className="flex h-6 w-6 items-center justify-center rounded border text-base leading-none hover:bg-neutral-100 disabled:opacity-40"
        aria-label="Decrease quantity"
      >
        −
      </button>
      <input
        type="number"
        min={0}
        step="1"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => commit(Number(value.trim()))}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setValue(String(quantity));
            e.currentTarget.blur();
          }
        }}
        aria-label="Quantity"
        className={`w-12 rounded border px-1 py-0.5 text-center text-sm tabular-nums ${
          pending ? "opacity-50" : ""
        }`}
      />
      <button
        type="button"
        onClick={() => commit(base + 1)}
        disabled={pending}
        className="flex h-6 w-6 items-center justify-center rounded border text-base leading-none hover:bg-neutral-100 disabled:opacity-40"
        aria-label="Increase quantity"
      >
        +
      </button>
    </div>
  );
}

function PriceCell({
  id,
  price,
  priceSource,
}: {
  id: string;
  price: number | null;
  priceSource: "fixed" | "market" | null;
}) {
  // The field always carries the effective price — the fixed one, or the live
  // market value for a market-tracked item — so the number spinner steps from
  // market instead of from 0. Market-tracked shows muted (the "mkt" badge
  // names the source); it only becomes a pinned price once actually edited.
  // Clearing the field still reverts to tracking market.
  // Remounted via `key` when the server sends a new price, so initial state is
  // always fresh — no effect-based re-sync needed.
  const initial = price !== null ? String(price) : "";
  const [value, setValue] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();

  function commit() {
    // Untouched market-tracked rows must not get pinned just by being focused.
    if (!dirty) return;
    const trimmed = value.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && (Number.isNaN(next) || next < 0)) {
      setValue(initial);
      setDirty(false);
      return;
    }
    // No change vs. what's stored (fixed value or cleared/market).
    const storedFixed = priceSource === "fixed" && price !== null ? price : null;
    if (next === storedFixed) {
      setDirty(false);
      return;
    }
    startTransition(async () => {
      await setItemPrice({ id, askingPrice: next });
    });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <span className="text-neutral-400">$</span>
      <input
        type="number"
        min={0}
        step="1"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setDirty(true);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setValue(initial);
            setDirty(false);
            e.currentTarget.blur();
          }
        }}
        placeholder="market"
        className={`w-20 rounded border px-2 py-1 text-right text-sm tabular-nums ${
          pending ? "opacity-50" : ""
        } ${priceSource === "market" && !dirty ? "text-neutral-400" : ""}`}
      />
      <span className="w-8 text-left text-[10px] text-neutral-400">
        {priceSource === "market" ? "mkt" : priceSource === "fixed" ? "fixed" : ""}
      </span>
    </div>
  );
}
