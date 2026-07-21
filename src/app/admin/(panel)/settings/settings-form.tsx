"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CONDITIONS, type ConditionMultipliers } from "@/lib/conditions";
import type { AnalyzerEconomics } from "@/lib/analyzer/engine";
import type { LowValueTier } from "@/lib/pricing";
import { saveSettings, type SettingsState } from "./actions";

type Defaults = {
  shop_name: string;
  quote_validity_days: number;
  notify_emails: string;
  rounding_step: number;
  fallback_percentage: number;
  min_item_price: number;
  min_single_price: number;
  bulk_rate_per_thousand: number;
  inventory_market_markup: number;
  manual_review_threshold: number;
};

const FIELDS: {
  key: keyof Defaults;
  label: string;
  help: string;
  type?: string;
  step?: string;
}[] = [
  {
    key: "shop_name",
    label: "Shop name",
    help: "Shown on the public pages, deal slips, and emails.",
  },
  {
    key: "notify_emails",
    label: "Notification emails",
    help: "Comma-separated. Each gets an email when a trade comes in.",
  },
  {
    key: "quote_validity_days",
    label: "Quote validity (days)",
    help: "How long a submitted quote is honored.",
    type: "number",
  },
  {
    key: "rounding_step",
    label: "Credit rounding step ($)",
    help: "Credits round down to this step, e.g. 0.25.",
    type: "number",
    step: "0.05",
  },
  {
    key: "fallback_percentage",
    label: "Fallback percentage",
    help: "Used when no pricing rule matches an item.",
    type: "number",
    step: "0.5",
  },
  {
    key: "min_item_price",
    label: "Minimum item price ($)",
    help: "Sealed/other items below this market price are hidden from the public trade builder (filters out code cards etc.).",
    type: "number",
    step: "0.5",
  },
  {
    key: "min_single_price",
    label: "Minimum single-card price ($)",
    help: "Singles below this market price are hidden from the public trade builder — keeps customers from trading in low-value bulk commons.",
    type: "number",
    step: "0.5",
  },
  {
    key: "bulk_rate_per_thousand",
    label: "Bulk rate ($ per 1,000 cards)",
    help: "What list imports pay for singles below the minimum — typical range $5–10 per thousand. Customers see this as a single bulk-lot line.",
    type: "number",
    step: "0.5",
  },
  {
    key: "inventory_market_markup",
    label: "Inventory market markup (multiplier)",
    help: 'Multiplier on market price for inventory without a fixed asking price — 1.0 = market, 1.25 = market +25%. SAME setting as the Inventory tab\'s "market + %" control (that one takes a percent; this takes the raw multiplier).',
    type: "number",
    step: "0.05",
  },
  {
    key: "manual_review_threshold",
    label: "Team-quote cap ($ payout)",
    help: "Any single trade-in line whose per-unit credit/cash payout reaches this is flagged for a team member to finalize by hand. The customer still sees the calculator's estimate as a ballpark. Set 0 to disable.",
    type: "number",
    step: "50",
  },
];

// Buylist analyzer economics — field names map 1:1 to AnalyzerEconomics keys
const ANALYZER_FIELDS: {
  key: keyof AnalyzerEconomics;
  label: string;
  help: string;
  step: string;
}[] = [
  {
    key: "tcg_fee_pct",
    label: "TCGplayer fee (%)",
    help: "Marketplace + payment processing, percent of sale.",
    step: "0.05",
  },
  {
    key: "tcg_fixed_per_order",
    label: "TCGplayer fixed fee ($/order)",
    help: "Flat payment-processing fee per order.",
    step: "0.05",
  },
  {
    key: "tcg_materials_per_order",
    label: "Materials ($/order)",
    help: "Sleeve, toploader, envelope, label.",
    step: "0.05",
  },
  {
    key: "tcg_labor_per_order",
    label: "Labor ($/order)",
    help: "Your time to list, pull, and pack one order.",
    step: "0.05",
  },
  {
    key: "tcg_cards_per_order",
    label: "Cards per TCG order",
    help: "Average cards per sale — order costs are split across these. 1 = conservative.",
    step: "1",
  },
  {
    key: "buylist_shipping_flat",
    label: "Buylist shipping ($/batch)",
    help: "Cost to ship one batch to a vendor, split across that batch's cards.",
    step: "0.25",
  },
  {
    key: "buylist_min_offer",
    label: "Buylist minimum offer ($)",
    help: "Vendor offers below this are ignored entirely.",
    step: "0.05",
  },
  {
    key: "bulk_market_threshold",
    label: "Bulk threshold ($)",
    help: "Cards below this market price go to bulk unless a vendor wants them.",
    step: "0.05",
  },
  {
    key: "bulk_rate_per_card",
    label: "Bulk rate ($/card)",
    help: "What bulk buyers pay per card — values the bulk pile (e.g. 0.01 = $10/1000).",
    step: "0.005",
  },
  {
    key: "high_value_flag",
    label: "High-value flag ($)",
    help: "Cards at or above this market price get a 'verify' warning.",
    step: "5",
  },
];

