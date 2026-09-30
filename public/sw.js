/* KLIPD service worker: web push and notification taps. No offline caching on purpose. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "KLIPD", body: event.data ? event.data.text() : "" }; }
  event.waitUntil(
    self.registration.showNotification(data.title || "KLIPD", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/home" },
      tag: data.tag || "klipd",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/home";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) { w.navigate(url).catch(() => {}); return w.focus(); }
      }
      return self.clients.openWindow(url);
    }),
  );
});
