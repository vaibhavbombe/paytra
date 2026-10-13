// PayTra push service worker.
// Shows budget alerts sent through Firebase Cloud Messaging. It deliberately
// doesn't load any Firebase code: FCM delivers a standard Web Push event and
// we render it ourselves, so what appears on screen is fully under our control.

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    return;
  }
  // FCM data messages arrive as { data: {...}, from, ... }.
  const d = payload.data || payload;
  if (!d.title) return;

  event.waitUntil(
    self.registration.showNotification(String(d.title).slice(0, 80), {
      body: String(d.body || "").slice(0, 200),
      tag: d.tag || undefined, // same tag replaces the older notification
      renotify: Boolean(d.tag),
      data: { url: d.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Only same-site paths: a push can never send the user to another website.
  const raw = event.notification.data && event.notification.data.url;
  const path = typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
  const target = new URL(path, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        return open.navigate(target);
      }
      return self.clients.openWindow(target);
    })(),
  );
});
