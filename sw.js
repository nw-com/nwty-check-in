self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { self.clients.claim(); });
self.addEventListener('push', (e) => {
  e.waitUntil(Promise.resolve());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if (c.focus) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow('/');
  }));
});
self.addEventListener('message', (e) => {
  // disabled
});
