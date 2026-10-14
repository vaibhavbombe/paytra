"use client";

import { useState, useTransition } from "react";

import { kindFitsDirection } from "@/lib/categorise/engine";

import { setCategory } from "./category-actions";

type Category = { id: string; name: string; kind: "EXPENSE" | "INCOME" | "TRANSFER" };

type Props = {
  transactionId: string;
  direction: "DEBIT" | "CREDIT";
  categoryId: string | null;
  categoryName: string;
  source: "RULE" | "USER" | "AI" | null;
  payee: string;
  categories: Category[];
};

/** Click the category to change it; the choice is remembered for this payee. */
export function CategoryPicker({ transactionId, direction, categoryId, categoryName, source, payee, categories }: Props) {
  const [editing, setEditing] = useState(false);
  const [remember, setRemember] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Only categories that make sense for this direction.
  const options = categories.filter((c) => kindFitsDirection(c.kind, direction));

  function choose(value: string) {
    startTransition(async () => {
      const result = await setCategory({ transactionId, categoryId: value || null, remember: remember && Boolean(value) });
      if (!result.ok) {
        setNote(result.error);
        return;
      }
      setEditing(false);
      setNote(
        result.rememberedFor
          ? `Saved. "${result.rememberedFor}" will be categorised like this from now on${result.alsoUpdated ? `; ${result.alsoUpdated} similar updated` : ""}.`
          : "Saved.",
      );
    });
  }

  if (!editing) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => {
            setEditing(true);
            setNote(null);
          }}
          className="underline decoration-dotted underline-offset-2 hover:text-foreground"
          title="Change category"
        >
          {categoryName}
        </button>
        {source === "RULE" && (
          <span className="rounded border border-border px-1 text-[10px] uppercase tracking-wide" title="Set automatically by a rule">
            auto
          </span>
        )}
        {source === "AI" && (
          <span className="rounded border border-border px-1 text-[10px] uppercase tracking-wide" title="Suggested by AI; click to change">
            ai
          </span>
        )}
        {note && <span className="text-success">{note}</span>}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <select
        autoFocus
        disabled={pending}
        defaultValue={categoryId ?? ""}
        onChange={(e) => choose(e.target.value)}
        aria-label={`Category for ${payee}`}
        className="rounded border border-input bg-background px-1 py-0.5 text-xs"
      >
        <option value="">Uncategorised</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <label className="inline-flex items-center gap-1">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Remember for &ldquo;{payee.slice(0, 30)}&rdquo;
      </label>
      <button type="button" onClick={() => setEditing(false)} className="underline">
        Cancel
      </button>
      {note && <span className="text-danger">{note}</span>}
    </span>
  );
}
