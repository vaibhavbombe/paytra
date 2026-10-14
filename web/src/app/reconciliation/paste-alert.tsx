"use client";

import { useState, useTransition } from "react";

import { previewAlert, saveAlert, type AlertPreview } from "./actions";

type Props = { accounts: { id: string; label: string }[] };

export function PasteAlert({ accounts }: Props) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<AlertPreview | null>(null);
  const [accountId, setAccountId] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const control = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

  function check() {
    setMessage(null);
    startTransition(async () => {
      const p = await previewAlert(text);
      setPreview(p);
      if (p.ok) setAccountId(p.suggestedAccountId ?? accounts[0]?.id ?? "");
    });
  }

  function save() {
    startTransition(async () => {
      const r = await saveAlert(text, accountId);
      setMessage(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      if (r.ok) {
        setText("");
        setPreview(null);
      }
    });
  }

  if (accounts.length === 0) return <p className="text-sm text-muted">Add a bank account first (Accounts page).</p>;

  const p = preview?.ok ? preview : null;
  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <label className="block space-y-1">
        <span className="text-sm font-medium">Bank alert (email or SMS text)</span>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
          }}
          rows={3}
          maxLength={2000}
          placeholder="e.g. Rs.450.00 has been debited from account **4821 to VPA swiggy@ybl SWIGGY on 02-10-26. Your UPI transaction reference number is 428512345678."
          className={control}
        />
      </label>
      <p className="text-xs text-muted">Only the amount, date, payee name, reference and account digits are kept. Never paste OTPs.</p>
      <button
        type="button"
        onClick={check}
        disabled={pending || text.trim().length < 10}
        className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-surface-hover disabled:opacity-50"
      >
        {pending && !p ? "Reading…" : "Read alert"}
      </button>

      {preview && !preview.ok && <p className="text-sm text-danger">{preview.error}</p>}

      {p && (
        <div className="space-y-3 rounded-md bg-surface-hover p-3 text-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted">Amount</dt>
              <dd className={`font-mono ${p.direction === "DEBIT" ? "text-debit" : "text-credit"}`}>
                {p.direction === "DEBIT" ? "−" : "+"}
                {p.amount}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Date</dt>
              <dd className="font-mono">{p.date ?? "not found (today)"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Payee</dt>
              <dd>{p.payee ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Reference</dt>
              <dd className="font-mono">{p.reference ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Bank</dt>
              <dd>{p.bank ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Account in alert</dt>
              <dd className="font-mono">{p.accountLast ? `••${p.accountLast}` : "—"}</dd>
            </div>
          </dl>
          <label className="block max-w-sm space-y-1">
            <span className="text-xs text-muted">Save to account</span>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={control}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={save}
            disabled={pending || !accountId}
            className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save & reconcile"}
          </button>
        </div>
      )}

      {message && <p className={`text-sm ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</p>}
    </div>
  );
}
