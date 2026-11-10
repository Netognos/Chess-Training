// Two extra kinds of test positions:
//  - style: several good moves of a different character (attack / solid / positional / simplifying / book move).
//    There is no single right answer: the test records which kind of move you choose.
//  - deep: a long forced line where EVERY move, yours and your opponent's, is the only good move.
//    You put the whole line on the board; the score is how many half-moves you got right in a row.
import { Chess } from "./vendor/chess.js";
import { Board } from "./board.js";
import { LineBuilder, fmt } from "./lines.js";
import { styleOf, STYLES } from "./style.js";
import { lineToCp, winPct } from "./engine.js";

let EXTRA = null;
export async function extraBank() { if (!EXTRA) EXTRA = await import("./extrabank.js"); return EXTRA; }

export async function pickExtra(kind, used, target, avoid = new Set()) {
  const B = await extraBank();
  if (kind === "style") {
    const all = B.STYLEPOS.filter((x) => !used.has(x.id)), unseen = all.filter((x) => !avoid.has(x.id));
    const pool = unseen.length >= 3 ? unseen : all;
    const openings = used.size % 2 === 0; // alternate openings and middlegames
    const pref = pool.filter((x) => (x.src === "opening") === openings);
    const rich = (pref.length ? pref : pool).filter((x) => x.rich); // prefer positions with an attacking option or 3 different kinds
    const list = rich.length && Math.random() < 0.75 ? rich : pref.length ? pref : pool;
    return list[Math.floor(Math.random() * list.length)];
  }
  const fresh = B.DEEP.filter((x) => !used.has(x.id)), unseen = fresh.filter((x) => !avoid.has(x.id));
  const pool = (unseen.length >= 3 ? unseen : fresh).sort((a, b) => Math.abs(a.r - target) - Math.abs(b.r - target)).slice(0, 6);
  return pool[Math.floor(Math.random() * pool.length)];
}

const ev = (cp) => (Math.abs(cp) >= 9000 ? (cp > 0 ? "mate" : "−mate") : (cp >= 0 ? "+" : "") + (cp / 100).toFixed(1));
const sanOf = (fen, uci) => { try { return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san; } catch { return uci; } };

