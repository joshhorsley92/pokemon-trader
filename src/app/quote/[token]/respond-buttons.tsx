"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RespondButtons({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function respond(action: "accept" | "decline") {
    if (
      action === "decline" &&
      !confirm("Decline the counter-offer? This ends this trade proposal.")
    ) {
      return;
    }
    setPending(action);
    setError(null);
    try {
      const res = await fetch("/api/submissions/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong — try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network problem — please try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mt-5 border-t border-dashed border-neutral-300 pt-4 text-center">
      <p className="text-xs font-semibold uppercase text-neutral-500">
        Does the new deal work for you?
      </p>
      <div className="mt-3 flex justify-center gap-3">
        <button
          type="button"
          onClick={() => respond("accept")}
          disabled={pending !== null}
          className="rounded-md bg-[var(--felt)] px-5 py-2 font-display text-base font-semibold text-white shadow transition-transform hover:-translate-y-0.5 disabled:opacity-50"
        >
          {pending === "accept" ? "Sending…" : "🤝 Accept the deal"}
        </button>
        <button
          type="button"
          onClick={() => respond("decline")}
          disabled={pending !== null}
          className="rounded-md border border-neutral-300 px-5 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
        >
          {pending === "decline" ? "Sending…" : "No thanks"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
