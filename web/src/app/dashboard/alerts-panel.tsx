"use client";

import { useTransition } from "react";

import { dismissAlerts } from "../budgets/actions";

type Alert = { id: string; unread: boolean; text: string; level: "warning" | "over"; date: string };

export function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  const [pending, startTransition] = useTransition();
  const unread = alerts.filter((a) => a.unread).length;
  if (alerts.length === 0) return null;

  return (
    <section aria-label="Budget alerts" className="space-y-2 rounded-md border border-border p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">
          Alerts {unread > 0 && <span className="ml-1 rounded-full bg-danger px-2 py-0.5 text-xs text-primary-foreground">{unread} new</span>}
        </h2>
        {unread > 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => dismissAlerts())}
            className="text-sm text-muted underline disabled:opacity-50"
          >
            Mark all read
          </button>
        )}
      </div>
      <ul className="space-y-1 text-sm">
        {alerts.map((a) => (
          <li key={a.id} className={a.unread ? "" : "text-muted"}>
            <span aria-hidden className={a.level === "over" ? "text-danger" : "text-warning"}>
              {a.level === "over" ? "●" : "▲"}
            </span>{" "}
            {a.text} <span className="text-xs text-muted">{a.date}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
