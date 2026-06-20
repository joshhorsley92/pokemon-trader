"use client";

import { useActionState, useEffect, useState } from "react";
import {
  ProductCombobox,
  type ProductOption,
} from "@/components/admin/product-combobox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  createItem,
  deleteItem,
  updateItem,
  type ItemActionState,
} from "./actions";

type Item = {
  id: string;
  title: string;
  category: "singles" | "sealed" | "graded";
  condition: string | null;
  quantity: number;
  askingPrice: number | null;
  photoUrl: string | null;
  productId: number | null;
  status: "available" | "reserved" | "sold" | "hidden";
};

export function ItemDialog({
  mode,
  item,
}: {
  mode: "create" | "edit";
  item?: Item;
}) {
  const [open, setOpen] = useState(false);
  const action = mode === "create" ? createItem : updateItem;
  const [state, formAction, pending] = useActionState<ItemActionState, FormData>(
    action,
    {},
  );
  const [linkedId, setLinkedId] = useState<number | null>(
    item?.productId ?? null,
  );
  const [linkedOption, setLinkedOption] = useState<ProductOption | null>(null);

  useEffect(() => {
    if (!state.success) return;
    const timer = setTimeout(() => setOpen(false), 0);
    return () => clearTimeout(timer);
  }, [state.success]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {mode === "create" ? (
          <Button>Add item</Button>
        ) : (
          <Button variant="ghost" size="sm">
            Edit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Add inventory item" : "Edit inventory item"}
          </DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          {item && <input type="hidden" name="id" value={item.id} />}
          <input
            type="hidden"
            name="productId"
            value={linkedId ?? ""}
          />
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              name="title"
              defaultValue={item?.title}
              placeholder="Phantasmal Flames Elite Trainer Box"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select name="category" defaultValue={item?.category ?? "sealed"}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sealed">Sealed</SelectItem>
                  <SelectItem value="singles">Single</SelectItem>
                  <SelectItem value="graded">Graded</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select name="status" defaultValue={item?.status ?? "available"}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="available">Available</SelectItem>
                  <SelectItem value="reserved">Reserved</SelectItem>
                  <SelectItem value="sold">Sold</SelectItem>
                  <SelectItem value="hidden">Hidden</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                name="quantity"
                type="number"
                min="0"
                defaultValue={item?.quantity ?? 1}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="askingPrice">Asking price ($)</Label>
              <Input
                id="askingPrice"
                name="askingPrice"
                type="number"
                step="0.01"
                min="0"
                defaultValue={item?.askingPrice ?? ""}
                placeholder="blank = track market"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="condition">Condition (optional)</Label>
            <Input
              id="condition"
              name="condition"
              defaultValue={item?.condition ?? ""}
              placeholder="NM, PSA 10, etc."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="photoUrl">Photo URL (optional)</Label>
            <Input
              id="photoUrl"
              name="photoUrl"
              type="url"
              defaultValue={item?.photoUrl ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label>
              Link to catalog product{" "}
              <span className="text-xs text-neutral-400">
                (enables automatic market pricing)
              </span>
            </Label>
            {linkedId && !linkedOption ? (
              <div className="flex items-center gap-2 text-sm">
                <span>Linked to product #{linkedId}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setLinkedId(null)}
                >
                  Unlink
                </Button>
              </div>
            ) : (
              <ProductCombobox
                value={linkedOption}
                onSelect={(opt) => {
                  setLinkedOption(opt);
                  setLinkedId(opt?.id ?? null);
                }}
                placeholder="Not linked — choose a product…"
              />
            )}
          </div>
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Saving…" : "Save item"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteItemButton({ id }: { id: string }) {
  return (
    <form
      action={deleteItem}
      onSubmit={(e) => {
        if (!confirm("Delete this inventory item?")) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="ghost" size="sm" className="text-red-600">
        Delete
      </Button>
    </form>
  );
}
