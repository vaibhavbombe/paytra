"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";

import { commitImport, confirmJob, jobStatus, previewImport, startUpload, type CommitState, type PreviewState } from "./actions";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 60_000;

type Props = { accounts: { id: string; label: string }[] };

export function ImportForm({ accounts }: Props) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  // The statement file's own password. Kept only in this component's memory
  // and sent with the request; the server uses it once and never stores it.
  const [pdfPassword, setPdfPassword] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [done, setDone] = useState<CommitState | null>(null);
  // Set when the preview came from the background worker; Import then
  // confirms that job instead of re-sending the file.
  const [jobId, setJobId] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const control = "w-full rounded-md border border-input bg-background px-3 py-2";
  const isPdf = Boolean(file && /\.pdf$/i.test(file.name));

  const formData = () => {
    const fd = new FormData();
    fd.set("accountId", accountId);
    if (file) fd.set("file", file);
    if (isPdf && pdfPassword) fd.set("pdfPassword", pdfPassword);
    return fd;
  };

  // Default path: upload straight to Cloud Storage with a short-lived signed
  // URL, then wait for the worker's preview. Password-protected PDFs use the
  // direct path instead, so the password never goes through a queue.
  async function previewViaWorker(f: File): Promise<PreviewState> {
    setStage("Uploading…");
    const start = await startUpload({ accountId, fileName: f.name, size: f.size });
    if (!start.ok) return start;

    const put = await fetch(start.url, { method: "PUT", headers: start.headers, body: f }).catch(() => null);
    if (!put?.ok) return { ok: false, error: "Upload failed. Check your connection and try again." };

    setStage("Processing…");
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const job = await jobStatus(start.jobId);
      if (job.status === "READY") {
        setJobId(start.jobId);
        return { ok: true, preview: job.preview };
      }
      if (job.status === "FAILED") return { ok: false, error: job.error, needsPassword: job.needsPassword };
      if (job.status === "EXPIRED" || job.status === "NOT_FOUND" || job.status === "COMMITTED") {
        return { ok: false, error: "This upload is no longer available. Please upload again." };
      }
    }
    return { ok: false, error: "Still processing after a minute. Please try again shortly." };
  }

  function runPreview(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setDone(null);
    setJobId(null);
    startTransition(async () => {
      const result = isPdf && pdfPassword ? await previewImport(formData()) : await previewViaWorker(file);
      setStage(null);
      setPreview(result);
    });
  }

  function runCommit() {
    startTransition(async () => {
      // Worker path: confirm the stored job. Direct path: the same file is
      // sent again and re-parsed, so nothing from the preview is trusted.
      const result = jobId ? await confirmJob(jobId) : await commitImport(formData());
      setDone(result);
      if (result.ok) {
        setPreview(null);
        setJobId(null);
        setFile(null);
        setPdfPassword("");
        if (fileInput.current) fileInput.current.value = "";
      }
    });
  }

  function reset() {
    setPreview(null);
    setDone(null);
    setJobId(null);
  }

  if (accounts.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">
        Add a bank account first on the{" "}
        <Link href="/accounts" className="underline">
          Accounts
        </Link>{" "}
        page (only its last 4 digits).
      </p>
    );
  }

  const p = preview?.ok ? preview.preview : null;
  const needsPassword = (preview && !preview.ok && preview.needsPassword) || (done && !done.ok && done.needsPassword);

  return (
    <div className="space-y-6">
      <form onSubmit={runPreview} className="space-y-4 rounded-md border border-border p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium">Account</span>
            <select
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                reset();
              }}
              className={control}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Statement (.csv or .pdf, max 1 MB)</span>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv,.pdf,application/pdf"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPdfPassword("");
                reset();
              }}
              className={`${control} file:mr-3 file:rounded file:border-0 file:bg-surface-hover file:px-2 file:py-1 file:text-foreground`}
            />
          </label>
        </div>
        {(isPdf || needsPassword) && (
          <label className="block max-w-sm space-y-1">
            <span className="text-sm font-medium">PDF password (if the file is locked)</span>
            <input
              type="password"
              value={pdfPassword}
              onChange={(e) => setPdfPassword(e.target.value)}
              maxLength={64}
              autoComplete="off"
              placeholder="e.g. date of birth or customer ID"
              aria-invalid={Boolean(needsPassword)}
              className={`${control} ${needsPassword ? "border-danger" : ""}`}
            />
            <span className="block text-xs text-muted">
              This is the statement file&apos;s password from your bank&apos;s email, <strong>not</strong> your net
              banking password. It&apos;s used once to open the file and never stored.
            </span>
          </label>
        )}
        <button
          type="submit"
          disabled={!file || !accountId || pending}
          className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
        >
          {pending && !p ? (stage ?? "Reading…") : "Preview"}
        </button>
        <p className="text-xs text-muted">
          Files go straight to a private, encrypted bucket via a 10-minute upload link, are deleted as soon as they&apos;re
          read, and nothing is saved to your transactions until you click Import. Scanned
          (image-only) PDFs can&apos;t be read yet; use the CSV download instead.
        </p>
      </form>

      {preview && !preview.ok && (
        <p role="alert" className="rounded-md border border-danger p-3 text-sm text-danger">
          {preview.error}
        </p>
      )}

      {done && (
        <p role="status" className={`rounded-md border p-3 text-sm ${done.ok ? "border-success text-success" : "border-danger text-danger"}`}>
          {done.ok
            ? `Imported ${done.inserted} new transaction${done.inserted === 1 ? "" : "s"}. ${done.duplicates} already existed and were skipped.${done.errors ? ` ${done.errors} row(s) had errors and were not imported.` : ""}`
            : done.error}
          {done.ok && (
            <>
              {" "}
              <Link href="/transactions" className="underline">
                View transactions →
              </Link>
            </>
          )}
        </p>
      )}

      {p && (
        <section className="space-y-4">
          <h2 className="text-lg font-medium">Preview: {p.fileName}</h2>

          {p.previousImport && (
            <p className="rounded-md border border-border p-3 text-sm">
              You imported this exact file on {p.previousImport}. Importing again is safe: duplicates are skipped.
            </p>
          )}

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Rows found" value={String(p.total)} />
            <Stat label="New" value={String(p.newCount)} className="text-success" />
            <Stat label="Already imported" value={String(p.duplicateCount)} />
            <Stat label="Errors" value={String(p.errors.length)} className={p.errors.length ? "text-danger" : ""} />
          </dl>

          <p className="text-sm">
            {p.period && (
              <>
                Period <span className="font-mono">{p.period.from}</span> → <span className="font-mono">{p.period.to}</span>.{" "}
              </>
            )}
            New rows add <span className="font-mono text-credit">+{p.newIn}</span> in and{" "}
            <span className="font-mono text-debit">−{p.newOut}</span> out.
          </p>

          <BalanceNote balance={p.balance} />

          {p.errors.length > 0 && (
            <details className="rounded-md border border-danger p-3 text-sm" open={p.errors.length <= 5}>
              <summary className="cursor-pointer text-danger">
                {p.errors.length} row{p.errors.length === 1 ? "" : "s"} can&apos;t be imported (they will be skipped)
              </summary>
              <ul className="mt-2 space-y-1">
                {p.errors.map((e) => (
                  <li key={e.line}>
                    Line {e.line}: {e.message}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={runCommit}
              disabled={pending || p.newCount === 0}
              className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
            >
              {pending ? "Importing…" : p.newCount === 0 ? "Nothing new to import" : `Import ${p.newCount} new transaction${p.newCount === 1 ? "" : "s"}`}
            </button>
            <button type="button" onClick={reset} className="text-sm text-muted underline">
              Cancel
            </button>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="p-2">Line</th>
                  <th className="p-2">Date</th>
                  <th className="p-2">Description</th>
                  <th className="p-2 text-right">Amount</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {p.sample.map((r) => (
                  <tr key={r.line} className={`border-b border-border last:border-0 ${r.duplicate ? "opacity-50" : ""}`}>
                    <td className="p-2 font-mono text-muted">{r.line}</td>
                    <td className="p-2 font-mono">{r.date}</td>
                    <td className="max-w-64 truncate p-2">{r.description}</td>
                    <td className={`p-2 text-right font-mono ${r.direction === "DEBIT" ? "text-debit" : "text-credit"}`}>
                      {r.direction === "DEBIT" ? "−" : "+"}
                      {r.amount}
                    </td>
                    <td className="p-2 text-xs">{r.duplicate ? "Already imported" : "New"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {p.total > p.sample.length && (
              <p className="p-2 text-xs text-muted">Showing the first {p.sample.length} of {p.total} rows.</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function BalanceNote({ balance }: { balance: NonNullable<Extract<PreviewState, { ok: true }>["preview"]>["balance"] }) {
  if (balance.status === "ok")
    return <p className="text-sm text-success">✓ Running balance check passed for all {balance.checked + 1} rows: no rows missing or misread.</p>;
  if (balance.status === "mismatch")
    return (
      <p className="rounded-md border border-danger p-3 text-sm text-danger">
        ⚠ Running balance doesn&apos;t add up at line {balance.firstBadLine}. A row may be missing or edited. Check the file before importing.
      </p>
    );
  return <p className="text-sm text-muted">Balance check not possible (the file has no closing-balance column).</p>;
}

function Stat({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-1 font-mono text-lg font-semibold ${className}`}>{value}</dd>
    </div>
  );
}
