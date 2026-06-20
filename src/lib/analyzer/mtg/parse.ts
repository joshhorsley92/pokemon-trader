/**
 * MTG list ingestion: ManaBox collection CSV exports and freeform pasted
 * text lists, normalized to MtgParsedLine[] for Scryfall resolution.
 * Ported from Josh's mtg-sell-helper (parse_manabox_csv / parse_text_list).
 *
 * Pure module (papaparse only) — no DB, no fetch.
 */
import Papa from "papaparse";

export type MtgFinish = "normal" | "foil" | "etched";

export type MtgParsedLine = {
  /** Original line / row, echoed back for unmatched-row UX */
  raw: string;
  quantity: number;
  name: string | null;
  /** Scryfall set code, e.g. "mh2" (ManaBox exports use Scryfall codes) */
  setCode: string | null;
  setName: string | null;
  collectorNumber: string | null;
  foil: boolean;
  finish: MtgFinish;
  /** Normalized condition value (NM/LP/MP/HP/Damaged) */
  condition: string;
  /** Scryfall UUID when the CSV carries one — exact resolution, no fuzz */
  scryfallId: string | null;
  rarity: string | null;
};

// ManaBox condition values ("near_mint") plus common freeform spellings,
// mapped onto our standard singles scale. ManaBox's 7-step scale folds into
// 5: excellent≈LP, good/light_played≈MP, played≈HP, poor≈Damaged.
const CONDITION_MAP: Record<string, string> = {
  mint: "NM",
  "near mint": "NM",
  nm: "NM",
  excellent: "LP",
  "lightly played": "LP",
  "light play": "LP",
  lp: "LP",
  good: "MP",
  "light played": "MP",
  "moderately played": "MP",
  "moderate play": "MP",
  mp: "MP",
  played: "HP",
  "heavily played": "HP",
  "heavy play": "HP",
  hp: "HP",
  poor: "Damaged",
  damaged: "Damaged",
  dmg: "Damaged",
};

/** Normalize a condition string to NM/LP/MP/HP/Damaged; unknown/blank = NM. */
export function normalizeMtgCondition(raw: string | null | undefined): string {
  if (!raw) return "NM";
  const key = raw.trim().toLowerCase().replace(/_/g, " ");
  if (CONDITION_MAP[key]) return CONDITION_MAP[key];
  for (const [k, v] of Object.entries(CONDITION_MAP)) {
    if (key.startsWith(k)) return v;
  }
  return "NM";
}

/** ManaBox "Foil" column → foil flag + finish ("foil"/"etched" count as foil). */
function parseFoilValue(raw: string | null | undefined): { foil: boolean; finish: MtgFinish } {
  const v = (raw ?? "normal").trim().toLowerCase();
  if (v === "etched") return { foil: true, finish: "etched" };
  if (v === "foil") return { foil: true, finish: "foil" };
  return { foil: false, finish: "normal" };
}

// ManaBox export headers (fixed names, matched case-insensitively)
const MANABOX_HEADERS = {
  name: "name",
  setCode: "set code",
  setName: "set name",
  collectorNumber: "collector number",
  foil: "foil",
  condition: "condition",
  quantity: "quantity",
  scryfallId: "scryfall id",
  rarity: "rarity",
} as const;

/**
 * Parse a ManaBox collection CSV export. Unlike the Python (which drops rows
 * without a Scryfall ID), rows missing the ID are kept with scryfallId null —
 * the Scryfall client can still resolve them via name+set.
 */
