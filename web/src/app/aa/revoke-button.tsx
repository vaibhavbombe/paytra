"use client";

import { useState, useTransition } from "react";

import { revoke } from "./actions";

export function RevokeButton({ consentId, canDelete }: { consentId: string; canDelete: boolean }) {
  const [deleteData, setDeleteData] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      {canDelete && (
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={deleteData} onChange={(e) => setDeleteData(e.target.checked)} />
          Also delete the transactions fetched with it
        </label>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm(deleteData ? "Revoke this consent and delete the transactions fetched with it?" : "Revoke this consent?")) return;
          startTransition(async () => setMessage((await revoke(consentId, deleteData)).message));
        }}
        className="rounded-md border border-danger px-3 py-1 text-danger hover:bg-surface-hover disabled:opacity-50"
      >
        {pending ? "Revoking…" : "Revoke"}
      </button>
      {message && <span className="text-muted">{message}</span>}
    </div>
  );
}
