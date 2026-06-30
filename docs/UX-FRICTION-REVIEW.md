# UX Friction Review — Show Mode, Booth, Back-office

> **Sprint 1 fixed (2026-06-30):** all four P0 traps + P1-1/P1-2/P1-3.
> - **P0-1** graded slabs now carry through the booth (migration 0011 adds graded/grader/grade to pending items), are never auto-priced (shown as a "Graded" badge with a hand-price field), searchable manual path in the pile; booth copy reworded.
> - **P0-2** "Accept all" skips-and-reports unpriceable lines instead of silently half-committing (surfaced in the pile UI).
> - **P0-3** $0-floored offers are blocked: buy/sell buttons and pile ✓ disable at ≤$0 and require an explicit hand price.
> - **P0-4** confirms added to End show (warns about queued buys), Void, Dismiss pile, Remove line.
> - **P1-1** Settings markup labeled as the same knob as Inventory's "market + %" (units spelled out). **P1-2** Inventory total now captions "N items unpriced — not counted." **P1-3** booth shows an explicit "You pay $X" / "You get $X" line.
>
> Remaining: P1-4/5/6 and all P2/P3 below are **not yet done**. The Show-Mode graded *toggle in EntryCard* (operator-initiated slabs) was deferred — operators can still hand-price via Override $; only the dangerous auto-mispricing path was closed.



_Method: four persona agents walked realistic end-to-end jobs grounded in the real source (read-only), reporting field diaries + friction tables + correctness traps with file refs. Findings deduped and ranked by **severity × how many personas independently hit them**. Correctness traps (silent money/data wrongness) are pulled out separately — they earn fixes regardless of polish._

Personas: **Marcus** (solo shop owner, Show Mode on Android) · **Aisha** (first-time collector, booth QR on iPhone) · **Dana** (back-office manager, desktop setup) · **Sam** (first-run + edge/dead-end tester).

---

## Executive summary — systemic themes

1. **Graded slabs fall through every seam.** The one rule the system is built to enforce — _slabs are manual-quote only_ — is broken on the booth path (the `graded` flag is dropped crossing the submit boundary, so a slab is auto-priced as a raw single and the accept button is enabled), slabs are **unsearchable** in Show Mode, the EntryCard has **no graded toggle**, and the customer sees "we'll send a custom offer after you submit" copy that's wrong for a live table. Hit by **3/4** personas. _Highest-dollar mistake in the app._
2. **The whole-dollar round-down creates live $0 offers.** Sub-$1 buy prices floor to `$0.00`; the buy button and the pending ✓ stay **enabled** at $0 (only `null` is blocked), so a $0 buy can be recorded and a $0-cost inventory row created — with no "floored to zero" flag. Hit by **2/4**.
3. **Destructive actions are one unguarded tap.** End show, Void transaction, Dismiss pile, Remove line all fire immediately with no confirm; several mutate inventory or strand customers. Only Delete-session is guarded. Hit by **2/4**.
4. **Silent failures hide money/data state.** "Accept all" commits some lines then aborts on the first unpriceable one and **swallows the error** (partial accept, no message). Total Inventory Value silently excludes unpriced rows. The markup knob is editable in two screens in two different units with no warning. Hit across personas.
5. **Per-card throughput tax.** Everything is one-at-a-time: Show Mode search resets after every add (a 12-card lot = 12 retypes); pricing rules, hot buys, and submission counters are all single-form slogs.
6. **The customer never sees the one number that matters** — "you pay $X cash." It's computed but only shown buried in a "settle the difference when we talk" note.

### Correctness traps (fix regardless of UX) — the headline list
| # | Trap | Hit by | File |
|---|---|---|---|
| T1 | Graded slab auto-priced as a raw single across the booth boundary; ✓ accept enabled | Aisha, Marcus, Sam | `trade-counter.tsx:208`, `api/booth/[token]/submit/route.ts` giveSchema, `lib/show.ts` priceGiveItem |
| T2 | "Accept all" partial-commits then swallows the error → no UI feedback | Marcus, Sam | `lib/show.ts` acceptPendingTrade, `show/actions.ts` acceptPendingPile |
| T3 | $0-floored buy offer is a live, enabled "Buy cash $0.00" button; records $0 buy + $0 inventory row | Marcus, Sam | `lib/quote.ts` (dollarsDown), `show/show-client.tsx` ActionButton/PendingLine disabled-only-on-null |
| T4 | End show / Void / Dismiss / Remove — no confirm; mutate inventory or strand customers | Marcus, Sam | `show/show-client.tsx`, `show/actions.ts` |
| T5 | Markup double-knob: `inventory_market_markup` editable as **%** (Inventory) and **multiplier** (Settings), no cross-warning | Dana | `inventory/page.tsx` + `inventory/actions.ts` vs `settings/settings-form.tsx` |
| T6 | Total Inventory Value silently excludes unpriced/unmatched rows (no "N excluded" caption) | Dana | `inventory/page.tsx` |
| T7 | "Flat $" product rule still scaled by condition multiplier — not actually flat | Dana | `lib/pricing.ts` computeQuote |
| T8 | Booth: net cash the customer pays is never shown as a single number | Aisha | `trade-counter.tsx` StepShake |
| T9 | QR cross-origin dead page (LAN IP not in `allowedDevOrigins`) / QR panel silently absent when no base URL | Sam | `next.config.ts`, `lib/lan.ts`, `show/show-client.tsx` |
| T10 | Duplicate pile possible on flaky-wifi retry (no idempotency key) | Sam | `trade-counter.tsx` booth submit |

