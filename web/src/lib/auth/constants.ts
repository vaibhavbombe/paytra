// Kept dependency-free so proxy.ts can import it without pulling in
// firebase-admin or the database client.

// `__Host-` prefix (production): the browser only accepts the cookie if it is
// Secure, Path=/ and has no Domain, so a subdomain can't plant or overwrite it.
// Plain name in dev because localhost runs over http.
export const SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-paytra_session" : "paytra_session";
