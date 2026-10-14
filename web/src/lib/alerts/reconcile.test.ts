import { describe, expect, it } from "vitest";

import { payeeSimilarity, reconcile, scorePair, type RecTxn } from "./reconcile";

const ACC = "acc-hdfc";
let n = 0;
const t = (p: Partial<RecTxn> & Pick<RecTxn, "amountPaise" | "txnDate">): RecTxn => ({
  id: `t${++n}`,
  accountId: ACC,
  direction: "DEBIT",
  reference: null,
  payee: null,
  ...p,
});

describe("scorePair", () => {
  it("exact when both references agree, even a few days apart", () => {
    expect(scorePair(t({ amountPaise: 45000n, txnDate: "2026-10-02", reference: "428512345678" }), t({ amountPaise: 45000n, txnDate: "2026-10-04", reference: "0000428512345678" })))
      .toMatchObject({ confidence: "EXACT", dayDiff: 2 });
  });

  it("never matches when both references exist and differ", () => {
    expect(scorePair(t({ amountPaise: 45000n, txnDate: "2026-10-02", reference: "428512345678" }), t({ amountPaise: 45000n, txnDate: "2026-10-02", reference: "428599999999" }))).toBeNull();
  });

  it("requires same amount (to the paisa), direction and account", () => {
    const a = t({ amountPaise: 45000n, txnDate: "2026-10-02" });
    expect(scorePair(a, t({ amountPaise: 45001n, txnDate: "2026-10-02" }))).toBeNull();
    expect(scorePair(a, t({ amountPaise: 45000n, txnDate: "2026-10-02", direction: "CREDIT" }))).toBeNull();
    expect(scorePair(a, t({ amountPaise: 45000n, txnDate: "2026-10-02", accountId: "acc-sbi" }))).toBeNull();
  });

  it("probable within the 2-day window, not beyond", () => {
    const a = t({ amountPaise: 45000n, txnDate: "2026-10-02" });
    expect(scorePair(a, t({ amountPaise: 45000n, txnDate: "2026-10-04" }))).toMatchObject({ confidence: "PROBABLE", dayDiff: 2 });
    expect(scorePair(a, t({ amountPaise: 45000n, txnDate: "2026-10-05" }))).toBeNull();
  });

  it("an alert with an unknown account can still match on the other evidence", () => {
    expect(scorePair(t({ amountPaise: 45000n, txnDate: "2026-10-02", accountId: null, reference: "428512345678" }), t({ amountPaise: 45000n, txnDate: "2026-10-02", reference: "428512345678" })))
      .toMatchObject({ confidence: "EXACT" });
  });
});

describe("payeeSimilarity", () => {
  it("compares normalised words", () => {
    expect(payeeSimilarity("Swiggy", "SWIGGY")).toBe(1);
    expect(payeeSimilarity("Amazon Pay In", "AMAZON PAY")).toBeCloseTo(2 / 3);
    expect(payeeSimilarity("Zomato", "Swiggy")).toBe(0);
    expect(payeeSimilarity(null, "Swiggy")).toBe(0);
  });
});

describe("reconcile", () => {
  it("matches exact, probable, leaves the rest, one-to-one", () => {
    const alerts = [
      t({ id: "A-swiggy", amountPaise: 45000n, txnDate: "2026-10-02", reference: "428512345678", payee: "Swiggy" }),
      t({ id: "A-amazon", amountPaise: 129900n, txnDate: "2026-10-10", payee: "Amazon Pay In" }), // no ref
      t({ id: "A-cab", amountPaise: 23000n, txnDate: "2026-10-11", payee: "Uber" }), // not in statement yet
    ];
    const book = [
      t({ id: "B-swiggy", amountPaise: 45000n, txnDate: "2026-10-02", reference: "0000428512345678", payee: "Swiggy" }),
      t({ id: "B-amazon", amountPaise: 129900n, txnDate: "2026-10-11", payee: "Amazon Pay In" }),
      t({ id: "B-emi", amountPaise: 1250000n, txnDate: "2026-10-03", payee: "Bajaj Finance Ltd" }), // no alert came
    ];
    const r = reconcile(alerts, book);
    expect(r.matched.map((m) => [m.alert.id, m.book.id, m.confidence])).toEqual([
      ["A-swiggy", "B-swiggy", "EXACT"],
      ["A-amazon", "B-amazon", "PROBABLE"],
    ]);
    expect(r.onlyAlert.map((x) => x.id)).toEqual(["A-cab"]);
    expect(r.onlyBook.map((x) => x.id)).toEqual(["B-emi"]);
    expect(r.ambiguous).toEqual([]);
  });

  it("two identical ₹20 chai payments: each alert gets its own statement row", () => {
    const alerts = [t({ id: "A1", amountPaise: 2000n, txnDate: "2026-10-05" }), t({ id: "A2", amountPaise: 2000n, txnDate: "2026-10-06" })];
    const book = [t({ id: "B1", amountPaise: 2000n, txnDate: "2026-10-05" }), t({ id: "B2", amountPaise: 2000n, txnDate: "2026-10-06" })];
    const r = reconcile(alerts, book);
    expect(r.matched.map((m) => [m.alert.id, m.book.id]).sort()).toEqual([
      ["A1", "B1"],
      ["A2", "B2"],
    ]);
  });

  it("flags genuinely ambiguous cases instead of guessing", () => {
    // One alert, two equally good statement rows (same amount, same date, no refs, no payee).
    const r = reconcile([t({ id: "A", amountPaise: 50000n, txnDate: "2026-10-07" })], [t({ id: "B1", amountPaise: 50000n, txnDate: "2026-10-07" }), t({ id: "B2", amountPaise: 50000n, txnDate: "2026-10-07" })]);
    expect(r.matched).toEqual([]);
    expect(r.ambiguous.map((a) => [a.alert.id, a.candidates.map((c) => c.id).sort()])).toEqual([["A", ["B1", "B2"]]]);
    expect(r.onlyBook.map((b) => b.id).sort()).toEqual(["B1", "B2"]);
  });

  it("a reference match wins over a closer date without reference", () => {
    const alert = t({ id: "A", amountPaise: 30000n, txnDate: "2026-10-08", reference: "428500000001" });
    const book = [t({ id: "B-near", amountPaise: 30000n, txnDate: "2026-10-08" }), t({ id: "B-ref", amountPaise: 30000n, txnDate: "2026-10-09", reference: "428500000001" })];
    expect(reconcile([alert], book).matched[0].book.id).toBe("B-ref");
  });
});
