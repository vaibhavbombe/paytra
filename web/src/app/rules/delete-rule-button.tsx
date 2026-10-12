"use client";

import { useTransition } from "react";

import { deleteRule } from "../transactions/category-actions";

export function DeleteRuleButton({ ruleId }: { ruleId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(async () => void (await deleteRule(ruleId)))}
      className="shrink-0 rounded-md border border-input px-2.5 py-1 text-xs hover:bg-surface-hover disabled:opacity-50"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}
