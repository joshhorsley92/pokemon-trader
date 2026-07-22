"use client";

import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { setItemPrice, setItemQuantity } from "./actions";
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
};

const PAGE_SIZES = [10, 25, 50, 100] as const;

/**
 * Inventory list: instant client-side filter, alphabetical sort, pagination,
 * and inline quantity/price editing so common tweaks don't need the dialog.
 */
export function InventoryTable({ rows }: { rows: InventoryRow[] }) {
  const [filter, setFilter] = useState("");
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState(1);

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
    return [...matched].sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    );
  }, [rows, filter]);

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

      <Table>
        <TableHeader>
          <TableRow>
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
              <TableCell className="max-w-md">
                <span className="block truncate font-medium">{row.title}</span>
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
              <TableCell colSpan={6} className="py-8 text-center text-neutral-500">
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
