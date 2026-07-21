"use client";

import { useActionState, useEffect, useState } from "react";
import {
  ProductCombobox,
  type ProductOption,
} from "@/components/admin/product-combobox";
import { CONDITIONS } from "@/lib/conditions";
import { GRADERS, GRADES } from "@/lib/grading";
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
  printing: string | null;
  quantity: number;
  askingPrice: number | null;
  photoUrl: string | null;
  productId: number | null;
  status: "available" | "reserved" | "sold" | "hidden";
};

/** Parse a stored "PSA 10" style condition back into grader + grade. */
function parseGradedCondition(condition: string | null): {
  grader: string;
  grade: string;
} {
  if (condition) {
    const [grader, ...rest] = condition.split(" ");
    if ((GRADERS as readonly string[]).includes(grader)) {
      return { grader, grade: rest.join(" ") || "10" };
    }
  }
  return { grader: "PSA", grade: "10" };
}

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
  // Catalog-first: almost everything links to a product. Manual is the
  // exception for oddball items the catalog doesn't carry.
  const [manual, setManual] = useState(
    mode === "edit" ? item?.productId == null : false,
  );
  const [linkedOption, setLinkedOption] = useState<ProductOption | null>(
    item?.productId != null
      ? {
          id: item.productId,
          name: item.title,
          groupName: "current link",
          marketPrice: null,
        }
      : null,
  );
  const [category, setCategory] = useState<"singles" | "sealed" | "graded">(
    item?.category ?? "sealed",
  );
  const [condition, setCondition] = useState<string>(item?.condition ?? "");
  const initialGraded = parseGradedCondition(
    item?.category === "graded" ? (item?.condition ?? null) : null,
  );
  const [grader, setGrader] = useState(initialGraded.grader);
  const [grade, setGrade] = useState(initialGraded.grade);

  useEffect(() => {
    if (!state.success) return;
    const timer = setTimeout(() => setOpen(false), 0);
    return () => clearTimeout(timer);
  }, [state.success]);

  const conditionOptions =
    category === "sealed" ? CONDITIONS.sealed : CONDITIONS.singles;
  const effectiveCondition =
    category === "graded"
      ? `${grader} ${grade}`
      : condition || (conditionOptions[0]?.value ?? "");

  function pickCategory(next: "singles" | "sealed" | "graded") {
    setCategory(next);
    // Reset condition to something sensible for the new scale
    if (next !== "graded") {
      const options = next === "sealed" ? CONDITIONS.sealed : CONDITIONS.singles;
      setCondition((prev) =>
        options.some((o) => o.value === prev) ? prev : (options[0]?.value ?? ""),
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {mode === "create" ? (
          // The quick-add bar handles catalog cards; this dialog is the
          // fallback for manual/oddball items and full field control.
          <Button variant="outline">Manual / advanced</Button>
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
            value={manual ? "" : (linkedOption?.id ?? "")}
          />
          <input type="hidden" name="condition" value={effectiveCondition} />
          {!manual && (
            <input
              type="hidden"
              name="title"
              value={linkedOption?.name ?? ""}
            />
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{manual ? "Title" : "Product"}</Label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-500">
                <input
                  type="checkbox"
                  checked={manual}
                  onChange={(e) => setManual(e.target.checked)}
                />
                Manual item (not in catalog)
              </label>
            </div>
            {manual ? (
              <Input
                id="title"
                name="title"
                defaultValue={item?.title}
                placeholder="e.g. Mystery bundle, playmat, local promo…"
                required
              />
            ) : (
              <>
                <ProductCombobox
                  value={linkedOption}
                  onSelect={(opt) => {
                    setLinkedOption(opt);
                    if (opt?.category && opt.category !== "graded") {
                      pickCategory(opt.category);
                    }
                  }}
                  placeholder="Search the catalog…"
                />
                <p className="text-xs text-neutral-400">
                  Linked items track market price automatically. Selling a
                  graded copy? Pick the card, then set the category to Graded.
                </p>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                name="category"
                value={category}
                onValueChange={(v) => pickCategory(v as typeof category)}
              >
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
            <Label htmlFor="printing">Printing / edition</Label>
            <Input
              id="printing"
              name="printing"
              defaultValue={item?.printing ?? ""}
              placeholder="e.g. 1st Edition Holofoil, Unlimited (blank if N/A)"
            />
          </div>

          {/* Condition — scale follows the category */}
          {category === "graded" ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Grader</Label>
                <Select value={grader} onValueChange={setGrader}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GRADERS.map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Grade</Label>
                <Select value={grade} onValueChange={setGrade}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GRADES.map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Condition</Label>
              <Select
                value={condition || conditionOptions[0]?.value}
                onValueChange={setCondition}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {conditionOptions.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="photoUrl">Photo URL (optional)</Label>
            <Input
              id="photoUrl"
              name="photoUrl"
              type="url"
              defaultValue={item?.photoUrl ?? ""}
            />
          </div>
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          <Button
            type="submit"
            disabled={pending || (!manual && !linkedOption)}
            className="w-full"
          >
            {pending
              ? "Saving…"
              : !manual && !linkedOption
                ? "Pick a product first"
                : "Save item"}
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
