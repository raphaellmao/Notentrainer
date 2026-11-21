// Service Worker: macht die App offline nutzbar.
//
// Strategie „erst Netz, dann Cache“: Mit Internet kommt immer die aktuelle Fassung
// (und landet gleich im Cache), ohne Internet die zuletzt gespeicherte. Updates
// kommen damit auch an, wenn man vergisst, VERSION zu erhöhen.
// VERSION trotzdem bei jeder Veröffentlichung erhöhen: Dann installiert sich ein
// neuer Service Worker, lädt alle Dateien frisch vor und löscht die alten Caches.

const VERSION = '1.4.0';
const CACHE = `notentrainer-${VERSION}`;
const FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/audio.js',
  './js/clefs.js',
  './js/keyboard.js',
  './js/notes.js',
  './js/mic.js',
  './js/pitch.js',
  './js/staff.js',
  './js/trainer.js',
  './notentabelle.html',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('notentrainer-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  let copy = null;
  const network = fetch(request).then((response) => {
    if (response.ok && response.type === 'basic' && !response.redirected) copy = response.clone();
    return response;
  });
  event.waitUntil(
    network.then(() => copy && caches.open(CACHE).then((cache) => cache.put(request, copy))).catch(() => {}),
  );
  event.respondWith(networkOrCache(request, network));
});

async function networkOrCache(request, network) {
  try {
    return await withTimeout(network, 4000);
  } catch {
    const cache = await caches.open(CACHE);
    const cached =
      (await cache.match(request, { ignoreSearch: true })) ||
      (request.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    return cached || network; // nichts gespeichert: weiter aufs Netz warten
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Zeitüberschreitung')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
