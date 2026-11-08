// What kind of move is this? Used for the style positions (several good moves of a different character).
import { Chess } from "./vendor/chess.js";

export const STYLES = {
  attack: { label: "Attacking", desc: "checks, moves towards the enemy king, pawn storms, sacrifices" },
  solid: { label: "Solid / developing", desc: "development, castling, defending, king safety" },
  positional: { label: "Positional / space", desc: "central pawns, pawn breaks, open files, restricting the opponent" },
  trade: { label: "Simplifying", desc: "exchanges that take the tension out" },
  theory: { label: "Opening theory", desc: "the main book move" },
};
const V = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const other = (c) => (c === "w" ? "b" : "w");
const kingSq = (c, col) => { for (const row of c.board()) for (const x of row) if (x && x.type === "k" && x.color === col) return x.square; return null; };
const near = (a, b, d) => Math.max(Math.abs(a.charCodeAt(0) - b.charCodeAt(0)), Math.abs(+a[1] - +b[1])) <= d;
const zone = (k) => { const z = []; for (let f = -1; f <= 1; f++) for (let r = -1; r <= 2; r++) { const fc = k.charCodeAt(0) + f, rr = +k[1] + r; if (fc >= 97 && fc <= 104 && rr >= 1 && rr <= 8) z.push(String.fromCharCode(fc) + rr); } return z; };
const withTurn = (fen, col) => { const p = fen.split(" "); p[1] = col; p[3] = "-"; try { return new Chess(p.join(" ")); } catch { return null; } };
function attacksOn(c, col, squares) { let n = 0; for (const s of squares) n += c.attackers(s, col).length; return n; }
function mobility(fen, col) { const c = withTurn(fen, col); return c ? c.moves().length : 0; }
function hanging(c, col) { // own pieces attacked and not defended (or attacked by something cheaper)
  let n = 0; for (const row of c.board()) for (const x of row) if (x && x.color === col && x.type !== "k") {
    const att = c.attackers(x.square, other(col)); if (!att.length) continue;
    const def = c.attackers(x.square, col);
    if (!def.length || att.some((s) => V[c.get(s).type] < V[x.type])) n++;
  } return n;
}

// fen + uci → { primary character, theory (book move?), tags }
export function styleOf(fen, uci, { theory = false } = {}) {
  const c = new Chess(fen); const me = c.turn(), opp = other(me);
  let m; try { m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined }); } catch { return { primary: "solid", tags: [] }; }
  const before = new Chess(fen); const tags = new Set();
  const ek = kingSq(before, opp); const z = ek ? zone(ek) : [];
  const fwd = me === "w" ? +m.to[1] - +m.from[1] : +m.from[1] - +m.to[1];
  const rel = (sq) => (me === "w" ? +sq[1] : 9 - +sq[1]);
  // attack
  if (m.san.includes("+")) tags.add("attack");
  if (ek && (attacksOn(c, me, z) - attacksOn(before, me, z) >= 2)) tags.add("attack");
  if (ek && m.captured && near(m.to, ek, 2)) tags.add("attack");
  if (ek && m.piece === "p" && fwd > 0 && Math.abs(m.to.charCodeAt(0) - ek.charCodeAt(0)) <= 1 && "abcfgh".includes(m.to[0]) && rel(m.to) >= 4 && !near(m.from, kingSq(before, me) || "a1", 1)) tags.add("attack");
  if (m.captured === undefined && !m.promotion && !m.san.includes("+")) { // sacrifice-ish: piece moved to an attacked, undefended square near the king
    const att = c.attackers(m.to, opp).length, def = c.attackers(m.to, me).length;
    if (att && !def && V[m.piece] >= 3 && ek && near(m.to, ek, 2)) tags.add("attack");
  }
  // solid / development
  if (m.san.startsWith("O-O")) tags.add("solid");
  if ((m.piece === "n" || m.piece === "b") && m.from[1] === (me === "w" ? "1" : "8")) tags.add("solid");
  if (hanging(c, me) < hanging(before, me)) tags.add("solid");
  if (m.piece === "k" && !m.san.startsWith("O-O") && !m.captured) tags.add("solid");
  if (m.piece === "p" && "abgh".includes(m.to[0]) && Math.abs(fwd) === 1 && near(m.from, kingSq(before, me) || "a1", 1)) tags.add("solid"); // luft
  if (fwd < 0 && m.piece !== "p" && !m.captured) tags.add("solid");
  // positional
  if (m.piece === "p" && "cdef".includes(m.to[0]) && fwd > 0) tags.add("positional");
  if (m.piece === "p" && !m.captured) { const t = withTurn(c.fen(), me); if (t && t.moves({ square: m.to, verbose: true }).some((x) => x.captured === "p")) tags.add("positional"); }
  if (m.piece === "r" && !m.captured) { const file = m.to[0]; let own = 0; for (let r = 1; r <= 8; r++) { const x = c.get(file + r); if (x && x.type === "p" && x.color === me) own++; } if (!own) tags.add("positional"); }
  if (!m.captured && !m.san.includes("+") && mobility(c.fen(), opp) <= mobility(before.fen(), opp) - 4) tags.add("positional");
  // trades
  if (m.captured && c.attackers(m.to, opp).length && Math.abs(V[m.captured] - V[m.piece]) <= 1 && !tags.has("attack")) tags.add("trade");
  if (m.piece === "q" && !m.captured) { const t = withTurn(c.fen(), opp); if (t && t.moves({ verbose: true }).some((x) => x.captured === "q" && x.piece === "q")) tags.add("trade"); }
  const primary = ["attack", "trade", "positional", "solid"].find((k) => tags.has(k)) || (fwd > 0 ? "positional" : "solid");
  return { primary, theory, tags: [...tags], san: m.san };
}
