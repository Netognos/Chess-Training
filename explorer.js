// Opening book / explorer for any position:
//  - Book: the named lines of the Lichess opening list (offline, always available)
//  - Masters / Lichess: game statistics from the Lichess opening explorer (needs a free personal Lichess token)
//  - My games: what you played here in your analysed games
import { Chess } from "./vendor/chess.js";

const TOKEN_KEY = "chesscoach.lichessToken";
export const lichessToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } };
export const setLichessToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} };

const key = (fen) => fen.split(" ").slice(0, 4).join(" ");
let BOOK = null;
async function book() { if (!BOOK) BOOK = (await import("./book.js")).BOOK; return BOOK; }

export async function bookInfo(fen) {
  const B = await book(); const e = B[key(fen)];
  if (!e) return { eco: null, name: null, moves: [] };
  const moves = e[2] ? e[2].split(";").map((s) => { const [uci, san, n] = s.split(","); const c = new Chess(fen); c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); const nx = B[key(c.fen())]; return { uci, san, lines: +n, name: nx?.[1] || null, eco: nx?.[0] || null }; }) : [];
  return { eco: e[0], name: e[1], moves };
}
// name of the opening for a sequence of positions: the last named position on the way
export async function openingName(fens) { const B = await book(); for (let i = fens.length - 1; i >= 0; i--) { const e = B[key(fens[i])]; if (e?.[1]) return { eco: e[0], name: e[1] }; } return null; }

const cache = new Map();
export async function lichessStats(fen, db) {
  const tok = lichessToken(); if (!tok) return { error: "token" };
  const url = db === "masters" ? `https://explorer.lichess.ovh/masters?fen=${encodeURIComponent(fen)}&moves=12`
    : `https://explorer.lichess.ovh/lichess?variant=standard&speeds=blitz,rapid,classical&ratings=1800,2000,2200,2500&moves=12&fen=${encodeURIComponent(fen)}`;
  if (cache.has(url)) return cache.get(url);
  let res;
  try {
    const r = await fetch(url, { headers: { Authorization: "Bearer " + tok } });
    if (r.status === 401) res = { error: "badtoken" };
    else if (r.status === 429) res = { error: "busy" };
    else if (!r.ok) res = { error: "http", status: r.status };
    else res = await r.json();
  } catch { res = { error: "offline" }; }
  if (!res.error) cache.set(url, res);
  return res;
}

// your own games: position → { uci → { san, n, score } } (only games analysed with a version that stores the opening moves)
const ownCache = new WeakMap();
function ownIndex(p) {
  const games = Object.values(p.games || {});
  const sig = games.length;
  const c0 = ownCache.get(p); if (c0 && c0.sig === sig) return c0;
  const idx = new Map(); let withLine = 0;
  for (const g of games) {
    if (!Array.isArray(g.line) || !g.line.length) continue;
    withLine++;
    const c = new Chess();
    for (const uci of g.line) {
      const k = key(c.fen()); let m;
      try { m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch { break; }
      const node = idx.get(k) || new Map(); idx.set(k, node);
      const e = node.get(uci) || { san: m.san, n: 0, score: 0, asW: 0 }; e.n++; e.score += g.score; if (g.color === "w") e.asW++; node.set(uci, e);
    }
  }
  const res = { sig, idx, withLine, total: games.length }; ownCache.set(p, res); return res;
}
export function ownStats(p, fen) { const o = ownIndex(p); const node = o.idx.get(key(fen)); return { moves: node ? [...node.entries()].map(([uci, e]) => ({ uci, ...e })).sort((a, b) => b.n - a.n) : [], withLine: o.withLine, total: o.total }; }

// ---------------------------------------------------------------- UI panel
const pct = (a, n) => (n ? Math.round((100 * a) / n) : 0);
function wdl(w, d, b) { const n = w + d + b; return `<div class="wdl" title="White ${pct(w, n)}% · draw ${pct(d, n)}% · Black ${pct(b, n)}%"><i style="width:${pct(w, n)}%" class="w">${pct(w, n) >= 12 ? pct(w, n) + "%" : ""}</i><i style="width:${pct(d, n)}%" class="d">${pct(d, n) >= 12 ? pct(d, n) + "%" : ""}</i><i style="width:${pct(b, n)}%" class="b">${pct(b, n) >= 12 ? pct(b, n) + "%" : ""}</i></div>`; }
const fmtN = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "k" : String(n));

