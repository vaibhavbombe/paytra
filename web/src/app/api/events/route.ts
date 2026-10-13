import { getSessionUser } from "@/lib/auth/session";
import { alertsAfter, latestAlertId } from "@/lib/budgets/service";

// GET /api/events: Server-Sent Events stream of live budget alerts.
//
// Design (cost-aware on Cloud Run, where an open request is billed time):
//  - each stream lives ~50 s, below the service's 60 s request timeout; the
//    browser's EventSource reconnects by itself and sends Last-Event-ID, so
//    nothing is missed or repeated (alert ids are time-ordered UUIDv7);
//  - the client only connects while the tab is visible;
//  - new alerts are found by a cheap indexed query every 5 s. That works with
//    any number of instances; Postgres LISTEN/NOTIFY isn't usable through
//    Neon's transaction-mode pooler.

const STREAM_MS = 50_000;
const POLL_MS = 5_000;
const HEARTBEAT_MS = 15_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const user = await getSessionUser(); // cookie session, revocation-checked
  if (!user) return new Response("Unauthorized", { status: 401 });

  // Resume after the last event the browser saw: EventSource's own
  // Last-Event-ID on auto-reconnect, or ?after= when the tab becomes visible
  // again. A brand-new page starts "now" (it already renders past alerts).
  const resumeFrom = request.headers.get("last-event-id") || new URL(request.url).searchParams.get("after");
  let cursor = resumeFrom && UUID_RE.test(resumeFrom) ? resumeFrom : await latestAlertId(user.id);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (text: string) => {
        if (!closed) controller.enqueue(encoder.encode(text));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        try {
          controller.close();
        } catch {
          // already closed by the client disconnecting
        }
      };

      request.signal.addEventListener("abort", close); // tab closed / navigated away
      const heartbeat = setInterval(() => send(": keep-alive\n\n"), HEARTBEAT_MS);
      const lifetime = setTimeout(close, STREAM_MS);

      // Tell EventSource to reconnect after 1 s when we end the stream, and
      // where this stream starts, so the client can resume from here later.
      send("retry: 1000\n\n");
      if (cursor) send(`id: ${cursor}\nevent: ready\ndata: {}\n\n`);

      while (!closed) {
        try {
          const batch = await alertsAfter(user.id, cursor);
          for (const alert of batch.alerts) {
            send(`id: ${alert.id}\nevent: budget-alert\ndata: ${JSON.stringify({ text: alert.text, level: alert.level })}\n\n`);
          }
          // Advance past hidden (lower-threshold) rows too, and tell the client.
          if (batch.cursor && batch.cursor !== cursor) {
            cursor = batch.cursor;
            send(`id: ${cursor}\nevent: ready\ndata: {}\n\n`);
          }
        } catch {
          close(); // DB hiccup: end this stream; the browser reconnects
          break;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform", // no proxy buffering/compression
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
