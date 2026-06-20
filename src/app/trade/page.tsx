import Link from "next/link";
import { TradeCounter } from "@/components/trade/trade-counter";
import type { ShopItem } from "@/components/trade/types";
import { listHotBuys } from "@/lib/hot-buys";
import { listInventory } from "@/lib/inventory";
import { getPopularPicks } from "@/lib/popular";
import { getSettings } from "@/lib/settings";
import { getCurrentShopId } from "@/lib/tenant";

export const metadata = { title: "Build your trade" };
export const dynamic = "force-dynamic";

export default async function TradePage({
  searchParams,
}: {
  searchParams: Promise<{ want?: string }>;
}) {
  const { want } = await searchParams;
  const shopId = await getCurrentShopId();
  const settings = await getSettings(shopId);
  const [listings, popularPicks, hotBuyRows] = await Promise.all([
    listInventory(shopId, settings, { availableOnly: true }),
    getPopularPicks(settings),
    listHotBuys(shopId),
  ]);
  const hotBuys = hotBuyRows.map((hb) => ({
    productId: hb.productId,
    name: hb.productName,
    groupId: hb.groupId,
    groupName: hb.groupName,
    imageUrl: hb.imageUrl,
    marketPrice: hb.marketPrice,
    category: hb.category,
    printings: hb.printings,
    bonusPercent: hb.bonusPercent,
    notes: hb.notes,
  }));
  const inventory: ShopItem[] = listings.map((l) => ({
    id: l.id,
    title: l.title,
    category: l.category,
    condition: l.condition,
    quantity: l.quantity,
    price: l.price,
    photoUrl: l.photoUrl,
    imageUrl: l.imageUrl,
  }));

  return (
    <div className="counter-felt min-h-screen">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5">
        <Link
          href="/"
          className="font-display text-xl font-bold text-white hover:text-emerald-100"
        >
          {settings.shop_name}
        </Link>
        <span className="text-sm text-emerald-100/70">the trade counter</span>
      </header>
      <TradeCounter
        shopName={settings.shop_name}
        inventory={inventory}
        popularPicks={popularPicks}
        hotBuys={hotBuys}
        initialWantId={want ?? null}
        quoteValidityDays={settings.quote_validity_days}
        rounding={{
          rounding_mode: settings.rounding_mode,
          rounding_step: settings.rounding_step,
        }}
      />
    </div>
  );
}