---

## Prioritized backlog

### P0 — correctness traps, fix first
| # | Issue (file) | Hit by | Sev | Effort | Fix |
|---|---|---|---|---|---|
| P0-1 | **Graded slabs mispriced across booth + unsearchable in Show + no toggle** (`trade-counter.tsx:208`, `submit/route.ts` giveSchema, `lib/show.ts` priceGiveItem, `api/catalog/search/route.ts` `all` filter, `show-client.tsx` EntryCard) | 3 | High | L | Carry `graded`/grader/grade through the booth `gives` payload + `giveSchema`; in pile review render graded lines as "graded — manual offer" with auto-accept disabled (like the null path); add a graded branch to Show search + a graded toggle/manual price in EntryCard; rewrite the customer copy for booth ("the seller prices slabs by hand at the table"). |
| P0-2 | **"Accept all" silent partial-commit** (`lib/show.ts` acceptPendingTrade, `show/actions.ts` acceptPendingPile) | 2 | High | M | Make the action return state; surface the error in the pile UI; skip-and-report unpriceable lines instead of aborting mid-loop (or pre-check before committing any). |
| P0-3 | **$0-floored offers act acceptable** (`show-client.tsx` ActionButton/PendingLine, `lib/quote.ts`) | 2 | Med–High | S | Treat `0` like `null`: disable the action with a "no offer / below minimum" label; never record a $0 buy or a $0-cost inventory row without an explicit override. |
| P0-4 | **Unguarded destructive taps** (`show-client.tsx` End show / Void ✕ / Dismiss / Remove) | 2 | High | S | Add a `confirm()` (matching the Delete-session pattern) to End show (warn it ends the booth + lists queued buys), Void, and Dismiss-pile. |

### P1 — high-impact friction / single-persona money traps
| # | Issue (file) | Hit by | Sev | Effort | Fix |
|---|---|---|---|---|---|
| P1-1 | **Markup double-knob** (`inventory/page.tsx`, `settings-form.tsx`) | Dana | High | S | One unit everywhere (show Settings as "market + X%" too) + a "this is the same setting as Inventory" note; or remove it from Settings. |
| P1-2 | **Total Inventory Value undercounts silently** (`inventory/page.tsx`) | Dana | High | S | Caption "N items unpriced — not counted"; optionally a second "at-cost" or "all stock" figure. |
| P1-3 | **Customer never sees "you pay $X cash"** (`trade-counter.tsx` StepShake) | Aisha | High | S | Add an explicit net line in booth mode; reword "settle when we talk" → "you'll pay the $X difference at the table." |
| P1-4 | **Conditions default to Near Mint + hover-only tooltips** (`trade-counter.tsx`, `conditions.ts`) | Aisha, Marcus | High | S–M | Tap-to-reveal plain-English condition help on touch; show "assuming Near Mint — tap to change," or force an explicit pick. |
| P1-5 | **Show Mode search resets after every add (no batch)** (`show-client.tsx` EntryCard→SearchBox remount) | Marcus | High | M | Persist last query/results after a commit; add "buy again / next" so a same-set lot is a blitz. |
| P1-6 | **Dashboard has no at-a-glance state** (`admin/(panel)/page.tsx`) | Dana | Med–High | M | Summary cards atop the queue: pending/countered counts, total inventory value, today's payouts. |

