// ごはんマップ service worker
// - アプリ本体は先に保存しておき、電波がなくても開けるようにする
// - 地図の画像は見た分だけ保存し、2回目からは保存分を使う（上限あり）

const VERSION = 'v6';
const APP_CACHE = `gohanmap-app-${VERSION}`;
const TILE_CACHE = 'gohanmap-tiles';
const TILE_MAX = 1500; // 地図画像の保存上限（だいたい 30〜50MB）

// アプリ本体として先に保存するもの
const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

// 古い版の保存分を消す
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k.startsWith('gohanmap-app-') && k !== APP_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 地図の画像：保存分があればそれ、なければ取りに行って保存
  if (url.hostname === 'cyberjapandata.gsi.go.jp') {
    e.respondWith(tileFirst(req));
    return;
  }
  // 画面（HTML）：まず最新を取りに行き、だめなら保存分
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => { putApp(req, res.clone()); return res; })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
  // それ以外（Leaflet・フォント・アイコン）：保存分を先に使う
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') putApp(req, res.clone());
      return res;
    }))
  );
});

function putApp(req, res) {
  caches.open(APP_CACHE).then(c => c.put(req, res)).catch(() => {});
}

async function tileFirst(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) { await cache.put(req, res.clone()); trimTiles(cache); }
    return res;
  } catch (err) {
    return new Response('', { status: 504 });
  }
}

// 上限を超えたら古い順に消す
async function trimTiles(cache) {
  const keys = await cache.keys();
  if (keys.length <= TILE_MAX) return;
  for (const k of keys.slice(0, keys.length - TILE_MAX)) await cache.delete(k);
}
