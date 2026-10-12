"use client";

import { useState, useTransition } from "react";

import { recategorise } from "./category-actions";

export function RecategoriseButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await recategorise();
            setMessage(r.ok ? (r.changed ? `${r.changed} transaction${r.changed === 1 ? "" : "s"} categorised.` : "Everything is up to date.") : r.error);
          })
        }
        className="rounded-md border border-input px-3 py-1.5 hover:bg-surface-hover disabled:opacity-50"
        title="Apply category rules to transactions you haven't categorised by hand"
      >
        {pending ? "Categorising…" : "Auto-categorise"}
      </button>
      {message && <span className="text-muted">{message}</span>}
    </span>
  );
}
