// Minimal tap/click + drag chessboard. Legal moves come from chess.js.
import { Chess } from "./vendor/chess.js";
import { PIECES } from "./pieces.js";

const FILES = "abcdefgh";
const IMG = Object.fromEntries(Object.entries(PIECES).map(([k, v]) => [k, "data:image/svg+xml;utf8," + encodeURIComponent(v)]));

export class Board {
  constructor(el, { orientation = "w", interactive = true, onMove = null } = {}) {
    this.el = el; this.orientation = orientation; this.interactive = interactive; this.onMove = onMove;
    this.chess = new Chess(); this.sel = null; this.last = null; this.arrows = []; this.locked = false;
    // intercept mode: moves are handed to intercept(from, to, promo) instead of being played; targetsFor(sq) gives the dots
    this.intercept = null; this.targetsFor = null; this.pieceAt = null; // pieceAt: the "invisible" pieces of a line
    el.classList.add("board");
    el.innerHTML = "";
    this.grid = document.createElement("div"); this.grid.className = "grid"; el.appendChild(this.grid);
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("viewBox", "0 0 8 8"); this.svg.classList.add("arrows"); el.appendChild(this.svg);
    this.promo = document.createElement("div"); this.promo.className = "promo hidden"; el.appendChild(this.promo);
    this.squares = {};
    for (let i = 0; i < 64; i++) { const d = document.createElement("div"); d.className = "sq"; this.grid.appendChild(d); }
    this.grid.addEventListener("pointerdown", (e) => this._down(e));
    this.render();
  }

  setFen(fen, { last = null } = {}) { this.chess = new Chess(fen); this.sel = null; this.last = last; this.arrows = []; this.render(); }
  fen() { return this.chess.fen(); }
  setOrientation(c) { this.orientation = c; this.render(); }
  flip() { this.setOrientation(this.orientation === "w" ? "b" : "w"); }
  setArrows(list) { this.arrows = list || []; this._drawArrows(); }

