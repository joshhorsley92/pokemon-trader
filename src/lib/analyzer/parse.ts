/**
 * Customer list ingestion: TCGplayer/Collectr CSV exports and freeform pasted
 * text lists, both normalized to ParsedLine[] for the catalog matcher.
 *
 * Pure module (papaparse only) — no DB, no fetch.
 */
import Papa from "papaparse";

export type ParsedLine = {
  /** Original line / row, echoed back for unmatched-row UX */
  raw: string;
  quantity: number;
  name: string | null;
  setName: string | null;
  cardNumber: string | null;
  /** Printing hint as the source wrote it (Holofoil, Reverse Holo, Foil...) */
  printing: string | null;
  /** Normalized condition value (NM/LP/MP/HP/Damaged) or null */
  condition: string | null;
  /** TCGplayer product id when the CSV carries one — exact match, no fuzz */
  productId: number | null;
};

// Header aliases seen across TCGplayer app, Collectr, and Manabox-style exports
const HEADER_ALIASES: Record<keyof Omit<ParsedLine, "raw">, string[]> = {
  quantity: ["quantity", "qty", "count", "amount"],
  name: ["name", "card name", "product name", "card"],
  setName: ["set", "set name", "edition", "expansion", "group"],
  cardNumber: ["card number", "number", "card #", "collector number", "no"],
  printing: ["printing", "print", "foil", "finish", "variance", "variant"],
  condition: ["condition", "cond"],
  productId: ["product id", "productid", "tcgplayer id", "tcgplayer product id"],
};

const CONDITION_MAP: Record<string, string> = {
  "near mint": "NM",
  nm: "NM",
  mint: "NM",
  "lightly played": "LP",
  lp: "LP",
  "light play": "LP",
  "moderately played": "MP",
  mp: "MP",
  "moderate play": "MP",
  "heavily played": "HP",
  hp: "HP",
  "heavy play": "HP",
  damaged: "Damaged",
  dmg: "Damaged",
  poor: "Damaged",
};

export function normalizeCondition(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // "Near Mint Holofoil" style values: condition word(s) first
  const key = raw.trim().toLowerCase();
  if (CONDITION_MAP[key]) return CONDITION_MAP[key];
  for (const [k, v] of Object.entries(CONDITION_MAP)) {
    if (key.startsWith(k)) return v;
  }
  return null;
}

function findColumn(headers: string[], aliases: string[]): number {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  for (const alias of aliases) {
    const i = normalized.indexOf(alias);
    if (i !== -1) return i;
  }
  return -1;
}

export function parseCsvList(csvText: string): ParsedLine[] {
  const parsed = Papa.parse<string[]>(csvText.trim(), {
    skipEmptyLines: true,
  });
  const rows = parsed.data;
  if (rows.length < 2) return [];

  const headers = rows[0];
  const col = Object.fromEntries(
    (Object.keys(HEADER_ALIASES) as (keyof typeof HEADER_ALIASES)[]).map(
      (field) => [field, findColumn(headers, HEADER_ALIASES[field])],
    ),
  ) as Record<keyof typeof HEADER_ALIASES, number>;

  // A list we can't get card names or product ids out of isn't a card list
  if (col.name === -1 && col.productId === -1) return [];

  const get = (row: string[], i: number): string | null => {
    if (i === -1) return null;
    const v = row[i]?.trim();
    return v ? v : null;
  };

  return rows.slice(1).map((row) => {
    const qtyRaw = get(row, col.quantity);
    const qty = qtyRaw ? parseInt(qtyRaw.replace(/[^0-9]/g, ""), 10) : NaN;
    const productIdRaw = get(row, col.productId);
    const productId = productIdRaw ? parseInt(productIdRaw, 10) : NaN;
    // Collectr/TCGplayer exports sometimes fold printing into the condition
    // column ("Near Mint Holofoil")
    const conditionRaw = get(row, col.condition);
    let printing = get(row, col.printing);
    if (!printing && conditionRaw && /holo|foil/i.test(conditionRaw)) {
      printing = conditionRaw.replace(
        /^(near mint|lightly played|moderately played|heavily played|damaged)\s*/i,
        "",
      );
    }
    return {
      raw: row.join(","),
      quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
      name: get(row, col.name),
      setName: get(row, col.setName),
      cardNumber: get(row, col.cardNumber),
      printing: printing || null,
      condition: normalizeCondition(conditionRaw),
      productId: Number.isFinite(productId) ? productId : null,
    };
  });
}

