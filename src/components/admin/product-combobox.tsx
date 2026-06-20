"use client";

import { useEffect, useRef, useState } from "react";

export type ProductOption = {
  id: number;
  name: string;
  groupName: string;
  marketPrice: number | null;
};

/**
 * Product picker that behaves like a select: a button with a chevron opens a
 * dropdown immediately (top products by value) and filters as you type.
 */
export function ProductCombobox({
  value,
  onSelect,
  placeholder = "Choose a product…",
}: {
  value: ProductOption | null;
  onSelect: (product: ProductOption | null) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch on open and as the query changes (empty query returns a default list)
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/catalog/search?q=${encodeURIComponent(query)}`,
        );
        if (res.ok) setOptions((await res.json()).results);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [open, query]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => {
            if (!o) setTimeout(() => inputRef.current?.focus(), 0);
            return !o;
          });
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-white px-3 text-sm shadow-xs hover:bg-neutral-50"
      >
        <span className={`truncate text-left ${value ? "" : "text-neutral-400"}`}>
          {value ? (
            <>
              {value.name}
              <span className="ml-1 text-neutral-400">({value.groupName})</span>
            </>
          ) : (
            placeholder
          )}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-md border bg-white shadow-lg">
          <div className="border-b p-2">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type to filter…"
              className="h-8 w-full rounded border px-2 text-sm outline-none focus:ring-2 focus:ring-neutral-300"
            />
          </div>
          <ul role="listbox" className="max-h-64 overflow-auto py-1 text-sm">
            {loading && options.length === 0 && (
              <li className="px-3 py-2 text-neutral-400">Loading…</li>
            )}
            {!loading && options.length === 0 && (
              <li className="px-3 py-2 text-neutral-400">No matches.</li>
            )}
            {options.map((opt) => (
              <li key={opt.id} role="option" aria-selected={value?.id === opt.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(opt);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-neutral-100 ${
                    value?.id === opt.id ? "bg-neutral-50 font-medium" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block leading-snug">{opt.name}</span>
                    <span className="block text-xs text-neutral-400">
                      {opt.groupName}
                    </span>
                  </span>
                  {opt.marketPrice !== null && (
                    <span className="shrink-0 tabular-nums text-neutral-500">
                      ${opt.marketPrice.toFixed(2)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
