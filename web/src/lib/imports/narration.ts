// Pulls structure out of an Indian bank narration, e.g.
//   HDFC  "UPI-SWIGGY-swiggy@ybl-YESB0YBLUPI-428512345678-Payment"
//   SBI   "UPI/DR/428512345678/SWIGGY/YESB/swiggy@ybl/Payment"
//   ICICI "UPI/428512345678/Payment/swiggy@ybl/YES BANK LIMITED"
//   NEFT  "NEFT CR-SBIN0001234-ACME PVT LTD-VAIBHAV-SBIN226123456789"
// Formats vary by bank and change over time, so this is token-based
// (split on - and /, then discard codes, numbers and handles) rather than one
// regex per bank. Anything it can't identify falls back safely.
//
// Privacy: the raw narration contains UPI IDs (often phone numbers) and
// account fragments. We keep only what we need (channel, counterparty name,
// reference); the raw text is not stored until KMS encryption exists (Phase 8).

export type Channel = "UPI" | "NEFT" | "IMPS" | "RTGS" | "ATM" | "CARD" | "ACH" | "CHEQUE" | "INTEREST" | "OTHER";

export type NarrationInfo = {
  channel: Channel;
  counterparty: string | null;
  reference: string | null; // UPI RRN / IMPS ref / NEFT UTR
};

const CHANNEL_PATTERNS: [Channel, RegExp][] = [
  ["UPI", /^UPI\b/],
  ["NEFT", /^NEFT\b/],
  ["IMPS", /^(IMPS|MMT)\b/],
  ["RTGS", /^RTGS\b/],
  ["ATM", /^(ATW|ATM|NWD|EAW)\b/],
  ["CARD", /^(POS|ECOM|PCD|VPS|IPS)\b/],
  ["ACH", /^(ACH|NACH|ECS)\b/],
  ["CHEQUE", /^(CHQ|CLG|CHEQUE)\b/],
  ["INTEREST", /^(INT\b|INTEREST|CREDIT INTEREST)/],
];

const CHANNEL_WORDS = new Set([
  "UPI", "NEFT", "IMPS", "MMT", "RTGS", "ATW", "ATM", "NWD", "EAW", "POS", "ECOM", "PCD",
  "VPS", "IPS", "ACH", "NACH", "ECS", "CHQ", "CLG", "DR", "CR", "D", "C", "INB", "REV",
  "PAYMENT", "PAYMENT FROM PHONE", "PAY", "SENT", "RECEIVED", "COLLECT", "NA", "NULL",
]);

const VPA_RE = /[a-z0-9._-]{2,}@[a-z][a-z0-9.]{1,}/i;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
// The payer/payee's bank ("YES BANK LIMITED", "ICICI Bank"). Must not match
// company names that merely end in LTD ("ACME TECHNOLOGIES PVT LTD").
const BANK_WORDS = /\bBANK\b/;

function detectChannel(upper: string): Channel {
  for (const [channel, re] of CHANNEL_PATTERNS) if (re.test(upper)) return channel;
  return "OTHER";
}

function findReference(upper: string, channel: Channel): string | null {
  // UPI RRN and IMPS refs are 12 digits; NEFT/RTGS UTRs are 16-22 chars
  // starting with a 4-letter bank code.
  if (channel === "NEFT" || channel === "RTGS") {
    const utr = upper.match(/\b[A-Z]{4}[A-Z0-9]{12,18}\b/g)?.find((t) => !IFSC_RE.test(t) && /\d{6}/.test(t));
    if (utr) return utr;
  }
  const rrn = upper.match(/(?<!\d)\d{12}(?!\d)/);
  return rrn ? rrn[0] : null;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function findCounterparty(raw: string, channel: Channel): string | null {
  if (channel === "ATM") return "ATM withdrawal";
  if (channel === "INTEREST") return "Interest";

  const tokens = raw
    .split(/[-/]/)
    .map((t) => t.trim().replace(/\s+/g, " "))
    .filter(Boolean);

  for (const token of tokens) {
    const upper = token.toUpperCase();
    if (CHANNEL_WORDS.has(upper)) continue;
    if (CHANNEL_PATTERNS.some(([, re]) => re.test(upper)) && upper.split(" ").every((w) => CHANNEL_WORDS.has(w))) continue;
    if (VPA_RE.test(token)) continue; // UPI handle (often a phone number)
    if (IFSC_RE.test(upper)) continue;
    if (/\d{5,}/.test(token)) continue; // references, card / account numbers
    if (/^[A-Z]{2,5}$/.test(upper) && !/[aeiou]/i.test(upper.slice(1))) continue; // bank codes: YESB, SBIN, HDFC
    if (BANK_WORDS.test(upper)) continue; // "YES BANK LIMITED"
    const letters = upper.replace(/[^A-Z]/g, "");
    if (letters.length < 2) continue;
    // Strip a leading channel word glued to the name ("POS AMAZON PAY IN").
    const cleaned = token.replace(/^(POS|ECOM|ACH D|ACH C|NACH)\s+/i, "").trim();
    return titleCase(cleaned).slice(0, 60);
  }
  return null;
}

export function parseNarration(narration: string): NarrationInfo {
  const raw = narration.trim();
  const upper = raw.toUpperCase();
  const channel = detectChannel(upper);
  return { channel, counterparty: findCounterparty(raw, channel), reference: findReference(upper, channel) };
}

/** Display-safe text when no counterparty was found: no UPI IDs, long numbers masked. */
export function sanitizeNarration(narration: string): string {
  return narration
    .replace(new RegExp(VPA_RE.source, "gi"), "")
    .replace(/\d{6,}/g, (d) => `••${d.slice(-4)}`)
    .replace(/[-/]{2,}/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

const CHANNEL_LABEL: Record<Channel, string> = {
  UPI: "UPI payment",
  NEFT: "NEFT transfer",
  IMPS: "IMPS transfer",
  RTGS: "RTGS transfer",
  ATM: "ATM withdrawal",
  CARD: "Card payment",
  ACH: "Auto-debit (NACH)",
  CHEQUE: "Cheque",
  INTEREST: "Interest",
  OTHER: "Bank transaction",
};

/** Short description stored on the transaction. */
export function describe(info: NarrationInfo, narration: string): string {
  if (info.counterparty) return info.counterparty;
  const safe = sanitizeNarration(narration);
  return safe || CHANNEL_LABEL[info.channel];
}
