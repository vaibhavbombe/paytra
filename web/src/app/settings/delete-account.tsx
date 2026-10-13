"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteMyAccount } from "./actions";

export function DeleteAccount() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reauth, setReauth] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await deleteMyAccount(text);
      if (r.ok) {
        // The session cookie is already cleared; every page re-checks it.
        router.replace("/login");
        router.refresh();
        return;
      }
      setError(r.error);
      setReauth(Boolean(r.reauth));
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm">
        This permanently deletes your PayTra account and <strong>everything</strong> in it: accounts, transactions,
        imports, rules, budgets, alerts and devices, plus your sign-in. It can&apos;t be undone. Download your data first
        if you want a copy.
      </p>
      <label className="block max-w-xs space-y-1">
        <span className="text-sm">
          Type <span className="font-mono font-semibold">DELETE</span> to confirm
        </span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono"
        />
      </label>
      <button
        type="submit"
        disabled={pending || text !== "DELETE"}
        className="rounded-md border border-danger px-4 py-2 text-sm font-medium text-danger hover:bg-surface-hover disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Delete my account and data"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
          {reauth && " Use Sign out on the Dashboard, sign in again, then come back here."}
        </p>
      )}
    </form>
  );
}
