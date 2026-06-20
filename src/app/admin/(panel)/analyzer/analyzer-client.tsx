"use client";

import { useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  buildAllExports,
  bulkCsv,
  decisionsCsv,
  tcgImportCsv,
  vendorPickListCsv,
  type ExportRow,
} from "@/lib/analyzer/export";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type VendorStatus = {
  vendor: string;
  total: number;
  matched: number;
  lastSync: string | null;
};

type Decision = "BUYLIST" | "TCG" | "BULK";

type ItemResult = {
  item: {
    productId: number | null;
    name: string;
    setName?: string | null;
    quantity: number;
    condition?: string | null;
    marketPrice: number | null;
    category?: "singles" | "sealed";
  };
  decision: Decision;
  bestOffer: {
    vendor: string;
    cash: number | null;
    credit: number | null;
    url?: string | null;
  } | null;
  netBuylist: number | null;
  estSalePrice: number | null;
  netTcg: number | null;
  netBulk: number;
  flags: string[];
};

type AnalyzeResponse = {
  summary: {
    results: ItemResult[];
    totals: Record<string, number>;
    vendorBatches: Record<
      string,
      { cards: number; cash: number; credit: number; shipping: number }
    >;
  };
  lines: { raw: string; matched: boolean }[];
  parsedCount: number;
  matchedCount: number;
};

type SearchHit = {
  id: number;
  name: string;
  groupName: string;
  marketPrice: number | null;
};

type ExtraItem = SearchHit & { quantity: number; condition: string };

const VENDOR_LABELS: Record<string, string> = {
  card_cavern: "Card Cavern",
  full_grip: "Full Grip Games",
  coolstuff: "CoolStuffInc",
  card_kingdom: "Card Kingdom",
};

function vendorLabel(v: string): string {
  return VENDOR_LABELS[v] ?? v;
}

function money(n: number | null | undefined): string {
  return n == null ? "—" : `$${n.toFixed(2)}`;
}

const DECISION_STYLES: Record<Decision, string> = {
  BUYLIST: "bg-emerald-100 text-emerald-800 hover:bg-emerald-200",
  TCG: "bg-sky-100 text-sky-800 hover:bg-sky-200",
  BULK: "bg-neutral-200 text-neutral-600 hover:bg-neutral-300",
};

