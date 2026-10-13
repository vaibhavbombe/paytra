"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Toast = { id: string; text: string; level: "warning" | "over" };

const TOAST_MS = 12_000;

/**
 * Listens to /api/events while the tab is VISIBLE and shows budget alerts as
 * toasts, then refreshes the current page so panels/progress bars update.
 * Closing the stream when hidden keeps Cloud Run from being held open by
 * background tabs.
 */
export function LiveAlerts() {
  const pathname = usePathname();
  const router = useRouter();
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Last event id seen in this page, kept across reconnects so alerts created
  // while the tab was hidden still pop up when it's visible again.
  const lastId = useRef<string | null>(null);
  const signedOutPage = pathname === "/login";

  useEffect(() => {
    if (signedOutPage) return;
    let source: EventSource | null = null;

    const open = () => {
      if (source || document.visibilityState !== "visible") return;
      source = new EventSource(lastId.current ? `/api/events?after=${encodeURIComponent(lastId.current)}` : "/api/events");
      source.addEventListener("ready", (e) => {
        lastId.current = (e as MessageEvent).lastEventId || lastId.current;
      });
      source.addEventListener("budget-alert", (e) => {
        const data = JSON.parse((e as MessageEvent<string>).data) as Omit<Toast, "id">;
        const id = (e as MessageEvent).lastEventId;
        lastId.current = id;
        setToasts((t) => (t.some((x) => x.id === id) ? t : [...t, { id, ...data }].slice(-3)));
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), TOAST_MS);
        router.refresh();
      });
      // A 401 (signed out elsewhere) would make EventSource retry forever.
      source.onerror = () => {
        if (source?.readyState === EventSource.CLOSED) source = null;
      };
    };
    const close = () => {
      source?.close();
      source = null;
    };
    const onVisibility = () => (document.visibilityState === "visible" ? open() : close());

    open();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      close();
    };
  }, [signedOutPage, router]);

  if (toasts.length === 0) return null;
  return (
    <div className="fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:left-auto sm:w-96" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`w-full rounded-md border bg-background p-3 text-sm shadow-lg ${t.level === "over" ? "border-danger" : "border-warning"}`}
        >
          <div className="flex items-start gap-2">
            <span aria-hidden className={t.level === "over" ? "text-danger" : "text-warning"}>
              {t.level === "over" ? "●" : "▲"}
            </span>
            <p className="flex-1">{t.text}</p>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
              className="text-muted hover:text-foreground"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
