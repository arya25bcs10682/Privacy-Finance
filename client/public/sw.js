// PrivacyFinance Web Push & Bill Reminder Service Worker
// Operates client-side for zero-knowledge notifications without plaintext leakage to third parties

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle incoming Web Push events
self.addEventListener("push", (event) => {
  let payload = {
    title: "Bill Reminder",
    body: "You have an upcoming subscription or bill due soon.",
  };

  try {
    if (event.data) {
      payload = event.data.json();
    }
  } catch {
    if (event.data) {
      payload.body = event.data.text();
    }
  }

  const options = {
    body: payload.body,
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    data: { url: "/bills" },
    tag: "bill-reminder",
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

// Navigate to Bills page when notification is clicked
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/bills";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes("/bills") && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
