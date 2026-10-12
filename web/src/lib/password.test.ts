import { describe, expect, it } from "vitest";

import { canSignUp, checkPassword } from "./password";

const failing = (p: string) => checkPassword(p).results.filter((r) => !r.ok).map((r) => r.id);

describe("checkPassword", () => {
  it("accepts a password meeting every rule", () => {
    expect(checkPassword("Paytra@2026").valid).toBe(true);
  });

  it("names exactly which rules fail", () => {
    expect(failing("short")).toEqual(["length", "upper", "number", "symbol"]);
    expect(failing("alllowercase1!")).toEqual(["upper"]);
    expect(failing("ALLUPPERCASE1!")).toEqual(["lower"]);
    expect(failing("NoNumbers!!")).toEqual(["number"]);
    expect(failing("NoSymbols123")).toEqual(["symbol"]);
  });

  it("does not count a space as a symbol", () => {
    expect(failing("Has Space123")).toEqual(["symbol"]);
  });

  it("counts unicode symbols like ₹", () => {
    expect(checkPassword("Rupee₹2026a").valid).toBe(true);
  });

  it("rejects passwords over 64 characters", () => {
    const long = "Aa1!" + "x".repeat(61);
    expect(checkPassword(long)).toMatchObject({ tooLong: true, valid: false });
  });
});

describe("canSignUp", () => {
  it("requires a valid email, strong password and matching confirmation", () => {
    expect(canSignUp("a@b.in", "Paytra@2026", "Paytra@2026")).toBe(true);
    expect(canSignUp("a@b.in", "Paytra@2026", "Paytra@2027")).toBe(false);
    expect(canSignUp("not-an-email", "Paytra@2026", "Paytra@2026")).toBe(false);
    expect(canSignUp("a@b.in", "weak", "weak")).toBe(false);
  });
});
