"use client";

import { useEffect, useState } from "react";

import { getClientApp } from "@/lib/firebase/client";

import { disablePush, enablePush, testPush } from "./push-actions";

type State = "checking" | "unsupported" | "blocked" | "off" | "on";

// Per-device convenience flag only (not a credential): remembers that THIS
// browser opted in, so the button shows the right state.
const FLAG = "paytra-push";
const readFlag = () => {
  try {
    return localStorage.getItem(FLAG) === "on";
  } catch {
    return false;
  }
};
const writeFlag = (on: boolean) => {
  try {
    if (on) localStorage.setItem(FLAG, "on");
    else localStorage.removeItem(FLAG);
  } catch {
    // storage blocked: the button just won't remember
  }
};

async function deviceToken(): Promise<{ token: string; messaging: import("firebase/messaging").Messaging } | null> {
  const { getMessaging, getToken, isSupported } = await import("firebase/messaging");
  if (!(await isSupported())) return null;
  // Our own minimal service worker (public/push-sw.js) shows the notifications.
  const registration = await navigator.serviceWorker.register("/push-sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  const messaging = getMessaging(getClientApp());
  const token = await getToken(messaging, {
    vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: registration,
  });
  return token ? { token, messaging } : null;
}

export function PushToggle() {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    // Feature detection after mount (window APIs don't exist during SSR).
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    const next: State = !supported ? "unsupported" : Notification.permission === "denied" ? "blocked" : readFlag() && Notification.permission === "granted" ? "on" : "off";
    queueMicrotask(() => setState(next));
  }, []);

  async function enable() {
    setMessage(null);
    if (!process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY) {
      setMessage("Push isn't configured yet: the web push (VAPID) key is missing on the server.");
      return;
    }
    setBusy(true);
    try {
      // Asked only here, after a click: never on page load.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const device = await deviceToken();
      if (!device) {
        setState("unsupported");
        return;
      }
      const r = await enablePush(device.token);
      if (!r.ok) {
        setMessage(r.error ?? "Couldn't enable alerts.");
        return;
      }
      writeFlag(true);
      setState("on");
      setMessage("Alerts enabled on this device.");
    } catch (e) {
      // Shown to the user in short; the full error goes to the console for debugging.
      console.error("Enabling push failed", e);
      const code = (e as { code?: string }).code;
      setMessage(`Couldn't enable alerts on this browser${code ? ` (${code})` : ""}. Try again, or check the site's notification settings.`);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage(null);
    try {
      const device = await deviceToken();
      if (device) {
        await disablePush(device.token);
        const { deleteToken } = await import("firebase/messaging");
        await deleteToken(device.messaging);
      }
    } catch {
      // Still turn it off locally; the server also forgets tokens FCM rejects.
    } finally {
      writeFlag(false);
      setState("off");
      setBusy(false);
      setMessage("Alerts turned off on this device.");
    }
  }

  async function test() {
    setBusy(true);
    const r = await testPush();
    setMessage(r.ok ? (r.delivered ? "Test sent. It should appear in a few seconds." : "No device received it. Try turning alerts off and on.") : (r.error ?? "Test failed."));
    setBusy(false);
  }

  const button = "rounded-md border border-input px-3 py-1.5 text-sm hover:bg-surface-hover disabled:opacity-50";

  return (
    <section aria-label="Push alerts" className="space-y-2 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Phone &amp; desktop alerts</h2>
          <p className="text-xs text-muted">
            Get budget alerts even when PayTra is closed. Notifications never show amounts.
          </p>
        </div>
        <div className="flex gap-2">
          {state === "off" && (
            <button type="button" onClick={enable} disabled={busy} className={button}>
              {busy ? "Enabling…" : "Enable alerts on this device"}
            </button>
          )}
          {state === "on" && (
            <>
              <button type="button" onClick={test} disabled={busy} className={button}>
                Send test
              </button>
              <button type="button" onClick={disable} disabled={busy} className={button}>
                Turn off
              </button>
            </>
          )}
        </div>
      </div>
      {state === "on" && <p className="text-sm text-success">✓ On for this device.</p>}
      {state === "blocked" && (
        <p className="text-sm text-danger">
          Notifications are blocked for this site. Allow them in your browser&apos;s site settings, then reload.
        </p>
      )}
      {state === "unsupported" && (
        <p className="text-sm text-muted">
          This browser can&apos;t receive push alerts. On iPhone, add PayTra to your Home Screen first (iOS 16.4+).
        </p>
      )}
      {message && <p className="text-sm text-muted">{message}</p>}
    </section>
  );
}
