// Password rules shown (and checked) on sign-up.
// Firebase receives the password directly, never our server, so the same
// rules must also be switched on in Firebase Authentication -> Settings ->
// Password policy ("Require enforcement"). This module is the UI side of it.

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;

export const PASSWORD_RULES = [
  { id: "length", label: `At least ${PASSWORD_MIN} characters`, test: (p: string) => p.length >= PASSWORD_MIN },
  { id: "upper", label: "An uppercase letter (A–Z)", test: (p: string) => /[A-Z]/.test(p) },
  { id: "lower", label: "A lowercase letter (a–z)", test: (p: string) => /[a-z]/.test(p) },
  { id: "number", label: "A number (0–9)", test: (p: string) => /\d/.test(p) },
  { id: "symbol", label: "A symbol (e.g. ! @ # $ %)", test: (p: string) => /[^A-Za-z0-9\s]/.test(p) },
] as const;

export type PasswordRuleId = (typeof PASSWORD_RULES)[number]["id"];

export function checkPassword(password: string) {
  const results = PASSWORD_RULES.map((r) => ({ id: r.id, label: r.label, ok: r.test(password) }));
  const tooLong = password.length > PASSWORD_MAX;
  return { results, tooLong, valid: !tooLong && results.every((r) => r.ok) };
}

export function canSignUp(email: string, password: string, confirm: string): boolean {
  return /^\S+@\S+\.\S+$/.test(email.trim()) && checkPassword(password).valid && password === confirm;
}
