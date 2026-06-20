import Image from "next/image";
import { and, desc, eq, ilike, isNotNull, sql, type SQL } from "drizzle-orm";
import { db, tables } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OverrideSelect } from "./override-select";

export const metadata = { title: "Catalog" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; page?: string }>;
}) {
  const { q = "", category = "sealed", page = "1" } = await searchParams;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);

  const conditions: SQL[] = [];
  if (category === "sealed" || category === "singles" || category === "graded") {
    conditions.push(
      sql`COALESCE(${tables.catalogProducts.categoryOverride}, ${tables.catalogProducts.category}) = ${category}`,
    );
  }
  for (const token of q.trim().split(/\s+/).filter(Boolean).slice(0, 8)) {
    conditions.push(ilike(tables.catalogProducts.name, `%${token}%`));
  }
  conditions.push(isNotNull(tables.catalogProducts.marketPrice));

  const rows = await db
    .select({
      id: tables.catalogProducts.id,
      name: tables.catalogProducts.name,
      groupName: tables.catalogGroups.name,
      category: tables.catalogProducts.category,
      categoryOverride: tables.catalogProducts.categoryOverride,
      imageUrl: tables.catalogProducts.imageUrl,
      marketPrice: tables.catalogProducts.marketPrice,
      priceUpdatedAt: tables.catalogProducts.priceUpdatedAt,
    })
    .from(tables.catalogProducts)
    .innerJoin(
      tables.catalogGroups,
      eq(tables.catalogGroups.id, tables.catalogProducts.groupId),
    )
    .where(and(...conditions))
    .orderBy(desc(tables.catalogProducts.marketPrice))
    .limit(PAGE_SIZE)
    .offset((pageNum - 1) * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Catalog</h1>
        <p className="text-sm text-neutral-500">
          Synced nightly from TCGplayer (via TCGCSV). Fix any misclassified
          products here — the override controls what shows in the public
          sealed trade builder.
        </p>
      </div>

      <form className="flex flex-wrap gap-2" action="/admin/catalog" method="get">
        <Input
          name="q"
          placeholder="Search products…"
          defaultValue={q}
          className="w-64"
        />
        <select
          name="category"
          defaultValue={category}
          className="h-9 rounded-md border bg-white px-2 text-sm"
        >
          <option value="sealed">Sealed</option>
          <option value="singles">Singles</option>
          <option value="graded">Graded</option>
          <option value="all">All</option>
        </select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12" />
            <TableHead>Product</TableHead>
            <TableHead>Set</TableHead>
            <TableHead className="text-right">Market</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Override</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                {row.imageUrl && (
                  <Image
                    src={row.imageUrl}
                    alt=""
                    width={36}
                    height={36}
                    className="rounded object-contain"
                    unoptimized
                  />
                )}
              </TableCell>
              <TableCell className="max-w-md truncate font-medium">
                {row.name}
              </TableCell>
              <TableCell className="max-w-48 truncate text-neutral-500">
                {row.groupName}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.marketPrice ? `$${Number(row.marketPrice).toFixed(2)}` : "—"}
              </TableCell>
              <TableCell>
                <Badge variant="secondary" className="capitalize">
                  {row.category}
                </Badge>
              </TableCell>
              <TableCell>
                <OverrideSelect
                  productId={row.id}
                  value={row.categoryOverride}
                />
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-neutral-500">
                No products found. Run the sync script to populate the catalog.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between">
        <Button asChild variant="outline" disabled={pageNum <= 1}>
          <a
            href={`/admin/catalog?q=${encodeURIComponent(q)}&category=${category}&page=${pageNum - 1}`}
          >
            Previous
          </a>
        </Button>
        <span className="text-sm text-neutral-500">Page {pageNum}</span>
        <Button asChild variant="outline" disabled={rows.length < PAGE_SIZE}>
          <a
            href={`/admin/catalog?q=${encodeURIComponent(q)}&category=${category}&page=${pageNum + 1}`}
          >
            Next
          </a>
        </Button>
      </div>
    </div>
  );
}
