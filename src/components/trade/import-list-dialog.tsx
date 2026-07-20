"use client";

import { useState } from "react";
import {
  bulkLotCount,
  bulkLotTotal,
  bulkRateLabel,
  type ImportResultDto,
} from "./types";

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * "Import a list" — paste a text list or upload a CSV (TCGplayer/Collectr
 * exports work). Matched cards land on the counter; below-floor singles are
 * offered as a bulk lot.
 */
export function ImportListDialog({
  onImport,
}: {
  onImport: (result: ImportResultDto) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResultDto | null>(null);

  function reset() {
    setText("");
    setFileName(null);
    setFileContent(null);
    setError(null);
    setResult(null);
    setBusy(false);
  }

  async function analyze() {
    const payload = fileContent ?? text;
    if (!payload.trim()) {
      setError("Paste a list or choose a file first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/trade/import-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't read that list — try again.");
        return;
      }
      if (data.parsedCount === 0) {
        setError(
          "We couldn't find any cards in that list. Try one card per line, like: 2x Charizard ex 199/165",
        );
        return;
      }
      setResult(data);
    } catch {
      setError("Network problem — please try again.");
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!result) return;
    onImport(result);
    setOpen(false);
    reset();
  }

  const bulkCount = result ? bulkLotCount(result.bulk) : 0;
  const bulkTotal = result ? bulkLotTotal(result.bulk) : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-md border-2 border-dashed border-emerald-200/50 px-4 py-3 text-sm font-semibold text-emerald-100/90 transition-colors hover:border-emerald-200/90 hover:text-white"
      >
        📄 Import a list
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setOpen(false);
              reset();
            }
          }}
        >
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-display text-xl font-semibold text-[var(--ink)]">
                  Import your list
                </h2>
                <p className="mt-0.5 text-sm text-neutral-500">
                  Paste one card per line, or upload a CSV export (TCGplayer
                  and Collectr formats work).
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
                aria-label="Close"
                className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              >
                ✕
              </button>
            </div>

            {!result ? (
              <div className="mt-4 space-y-3">
                <textarea
                  rows={7}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={
                    "2x Charizard ex 199/165 NM\n1 Pikachu 025/094 Reverse Holo\n3x Prismatic Evolutions Booster Bundle"
                  }
                  className="w-full rounded-md border px-3 py-2 font-slip text-sm text-[var(--ink)] outline-none focus:ring-2 focus:ring-emerald-300"
                  disabled={fileContent !== null}
                />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="cursor-pointer rounded-md border px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-50">
                    Choose CSV file…
                    <input
                      type="file"
                      accept=".csv,.txt,text/csv,text/plain"
                      className="sr-only"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        setFileName(file.name);
                        setFileContent(await file.text());
                        setError(null);
                      }}
                    />
                  </label>
                  {fileName && (
                    <span className="flex items-center gap-1.5 text-neutral-600">
                      {fileName}
                      <button
                        type="button"
                        onClick={() => {
                          setFileName(null);
                          setFileContent(null);
                        }}
                        className="font-bold text-red-600"
                        aria-label="Remove file"
                      >
                        ×
                      </button>
                    </span>
                  )}
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <button
                  type="button"
                  onClick={analyze}
                  disabled={busy}
                  className="w-full rounded-md bg-[var(--felt)] px-4 py-2.5 font-display text-base font-semibold text-white shadow hover:bg-emerald-900 disabled:opacity-50"
                >
                  {busy ? "Checking your list…" : "Price my list"}
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-3 text-sm text-[var(--ink)]">
                <div className="rounded-md bg-emerald-50 px-3 py-2">
                  <p className="font-semibold text-emerald-900">
                    {result.regular.length} item
                    {result.regular.length === 1 ? "" : "s"} priced and ready
                    for the counter
                  </p>
                  {bulkCount > 0 && (
                    <p className="mt-1 text-emerald-800">
                      {bulkCount} {bulkCount === 1 ? "card" : "cards"}{" "}
                      below our minimum — we&apos;ll take them as bulk at{" "}
                      {bulkRateLabel(result.bulk.ratePerThousand)} cards (
                      {money(bulkTotal)} total)
                    </p>
                  )}
                </div>

                {result.rejected.length > 0 && (
                  <div className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">
                    <p className="font-semibold">
                      {result.rejected.length}{" "}
                      {result.rejected.length === 1 ? "line" : "lines"}{" "}
                      we couldn&apos;t take:
                    </p>
                    <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-xs">
                      {result.rejected.map((r, i) => (
                        <li key={i} className="truncate" title={r.raw}>
                          &ldquo;{r.raw}&rdquo; — {r.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.regular.length === 0 && bulkCount === 0 ? (
                  <p className="text-neutral-500">
                    Nothing in this list can be added automatically — try the
                    search instead, or send us a message.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={apply}
                    className="w-full rounded-md bg-[var(--tag)] px-4 py-2.5 font-display text-base font-bold text-[var(--ink)] shadow hover:-translate-y-0.5 transition-transform"
                  >
                    Put it all on the counter →
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setResult(null)}
                  className="w-full rounded-md px-4 py-1.5 text-sm text-neutral-500 hover:text-neutral-800"
                >
                  ← Edit the list
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
