import { readFileSync } from "node:fs";
import { join } from "node:path";

import PDFDocument from "pdfkit";
import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv";
import { readPdfStatement } from "./pdf";
import { parseStatement, parseStatementTable } from "./statement";

const ACC = "0199d3a2-7c41-7b3e-9a10-5d2f4e6b8c01";
const TODAY = "2026-10-12";
const csvText = readFileSync(join(__dirname, "__fixtures__", "hdfc-style-mock.csv"), "utf8");

// Build a MOCK bank-statement PDF from the CSV fixture's rows, laid out like a
// real one: preamble, a table with right-aligned amounts, a long narration
// that wraps onto a second line, a page break with the header repeated, and
// the bank's summary footer.
function mockPdf(opts: { password?: string; scanned?: boolean } = {}): Promise<Uint8Array> {
  const table = parseCsv(csvText);
  const header = table[4];
  const rows = table.slice(5, 16);

  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 30,
    ...(opts.password && { userPassword: opts.password, ownerPassword: "owner-secret", pdfVersion: "1.7ext3" as const }),
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Uint8Array>((resolve) => doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks)))));

  if (opts.scanned) {
    // Image-only page: a filled rectangle, no text at all.
    doc.rect(50, 50, 400, 200).fill("#888");
    doc.end();
    return done;
  }

  doc.fontSize(7);
  // [x, width, align] per column: Date, Narration, Ref, Value Dt, Withdrawal, Deposit, Balance
  const layout: [number, number, "left" | "right"][] = [
    [30, 45, "left"], [80, 300, "left"], [385, 85, "left"], [475, 45, "left"],
    [525, 80, "right"], [610, 80, "right"], [695, 100, "right"],
  ];
  const put = (cells: string[], y: number) =>
    cells.forEach((text, i) => doc.text(text, layout[i][0], y, { width: layout[i][1], align: layout[i][2], lineBreak: false }));

  doc.text("MOCK BANK STATEMENT - SAMPLE DATA ONLY", 30, 30, { lineBreak: false });
  doc.text("Account No : XXXXXXXX4821", 30, 42, { lineBreak: false });

  let y = 70;
  put(header, y);
  rows.forEach((row, i) => {
    if (i === 6) {
      doc.addPage({ size: "A4", layout: "landscape", margin: 30 });
      doc.fontSize(7);
      y = 40;
      put(header, y);
    }
    y += 14;
    const narration = row[1];
    if (narration.length > 55) {
      // Wrap the narration onto a second line, as real PDFs do.
      put([row[0], narration.slice(0, 55), ...row.slice(2)], y);
      y += 9;
      put(["", narration.slice(55), "", "", "", "", ""], y);
    } else {
      put(row, y);
    }
  });
  y += 24;
  doc.text("STATEMENT SUMMARY :-", 30, y, { lineBreak: false });
  doc.text("Opening Balance 25,000.00", 30, y + 10, { lineBreak: false });
  doc.end();
  return done;
}

function parsedPdf(table: string[][]) {
  const r = parseStatementTable(table, ACC, TODAY);
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe("readPdfStatement", () => {
  it("rebuilds the table across pages, joining wrapped narrations", async () => {
    const pdf = await readPdfStatement(await mockPdf());
    if (!pdf.ok) throw new Error(pdf.message);
    expect(pdf.pages).toBe(2);
    const r = parsedPdf(pdf.table);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(11);
    expect(r.balance).toEqual({ status: "ok", checked: 10 });
    expect(r.rows[0]).toMatchObject({ direction: "CREDIT", amountPaise: 8500000n, description: "Acme Technologies Pvt Ltd" });
  });

  it("produces EXACTLY the same fingerprints as the CSV of the same statement", async () => {
    const pdf = await readPdfStatement(await mockPdf());
    if (!pdf.ok) throw new Error(pdf.message);
    const fromPdf = parsedPdf(pdf.table).rows.map((r) => [r.fingerprint, r.amountPaise, r.direction, r.txnDate]);
    const csv = parseStatement(csvText, ACC, TODAY);
    if (!csv.ok) throw new Error(csv.error);
    const fromCsv = csv.rows.map((r) => [r.fingerprint, r.amountPaise, r.direction, r.txnDate]);
    expect(fromPdf).toEqual(fromCsv);
  });

  it("asks for the password, rejects a wrong one, opens with the right one", async () => {
    const locked = await mockPdf({ password: "01011990" });
    expect(await readPdfStatement(locked)).toMatchObject({ ok: false, reason: "password-required" });
    expect(await readPdfStatement(locked, "wrong")).toMatchObject({ ok: false, reason: "password-incorrect" });
    const opened = await readPdfStatement(locked, "01011990");
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(parsedPdf(opened.table).rows).toHaveLength(11);
  });

  it("reports image-only (scanned) PDFs instead of guessing", async () => {
    expect(await readPdfStatement(await mockPdf({ scanned: true }))).toMatchObject({ ok: false, reason: "no-text" });
  });

  it("rejects bytes that are not a PDF", async () => {
    expect(await readPdfStatement(new TextEncoder().encode("Date,Narration\n1,2"))).toMatchObject({ ok: false, reason: "invalid" });
  });
});
