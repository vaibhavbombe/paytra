// Reconciliation: the same payment reported by an ALERT (email/SMS) and by a
// BOOK source (bank statement CSV/PDF, Account Aggregator) must be recognised
// as ONE transaction. Classic bank reconciliation, with rules that never guess:
//
//   hard requirements  same account, same direction, exactly the same amount
//   exact match        both sides carry a reference (UPI RRN / UTR) and they agree
//   no match           both carry a reference and they DIFFER (different payments)
//   probable match     no reference on one side, dates within 2 days,
//                      scored by date closeness and payee similarity
//   ambiguous          two or more equally good candidates: flagged, never auto-picked
//
// One-to-one: a book row can absorb at most one alert. Exact matches are
// assigned first, then probables best-score first. Pure; amounts in paise.

import { normaliseKey } from "@/lib/categorise/engine";

export type RecTxn = {
  id: string;
  accountId: string | null; // null when an alert's account couldn't be resolved
  direction: "DEBIT" | "CREDIT";
  amountPaise: bigint;
  txnDate: string; // YYYY-MM-DD
  reference: string | null;
  payee: string | null;
};

export type Confidence = "EXACT" | "PROBABLE";

export type Match = { alert: RecTxn; book: RecTxn; confidence: Confidence; dayDiff: number; score: number };

export type Reconciliation = {
  matched: Match[];
  ambiguous: { alert: RecTxn; candidates: RecTxn[] }[];
  onlyAlert: RecTxn[];
  onlyBook: RecTxn[];
};

export const DATE_WINDOW_DAYS = 2;

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
const normRef = (r: string | null) => (r ? r.replace(/^0+/, "").toUpperCase() : null);

/** Token overlap of normalised payee names, 0..1 (Jaccard). */
export function payeeSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const A = new Set(normaliseKey(a).split(" ").filter((w) => w.length > 1));
  const B = new Set(normaliseKey(b).split(" ").filter((w) => w.length > 1));
  if (!A.size || !B.size) return 0;
  const inter = [...A].filter((w) => B.has(w)).length;
  return inter / new Set([...A, ...B]).size;
}

/** How well `book` matches `alert`, or null if it can't be the same payment. */
export function scorePair(alert: RecTxn, book: RecTxn): { confidence: Confidence; score: number; dayDiff: number } | null {
  if (alert.direction !== book.direction || alert.amountPaise !== book.amountPaise) return null;
  if (alert.accountId && book.accountId && alert.accountId !== book.accountId) return null;

  const dayDiff = Math.abs(day(alert.txnDate) - day(book.txnDate));
  const ra = normRef(alert.reference);
  const rb = normRef(book.reference);

  if (ra && rb) {
    // References are the strongest evidence either way.
    return ra === rb ? { confidence: "EXACT", score: 1000 - dayDiff, dayDiff } : null;
  }
  if (dayDiff > DATE_WINDOW_DAYS) return null;
  // Closer dates first; payee similarity breaks ties (0..10 points).
  const score = 100 - dayDiff * 20 + Math.round(payeeSimilarity(alert.payee, book.payee) * 10);
  return { confidence: "PROBABLE", score, dayDiff };
}

export function reconcile(alerts: RecTxn[], book: RecTxn[]): Reconciliation {
  type Pair = { alert: RecTxn; book: RecTxn; confidence: Confidence; score: number; dayDiff: number };
  const pairs: Pair[] = [];
  for (const a of alerts) for (const b of book) {
    const s = scorePair(a, b);
    if (s) pairs.push({ alert: a, book: b, ...s });
  }
  // Exact (score >= 1000) before probable; within each, best score first.
  pairs.sort((x, y) => y.score - x.score || x.alert.id.localeCompare(y.alert.id) || x.book.id.localeCompare(y.book.id));

  const usedAlert = new Set<string>();
  const usedBook = new Set<string>();
  const matched: Match[] = [];
  const ambiguous: Reconciliation["ambiguous"] = [];

  for (const p of pairs) {
    if (usedAlert.has(p.alert.id) || usedBook.has(p.book.id)) continue;

    if (p.confidence === "PROBABLE") {
      // Is there another still-free book row that's just as good? Then don't guess.
      const rivals = pairs.filter(
        (q) => q.alert.id === p.alert.id && q.book.id !== p.book.id && !usedBook.has(q.book.id) && q.score === p.score,
      );
      if (rivals.length) {
        ambiguous.push({ alert: p.alert, candidates: [p.book, ...rivals.map((r) => r.book)] });
        usedAlert.add(p.alert.id);
        continue;
      }
    }
    matched.push({ alert: p.alert, book: p.book, confidence: p.confidence, dayDiff: p.dayDiff, score: p.score });
    usedAlert.add(p.alert.id);
    usedBook.add(p.book.id);
  }

  return {
    matched,
    ambiguous,
    onlyAlert: alerts.filter((a) => !usedAlert.has(a.id)),
    onlyBook: book.filter((b) => !usedBook.has(b.id)),
  };
}
