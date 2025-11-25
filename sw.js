self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { self.clients.claim(); });
self.addEventListener('push', (e) => {
  const data = e.data ? e.data.json() : {};
  const title = data.title || '通知';
  const opts = { body: data.body || '', icon: data.icon || 'favicon.svg', data: data.data || {} };
  e.waitUntil(self.registration.showNotification(title, opts));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if (c.focus) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow('/');
  }));
});
self.addEventListener('message', (e) => {
  const payload = e.data || {};
  const title = payload.title || '通知';
  const opts = { body: payload.body || '', icon: payload.icon || 'favicon.svg', data: payload.data || {} };
  self.registration.showNotification(title, opts);
});
