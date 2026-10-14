// Parses bank transaction ALERTS (emails and SMS share the same wording) into
// structured fields. Pure, no I/O.
//
// Banks phrase alerts differently and change them over time, so this is a
// set of small, independent extractors (amount, direction, account, date,
// reference, payee) rather than one regex per bank. If the essentials
// (amount + direction) can't be found, it returns null instead of guessing.
//
// Privacy: the original alert text is NOT kept. UPI IDs (often phone numbers)
// are dropped; only the payee's display name, the reference and the account's
// last digits survive.

import { parseDecimalToPaise } from "@/lib/money";
import { parseStatementDate } from "@/lib/imports/statement";

export type ParsedAlert = {
  bank: string | null;
  direction: "DEBIT" | "CREDIT";
  amountPaise: bigint;
  accountLast: string | null; // last 3-4 digits as printed (ICICI shows 3)
  txnDate: string | null; // YYYY-MM-DD
  reference: string | null; // UPI RRN (12 digits) or NEFT/IMPS UTR
  payee: string | null;
  channel: "UPI" | "CARD" | "NEFT" | "IMPS" | "ATM" | "OTHER";
};

const BANKS: [string, RegExp][] = [
  ["HDFC Bank", /\bHDFC\b/i],
  ["State Bank of India", /\bSBI\b|State Bank/i],
  ["ICICI Bank", /\bICICI\b/i],
  ["Axis Bank", /\bAxis\b/i],
  ["Kotak Mahindra Bank", /\bKotak\b/i],
];

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";

function amountFrom(text: string): bigint | null {
  const m =
    text.match(/(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{1,2})?)/i) ?? // Rs.450.00 / INR 450 / ₹450
    text.match(/\b(?:debited|credited)\s+(?:by|with|for)\s+([\d,]+(?:\.\d{1,2})?)\b/i); // "debited by 450.0"
  if (!m) return null;
  const v = parseDecimalToPaise(m[1]);
  return v !== null && v > 0n ? v : null;
}

function directionFrom(text: string): "DEBIT" | "CREDIT" | null {
  // The FIRST money verb describes your account; later ones describe the
  // other party ("debited ...; SWIGGY credited").
  const m = text.match(/\b(debited|spent|withdrawn|sent|paid|credited|received|deposited)\b/i);
  if (!m) return null;
  return /^(credited|received|deposited)$/i.test(m[1]) ? "CREDIT" : "DEBIT";
}

function accountFrom(text: string): string | null {
  const m = text.match(/\b(?:A\/?c(?:count)?|Acct|account|Card)\b[^\d*Xx]{0,12}[*Xx]{1,12}\s*(\d{3,4})\b/i);
  return m ? m[1] : null;
}

function dateFrom(text: string): string | null {
  const candidates = [
    text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1], // 2026-10-10
    text.match(new RegExp(`\\b(\\d{1,2}[-/ ](?:${MONTHS})[-/ ,]+\\d{2,4})\\b`, "i"))?.[1], // 02-Oct-26
    text.match(new RegExp(`\\b(\\d{1,2})(${MONTHS})(\\d{2,4})\\b`, "i"))?.slice(1, 4).join("-"), // 02Oct26
    text.match(/\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/)?.[1], // 02-10-26
  ];
  for (const c of candidates) {
    if (!c) continue;
    const d = parseStatementDate(c);
    if (d) return d;
  }
  return null;
}

function referenceFrom(text: string): string | null {
  const labelled = text.match(/\b(?:ref(?:erence)?\.?\s*(?:no|number|num)?\.?|refno|RRN|UPI\s*Ref|UTR)\b[^A-Za-z0-9]{0,12}(?:is\s+)?([A-Z0-9]{12,22})\b/i);
  if (labelled) return labelled[1].toUpperCase();
  const upi = text.match(/\bUPI[:/](?:P2[AM]\/)?(\d{12})\b/i); // ICICI "UPI:428...", Axis "UPI/P2M/428..."
  if (upi) return upi[1];
  return null;
}

function clean(name: string): string | null {
  const s = name
    .replace(/[a-z0-9._-]{2,}@[a-z][a-z0-9.]+/gi, "") // drop UPI IDs
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:]+$/, "");
  if (s.length < 2 || !/[A-Za-z]{2}/.test(s)) return null;
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).slice(0, 60);
}

function payeeFrom(text: string): string | null {
  const patterns = [
    /\bto VPA\s+\S+\s+(.+?)\s+on\b/i, // HDFC: "to VPA swiggy8@ybl SWIGGY on 02-10-26"
    /\bby VPA\s+\S+\s+(.+?)\s+on\b/i, // HDFC credit: "by VPA x@y NAME on"
    /\btrf to\s+(.+?)\s+Ref/i, // SBI: "trf to SWIGGY Refno"
    /;\s*(.+?)\s+credited\b/i, // ICICI: "; SWIGGY credited"
    /\bUPI\/P2[AM]\/\d{12}\/([^/\n]+?)(?:\s|\/|$)/i, // Axis: "UPI/P2M/428.../SWIGGY"
    /\b(?:spent|txn)\b.*?\bat\s+(.+?)\s+on\b/i, // cards: "spent ... at AMAZON PAY IN on"
    /\bfrom\s+(?!(?:A\/?c|account)\b)([A-Z][A-Za-z .&]{2,40}?)\s+(?:on|via|-)\b/, // "from ACME PVT LTD on"
  ];
  for (const re of patterns) {
    const m = text.match(re);
    const name = m && clean(m[1]);
    if (name) return name;
  }
  return null;
}

function channelFrom(text: string): ParsedAlert["channel"] {
  if (/\bUPI\b|VPA/i.test(text)) return "UPI";
  if (/\bNEFT\b/i.test(text)) return "NEFT";
  if (/\bIMPS\b/i.test(text)) return "IMPS";
  if (/\bATM\b|withdrawn/i.test(text)) return "ATM";
  if (/\bcard\b|spent/i.test(text)) return "CARD";
  return "OTHER";
}

/** Returns null when the text doesn't look like a transaction alert (OTPs, offers, statements). */
export function parseBankAlert(raw: string): ParsedAlert | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text || text.length > 2000) return null;
  // OTPs and promotions mention amounts too; they are not transactions.
  if (/\bOTP\b|one[- ]time password|pre-?approved|offer|cashback up to|apply now/i.test(text)) return null;

  const amountPaise = amountFrom(text);
  const direction = directionFrom(text);
  if (!amountPaise || !direction) return null;

  return {
    bank: BANKS.find(([, re]) => re.test(text))?.[0] ?? null,
    direction,
    amountPaise,
    accountLast: accountFrom(text),
    txnDate: dateFrom(text),
    reference: referenceFrom(text),
    payee: payeeFrom(text),
    channel: channelFrom(text),
  };
}
