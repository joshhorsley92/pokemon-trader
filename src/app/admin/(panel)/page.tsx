import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { isPriceDataStale, isQuoteExpired } from "@/lib/expiry";
import { getCurrentShopId } from "@/lib/tenant";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "Trade Queue" };
export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "default",
  under_review: "secondary",
  countered: "secondary",
  accepted: "outline",
  declined: "destructive",
  completed: "outline",
};

export default async function AdminDashboard() {
  const shopId = await getCurrentShopId();
  const [submissions, [priceFreshness], [lastSync]] = await Promise.all([
    db
      .select()
      .from(tables.submissions)
      .where(eq(tables.submissions.shopId, shopId))
      .orderBy(desc(tables.submissions.createdAt))
      .limit(100),
    db
      .select({
        latest: sql<string | null>`max(${tables.catalogProducts.priceUpdatedAt})`,
        count: sql<number>`count(*)`,
      })
      .from(tables.catalogProducts),
    db
      .select()
      .from(tables.syncRuns)
      .orderBy(desc(tables.syncRuns.startedAt))
      .limit(1),
  ]);

  const latestPrice = priceFreshness?.latest
    ? new Date(priceFreshness.latest)
    : null;
  const stale = isPriceDataStale(latestPrice);
  const emptyCatalog = Number(priceFreshness?.count ?? 0) === 0;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Trade queue</h1>

      {emptyCatalog && (
        <Alert>
          <AlertTitle>Catalog is empty</AlertTitle>
          <AlertDescription>
            Run <code>npm run sync</code> to pull the Pokémon catalog and
            prices from TCGCSV (one-time backfill takes ~10–20 minutes).
          </AlertDescription>
        </Alert>
      )}
      {!emptyCatalog && stale && (
        <Alert>
          <AlertTitle>Prices are stale</AlertTitle>
          <AlertDescription>
            Last price update:{" "}
            {latestPrice ? latestPrice.toLocaleString() : "never"}.
            {lastSync && lastSync.status === "failed"
              ? ` Last sync FAILED: ${lastSync.error ?? "unknown error"}`
              : " Check the GitHub Actions sync workflow."}
          </AlertDescription>
        </Alert>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Trade-in</TableHead>
            <TableHead className="text-right">Wants</TableHead>
            <TableHead>Payout</TableHead>
            <TableHead>Submitted</TableHead>
            <TableHead>Expires</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {submissions.map((s) => {
            const expired = isQuoteExpired(s.status, s.quoteExpiresAt);
            return (
              <TableRow key={s.id}>
                <TableCell>
                  <Link
                    href={`/admin/submissions/${s.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {s.customerName}
                  </Link>
                  <span className="block text-xs text-neutral-400">
                    {s.customerEmail}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={expired ? "outline" : (STATUS_VARIANT[s.status] ?? "secondary")}
                    className="capitalize"
                  >
                    {expired ? "expired" : s.status.replace("_", " ")}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  ${Number(s.tradeInTotal).toFixed(2)}
                  {s.counterTotal !== null && (
                    <span className="block text-xs text-amber-600">
                      → ${Number(s.counterTotal).toFixed(2)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  ${Number(s.tradeForTotal).toFixed(2)}
                </TableCell>
                <TableCell className="text-sm">
                  {s.rateType === "store_credit" ? "Credit" : "Cash"}
                </TableCell>
                <TableCell className="text-sm text-neutral-500">
                  {s.createdAt?.toLocaleDateString()}
                </TableCell>
                <TableCell className="text-sm text-neutral-500">
                  {s.quoteExpiresAt.toLocaleDateString()}
                </TableCell>
              </TableRow>
            );
          })}
          {submissions.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-neutral-500">
                No trade proposals yet. Share the public link to get started.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
