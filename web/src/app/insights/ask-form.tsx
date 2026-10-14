"use client";

import { useState, useTransition } from "react";

import type { InsightResult } from "@/lib/insights/service";

import { ask } from "./actions";

const EXAMPLES = [
  "How much did I spend on food last month?",
  "Where did my money go this year?",
  "Show my spending trend since January",
  "Top 5 payees in September",
  "List my Swiggy orders this month",
];

export function AskForm() {
  const [question, setQuestion] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ question: string; result: InsightResult } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const q = question;
    startTransition(async () => {
      const r = await ask(q, agreed);
      if (!r.ok) return setError(r.error);
      setResult({ question: q, result: r.result });
    });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Your question</span>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={300}
            placeholder="How much did I spend on food last month?"
            className="w-full rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setQuestion(ex)}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:bg-surface-hover"
            >
              {ex}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">
          Only your question, today&apos;s date and your category names go to Google Gemini (free tier, which may use
          them to improve Google products). Your transactions and amounts never leave PayTra: the AI only chooses
          which query to run, and PayTra calculates the answer.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
          <span>I understand, and my transactions here are mock data.</span>
        </label>
        <button
          type="submit"
          disabled={pending || !agreed || question.trim().length < 3}
          className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
        >
          {pending ? "Working it out…" : "Ask"}
        </button>
        {error && <p className="text-sm text-danger">{error}</p>}
      </form>

      {result && (
        <section className="space-y-3 rounded-md border border-border p-4" aria-live="polite">
          <p className="text-sm text-muted">&ldquo;{result.question}&rdquo;</p>
          {result.result.kind === "unsupported" ? (
            <p>{result.result.reason}</p>
          ) : (
            <>
              <p className="text-lg font-medium">{result.result.answer.headline}</p>
              <ul className="flex flex-wrap gap-2 text-xs">
                {result.result.answer.interpretation.map((i) => (
                  <li key={i} className="rounded border border-border px-2 py-0.5 text-muted">
                    {i}
                  </li>
                ))}
              </ul>
              {result.result.answer.table && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted">
                        {result.result.answer.table.columns.map((c, i, all) => (
                          <th key={c} className={`py-1 pr-4 font-normal ${i === all.length - 1 ? "text-right" : ""}`}>
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.result.answer.table.rows.map((row, ri) => (
                        <tr key={ri} className="border-b border-border last:border-0">
                          {row.map((cell, ci) => (
                            <td key={ci} className={`py-1 pr-4 ${ci === row.length - 1 ? "text-right tabular-nums" : ""}`}>
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-muted">
                Calculated by PayTra from your transactions. If the period or category above isn&apos;t what you meant,
                rephrase the question.
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
