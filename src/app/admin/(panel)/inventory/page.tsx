import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { Button } from "@/components/ui/button";
import { getSettings } from "@/lib/settings";
import { effectiveInventoryPrice } from "@/lib/inventory";
import { getCurrentShopId } from "@/lib/tenant";
import { ItemDialog } from "./item-forms";
import { InventoryTable, type InventoryRow } from "./inventory-table";
import { QuickAdd } from "./quick-add";
import { setInventoryMarkup } from "./actions";

export const metadata = { title: "Inventory" };
export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const shopId = await getCurrentShopId();
  const settings = await getSettings(shopId);
  const rows = await db
    .select({
      id: tables.inventoryItems.id,
      title: tables.inventoryItems.title,
      category: tables.inventoryItems.category,
      condition: tables.inventoryItems.condition,
      printing: tables.inventoryItems.printing,
      quantity: tables.inventoryItems.quantity,
      askingPrice: tables.inventoryItems.askingPrice,
      photoUrl: tables.inventoryItems.photoUrl,
      status: tables.inventoryItems.status,
      productId: tables.inventoryItems.productId,
      source: tables.inventoryItems.source,
      marketPrice: tables.catalogProducts.marketPrice,
      setName: tables.catalogGroups.name,
      cardNumber: sql<string | null>`(
        SELECT e->>'value' FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(${tables.catalogProducts.extData}) = 'array'
               THEN ${tables.catalogProducts.extData} ELSE '[]'::jsonb END
        ) e WHERE e->>'name' = 'Number' LIMIT 1
      )`,
    })
    .from(tables.inventoryItems)
    .leftJoin(
      tables.catalogProducts,
      eq(tables.catalogProducts.id, tables.inventoryItems.productId),
    )
    .leftJoin(
      tables.catalogGroups,
      eq(tables.catalogGroups.id, tables.catalogProducts.groupId),
    )
    .where(eq(tables.inventoryItems.shopId, shopId))
    .orderBy(tables.inventoryItems.createdAt);

  // Price every row once here (server-side), then hand plain data to the
  // client table so filtering stays instant.
  const priceOf = (row: (typeof rows)[number]) =>
    effectiveInventoryPrice(
      row.askingPrice === null ? null : Number(row.askingPrice),
      row.marketPrice === null ? null : Number(row.marketPrice),
      settings.inventory_market_markup,
    );

  const tableRows: InventoryRow[] = rows.map((row) => {
    const priced = priceOf(row);
    return {
      id: row.id,
      title: row.title,
      category: row.category,
      condition: row.condition,
      printing: row.printing,
      quantity: row.quantity,
      askingPrice: row.askingPrice === null ? null : Number(row.askingPrice),
      photoUrl: row.photoUrl,
      status: row.status,
      productId: row.productId,
      setName: row.setName,
      cardNumber: row.cardNumber,
      price: priced?.price ?? null,
      priceSource: priced?.source ?? null,
    };
  });

  // Total retail value of sellable stock (available items at their sell price).
  let totalValueCents = 0;
  let availableUnits = 0;
  let unpricedItems = 0;
  for (const row of rows) {
    if (row.status !== "available") continue;
    const priced = priceOf(row);
    if (!priced) {
      unpricedItems += 1; // unmatched/unpriced rows are excluded from the total
      continue;
    }
    totalValueCents += Math.round(priced.price * 100) * row.quantity;
    availableUnits += row.quantity;
  }
  const totalValue = totalValueCents / 100;
  const money = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD" });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Inventory</h1>
          <p className="text-sm text-neutral-500">
            What customers can trade for. Items linked to the catalog track
            market price automatically (×{settings.inventory_market_markup}
            {" markup"}); a fixed asking price overrides that.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/admin/inventory/import">Import CSV</Link>
          </Button>
          <ItemDialog mode="create" />
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-neutral-400">
            Total inventory value
          </p>
          <p className="text-2xl font-bold tabular-nums text-emerald-700">
            {money(totalValue)}
          </p>
          <p className="text-xs text-neutral-500">
            {availableUnits} unit{availableUnits === 1 ? "" : "s"} available, at
            sell price
          </p>
          {unpricedItems > 0 && (
            <p className="mt-0.5 text-xs font-medium text-amber-600">
              {unpricedItems} item{unpricedItems === 1 ? "" : "s"} unpriced — not
              counted
            </p>
          )}
        </div>

        <form
          action={setInventoryMarkup}
          className="flex flex-col justify-center gap-1.5 rounded-lg border bg-white p-4 shadow-sm"
        >
          <span className="text-xs uppercase tracking-wide text-neutral-400">
            Sell pricing
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-neutral-600">market +</span>
            <input
              name="percent"
              type="number"
              step="0.5"
              min={-90}
              max={1000}
              defaultValue={Math.round(
                (settings.inventory_market_markup - 1) * 100,
              )}
              className="w-16 rounded border px-2 py-1.5 text-right text-sm tabular-nums"
            />
            <span className="text-sm font-medium text-neutral-600">%</span>
            <Button type="submit" size="sm">
              Apply
            </Button>
          </div>
          <span className="text-xs text-neutral-400">
            applies to every market-priced item
          </span>
        </form>
      </div>

      <QuickAdd />

      <InventoryTable rows={tableRows} />
    </div>
  );
}
