"use client";

import { useState, useTransition } from "react";

import { aiSuggestCategories } from "./category-actions";

export function AiSuggestButton() {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function run() {
    startTransition(async () => {
      const r = await aiSuggestCategories(agreed);
      setOpen(false);
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
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-sm">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setMessage(null);
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        className="rounded-md border border-input px-3 py-1.5 hover:bg-surface-hover disabled:opacity-50"
      >
        {pending ? "Asking AI…" : "Suggest with AI"}
      </button>
      {message && <span className="text-muted">{message}</span>}
      {open && (
        <span className="block w-full max-w-xl space-y-2 rounded-md border border-border p-3">
          <span className="block">
            PayTra will send the <strong>payee names</strong> of your uncategorised transactions and whether money went
            in or out to <strong>Google Gemini</strong>. No amounts, dates or account details are sent.
          </span>
          <span className="block text-xs text-muted">
            This demo uses the Gemini API free tier, where Google may use what is sent to improve its products. Use it
            only with mock data, not your real bank transactions.
          </span>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
            <span>I understand, and my transactions here are mock data.</span>
          </label>
          <button
            type="button"
            disabled={!agreed || pending}
            onClick={run}
            className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
          >
            Send to AI
          </button>
        </span>
      )}
    </span>
  );
}
