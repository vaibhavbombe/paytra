import "server-only";

// Fixed-window rate limiter kept in process memory.
// Good enough while Cloud Run runs 1-2 instances (each instance counts on its
// own). With more instances this moves to a shared store (e.g. Redis /
// Memorystore) so the limit holds across all of them.

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const current = windows.get(key);

  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    sweep(now);
    return { ok: true, retryAfterSec: 0 };
  }

  current.count += 1;
  if (current.count > limit) {
    return { ok: false, retryAfterSec: Math.ceil((current.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSec: 0 };
}

// Drop expired windows now and then so the map can't grow without bound.
function sweep(now: number) {
  if (windows.size < 10_000) return;
  for (const [key, w] of windows) {
    if (w.resetAt <= now) windows.delete(key);
  }
}

export function clientIp(headers: Headers): string {
  // Cloud Run's front end appends the real client IP as the LAST entry of
  // X-Forwarded-For; earlier entries can be set by the client, so ignore them.
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return "unknown";
}
