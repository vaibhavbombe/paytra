import type { NextConfig } from "next";

// Sent on every response. A full script Content-Security-Policy needs
// per-request nonces (which conflict with prerendered pages) and allowances for
// the Google sign-in popup, so it's a separate step; the directives below are
// the ones that are safe today.
const SECURITY_HEADERS = [
  // HTTPS only, for two years (browsers ignore this on plain-http localhost).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Never embedded in another site (clickjacking); no plugins; forms post only to us.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: "X-Frame-Options", value: "DENY" }, // the same for older browsers
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  // Isolates the window but still lets the Google sign-in popup report back.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

const nextConfig: NextConfig = {
  // Self-contained server (.next/standalone) with only the node_modules it
  // actually uses: a much smaller Docker image for Cloud Run.
  output: "standalone",
  // Don't advertise the framework in every response.
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // The push service worker must never be served stale from a cache.
      { source: "/push-sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
  experimental: {
    serverActions: {
      // Statement files are capped at 1 MB in code; leave room for the
      // multipart overhead on top of that.
      bodySizeLimit: "1100kb",
    },
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
