# Foundation Review — click economy + data sources

_A pre-scale sweep: where the app wastes taps, where its information is weaker than it could be, and whether the foundation is sound to build on. Complements [UX-FRICTION-REVIEW.md](UX-FRICTION-REVIEW.md) (persona findings); this doc is the forward-looking synthesis._

---

## Part 1 — Click economy (fewer taps, same outcomes)

### The one number that matters
The vendor's unit of work is **seconds per card**. Everything below is ranked by how much it cuts from the dominant loop: *search → pick → configure → commit → next card*.

### Show Mode (operator)

| # | Change | Taps saved | Effort | Notes |
|---|---|---|---|---|
| C1 | **Keep query + results after each commit** (don't remount SearchBox empty) | ~10–15 keystrokes/card on same-set lots | S–M | The single biggest win. A 12-card lot today = 12 full retypes. Persist last query, add a subtle "clear" — the operator blitzes a stack. (`show-client.tsx` EntryCard→SearchBox remount) |
| C2 | **Quick-tap tiles under the empty search box**: hot buys + the session's recently-transacted cards | Whole search eliminated for repeat cards | M | The customer-facing trade builder already shows hot buys + popular picks; Show Mode shows nothing until 2 chars typed. At a show, the same 10–20 chase cards come across the table all day — the second one should be one tap. (`show/page.tsx` doesn't load hot buys; `SearchBox` empty state) |
| C3 | **"Same again" on transaction rows** — repeat the last buy/sell in one tap | 3–5 taps for duplicates | S | Ledger rows already carry everything needed (product, condition, price, kind). |
| C4 | **Sell from "My case"** — a second tab in the search area listing available inventory rows | Global-catalog search eliminated for own stock | M | Also fixes correctness: `drawDownInventory` currently best-effort matches by product+condition; picking the actual row can't mis-draw. (P2-5 in friction review) |
| C5 | **Refetch pending piles on window focus** (keep the 6s poll as fallback) | Removes the awkward "wait for it…" moment when a customer says "I sent it" | S | `show-client.tsx` poll effect |
| C6 | **Cash-settle inline on the pile** (small "± cash" row next to Accept all) | Scroll-up + panel-open + scroll-back | S–M | Also tags the adjustment to the deal for reconciliation (P2-6). |
| C7 | Card-number placeholder hint ("try `Iono 185` or `199/165`") | Teaches the fastest existing search path | XS | The search route already matches card numbers via extData — nobody knows. |

### Booth (customer)

| # | Change | Impact | Effort | Notes |
|---|---|---|---|---|
| C8 | **Show both totals on the Cash/Credit toggle** ("Cash $41 / Credit $52") | Kills blind toggling; credit upsell becomes self-evident | S | The quote preview API *already returns both totals* — zero extra round trips, just render them on the tabs. |
| C9 | **Tap-visible condition help + "assuming Near Mint" nudge** | Fewer table disputes; more honest on-screen offers | S–M | Tooltips are hover-only (invisible on phones); NM default silently overstates offers (P1-4). |
| C10 | **Auto-expand the deal slip's "Your side" after the first add** | Removes the "did my card register?" doubt | S | Slip sections default collapsed (P2-9). |
| C11 | Bigger result thumbnails + set/number prominent | Faster "is this MY card?" matching — the customer's slowest step | S | 44px thumbs of near-identical Pikachus are the bottleneck (P2-9). |
| C12 | Idempotency key on booth submit | Prevents duplicate piles on flaky-wifi retry | S | (P2-8) |

### Back office (desktop)

| # | Change | Impact | Effort |
|---|---|---|---|
| C13 | Dashboard stat cards (pending count, inventory value, recent payouts) | State-of-business at a glance (P1-6) | M |
| C14 | CSV import: match-rate preview + editable rows before commit | Stops blind 300-row imports (P2-1) | M |
| C15 | Searchable set picker in pricing rules (reuse product combobox) | Ends the 300-option `<select>` scroll (P2-11) | S |

**Suggested order:** C1+C2+C7 (one Show-Mode search sprint), then C8+C9+C10 (booth trust sprint), then C4, C13–C15.

---

## Part 2 — Data sources (better info)

_Populated from live web research — see the recommendations table at the end._

### What the current stack gives (and doesn't)

| Data need | Today | Gap |
|---|---|---|
| Raw singles + sealed market prices | TCGCSV nightly TCGplayer mirror | Nightly granularity; fine for booths |
| Per-printing prices | TCGCSV `printings` | Covered |
| **Condition-specific prices** (NM/LP/MP/HP) | Invented multipliers (0.85/0.7/0.55…) | **Real spread varies wildly by card** — a $500 vintage LP ≠ 85% of NM |
| **Graded slab values** | Hand-priced by operator | No data at all — biggest info gap |
| Sales velocity / liquidity | None | Can't tell a $50 card that sells weekly from one that never moves |
| Buylist floors (what other shops pay) | Card Cavern / CSI / Full Grip crawls | Covered, unique advantage |
| Slab identity (cert → card + grade) | Manual typing | Cert scan would kill the worst data-entry case |

