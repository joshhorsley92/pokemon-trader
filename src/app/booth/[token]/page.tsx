import { TradeCounter } from "@/components/trade/trade-counter";
import type { ShopItem } from "@/components/trade/types";
import { listHotBuys } from "@/lib/hot-buys";
import { listInventory } from "@/lib/inventory";
import { getPopularPicks } from "@/lib/popular";
import { getSettings } from "@/lib/settings";
import { getSessionByToken } from "@/lib/show";

export const metadata = { title: "Trade at the booth" };
export const dynamic = "force-dynamic";

export default async function BoothPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const found = await getSessionByToken(token);

  if (!found || found.session.status !== "open") {
    return (
      <div className="counter-felt flex min-h-screen items-center justify-center px-4">
        <div className="felt-stitch max-w-sm p-8 text-center">
          <p className="text-4xl">🚪</p>
          <h1 className="mt-3 font-display text-xl font-semibold text-white">
            This booth isn&apos;t taking trades right now
          </h1>
          <p className="mt-2 text-sm text-emerald-100/80">
            Ask the seller for a fresh code, or check back when they reopen.
          </p>
        </div>
      </div>
    );
  }

  const { shopId, session } = found;
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
        <span className="font-display text-xl font-bold text-white">
          {settings.shop_name}
        </span>
        <span className="text-sm text-emerald-100/70">{session.name}</span>
      </header>
      <TradeCounter
        shopName={settings.shop_name}
        inventory={inventory}
        popularPicks={popularPicks}
        hotBuys={hotBuys}
        initialWantId={null}
        quoteValidityDays={settings.quote_validity_days}
        rounding={{
          rounding_mode: settings.rounding_mode,
          rounding_step: settings.rounding_step,
        }}
        booth={{ token }}
      />
    </div>
  );
}
