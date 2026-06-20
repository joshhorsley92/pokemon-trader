/**
 * Scryfall client for the MTG analyzer, ported from Josh's mtg-sell-helper
 * (resolve_and_fetch_scryfall / fetch_scryfall_prices).
 *
 * Uses the POST /cards/collection endpoint: up to 75 identifiers per request,
 * 100ms courtesy delay between batches, and exponential-backoff retry on
 * 429/5xx/network errors (Scryfall asks for both the delay and a User-Agent).
 * Prices come back as decimal strings ("0.25") or null when that finish
 * doesn't exist for the printing.
 */

const SCRYFALL_COLLECTION_URL = "https://api.scryfall.com/cards/collection";
const BATCH_SIZE = 75; // hard Scryfall limit per collection call
const BATCH_DELAY_MS = 100;
const MAX_RETRIES = 5;
const RETRY_BACKOFF_MS = 2_000; // doubles each retry: 2s, 4s, 8s, 16s
const USER_AGENT = "pokemon-trader-mtg-analyzer/1.0 (internal buylist tool)";

export type ScryfallPrices = {
  usd: number | null;
  usd_foil: number | null;
  usd_etched: number | null;
};

export type ResolvedCard = {
  scryfallId: string;
  name: string;
  setName: string;
  prices: ScryfallPrices;
  /** TCGplayer product id when Scryfall knows it */
  tcgplayerId: number | null;
};

/** One input line for resolution — best identifier wins (id > name+set > name). */
export type ResolveLine = {
  scryfallId?: string | null;
  name?: string | null;
  /** Set code, e.g. "mh2" (Scryfall set codes, which ManaBox also uses) */
  setCode?: string | null;
};

/** Scryfall /cards/collection identifier shapes we use */
type Identifier = { id: string } | { name: string; set: string } | { name: string };

type CollectionResponse = {
  data?: ScryfallCardJson[];
  not_found?: Record<string, string>[];
};

type ScryfallCardJson = {
  id: string;
  name?: string;
  set?: string;
  set_name?: string;
  tcgplayer_id?: number;
  prices?: Record<string, string | null>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePrice(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch with exponential-backoff retry, mirroring the Python
 * _request_with_retry: retries 429/5xx (honoring Retry-After when larger)
 * and network errors; other 4xx fail immediately since retrying won't help.
 */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(url, init);
      if (resp.status === 429 || resp.status >= 500) {
        lastErr = new Error(`Scryfall HTTP ${resp.status}`);
        if (attempt < MAX_RETRIES) {
          const retryAfter = Number(resp.headers.get("Retry-After")) || 0;
          const wait = Math.max(retryAfter * 1000, RETRY_BACKOFF_MS * 2 ** (attempt - 1));
          await sleep(wait);
          continue;
        }
        throw lastErr;
      }
      if (!resp.ok) throw new Error(`Scryfall HTTP ${resp.status}`);
      return resp;
    } catch (err) {
      // fetch() rejects on network errors (DNS blips, dropped connections)
      lastErr = err;
      if (err instanceof Error && /HTTP 4/.test(err.message)) throw err;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BACKOFF_MS * 2 ** (attempt - 1));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Scryfall request failed");
}

/** Best identifier for a line, or null when the line carries nothing usable. */
function identifierFor(line: ResolveLine): Identifier | null {
  const id = line.scryfallId?.trim();
  if (id) return { id };
  const name = line.name?.trim();
  if (!name) return null;
  const set = line.setCode?.trim().toLowerCase();
  return set ? { name, set } : { name };
}

/**
 * Stable semantic key for an identifier, lowercased so it both dedupes our
 * requests and matches the identifier objects Scryfall echoes in not_found.
 */
function identifierKey(ident: Record<string, string>): string {
  return Object.keys(ident)
    .sort()
    .map((k) => `${k}=${String(ident[k]).toLowerCase()}`)
    .join("|");
}

/**
 * Resolve a list of lines against Scryfall and pull prices in one pass.
 *
 * Returns an array parallel to `lines`: a ResolvedCard for hits, null for
 * lines Scryfall reported in not_found (or that had no usable identifier).
 * Duplicate lines collapse to a single identifier per request.
 */
export async function resolveAndFetchPrices(
  lines: ResolveLine[],
  onProgress?: (done: number, total: number) => void,
): Promise<(ResolvedCard | null)[]> {
  // Dedupe identifiers; remember which key each line maps to
  const keyByLine: (string | null)[] = [];
  const identByKey = new Map<string, Identifier>();
  for (const line of lines) {
    const ident = identifierFor(line);
    if (!ident) {
      keyByLine.push(null);
      continue;
    }
    const key = identifierKey(ident as Record<string, string>);
    keyByLine.push(key);
    if (!identByKey.has(key)) identByKey.set(key, ident);
  }

  const entries = [...identByKey.entries()];
  const resolvedByKey = new Map<string, ResolvedCard>();

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const resp = await fetchWithRetry(SCRYFALL_COLLECTION_URL, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ identifiers: batch.map(([, ident]) => ident) }),
    });
    const data = (await resp.json()) as CollectionResponse;

    // Scryfall returns found cards in request order with not_found entries
    // removed, echoing the missing identifiers separately. Walk our batch in
    // order, skipping keys present in not_found, to map cards positionally —
    // this avoids fragile name matching (split cards come back "Fire // Ice").
    const notFound = new Set(
      (data.not_found ?? []).map((ident) => identifierKey(ident)),
    );
    const found = data.data ?? [];
    let cursor = 0;
    for (const [key] of batch) {
      if (notFound.has(key)) continue;
      const card = found[cursor++];
      if (!card) break; // defensive: fewer cards than expected
      resolvedByKey.set(key, {
        scryfallId: card.id,
        name: card.name ?? "",
        setName: card.set_name ?? "",
        prices: {
          usd: parsePrice(card.prices?.usd),
          usd_foil: parsePrice(card.prices?.usd_foil),
          usd_etched: parsePrice(card.prices?.usd_etched),
        },
        tcgplayerId: card.tcgplayer_id ?? null,
      });
    }

    onProgress?.(Math.min(i + BATCH_SIZE, entries.length), entries.length);
    if (i + BATCH_SIZE < entries.length) await sleep(BATCH_DELAY_MS);
  }

  return keyByLine.map((key) => (key ? (resolvedByKey.get(key) ?? null) : null));
}
