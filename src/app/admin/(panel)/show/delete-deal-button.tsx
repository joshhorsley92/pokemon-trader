"use client";

import { deleteDealAction } from "./actions";

/**
 * Small ✕ to delete a mistaken trade from history. Lives inside the deal's
 * <summary>, so it stops click propagation (otherwise the click would just
 * toggle the details open/closed) and confirms before firing.
 */
export function DeleteDealButton({
  sessionId,
  dealId,
}: {
  sessionId: string;
  dealId: string;
}) {
  return (
    <form
      action={deleteDealAction}
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        if (
          !confirm(
            "Are you sure you want to delete this trade? This removes it from history and reverses any inventory it added or drew down. This can't be undone.",
          )
        ) {
          e.preventDefault();
        }
      }}
      className="shrink-0"
    >
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="dealId" value={dealId} />
      <button
        type="submit"
        title="Delete this trade"
        aria-label="Delete this trade"
        className="rounded p-1 text-neutral-300 hover:bg-red-50 hover:text-red-600"
      >
        ✕
      </button>
    </form>
  );
}
