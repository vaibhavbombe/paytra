import { describe as group, expect, it } from "vitest";

import { describe, parseNarration, sanitizeNarration } from "./narration";

// All samples are MOCK narrations shaped like real bank formats.

group("parseNarration", () => {
  it("HDFC-style UPI", () => {
    expect(parseNarration("UPI-SWIGGY-swiggy8@ybl-YESB0YBLUPI-428512345678-Payment from Phone")).toEqual({
      channel: "UPI",
      counterparty: "Swiggy",
      reference: "428512345678",
    });
  });

  it("SBI-style UPI with / separators and DR marker", () => {
    expect(parseNarration("UPI/DR/428599990000/RAHUL SHARMA/SBIN/9876543210@ybl/Payment")).toEqual({
      channel: "UPI",
      counterparty: "Rahul Sharma",
      reference: "428599990000",
    });
  });

  it("ICICI-style UPI where the name is not first", () => {
    expect(parseNarration("UPI/428511112222/Payment fr/bigbasket@icici/ICICI Bank")).toMatchObject({
      channel: "UPI",
      counterparty: "Payment Fr",
      reference: "428511112222",
    });
  });

  it("NEFT credit: salary from a company, UTR not IFSC as reference", () => {
    expect(parseNarration("NEFT CR-SBIN0001234-ACME TECHNOLOGIES PVT LTD-VAIBHAV-SBIN226123456789")).toEqual({
      channel: "NEFT",
      counterparty: "Acme Technologies Pvt Ltd",
      reference: "SBIN226123456789",
    });
  });

  it("IMPS transfer", () => {
    expect(parseNarration("IMPS-428577778888-PRIYA NAIR-HDFC-XXXXXXXX1234-rent oct")).toMatchObject({
      channel: "IMPS",
      counterparty: "Priya Nair",
      reference: "428577778888",
    });
  });

  it("ATM withdrawal and card (POS) spend", () => {
    expect(parseNarration("ATW-512345XXXXXX1234-S1ANMU12-MUMBAI")).toMatchObject({ channel: "ATM", counterparty: "ATM withdrawal" });
    expect(parseNarration("POS 512345XXXXXX1234 AMAZON PAY IN")).toMatchObject({ channel: "CARD" });
  });

  it("NACH auto-debit (EMI)", () => {
    expect(parseNarration("ACH D- BAJAJ FINANCE LTD-ABCD1234567")).toMatchObject({ channel: "ACH", counterparty: "Bajaj Finance Ltd" });
  });

  it("unknown formats fall back without crashing", () => {
    expect(parseNarration("CASH DEPOSIT BY SELF")).toMatchObject({ channel: "OTHER", reference: null });
    expect(parseNarration("")).toEqual({ channel: "OTHER", counterparty: null, reference: null });
  });
});

group("sanitizeNarration / describe", () => {
  it("removes UPI IDs and masks long numbers", () => {
    const s = sanitizeNarration("UPI/DR/428599990000/9876543210@ybl/xyz");
    expect(s).not.toContain("@");
    expect(s).not.toContain("9876543210");
    expect(s).toContain("••0000");
  });

  it("prefers the counterparty name", () => {
    const n = "UPI-SWIGGY-swiggy8@ybl-YESB0YBLUPI-428512345678-Payment";
    expect(describe(parseNarration(n), n)).toBe("Swiggy");
  });
});
