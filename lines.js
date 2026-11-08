// Line builder: you drag moves on the board, but the pieces stay put. Each move is written into a line;
// a move for the side that isn't to move starts a new (side) line from the latest point where it fits.
import { Chess } from "./vendor/chess.js";

const posAt = (root, moves, n) => { const c = new Chess(root); for (const m of moves.slice(0, n)) c.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] }); return c; };

export class LineBuilder {
  constructor({ board, rootFen, el, esc, onChange = () => {}, maxLines = 6 }) {
    this.board = board; this.root = rootFen; this.el = el; this.esc = esc; this.onChange = onChange; this.maxLines = maxLines;
    this.lines = []; this.cur = -1; this.cursor = 0; this.follow = false; this.main = 0; this.msg = "";
    board.intercept = (f, t, p) => this.move(f, t, p);
    board.targetsFor = (sq) => this.targets(sq);
    this.render();
  }
  destroy() { this.board.intercept = null; this.board.targetsFor = null; }
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
    if (!r) { this.msg = "That move doesn't fit in this line. Tip: turn on “Show line on board” to move pieces that already moved."; this.render(); return; }
    const m = r.c.move({ from, to, promotion: promo || (r.legal[0].promotion ? "q" : undefined) });
    const mv = { san: m.san, uci: m.from + m.to + (m.promotion || "") };
    const prefix = this.line ? this.line.moves.slice(0, r.k) : [];
    this.msg = "";
    if (this.line && r.k === this.line.moves.length) { this.line.moves.push(mv); this.cursor = this.line.moves.length; }
    else if (this.line && this.line.moves[r.k]?.uci === mv.uci) { this.cursor = r.k + 1; }
    else {
      const nm = prefix.concat([mv]);
      const same = this.lines.findIndex((l) => nm.every((x, i) => l.moves[i]?.uci === x.uci));
      if (same >= 0) { this.cur = same; this.cursor = nm.length; }
      else if (this.lines.length >= this.maxLines) { this.msg = `Maximum ${this.maxLines} lines. Delete one first.`; }
      else { this.lines.push({ moves: nm, from: this.line && r.k > 0 ? this.cur : null, at: r.k }); this.cur = this.lines.length - 1; this.cursor = nm.length; }
    }
    this.render(); this.onChange();
  }
  undo() { const l = this.line; if (!l) return; l.moves.pop(); this.cursor = l.moves.length; if (!l.moves.length) this.del(this.cur); else { this.render(); this.onChange(); } }
  del(i) {
    this.lines.splice(i, 1); if (this.main === i) this.main = 0; else if (this.main > i) this.main--;
    this.cur = Math.min(this.cur, this.lines.length - 1); this.cursor = this.line ? this.line.moves.length : 0; this.render(); this.onChange();
  }
  clear() { this.lines = []; this.cur = -1; this.cursor = 0; this.main = 0; this.render(); this.onChange(); }
  // what the text fields want: main line + side lines as SAN strings
  mainSan() { const l = this.lines[this.main]; return l ? l.moves.map((m) => m.san).join(" ") : ""; }
  sideLines() { return this.lines.map((l, i) => ({ i, moves: l.moves })).filter((x) => x.i !== this.main && x.moves.length); }
  text() { return this.lines.map((l, i) => `${i === this.main ? "Main" : "Line " + (i + 1)}: ${fmt(this.root, l.moves)}`).join("\n"); }
  _boardView() {
    const l = this.line;
    if (this.follow && l) { const c = posAt(this.root, l.moves, this.cursor); const m = l.moves[this.cursor - 1]; this.board.setFen(c.fen(), { last: m ? [m.uci.slice(0, 2), m.uci.slice(2, 4)] : null }); }
    else { this.board.setFen(this.root); }
    if (l) { // arrows: the next few moves of the selected line (yours green, the opponent's red)
      const startPly = this.follow ? this.cursor : 0;
      const arr = l.moves.slice(startPly, startPly + 4).map((m, j) => ({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), color: ((startPly + j) % 2 === 0) ? "#15781B" : "#B33A3A" }));
      this.board.setArrows(arr);
    }
  }
  render() {
    const E = this.esc;
    this._boardView();
    const rows = this.lines.map((l, i) => {
      const moves = fmtTokens(this.root, l.moves).map((t, j) => `${t.no ? `<span class="muted">${t.no}</span>` : ""}<a href="#" class="lbm${i === this.cur && j + 1 === this.cursor ? " on" : ""}" data-l="${i}" data-p="${j + 1}">${E(t.san)}</a>`).join(" ");
      return `<div class="lbrow${i === this.cur ? " cur" : ""}" data-l="${i}"><button class="lbstar${i === this.main ? " on" : ""}" data-main="${i}" title="Make this the main line">${i === this.main ? "★" : "☆"}</button>
        <span class="lbno" data-sel="${i}">${i === this.main ? "Main" : "Line " + (i + 1)}</span><span class="lbmoves">${moves}</span><button class="lbdel" data-del="${i}" title="Delete line">✕</button></div>`;
    }).join("");
    this.el.innerHTML = `<div class="lb">
      <div class="small muted">${this.lines.length ? "Click a move to continue from there. A move for the other side starts a new line (another idea or another defence). ★ = main line." : "Drag or tap your moves on the board: the pieces stay where they are and the move is written down here. Then play the opponent's reply, and so on. Play a different move for the same side to start a second line."}</div>
      ${rows}
      ${this.msg ? `<div class="small" style="color:var(--bad)">${E(this.msg)}</div>` : ""}
      <div class="row small" style="margin-top:6px;gap:10px"><button class="btn secondary small" data-act="undo" ${this.line ? "" : "disabled"}>↶ Undo move</button><button class="btn secondary small" data-act="new" ${this.line ? "" : "disabled"}>+ New line</button>
        <label class="row small"><input type="checkbox" data-act="follow" ${this.follow ? "checked" : ""}> Show line on board</label>${this.lines.length ? `<button class="btn secondary small" data-act="clear">Clear all</button>` : ""}</div></div>`;
    this.el.querySelectorAll(".lbm").forEach((a) => (a.onclick = (e) => { e.preventDefault(); this.cur = +a.dataset.l; this.cursor = +a.dataset.p; this.render(); }));
    this.el.querySelectorAll("[data-sel]").forEach((a) => (a.onclick = () => { this.cur = +a.dataset.sel; this.cursor = this.line.moves.length; this.render(); }));
    this.el.querySelectorAll("[data-main]").forEach((b) => (b.onclick = () => { this.main = +b.dataset.main; this.render(); this.onChange(); }));
    this.el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => this.del(+b.dataset.del)));
    const act = (k) => this.el.querySelector(`[data-act="${k}"]`);
    act("undo").onclick = () => this.undo();
    act("new").onclick = () => { this.cur = -1; this.cursor = 0; this.msg = "Your next move starts a new line from the starting position."; this.render(); };
    act("follow").onchange = (e) => { this.follow = e.target.checked; this.render(); };
    if (act("clear")) act("clear").onclick = () => this.clear();
  }
}

