// Service worker: makes Chess Coach installable and usable offline.
// Bump VERSION on every release so installed apps pick up the new files.
const VERSION = "cc-v28";
const CORE = [
  "./", "index.html", "style.css", "manifest.webmanifest",
  "app.js", "analysis.js", "board.js", "coach.js", "data.js", "engine.js", "pieces.js", "reader.js", "explain.js", "ai.js", "lines.js", "explorer.js", "tb.js", "families.js", "openingtable.js",
  "openings.js", "openingsview.js", "style.js", "testextra.js", "test.js", "fonts/archivo.woff2", "vendor/chess.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-192.png", "icons/maskable-512.png", "icons/apple-touch-icon.png",
];
// big files: fetched in the background after installing, so the first visit isn't slowed down
const HEAVY = ["vendor/stockfish/stockfish-19-lite-single.js", "vendor/stockfish/stockfish-19-lite-single.wasm", "testbank.js", "extrabank.js", "book.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  const cleanup = caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim());
  // the big files are fetched right after: the app is already usable, waitUntil keeps the worker alive until they are cached
  const heavy = caches.open(VERSION).then((c) => Promise.all(HEAVY.map((u) => c.match(u).then((hit) => hit || c.add(u).catch(() => {})))));
  e.waitUntil(Promise.all([cleanup, heavy]));
});
// After one request timed out, the connection is clearly bad: for the next 30 s cached files are used straight
// away (and refreshed in the background), so a page with many modules doesn't wait 3 s for each one.
let slowUntil = 0;
// Same-origin files: network first (so updates arrive) but never wait longer than 3 s on a bad connection;
// then the cached copy is used. Other origins (Lichess / Chess.com / Gemini APIs) are not touched.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const net = fetch(e.request, { cache: "no-cache" }).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; });
    net.catch(() => {});
    const cached = await cache.match(e.request, { ignoreSearch: true });
    if (!cached) return net.catch(() => caches.match("index.html"));
    if (Date.now() < slowUntil) return cached;
    const timeout = new Promise((res) => setTimeout(() => res(null), 3000));
    try { const r = await Promise.race([net, timeout]); if (!r) slowUntil = Date.now() + 30000; return r || cached; } catch { return cached; }
  })());
});
