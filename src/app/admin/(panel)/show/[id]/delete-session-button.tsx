"use client";

import { deleteShowSession } from "../actions";

export function DeleteSessionButton({ sessionId }: { sessionId: string }) {
  return (
    <form
      action={deleteShowSession}
      onSubmit={(e) => {
        if (
          !confirm(
            "Delete this session for good? Its transactions are removed and any inventory it added/sold is reversed. This cannot be undone.",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="sessionId" value={sessionId} />
      <button
        type="submit"
        className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
      >
        Delete session
      </button>
    </form>
  );
}