// mount the explorer into `el`. getFen() → current FEN; onMove(uci) when a move is clicked; p = player (optional)
export function mountExplorer(el, { getFen, onMove, p, esc, go }) {
  let tab = (() => { try { return localStorage.getItem("chesscoach.exTab") || "book"; } catch { return "book"; } })();
  let token = 0;
  const render = async () => {
    const my = ++token; const fen = getFen();
    const tabs = [["book", "Book"], ["masters", "Masters"], ["lichess", "Lichess 1800+"], ...(p ? [["mine", "My games"]] : [])];
    el.innerHTML = `<div class="extabs">${tabs.map(([k, l]) => `<button class="chip ${k === tab ? "on" : ""}" data-ex="${k}">${l}</button>`).join("")}</div><div class="exbody small muted">Loading…</div>`;
    el.querySelectorAll("[data-ex]").forEach((b) => (b.onclick = () => { tab = b.dataset.ex; try { localStorage.setItem("chesscoach.exTab", tab); } catch {} render(); }));
    const body = el.querySelector(".exbody");
    const rows = (list) => `<table class="extable">${list}</table>`;
    const bind = () => body.querySelectorAll("[data-uci]").forEach((r) => (r.onclick = () => onMove(r.dataset.uci)));
    if (tab === "book") {
      const b = await bookInfo(fen); if (my !== token) return;
      body.innerHTML = `${b.name ? `<p class="exname"><b>${esc(b.eco)}</b> ${esc(b.name)}</p>` : ""}
        ${b.moves.length ? rows(`<tr><th>Move</th><th>Leads to</th><th title="number of named lines that continue with this move">Lines</th></tr>` + b.moves.map((m) => `<tr data-uci="${m.uci}"><td><b>${esc(m.san)}</b></td><td>${m.name ? `${esc(m.eco)} ${esc(m.name)}` : '<span class="muted">…</span>'}</td><td>${m.lines}</td></tr>`).join(""))
        : `<p class="muted">${b.name ? "End of the book: no named continuations." : "Out of book: this position isn't in the opening list."}</p>`}`;
    } else if (tab === "masters" || tab === "lichess") {
      const r = await lichessStats(fen, tab); if (my !== token) return;
      if (r.error === "token" || r.error === "badtoken") { body.innerHTML = `<p>${r.error === "badtoken" ? "Lichess didn't accept your token." : "Game statistics come from the Lichess opening explorer, which needs a free personal Lichess token."} Create one (no permissions needed) at <a href="https://lichess.org/account/oauth/token/create?description=Chess%20Coach%20explorer" target="_blank" rel="noopener">lichess.org → API access tokens</a> and paste it under ${go ? '<a href="#" id="toAcc">Home → Profile</a>' : "Home → Profile"}.</p>`; const a = body.querySelector("#toAcc"); if (a) a.onclick = (e) => { e.preventDefault(); go("account"); }; return; }
      if (r.error) { body.innerHTML = `<p class="muted">${r.error === "offline" ? "No connection to Lichess." : r.error === "busy" ? "Lichess is busy (too many requests). Try again in a minute." : "Lichess answered with an error (" + (r.status || "") + ")."}</p>`; return; }
      const n = r.white + r.draws + r.black;
      body.innerHTML = `${r.opening ? `<p class="exname"><b>${esc(r.opening.eco)}</b> ${esc(r.opening.name)}</p>` : ""}
        ${r.moves.length ? rows(`<tr><th>Move</th><th>Games</th><th style="width:46%">White · draw · Black</th></tr>` + r.moves.map((m) => { const k = m.white + m.draws + m.black; return `<tr data-uci="${m.uci}"><td><b>${esc(m.san)}</b></td><td>${fmtN(k)} <span class="muted">${pct(k, n)}%</span></td><td>${wdl(m.white, m.draws, m.black)}</td></tr>`; }).join("")) : `<p class="muted">No games in this position.</p>`}
        <p class="muted" style="margin-top:6px">${tab === "masters" ? "Over-the-board games of 2200+ players." : "Lichess blitz, rapid and classical games, players rated 1800 and higher."} ${fmtN(n)} games.</p>`;
    } else {
      const o = ownStats(p, fen);
      body.innerHTML = o.withLine ? (o.moves.length ? rows(`<tr><th>Move</th><th>Games</th><th>Your score</th></tr>` + o.moves.map((m) => `<tr data-uci="${m.uci}"><td><b>${esc(m.san)}</b></td><td>${m.n}</td><td>${pct(m.score, m.n)}%</td></tr>`).join("")) : `<p class="muted">You haven't reached this position in your analysed games.</p>`)
        + (o.withLine < o.total ? `<p class="muted" style="margin-top:6px">${o.total - o.withLine} older games don't have their moves stored. Re-analyse them (Games → "Re-analyse games already analysed") to include them.</p>` : "")
        : `<p class="muted">Your analysed games don't have their moves stored yet. Import or re-analyse games (Games → "Re-analyse games already analysed") to see what you played here.</p>`;
    }
    bind();
  };
  render();
  return { refresh: render };
}