function fmtTokens(root, moves) {
  const parts = root.split(" "); let no = +parts[5] || 1; let side = parts[1];
  return moves.map((m, j) => { const t = { san: m.san, no: side === "w" ? `${no}.` : j === 0 ? `${no}…` : "" }; if (side === "b") no++; side = side === "w" ? "b" : "w"; return t; });
}
export const fmt = (root, moves) => fmtTokens(root, moves).map((t) => (t.no ? t.no + " " : "") + t.san).join(" ").replace(/\. /g, ".").replace(/… /g, "…");

// Engine check of a line: your moves (side to move at the root) vs the best move, the opponent's replies vs their best defence.
// gradeMove(fen, uci, ms) → { drop, bestLine }.
export async function checkLine(gradeMove, root, moves, { ms = 500, maxPlies = 8, label = "" } = {}) {
  const c = new Chess(root); const out = []; let holds = true, stopped = null;
  for (const [k, m] of moves.slice(0, maxPlies).entries()) {
    const fen = c.fen(); const mine = k % 2 === 0;
    const test = new Chess(fen); test.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] });
    if (test.isCheckmate()) { out.push(`${m.san}: mate.`); c.move(m.san); break; }
    const g = await gradeMove(fen, m.uci, ms);
    const best = (g.bestLine || "").split(" ")[0];
    if (mine) {
      if (g.drop < 4) out.push(`${m.san} ✓`);
      else if (g.drop < 10) { out.push(`${m.san}: playable but weaker (−${g.drop.toFixed(0)}%), better ${best}`); holds = false; }
      else { out.push(`${m.san}: goes wrong (−${g.drop.toFixed(0)}%), better ${best}`); holds = false; stopped = k; break; }
    } else {
      if (g.drop < 5) out.push(`${m.san} (a good defence)`);
      else out.push(`${m.san}: not their best defence; ${best} is stronger for them`);
    }
    c.move(m.san);
  }
  return { label, holds, stopped, notes: out, endFen: c.fen() };
}
