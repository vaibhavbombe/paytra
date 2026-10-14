"use client";

import { useState, useTransition } from "react";

import { acceptMatch } from "./actions";

export function ConfirmMatchButton({ alertId, bookId }: { alertId: string; bookId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await acceptMatch(alertId, bookId);
            if (!r.ok) setError(r.error ?? "Couldn't merge.");
          })
        }
        className="rounded-md border border-input px-2.5 py-1 text-xs hover:bg-surface-hover disabled:opacity-50"
      >
        {pending ? "Merging…" : "Confirm match"}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
