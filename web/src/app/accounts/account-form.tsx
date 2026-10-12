"use client";

import { useState, useTransition } from "react";

import { addAccount, type AddAccountState } from "./actions";

const BANKS = ["HDFC Bank", "State Bank of India", "ICICI Bank", "Axis Bank", "Kotak Mahindra Bank", "Bank of Baroda", "Punjab National Bank", "Yes Bank", "IDFC FIRST Bank", "Canara Bank"];

export function AccountForm() {
  const [state, setState] = useState<AddAccountState>({ status: "idle" });
  const [pending, startTransition] = useTransition();
  const input = "w-full rounded-md border border-input bg-background px-3 py-2";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const result = await addAccount(data);
      setState(result);
      if (result.status === "saved") form.reset();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-md border border-border p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Bank</span>
          <input name="institutionName" list="banks" required maxLength={60} placeholder="HDFC Bank" className={input} />
          <datalist id="banks">
            {BANKS.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Type</span>
          <select name="type" defaultValue="SAVINGS" className={input}>
            <option value="SAVINGS">Savings account</option>
            <option value="CURRENT">Current account</option>
            <option value="CREDIT_CARD">Credit card</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Last 4 digits</span>
          <input
            name="last4"
            required
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            autoComplete="off"
            placeholder="4821"
            className={input}
          />
          <span className="block text-xs text-muted">Only the last 4 digits. Never enter your full account number.</span>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Nickname (optional)</span>
          <input name="nickname" maxLength={40} placeholder="Salary account" className={input} />
        </label>
      </div>
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
        >
          {pending ? "Saving…" : "Add account"}
        </button>
        {state.status !== "idle" && (
          <p role="status" className={`text-sm ${state.status === "error" ? "text-danger" : "text-success"}`}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
