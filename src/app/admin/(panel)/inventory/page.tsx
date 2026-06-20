import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
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
import { getSettings } from "@/lib/settings";
import { effectiveInventoryPrice } from "@/lib/inventory";
import { getCurrentShopId } from "@/lib/tenant";
import { ItemDialog, DeleteItemButton } from "./item-forms";

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
      quantity: tables.inventoryItems.quantity,
      askingPrice: tables.inventoryItems.askingPrice,
      photoUrl: tables.inventoryItems.photoUrl,
      status: tables.inventoryItems.status,
      productId: tables.inventoryItems.productId,
      source: tables.inventoryItems.source,
      marketPrice: tables.catalogProducts.marketPrice,
    })
    .from(tables.inventoryItems)
    .leftJoin(
      tables.catalogProducts,
      eq(tables.catalogProducts.id, tables.inventoryItems.productId),
    )
    .where(eq(tables.inventoryItems.shopId, shopId))
    .orderBy(tables.inventoryItems.createdAt);

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
          {rows.map((row) => {
            const priced = effectiveInventoryPrice(
              row.askingPrice === null ? null : Number(row.askingPrice),
              row.marketPrice === null ? null : Number(row.marketPrice),
              settings.inventory_market_markup,
            );
            return (
              <TableRow key={row.id}>
                <TableCell className="max-w-md truncate font-medium">
                  {row.title}
                  {row.condition && (
                    <span className="ml-2 text-xs text-neutral-400">
                      {row.condition}
                    </span>
                  )}
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
                  {priced ? (
                    <>
                      ${priced.price.toFixed(2)}
                      <span className="ml-1 text-xs text-neutral-400">
                        {priced.source === "market" ? "mkt" : "fixed"}
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
                        quantity: row.quantity,
                        askingPrice:
                          row.askingPrice === null
                            ? null
                            : Number(row.askingPrice),
                        photoUrl: row.photoUrl,
                        productId: row.productId,
                        status: row.status,
                      }}
                    />
                    <DeleteItemButton id={row.id} />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-neutral-500">
                No inventory yet. Add items manually or import a Collectr CSV.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
