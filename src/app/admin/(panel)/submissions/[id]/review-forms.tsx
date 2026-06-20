"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  saveCounterOffer,
  updateStatus,
  type CounterState,
} from "./actions";

export function ReviewActions({
  submissionId,
  currentStatus,
  adminNotes,
}: {
  submissionId: string;
  currentStatus: string;
  adminNotes: string | null;
}) {
  const [status, setStatus] = useState(currentStatus);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Decision</CardTitle>
        <CardDescription>
          Notes are included in the customer email when notification is on.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={updateStatus} className="space-y-4">
          <input type="hidden" name="id" value={submissionId} />
          <div className="flex flex-wrap gap-2">
            {[
              ["under_review", "Under review"],
              ["accepted", "Accept"],
              ["declined", "Decline"],
              ["completed", "Completed"],
            ].map(([value, label]) => (
              <label
                key={value}
                className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm font-medium ${
                  status === value
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "hover:bg-neutral-50"
                }`}
              >
                <input
                  type="radio"
                  name="status"
                  value={value}
                  checked={status === value}
                  onChange={() => setStatus(value)}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="adminNotes">Note to customer / internal note</Label>
            <Textarea
              id="adminNotes"
              name="adminNotes"
              rows={3}
              defaultValue={adminNotes ?? ""}
              placeholder="e.g. Accepted — bring the boxes by this weekend, or we'll send a label."
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="notify" defaultChecked />
            Email the customer about this update
          </label>
          <Button type="submit">Save decision</Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function CounterOfferForm({
  submissionId,
  lines,
}: {
  submissionId: string;
  lines: {
    lineId: string;
    productName: string;
    quantity: number;
    unitCredit: number;
    counterUnitCredit: number | null;
  }[];
}) {
  const [state, formAction, pending] = useActionState<CounterState, FormData>(
    saveCounterOffer,
    {},
  );
  const [values, setValues] = useState<Record<string, number>>(
    Object.fromEntries(
      lines.map((l) => [l.lineId, l.counterUnitCredit ?? l.unitCredit]),
    ),
  );
  const total = lines.reduce(
    (sum, l) =>
      sum + Math.round((values[l.lineId] ?? l.unitCredit) * 100) * l.quantity,
    0,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Counter-offer</CardTitle>
        <CardDescription>
          Adjust the per-unit credit on any line, then send. Sets the status to
          &quot;countered&quot;.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="id" value={submissionId} />
          <div className="space-y-2">
            {lines.map((line) => (
              <div
                key={line.lineId}
                className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2"
              >
                <input type="hidden" name="lineId" value={line.lineId} />
                <span className="min-w-0 flex-1 break-words text-sm">
                  {line.quantity}× {line.productName}
                  <span className="ml-2 text-xs text-neutral-400">
                    quoted ${line.unitCredit.toFixed(2)}/unit
                  </span>
                </span>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-neutral-500">$</span>
                  <Input
                    name="counterUnitCredit"
                    type="number"
                    step="0.01"
                    min="0"
                    value={values[line.lineId] ?? line.unitCredit}
                    onChange={(e) =>
                      setValues((prev) => ({
                        ...prev,
                        [line.lineId]: Number(e.target.value),
                      }))
                    }
                    className="w-28"
                  />
                  <span className="text-xs text-neutral-400">/unit</span>
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="counter-notes">Why the change?</Label>
            <Textarea
              id="counter-notes"
              name="adminNotes"
              rows={2}
              placeholder="e.g. Market dipped on this box since you quoted — here's our best number."
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="notify" defaultChecked />
              Email the customer the counter-offer
            </label>
            <div className="flex items-center gap-4">
              <span className="text-sm">
                New total:{" "}
                <span className="font-semibold tabular-nums">
                  ${(total / 100).toFixed(2)}
                </span>
              </span>
              <Button type="submit" disabled={pending}>
                {pending ? "Sending…" : "Send counter-offer"}
              </Button>
            </div>
          </div>
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state.success && (
            <p className="text-sm text-green-600">Counter-offer saved.</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
