import { describe, expect, it } from "vitest";

import { parseBankAlert } from "./parse";

// All samples are MOCK alerts shaped like real bank wording.

describe("parseBankAlert", () => {
  it("HDFC UPI debit (email/SMS style)", () => {
    expect(
      parseBankAlert(
        "Dear Customer, Rs.450.00 has been debited from account **4821 to VPA swiggy8@ybl SWIGGY on 02-10-26. Your UPI transaction reference number is 428512345678. If you did not authorize this transaction, please report it immediately. -HDFC Bank",
      ),
    ).toEqual({
      bank: "HDFC Bank",
      direction: "DEBIT",
      amountPaise: 45000n,
      accountLast: "4821",
      txnDate: "2026-10-02",
      reference: "428512345678",
      payee: "Swiggy",
      channel: "UPI",
    });
  });

  it("SBI UPI debit with compact date and Refno", () => {
    expect(
      parseBankAlert("Dear UPI user A/C X4821 debited by 450.0 on date 02Oct26 trf to SWIGGY Refno 428512345678. If not u? call 1800111109. -SBI"),
    ).toMatchObject({ bank: "State Bank of India", direction: "DEBIT", amountPaise: 45000n, accountLast: "4821", txnDate: "2026-10-02", reference: "428512345678", payee: "Swiggy" });
  });

  it("ICICI debit where the payee is 'credited' later in the sentence", () => {
    expect(
      parseBankAlert("ICICI Bank Acct XX821 debited for Rs 450.00 on 02-Oct-26; SWIGGY credited. UPI:428512345678. Call 18002662 for dispute."),
    ).toMatchObject({ bank: "ICICI Bank", direction: "DEBIT", amountPaise: 45000n, accountLast: "821", txnDate: "2026-10-02", reference: "428512345678", payee: "Swiggy" });
  });

  it("Axis UPI with P2M path", () => {
    expect(parseBankAlert("INR 1,299.00 debited A/c no. XX4821 10-10-26 14:22:05 UPI/P2M/428588889999/AMAZON PAY Not you? SMS BLOCKUPI to 919951860002 -Axis Bank")).toMatchObject({
      bank: "Axis Bank",
      amountPaise: 129900n,
      reference: "428588889999",
      txnDate: "2026-10-10",
    });
  });

  it("card spend", () => {
    expect(parseBankAlert("Rs.1299.00 spent on HDFC Bank Card x1234 at AMAZON PAY IN on 2026-10-10:14:22:05. Not you? Call 18002586161")).toMatchObject({
      direction: "DEBIT",
      amountPaise: 129900n,
      accountLast: "1234",
      txnDate: "2026-10-10",
      payee: "Amazon Pay In",
      channel: "CARD",
    });
  });

  it("NEFT salary credit with UTR", () => {
    expect(
      parseBankAlert("Your A/c XX4821 is credited with INR 85,000.00 on 01-10-26 by NEFT from ACME TECHNOLOGIES PVT LTD - UTR SBIN226123456789. -HDFC Bank"),
    ).toMatchObject({ direction: "CREDIT", amountPaise: 8500000n, accountLast: "4821", txnDate: "2026-10-01", reference: "SBIN226123456789", channel: "NEFT" });
  });

  it("never keeps UPI IDs (often phone numbers) in the payee", () => {
    const p = parseBankAlert("Rs.200.00 has been debited from account **4821 to VPA 9876543210@ybl RAHUL SHARMA on 03-10-26. Ref 428599990000");
    expect(p?.payee).toBe("Rahul Sharma");
    expect(JSON.stringify(p, (_, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain("9876543210");
  });

  it("ignores OTPs, offers and non-transaction text", () => {
    expect(parseBankAlert("123456 is your OTP for a transaction of Rs.4500.00 at AMAZON. Do not share. -HDFC")).toBeNull();
    expect(parseBankAlert("You have a pre-approved loan offer of Rs 5,00,000! Apply now")).toBeNull();
    expect(parseBankAlert("Your statement for September is ready")).toBeNull();
    expect(parseBankAlert("")).toBeNull();
  });

  it("still parses when optional fields are missing", () => {
    expect(parseBankAlert("Rs 75 debited from your account")).toMatchObject({ amountPaise: 7500n, direction: "DEBIT", accountLast: null, txnDate: null, reference: null });
  });
});
