import { getDocumentProxy } from "unpdf";

import { detectColumns, FOOTER_RE } from "./statement";

// Rebuilds a statement table from a text-based PDF.
//
// A PDF has no rows or columns, only text pieces drawn at (x, y). We:
//  1. group pieces into lines by y (with a small tolerance),
//  2. merge neighbouring pieces into cells by horizontal gap,
//  3. find the header line and use its cell positions as column bands,
//  4. assign every cell on later lines to the nearest column band,
//  5. join wrapped narration lines onto the row above.
// The resulting table goes through the exact same parser as CSV.
//
// Library: unpdf (Mozilla pdf.js) only extracts positioned text; the table
// reconstruction here is our own. Scanned (image-only) PDFs contain no text
// and would need OCR (Document AI, a paid upgrade): reported, not guessed.

export type PdfResult =
  | { ok: true; table: string[][]; pages: number }
  | { ok: false; reason: "password-required" | "password-incorrect" | "no-text" | "no-table" | "invalid"; message: string };

type Piece = { str: string; x: number; y: number; w: number };
type Cell = { text: string; x0: number; x1: number };

const Y_TOLERANCE = 2.5; // points: pieces closer than this share a line
const CELL_GAP = 6; // points: a wider horizontal gap starts a new cell

function toLines(pieces: Piece[]): Cell[][] {
  const sorted = [...pieces].sort((a, b) => b.y - a.y || a.x - b.x); // top-down, left-right
  const lines: Piece[][] = [];
  for (const p of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].y - p.y) <= Y_TOLERANCE) line.push(p);
    else lines.push([p]);
  }
  return lines.map((line) => {
    const cells: Cell[] = [];
    for (const p of line.sort((a, b) => a.x - b.x)) {
      const last = cells[cells.length - 1];
      if (last && p.x - last.x1 < CELL_GAP) {
        last.text += (p.x - last.x1 > 1 ? " " : "") + p.str;
        last.x1 = Math.max(last.x1, p.x + p.w);
      } else {
        cells.push({ text: p.str, x0: p.x, x1: p.x + p.w });
      }
    }
    return cells.map((c) => ({ ...c, text: c.text.trim() })).filter((c) => c.text);
  });
}

/** Assign cells to header columns: each cell goes to the column whose band it overlaps most. */
function toRow(cells: Cell[], header: Cell[]): string[] {
  const row = header.map(() => "");
  for (const c of cells) {
    let best = 0;
    let bestScore = -Infinity;
    header.forEach((h, i) => {
      // Overlap of the cell with the column band; numbers are right-aligned
      // and text left-aligned, so compare spans, not left edges.
      const left = i === 0 ? -Infinity : (header[i - 1].x1 + h.x0) / 2;
      const right = i === header.length - 1 ? Infinity : (h.x1 + header[i + 1].x0) / 2;
      const overlap = Math.min(c.x1, right) - Math.max(c.x0, left);
      if (overlap > bestScore) {
        bestScore = overlap;
        best = i;
      }
    });
    row[best] = row[best] ? `${row[best]} ${c.text}` : c.text;
  }
  return row;
}

export async function readPdfStatement(bytes: Uint8Array, password?: string): Promise<PdfResult> {
  let doc;
  try {
    // A copy: pdf.js may transfer/detach the buffer it's given.
    doc = await getDocumentProxy(new Uint8Array(bytes), password ? { password } : {});
  } catch (e) {
    const err = e as { name?: string; code?: number };
    if (err.name === "PasswordException") {
      return err.code === 2
        ? { ok: false, reason: "password-incorrect", message: "That PDF password is incorrect." }
        : { ok: false, reason: "password-required", message: "This PDF is password-protected. Enter its password." };
    }
    return { ok: false, reason: "invalid", message: "Couldn't read this PDF. It may be damaged or not a real PDF." };
  }

  try {
    const allLines: Cell[][] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const pieces: Piece[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        pieces.push({ str: item.str, x: item.transform[4], y: item.transform[5], w: item.width });
      }
      allLines.push(...toLines(pieces));
    }

    if (allLines.length === 0) {
      return {
        ok: false,
        reason: "no-text",
        message: "This PDF has no readable text (probably a scanned image). Download the statement as CSV or a text PDF instead.",
      };
    }

    const headerIndex = allLines.findIndex((l) => detectColumns(l.map((c) => c.text)) !== null);
    if (headerIndex === -1) {
      return { ok: false, reason: "no-table", message: "Couldn't find the transaction table's column headings in this PDF." };
    }
    const header = allLines[headerIndex];
    const cols = detectColumns(header.map((c) => c.text))!;
    const headerText = header.map((c) => c.text).join("|");

    const table: string[][] = [header.map((c) => c.text)];
    for (const line of allLines.slice(headerIndex + 1)) {
      if (line.map((c) => c.text).join("|") === headerText) continue; // header repeated on each page
      const row = toRow(line, header);
      // Footer ("STATEMENT SUMMARY", "Opening Balance"): keep it as its own
      // row so the shared parser stops there; never glue it onto a narration.
      if (row.some((c) => FOOTER_RE.test(c.trim()))) {
        table.push(row);
        break;
      }
      const dateCell = row[cols.date!];
      const prev = table.length > 1 ? table[table.length - 1] : null;
      // A line with no date but narration text continues the row above.
      // Banks wrap narrations at a fixed width, often mid-token (a UTR split
      // across lines), so the pieces are joined WITHOUT a space.
      if (!dateCell && prev && row[cols.narration!] && row.every((v, i) => i === cols.narration || !v || i === cols.reference)) {
        prev[cols.narration!] = `${prev[cols.narration!]}${row[cols.narration!]}`.trim();
        if (cols.reference !== undefined && row[cols.reference]) prev[cols.reference] += row[cols.reference];
        continue;
      }
      table.push(row);
    }
    return { ok: true, table, pages: doc.numPages };
  } finally {
    // Free the parsed document (and anything pdf.js cached) right away.
    await doc.loadingTask.destroy();
  }
}
