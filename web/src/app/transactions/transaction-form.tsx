"use client";

import { useRef, useState, useTransition } from "react";

import { addTransaction, type AddTransactionState } from "./actions";

type Props = {
  today: string; // YYYY-MM-DD in IST, computed on the server
  accounts: { id: string; label: string }[];
  categories: { id: string; name: string; kind: "EXPENSE" | "INCOME" | "TRANSFER" }[];
};

const KIND_LABEL = { EXPENSE: "Expense", INCOME: "Income", TRANSFER: "Transfer" } as const;

export function TransactionForm({ today, accounts, categories }: Props) {
  const [state, setState] = useState<AddTransactionState>({ status: "idle" });
  const [direction, setDirection] = useState<"DEBIT" | "CREDIT">("DEBIT");
  const [pending, startTransition] = useTransition();
  // One id per draft. Re-sent unchanged on double-click or retry, so the
  // server's UNIQUE(account_id, fingerprint) saves it exactly once.
  const requestId = useRef<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    requestId.current ??= crypto.randomUUID();
    const formData = new FormData(form);
    formData.set("requestId", requestId.current);

    startTransition(async () => {
      const result = await addTransaction(formData);
      setState(result);
      if (result.status === "saved") {
        requestId.current = null; // next entry is a new draft
        form.reset();
        setDirection("DEBIT");
      }
    });
  }

  const fieldError = (name: string) =>
    state.status === "error" ? state.fieldErrors?.[name as keyof typeof state.fieldErrors] : undefined;

  // Show only categories that make sense for the chosen direction.
  const visibleCategories = categories.filter((c) =>
    c.kind === "TRANSFER" || (direction === "DEBIT" ? c.kind === "EXPENSE" : c.kind === "INCOME"),
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-md border border-gray-200 p-4" noValidate>
      <fieldset className="flex gap-2">
        <legend className="sr-only">Direction</legend>
        {(["DEBIT", "CREDIT"] as const).map((d) => (
          <label
            key={d}
            className={`flex-1 cursor-pointer rounded-md border px-3 py-2 text-center text-sm font-medium ${
              direction === d ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300"
            }`}
          >
            <input
              type="radio"
              name="direction"
              value={d}
              checked={direction === d}
              onChange={() => setDirection(d)}
              className="sr-only"
            />
            {d === "DEBIT" ? "Money out" : "Money in"}
          </label>
        ))}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount (₹)" error={fieldError("amount")}>
          <input
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="499.00"
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2"
          />
        </Field>
        <Field label="Date" error={fieldError("txnDate")}>
          <input
            type="date"
            name="txnDate"
            defaultValue={today}
            max={today}
            min="2000-01-01"
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2"
          />
        </Field>
      </div>

      <Field label="Description" error={fieldError("description")}>
        <input
          name="description"
          maxLength={120}
          placeholder="e.g. Vegetables at local market"
          required
          className="w-full rounded-md border border-gray-300 px-3 py-2"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" error={fieldError("categoryId")}>
          <select name="categoryId" defaultValue="" className="w-full rounded-md border border-gray-300 px-3 py-2">
            <option value="">Uncategorised</option>
            {(["EXPENSE", "INCOME", "TRANSFER"] as const).map((kind) => {
              const options = visibleCategories.filter((c) => c.kind === kind);
              if (!options.length) return null;
              return (
                <optgroup key={kind} label={KIND_LABEL[kind]}>
                  {options.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </Field>
        <Field label="Account" error={fieldError("accountId")}>
          <select name="accountId" className="w-full rounded-md border border-gray-300 px-3 py-2">
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Notes (optional)" error={fieldError("notes")}>
        <textarea name="notes" maxLength={500} rows={2} className="w-full rounded-md border border-gray-300 px-3 py-2" />
      </Field>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-gray-900 px-4 py-2 font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Add transaction"}
        </button>
        {state.status !== "idle" && (
          <p role="status" className={`text-sm ${state.status === "error" ? "text-red-700" : "text-green-700"}`}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      {children}
      {error && <span className="block text-sm text-red-700">{error}</span>}
    </label>
  );
}
