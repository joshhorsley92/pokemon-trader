/**
 * Purpose-built CSV exports from an analyzer run, mirroring the MTG
 * sell-helper's output files:
 *  - vendor pick lists  — packing checklist per buylist destination
 *  - TCGplayer import   — Staged Inventory / Bulk Lister "add to quantity"
 *  - bulk list          — what goes in the bulk pile
 *  - full decisions     — everything, one row per line item
 *
 * Pure string builders (client-safe, unit-tested). Decision overrides from
 * the UI are applied by the caller via the `decision` on each row.
 */
// Minimal structural type — both the engine's ItemResult and the admin UI's
// JSON-deserialized rows satisfy it.
export type ExportRow = {
  decision: "BUYLIST" | "TCG" | "BULK";
  item: {
    name: string;
    setName?: string | null;
    quantity: number;
    condition?: string | null;
    marketPrice: number | null;
    cardNumber?: string | null;
    rarity?: string | null;
    printing?: string | null;
    tcgplayerId?: number | null;
    category?: "singles" | "sealed";
  };
  bestOffer: {
    vendor: string;
    cash: number | null;
    credit: number | null;
    url?: string | null;
  } | null;
  estSalePrice: number | null;
  netTcg: number | null;
  flags: string[];
};

const TCG_CONDITION_NAMES: Record<string, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  Damaged: "Damaged",
};

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvLines(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

/** Cards to ship to one vendor: a human packing/entry checklist. */
export function vendorPickListCsv(rows: ExportRow[], vendor: string): string {
  const picked = rows.filter(
    (r) => r.decision === "BUYLIST" && r.bestOffer?.vendor === vendor,
  );
  return csvLines(
    ["Name", "Set", "Number", "Printing", "Condition", "Qty", "Offer Cash", "Offer Credit", "Listing URL"],
    picked.map((r) => [
      r.item.name,
      r.item.setName ?? "",
      r.item.cardNumber ?? "",
      r.item.printing ?? "",
      r.item.condition ?? "NM",
      r.item.quantity,
      r.bestOffer?.cash?.toFixed(2) ?? "",
      r.bestOffer?.credit?.toFixed(2) ?? "",
      r.bestOffer?.url ?? "",
    ]),
  );
}

/**
 * TCGplayer Staged Inventory format (same columns as the MTG sell-helper's
 * tcg_import CSV). Marketplace price = raw market price, per Josh.
 */
export function tcgImportCsv(
  rows: ExportRow[],
  productLine: "Pokemon" | "Magic: The Gathering",
): string {
  const tcg = rows.filter((r) => r.decision === "TCG");
  return csvLines(
    [
      "TCGplayer Id",
      "Product Line",
      "Set Name",
      "Product Name",
      "Number",
      "Rarity",
      "Condition",
      "Printing",
      "Add to Quantity",
      "TCG Marketplace Price",
    ],
    tcg.map((r) => [
      r.item.tcgplayerId ?? "",
      productLine,
      r.item.setName ?? "",
      r.item.name,
      r.item.cardNumber ?? "",
      r.item.rarity ?? "",
      TCG_CONDITION_NAMES[r.item.condition ?? "NM"] ?? "Near Mint",
      // TCGplayer printing labels: pass the source hint through, default Normal
      r.item.printing
        ? r.item.printing.replace(/^foil$/i, "Foil").replace(/^etched$/i, "Foil")
        : "Normal",
      r.item.quantity,
      r.item.marketPrice?.toFixed(2) ?? "",
    ]),
  );
}

export function bulkCsv(rows: ExportRow[]): string {
  const bulk = rows.filter((r) => r.decision === "BULK");
  return csvLines(
    ["Name", "Set", "Number", "Condition", "Qty", "Market", "Flags"],
    bulk.map((r) => [
      r.item.name,
      r.item.setName ?? "",
      r.item.cardNumber ?? "",
      r.item.condition ?? "NM",
      r.item.quantity,
      r.item.marketPrice?.toFixed(2) ?? "",
      r.flags.join("; "),
    ]),
  );
}

/** Everything, one row per line item — the audit/archive file. */
export function decisionsCsv(rows: ExportRow[]): string {
  return csvLines(
    [
      "Decision",
      "Name",
      "Set",
      "Number",
      "Printing",
      "Qty",
      "Condition",
      "Market",
      "Est Sale",
      "Best Vendor",
      "Vendor Cash",
      "Vendor Credit",
      "TCG Net",
      "Flags",
    ],
    rows.map((r) => [
      r.decision,
      r.item.name,
      r.item.setName ?? "",
      r.item.cardNumber ?? "",
      r.item.printing ?? "",
      r.item.quantity,
      r.item.condition ?? "NM",
      r.item.marketPrice?.toFixed(2) ?? "",
      r.estSalePrice?.toFixed(2) ?? "",
      r.bestOffer?.vendor ?? "",
      r.bestOffer?.cash?.toFixed(2) ?? "",
      r.bestOffer?.credit?.toFixed(2) ?? "",
      r.netTcg?.toFixed(2) ?? "",
      r.flags.join("; "),
    ]),
  );
}

export type ExportFile = { filename: string; content: string };

/** The full file set for one run — one pick list per vendor with cards. */
export function buildAllExports(
  rows: ExportRow[],
  productLine: "Pokemon" | "Magic: The Gathering",
  dateStamp: string,
): ExportFile[] {
  const vendors = [
    ...new Set(
      rows
        .filter((r) => r.decision === "BUYLIST" && r.bestOffer)
        .map((r) => r.bestOffer!.vendor),
    ),
  ].sort();
  const files: ExportFile[] = vendors.map((v) => ({
    filename: `pick-list-${v.replace(/_/g, "-")}-${dateStamp}.csv`,
    content: vendorPickListCsv(rows, v),
  }));
  files.push({
    filename: `tcgplayer-import-${dateStamp}.csv`,
    content: tcgImportCsv(rows, productLine),
  });
  files.push({ filename: `bulk-${dateStamp}.csv`, content: bulkCsv(rows) });
  files.push({
    filename: `decisions-${dateStamp}.csv`,
    content: decisionsCsv(rows),
  });
  return files;
}
