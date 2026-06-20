"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ProductCombobox,
  type ProductOption,
} from "@/components/admin/product-combobox";
import {
  addHotBuy,
  removeHotBuy,
  updateHotBuyBonus,
  type HotBuyActionState,
} from "./actions";

export function HotBuyRow({
  id,
  bonusPercent,
}: {
  id: string;
  bonusPercent: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <form action={updateHotBuyBonus} className="flex items-center gap-2">
        <input type="hidden" name="id" value={id} />
        <span className="text-sm text-neutral-500">+</span>
        <Input
          name="bonusPercent"
          type="number"
          step="0.5"
          min="0.5"
          max="100"
          defaultValue={bonusPercent}
          className="w-20"
        />
        <span className="text-sm text-neutral-500">pts</span>
        <Button type="submit" variant="outline" size="sm">
          Save
        </Button>
      </form>
      <form action={removeHotBuy}>
        <input type="hidden" name="id" value={id} />
        <Button type="submit" variant="ghost" size="sm" className="text-red-600">
          Remove
        </Button>
      </form>
    </div>
  );
}

export function AddHotBuyForm() {
  const [state, formAction, pending] = useActionState<
    HotBuyActionState,
    FormData
  >(addHotBuy, {});
  const [product, setProduct] = useState<ProductOption | null>(null);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
        <div className="space-y-2">
          <Label>Product</Label>
          <input type="hidden" name="productId" value={product?.id ?? ""} />
          <ProductCombobox value={product} onSelect={setProduct} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bonusPercent">Bonus (+ points)</Label>
          <Input
            id="bonusPercent"
            name="bonusPercent"
            type="number"
            step="0.5"
            min="0.5"
            max="100"
            placeholder="10"
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="notes">Note (optional, shown to customers)</Label>
        <Input
          id="notes"
          name="notes"
          maxLength={300}
          placeholder="e.g. Looking for 3 of these for a collector"
        />
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.success && <p className="text-sm text-green-600">Hot buy added.</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Add hot buy"}
      </Button>
    </form>
  );
}
