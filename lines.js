// Line builder: you drag moves on the board, but the pieces stay put. Each move is written into a line;
// a move for the side that isn't to move starts a new (side) line from the latest point where it fits.
import { Chess } from "./vendor/chess.js";
import { lineToCp, winPct } from "./engine.js";

const posAt = (root, moves, n) => { const c = new Chess(root); for (const m of moves.slice(0, n)) c.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] }); return c; };

export const LB_HELP = `<b>How to enter moves</b><ul>
  <li><b>Drag or tap</b> a piece to its square. The pieces stay where they are on the board (you calculate it in your head), but each move counts: after 1.e4 you continue with the pawn from e4.</li>
  <li>Every move is written down as a <b>line</b> under the board. Your opponent's replies go in the same line.</li>
  <li>A move for the side that isn't to move starts a <b>new line</b>: another idea, or another defence you looked at.</li>
  <li><b>★</b> = your main line. On other lines, <b>✓</b> = "I think this works", <b>✗</b> = "I looked at it, it doesn't work". Stockfish checks whether you were right.</li>
  <li><b>↶ Undo</b> takes back one move, <b>⏮ Start</b> jumps to the beginning, tap a move in a line to continue from there.</li></ul>`;
// The bar above the board: which position, who is to move, the clock, and an ⓘ that opens the task over the board.
export function stripHtml(esc, title, stm) {
  return `<div class="tstrip"><span class="tsl"><b>${esc(title)}</b><span class="tsm ${stm === "w" ? "w" : "b"}">${stm === "w" ? "White" : "Black"} to move</span></span>
    <span class="tsr"><span class="pill" id="timer">0:00</span><button class="ibtn" id="tInfo" type="button" aria-label="What to do here">ⓘ What to do</button></span></div>`;
}
// open the task automatically the first time a kind of position is shown
export function bindStrip(v, board, kind, html) {
  const b = v.querySelector("#tInfo"); if (b) b.onclick = () => board.showInfo(html);
  let seen = true; try { seen = localStorage.getItem("chesscoach.info." + kind) === "1"; localStorage.setItem("chesscoach.info." + kind, "1"); } catch {}
  if (!seen) board.showInfo(html);
}