export function AnalyzerClient({ vendors }: { vendors: VendorStatus[] }) {
  // 'pokemon' prices from the synced catalog + vendor buylists;
  // 'mtg' resolves live via Scryfall + the Card Kingdom buylist API
  const [game, setGame] = useState<"pokemon" | "mtg">("pokemon");
  const [listText, setListText] = useState("");
  // Uploaded CSVs stay out of the textarea: a 10k-row collection export in a
  // controlled textarea lags the whole page. File wins over pasted text.
  const [file, setFile] = useState<{ name: string; content: string } | null>(
    null,
  );
  const [extras, setExtras] = useState<ExtraItem[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  // Cap rendered rows — an 11k-row table freezes the DOM. Sorted by value,
  // revealed in chunks.
  const RENDER_CHUNK = 200;
  const [renderLimit, setRenderLimit] = useState(RENDER_CHUNK);
  // Per-row decision overrides (click a badge to cycle)
  const [overrides, setOverrides] = useState<Record<number, Decision>>({});
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function onSearchChange(q: string) {
    setSearchQ(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!q.trim()) {
      setSearchHits([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      const res = await fetch(
        `/api/analyzer/search?q=${encodeURIComponent(q)}`,
      );
      if (res.ok) setSearchHits((await res.json()).results);
    }, 250);
  }

  function addExtra(hit: SearchHit) {
    setExtras((prev) => {
      const existing = prev.find((e) => e.id === hit.id);
      if (existing) {
        return prev.map((e) =>
          e.id === hit.id ? { ...e, quantity: e.quantity + 1 } : e,
        );
      }
      return [...prev, { ...hit, quantity: 1, condition: "NM" }];
    });
    setSearchQ("");
    setSearchHits([]);
  }

  async function onFile(f: File) {
    setFile({ name: f.name, content: await f.text() });
  }

  async function analyzeNow() {
    setBusy(true);
    setError(null);
    setOverrides({});
    setProgress("Uploading list…");
    try {
      const res = await fetch(
        game === "mtg" ? "/api/analyzer/mtg" : "/api/analyzer",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            game === "mtg"
              ? { list: file?.content ?? listText }
              : {
                  list: file?.content ?? listText,
                  extra: extras.map((e) => ({
                    productId: e.id,
                    quantity: e.quantity,
                    condition: e.condition,
                  })),
                },
          ),
        },
      );
      // Non-streaming error responses (auth, validation) are plain JSON
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? "Analysis failed",
        );
      }
      // NDJSON stream: status lines while running, then result or error
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult: AnalyzeResponse | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as
            | { type: "status"; message: string }
            | { type: "result"; result: AnalyzeResponse }
            | { type: "error"; error: string };
          if (event.type === "status") setProgress(event.message);
          else if (event.type === "error") throw new Error(event.error);
          else finalResult = event.result;
        }
      }
      if (!finalResult) throw new Error("Analysis ended without a result");
      setResult(finalResult);
      setActiveTab("all");
      setRenderLimit(RENDER_CHUNK);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function cycleDecision(i: number, row: ItemResult) {
    const options: Decision[] = [];
    if (row.bestOffer) options.push("BUYLIST");
    if (row.netTcg !== null) options.push("TCG");
    options.push("BULK");
    const current = overrides[i] ?? row.decision;
    const next = options[(options.indexOf(current) + 1) % options.length];
    setOverrides((prev) => ({ ...prev, [i]: next }));
  }

  // Recompute totals client-side so badge-cycling updates the summary live.
  // (Shipping shares aren't re-amortized here — re-run the analysis for that.)
  const totals = useMemo(() => {
    if (!result) return null;
    const shippingFlat = Object.values(result.summary.vendorBatches)[0]?.shipping ?? 5;
    const t = {
      buylistCash: 0,
      buylistCredit: 0,
      tcgNet: 0,
      bulk: 0,
      bulkCards: 0,
      bulkRate: 0,
      cards: 0,
      shippingTotal: 0,
      batches: {} as Record<string, { cards: number; cash: number; shipping: number }>,
    };
    result.summary.results.forEach((r, i) => {
      const decision = overrides[i] ?? r.decision;
      const qty = r.item.quantity;
      t.cards += qty;
      t.bulkRate = r.netBulk; // uniform rate from settings
      if (decision === "BUYLIST" && r.bestOffer) {
        t.buylistCash += (r.bestOffer.cash ?? 0) * qty;
        t.buylistCredit += (r.bestOffer.credit ?? 0) * qty;
        const b = (t.batches[r.bestOffer.vendor] ??= {
          cards: 0,
          cash: 0,
          shipping: shippingFlat,
        });
        b.cards += qty;
        b.cash += (r.bestOffer.cash ?? 0) * qty;
      } else if (decision === "TCG") {
        t.tcgNet += (r.netTcg ?? 0) * qty;
      } else {
        t.bulk += r.netBulk * qty;
        t.bulkCards += qty;
      }
    });
    t.shippingTotal = Object.values(t.batches).reduce((s, b) => s + b.shipping, 0);
    return t;
  }, [result, overrides]);

  // Tab filtering: per-vendor ship lists, TCG pile, bulk pile
  const [activeTab, setActiveTab] = useState<string>("all");
  const indexedRows = useMemo(
    () => (result ? result.summary.results.map((r, i) => ({ r, i })) : []),
    [result],
  );
  const vendorTabs = useMemo(() => {
    const seen = new Set<string>();
    for (const { r, i } of indexedRows) {
      const d = overrides[i] ?? r.decision;
      if (d === "BUYLIST" && r.bestOffer) seen.add(r.bestOffer.vendor);
    }
    return [...seen].sort();
  }, [indexedRows, overrides]);
  // Filter to the active tab, most valuable first, rendered in capped chunks
  const visibleRows = useMemo(
    () =>
      indexedRows
        .filter(({ r, i }) => {
          if (activeTab === "all") return true;
          if (activeTab === "sealed") return r.item.category === "sealed";
          const d = overrides[i] ?? r.decision;
          if (activeTab === "tcg") return d === "TCG";
          if (activeTab === "bulk") return d === "BULK";
          return d === "BUYLIST" && r.bestOffer?.vendor === activeTab;
        })
        .sort(
          (a, b) =>
            (b.r.item.marketPrice ?? -1) - (a.r.item.marketPrice ?? -1),
        ),
    [indexedRows, activeTab, overrides],
  );
  const renderedRows = visibleRows.slice(0, renderLimit);

  // Every row with its UI override applied — the source for all exports
  function exportRows(): ExportRow[] {
    return indexedRows.map(({ r, i }) => ({
      ...r,
      decision: overrides[i] ?? r.decision,
    }));
  }

  function dateStamp(): string {
    return new Date().toISOString().slice(0, 10).replace(/-/g, "");
  }

  function downloadFile(filename: string, content: string) {
    const blob = new Blob([content], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const productLine = game === "mtg" ? "Magic: The Gathering" : "Pokemon";

  /** The active tab's purpose-specific file. */
  function exportActiveTab() {
    const rows = exportRows();
    const stamp = dateStamp();
    if (activeTab === "tcg") {
      downloadFile(`tcgplayer-import-${stamp}.csv`, tcgImportCsv(rows, productLine));
    } else if (activeTab === "bulk") {
      downloadFile(`bulk-${stamp}.csv`, bulkCsv(rows));
    } else if (activeTab === "sealed") {
      downloadFile(
        `sealed-${stamp}.csv`,
        decisionsCsv(rows.filter((r) => r.item.category === "sealed")),
      );
    } else if (activeTab !== "all") {
      downloadFile(
        `pick-list-${activeTab.replace(/_/g, "-")}-${stamp}.csv`,
        vendorPickListCsv(rows, activeTab),
      );
    } else {
      downloadFile(`decisions-${stamp}.csv`, decisionsCsv(rows));
    }
  }

  /** One click, every file: pick list per vendor, TCG import, bulk, decisions. */
  async function exportAll() {
    const files = buildAllExports(exportRows(), productLine, dateStamp());
    for (const f of files) {
      downloadFile(f.filename, f.content);
      // Brief gap so the browser doesn't swallow successive downloads
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  const TAB_EXPORT_LABELS: Record<string, string> = {
    all: "Export decisions CSV",
    tcg: "Export TCGplayer import",
    bulk: "Export bulk list",
    sealed: "Export sealed list",
  };

  const unmatched = result?.lines.filter((l) => !l.matched) ?? [];

  function countTab(tab: string): number {
    return indexedRows.filter(({ r, i }) => {
      if (tab === "sealed") return r.item.category === "sealed";
      const d = overrides[i] ?? r.decision;
      if (tab === "tcg") return d === "TCG";
      if (tab === "bulk") return d === "BULK";
      return d === "BUYLIST" && r.bestOffer?.vendor === tab;
    }).length;
  }

  return (
    <div className="space-y-6">
      {/* Vendor data freshness */}
      <div className="flex flex-wrap gap-2 text-xs text-neutral-500">
        {vendors.length === 0 ? (
          <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800">
            No buylist data synced yet — run{" "}
            <code className="font-mono">npm run sync:buylists</code> first.
            Cards will still price against TCGplayer market.
          </span>
        ) : (
          vendors.map((v) => (
            <span key={v.vendor} className="rounded-md border bg-white px-2 py-1">
              {vendorLabel(v.vendor)}: {v.matched.toLocaleString()} matched
              listings
              {v.lastSync &&
                ` · synced ${new Date(v.lastSync).toLocaleDateString()}`}
            </span>
          ))
        )}
      </div>

      {/* Input */}
      <div className="space-y-3 rounded-lg border bg-white p-4">
        <div className="flex gap-1">
          {(["pokemon", "mtg"] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGame(g)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                game === g
                  ? "bg-neutral-900 text-white"
                  : "border bg-white text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {g === "pokemon" ? "Pokémon" : "Magic"}
            </button>
          ))}
        </div>
        <textarea
          value={listText}
          onChange={(e) => setListText(e.target.value)}
          placeholder={
            game === "mtg"
              ? "Paste a list — one card per line or a ManaBox CSV export:\n2 Lightning Bolt (2x2) 117 *F*\n1 Ragavan, Nimble Pilferer"
              : "Paste a list — one card per line or a TCGplayer/Collectr CSV export:\n2x Charizard ex 199/165 Obsidian Flames\n1 Iono - 185/193 - Paldea Evolved LP"
          }
          className="h-40 w-full rounded-md border px-3 py-2 font-mono text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
          {file ? (
            <span className="flex items-center gap-2 rounded-md border bg-neutral-50 px-2 py-1.5 text-sm">
              📄 {file.name}
              <span className="text-xs text-neutral-400">
                ({Math.round(file.content.length / 1024).toLocaleString()} KB —
                replaces pasted text)
              </span>
              <button
                type="button"
                className="text-neutral-400 hover:text-red-600"
                onClick={() => setFile(null)}
              >
                ✕
              </button>
            </span>
          ) : (
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              Upload CSV
            </Button>
          )}
          <div className={`relative ${game === "mtg" ? "hidden" : ""}`}>
            <Input
              value={searchQ}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Or search the catalog to add cards…"
              className="w-72"
            />
            {searchHits.length > 0 && (
              <div className="absolute z-10 mt-1 max-h-64 w-96 overflow-y-auto rounded-md border bg-white shadow-lg">
                {searchHits.map((hit) => (
                  <button
                    key={hit.id}
                    type="button"
                    onClick={() => addExtra(hit)}
                    className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50"
                  >
                    <span>
                      {hit.name}
                      <span className="ml-1 text-xs text-neutral-400">
                        {hit.groupName}
                      </span>
                    </span>
                    <span className="whitespace-nowrap text-neutral-500">
                      {money(hit.marketPrice)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grow" />
          {busy && progress && (
            <span className="flex items-center gap-2 text-sm text-neutral-500">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" />
              {progress}
            </span>
          )}
          <Button onClick={analyzeNow} disabled={busy}>
            {busy ? "Analyzing…" : "Analyze"}
          </Button>
        </div>

        {extras.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {extras.map((e) => (
              <span
                key={e.id}
                className="flex items-center gap-2 rounded-md border bg-neutral-50 px-2 py-1 text-xs"
              >
                {e.quantity}× {e.name}
                <select
                  value={e.condition}
                  onChange={(ev) =>
                    setExtras((prev) =>
                      prev.map((x) =>
                        x.id === e.id ? { ...x, condition: ev.target.value } : x,
                      ),
                    )
                  }
                  className="rounded border bg-white px-1"
                >
                  {["NM", "LP", "MP", "HP", "Damaged"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="text-neutral-400 hover:text-red-600"
                  onClick={() =>
                    setExtras((prev) => prev.filter((x) => x.id !== e.id))
                  }
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      {/* Results */}
      {result && totals && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryCard
              label="Buylist (cash, after shipping)"
              value={money(totals.buylistCash - totals.shippingTotal)}
              sub={`${money(totals.buylistCash)} gross − ${money(totals.shippingTotal)} shipping · credit ${money(totals.buylistCredit)}`}
            />
            <SummaryCard label="TCGplayer (net)" value={money(totals.tcgNet)} />
            <SummaryCard
              label="Bulk"
              value={money(totals.bulk)}
              sub={
                totals.bulkCards > 0
                  ? `${totals.bulkCards} cards × ${money(totals.bulkRate)}/card`
                  : undefined
              }
            />
            <SummaryCard
              label="Matched"
              value={`${result.matchedCount}/${result.parsedCount}`}
              sub={`${totals.cards} cards`}
            />
          </div>

          {Object.keys(totals.batches).length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs text-neutral-600">
              {Object.entries(totals.batches).map(([vendor, b]) => (
                <span key={vendor} className="rounded-md border bg-white px-2 py-1">
                  Ship {b.cards} cards to {vendorLabel(vendor)} →{" "}
                  {money(b.cash)} − {money(b.shipping)} shipping ={" "}
                  <strong>{money(b.cash - b.shipping)}</strong> cash
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              {[
                { key: "all", label: `All (${indexedRows.length})` },
                ...vendorTabs.map((v) => ({
                  key: v,
                  label: `${vendorLabel(v)} (${countTab(v)})`,
                })),
                { key: "tcg", label: `TCGplayer (${countTab("tcg")})` },
                { key: "bulk", label: `Bulk (${countTab("bulk")})` },
                ...(countTab("sealed") > 0
                  ? [{ key: "sealed", label: `Sealed (${countTab("sealed")})` }]
                  : []),
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.key);
                    setRenderLimit(RENDER_CHUNK);
                  }}
                  className={`rounded-md px-3 py-1.5 text-sm ${
                    activeTab === tab.key
                      ? "bg-neutral-900 text-white"
                      : "bg-white text-neutral-600 hover:bg-neutral-100 border"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <p className="text-xs text-neutral-400">
                Click a decision badge to override it.
              </p>
              <Button variant="outline" size="sm" onClick={exportActiveTab}>
                {TAB_EXPORT_LABELS[activeTab] ?? "Export pick list"}
              </Button>
              <Button size="sm" onClick={exportAll}>
                Download all
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Card</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Cond</TableHead>
                  <TableHead className="text-right">Market</TableHead>
                  <TableHead>Best buylist</TableHead>
                  <TableHead className="text-right">TCG net</TableHead>
                  <TableHead>Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {renderedRows.map(({ r, i }) => (
                  <TableRow key={i}>
                    <TableCell>
                      <div className="font-medium">{r.item.name}</div>
                      <div className="text-xs text-neutral-400">
                        {r.item.setName}
                        {r.flags.map((f) => (
                          <Badge
                            key={f}
                            variant="outline"
                            className="ml-1 border-amber-300 text-amber-700"
                          >
                            {f}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {r.item.quantity}
                    </TableCell>
                    <TableCell>{r.item.condition ?? "NM"}</TableCell>
                    <TableCell className="text-right">
                      {money(r.item.marketPrice)}
                    </TableCell>
                    <TableCell>
                      {r.bestOffer ? (
                        <span>
                          {r.bestOffer.url ? (
                            <a
                              href={r.bestOffer.url}
                              target="_blank"
                              rel="noreferrer"
                              className="underline decoration-dotted"
                            >
                              {vendorLabel(r.bestOffer.vendor)}
                            </a>
                          ) : (
                            vendorLabel(r.bestOffer.vendor)
                          )}{" "}
                          {money(r.bestOffer.cash)}
                          {r.bestOffer.credit != null && (
                            <span className="text-xs text-neutral-400">
                              {" "}
                              / {money(r.bestOffer.credit)} credit
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-neutral-300">no offers</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {money(r.netTcg)}
                      {(r.item.condition ?? "NM") !== "NM" &&
                        r.estSalePrice !== null && (
                          <div className="text-xs text-neutral-400">
                            sale est. {money(r.estSalePrice)} (
                            {r.item.condition})
                          </div>
                        )}
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => cycleDecision(i, r)}
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${DECISION_STYLES[overrides[i] ?? r.decision]}`}
                      >
                        {overrides[i] ?? r.decision}
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {visibleRows.length > renderLimit && (
              <div className="border-t p-3 text-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRenderLimit((n) => n + RENDER_CHUNK)}
                >
                  Show {Math.min(RENDER_CHUNK, visibleRows.length - renderLimit)}{" "}
                  more ({(visibleRows.length - renderLimit).toLocaleString()}{" "}
                  hidden, sorted by market price — export CSV for the full
                  list)
                </Button>
              </div>
            )}
          </div>

          {unmatched.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
              <p className="mb-2 font-medium text-amber-900">
                {unmatched.length} line{unmatched.length === 1 ? "" : "s"}{" "}
                couldn&apos;t be matched to the catalog:
              </p>
              <ul className="space-y-1 font-mono text-xs text-amber-800">
                {unmatched.slice(0, 50).map((l, i) => (
                  <li key={i}>{l.raw}</li>
                ))}
              </ul>
              {unmatched.length > 50 && (
                <p className="mt-2 text-xs text-amber-700">
                  …and {(unmatched.length - 50).toLocaleString()} more
                  (flagged &quot;unmatched&quot; in the CSV export)
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-neutral-400">{sub}</div>}
    </div>
  );
}
