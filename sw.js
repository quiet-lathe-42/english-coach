// Service worker : met l'application en cache pour qu'elle marche hors ligne.
// Change VERSION à chaque mise à jour des fichiers pour forcer le rafraîchissement.
const VERSION = 'ec-v2';
const FICHIERS = [
  './', 'index.html', 'styles.css', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/db.js', 'js/adaptation.js', 'js/voix.js', 'js/correction.js', 'js/bilans.js', 'js/exercices.js',
  'data/ce.json', 'data/co.json', 'data/ee.json', 'data/eo.json',
  'data/vocab.json', 'data/indien.json', 'data/liens.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(cles => Promise.all(cles.filter(c => c !== VERSION).map(c => caches.delete(c))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // LanguageTool passe directement
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