// ------------------------------------------------------------------ STYLE
export async function runStyle(v, C, { it, title, onRecord, nextLabel, onNext }) {
  const fen = it.fen, stm = fen.split(" ")[1];
  v.innerHTML = `<div class="two"><div><div id="tb"></div></div>
    <div><div class="card"><h2>${C.esc(title)}</h2>
      <div class="row" style="justify-content:space-between"><b>${stm === "w" ? "White" : "Black"} to move</b><span class="pill" id="timer">0:00</span></div>
      <p class="small"><b>Style position.</b> Several moves are good here, each of a different kind. There's no wrong answer among them: play the move <b>you</b> would choose in a game. The test records which kind of move you prefer.${it.src === "opening" && it.name ? `<br><span class="muted">Opening: ${C.esc(it.name)}</span>` : ""}</p>
      <label class="small">Why this move? (optional)</label><textarea id="why" rows="2" placeholder="e.g. develop first, attack later…"></textarea>
      <p class="small muted">Play your move on the board.</p>
      <div id="tfb"></div></div></div></div>`;
  const brd = new Board(v.querySelector("#tb")); brd.setFen(fen); brd.setOrientation(stm);
  const t0 = Date.now();
  const timer = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); const el = v.querySelector("#timer"); if (!el) return clearInterval(timer); el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }, 500);
  brd.onMove = async (mv) => {
    brd.locked = true; clearInterval(timer);
    const uci = mv.from + mv.to + (mv.promotion || "");
    const timeMs = Date.now() - t0;
    const fb = v.querySelector("#tfb");
    fb.innerHTML = `<div class="feedback info">Stockfish is checking your move…</div>`;
    const theory = (it.theory || []).includes(uci);
    const st = styleOf(fen, uci, { theory });
    const best = Math.max(...it.opts.map((o) => o.cp));
    let cp = it.opts.find((o) => o.uci === uci)?.cp;
    if (cp == null) {
      const c = new Chess(fen); c.move(mv.san);
      if (c.isCheckmate()) cp = 10000; else { const [l] = await C.engine().analyse(c.fen(), { movetime: 800 }); cp = -lineToCp(l); }
    }
    const drop = Math.max(0, winPct(best) - winPct(cp));
    const sound = drop < 5;
    const score = sound ? 1 : drop < 10 ? 0.5 : 0;
    const rec = { id: it.id, kind: "style", cat: "style", rating: null, fen, score, move: mv.san, style: st.primary, theory, sound, drop: +drop.toFixed(1), timeMs, why: v.querySelector("#why").value, src: it.src };
    onRecord(rec);
    const opts = it.opts.slice().sort((a, b) => b.cp - a.cp);
    fb.innerHTML = `<div class="feedback ${sound ? "ok" : drop < 10 ? "info" : "no"}"><b>${C.esc(mv.san)}</b>: ${C.esc(STYLES[st.primary].label)}${theory ? " · <b>book move</b>" : ""} ${sound ? "✓ a good move" : drop < 10 ? `(a bit weaker: −${drop.toFixed(0)}% win chance)` : `✗ this one isn't sound here (−${drop.toFixed(0)}% win chance)`}</div>
      <div class="card" style="margin-top:10px"><h3 style="margin-top:0">The good moves in this position</h3>
        <table class="small" style="width:100%"><tr><th align="left">Move</th><th align="left">Kind</th><th align="left">Eval</th></tr>
        ${opts.map((o) => `<tr${o.uci === uci ? ' style="font-weight:700"' : ""}><td>${C.esc(o.san)}${o.uci === uci ? " ← you" : ""}</td><td>${C.esc(STYLES[o.primary]?.label || o.primary)}${o.theory ? " · book" : ""}</td><td>${ev(o.cp)}</td></tr>`).join("")}</table>
        <p class="small muted">${Object.entries(STYLES).map(([, s]) => `<b>${s.label}</b>: ${s.desc}`).join(" · ")}</p></div>
      <div class="row" style="margin-top:10px"><button class="btn" id="nextIt">${C.esc(nextLabel)}</button></div>`;
    v.querySelector("#nextIt").onclick = onNext;
    fb.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  };
}

// ------------------------------------------------------------------ DEEP
export async function runDeep(v, C, { it, title, onRecord, nextLabel, onNext }) {
  const fen = it.fen, stm = fen.split(" ")[1];
  const sol = it.sol, solSan = it.san;
  v.innerHTML = `<div class="two"><div><div id="tb"></div><div id="lbox"></div><div class="row" style="margin-top:8px" id="stepBtns"></div></div>
    <div><div class="card"><h2>${C.esc(title)}</h2>
      <div class="row" style="justify-content:space-between"><b>${stm === "w" ? "White" : "Black"} to move</b><span class="pill" id="timer">0:00</span></div>
      <p class="small"><b>Deep calculation.</b> In this line <b>every</b> move — yours and your opponent's — is the only good move: any other move throws away the win or loses. The line is ${Math.ceil(sol.length / 2)} of your moves long (${sol.length} half-moves). Put it on the board as far as you can see (the pieces stay put), including your opponent's only replies, then submit.</p>
      <label class="small">Your line</label><input id="line" placeholder="or type it: e.g. Rxf7 Kxf7 Qh5+ …" style="width:100%">
      <div class="row" style="margin-top:8px"><button class="btn" id="submit">Submit</button></div><div id="perr" class="small" style="color:var(--bad)"></div>
      <div id="tfb"></div></div></div></div>`;
  const brd = new Board(v.querySelector("#tb")); brd.setFen(fen); brd.setOrientation(stm);
  const inp = v.querySelector("#line");
  const lb = new LineBuilder({ board: brd, rootFen: fen, el: v.querySelector("#lbox"), esc: C.esc, maxLines: 1, onChange: () => { if (!inp.dataset.manual) inp.value = lb.mainSan(); } });
  inp.oninput = () => { if (inp.value.trim()) inp.dataset.manual = "1"; else delete inp.dataset.manual; };
  const t0 = Date.now();
  const timer = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); const el = v.querySelector("#timer"); if (!el) return clearInterval(timer); el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }, 500);
  // engine already looks at the start position while you think
  C.engine().analyse(fen, { movetime: 600 }).catch(() => {});
  v.querySelector("#submit").onclick = async () => {
    const moves = parse(fen, inp.value);
    if (moves.error) { v.querySelector("#perr").textContent = `"${moves.error}" is not a legal move at that point of your line.`; return; }
    if (!moves.list.length) { v.querySelector("#perr").textContent = "Put at least your first move on the board."; return; }
    clearInterval(timer); lb.destroy(); v.querySelector("#lbox").innerHTML = ""; brd.locked = true;
    v.querySelector("#submit").disabled = true; v.querySelector("#perr").textContent = "";
    const timeMs = Date.now() - t0;
    const fb = v.querySelector("#tfb");
    fb.innerHTML = `<div class="feedback info">Checking your line…</div>`;
    const rows = []; let ok = 0, broke = null; const c = new Chess(fen);
    for (let k = 0; k < sol.length; k++) {
      const u = moves.list[k];
      if (!u) { rows.push({ k, sol: solSan[k], you: null, res: "–" }); continue; }
      if (broke !== null) { rows.push({ k, sol: solSan[k], you: u.san, res: "–" }); continue; }
      if (u.uci === sol[k]) { rows.push({ k, sol: solSan[k], you: u.san, res: "✓" }); ok++; c.move(u.san); continue; }
      // a different move: is it really worse? (only moves were selected, but check anyway)
      const pos = c.fen(); const t = new Chess(pos); t.move(u.san);
      let note = "";
      try {
        const [b] = await C.engine().analyse(pos, { movetime: 600 });
        let after; if (t.isCheckmate()) after = 10000; else { const [l] = await C.engine().analyse(t.fen(), { movetime: 600 }); after = -lineToCp(l); }
        const drop = winPct(lineToCp(b)) - winPct(after);
        if (drop < 3) { rows.push({ k, sol: solSan[k], you: u.san, res: "≈", note: "also good: you leave the solution here" }); ok++; broke = k; continue; }
        note = k % 2 === 0 ? `loses ${drop.toFixed(0)}% win chance (${ev(after)})` : `for your opponent ${solSan[k]} was the only move; ${u.san} loses quicker`;
      } catch { /* engine busy */ }
      rows.push({ k, sol: solSan[k], you: u.san, res: "✗", note }); broke = k;
    }
    const score = ok / sol.length;
    const rec = { id: it.id, kind: "deep", cat: "Deep calculation", rating: it.r, fen, score, depthPlies: ok, totalPlies: sol.length, userPlies: moves.list.length, move: moves.list[0].san, line: fmt(fen, moves.list), solution: solSan.join(" "), timeMs, nMine: Math.ceil(sol.length / 2) };
    onRecord(rec);
    const firstMiss = rows.find((r) => r.res === "✗" || (r.res === "–" && r.you === null));
    const num = (k) => { const [, side, , , , n] = fen.split(" "); const idx = k + (side === "b" ? 1 : 0); return `${(+n || 1) + Math.floor(idx / 2)}${idx % 2 ? "…" : "."}`; };
    fb.innerHTML = `<div class="feedback ${score >= 0.99 ? "ok" : score >= 0.5 ? "info" : "no"}"><b>You saw ${ok} of ${sol.length} half-moves${ok >= sol.length ? " — the whole line!" : ""}</b> (${Math.floor((ok + 1) / 2)} of your ${Math.ceil(sol.length / 2)} moves${ok > 1 ? `, and ${Math.floor(ok / 2)} only ${Math.floor(ok / 2) === 1 ? "reply" : "replies"} of your opponent` : ""}).
      ${firstMiss ? `<br>${firstMiss.you ? (firstMiss.k % 2 ? `At ${num(firstMiss.k)} you expected ${C.esc(firstMiss.you)} from your opponent, but their only move is <b>${C.esc(firstMiss.sol)}</b> (${C.esc(firstMiss.you)} loses quicker for them).` : `At ${num(firstMiss.k)} you played ${C.esc(firstMiss.you)}, but the only move was <b>${C.esc(firstMiss.sol)}</b>${firstMiss.note ? ` (${C.esc(firstMiss.note)})` : ""}.`) : `Your line stopped at ${num(firstMiss.k)}: the next only move is <b>${C.esc(firstMiss.sol)}</b>.`}` : ""}
      <br><span class="small">Score: ${Math.round(score * 100)}% · time ${Math.round(timeMs / 1000)} s · rating ≈ ${it.r}</span></div>
      <div class="card" style="margin-top:10px"><h3 style="margin-top:0">Move by move</h3>
      <table class="small" style="width:100%"><tr><th align="left">#</th><th align="left">Only move</th><th align="left">You</th><th></th></tr>
      ${rows.map((r) => `<tr><td>${num(r.k)}${r.k % 2 ? " <span class='muted'>(opp.)</span>" : ""}</td><td>${C.esc(r.sol)}${it.only?.[r.k] === 2 ? " <span class='muted'>(forced)</span>" : ""}</td><td>${r.you ? C.esc(r.you) : "<span class='muted'>–</span>"}</td><td>${r.res}</td></tr>`).join("")}</table></div>
      <div class="row" style="margin-top:10px"><button class="btn" id="nextIt">${C.esc(nextLabel)}</button></div>`;
    // play through the solution
    let i = 0; const b = v.querySelector("#stepBtns");
    b.innerHTML = `<button class="btn secondary small" id="sBack">◀</button><button class="btn secondary small" id="sFwd">▶ Play through the solution</button>`;
    const draw = () => { const cc = new Chess(fen); let last = null; for (let k = 0; k < i; k++) { const m = cc.move(solSan[k]); last = [m.from, m.to]; } brd.setFen(cc.fen(), { last }); };
    b.querySelector("#sBack").onclick = () => { i = Math.max(0, i - 1); draw(); };
    b.querySelector("#sFwd").onclick = () => { i = Math.min(solSan.length, i + 1); draw(); };
    v.querySelector("#nextIt").onclick = onNext;
    fb.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  };
}

function parse(fen, text) {
  const c = new Chess(fen); const list = [];
  const toks = (text || "").replace(/…/g, "...").replace(/[,;]/g, " ").split(/\s+/).map((t) => t.replace(/^\d+\.(\.\.)?/, "").replace(/[!?]+$/, "")).filter((t) => t && !/^\d+\.*$/.test(t));
  for (const raw of toks) {
    const t = raw.replace(/^0-0-0/, "O-O-O").replace(/^0-0/, "O-O").replace(/^([DTLP])/, (m) => ({ D: "Q", T: "R", L: "B", P: "N" }[m])).replace(/=([DTLP])/, (m, x) => "=" + { D: "Q", T: "R", L: "B", P: "N" }[x]);
    let mv = null; try { mv = c.move(t, { strict: false }); } catch { mv = null; }
    if (!mv && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(raw)) { try { mv = c.move({ from: raw.slice(0, 2), to: raw.slice(2, 4), promotion: raw[4] }); } catch { mv = null; } }
    if (!mv) return { list, error: raw };
    list.push({ san: mv.san, uci: mv.from + mv.to + (mv.promotion || "") });
  }
  return { list, error: null };
}
export { sanOf };
