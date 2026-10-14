"use client";

import { useState, useTransition } from "react";

import { startConsent } from "./actions";

export function ConsentForm({ from, to }: { from: string; to: string }) {
  const [mobile, setMobile] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await startConsent(mobile, agreed);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // Approval happens on the Account Aggregator's own screen, not in PayTra.
      window.location.href = r.approveUrl;
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-md border border-border p-4">
      <h2 className="text-lg font-medium">What you&apos;re agreeing to share</h2>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <Item label="Data">Bank account (savings/current) <strong>transactions</strong> and <strong>balance summary</strong>. Not your profile, PAN, address, investments or loans.</Item>
        <Item label="Period">
          {from} to {to} (last 12 months)
        </Item>
        <Item label="Why">Purpose code 102: tracking your spending and budgets in PayTra.</Item>
        <Item label="How often">Once. PayTra can&apos;t fetch again without a new consent.</Item>
        <Item label="Consent valid for">1 month, and you can revoke it any time on this page.</Item>
        <Item label="Kept">Only the transactions are saved in PayTra (same as a statement import); the raw bank data isn&apos;t stored.</Item>
      </dl>
      <p className="text-xs text-muted">
        You&apos;ll approve on the Account Aggregator&apos;s screen, not in PayTra. PayTra never sees or asks for your net
        banking password or UPI PIN. <strong>Sandbox:</strong> this uses Setu&apos;s test environment with mock bank data,
        so use a dummy mobile number (e.g. 9999999999); the test bank&apos;s OTP is 123456.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Mobile number (your Account Aggregator ID)</span>
          <input
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            maxLength={14}
            placeholder="9999999999"
            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono"
          />
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
        <span>I understand what will be shared, for what purpose and for how long.</span>
      </label>
      <button
        type="submit"
        disabled={pending || !agreed || mobile.replace(/\D/g, "").length < 10}
        className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
      >
        {pending ? "Opening Account Aggregator…" : "Continue to Account Aggregator"}
      </button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </form>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
