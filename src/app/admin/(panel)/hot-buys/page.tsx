import Image from "next/image";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listHotBuys } from "@/lib/hot-buys";
import { getCurrentShopId } from "@/lib/tenant";
import { AddHotBuyForm, HotBuyRow } from "./hot-buy-forms";

export const metadata = { title: "Hot Buys" };
export const dynamic = "force-dynamic";

export default async function HotBuysPage() {
  const hotBuys = await listHotBuys(await getCurrentShopId());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Hot buys 🔥</h1>
        <p className="text-sm text-neutral-500">
          Products you&apos;re actively hunting. They&apos;re showcased on the
          trade builder and customers get bonus credit on top of the normal
          rate — e.g. an 85% sealed default with a +10 bonus pays 95% of
          market.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Currently hunting</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {hotBuys.length === 0 && (
            <p className="text-sm text-neutral-500">
              No hot buys yet — add one below.
            </p>
          )}
          {hotBuys.map((hb) => (
            <div
              key={hb.id}
              className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2"
            >
              {hb.imageUrl && (
                <Image
                  src={hb.imageUrl}
                  alt=""
                  width={36}
                  height={36}
                  className="h-9 w-9 rounded object-contain"
                  unoptimized
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug">
                  {hb.productName}
                </p>
                <p className="text-xs text-neutral-400">
                  {hb.groupName}
                  {hb.marketPrice !== null &&
                    ` · market $${hb.marketPrice.toFixed(2)}`}
                  {hb.notes && ` · ${hb.notes}`}
                </p>
              </div>
              <HotBuyRow id={hb.id} bonusPercent={hb.bonusPercent} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add a hot buy</CardTitle>
          <CardDescription>
            Bonus is in percentage points added to the customer&apos;s normal
            rate (both store credit and cash).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddHotBuyForm />
        </CardContent>
      </Card>
    </div>
  );
}