export class LineBuilder {
  constructor({ board, rootFen, el, esc, onChange = () => {}, maxLines = 6 }) {
    this.board = board; this.root = rootFen; this.el = el; this.esc = esc; this.onChange = onChange; this.maxLines = maxLines;
    this.lines = []; this.hist = []; this.cur = -1; this.cursor = 0; this.follow = (() => { try { return localStorage.getItem("chesscoach.follow2") === "1"; } catch { return false; } })();
    this.arrows = (() => { try { return localStorage.getItem("chesscoach.arrows") !== "0"; } catch { return true; } })(); this.main = 0; this.msg = "";
    board.intercept = (f, t, p) => this.move(f, t, p);
    board.targetsFor = (sq) => this.targets(sq);
    board.pieceAt = (sq) => this.pieceAt(sq);
    this.render();
  }
  destroy() { this.board.intercept = null; this.board.targetsFor = null; this.board.pieceAt = null; }
  // the piece that is "really" on a square in the line (even if the board still shows the starting position)
  pieceAt(sq) {
    const moves = this.line ? this.line.moves : []; const start = this.line ? this.cursor : 0;
    for (let k = start; k >= 0; k--) { const c = posAt(this.root, moves, k); const p = c.get(sq); if (p && p.color === c.turn()) return p; }
    return null;
  }
  get line() { return this.lines[this.cur] || null; }
  // where would a move from `from` go? the latest point (from the cursor back) where that piece's side is to move
  _resolve(from, to, promo) {
    const moves = this.line ? this.line.moves : []; const start = this.line ? this.cursor : 0;
    for (let k = start; k >= 0; k--) {
      const c = posAt(this.root, moves, k); const p = c.get(from);
      if (!p || p.color !== c.turn()) continue;
      const legal = c.moves({ square: from, verbose: true }).filter((m) => m.to === to);
      if (to !== null && !legal.length) continue;
      return { k, c, legal, promo };
    }
    return null;
  }
  targets(from) { // every square this piece could go to at some point of the line where its side is to move
    const moves = this.line ? this.line.moves : []; const start = this.line ? this.cursor : 0; const out = new Set();
    for (let k = start; k >= 0; k--) { const c = posAt(this.root, moves, k); const p = c.get(from); if (p && p.color === c.turn()) for (const m of c.moves({ square: from, verbose: true })) out.add(m.to); }
    return [...out];
  }
  move(from, to, promo) {
    const r = this._resolve(from, to, promo);
    if (!r) { this.msg = "That move isn't possible in this line. Remember: pieces that moved in your line are on their new square (follow the arrows)."; this.render(); return; }
    const m = r.c.move({ from, to, promotion: promo || (r.legal[0].promotion ? "q" : undefined) });
    const mv = { san: m.san, uci: m.from + m.to + (m.promotion || "") };
    const prefix = this.line ? this.line.moves.slice(0, r.k) : [];
    this.msg = "";
    if (this.line && r.k === this.line.moves.length) { this.line.moves.push(mv); this.cursor = this.line.moves.length; this.hist.push({ line: this.lines[this.cur], created: false }); }
    else if (this.line && this.line.moves[r.k]?.uci === mv.uci) { this.cursor = r.k + 1; }
    else {
      const nm = prefix.concat([mv]);
      const same = this.lines.findIndex((l) => nm.every((x, i) => l.moves[i]?.uci === x.uci));
      if (same >= 0) { this.cur = same; this.cursor = nm.length; }
      else if (this.lines.length >= this.maxLines) { this.msg = this.maxLines === 1 ? "Only one line here: use Undo or click a move to change it." : `Maximum ${this.maxLines} lines. Delete one first.`; }
      else { const nl = { moves: nm }; this.lines.push(nl); this.cur = this.lines.length - 1; this.cursor = nm.length; this.hist.push({ line: nl, created: true }); }
    }
    this.render(); this.onChange();
  }
  // undo = take back the last move you made, in the order you made them (whatever line it was in)
  undo() {
    const h = this.hist.pop(); if (!h) return;
    const i = this.lines.indexOf(h.line); if (i < 0) return this.undo();
    if (h.created) { this.lines.splice(i, 1); if (this.main === i) this.main = 0; else if (this.main > i) this.main--; }
    else h.line.moves.pop();
    const prev = this.hist.length ? this.lines.indexOf(this.hist[this.hist.length - 1].line) : -1;
    this.cur = h.created ? (prev >= 0 ? prev : this.lines.length - 1) : i; this.cursor = this.line ? this.line.moves.length : 0;
    this.msg = ""; this.render(); this.onChange();
  }
  del(i) {
    const gone = this.lines[i]; this.hist = this.hist.filter((h) => h.line !== gone);
    this.lines.splice(i, 1); if (this.main === i) this.main = 0; else if (this.main > i) this.main--;
    this.cur = Math.min(this.cur, this.lines.length - 1); this.cursor = this.line ? this.line.moves.length : 0; this.render(); this.onChange();
  }
  clear() { this.hist = []; this.lines = []; this.cur = -1; this.cursor = 0; this.main = 0; this.render(); this.onChange(); }
  // what the text fields want: main line + side lines as SAN strings
  mainSan() { const l = this.lines[this.main]; return l ? l.moves.map((m) => m.san).join(" ") : ""; }
  mainMoves() { return this.lines[this.main]?.moves || []; }
  sideLines() { const mm = this.mainMoves(); return this.lines.map((l, i) => ({ i, moves: l.moves, branch: branchAt(mm, l.moves), verdict: l.verdict || null })).filter((x) => x.i !== this.main && x.moves.length); }
  text() { return this.lines.map((l, i) => `${i === this.main ? "Main" : "Line " + (i + 1)}${l.verdict === "bad" ? " (rejected)" : l.verdict === "good" ? " (works)" : ""}: ${fmt(this.root, l.moves)}`).join("\n"); }
  _boardView() {
    const l = this.line;
    if (this.follow && l) { const c = posAt(this.root, l.moves, this.cursor); const m = l.moves[this.cursor - 1]; this.board.setFen(c.fen(), { last: m ? [m.uci.slice(0, 2), m.uci.slice(2, 4)] : null }); }
    else { this.board.setFen(this.root); }
    if (l) { // arrows for the selected line: yours green, the opponent's red; the most recent move strongest
      const to = this.cursor, seg = l.moves.slice(Math.max(0, to - 10), to), base = Math.max(0, to - 10);
      const arr = seg.map((m, j) => ({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), color: (base + j) % 2 === 0 ? "#15781B" : "#B33A3A",
        opacity: j === seg.length - 1 ? 0.9 : (this.follow ? 0.15 : 0.35) + 0.35 * (j + 1) / seg.length, label: base + j + 1 }));
      if (this.follow) arr.push(...l.moves.slice(to, to + 3).map((m, j) => ({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), color: (to + j) % 2 === 0 ? "#15781B" : "#B33A3A", opacity: 0.3, label: to + j + 1 })));
      this.board.setArrows(this.arrows ? arr : []);
      if (!this.follow && this.cursor) { const m = l.moves[this.cursor - 1]; this.board.last = [m.uci.slice(0, 2), m.uci.slice(2, 4)]; this.board.render(); }
    }
  }
  render() {
    const E = this.esc;
    this._boardView();
    const rows = this.lines.map((l, i) => {
      const moves = fmtTokens(this.root, l.moves).map((t, j) => `${t.no ? `<span class="muted">${t.no}</span>` : ""}<a href="#" class="lbm${i === this.cur && j + 1 === this.cursor ? " on" : ""}" data-l="${i}" data-p="${j + 1}">${E(t.san)}</a>`).join(" ");
      return `<div class="lbrow${i === this.cur ? " cur" : ""}" data-l="${i}"><button class="lbstar${i === this.main ? " on" : ""}" data-main="${i}" title="Make this the main line">${i === this.main ? "★" : "☆"}</button>
        <span class="lbno" data-sel="${i}">${i === this.main ? "Main" : "Line " + (i + 1)}</span><span class="lbmoves">${moves}</span>
        ${i === this.main ? "" : `<span class="lbv"><button class="lbok${l.verdict === "good" ? " on" : ""}" data-v="${i}:good" title="I think this works">✓</button><button class="lbbad${l.verdict === "bad" ? " on" : ""}" data-v="${i}:bad" title="I looked at this, but it doesn't work">✗</button></span>`}<button class="lbdel" data-del="${i}" title="Delete line">🗑</button></div>`;
    }).join("");
    this.el.innerHTML = `<div class="lb">
      <div class="small muted lbhint">${this.lines.length ? "Green arrows = your moves, red = your opponent's. ★ main line · ✓/✗ other lines." : "Drag or tap your moves; the pieces stay put but each move counts."} <button class="linkbtn lbhelp" type="button">ⓘ How?</button></div>
      ${rows}
      ${this.msg ? `<div class="small" style="color:var(--bad)">${E(this.msg)}</div>` : ""}
      <div class="row small" style="margin-top:6px;gap:10px"><button class="btn secondary small" data-act="undo" ${this.hist.length ? "" : "disabled"}>↶ Undo move</button><button class="btn secondary small" data-act="new" ${this.line ? "" : "disabled"}>+ New line</button>
        <button class="btn secondary small" data-act="start" ${this.line && this.cursor ? "" : "disabled"}>⏮ Start</button><label class="row small"><input type="checkbox" data-act="arrows" ${this.arrows ? "checked" : ""}> Arrows</label><label class="row small"><input type="checkbox" data-act="follow" ${this.follow ? "checked" : ""}> Move the pieces on the board</label>${this.lines.length ? `<button class="btn secondary small" data-act="clear">Clear all</button>` : ""}</div></div>`;
    const hb = this.el.querySelector(".lbhelp"); if (hb) hb.onclick = () => this.board.showInfo(LB_HELP);
    this.el.querySelectorAll(".lbm").forEach((a) => (a.onclick = (e) => { e.preventDefault(); this.cur = +a.dataset.l; this.cursor = +a.dataset.p; this.render(); }));
    this.el.querySelectorAll("[data-sel]").forEach((a) => (a.onclick = () => { this.cur = +a.dataset.sel; this.cursor = this.line.moves.length; this.render(); }));
    this.el.querySelectorAll("[data-main]").forEach((b) => (b.onclick = () => { this.main = +b.dataset.main; this.render(); this.onChange(); }));
    this.el.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => { const [i, val] = b.dataset.v.split(":"); const l = this.lines[+i]; l.verdict = l.verdict === val ? null : val; this.render(); this.onChange(); }));
    this.el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => this.del(+b.dataset.del)));
    const act = (k) => this.el.querySelector(`[data-act="${k}"]`);
    act("undo").onclick = () => this.undo();
    act("new").onclick = () => { this.cur = -1; this.cursor = 0; this.msg = "Your next move starts a new line from the starting position."; this.render(); };
    act("start").onclick = () => { this.cursor = 0; this.render(); };
    act("arrows").onchange = (e) => { this.arrows = e.target.checked; try { localStorage.setItem("chesscoach.arrows", this.arrows ? "1" : "0"); } catch {} this.render(); };
    act("follow").onchange = (e) => { this.follow = e.target.checked; try { localStorage.setItem("chesscoach.follow2", this.follow ? "1" : "0"); } catch {} this.render(); };
    if (act("clear")) act("clear").onclick = () => this.clear();
  }
}

