"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

/**
 * Inventory list with an instant client-side filter — no round trip, so
 * finding a card in a few hundred rows is just typing.
 */
export function InventoryTable({ rows }: { rows: InventoryRow[] }) {
  const [filter, setFilter] = useState("");

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return rows;
    return rows.filter((r) =>
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
  }, [rows, filter]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search my inventory — name, condition, status…"
          className="w-full max-w-md rounded-lg border px-3 py-2 text-sm outline-none ring-emerald-300 focus:ring-2"
        />
        <span className="text-xs text-neutral-500">
          {filter.trim()
            ? `${shown.length} of ${rows.length} items`
            : `${rows.length} item${rows.length === 1 ? "" : "s"}`}
        </span>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">Qty</TableHead>
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
              <TableCell className="text-right tabular-nums">
                {row.quantity}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.price !== null ? (
                  <>
                    ${row.price.toFixed(2)}
                    <span className="ml-1 text-xs text-neutral-400">
                      {row.priceSource === "market" ? "mkt" : "fixed"}
                    </span>
                  </>
                ) : (
                  <span className="text-red-500">unpriced</span>
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
              <TableCell colSpan={6} className="py-8 text-center text-neutral-500">
                {rows.length === 0
                  ? "No inventory yet — add a card above or import a Collectr CSV."
                  : "Nothing matches that search."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
