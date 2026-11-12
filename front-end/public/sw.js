/* No page/data caching: authenticated content always comes from the server. */
self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch {}
  event.waitUntil(self.registration.showNotification("FMLCore", {
    body: "You have new activity. Open FMLCore to see it.",
    icon: "/image/logo.png",
    badge: "/image/logo.png",
    tag: "fmlcore-activity",
    data: { url: payload.url === "/chat" ? "/chat" : "/notifications" },
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url === "/chat" ? "/chat" : "/notifications", self.location.origin).href;
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const tab = tabs.find(client => new URL(client.url).origin === self.location.origin);
    if (tab) { await tab.navigate(url); await tab.focus(); }
    else await self.clients.openWindow(url);
  })());
});
