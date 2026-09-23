self.addEventListener("push", event => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || "2ND Students", {
      body: data.body || "Time to pray for your students 🙏",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "prayer-reminder",
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});
