"use client";

import { useMemo, useState, useTransition } from "react";
import Papa from "papaparse";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { importInventory, type ImportRow } from "../actions";

type CsvRow = Record<string, string>;

const NONE = "__none__";

/** Guess a column by header keywords, e.g. ["name", "product"]. */
function guessColumn(headers: string[], keywords: string[]): string {
  for (const kw of keywords) {
    const hit = headers.find((h) => h.toLowerCase().includes(kw));
    if (hit) return hit;
  }
  return NONE;
}

function guessCategory(row: CsvRow, titleCol: string): "singles" | "sealed" | "graded" {
  const text = Object.values(row).join(" ").toLowerCase();
  const title = (row[titleCol] ?? "").toLowerCase();
  if (/\b(psa|bgs|cgc|sgc|ace|tag)\s*\d/.test(text)) return "graded";
  if (
    /booster|elite trainer|etb|bundle|collection|tin|blister|display|box|deck|case/.test(
      title,
    )
  ) {
    return "sealed";
  }
  return "singles";
}

export function ImportWizard() {
  const router = useRouter();
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [titleCol, setTitleCol] = useState<string>(NONE);
  const [qtyCol, setQtyCol] = useState<string>(NONE);
  const [priceCol, setPriceCol] = useState<string>(NONE);
  const [conditionCol, setConditionCol] = useState<string>(NONE);
  const [usePriceAsAsking, setUsePriceAsAsking] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleFile(file: File) {
    setError(null);
    setResult(null);
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (parsed) => {
        const fields = parsed.meta.fields ?? [];
        if (fields.length === 0 || parsed.data.length === 0) {
          setError("Could not read any rows from that file.");
          return;
        }
        setHeaders(fields);
        setRows(parsed.data);
        setTitleCol(guessColumn(fields, ["product name", "name", "product", "title", "card"]));
        setQtyCol(guessColumn(fields, ["quantity", "qty", "count"]));
        setPriceCol(guessColumn(fields, ["market", "value", "price"]));
        setConditionCol(guessColumn(fields, ["condition", "grade"]));
      },
      error: () => setError("Failed to parse the CSV file."),
    });
  }

  const preview: ImportRow[] = useMemo(() => {
    if (titleCol === NONE) return [];
    return rows
      .map((row): ImportRow | null => {
        const title = (row[titleCol] ?? "").trim();
        if (!title) return null;
        const qty =
          qtyCol !== NONE ? parseInt(row[qtyCol] ?? "1", 10) || 1 : 1;
        const priceRaw =
          priceCol !== NONE
            ? parseFloat((row[priceCol] ?? "").replace(/[$,]/g, ""))
            : NaN;
        return {
          title,
          category: guessCategory(row, titleCol),
          quantity: Math.min(Math.max(qty, 1), 9999),
          askingPrice:
            usePriceAsAsking && Number.isFinite(priceRaw) ? priceRaw : null,
          condition:
            conditionCol !== NONE ? (row[conditionCol] ?? "").trim() || null : null,
          raw: row,
        } satisfies ImportRow;
      })
      .filter((r): r is ImportRow => r !== null);
  }, [rows, titleCol, qtyCol, priceCol, conditionCol, usePriceAsAsking]);

  function submit() {
    startTransition(async () => {
      const res = await importInventory(preview);
      if (res.error) {
        setError(res.error);
        return;
      }
      setResult(
        `Imported ${res.inserted} items (${res.matched} matched to the catalog for automatic market pricing).`,
      );
      setTimeout(() => router.push("/admin/inventory"), 1500);
    });
  }

  const colSelect = (
    label: string,
    value: string,
    onChange: (v: string) => void,
  ) => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border bg-white px-2 text-sm"
      >
        <option value={NONE}>— none —</option>
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>1. Choose file</CardTitle>
          <CardDescription>
            In Collectr: Portfolio → ⋯ menu → Export (requires Collectr PRO).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
            className="text-sm"
          />
        </CardContent>
      </Card>

      {headers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>2. Map columns</CardTitle>
            <CardDescription>
              {rows.length} rows found. Only the product name is required.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-4">
              {colSelect("Product name *", titleCol, setTitleCol)}
              {colSelect("Quantity", qtyCol, setQtyCol)}
              {colSelect("Price", priceCol, setPriceCol)}
              {colSelect("Condition", conditionCol, setConditionCol)}
            </div>
            {priceCol !== NONE && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={usePriceAsAsking}
                  onChange={(e) => setUsePriceAsAsking(e.target.checked)}
                />
                Use the price column as a fixed asking price (otherwise items
                track market price when matched to the catalog)
              </label>
            )}
          </CardContent>
        </Card>
      )}

      {preview.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>3. Review &amp; import</CardTitle>
            <CardDescription>
              Showing first 15 of {preview.length} items. Category is guessed —
              you can fix individual items after import.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Asking</TableHead>
                  <TableHead>Condition</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.slice(0, 15).map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="max-w-sm truncate">{row.title}</TableCell>
                    <TableCell className="capitalize">{row.category}</TableCell>
                    <TableCell className="text-right">{row.quantity}</TableCell>
                    <TableCell className="text-right">
                      {row.askingPrice !== null
                        ? `$${row.askingPrice.toFixed(2)}`
                        : "market"}
                    </TableCell>
                    <TableCell>{row.condition ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Importing…" : `Import ${preview.length} items`}
            </Button>
          </CardContent>
        </Card>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {result && <p className="text-sm text-green-600">{result}</p>}
    </div>
  );
}
