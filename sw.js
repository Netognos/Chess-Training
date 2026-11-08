// Service worker: makes Chess Coach installable and usable offline.
// Bump VERSION on every release so installed apps pick up the new files.
const VERSION = "cc-v13";
const CORE = [
  "./", "index.html", "style.css", "manifest.webmanifest",
  "app.js", "analysis.js", "board.js", "coach.js", "data.js", "engine.js", "pieces.js", "reader.js", "explain.js", "ai.js", "lines.js", "test.js", "testbank.js",
  "vendor/chess.js", "vendor/stockfish/stockfish-19-lite-single.js", "vendor/stockfish/stockfish-19-lite-single.wasm",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-192.png", "icons/maskable-512.png", "icons/apple-touch-icon.png",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Same-origin files: network first (so updates arrive), fall back to cache when offline.
// Other origins (Lichess / Chess.com APIs) are not touched.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