export function SettingsForm({
  defaults,
  conditionMultipliers,
  analyzerEconomics,
  lowValueTiers,
}: {
  defaults: Defaults;
  conditionMultipliers: ConditionMultipliers;
  analyzerEconomics: AnalyzerEconomics;
  lowValueTiers: LowValueTier[];
}) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(
    saveSettings,
    {},
  );
  const [tiers, setTiers] = useState<LowValueTier[]>(lowValueTiers);
  return (
    <Card>
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-5">
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={f.key}>{f.label}</Label>
              <Input
                id={f.key}
                name={f.key}
                type={f.type ?? "text"}
                step={f.step}
                defaultValue={String(defaults[f.key])}
              />
              <p className="text-xs text-neutral-500">{f.help}</p>
            </div>
          ))}

          <div className="space-y-3 border-t pt-4">
            <div>
              <p className="text-sm font-medium">Condition multipliers</p>
              <p className="text-xs text-neutral-500">
                Credit is multiplied by these based on the condition the
                customer selects. 1.0 = full value, 0.9 = 90%, etc.
              </p>
            </div>
            {(["sealed", "singles"] as const).map((category) => (
              <div key={category} className="space-y-1.5">
                <p className="text-xs font-semibold uppercase text-neutral-500">
                  {category}
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {CONDITIONS[category].map((c) => (
                    <div key={c.value} className="space-y-1">
                      <Label
                        htmlFor={`cm:${category}:${c.value}`}
                        className="text-xs font-normal"
                        title={c.description}
                      >
                        {c.label}
                      </Label>
                      <Input
                        id={`cm:${category}:${c.value}`}
                        name={`cm:${category}:${c.value}`}
                        type="number"
                        step="0.05"
                        min="0"
                        max="2"
                        defaultValue={
                          conditionMultipliers[category]?.[c.value] ?? 1
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-3 border-t pt-4">
            <div>
              <p className="text-sm font-medium">Low-value payout tiers</p>
              <p className="text-xs text-neutral-500">
                Fixed payouts for singles below the minimum single-card price
                — e.g. a card booking $2–2.99 pays $0.25 flat. Exact amounts:
                condition and rounding don&apos;t apply. Singles under the
                lowest tier are bulk-only.
              </p>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2 text-xs font-semibold uppercase text-neutral-500">
                <span>Market from ($)</span>
                <span>Market to ($)</span>
                <span>We pay ($)</span>
                <span className="w-16" />
              </div>
              {tiers.map((tier, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2"
                >
                  <Input
                    name={`lvt:${i}:min`}
                    type="number"
                    step="0.01"
                    min="0"
                    value={tier.min}
                    onChange={(e) =>
                      setTiers((prev) =>
                        prev.map((t, j) =>
                          j === i ? { ...t, min: Number(e.target.value) } : t,
                        ),
                      )
                    }
                  />
                  <Input
                    name={`lvt:${i}:max`}
                    type="number"
                    step="0.01"
                    min="0"
                    value={tier.max}
                    onChange={(e) =>
                      setTiers((prev) =>
                        prev.map((t, j) =>
                          j === i ? { ...t, max: Number(e.target.value) } : t,
                        ),
                      )
                    }
                  />
                  <Input
                    name={`lvt:${i}:payout`}
                    type="number"
                    step="0.05"
                    min="0"
                    value={tier.payout}
                    onChange={(e) =>
                      setTiers((prev) =>
                        prev.map((t, j) =>
                          j === i
                            ? { ...t, payout: Number(e.target.value) }
                            : t,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-16 text-red-600"
                    onClick={() =>
                      setTiers((prev) => prev.filter((_, j) => j !== i))
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setTiers((prev) => {
                    const last = prev[prev.length - 1];
                    const min = last ? Math.round((last.max + 0.01) * 100) / 100 : 2;
                    return [
                      ...prev,
                      { min, max: min + 0.99, payout: last ? last.payout : 0.25 },
                    ];
                  })
                }
              >
                + Add tier
              </Button>
              {/* Marker so the server knows tiers were submitted even if all
                  rows were removed */}
              <input type="hidden" name="lvt:present" value="1" />
            </div>
          </div>

          <div className="space-y-3 border-t pt-4">
            <div>
              <p className="text-sm font-medium">Buylist analyzer economics</p>
              <p className="text-xs text-neutral-500">
                Fee, shipping, and threshold knobs for the internal Analyzer
                (Admin → Analyzer). These never affect customer quotes.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {ANALYZER_FIELDS.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label htmlFor={`ae:${f.key}`} className="text-xs font-normal">
                    {f.label}
                  </Label>
                  <Input
                    id={`ae:${f.key}`}
                    name={`ae:${f.key}`}
                    type="number"
                    step={f.step}
                    min="0"
                    defaultValue={String(analyzerEconomics[f.key])}
                  />
                  <p className="text-xs text-neutral-400">{f.help}</p>
                </div>
              ))}
            </div>
          </div>

          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state.success && (
            <p className="text-sm text-green-600">Settings saved.</p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save settings"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
