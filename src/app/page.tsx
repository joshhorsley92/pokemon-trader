import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { getCurrentShopId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const MOVES = [
  {
    title: "Slide it across",
    body: "Tell us what sealed product you're trading in — booster boxes, ETBs, tins, collections. You'll see your credit instantly, priced from live market data.",
  },
  {
    title: "Point at the case",
    body: "Put that credit toward anything in our inventory. Leftover credit is fine; so is owing a little — we'll square up when we talk.",
  },
  {
    title: "Shake on it",
    body: "Send the proposal. A real person (us!) looks it over, and you'll hear back within a day with a yes, a question, or a counter.",
  },
] as const;

export default async function LandingPage() {
  const settings = await getSettings(await getCurrentShopId());
  return (
    <div className="counter-felt flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5">
        <span className="font-display text-xl font-bold text-white">
          {settings.shop_name}
        </span>
        <nav className="flex items-center gap-4">
          <Link
            href="/case"
            className="text-sm font-medium text-emerald-100/80 hover:text-white"
          >
            Browse the case
          </Link>
          <Link
            href="/trade"
            className="rounded-md bg-[var(--manila)] px-4 py-2 text-sm font-semibold text-[var(--ink)] shadow hover:-translate-y-0.5 transition-transform"
          >
            Start a trade
          </Link>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 py-12">
        <p className="font-slip text-sm uppercase tracking-[0.25em] text-emerald-200/80">
          no account · no fees · just a deal
        </p>
        <h1 className="mt-3 max-w-2xl font-display text-5xl font-bold leading-[1.05] text-white sm:text-6xl">
          The trade counter is open.
        </h1>
        <p className="mt-5 max-w-xl text-lg text-emerald-100/85">
          Bring your sealed Pokémon products to the counter, see what
          they&apos;re worth in trade the moment you set them down, and walk
          away with something you actually want.
        </p>
        <div className="mt-8">
          <Link
            href="/trade"
            className="inline-block rounded-md bg-[var(--tag)] px-8 py-4 font-display text-xl font-bold text-[var(--ink)] shadow-lg transition-transform hover:-translate-y-0.5"
          >
            Put something on the counter →
          </Link>
        </div>

        <ol className="mt-16 grid gap-4 sm:grid-cols-3">
          {MOVES.map((move, i) => (
            <li key={move.title} className="felt-stitch p-5">
              <span className="font-slip text-xs text-emerald-200/70">
                move {i + 1} of 3
              </span>
              <h2 className="mt-1 font-display text-xl font-semibold text-white">
                {move.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-emerald-100/80">
                {move.body}
              </p>
            </li>
          ))}
        </ol>
      </main>

      <footer className="mx-auto w-full max-w-5xl px-4 py-6 text-sm text-emerald-200/50">
        Prices reference TCGplayer market data, refreshed daily. Every trade is
        reviewed by a human before anything is final.
      </footer>
    </div>
  );
}