export function parseManaboxCsv(text: string): MtgParsedLine[] {
  // ManaBox writes a UTF-8 BOM; strip it so the first header matches
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, "").trim(), {
    skipEmptyLines: true,
  });
  const rows = parsed.data;
  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const col = Object.fromEntries(
    (Object.keys(MANABOX_HEADERS) as (keyof typeof MANABOX_HEADERS)[]).map(
      (field) => [field, headers.indexOf(MANABOX_HEADERS[field])],
    ),
  ) as Record<keyof typeof MANABOX_HEADERS, number>;
  if (col.name === -1) return [];

  const get = (row: string[], i: number): string | null => {
    if (i === -1) return null;
    const v = row[i]?.trim();
    return v ? v : null;
  };

  const lines: MtgParsedLine[] = [];
  for (const row of rows.slice(1)) {
    const name = get(row, col.name);
    const scryfallId = get(row, col.scryfallId);
    if (!name && !scryfallId) continue;

    const { foil, finish } = parseFoilValue(get(row, col.foil));
    const qtyRaw = get(row, col.quantity);
    const qty = qtyRaw ? parseInt(qtyRaw, 10) : NaN;

    lines.push({
      raw: row.join(","),
      quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
      name,
      setCode: get(row, col.setCode)?.toLowerCase() ?? null,
      setName: get(row, col.setName),
      collectorNumber: get(row, col.collectorNumber),
      foil,
      finish,
      condition: normalizeMtgCondition(get(row, col.condition)),
      scryfallId,
      rarity: get(row, col.rarity),
    });
  }
  return lines;
}

// Full format from the Python tool: `<qty> <name> (<set>) <collector> [*F*]`
// e.g. "2 Lightning Bolt (2x2) 117 *F*"
const FULL_LINE_RE = /^(\d+)[xX]?\s+(.+?)\s+\(([^)]+)\)\s+(\S+?)(?:\s+\*F\*)?\s*$/;
// Tolerant fallback: `<qty> <name> (<set>)` without a collector number
const QTY_NAME_SET_RE = /^(\d+)[xX]?\s+(.+?)\s+\(([^)]+)\)\s*$/;
// Bare fallbacks: "2 Lightning Bolt", "2x Lightning Bolt", "Lightning Bolt"
const QTY_NAME_RE = /^(\d+)[xX]?\s+(.+?)\s*$/;

/**
 * Parse one freeform text line. Foil is flagged by a `*F*` marker anywhere
 * in the line (Moxfield/Archidekt export convention, same as the Python).
 */
export function parseMtgTextLine(line: string): MtgParsedLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const foil = trimmed.includes("*F*");
  // Strip the marker before fallback parsing so it never lands in the name
  const rest = trimmed.replace(/\s*\*F\*\s*/g, " ").trim();
  if (!rest) return null;

  const base: Omit<MtgParsedLine, "quantity" | "name" | "setCode" | "collectorNumber"> = {
    raw: line,
    setName: null,
    foil,
    finish: foil ? "foil" : "normal",
    condition: "NM",
    scryfallId: null,
    rarity: null,
  };

  const full = trimmed.match(FULL_LINE_RE);
  if (full) {
    return {
      ...base,
      quantity: parseInt(full[1], 10),
      name: full[2],
      setCode: full[3].toLowerCase(),
      collectorNumber: full[4],
    };
  }

  const qtyNameSet = rest.match(QTY_NAME_SET_RE);
  if (qtyNameSet) {
    return {
      ...base,
      quantity: parseInt(qtyNameSet[1], 10),
      name: qtyNameSet[2],
      setCode: qtyNameSet[3].toLowerCase(),
      collectorNumber: null,
    };
  }

  const qtyName = rest.match(QTY_NAME_RE);
  if (qtyName) {
    return {
      ...base,
      quantity: parseInt(qtyName[1], 10),
      name: qtyName[2],
      setCode: null,
      collectorNumber: null,
    };
  }

  // Bare card name, quantity 1
  return { ...base, quantity: 1, name: rest, setCode: null, collectorNumber: null };
}

export function parseMtgTextList(text: string): MtgParsedLine[] {
  return text
    .split(/\r?\n/)
    .map(parseMtgTextLine)
    .filter((l): l is MtgParsedLine => l !== null);
}

/** CSV iff the first non-empty line looks like a ManaBox header row. */
export function parseMtgList(text: string): MtgParsedLine[] {
  const firstLine =
    text.replace(/^﻿/, "").split(/\r?\n/).find((l) => l.trim()) ?? "";
  const lower = firstLine.toLowerCase();
  const looksLikeManabox =
    firstLine.includes(",") &&
    lower.includes("name") &&
    (lower.includes("set code") ||
      lower.includes("scryfall id") ||
      lower.includes("collector number"));
  return looksLikeManabox ? parseManaboxCsv(text) : parseMtgTextList(text);
}
