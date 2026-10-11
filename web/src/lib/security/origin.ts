import "server-only";

// CSRF defence for cookie-authenticated, state-changing requests.
// SameSite=Lax already stops most cross-site POSTs; checking Origin as well
// covers older browsers and same-site subdomain attacks.
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  const allowed = process.env.APP_ORIGIN ?? new URL(request.url).origin;
  return origin === allowed;
}
