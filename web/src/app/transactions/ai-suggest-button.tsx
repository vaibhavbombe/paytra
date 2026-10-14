"use client";

import { useState, useTransition } from "react";

import { aiSuggestCategories } from "./category-actions";

export function AiSuggestButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-sm">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await aiSuggestCategories();
            if (!r.ok) return setMessage(r.error);
            const { payeesSent, categorised, unsure, leftOver } = r.result;
            setMessage(
              payeesSent === 0
                ? "Nothing uncategorised to ask about."
                : `${categorised} transaction${categorised === 1 ? "" : "s"} categorised from ${payeesSent} payee${payeesSent === 1 ? "" : "s"}` +
                    (unsure ? `; ${unsure} left for you (AI wasn't sure)` : "") +
                    (leftOver ? `; ${leftOver} more payees, click again` : "") +
                    ".",
            );
          })
        }
        className="rounded-md border border-input px-3 py-1.5 hover:bg-surface-hover disabled:opacity-50"
        title="Sends only payee names and money in/out (no amounts, no account details) to Google Gemini. Development free tier: use with mock data only."
      >
        {pending ? "Asking AI…" : "Suggest with AI"}
      </button>
      {message && <span className="text-muted">{message}</span>}
    </span>
  );
}