function fmtTokens(root, moves) {
  const parts = root.split(" "); let no = +parts[5] || 1; let side = parts[1];
  return moves.map((m, j) => { const t = { san: m.san, no: side === "w" ? `${no}.` : j === 0 ? `${no}…` : "" }; if (side === "b") no++; side = side === "w" ? "b" : "w"; return t; });
}
export const fmt = (root, moves) => fmtTokens(root, moves).map((t) => (t.no ? t.no + " " : "") + t.san).join(" ").replace(/\. /g, ".").replace(/… /g, "…");

export const branchAt = (main, moves) => { let b = 0; while (b < moves.length && b < main.length && main[b].uci === moves[b].uci) b++; return b; };

// Engine check of an extra line from the point where it leaves the main line (ply `from`).
// A different move of yours there = another idea; a different opponent move = another defence: is it a real defence,
// and does your answer to it hold? If the line stops after their move, the engine's answer is given.
// gradeMove(fen, uci, ms) → { drop, bestLine, afterCp }; eng.analyse for the missing answer.
export async function checkLine(gradeMove, root, moves, { ms = 500, maxPlies = 10, from = 0, eng = null } = {}) {
  const c = new Chess(root); const me = c.turn(); const notes = []; let holds = true, stopped = null, endCp = null, answer = null;
  for (const m of moves.slice(0, from)) c.move(m.san);
  const kind = from % 2 === 0 ? "idea" : "defence";
  const end = Math.min(moves.length, from + maxPlies);
  for (let k = from; k < end; k++) {
    const m = moves[k]; const fen = c.fen(); const mine = k % 2 === 0;
    const test = new Chess(fen); test.move(m.san);
    if (test.isCheckmate()) { notes.push(`${m.san}: mate.`); c.move(m.san); endCp = mine ? 10000 : -10000; break; }
    const g = await gradeMove(fen, m.uci, ms); const best = (g.bestLine || "").split(" ")[0];
    if (mine) {
      endCp = g.afterCp;
      if (g.drop < 4) notes.push(`${m.san} ✓`);
      else if (g.drop < 10) { notes.push(`${m.san}: playable but weaker (−${g.drop.toFixed(0)}%), better ${best}`); holds = false; }
      else { notes.push(`${m.san}: goes wrong (−${g.drop.toFixed(0)}%), better ${best}`); holds = false; stopped = k; c.move(m.san); break; }
    } else {
      endCp = -g.afterCp;
      notes.push(g.drop < 5 ? `${m.san}: a real defence` : `${m.san}: a weaker defence (${best} is better for them)`);
    }
    c.move(m.san);
  }
  // their move was the last one in your line: what would you answer?
  if (stopped === null && !c.isGameOver() && c.turn() === me && eng) {
    const [b] = await eng.analyse(c.fen(), { movetime: ms });
    if (b?.pv[0]) { const t = new Chess(c.fen()); const x = t.move({ from: b.pv[0].slice(0, 2), to: b.pv[0].slice(2, 4), promotion: b.pv[0][4] }); answer = { san: x.san, cp: lineToCp(b) }; endCp = answer.cp; }
  }
  return { kind, holds, stopped, notes, endCp, answer };
}

