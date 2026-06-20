import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db, tables } from "@/db";
import { isQuoteExpired } from "@/lib/expiry";
import { getCurrentShopId } from "@/lib/tenant";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReviewActions, CounterOfferForm } from "./review-forms";

export const metadata = { title: "Review Trade" };
export const dynamic = "force-dynamic";

function money(n: number | string): string {
  return `$${Number(n).toFixed(2)}`;
}

export default async function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const shopId = await getCurrentShopId();
  const [submission] = await db
    .select()
    .from(tables.submissions)
    .where(and(eq(tables.submissions.shopId, shopId), eq(tables.submissions.id, id)));
  if (!submission) notFound();

  const [tradeInItems, tradeForItems, photos] = await Promise.all([
    db
      .select()
      .from(tables.submissionTradeInItems)
      .where(eq(tables.submissionTradeInItems.submissionId, id)),
    db
      .select()
      .from(tables.submissionTradeForItems)
      .where(eq(tables.submissionTradeForItems.submissionId, id)),
    db
      .select({ id: tables.submissionPhotos.id })
      .from(tables.submissionPhotos)
      .where(eq(tables.submissionPhotos.submissionId, id)),
  ]);

  // Current market prices for delta highlighting
  const productIds = tradeInItems.map((i) => i.productId);
  const currentPrices = productIds.length
    ? await db
        .select({
          id: tables.catalogProducts.id,
          marketPrice: tables.catalogProducts.marketPrice,
        })
        .from(tables.catalogProducts)
        .where(inArray(tables.catalogProducts.id, productIds))
    : [];
  const currentById = new Map(currentPrices.map((p) => [p.id, p.marketPrice]));

  const expired = isQuoteExpired(submission.status, submission.quoteExpiresAt);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link href="/admin" className="text-sm text-neutral-500 hover:underline">
            ← Trade queue
          </Link>
          <h1 className="text-2xl font-semibold">
            {submission.customerName}
            <Badge className="ml-3 align-middle capitalize" variant="secondary">
              {expired ? "expired" : submission.status.replace("_", " ")}
            </Badge>
          </h1>
          <p className="text-sm text-neutral-500">
            {submission.customerEmail}
            {submission.customerPhone && ` · ${submission.customerPhone}`}
            {" · "}submitted {submission.createdAt?.toLocaleString()}
            {" · "}expires {submission.quoteExpiresAt.toLocaleDateString()}
            {" · "}
            <a
              className="underline"
              href={`/quote/${submission.publicToken}`}
              target="_blank"
            >
              customer view ↗
            </a>
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-neutral-500">
            {submission.rateType === "store_credit" ? "Store credit" : "Cash"}
          </p>
          <p className="text-2xl font-semibold tabular-nums">
            {money(submission.counterTotal ?? submission.tradeInTotal)}
          </p>
          {submission.counterTotal !== null && (
            <p className="text-xs text-neutral-400">
              originally {money(submission.tradeInTotal)}
            </p>
          )}
          {submission.takeCashRemainder &&
            submission.remainderCashValue !== null && (
              <p className="mt-1 rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                Wants CASH for leftover credit:{" "}
                {money(submission.remainderCashValue)}
              </p>
            )}
        </div>
      </div>

      {submission.customerMessage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Customer message</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{submission.customerMessage}</p>
          </CardContent>
        </Card>
      )}

      {photos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Customer photos ({photos.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {photos.map((photo) => (
                <a
                  key={photo.id}
                  href={`/api/photos/${photo.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/photos/${photo.id}`}
                    alt="Customer trade-in photo"
                    className="h-32 w-32 rounded-md object-cover shadow hover:opacity-90"
                  />
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">They&apos;re trading in</CardTitle>
          <CardDescription>
            Quoted prices were snapshotted at submission. &quot;Now&quot; shows
            today&apos;s market price — large deltas are highlighted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Market @ quote</TableHead>
                <TableHead className="text-right">Market now</TableHead>
                <TableHead className="text-right">%</TableHead>
                <TableHead className="text-right">Credit/unit</TableHead>
                <TableHead className="text-right">Line</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tradeInItems.map((item) => {
                const nowRaw = currentById.get(item.productId);
                const now = nowRaw == null ? null : Number(nowRaw);
                const then = Number(item.unitMarketPrice);
                const deltaPct = now !== null && then > 0 ? ((now - then) / then) * 100 : 0;
                const bigDelta = Math.abs(deltaPct) >= 5;
                return (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-sm whitespace-normal font-medium">
                      {item.productName}
                      {Number(item.hotBuyBonus) > 0 && (
                        <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-[11px] font-medium text-orange-800">
                          🔥 hot buy +{Number(item.hotBuyBonus)}%
                        </span>
                      )}
                      {item.graded && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                          {item.grader ?? "graded"} {item.grade ?? ""} · CUSTOM
                          OFFER
                        </span>
                      )}
                      {item.printing && (
                        <span className="block text-xs font-normal text-neutral-500">
                          {item.printing}
                        </span>
                      )}
                      {!item.graded && item.condition && (
                        <span className="block text-xs font-normal text-neutral-500">
                          {item.condition}
                          {Number(item.conditionMultiplier) !== 1 &&
                            ` (×${Number(item.conditionMultiplier)})`}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.quantity}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(then)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        bigDelta
                          ? deltaPct > 0
                            ? "font-semibold text-green-600"
                            : "font-semibold text-red-600"
                          : ""
                      }`}
                    >
                      {now !== null ? (
                        <>
                          {money(now)}
                          {bigDelta && (
                            <span className="block text-xs">
                              {deltaPct > 0 ? "+" : ""}
                              {deltaPct.toFixed(1)}%
                            </span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(item.appliedPercentage).toFixed(0)}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(item.unitCredit)}
                      {item.counterUnitCredit !== null && (
                        <span className="block text-xs text-amber-600">
                          → {money(item.counterUnitCredit)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(
                        Number(item.counterUnitCredit ?? item.unitCredit) *
                          item.quantity,
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {tradeForItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              They want ({money(submission.tradeForTotal)})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit</TableHead>
                  <TableHead className="text-right">Line</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tradeForItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-sm whitespace-normal font-medium">
                      {item.itemTitle}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.quantity}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(item.unitPrice)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(Number(item.unitPrice) * item.quantity)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <ReviewActions
        submissionId={submission.id}
        currentStatus={submission.status}
        adminNotes={submission.adminNotes}
      />

      <CounterOfferForm
        submissionId={submission.id}
        lines={tradeInItems.map((item) => ({
          lineId: item.id,
          productName: item.condition
            ? `${item.productName} (${item.condition})`
            : item.productName,
          quantity: item.quantity,
          unitCredit: Number(item.unitCredit),
          counterUnitCredit:
            item.counterUnitCredit === null
              ? null
              : Number(item.counterUnitCredit),
        }))}
      />
    </div>
  );
}
