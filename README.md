# Pokémon Trader — The Trade Counter

A trade-in web app for a Pokémon card shop. Customers build a trade-in (sealed
products in v1), see their store-credit or cash offer instantly from live
market prices, pick items from the shop's inventory, and submit a proposal.
The owners review, accept, decline, or counter from a private admin area.

Built to be linked from a Facebook Marketplace post: no accounts, no checkout —
just a deal slip and a handshake.

## Stack

- **Next.js 16** (App Router) — public site + admin panel + API
- **Postgres** (Supabase in production) + **Drizzle ORM**
- **TCGCSV** (tcgcsv.com) — free daily mirror of TCGplayer prices, synced
  nightly by GitHub Actions into our own DB (the app never calls TCGCSV at
  request time)
- **Resend** — owner notifications + customer status emails (optional)
- Hosted on **Vercel** (free tier)

## Local development

```bash
npm install

# 1. Point .env / .env.local at a Postgres database
#    (any Postgres works locally, e.g.:
#     docker run -d --name pokemon-trader-pg -e POSTGRES_PASSWORD=postgres \
#       -e POSTGRES_DB=pokemon_trader -p 5432:5432 postgres:16-alpine)

# 2. Create tables, seed admins/rules/settings (admin creds come from env)
npx drizzle-kit migrate
npm run db:seed

# 3. Backfill the catalog + prices from TCGCSV (~5-20 min, idempotent)
npm run sync

npm run dev          # http://localhost:3000  (admin at /admin)
npm test             # pricing engine unit tests
```

## Production setup (one-time)

1. **Supabase**: create a project → copy the *transaction pooler* connection
   string (port 6543) into `DATABASE_URL` and the *direct/session* string
   (port 5432) into `DIRECT_DATABASE_URL`.
2. Run `npx drizzle-kit migrate`, `npm run db:seed`, and `npm run sync` locally
   against those URLs once.
3. **Vercel**: import the repo, set the env vars from `.env.example`.
4. **GitHub**: add `DIRECT_DATABASE_URL` as a repo secret — the
   [sync workflow](.github/workflows/sync.yml) refreshes prices nightly
   (21:30 UTC). Run it manually from the Actions tab any time
   (check "full" to re-sync everything).
5. **Resend** (optional): verify a domain, set `RESEND_API_KEY` and
   `EMAIL_FROM`, and put your emails in Admin → Settings → notification emails.

## How pricing works

- Nightly sync stores every Pokémon product (sealed and singles) with
  TCGplayer market price.
- Trade-in credit = market price × percentage. Percentages are configured in
  **Admin → Pricing** with most-specific-wins precedence:
  **product override → set override → category default** (separately for
  store credit vs cash).
- Quotes are recomputed server-side on every change and **snapshotted at
  submission** — later price moves never alter a submitted quote. Quotes
  expire after a configurable window (default 7 days).
- Shop inventory items linked to a catalog product track market price
  automatically (× a configurable markup); a fixed asking price overrides.

## Buylist analyzer (internal)

**Admin → Analyzer** answers "for each card in this pile: sell it to a vendor
buylist, list it on TCGplayer, or bulk it?" Paste a list, upload a
TCGplayer/Collectr CSV export (Collectr PRO: Portfolio → ⋯ → Export), or
search-and-add cards manually. Also available headless:
`npx tsx scripts/analyze-list.ts <list.txt>`.

- **Sell side**: TCGplayer market price from the existing TCGCSV catalog,
  minus fees/materials/labor (knobs in the `analyzer_economics` setting).
- **Buy side**: vendor buylists synced nightly into `buylist_prices` by
  `npm run sync:buylists` (runs after the TCGCSV sync in GitHub Actions):
  - **Card Cavern** — Shopify `products.json`; per-condition price ladder;
    `available=false` means *not currently buying* (kept as reference rows)
  - **CoolStuffInc** — their pre-generated sell-list JSON (~20k rows)
  - **Full Grip Games** — Crystal Commerce HTML crawl (~156 set pages)
- Vendor listings are matched to catalog products by card number + set + name
  (`src/lib/analyzer/match.ts`, ~99% match rate). Adapter parsers are tested
  against real captured responses in `/.samples`.
- Decisions amortize buylist shipping per vendor batch and re-run until
  stable (a lone $3 card can't justify $5 of shipping; ten can). Click a
  decision badge in the UI to override; totals update live. Results split
  into tabs: per-vendor ship lists, TCGplayer pile, bulk pile, sealed.
- All economics knobs (fee %, shipping, bulk threshold/rate, minimum offer,
  high-value flag) are editable in **Admin → Settings**.
- Sealed products in a customer list match the sealed catalog and are
  flagged/tabbed — never auto-bulked. Vendor offers wildly above market get
  an "offer ≫ market — verify" warning (vendor buylists publish glitches).
- **MTG mode** (toggle on the Analyzer page) ports Josh's mtg-sell-helper:
  resolves via Scryfall (ManaBox CSV or text lines; include set codes for
  exact printings) and prices the buy side from Card Kingdom's pricelist API
  (cash + 30% trade credit), through the same decision engine.
- Customer-facing payout reports stay on the existing trade-in flow — the
  analyzer is admin-only.

## Project map

| Path | What it is |
| --- | --- |
| `src/lib/pricing.ts` | Pure pricing engine (rules, rounding) + unit tests |
| `src/lib/quote.ts` | DB-backed quoting used by preview and submit |
| `scripts/sync-tcgcsv.ts` | Daily catalog/price sync (also the backfill) |
| `scripts/sync-buylists.ts` | Nightly vendor buylist sync (Card Cavern, CoolStuffInc, Full Grip) |
| `scripts/analyze-list.ts` | CLI buylist analyzer |
| `src/lib/analyzer/` | Decision engine, list parsers, catalog matcher + unit tests |
| `src/lib/buylists/` | Vendor buylist adapters + fixture tests (`/.samples`) |
| `src/app/trade/` | Public trade builder ("the counter") |
| `src/app/quote/[token]/` | Customer-facing deal slip / status page |
| `src/app/admin/` | Login, trade queue, review/counter, pricing rules, inventory + CSV import, catalog browser, buylist analyzer, settings |
| `src/db/schema.ts` | Drizzle schema (categories ready for singles/graded) |

## Roadmap (designed-for, not yet built)

- **Singles trade-ins**: catalog + pricing already synced; needs search UX and
  NM/LP/MP condition multipliers (a settings entry — no schema change).
- **Graded slabs**: submit-for-manual-quote flow. Note: PriceCharting's API
  licenses data for *internal* use only — fine as an admin-side reference,
  not for showing customers without extra licensing.
- **Customer payout reports (analyzer v2)**: turn an analyzer run into a
  shareable "here's what we'll pay for your collection" page — the analyzer
  output already carries per-card offers; needs a persistence + share-token
  layer like submissions.