const ev = (cp) => (cp == null ? "" : Math.abs(cp) >= 9000 ? (cp > 0 ? "mate" : "getting mated") : (cp >= 0 ? "+" : "") + (cp / 100).toFixed(1));
const tok = (root, moves, k) => { const [, side, , , , n] = root.split(" "); const idx = k + (side === "b" ? 1 : 0); const no = (+n || 1) + Math.floor(idx / 2); return `${no}${idx % 2 ? "…" : "."}${moves[k].san}`; };

// Check all extra lines against the main line + which serious defences after your first move you didn't cover.
export async function sideReport({ gradeMove, eng, root, main, sides, ms = 400 }) {
  const items = [];
  let rootCp = null;
  if (eng && sides.some((s) => s.verdict)) { const [b] = await eng.analyse(root, { movetime: 700 }); rootCp = lineToCp(b); }
  for (const s of sides.slice(0, 5)) {
    const from = Math.min(s.branch, s.moves.length - 1);
    const r = await checkLine(gradeMove, root, s.moves, { ms, maxPlies: 8, from, eng });
    const mv = s.moves[from], instead = main[from];
    const title = r.kind === "defence" ? `If ${tok(root, s.moves, from)}${instead ? ` instead of ${instead.san}` : ""}` : `Other idea: ${tok(root, s.moves, from)}${instead ? ` instead of ${instead.san}` : ""}`;
    let verdict, cls, judged = null;
    const works = r.stopped === null && r.holds && (r.endCp == null || rootCp == null || winPct(rootCp) - winPct(r.endCp) < 10);
    if (s.verdict === "bad") {
      judged = !works;
      verdict = !works ? `✓ correctly rejected${r.endCp != null ? ` (this line ends at ${ev(r.endCp)} for you)` : ""}` : `✗ you rejected it, but it works (${ev(r.endCp)})`; cls = !works ? "ok" : "no";
    } else if (s.verdict === "good" && !works) { judged = false; verdict = `✗ you thought this works, but it doesn't${r.endCp != null ? ` (${ev(r.endCp)})` : ""}`; cls = "no"; }
    else if (r.stopped !== null) { verdict = "✗ your plan doesn't hold here"; cls = "no"; }
    else if (!r.holds) { verdict = "½ playable, but there is something better"; cls = "warn"; }
    else if (r.answer) { verdict = `? you didn't give your answer. Best is ${r.answer.san} (${ev(r.answer.cp)})`; cls = "info"; }
    else { verdict = `✓ holds${r.endCp != null ? ` (${ev(r.endCp)})` : ""}`; cls = "ok"; }
    if (s.verdict === "good" && works && judged === null) { judged = true; if (!verdict.startsWith("✓")) verdict = `✓ you were right, it works${r.answer ? `. Your next move would be ${r.answer.san}` : ""}`; }
    items.push({ line: s.i + 1, title: (s.verdict === "bad" ? "Rejected: " : "") + title, verdict, cls, notes: r.notes, kind: r.kind, mark: s.verdict, judged, holds: r.stopped === null && r.holds && !r.answer, san: mv.san, text: fmt(root, s.moves) });
  }
  // serious defences after your first move: are they all in your lines?
  let coverage = null;
  if (main.length && eng) {
    const c = new Chess(root); c.move(main[0].san);
    if (!c.isGameOver()) {
      const rs = await eng.analyse(c.fen(), { movetime: 700, multipv: 3 });
      const bestW = winPct(lineToCp(rs[0]));
      const serious = rs.filter((l) => l.pv[0] && bestW - winPct(lineToCp(l)) < 10).map((l) => { const t = new Chess(c.fen()); return t.move({ from: l.pv[0].slice(0, 2), to: l.pv[0].slice(2, 4), promotion: l.pv[0][4] }).san; });
      if (serious.length > 1) {
        const allLines = [main, ...sides.map((s) => s.moves)];
        coverage = serious.map((san) => ({ san, covered: allLines.some((l) => l[0]?.uci === main[0].uci && l[1]?.san === san) }));
      }
    }
  }
  return { items, coverage };
}
export function sideReportHtml(rep, esc, root, main) {
  if (!rep || (!rep.items.length && !rep.coverage)) return "";
  const cov = rep.coverage ? `<p class="small" style="margin:4px 0">Serious defences after ${esc(main[0].san)}: ${rep.coverage.map((d) => d.covered ? `<b>${esc(d.san)} ✓</b>` : `${esc(d.san)} <span class="muted">(not in your lines)</span>`).join(" · ")}</p>` : "";
  return `<div class="card" style="margin-top:10px"><h3 style="margin-top:0">Your other lines</h3>${cov}
    ${rep.items.map((it) => `<div class="feedback ${it.cls}" style="margin-top:6px"><b>Line ${it.line}: ${esc(it.title)}</b> → ${esc(it.verdict)}<br><span class="small muted">${esc(it.text)}</span><br><span class="small">${esc(it.notes.join(" · "))}</span></div>`).join("")}</div>`;
}
