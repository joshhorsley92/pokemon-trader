"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ProductCombobox,
  type ProductOption,
} from "@/components/admin/product-combobox";
import {
  deleteRule,
  saveRoundingMode,
  saveRule,
  updateRuleValue,
  type RuleActionState,
} from "./actions";

export function RuleRow({
  rule,
}: {
  rule: {
    id: string;
    label: string;
    percentage: number;
    flatAmount: number | null;
    notes: string | null;
  };
}) {
  const isFlat = rule.flatAmount !== null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
      <span className="min-w-0 flex-1 text-sm capitalize">
        {rule.label}
        {isFlat && (
          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium normal-case text-amber-800">
            flat $
          </span>
        )}
        {rule.notes && (
          <span className="ml-2 text-xs normal-case text-neutral-400">
            {rule.notes}
          </span>
        )}
      </span>
      <form action={updateRuleValue} className="flex items-center gap-2">
        <input type="hidden" name="id" value={rule.id} />
        <input type="hidden" name="isFlat" value={isFlat ? "1" : "0"} />
        {isFlat && <span className="text-sm text-neutral-500">$</span>}
        <Input
          name="value"
          type="number"
          step={isFlat ? "0.01" : "0.5"}
          min="0"
          max={isFlat ? "1000000" : "200"}
          defaultValue={isFlat ? rule.flatAmount! : rule.percentage}
          className="w-24"
        />
        {!isFlat && <span className="text-sm text-neutral-500">%</span>}
        <Button type="submit" variant="outline" size="sm">
          Save
        </Button>
      </form>
      <form action={deleteRule}>
        <input type="hidden" name="id" value={rule.id} />
        <Button type="submit" variant="ghost" size="sm" className="text-red-600">
          Remove
        </Button>
      </form>
    </div>
  );
}

export function RoundingControl({
  mode,
  step,
}: {
  mode: "step" | "nearest_dollar" | "up_dollar";
  step: number;
}) {
  return (
    <form action={saveRoundingMode} className="space-y-2">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="nearest"
          checked={mode === "nearest_dollar"}
          onChange={(e) => {
            const form = e.currentTarget.form!;
            (form.elements.namedItem("mode") as HTMLInputElement).value =
              e.currentTarget.checked ? "nearest_dollar" : "step";
            form.requestSubmit();
          }}
          className="mt-0.5"
        />
        <span>
          Round trade-in and cash-out values to the <b>nearest dollar</b>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="up"
          checked={mode === "up_dollar"}
          onChange={(e) => {
            const form = e.currentTarget.form!;
            (form.elements.namedItem("mode") as HTMLInputElement).value =
              e.currentTarget.checked ? "up_dollar" : "step";
            form.requestSubmit();
          }}
          className="mt-0.5"
        />
        <span>
          Round <b>up</b> to the nearest dollar
        </span>
      </label>
      <input type="hidden" name="mode" value={mode} />
      {mode === "step" && (
        <p className="text-xs text-neutral-500">
          Currently rounding down to the nearest ${step.toFixed(2)} (set under
          Settings).
        </p>
      )}
    </form>
  );
}

export function AddRuleForm({
  groups,
}: {
  groups: { id: number; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<RuleActionState, FormData>(
    saveRule,
    {},
  );
  const [scope, setScope] = useState<"category" | "set" | "product">("category");
  const [mode, setMode] = useState<"percent" | "flat">("percent");
  const [product, setProduct] = useState<ProductOption | null>(null);
  const effectiveMode = scope === "product" ? mode : "percent";

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="mode" value={effectiveMode} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Applies to</Label>
          <Select
            name="scope"
            value={scope}
            onValueChange={(v) => setScope(v as typeof scope)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="category">Category default</SelectItem>
              <SelectItem value="set">Set override</SelectItem>
              <SelectItem value="product">Product override</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {scope === "category" && (
          <div className="space-y-2">
            <Label>Category</Label>
            <Select name="category" defaultValue="sealed">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sealed">Sealed</SelectItem>
                <SelectItem value="singles">Singles</SelectItem>
                <SelectItem value="graded">Graded</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {scope === "set" && (
          <div className="space-y-2">
            <Label>Set</Label>
            <Select name="groupId">
              <SelectTrigger>
                <SelectValue placeholder="Choose a set…" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={String(g.id)}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {scope === "product" && (
          <div className="space-y-2">
            <Label>Product</Label>
            <input type="hidden" name="productId" value={product?.id ?? ""} />
            <ProductCombobox value={product} onSelect={setProduct} />
          </div>
        )}
      </div>

      {scope === "product" && (
        <div className="flex gap-2 rounded-md bg-neutral-100 p-1 text-sm sm:w-fit">
          {(
            [
              ["percent", "% of market"],
              ["flat", "Flat $ amount"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`rounded px-3 py-1 font-medium transition-colors ${
                mode === value
                  ? "bg-white shadow"
                  : "text-neutral-500 hover:text-neutral-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {effectiveMode === "flat" ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="creditFlat">Store credit — $ per unit</Label>
              <Input
                id="creditFlat"
                name="creditFlat"
                type="number"
                step="0.01"
                min="0"
                placeholder="100.00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cashFlat">Cash — $ per unit</Label>
              <Input
                id="cashFlat"
                name="cashFlat"
                type="number"
                step="0.01"
                min="0"
                placeholder="80.00"
              />
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="creditPercent">Store credit — percentage</Label>
              <Input
                id="creditPercent"
                name="creditPercent"
                type="number"
                step="0.5"
                min="0"
                max="200"
                placeholder="85"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cashPercent">Cash — percentage</Label>
              <Input
                id="cashPercent"
                name="cashPercent"
                type="number"
                step="0.5"
                min="0"
                max="200"
                placeholder="70"
              />
            </div>
          </>
        )}
      </div>
      <p className="text-xs text-neutral-500">
        Leave a field blank to skip that payout type.
        {effectiveMode === "flat" &&
          " Condition multipliers still apply to flat amounts."}
      </p>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Input id="notes" name="notes" placeholder="Why this rule exists" />
      </div>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.success && <p className="text-sm text-green-600">Rule saved.</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save rule"}
      </Button>
    </form>
  );
}
