"use client";

import { useTransition } from "react";

import { removeBudget } from "./actions";

export function DeleteBudgetButton({ budgetId, name }: { budgetId: string; name: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Delete ${name} budget`}
      onClick={() => {
        if (confirm(`Delete the ${name} budget? Its alerts are deleted too.`)) {
          startTransition(async () => void (await removeBudget(budgetId)));
        }
      }}
      className="rounded-md border border-input px-2.5 py-1 text-xs hover:bg-surface-hover disabled:opacity-50"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}