### P2 — medium
| # | Issue (file) | Hit by | Effort | Fix |
|---|---|---|---|---|
| P2-1 | CSV import blind: 15-of-300 read-only, no match-rate until after commit (`import/import-wizard.tsx`, `inventory/actions.ts`) | Dana | M | Paginated/editable review grid + "X/300 will match catalog" preview before import. |
| P2-2 | "Flat $" isn't flat (`pricing.ts`, `rule-forms.tsx`) | Dana | S | Relabel "flat (before condition)" + worked example. |
| P2-3 | Rounding checkboxes act like radios (`rule-forms.tsx`) | Dana | S | Single radio group, co-located with its step value. |
| P2-4 | Settings save is all-or-nothing (`settings/actions.ts`) | Dana | M | Section-level saves, or isolate notify-emails. |
| P2-5 | Sell from catalog, not inventory (`show-client.tsx`, `lib/show.ts`) | Marcus | M | "Sell from inventory" picker of available rows. |
| P2-6 | Cash adjustment detached/unattributed (`show-client.tsx` CashPanel) | Marcus | M | Inline cash-settle on the pile; tag the line to the deal. |
| P2-7 | QR panel silently absent / cross-origin dead page (`show-client.tsx`, `lan.ts`, `next.config.ts`) | Sam | S–M | Render the panel with "Set APP_BASE_URL to enable the QR"; widen/auto-derive dev origins. |
| P2-8 | Duplicate-pile risk on retry (`trade-counter.tsx`) | Sam | M | Idempotency key per submission. |
| P2-9 | Booth onboarding: no intro, blind Cash/Credit toggle, hard card search on tiny thumbs, collapsed slip reads as "items vanished" (`trade-counter.tsx`, `deal-slip.tsx`) | Aisha | M | One-line intro; label/why for Cash vs Credit; bigger images + set/number; auto-expand "Your side" once it has items. |
| P2-10 | No submissions list; Decision vs Counter are split forms (`page.tsx`, `submissions/[id]/review-forms.tsx`) | Dana | M | Filterable submissions list; unify into one "send deal" panel. |
| P2-11 | Set-override picker is an unsearchable `<select>` of all sets (`rule-forms.tsx`) | Dana | S | Reuse the searchable product combobox pattern. |
| P2-12 | "Add now vs Queue" consequence unexplained — accepted buys become instant sellable stock (`show-client.tsx`) | Sam | S | Tooltip explaining each. |
| P2-13 | Booth submit carries no prices; success says "prices ready" (`submit/route.ts`, `trade-counter.tsx`) | Aisha | S | (Note: operator re-quotes server-side; verify intended and soften the copy.) |

### P3 — polish
| # | Issue | Hit by | Fix |
|---|---|---|---|
| P3-1 | Start-session name required (`show/page.tsx`) | Marcus, Sam | Default to today's date; make optional. |
| P3-2 | Pending pile 6s poll lag (`show-client.tsx`) | Marcus | Tighten interval or add a manual refresh; consider SSE later. |
| P3-3 | Pricing rules / hot buys one-at-a-time (`rule-forms.tsx`, `hot-buy-forms.tsx`) | Dana | Multi-row add / paste-list. |

---

## Recommended first sprint (highest relief-per-effort, clears all traps)

**Clear every P0 + the three cheap P1 money/clarity fixes I introduced or that mislead on price:**

- **P0-1** Graded slabs (the big one) — carry the flag, block auto-accept, fix copy, make searchable.
- **P0-2** Accept-all error surfacing + skip-and-report.
- **P0-3** $0 offers treated as "no offer."
- **P0-4** Confirms on End show / Void / Dismiss.
- **P1-1** Markup double-knob (unit label + same-setting warning).
- **P1-2** Inventory total "N unpriced excluded" caption.
- **P1-3** Booth "you pay $X cash" line.

That set removes every way the app can silently show or record a wrong number, plus the destructive-tap data-loss risks. Effort: roughly one L (graded) + several S/M. **Money/inventory-mutating logic stays in-house; only display/wiring fans out.**

---

## What's already right (don't regress these)

- Closed/invalid booth token → friendly "🚪 this booth isn't taking trades right now" screen (`booth/[token]/page.tsx`).
- Booth network error keeps the customer's pile and shows a retry message (`trade-counter.tsx`).
- Session-closed-mid-submit → clear 404 (`submit/route.ts`).
- **Delete session** has an honest `confirm()` that spells out the inventory reversal (`delete-session-button.tsx`) — the model for P0-4.
- CSV export route is auth-gated (`export/route.ts`).
- Per-line null-price ✓ is correctly disabled with a "handle by hand" tooltip — extend this exact treatment to $0 (P0-3).
- Submission detail page highlights ≥5% market drift vs the quoted price (`submissions/[id]/page.tsx`) — a real stale-quote guardrail.
- Booth success screen tells the customer exactly what to do next (`trade-counter.tsx`).
- Show Mode empty state clearly invites a search (`show-client.tsx`).