// e.g. "2x Charizard ex 199/165 OBF LP", "1 Radiant Greninja TG14/TG30",
//      "Pikachu SVP 062", "3 Iono - 185/193 - Paldea Evolved"
const QTY_RE = /^\s*(\d{1,3})\s*[xX]?\s+/;
const NUMBER_RE =
  /\b((?:[a-zA-Z]{1,4}\d{1,3}|\d{1,3}[a-zA-Z]?)\s*\/\s*(?:[a-zA-Z]{1,4})?\d{1,3}|(?:swsh|svp|sm|xy|hgss|dp|bw)\s*\d{1,3}|#\d{1,3})\b/i;
const TRAILING_CONDITION_RE = /\b(NM|LP|MP|HP|DMG|Damaged)\b\.?\s*$/i;
const FOIL_HINT_RE = /\b(reverse holo(?:foil)?|holo(?:foil)?|foil|full art|alt art)\b/i;

export function parseTextLine(line: string): ParsedLine | null {
  let rest = line.trim();
  if (!rest) return null;

  let quantity = 1;
  const qtyMatch = rest.match(QTY_RE);
  if (qtyMatch) {
    quantity = parseInt(qtyMatch[1], 10);
    rest = rest.slice(qtyMatch[0].length);
  }

  let condition: string | null = null;
  const condMatch = rest.match(TRAILING_CONDITION_RE);
  if (condMatch) {
    condition = normalizeCondition(condMatch[1]);
    rest = rest.slice(0, condMatch.index).trim();
  }

  let printing: string | null = null;
  const foilMatch = rest.match(FOIL_HINT_RE);
  if (foilMatch) {
    printing = foilMatch[1];
    rest = (
      rest.slice(0, foilMatch.index) +
      rest.slice(foilMatch.index! + foilMatch[0].length)
    ).trim();
  }

  let cardNumber: string | null = null;
  let name: string | null = null;
  let setName: string | null = null;
  const numMatch = rest.match(NUMBER_RE);
  if (numMatch) {
    cardNumber = numMatch[1].replace(/\s+/g, "");
    name = rest.slice(0, numMatch.index).replace(/[-–—,]\s*$/, "").trim() || null;
    setName =
      rest
        .slice(numMatch.index! + numMatch[0].length)
        .replace(/^[-–—,\s]+/, "")
        .trim() || null;
  } else {
    // No number: try a trailing parenthetical as the set ("Pikachu (Jungle)")
    const paren = rest.match(/\(([^)]+)\)\s*$/);
    if (paren) {
      setName = paren[1].trim();
      name = rest.slice(0, paren.index).trim() || null;
    } else {
      name = rest || null;
    }
  }

  if (!name && !cardNumber) return null;
  return {
    raw: line,
    quantity,
    name,
    setName,
    cardNumber,
    printing,
    condition,
    productId: null,
  };
}

export function parseTextList(text: string): ParsedLine[] {
  return text
    .split(/\r?\n/)
    .map(parseTextLine)
    .filter((l): l is ParsedLine => l !== null);
}

/** CSV if the first non-empty line looks like a header row we recognize. */
export function parseList(text: string): ParsedLine[] {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const lower = firstLine.toLowerCase();
  const looksLikeCsvHeader =
    firstLine.includes(",") &&
    (lower.includes("quantity") || lower.includes("qty")) &&
    (lower.includes("name") || lower.includes("product id"));
  return looksLikeCsvHeader ? parseCsvList(text) : parseTextList(text);
}