  // Apply a move programmatically (uci or {from,to,promotion}); returns chess.js move or null.
  play(m) {
    const mv = typeof m === "string" ? { from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] } : m;
    let r = null; try { r = this.chess.move(mv); } catch { r = null; }
    if (r) { this.last = [r.from, r.to]; this.sel = null; this.arrows = []; this.render(); }
    return r;
  }

  _sqAt(idx) { const r = Math.floor(idx / 8), f = idx % 8; return this.orientation === "w" ? FILES[f] + (8 - r) : FILES[7 - f] + (r + 1); }
  _xy(sq) { const f = FILES.indexOf(sq[0]), r = +sq[1] - 1; return this.orientation === "w" ? [f + 0.5, 7 - r + 0.5] : [7 - f + 0.5, r + 0.5]; }

  render() {
    const kids = this.grid.children;
    const targets = !this.sel ? [] : this.targetsFor ? this.targetsFor(this.sel) : this.chess.moves({ square: this.sel, verbose: true }).map((m) => m.to);
    const checkSq = this.chess.inCheck() ? this._kingSq(this.chess.turn()) : null;
    for (let i = 0; i < 64; i++) {
      const sq = this._sqAt(i), d = kids[i];
      const dark = (FILES.indexOf(sq[0]) + +sq[1]) % 2 === 1;
      d.className = "sq " + (dark ? "dark" : "light");
      if (this.last && this.last.includes(sq)) d.classList.add("last");
      if (sq === this.sel) d.classList.add("sel");
      if (sq === checkSq) d.classList.add("check");
      d.dataset.sq = sq;
      const p = this.chess.get(sq);
      d.innerHTML = "";
      if (p) { const img = document.createElement("img"); img.src = IMG[p.color === "w" ? p.type.toUpperCase() : p.type]; img.draggable = false; d.appendChild(img); }
      if (targets.includes(sq)) { const dot = document.createElement("span"); dot.className = p ? "ring" : "dot"; d.appendChild(dot); }
      const r = Math.floor(i / 8), f = i % 8;
      if (f === 0) d.insertAdjacentHTML("beforeend", `<span class="coord r">${sq[1]}</span>`);
      if (r === 7) d.insertAdjacentHTML("beforeend", `<span class="coord f">${sq[0]}</span>`);
    }
    this._drawArrows();
  }

  _kingSq(color) { for (const row of this.chess.board()) for (const p of row) if (p && p.type === "k" && p.color === color) return p.square; return null; }

  _drawArrows() {
    this.svg.innerHTML = `<defs><marker id="ah" markerWidth="4" markerHeight="4" refX="2.2" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="context-stroke"/></marker></defs>`;
    for (const a of this.arrows) {
      const [x1, y1] = this._xy(a.from), [x2, y2] = this._xy(a.to);
      const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
      Object.entries({ x1, y1, x2, y2, stroke: a.color || "#15781B", "stroke-width": 0.16, "stroke-linecap": "round", opacity: a.opacity ?? 0.8, "marker-end": "url(#ah)" }).forEach(([k, v]) => l.setAttribute(k, v));
      this.svg.appendChild(l);
      if (a.label) { // small move number at the arrow head
        const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        Object.entries({ x: x2 + 0.18, y: y2 - 0.18, "font-size": 0.3, "font-weight": 700, fill: "#fff", stroke: a.color || "#15781B", "stroke-width": 0.06, "paint-order": "stroke", "text-anchor": "middle" }).forEach(([k, v]) => t.setAttribute(k, v));
        t.textContent = a.label; this.svg.appendChild(t);
      }
    }
  }

  _down(e) {
    if (!this.interactive || this.locked) return;
    const t = e.target.closest(".sq"); if (!t) return;
    const sq = t.dataset.sq, p = this.chess.get(sq);
    if (this.intercept) {
      if (this.sel && this.sel !== sq && (!this.targetsFor || this.targetsFor(this.sel).includes(sq))) { this._attempt(this.sel, sq); return; }
      const vp = this.pieceAt ? this.pieceAt(sq) : p;
      if (vp) { this.sel = sq; this.render(); this._startDrag(e, sq, this.grid.querySelector(`[data-sq="${sq}"]`)); } else { this.sel = null; this.render(); }
      return;
    }
    if (this.sel && this.sel !== sq) {
      const ok = this.chess.moves({ square: this.sel, verbose: true }).some((m) => m.to === sq);
      if (ok) { this._attempt(this.sel, sq); return; }
    }
    if (p && p.color === this.chess.turn()) { this.sel = sq; this.render(); this._startDrag(e, sq, t); }
    else { this.sel = null; this.render(); }
  }

  _startDrag(e, from, cell) {
    const img = cell && cell.querySelector("img");
    if (!img) { // a piece that is only "there" in the line: drag without a picture
      const up0 = (ev) => { window.removeEventListener("pointerup", up0); const under = document.elementFromPoint(ev.clientX, ev.clientY); const t = under && under.closest(".sq"); if (t && t.dataset.sq !== from && this.el.contains(t)) this._attempt(from, t.dataset.sq); };
      window.addEventListener("pointerup", up0); return;
    }
    const ghost = img.cloneNode(); ghost.className = "ghost"; const size = cell.getBoundingClientRect().width;
    ghost.style.width = ghost.style.height = size + "px"; document.body.appendChild(ghost);
    let moved = false;
    const pos = (ev) => { ghost.style.left = ev.clientX - size / 2 + "px"; ghost.style.top = ev.clientY - size / 2 + "px"; };
    pos(e); img.style.opacity = 0.35;
    const mv = (ev) => { moved = true; pos(ev); };
    const up = (ev) => {
      window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up);
      ghost.remove(); img.style.opacity = 1;
      if (!moved) return;
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const t = under && under.closest(".sq");
      if (t && t.dataset.sq !== from && this.el.contains(t)) this._attempt(from, t.dataset.sq);
    };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  }

  async _attempt(from, to) {
    if (this.intercept) {
      const p = this.pieceAt ? this.pieceAt(from) : this.chess.get(from); let promo;
      if (p && p.type === "p" && (to[1] === "8" || to[1] === "1")) promo = await this._askPromo(p.color);
      this.sel = null; this.render();
      this.intercept(from, to, promo); return;
    }
    const legal = this.chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (!legal.length) { this.sel = null; this.render(); return; }
    let promotion;
    if (legal[0].promotion) promotion = await this._askPromo(this.chess.turn());
    const before = this.chess.fen();
    const r = this.play({ from, to, promotion });
    if (r && this.onMove) this.onMove(r, before);
  }

  _askPromo(color) {
    return new Promise((res) => {
      this.promo.innerHTML = ""; this.promo.classList.remove("hidden");
      for (const p of ["q", "r", "b", "n"]) {
        const b = document.createElement("button"); const img = document.createElement("img");
        img.src = IMG[color === "w" ? p.toUpperCase() : p]; b.appendChild(img);
        b.onclick = () => { this.promo.classList.add("hidden"); res(p); };
        this.promo.appendChild(b);
      }
    });
  }
}
