import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseStatement, parseStatementDate } from "./statement";

const ACC = "0199d3a2-7c41-7b3e-9a10-5d2f4e6b8c01";
const TODAY = "2026-10-12";
const fixture = readFileSync(join(__dirname, "__fixtures__", "hdfc-style-mock.csv"), "utf8");

function parsed(text: string, account = ACC) {
  const r = parseStatement(text, account, TODAY);
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe("parseStatementDate", () => {
  it("reads day-first numeric dates (never month-first)", () => {
    expect(parseStatementDate("05/10/26")).toBe("2026-10-05");
    expect(parseStatementDate("05-10-2026")).toBe("2026-10-05");
    expect(parseStatementDate("5.1.2026")).toBe("2026-01-05");
  });

  it("reads month names and ISO", () => {
    expect(parseStatementDate("05-Oct-2026")).toBe("2026-10-05");
    expect(parseStatementDate("05 Oct 2026")).toBe("2026-10-05");
    expect(parseStatementDate("5 Sept 26")).toBe("2026-09-05");
    expect(parseStatementDate("2026-10-05")).toBe("2026-10-05");
  });

  it("rejects impossible dates instead of rolling them over", () => {
    expect(parseStatementDate("31/02/26")).toBeNull();
    expect(parseStatementDate("29/02/26")).toBeNull(); // 2026 not a leap year
    expect(parseStatementDate("29/02/28")).toBe("2028-02-29");
    expect(parseStatementDate("13/13/26")).toBeNull();
    expect(parseStatementDate("yesterday")).toBeNull();
  });
});

describe("parseStatement on the mock HDFC-style file", () => {
  const r = parsed(fixture);

  it("finds the header below the preamble and ignores the footer", () => {
    expect(r.headerLine).toBe(5);
    expect(r.rows).toHaveLength(11);
    expect(r.errors).toEqual([]);
    expect(r.period).toEqual({ from: "2026-10-01", to: "2026-10-11" });
  });

  it("parses amounts exactly into paise with the right direction", () => {
    expect(r.rows[0]).toMatchObject({ direction: "CREDIT", amountPaise: 8500000n, description: "Acme Technologies Pvt Ltd" });
    expect(r.rows[5]).toMatchObject({ direction: "DEBIT", amountPaise: 234567n, merchant: "Bigbasket", reference: "428566667777" });
  });

  it("totals match the bank's own summary line", () => {
    const sum = (d: "DEBIT" | "CREDIT") => r.rows.filter((x) => x.direction === d).reduce((a, x) => a + x.amountPaise, 0n);
    expect(sum("DEBIT")).toBe(3971267n); // 39,712.67
    expect(sum("CREDIT")).toBe(8645000n); // 86,450.00
  });

  it("passes the running-balance check", () => {
    expect(r.balance).toEqual({ status: "ok", checked: 10 });
  });

  it("keeps two genuinely identical rows as two transactions", () => {
    const charges = r.rows.filter((x) => x.description === "Service Charges");
    expect(charges).toHaveLength(2);
    expect(charges[0].fingerprint).not.toBe(charges[1].fingerprint);
  });

  it("gives every row a unique fingerprint", () => {
    expect(new Set(r.rows.map((x) => x.fingerprint)).size).toBe(r.rows.length);
  });
});

describe("idempotency", () => {
  it("the same file always produces the same fingerprints", () => {
    const a = parsed(fixture).rows.map((x) => x.fingerprint);
    const b = parsed(fixture).rows.map((x) => x.fingerprint);
    expect(b).toEqual(a);
  });

  it("an overlapping statement reuses fingerprints for the shared rows", () => {
    const lines = fixture.split("\n");
    // Second statement = only the rows from 05/10 onwards (same header).
    const later = [lines[4], ...lines.slice(8, 16)].join("\n");
    const first = new Set(parsed(fixture).rows.map((x) => x.fingerprint));
    const second = parsed(later).rows;
    expect(second.length).toBeGreaterThan(0);
    expect(second.every((x) => first.has(x.fingerprint))).toBe(true);
  });

  it("the same rows in a different account get different fingerprints", () => {
    const other = parsed(fixture, "0199d3a2-7c41-7b3e-9a10-5d2f4e6b8c99").rows[0].fingerprint;
    expect(other).not.toBe(parsed(fixture).rows[0].fingerprint);
  });
});

describe("validation and other layouts", () => {
  const header = "Date,Narration,Ref,Withdrawal Amt.,Deposit Amt.,Closing Balance";

  it("reports bad rows with line numbers and keeps the good ones", () => {
    const r = parsed(
      [
        header,
        "01/10/26,UPI-A-a@ybl-XXXX0000000-428500000001-x,1,100.00,,900.00",
        "31/02/26,bad date,2,10.00,,890.00",
        "02/10/26,both,3,10.00,5.00,895.00",
        "03/10/26,neither,4,,,895.00",
        "04/10/26,text amount,5,abc,,895.00",
        "13/10/26,future,6,1.00,,894.00",
      ].join("\n"),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5, 6, 7]);
    expect(r.errors[0].message).toMatch(/date/i);
    expect(r.errors[1].message).toMatch(/both/i);
    expect(r.errors[4].message).toMatch(/future/i);
  });

  it("detects a broken running balance (e.g. a missing row)", () => {
    const r = parsed(
      [header, "01/10/26,a,1,100.00,,900.00", "02/10/26,b,2,100.00,,700.00", "03/10/26,c,3,100.00,,600.00"].join("\n"),
    );
    expect(r.balance).toEqual({ status: "mismatch", checked: 2, firstBadLine: 3 });
  });

  it("accepts newest-first statements", () => {
    const r = parsed([header, "03/10/26,c,3,100.00,,700.00", "02/10/26,b,2,100.00,,800.00", "01/10/26,a,1,100.00,,900.00"].join("\n"));
    expect(r.balance).toEqual({ status: "ok", checked: 2 });
  });

  it("supports Amount + Dr/Cr layouts (SBI/ICICI style)", () => {
    const r = parsed(
      [
        "Txn Date,Description,Amount (INR),Dr/Cr,Balance (INR)",
        "05-Oct-2026,UPI/DR/428599990000/RAHUL SHARMA/SBIN/9876543210@ybl/Payment,250.00,DR,1750.00 Cr",
        "06-Oct-2026,Interest credit,12.50,CR,1762.50 Cr",
      ].join("\n"),
    );
    expect(r.rows.map((x) => [x.direction, x.amountPaise, x.description])).toEqual([
      ["DEBIT", 25000n, "Rahul Sharma"],
      ["CREDIT", 1250n, "Interest"],
    ]);
    expect(r.balance.status).toBe("ok");
  });

  it("explains when the headings can't be found", () => {
    const r = parseStatement("foo,bar\n1,2\n", ACC, TODAY);
    expect(r.ok).toBe(false);
  });
});
