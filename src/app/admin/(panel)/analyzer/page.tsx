import { eq, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { AnalyzerClient } from "./analyzer-client";

export const metadata = { title: "Buylist Analyzer" };
export const dynamic = "force-dynamic";

export default async function AnalyzerPage() {
  // Data-freshness strip: last successful sync + matched listing count per vendor
  const [lastSyncs, counts] = await Promise.all([
    db
      .select({
        vendor: tables.buylistSyncRuns.vendor,
        finishedAt: sql<string>`max(${tables.buylistSyncRuns.finishedAt})`,
      })
      .from(tables.buylistSyncRuns)
      .where(eq(tables.buylistSyncRuns.status, "success"))
      .groupBy(tables.buylistSyncRuns.vendor),
    db
      .select({
        vendor: tables.buylistPrices.vendor,
        total: sql<number>`count(*)`,
        matched: sql<number>`count(${tables.buylistPrices.productId})`,
      })
      .from(tables.buylistPrices)
      .groupBy(tables.buylistPrices.vendor),
  ]);

  const vendors = counts.map((c) => ({
    vendor: c.vendor,
    total: Number(c.total),
    matched: Number(c.matched),
    lastSync: lastSyncs.find((s) => s.vendor === c.vendor)?.finishedAt ?? null,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Buylist Analyzer</h1>
        <p className="text-sm text-neutral-500">
          Internal tool: paste or upload a card list and compare vendor buylist
          payouts against selling on TCGplayer. Customers never see this.
        </p>
      </div>
      <AnalyzerClient vendors={vendors} />
    </div>
  );
}
