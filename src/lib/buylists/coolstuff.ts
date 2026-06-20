/**
 * CoolStuffInc — their sell list is a JS shell, but the data behind it is a
 * pre-generated static JSON file (verified 2026-06-11):
 *
 *   1. POST /main_selllist.php?s=pokemon  body: action=getCards
 *      -> {"status":1,"rows":"GeneratedFiles/SellList/Section-pokemon.json?v=<cachebuster>"}
 *      ("rows" is an inline array instead when a name filter is applied)
 *   2. GET that file -> ~19MB array of ~20k rows: the whole Pokemon buylist.
 *
 * Row fields: PPQID (stable id), Name ("Charizard - 4/102", variant in
 * trailing parens e.g. "(Reverse Foil)"), ItemSet, Number (numerator only),
 * Price (cash, string), CreditPrice (~cash × 1.25), tName (condition —
 * "Near Mint" for singles, "New" for sealed/bulk lots), BuyListNotes.
 * Everything listed has a real price; "not buying" rows simply don't appear.
 */
import { fetchWithRetry, type VendorAdapter, type VendorListing } from "./types";

const BASE = "https://www.coolstuffinc.com";
const SELL_LIST_URL = `${BASE}/main_selllist.php?s=pokemon`;

type CsiRow = {
  PID?: number | string;
  PPQID: number | string;
  Name: string;
  ItemSet?: string;
  Number?: string;
  Price: string;
  CreditPrice?: string;
  tName?: string;
};

// Trailing paren qualifiers that are printings, not part of the card name
const PRINTING_PARENS =
  /\((reverse foil|master ball foil|poke ball foil|energy foil|holo|non-holo|shatterfoil|classic collection|[^)]*stamp[^)]*|[^)]*foil[^)]*)\)\s*$/i;

export function listingFromCsiRow(row: CsiRow): VendorListing | null {
  // "New" condition = sealed product / bulk lots ("1,000 Bulk Commons"), not singles
  if (row.tName && row.tName !== "Near Mint") return null;
  const cash = parseFloat(row.Price);
  if (!Number.isFinite(cash) || cash <= 0) return null;

  let working = row.Name.trim();
  let printing: string | null = null;
  const paren = working.match(PRINTING_PARENS);
  if (paren) {
    printing = paren[1];
    working = working.slice(0, paren.index).trim();
  }

  // "Charizard - 4/102" — bulk lots have no dash-number part; skip those
  const dash = working.match(/^(.*?)\s+-\s+([a-zA-Z]{0,4}\d{1,3}[a-zA-Z]?(?:\/[a-zA-Z]{0,4}\d{1,3})?)$/);
  const name = dash ? dash[1].trim() : working;
  const cardNumber = dash ? dash[2] : (row.Number?.trim() || null);
  if (!dash && !row.Number) return null;

  const credit = row.CreditPrice ? parseFloat(row.CreditPrice) : NaN;
  return {
    vendorKey: String(row.PPQID),
    title: row.Name,
    name,
    setName: row.ItemSet?.trim() || null,
    cardNumber,
    printing,
    cashPrice: cash,
    creditPrice: Number.isFinite(credit) ? credit : null,
    conditionPrices: null,
    buying: true,
    url: SELL_LIST_URL,
  };
}

export const coolstuffAdapter: VendorAdapter = {
  vendor: "coolstuff",
  label: "CoolStuffInc",
  async *fetchListings() {
    const pointerRes = await fetchWithRetry(SELL_LIST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "action=getCards",
    });
    if (!pointerRes.ok) {
      throw new Error(`CSI getCards: HTTP ${pointerRes.status}`);
    }
    const pointer = (await pointerRes.json()) as {
      status: number;
      rows: string | CsiRow[];
    };

    let rows: CsiRow[];
    if (Array.isArray(pointer.rows)) {
      rows = pointer.rows;
    } else if (typeof pointer.rows === "string") {
      const fileRes = await fetchWithRetry(`${BASE}/${pointer.rows}`);
      if (!fileRes.ok) {
        throw new Error(`CSI sell-list file: HTTP ${fileRes.status}`);
      }
      rows = (await fileRes.json()) as CsiRow[];
    } else {
      throw new Error("CSI getCards: unexpected rows payload");
    }

    // One static file; yield in chunks so upserts stream rather than buffer
    const CHUNK = 1000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      yield rows
        .slice(i, i + CHUNK)
        .map(listingFromCsiRow)
        .filter((l): l is VendorListing => l !== null);
    }
  },
};
