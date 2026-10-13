"use client";

import { useState, useTransition } from "react";

import { addBudget } from "./actions";

type Props = { categories: { id: string; name: string }[] };

export function BudgetForm({ categories }: Props) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const control = "w-full rounded-md border border-input bg-background px-3 py-2";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const r = await addBudget(data);
      setMessage(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      if (r.ok) form.reset();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-md border border-border p-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium">For</span>
          <select name="categoryId" defaultValue="" className={control}>
            <option value="">Overall (all spending)</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Period</span>
          <select name="period" defaultValue="MONTHLY" className={control}>
            <option value="MONTHLY">Monthly</option>
            <option value="WEEKLY">Weekly (Mon–Sun)</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Limit (₹)</span>
          <input name="amount" inputMode="decimal" required placeholder="5,000" autoComplete="off" className={control} />
        </label>
      </div>
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
        >
          {pending ? "Saving…" : "Add budget"}
        </button>
        {message && (
          <p role="status" className={`text-sm ${message.ok ? "text-success" : "text-danger"}`}>
            {message.text}
          </p>
        )}
      </div>
      <p className="text-xs text-muted">You&apos;ll get an alert at 80% and at 100% of the limit, once each per period.</p>
    </form>
  );
}