### Research findings — pricing sources (verified live, June 2026)

| Source | Data | Freshness | Cost | Commercial verdict | Fit |
|---|---|---|---|---|---|
| **TCGplayer API** | per-SKU condition prices | — | — | **Closed to new devs since ~late 2024** (eBay-owned); existing keys being deprecated | Unobtainable — skip |
| **JustTCG** | **Condition-specific** (NM/LP/MP/HP/DMG) × printing, raw + sealed, EN + JP Pokémon | **Every 6h** | Free 1k calls/mo · $19/mo 10k · $49/mo 50k · $149/mo 500k | Paid tiers allow own-business use incl. in-app display; no resale of raw data; multi-tenant worth a confirming email | **Drop-in**: direct lookup by `tcgplayerId`/`tcgplayerSkuId` — no mapping table. Young company (2025) |
| **Scrydex** | Raw **+ per-condition + graded (PSA/BGS/CGC/TAG/ACE) + pop reports** + history; EN + JP | Daily | $29/mo (5k credits) · **$99/mo Growth** · $399/mo Pro · Enterprise w/ whitelabel | Marketed to card shops for **customer-facing storefronts**; Enterprise whitelabel = the multi-tenant path (confirm in writing) | Successor of pokemontcg.io (same team, real adoption). Needs one-time ID mapping (set+number) |
| **PriceCharting** | Graded price points (PSA 10/9/8, BGS, CGC), sealed, **demand/velocity reports**, suggested buy/sell | Daily | **$49/mo Legendary** (API + full CSV) | **Confirmed: internal business use ONLY** — explicitly bars display in anything "accessible to third parties, including customers." OK for operator screens; NOT for the booth QR view | CSV dump fits the existing cron→Postgres pattern; needs ID/UPC mapping |
| **pokemontcg.io** | Catalog + tcgplayer/cardmarket price blocks | Daily-ish | Free | "Now part of Scrydex" — sunsetting in practice | Don't build new dependency |
| **Cardmarket API** | EU prices | — | — | **Closed to applications** | Skip (EU-only anyway) |
| **eBay solds** (Marketplace Insights) | 90-day sold comps | — | — | **Partner-only "Limited Release"** — realistically unobtainable; Browse API = active listings only | PriceCharting is the practical eBay-solds proxy |
| **Collectr API** | 400k products raw/graded | — | Negotiated | Personal/promotional use only, no competing products, revocable at will | Partnership-only; not a backbone |
| **pokedata.io** | Prices + pop history + **sales-volume history** | — | Paid | "Individuals, not business entities"; no redistribution | Watch-list until commercial terms exist |
| **TCGdex** | Free multilingual catalog, relays TCGplayer + Cardmarket prices | — | Free, keyless | Open source | Good **failover** hedge for TCGCSV |
| **TCGCSV** (current) | Full TCGplayer mirror | Nightly | Free (Patreon-funded) | No published license either way | **Risk elevated**: a volunteer's unlicensed mirror of a hostile-trending upstream (eBay closed the API it depends on). Works today; plan a hedge |

**Pricing-source recommendations:**
1. **Now (free):** add JustTCG free tier to spot-check condition prices on high-value counter cards (evaluation only — free tier is non-commercial); add TCGdex as a TCGCSV failover hedge.
2. **First paid dollar ($19–49/mo): JustTCG** — kills the invented NM/LP/MP multipliers with real per-condition prices, keyed to the TCGplayer IDs already in the DB. One cron job change.
3. **Graded answer:** PriceCharting Legendary **$49/mo** for internal/operator screens (graded comps + the only cheap sales-velocity data found) — legally must stay off the customer QR view. For customer-facing graded prices later: Scrydex.
4. **If/when this becomes a vendor-facing SaaS:** consolidate on **Scrydex Growth ($99/mo)** as primary (only vendor with raw + condition + graded + pop under one key, explicitly sold to card shops for customer-facing use, whitelabel path). Realistic total data bill at SaaS stage: **$150–250/mo** — recoverable at 5 vendor seats.

### Research findings — slab lookup & scanning (verified live, June 2026)

**Cert lookup (the slab data-entry killer):**

