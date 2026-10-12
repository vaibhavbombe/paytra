import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("splits simple rows", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles CRLF, a missing final newline and empty fields", () => {
    expect(parseCsv("a,,c\r\n1,2,")).toEqual([
      ["a", "", "c"],
      ["1", "2", ""],
    ]);
  });

  it("handles quotes, commas and newlines inside quotes, and escaped quotes", () => {
    expect(parseCsv('"UPI-SHOP, MUMBAI","say ""hi""","line1\nline2"\n')).toEqual([
      ["UPI-SHOP, MUMBAI", 'say "hi"', "line1\nline2"],
    ]);
  });

  it("strips a UTF-8 BOM", () => {
    expect(parseCsv("﻿Date,Amount\n")[0][0]).toBe("Date");
  });

  it("keeps amounts with Indian grouping intact when quoted", () => {
    expect(parseCsv('"1,23,456.78",x\n')).toEqual([["1,23,456.78", "x"]]);
  });
});
