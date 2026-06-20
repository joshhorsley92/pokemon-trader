"use client";

import { useRef } from "react";
import { setCategoryOverride } from "./actions";

export function OverrideSelect({
  productId,
  value,
}: {
  productId: number;
  value: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={setCategoryOverride}>
      <input type="hidden" name="productId" value={productId} />
      <select
        name="override"
        defaultValue={value ?? "none"}
        className="h-8 rounded-md border bg-white px-1 text-sm"
        onChange={() => formRef.current?.requestSubmit()}
      >
        <option value="none">—</option>
        <option value="sealed">sealed</option>
        <option value="singles">singles</option>
        <option value="graded">graded</option>
      </select>
    </form>
  );
}
