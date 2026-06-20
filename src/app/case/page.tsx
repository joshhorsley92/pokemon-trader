import Image from "next/image";
import Link from "next/link";
import { listInventory } from "@/lib/inventory";
import { getSettings } from "@/lib/settings";
import { getCurrentShopId } from "@/lib/tenant";

export const metadata = { title: "Browse the case" };
export const dynamic = "force-dynamic";

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default async function CasePage() {
  const shopId = await getCurrentShopId();
  const settings = await getSettings(shopId);
  const items = await listInventory(shopId, settings, { availableOnly: true });

  return (
    <div className="counter-felt min-h-screen">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5">
        <Link
          href="/"
          className="font-display text-xl font-bold text-white hover:text-emerald-100"
        >
          {settings.shop_name}
        </Link>
        <Link
          href="/trade"
          className="rounded-md bg-[var(--manila)] px-4 py-2 text-sm font-semibold text-[var(--ink)] shadow transition-transform hover:-translate-y-0.5"
        >
          Start a trade
        </Link>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 pb-16">
        <h1 className="font-display text-3xl font-bold text-white sm:text-4xl">
          The display case
        </h1>
        <p className="mt-2 max-w-xl text-emerald-100/85">
          Everything here is up for trade. See something you like? Bring your
          sealed product to the counter and put your credit toward it.
        </p>

        <div className="case-frame mt-8">
          <div className="case-glass p-5 sm:p-7">
            <div className="relative z-[2] mb-5 text-center">
              <span className="brass-plaque">Up for trade</span>
            </div>
            {items.length === 0 ? (
              <p className="relative z-[2] p-5 text-center text-emerald-100/80">
                The case is being restocked — check back soon, or start a
                trade for store credit.
              </p>
            ) : (
              <ul className="relative z-[2] grid gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((item) => {
                  const img = item.photoUrl ?? item.imageUrl;
                  return (
                    <li
                      key={item.id}
                      className="shelf-item flex flex-col rounded-lg bg-white/95 p-4 shadow-[0_14px_18px_-10px_rgba(0,0,0,0.55)] transition-transform hover:-translate-y-0.5"
                    >
                      <div className="flex items-start gap-3">
                        {img ? (
                          <Image
                            src={img}
                            alt=""
                            width={72}
                            height={72}
                            className="h-18 w-18 shrink-0 rounded object-contain"
                            unoptimized
                          />
                        ) : (
                          <div className="h-18 w-18 shrink-0 rounded bg-neutral-100" />
                        )}
                        <div className="min-w-0 flex-1">
                          <h2 className="text-sm font-semibold leading-snug text-[var(--ink)]">
                            {item.title}
                          </h2>
                          <p className="mt-1 text-xs text-neutral-500">
                            {item.condition ? `${item.condition} · ` : ""}
                            {item.quantity > 1
                              ? `${item.quantity} available`
                              : "1 available"}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2 border-t border-neutral-100 pt-3">
                        <span className="price-tag text-sm">
                          {money(item.price)}
                        </span>
                        <Link
                          href={`/trade?want=${item.id}`}
                          className="rounded bg-[var(--felt)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-900"
                        >
                          Trade for this →
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </main>

      <footer className="mx-auto w-full max-w-5xl px-4 py-6 text-sm text-emerald-200/50">
        Prices follow the market and can change daily. Every trade is reviewed
        by a human before anything is final.
      </footer>
    </div>
  );
}
