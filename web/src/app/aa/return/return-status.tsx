"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { SyncView } from "@/lib/aa/service";

import { pollConsent } from "../actions";

const POLL_MS = 3000;
const MAX_POLLS = 60; // ~3 minutes

export function ReturnStatus({ consentId }: { consentId: string | null }) {
  const [view, setView] = useState<SyncView | null>(null);

  useEffect(() => {
    const id = consentId;
    if (!id) {
      queueMicrotask(() => setView({ status: "REJECTED", phase: "failed", message: "We couldn't tell which request this was. Open Link bank to see your consents." }));
      return;
    }
    let stop = false;
    (async () => {
      for (let i = 0; i < MAX_POLLS && !stop; i++) {
        const v = await pollConsent(id);
        if (stop) return;
        setView(v);
        if (v.phase === "imported" || v.phase === "closed" || v.phase === "failed") return;
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    })();
    return () => {
      stop = true;
    };
  }, [consentId]);

  if (!view) return <p className="text-muted">Checking with the Account Aggregator…</p>;

  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <p className={view.phase === "imported" ? "text-success" : view.phase === "failed" || view.phase === "closed" ? "text-danger" : ""}>
        {view.phase === "awaiting-approval" || view.phase === "fetching" ? "⏳ " : view.phase === "imported" ? "✓ " : ""}
        {view.message}
      </p>
      {view.summary && (
        <p className="text-sm">
          {view.summary.inserted} new transaction{view.summary.inserted === 1 ? "" : "s"} from {view.summary.accounts} account
          {view.summary.accounts === 1 ? "" : "s"}; {view.summary.duplicates} were already in PayTra (same payment from a statement or alert).
        </p>
      )}
      <div className="flex gap-3 text-sm">
        <Link href="/transactions" className="underline">
          View transactions
        </Link>
        <Link href="/aa" className="underline">
          Your consents
        </Link>
      </div>
    </div>
  );
}
