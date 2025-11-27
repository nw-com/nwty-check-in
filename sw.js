const CACHE_NAME = 'nw-patrol-v2';
const ASSETS = [
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'logo.svg'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (ASSETS.some(a=>url.pathname.endsWith(a))) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then(c => c.put(e.request, copy));
      return res;
    })));
    return;
  }
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
