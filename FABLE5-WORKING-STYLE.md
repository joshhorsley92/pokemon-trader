# How Fable 5 Performed the Work — Session Review

*A review of the Claude Fable 5 model's working behavior during the build of the
Pokémon/MTG buylist analyzer, compiled by Claude Opus 4.8 from the full session
transcript. This is about **how** the work was done — process, habits, failure
modes — not what was built.*

---

## Method of review

This assessment is grounded in the actual session transcript: the tool calls
Fable 5 made, the order it made them in, the errors it hit, and how it
recovered. Every claim below points to a specific observed episode rather than a
general impression.

---

## What it did well

### 1. Verification was real, not performative
Fable 5 did not declare things "done" on the strength of having written code. It
ran `npx tsc --noEmit`, `npm test`, and `eslint` after substantive changes, and —
the part that matters — it drove the actual UI in a headless browser with
Playwright and **looked at the screenshots**. This caught bugs that type-checking
never would:
- The MTG-mode CSV upload rejection: it loaded the user's real 2,080 KB ManaBox
  export, saw the "Invalid request", traced it to the 2 MB Zod cap, and raised
  it — then added a regression test using the export's *exact* 19-column header
  (including the leading "Binder Name" column that could shadow "Name").
- It verified end-to-end against **real data**, not toy fixtures: real vendor
  syncs (3,587 Card Cavern listings, 20,328 CoolStuffInc rows), the user's real
  collection file, and live Scryfall/Card Kingdom calls.

### 2. It root-caused instead of papering over
When a test failed with `expected 4 to be 2`, it correctly diagnosed that the
*test assertion* was stale (left over from a quantity change), not the engine —
and fixed the test rather than bending the code. When the 13.85% fee change
produced `expected 6.82 to be close to 6.81`, it identified the actual cause
(floating-point error in `13.85/100`) and fixed the root cause by reordering to
multiply-before-divide, rather than loosening the assertion tolerance.

### 3. It surfaced problems it found, even unprompted
Asked to *audit the math*, it didn't just defend its formulas. The audit turned
up two genuine data-quality bugs and it flagged both: TCGplayer's own feed
returning a stale $0.99 market price on a $1,600 card (Entei Gold Star), and
Full Grip publishing a glitched $375 buylist offer on a $68 card. It built
guards for both (`effectiveMarketPrice` sanity check; "offer ≫ market" flag)
and was explicit that these were real, externally-caused anomalies. This is the
opposite of the failure mode where a model rationalizes its output when
questioned.

### 4. Research-before-build, against captured reality
Before writing a single vendor adapter, it dispatched background agents to (a)
survey the buylist landscape and (b) reverse-engineer each vendor's actual data
shape, saving real response samples to `.samples/`. The adapters were then
written and unit-tested against those captured fixtures — so the parsers were
validated against what the vendors *actually return*, including documented
edge cases (curly apostrophes in titles, triplicated variant markup, the
string-vs-array `rows` field on CoolStuffInc).

### 5. Effective parallelism
It ran long operations in the background (the Full Grip crawl, the dev server)
and dispatched independent subagents (buylist research, vendor reverse-
engineering, the entire MTG-port data layer) while continuing on non-overlapping
work itself. Critically, when it spawned the MTG-port agent it gave that agent
an explicit "DO NOT TOUCH" list of the files it was concurrently editing —
showing awareness of write-conflict risk across parallel work.

### 6. Respected the existing codebase
It consistently read the neighbors before adding code: the Drizzle schema, the
settings module, the existing `quote/preview` route, the catalog search route,
the settings form — then matched their idioms (integer-cents money math, JSDoc
headers explaining data-source quirks, the `cm:`/`ae:` form-field naming
convention). New code reads like it belongs.

### 7. Honored boundaries and authority
When the auto-mode classifier denied a command that would have dumped admin
credentials into the transcript, it accepted the denial without trying to
circumvent the intent, and instead had the Playwright script read the env file
itself — a legitimate path to the same goal. It also used `AskUserQuestion` at
genuine product forks (where the analyzer should live, accepted input formats,
the export formats/delivery) while proceeding without asking on reversible
implementation details.

### 8. Readable, faithful reporting
Its end-of-turn summaries led with the outcome, explained the math in plain
prose when asked, and admitted limitations honestly (the single-printing market
price caveat; the Vercel 4.5 MB body cap for deployed MTG runs). When the user
asked "did you get caught?" about the progress indicator, it answered with the
actual captured screenshot showing "Resolving prices via Scryfall… 75/9,180".

---

## Rough edges

### 1. Self-inflicted shell-encoding wound
To add a `rarity` field to test fixtures, it reached for a PowerShell
`-replace` one-liner instead of the `Edit` tool. PowerShell read the file as
ANSI and wrote UTF-8, mangling every `é` ("Pokémon" → "PokÃ©mon") across the
file. It caught and fixed this, but it was avoidable: the tool guidance
explicitly steers away from shell text-munging in favor of the editing tools,
and the structured `Edit` tool would not have corrupted the encoding. This was
the single clearest process miss of the session.

### 2. Brittle UI-test selectors caused repeated rework
Its Playwright scripts hardcoded visible UI text as selectors — `text=Buylist
(cash)`, `button:has-text("Magic (Card Kingdom)")`. Then it changed that very
text ("Buylist (cash, after shipping)"; "Magic") and the tests broke, forcing
2–3 re-runs per verification round just to chase selector mismatches. A small
amount of selector discipline (stable test IDs, or asserting on structural
elements) would have removed a recurring tax it paid all session.

### 3. Test assertions occasionally written before the math was computed
More than once it wrote an expected value, ran the test, and corrected it
(`expected 4 to be 2`; the stale shipping assertion). The safety net (running
tests) always caught these, so nothing shipped wrong — but it reflects
assertions written by pattern rather than by computing the expected number
first.

### 4. The todo list drifted from reality
The `TodoWrite` list repeatedly fell out of sync with actual progress — items
left `in_progress` after completion, the list lagging the work — drawing several
system nudges. It tended to treat the todo list as a periodic checkpoint rather
than a live reflection of state.

### 5. Heavy single-turn scope
It frequently advanced many concerns in one turn (schema + engine + UI + tests +
verification). Mostly this was efficient and well-sequenced, but it occasionally
interleaved enough threads that the todo drift above became more likely.

---

## Net assessment

The defining trait was **earned confidence**: it backed claims with execution —
real builds, real tests, real browser screenshots, real vendor data — and when
challenged on its own output it investigated and found genuine bugs rather than
defending. Its error recovery was strong: it root-caused float rounding, stale
assertions, DNS flakiness, and an API size cap rather than thrashing or masking.
Research-before-build against captured fixtures kept the vendor integrations
honest.

The weaknesses were mostly **mechanical friction**, not judgment failures:
brittle test selectors, an avoidable shell-encoding corruption, and a todo list
it under-maintained. None of these reached the user as broken output — the
verification discipline absorbed them — but they were avoidable motion. The one
worth correcting first: prefer the structured `Edit` tool over shell
text-replacement, which would have eliminated the encoding bug outright.

Overall: a methodical, verification-driven operator that finished by *showing*
the work rather than asserting it — strongest exactly where it's hardest to fake
(end-to-end proof), with friction concentrated in test-harness ergonomics.