| Option | What | Cost | Verdict |
|---|---|---|---|
| **PSA Public API** | `GET /cert/GetByCertNumber/{n}` → card identity, grade, population + label images | **Free, 100 calls/day** (paid tiers unpublished — email PSA) | ✅ The play. PSA labels since ~2020 carry a **QR encoding the cert URL** — scan → regex cert → API → auto-fill card + grade. Cache every lookup (100/day cap). Note: fake slabs reuse real certs — operator still eyeballs the label image |
| CGC / Beckett / TAG / SGC | Web cert lookups only; no public APIs; modern labels have QR → cert page | Free (scrape-gray) | Handle incidentally: same QR scanner extracts their cert numbers; server-side page fetch as fallback identity fill. TAG is partnership-inclined — worth an email |
| **Card Hedge AI** | One-call cert-OCR: photo of label → grader + card + grade + FMV | Unpublished (sales) | Quote if slab volume ever exceeds PSA's free tier |
| **PokemonPriceTracker** | PSA 8/9/10 eBay sold comps + raw prices, Pokémon-only, real API | Free 100 credits/day; **$9.99/mo** = 20k/day | ✅ Best-value "what's a PSA 9 worth" for exactly this niche |

**Camera recognition (raw cards):** Ximilar is the only turnkey (set/number/variant + slab OCR, ~$64/mo entry, ~$6–10 per 1k IDs) — but booth conditions (sleeves, holo glare) force a human-confirm step anyway, so scanning saves typing, not verification. **Verdict: premature.** Good autocomplete (C1/C2/C7) closes most of the gap for $0. Pilot Ximilar behind a flag later if a measured need appears. OSS (hash-match vs card images) is a real CV side-project — skip.

**Sealed barcodes:** No public UPC→TCGplayer mapping exists (TCGCSV doesn't carry UPCs). But a booth's sealed SKUs repeat constantly → ship a **self-teaching UPC table**: scan → not found → operator picks the product once → mapped forever. Scanner must be **zxing-wasm via getUserMedia** — the browser `BarcodeDetector` API is still missing on iOS Safari in 2026. One scanner component covers UPCs *and* PSA/CGC/TAG label QRs.

**Skip entirely:** TCGplayer API + app scanner (closed/proprietary), CollX (no B2B API), Kronocard (competing desktop workflow), Card Ladder / GemRate (enterprise-gated), PSA APR scraping (ToS-gray; PPT covers it for $10), SlabStat (defunct), PriceCharting on any customer-facing surface (ToS).

---

## Part 3 — Foundation verdict

### Sound — build on it with confidence
- **Multi-tenant schema from day one** — every shop-scoped table carries `shopId`; flipping `getCurrentShopId()` to real resolution is one function, not a rewrite. This is the single most important thing done right for the "sell it to vendors" future.
- **One pricing engine** (`pricing.ts` + `quoteFromDb`) feeds every surface — customer builder, booth, Show Mode, submissions. Server-side re-quote everywhere; the client never computes money. Integer-cent math throughout.
- **Show sessions as an append-only transaction ledger** with inventory effects derived (and reversed on void/delete) — reconciliation can always be trusted over UI state.
- **The buylist crawls (Card Cavern/CSI/Full Grip) are a genuine moat** — nobody at a card show has a live buy-floor reference; keep investing here.
- Migrations discipline, money-math test coverage, honest confirms on destructive actions (post-Sprint-1).

### Watch — known debts, none blocking
1. **TCGCSV single-point-of-failure** — volunteer mirror of an API eBay is strangling. *Hedge:* TCGdex failover (free), and the provider abstraction already exists (`pricing-data/provider.ts`).
2. **Invented condition multipliers** — flat 0.85/0.7/0.55 is wrong on vintage/high-end. *Fix:* JustTCG overlay, $19/mo, keyed to existing TCGplayer IDs.
3. **Graded = hand-priced with zero data.** *Fix:* PSA QR scan + PokemonPriceTracker ≈ $10/mo + 2–3 days.
4. **Show Mode click-tax** (Part 1, C1/C2/C7) — the biggest UX debt now that correctness is fixed.
5. **Not deployed** — everything runs on localhost + Docker. The QR flow's real-world value is gated on a public URL (`APP_BASE_URL`). This is the biggest gap between "works in the demo" and "works at a show."

### Recommended sequence
1. **Deploy** (Supabase + Vercel + `APP_BASE_URL`) — unlocks real booth QR use; everything else compounds after this.
2. **Show-Mode search sprint** (C1 keep-results, C2 quick-tap tiles, C7 number-search hint) — the seconds-per-card win.
3. **Slab scan** (zxing-wasm QR → PSA API → PokemonPriceTracker) — kills the worst data-entry case for ~$10/mo.
4. **JustTCG condition overlay** ($19/mo) — honest condition pricing, one cron change.
5. **Booth trust sprint** (C8 both-totals toggle, C9 condition help, C10 slip auto-expand).
6. **When selling seats:** Scrydex Growth ($99/mo) as primary + written multi-tenant confirmation; PriceCharting stays operator-side only.

**Bottom line: the foundation is good.** The architecture (multi-tenant, single pricing engine, ledger-derived inventory) is the part that's expensive to get wrong, and it's right. The gaps are additive — better data feeds and fewer taps — not structural.


---

## Part 3 — Foundation verdict

_(completed at end of review)_
