/**
 * Catalog matcher: resolves a parsed list line or a vendor buylist listing to
 * a TCGplayer catalog product.
 *
 * The index is pure and built from plain rows (unit-testable); loadCatalogIndex
 * wires it to the DB. Both the analyzer request path and the buylist sync use
 * the same index so matching behavior never diverges.
 */
import { sql } from "drizzle-orm";
import type { db as AppDb } from "@/db";
import {
  normalizeCardNumber,
  normalizeText,
  setNamesCompatible,
} from "./normalize";

export type CatalogEntry = {
  id: number;
  name: string;
  setName: string;
  cardNumber: string | null;
  rarity: string | null;
  marketPrice: number | null;
  category: "singles" | "sealed";
};

export type MatchInput = {
  productId?: number | null;
  name?: string | null;
  setName?: string | null;
  cardNumber?: string | null;
};

export type Match = {
  entry: CatalogEntry;
  /** 'id' = exact product id; 'number' = card number + corroboration; 'name' = name search */
  via: "id" | "number" | "name";
  confidence: number; // 0..1, heuristic
};

/** TCGplayer names often embed the number ("Iono - 185/193"); strip for comparison. */
export function normalizeCardName(name: string): string {
  return normalizeText(
    name
      .replace(/[-–(\[]\s*#?[a-zA-Z]{0,4}\d{1,3}\s*\/\s*[a-zA-Z]{0,4}\d{1,3}\s*[)\]]?\s*$/, "")
      .replace(/\(([^)]*)\)/g, " "),
  );
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / Math.max(ta.size, tb.size);
}

export class CatalogIndex {
  private byId = new Map<number, CatalogEntry>();
  private byNumber = new Map<string, CatalogEntry[]>();
  private byNumerator = new Map<string, CatalogEntry[]>();
  private byFirstToken = new Map<string, CatalogEntry[]>();
  private nameCache = new Map<number, string>();

  static build(entries: CatalogEntry[]): CatalogIndex {
    const idx = new CatalogIndex();
    for (const e of entries) {
      idx.byId.set(e.id, e);
      if (e.cardNumber) {
        const num = normalizeCardNumber(e.cardNumber);
        push(idx.byNumber, num, e);
        push(idx.byNumerator, num.split("/")[0], e);
      }
      const norm = normalizeCardName(e.name);
      idx.nameCache.set(e.id, norm);
      const first = norm.split(" ")[0];
      if (first) push(idx.byFirstToken, first, e);
    }
    return idx;

    function push(map: Map<string, CatalogEntry[]>, key: string, e: CatalogEntry) {
      const list = map.get(key);
      if (list) list.push(e);
      else map.set(key, [e]);
    }
  }

  get size(): number {
    return this.byId.size;
  }

  /**
   * opts.allowSealed: customer lists may contain sealed product ("Charizard
   * Premium Collection") — let those match sealed catalog entries. Vendor
   * buylist listings are always singles, so the sync leaves this off to keep
   * a short vendor title from name-matching a sealed box.
   */
  match(input: MatchInput, opts: { allowSealed?: boolean } = {}): Match | null {
    if (input.productId != null) {
      const entry = this.byId.get(input.productId);
      if (entry) return { entry, via: "id", confidence: 1 };
    }

    const inputName = input.name ? normalizeCardName(input.name) : "";

    if (input.cardNumber) {
      const num = normalizeCardNumber(input.cardNumber);
      const candidates =
        this.byNumber.get(num) ??
        // sources that write "199" for "199/165"
        (num.includes("/") ? [] : (this.byNumerator.get(num) ?? []));
      const scored = this.score(candidates, inputName, input.setName);
      if (scored) {
        // A number match needs at least one corroborating signal unless it's
        // unambiguous within the catalog.
        if (scored.score > 0 || candidates.length === 1) {
          return {
            entry: scored.entry,
            via: "number",
            confidence: Math.min(1, 0.6 + scored.score / 8),
          };
        }
      }
    }

    if (inputName) {
      const first = inputName.split(" ")[0];
      let candidates = this.byFirstToken.get(first) ?? [];
      if (!opts.allowSealed) {
        candidates = candidates.filter((c) => c.category === "singles");
      }
      const scored = this.score(candidates, inputName, input.setName, true);
      if (scored && scored.score >= 2) {
        return {
          entry: scored.entry,
          via: "name",
          confidence: Math.min(1, 0.3 + scored.score / 10),
        };
      }
    }

    return null;
  }

  private score(
    candidates: CatalogEntry[],
    inputName: string,
    inputSet: string | null | undefined,
    requireNameSignal = false,
  ): { entry: CatalogEntry; score: number } | null {
    let best: { entry: CatalogEntry; score: number } | null = null;
    for (const entry of candidates) {
      let score = 0;
      let overlap = 0;
      if (inputName) {
        overlap = tokenOverlap(inputName, this.nameCache.get(entry.id) ?? "");
        score += overlap * 4;
      }
      if (inputSet) {
        score += setNamesCompatible(inputSet, entry.setName) ? 3 : -2;
      }
      if (requireNameSignal && overlap < 0.4) continue;
      if (!best || score > best.score) best = { entry, score };
    }
    return best;
  }
}

// ---- DB wiring ----------------------------------------------------------

type Db = typeof AppDb;

/**
 * Load catalog singles AND sealed into an index (~1-2 hundred thousand rows
 * of a few small fields); built once per sync run, and cached module-level
 * (30 min) for the analyzer API route. Sealed entries only participate in
 * matching when match() is called with allowSealed.
 */
export async function loadCatalogIndex(db: Db): Promise<CatalogIndex> {
  const rows = await db.execute(sql`
    SELECT cp.id,
           cp.name,
           cg.name AS set_name,
           cp.market_price,
           COALESCE(cp.category_override, cp.category) AS category,
           (SELECT e->>'value'
              FROM jsonb_array_elements(cp.ext_data) e
             WHERE e->>'name' = 'Number'
             LIMIT 1) AS card_number,
           (SELECT e->>'value'
              FROM jsonb_array_elements(cp.ext_data) e
             WHERE e->>'name' = 'Rarity'
             LIMIT 1) AS rarity
    FROM catalog_products cp
    JOIN catalog_groups cg ON cg.id = cp.group_id
    WHERE COALESCE(cp.category_override, cp.category) IN ('singles', 'sealed')
  `);
  const entries: CatalogEntry[] = (rows as unknown as Record<string, unknown>[]).map(
    (r) => ({
      id: Number(r.id),
      name: String(r.name),
      setName: String(r.set_name),
      cardNumber: r.card_number == null ? null : String(r.card_number),
      rarity: r.rarity == null ? null : String(r.rarity),
      marketPrice: r.market_price == null ? null : Number(r.market_price),
      category: r.category === "sealed" ? "sealed" : "singles",
    }),
  );
  return CatalogIndex.build(entries);
}

let cached: { index: CatalogIndex; at: number } | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000;

export async function getCatalogIndex(db: Db): Promise<CatalogIndex> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.index;
  const index = await loadCatalogIndex(db);
  cached = { index, at: Date.now() };
  return index;
}
