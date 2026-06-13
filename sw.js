/*
 * FitLog Service Worker
 * アプリの“殻”（HTML/CSS/JS/Chart.js/アイコン）をキャッシュし、
 * オフライン（電波のない出先）でも起動できるようにする。
 * データは IndexedDB 側にあり、ここでは扱わない。
 */

const CACHE = "fitlog-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./store.js",
  "./app.js",
  "./chart.min.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// キャッシュ優先（無ければネット取得してキャッシュ）。完全オフラインで動く。
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => hit);
    })
  );
});
