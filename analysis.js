// Game analysis: PGN -> per-game data -> player profile.
import { Chess } from "./vendor/chess.js";
import { lineToCp, winPct, moveAccuracy, MATE_CP } from "./engine.js";
import { FAMILIES } from "./families.js";

const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export function splitPgn(text) {
  const t = text.replace(/\r/g, "").trim();
  if (!t) return [];
  return t.split(/\n\s*\n(?=\[Event )/).map((s) => s.trim()).filter((s) => s.includes("["));
}

function materialFor(fen, color) {
  let s = 0; for (const c of fen.split(" ")[0]) { const p = c.toLowerCase(); if (VAL[p] === undefined) continue; s += (c === p ? -1 : 1) * VAL[p] * (color === "w" ? 1 : -1); }
  return s;
}
function kingSquare(fen, color) { const c = new Chess(fen); for (const row of c.board()) for (const p of row) if (p && p.type === "k" && p.color === color) return p.square; return null; }
const sqDist = (a, b) => Math.max(Math.abs(a.charCodeAt(0) - b.charCodeAt(0)), Math.abs(+a[1] - +b[1]));
function pieceList(fen) { return fen.split(" ")[0].replace(/[\d/]/g, ""); }
export function nonPawnMaterial(fen) { let s = 0; for (const c of pieceList(fen)) { const p = c.toLowerCase(); if (p !== "p" && p !== "k") s += VAL[p]; } return s; }
// Game phases as Lichess divides them (scalachess Divider.scala, MIT licence, © Thibault Duplessis):
// middlegame = first position with ≤ 10 major/minor pieces, or a sparse back rank (< 4 pieces on a player's
// first rank), or "mixedness" > 150; endgame = first position with ≤ 6 major/minor pieces.
function board64(fen) { const b = []; const rows = fen.split(" ")[0].split("/"); for (let r = 0; r < 8; r++) { let f = 0; for (const ch of rows[r]) { if (/\d/.test(ch)) f += +ch; else { b[(7 - r) * 8 + f] = ch; f++; } } } return b; }
function mixScore(y, w, bl) {
  switch (w) {
    case 0: return bl === 1 ? 1 + y : bl === 2 ? (y < 6 ? 2 + (6 - y) : 0) : bl === 3 || bl === 4 ? (y < 7 ? 3 + (7 - y) : 0) : 0;
    case 1: return bl === 0 ? 1 + (8 - y) : bl === 1 ? 5 + Math.abs(4 - y) : bl === 2 ? 4 + (7 - y) : bl === 3 ? 5 + (7 - y) : 0;
    case 2: return bl === 0 ? (y > 2 ? 2 + (y - 2) : 0) : bl === 1 ? 4 + (y - 1) : bl === 2 ? 7 : 0;
    case 3: return bl === 0 ? (y > 1 ? 3 + (y - 1) : 0) : bl === 1 ? 5 + (y - 1) : 0;
    case 4: return bl === 0 ? (y > 1 ? 3 + (y - 1) : 0) : 0;
    default: return 0;
  }
}
function mixedness(b) {
  let acc = 0;
  for (let y = 0; y <= 6; y++) for (let x = 0; x <= 6; x++) {
    let w = 0, bl = 0;
    for (const sq of [y * 8 + x, y * 8 + x + 1, (y + 1) * 8 + x, (y + 1) * 8 + x + 1]) { const p = b[sq]; if (!p) continue; if (p === p.toUpperCase()) w++; else bl++; }
    acc += mixScore(y + 1, w, bl);
  }
  return acc;
}
const majorsMinors = (b) => b.filter((p) => p && !"kKpP".includes(p)).length;
const backrankSparse = (b) => { let w = 0, bl = 0; for (let f = 0; f < 8; f++) { const p = b[f], q = b[56 + f]; if (p && p === p.toUpperCase()) w++; if (q && q !== q.toUpperCase()) bl++; } return w < 4 || bl < 4; };
// fens = positions from the start (index i = before move i). Returns indices where middlegame / endgame start (or null).
export function divide(fens) {
  let mid = null, end = null;
  for (let i = 0; i < fens.length; i++) { const b = board64(fens[i]); if (majorsMinors(b) <= 10 || backrankSparse(b) || mixedness(b) > 150) { mid = i; break; } }
  if (mid !== null) for (let i = 0; i < fens.length; i++) if (majorsMinors(board64(fens[i])) <= 6) { end = i; break; }
  if (mid !== null && end !== null && mid >= end) mid = null;
  return { mid, end };
}
export function phaseOf(fen, ply) { if (nonPawnMaterial(fen) <= 26) return "endgame"; return ply < 20 ? "opening" : "middlegame"; }
export function endgameType(fen) {
  const k = new Set();
  for (const c of pieceList(fen)) { const p = c.toLowerCase(); if ("nb".includes(p)) k.add("minor"); else if (p === "r") k.add("rook"); else if (p === "q") k.add("queen"); }
  const s = [...k].sort().join("+");
  return { "": "pawn endgame", rook: "rook endgame", minor: "minor-piece endgame", queen: "queen endgame", "minor+rook": "rook + minor endgame" }[s] || "mixed / queen endgame";
}
export function classify(drop) { return drop >= 15 ? "blunder" : drop >= 10 ? "mistake" : drop >= 5 ? "inaccuracy" : null; }
function parseTc(tc) { const m = /^(\d+)(?:\+(\d+))?/.exec(tc || ""); return m ? [+m[1], +(m[2] || 0)] : [null, null]; }
export function isCorrespondence(tc, site) {
  return /correspondence|iccf|schemingmind|lechenicher/i.test(site || "") || tc === "-" || /^1\/\d+$/.test(tc || "");
}
// Stable id per game: the URL when the PGN has one, otherwise players + date + a hash of the moves
export function gameKey(pgn) {
  const h = (k) => (new RegExp(`\\[${k} "([^"]*)"`).exec(pgn) || [])[1] || "";
  const link = h("Link"); if (link.startsWith("http")) return link;
  const site = h("Site"); if (site.startsWith("http")) return site;
  const moves = pgn.replace(/\[[^\]]*\]/g, "").replace(/\{[^}]*\}/g, "").replace(/\s+/g, " ").trim();
  let x = 5381; for (let i = 0; i < moves.length; i++) x = ((x * 33) ^ moves.charCodeAt(i)) >>> 0;
  return `${h("White")}-${h("Black")}-${h("UTCDate") || h("Date")}-${x.toString(36)}`;
}
export function tcCategory(tc, site) {
  if (isCorrespondence(tc, site)) return "correspondence";
  if (/[\/:]/.test(tc || "")) return "classical"; // multi-period OTB controls like 40/7200:3600
  const [b, i] = parseTc(tc); if (b === null) return "unknown";
  const e = b + 40 * i; return e < 180 ? "bullet" : e < 480 ? "blitz" : e < 1500 ? "rapid" : "classical";
}
// "3+0, 5+3, 10" (minutes + increment seconds) -> [[180,0],[300,3],[600,0]]
export function parseTcList(txt) {
  const out = [];
  const t = String(txt || "").replace(/\s*\+\s*/g, "+").replace(/(^|[\s;,])(\d+),(\d+)(?=\+)/g, "$1$2.$3");
  for (const part of t.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+(?:[.,]\d+)?|½)(?:\+(\d+))?$/.exec(part); if (!m) return null;
    const base = m[1] === "½" ? 0.5 : parseFloat(m[1].replace(",", "."));
    out.push([Math.round(base * 60), +(m[2] || 0)]);
  }
  return out;
}
export const TC_CATS = ["bullet", "blitz", "rapid", "classical", "correspondence"];
// filt = { cats: ["blitz", ...], specific: [[180,2], ...] }; specific wins when given
export function tcMatches(tc, site, filt) {
  if (filt.specific && filt.specific.length) { const [b, i] = parseTc(tc); return b !== null && !isCorrespondence(tc, site) && filt.specific.some(([x, y]) => x === b && y === i); }
  const c = tcCategory(tc, site); return filt.cats.includes(c);
}
export function fmtTc(tc) { const [b, i] = parseTc(tc); if (b === null) return tc || "?"; const m = b / 60; return `${m === 0.5 ? "½" : Number.isInteger(m) ? m : m.toFixed(1)}+${i}`; }
function clockFrom(c) { const m = /\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(c || ""); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null; }
function evalFrom(c) {
  const m = /\[%eval\s+(#?-?[\d.]+)/.exec(c || ""); if (!m) return null;
  const v = m[1]; if (v.startsWith("#")) { const n = +v.slice(1); return n > 0 ? MATE_CP - n : -MATE_CP - n; }
  return Math.round(parseFloat(v) * 100);
}
export function uciToMove(fen, uci) {
  const c = new Chess(fen);
  try { return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch { return null; }
}
export function pvToSan(fen, pv, n = 8) {
  const c = new Chess(fen); const out = [];
  for (const u of (pv || []).slice(0, n)) { try { out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san); } catch { break; } }
  return out.join(" ");
}

// Parse one PGN game into positions, moves, clocks, PGN evals (white POV) and headers.
export function parseGame(pgn) {
  const c = new Chess();
  c.loadPgn(pgn);
  const headers = c.getHeaders ? c.getHeaders() : c.header();
  const hist = c.history({ verbose: true });
  const comments = new Map((c.getComments ? c.getComments() : []).map((x) => [x.fen, x.comment]));
  const fens = [hist.length ? hist[0].before : c.fen()];
  const moves = [], clocks = [], pgnEvals = [null];
  for (const m of hist) {
    moves.push(m); fens.push(m.after);
    const cm = comments.get(m.after);
    clocks.push(clockFrom(cm)); pgnEvals.push(evalFrom(cm));
  }
  return { headers, moves, fens, clocks, pgnEvals };
}

function terminal(fen) {
  const c = new Chess(fen);
  if (c.isCheckmate()) return { cp: c.turn() === "w" ? -MATE_CP : MATE_CP, pv: [] };
  if (c.isStalemate() || c.isInsufficientMaterial()) return { cp: 0, pv: [] };
  return null;
}

// Evaluate positions -> array of {cp (white POV), pv}. Uses PGN evals when present for all moves
// (Lichess exports of analysed games), then only asks the engine where a pv is needed.
async function evaluate(engine, g, color, opts, onPos) {
  const n = g.fens.length;
  const evals = new Array(n).fill(null);
  // server evals (Lichess) are used when most moves have one; the engine fills in the gaps
  const present = g.pgnEvals.slice(1).filter((v) => v !== null).length;
  const havePgn = n > 1 && present / (n - 1) >= 0.8;
  const need = new Set();
  if (havePgn) {
    evals[0] = { cp: 20, pv: null };
    for (let i = 1; i < n; i++) evals[i] = terminal(g.fens[i]) || (g.pgnEvals[i] !== null ? { cp: g.pgnEvals[i], pv: null } : null);
    for (let i = 1; i < n; i++) if (!evals[i]) need.add(i);
    const sign = color === "w" ? 1 : -1;
    for (let i = 0; i < n - 1; i++) {
      if (g.fens[i].split(" ")[1] !== color) continue;
      if (!evals[i] || !evals[i + 1]) { need.add(i); need.add(i + 1); continue; }
      const drop = winPct(sign * evals[i].cp) - winPct(sign * evals[i + 1].cp);
      if (drop >= 10) { need.add(i); need.add(i + 1); }
    }
  } else for (let i = 0; i < n; i++) need.add(i);
  let k = 0; const depths = [];
  const cache = opts.cache || null, mt = opts.movetime;
  const forced = [];
  for (const i of need) {
    const t = terminal(g.fens[i]);
    if (t) { evals[i] = t; onPos && onPos(++k, need.size); continue; }
    // only one legal move: its value is the value of the next position, no search needed
    if (i + 1 < n && new Chess(g.fens[i]).moves().length === 1) { forced.push(i); onPos && onPos(++k, need.size); continue; }
    const key = cache ? g.fens[i].split(" ").slice(0, 4).join(" ") : null;
    // Spend less time where it hardly matters: the first moves of the game (theory), positions that are
    // already decided (|eval| > 7), and positions reached by the move the engine itself wanted (the
    // previous search already looked through them, and the hash table still holds that work).
    const prev = i > 0 ? evals[i - 1] : null;
    const inBook = opts.book && i < 24 && opts.book[g.fens[i].split(" ").slice(0, 4).join(" ")];
    const cheap = (!havePgn && (i < 8 || inBook)) || (prev && Math.abs(prev.cp) >= 700);
    const followed = !cheap && prev && prev.pv && prev.pv[0] === g.moves[i - 1]?.lan && prev.pv.length >= 2;
    const time = cheap ? Math.max(25, Math.round(mt * 0.3)) : followed ? Math.max(40, Math.round(mt * 0.6)) : mt;
    const hit = key && cache.get(key);
    if (hit && hit.mt >= time) { evals[i] = { cp: hit.cp, pv: hit.pv }; onPos && onPos(++k, need.size); continue; }
    const [line] = await engine.analyse(g.fens[i], { movetime: time });
    const stm = g.fens[i].split(" ")[1];
    const cp = lineToCp(line);
    evals[i] = { cp: stm === "w" ? cp : -cp, pv: line ? line.pv : [] };
    if (line && !cheap && !followed && line.mate == null) depths.push(line.depth); // mate searches report huge depths
    if (key && Math.abs(cp) < 700 && !(cache.get(key)?.mt > time)) cache.set(key, { cp: evals[i].cp, pv: evals[i].pv, mt: time });
    onPos && onPos(++k, need.size);
  }
  for (const i of forced.reverse()) {
    const nx = evals[i + 1] || { cp: 0, pv: [] };
    evals[i] = { cp: nx.cp, pv: [g.moves[i].lan, ...(nx.pv || [])] };
  }
  if (cache && cache.size > 20000) cache.clear();
  return { evals, usedPgnEvals: havePgn, depth: depths.length ? Math.round(depths.reduce((a, b) => a + b, 0) / depths.length) : null };
}

export async function analyseGame(engine, pgn, player, opts = {}, onPos) {
  const g = parseGame(pgn);
  const H = g.headers;
  const name = (player || "").toLowerCase();
  const color = (H.White || "").toLowerCase() === name ? "w" : (H.Black || "").toLowerCase() === name ? "b" : null;
  if (!color) return { skipped: "player not in game" };
  if (H.Variant && !/^(standard|chess)$/i.test(H.Variant)) return { skipped: "variant" };
  if (g.moves.length < 10) return { skipped: "too short" };
  const { evals, usedPgnEvals, depth } = await evaluate(engine, g, color, { movetime: opts.movetime || 150, cache: opts.cache, book: opts.book }, onPos);

  const [base] = parseTc(H.TimeControl);
  const sign = color === "w" ? 1 : -1;
  const res = H.Result || "*";
  let score = { "1-0": 1, "0-1": 0, "1/2-1/2": 0.5 }[res]; if (score !== undefined && color === "b") score = 1 - score;
  const phaseAcc = { opening: [], middlegame: [], endgame: [] };
  const errors = [];
  let maxWp = 0, minWp = 100, firstEnd = null, wpAfterOpening = null;
  const st = { moves: 0, checks: 0, captures: 0, advances: 0, kingZone: 0, sacSound: 0, sacUnsound: 0, storm: 0, acc: { ahead: [], equal: [], behind: [] } };
  const castle = {};
  const pst = { me: {}, opp: {} }; // per phase: [moves, cpl sum, accuracy sum, blunders, mistakes, inaccuracies]
  let queensOffPly = null;
  for (let i = 0; i < g.moves.length; i++) {
    const m = g.moves[i];
    if (m.flags.includes("k")) castle[m.color] = "k"; else if (m.flags.includes("q")) castle[m.color] = "q";
    if (queensOffPly === null && !/q/i.test(g.fens[i + 1].split(" ")[0])) queensOffPly = i + 1;
  }
  const opp = color === "w" ? "b" : "w";
  const oppCastle = castle.w && castle.b && castle.w !== castle.b;
  const div = divide(g.fens);
  const phaseAt = (i) => (div.end !== null && i >= div.end ? "endgame" : div.mid !== null && i >= div.mid ? "middlegame" : "opening");
  // win chance (player's view) at the phase borders; the end of the game counts as the result itself
  const wpAt = (i) => +winPct(sign * evals[Math.min(i, evals.length - 1)].cp).toFixed(1);
  const cpAt = (i) => Math.max(-1500, Math.min(1500, sign * evals[Math.min(i, evals.length - 1)].cp));
  for (let i = 0; i < g.moves.length; i++) {
    const fen = g.fens[i];
    const ph = phaseAt(i);
    if (ph === "endgame" && !firstEnd) firstEnd = { ply: i, type: endgameType(fen) };
    { // both sides per phase: centipawn loss (Lichess style, evals capped at ±10 pawns), accuracy and errors
      const mine = g.moves[i].color === color, sg = mine ? sign : -sign;
      const b = sg * evals[i].cp, a = sg * evals[i + 1].cp;
      const cl = Math.max(-1000, Math.min(1000, b)) - Math.max(-1000, Math.min(1000, a));
      const wd = winPct(b) - winPct(a), lab = classify(wd);
      const r = (pst[mine ? "me" : "opp"][ph] ||= [0, 0, 0, 0, 0, 0]);
      r[0]++; r[1] += Math.max(0, cl); r[2] += moveAccuracy(winPct(b), winPct(a));
      if (lab === "blunder") r[3]++; else if (lab === "mistake") r[4]++; else if (lab === "inaccuracy") r[5]++;
    }
    if (g.moves[i].color !== color) continue;
    const cpB = sign * evals[i].cp, cpA = sign * evals[i + 1].cp;
    const wpB = winPct(cpB), wpA = winPct(cpA);
    if (i >= (div.mid ?? 20)) { maxWp = Math.max(maxWp, wpA); minWp = Math.min(minWp, wpA); if (wpAfterOpening === null) wpAfterOpening = wpB; }
    const macc = moveAccuracy(wpB, wpA);
    phaseAcc[ph].push(macc);
    { // style metrics
      const m = g.moves[i];
      st.moves++;
      if (m.san.includes("+") || m.san.includes("#")) st.checks++;
      if (m.captured) st.captures++;
      if (m.piece === "p" && (color === "w" ? +m.to[1] >= 5 : +m.to[1] <= 4)) st.advances++;
      const ek = kingSquare(fen, opp);
      if (ek && sqDist(m.to, ek) <= 2 && m.piece !== "k") st.kingZone++;
      if (oppCastle && m.piece === "p") { const ekf = castle[opp] === "k" ? "fgh" : "abc"; if (ekf.includes(m.to[0])) st.storm++; }
      if (i + 2 < g.fens.length) {
        const lost = materialFor(fen, color) - materialFor(g.fens[i + 2], color);
        const lost2 = i + 4 < g.fens.length ? materialFor(fen, color) - materialFor(g.fens[i + 4], color) : lost;
        if (lost >= 2 && lost2 >= 2 && !g.moves[i].promotion) { if (wpB - wpA < 5) st.sacSound++; else if (wpB - wpA >= 10) st.sacUnsound++; }
      }
      st.acc[cpB >= 150 ? "ahead" : cpB <= -150 ? "behind" : "equal"].push(macc);
    }
    const drop = wpB - wpA, label = classify(drop);
    if (!label) continue;
    const mv = g.moves[i];
    const bestU = evals[i].pv && evals[i].pv[0];
    const best = bestU ? uciToMove(fen, bestU) : null;
    const replyU = evals[i + 1].pv && evals[i + 1].pv[0];
    const reply = replyU ? uciToMove(g.fens[i + 1], replyU) : null;
    const tags = [];
    if (best && best.san !== mv.san) {
      if (best.captured || best.san.includes("+") || best.san.includes("#") || best.promotion) tags.push("missed tactic / forcing move");
      if (Math.abs(evals[i].cp) >= 9000 && sign * evals[i].cp > 0) tags.push("missed mate");
    }
    if (reply && reply.captured && reply.captured !== "p" && drop >= 10) tags.push("hung material / allowed tactic");
    if (Math.abs(evals[i + 1].cp) >= 9000 && sign * evals[i + 1].cp < 0) tags.push("allowed mate");
    const clk = g.clocks[i];
    if (clk !== null && base && (clk < 30 || clk < 0.1 * base)) tags.push("time trouble");
    if (ph === "endgame") tags.push("endgame technique");
    if (wpB >= 80 && wpA < 65) tags.push("threw away winning position");
    if (!tags.length) tags.push("positional / planning");
    errors.push({
      moveNo: Math.floor(i / 2) + 1, ply: i, phase: ph, label, played: mv.san, best: best ? best.san : null,
      bestLine: pvToSan(fen, evals[i].pv, 6), fen, evalBefore: +(cpB / 100).toFixed(2), evalAfter: +(cpA / 100).toFixed(2),
      drop: +drop.toFixed(1), tags, clock: clk,
    });
  }
  let opening = H.Opening && H.Opening !== "?" ? H.Opening : null;
  if (!opening && H.ECOUrl) { // chess.com: https://www.chess.com/openings/Caro-Kann-Defense-Advance-Variation-3...c5
    const slug = decodeURIComponent(H.ECOUrl.split("/").pop() || "").replace(/-\d+\..*$/, "").replace(/-/g, " ").trim();
    if (slug) opening = slug.replace(/\bDefense\b/, "Defense").replace(/\s+/g, " ");
  }
  if (!opening) opening = g.moves.slice(0, 6).map((m) => m.san).join(" ");
  const all = Object.values(phaseAcc).flat();
  const rnd = (o) => Object.fromEntries(Object.entries(o).map(([k, r]) => [k, [r[0], Math.round(r[1]), +r[2].toFixed(1), r[3], r[4], r[5]]]));
  const avg = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null);
  return {
    id: gameKey(pgn),
    site: H.Site || "", date: H.UTCDate || H.Date || "", white: H.White, black: H.Black, color, result: res, score,
    playerElo: color === "w" ? H.WhiteElo : H.BlackElo, opponentElo: color === "w" ? H.BlackElo : H.WhiteElo,
    timeControl: H.TimeControl || "", tc: tcCategory(H.TimeControl, H.Site), termination: H.Termination || "", opening, eco: H.ECO || "",
    ph: score === undefined ? null : { mid: div.mid, end: div.end, mMid: div.mid !== null ? +g.fens[div.mid].split(" ")[5] : null, mEnd: div.end !== null ? +g.fens[div.end].split(" ")[5] : null, w0: wpAt(0), wMid: div.mid !== null ? wpAt(div.mid) : null, cMid: div.mid !== null ? cpAt(div.mid) : null, wEnd: div.end !== null ? wpAt(div.end) : null, cEnd: div.end !== null ? cpAt(div.end) : null, res: score * 100 },
    pst: { me: rnd(pst.me), opp: rnd(pst.opp) },
    plies: g.moves.length, line: g.moves.slice(0, 30).map((m) => m.lan), accuracy: avg(all), usedPgnEvals, depth, movetime: opts.movetime || 150,
    phaseAcc: Object.fromEntries(Object.entries(phaseAcc).filter(([, v]) => v.length).map(([k, v]) => [k, avg(v)])),
    phaseMoves: Object.fromEntries(Object.entries(phaseAcc).map(([k, v]) => [k, v.length])),
    wpAfterOpening: wpAfterOpening === null ? null : +wpAfterOpening.toFixed(1),
    maxWp: +maxWp.toFixed(1), minWp: +minWp.toFixed(1), endgame: firstEnd, errors,
    style: { ...st, acc: Object.fromEntries(Object.entries(st.acc).map(([k, v]) => [k, { n: v.length, sum: +v.reduce((a, b) => a + b, 0).toFixed(1) }])), oppCastle: !!oppCastle, queensOffPly, castled: castle[color] || null },
  };
}

export function aggregate(games) {
  const pct = (xs) => (xs.length ? +(100 * xs.reduce((a, b) => a + (b ?? 0), 0) / xs.length).toFixed(1) : null);
  const A = { games: games.length, scorePct: pct(games.map((g) => g.score)), wins: games.filter((g) => g.score === 1).length, draws: games.filter((g) => g.score === 0.5).length, losses: games.filter((g) => g.score === 0).length };
  const dg = games.filter((g) => g.depth); A.depth = dg.length ? Math.round(dg.reduce((a, g) => a + g.depth, 0) / dg.length) : null; A.serverAnalysed = games.filter((g) => g.usedPgnEvals).length;
  A.byColor = {}; for (const c of ["w", "b"]) { const v = games.filter((g) => g.color === c); if (v.length) A.byColor[c] = { games: v.length, scorePct: pct(v.map((g) => g.score)) }; }
  A.tc = {}; for (const g of games) A.tc[g.tc] = (A.tc[g.tc] || 0) + 1;
  const tot = {}, cnt = {};
  for (const g of games) for (const [ph, a] of Object.entries(g.phaseAcc)) { const n = g.phaseMoves[ph]; tot[ph] = (tot[ph] || 0) + a * n; cnt[ph] = (cnt[ph] || 0) + n; }
  A.phaseAcc = Object.fromEntries(Object.keys(tot).map((p) => [p, +(tot[p] / cnt[p]).toFixed(1)]));
  A.phaseMoves = cnt;
  A.phases = phaseFlow(games);
  A.cpl = cplStats(games);
  const errs = games.flatMap((g) => g.errors.map((e) => ({ ...e, game: g.site, color: g.color, opening: g.opening })));
  A.errorCounts = {}; for (const e of errs) A.errorCounts[e.label] = (A.errorCounts[e.label] || 0) + 1;
  const serious = errs.filter((e) => e.label !== "inaccuracy");
  A.seriousPer100 = {}; for (const p of Object.keys(cnt)) A.seriousPer100[p] = +(100 * serious.filter((e) => e.phase === p).length / cnt[p]).toFixed(1);
  A.tags = {}; for (const e of serious) for (const t of e.tags || []) A.tags[t] = (A.tags[t] || 0) + 1;
  A.tags = Object.fromEntries(Object.entries(A.tags).sort((a, b) => b[1] - a[1]));
  A.errMatrix = errorMatrix(serious, games.length);
  const op = {}; for (const g of games) (op[`${g.color}|${g.opening}`] ||= []).push(g);
  A.openings = Object.entries(op).map(([k, v]) => {
    const [color, name] = k.split("|"); const wp = v.map((x) => x.wpAfterOpening).filter((x) => x !== null);
    const oa = v.map((x) => x.phaseAcc.opening).filter((x) => x != null);
    return { color, name, games: v.length, scorePct: pct(v.map((x) => x.score)), wpAfter10: wp.length ? +(wp.reduce((a, b) => a + b, 0) / wp.length).toFixed(1) : null, acc: oa.length ? +(oa.reduce((a, b) => a + b, 0) / oa.length).toFixed(1) : null };
  }).sort((a, b) => b.games - a.games);
  // the same games grouped into opening families (Sicilian Defense, Queen's Gambit, …) with their variations
  const fam = {};
  for (const o of A.openings) (fam[`${o.color}|${openingFamily(o.name)}`] ||= []).push(o);
  A.families = Object.entries(fam).map(([k, vars]) => {
    const [color, name] = k.split("|");
    const v = games.filter((g) => g.color === color && openingFamily(g.opening) === name);
    const wp = v.map((x) => x.wpAfterOpening).filter((x) => x !== null), oa = v.map((x) => x.phaseAcc.opening).filter((x) => x != null);
    return { color, name, games: v.length, wins: v.filter((g) => g.score === 1).length, draws: v.filter((g) => g.score === 0.5).length, losses: v.filter((g) => g.score === 0).length,
      scorePct: pct(v.map((x) => x.score)), wpAfter10: wp.length ? +(wp.reduce((a, b) => a + b, 0) / wp.length).toFixed(1) : null, acc: oa.length ? +(oa.reduce((a, b) => a + b, 0) / oa.length).toFixed(1) : null,
      vars: vars.map((o) => ({ ...o, short: shortVariation(o.name, name) })).sort((a, b) => b.games - a.games) };
  }).sort((a, b) => b.games - a.games);
  for (const o of A.openings) { const v = games.filter((g) => g.color === o.color && g.opening === o.name); o.wins = v.filter((g) => g.score === 1).length; o.draws = v.filter((g) => g.score === 0.5).length; o.losses = v.filter((g) => g.score === 0).length; }
  const eg = {}; for (const g of games) if (g.endgame) (eg[g.endgame.type] ||= []).push(g);
  A.endgames = Object.fromEntries(Object.entries(eg).map(([t, v]) => [t, { games: v.length, scorePct: pct(v.map((x) => x.score)), acc: +(v.reduce((a, x) => a + (x.phaseAcc.endgame || 0), 0) / v.length).toFixed(1) }]));
  const win = games.filter((g) => g.maxWp >= 85), lose = games.filter((g) => g.minWp <= 15);
  A.conversion = { chances: win.length, won: win.filter((g) => g.score === 1).length };
  A.resilience = { lost: lose.length, saved: lose.filter((g) => (g.score ?? 0) >= 0.5).length };
  A.lostOnTime = games.filter((g) => g.score === 0 && /time/i.test(g.termination)).length;
  A.critical = serious.filter((e) => e.best).sort((a, b) => b.drop - a.drop).slice(0, 30);
  const sg = games.filter((g) => g.style);
  if (sg.length) {
    const T = { moves: 0, checks: 0, captures: 0, advances: 0, kingZone: 0, sacSound: 0, sacUnsound: 0, storm: 0 };
    const acc = { ahead: { n: 0, sum: 0 }, equal: { n: 0, sum: 0 }, behind: { n: 0, sum: 0 } };
    for (const g of sg) { for (const k in T) T[k] += g.style[k] || 0; for (const k in acc) { acc[k].n += g.style.acc?.[k]?.n || 0; acc[k].sum += g.style.acc?.[k]?.sum || 0; } }
    const per = (k) => +(100 * T[k] / Math.max(1, T.moves)).toFixed(1);
    A.style = {
      games: sg.length, checksPct: per("checks"), capturesPct: per("captures"), advancesPct: per("advances"), kingZonePct: per("kingZone"),
      sacSound: T.sacSound, sacUnsound: T.sacUnsound, sacPer10: +(10 * (T.sacSound + T.sacUnsound) / sg.length).toFixed(1),
      oppCastlePct: +(100 * sg.filter((g) => g.style.oppCastle).length / sg.length).toFixed(0),
      earlyQueenTradePct: +(100 * sg.filter((g) => g.style.queensOffPly !== null && g.style.queensOffPly <= 40).length / sg.length).toFixed(0),
      stormPerGame: +(T.storm / sg.length).toFixed(1),
      acc: Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, v.n ? +(v.sum / v.n).toFixed(1) : null])), accN: Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, v.n])),
      avgLength: Math.round(sg.reduce((a, g) => a + g.plies, 0) / sg.length / 2),
    };
    // aggression index 0-100 (rough): weighted mix of attacking indicators
    const S = A.style;
    S.aggression = Math.max(0, Math.min(100, Math.round(10 + S.kingZonePct * 1.5 + S.checksPct * 1.5 + S.sacPer10 * 3 + S.oppCastlePct * 0.3 + S.stormPerGame * 4 - S.earlyQueenTradePct * 0.4)));
  }
  // openings faced: per colour, worst results (min 2 games)
  A.hardest = A.openings.filter((o) => o.games >= 2).sort((a, b) => a.scorePct - b.scorePct || (a.wpAfter10 ?? 50) - (b.wpAfter10 ?? 50)).slice(0, 5);
  return A;
}

// ---------------------------------------------------------------- what went wrong: cause × phase
// One main cause per mistake/blunder, in this order: clock (under 10% of the base time or 30 s), a tactic
// (a missed check/capture/mate, or a piece or mate allowed), endgame technique, otherwise positional/planning.
export const ERR_CAUSES = { time: "Time trouble", tactical: "Tactical", technique: "Endgame technique", positional: "Positional / planning" };
export function errorCause(e) {
  const t = e.tags || [];
  if (t.includes("time trouble")) return "time";
  if (t.some((x) => /tactic|mate|hung/.test(x))) return "tactical";
  if (e.phase === "endgame" || t.includes("endgame technique")) return "technique";
  return "positional";
}
export function errorMatrix(serious, nGames) {
  const M = {};
  for (const ph of ["opening", "middlegame", "endgame"]) M[ph] = Object.fromEntries(Object.keys(ERR_CAUSES).map((c) => [c, { n: 0, blunders: 0, lost: 0, ex: [] }]));
  for (const e of serious) {
    const c = M[e.phase]?.[errorCause(e)]; if (!c) continue;
    c.n++; if (e.label === "blunder") c.blunders++; c.lost += e.drop || 0; c.ex.push(e);
  }
  for (const ph of Object.keys(M)) for (const c of Object.values(M[ph])) {
    c.perGame = nGames ? +(c.lost / nGames).toFixed(1) : 0; c.lost = +c.lost.toFixed(1);
    c.ex = c.ex.sort((a, b) => b.drop - a.drop).slice(0, 3).map((e) => ({ moveNo: e.moveNo, color: e.color, played: e.played, best: e.best, drop: e.drop, label: e.label, fen: e.fen, game: e.game, opening: e.opening, tags: e.tags }));
  }
  return M;
}

// ---------------------------------------------------------------- opening families
const norm = (x) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const FAM_N = FAMILIES.map((f) => [norm(f), f]).sort((a, b) => b[0].length - a[0].length);
const famMemo = new Map();
// "Sicilian Defense: Najdorf Variation, English Attack" and Chess.com's "Sicilian Defense Najdorf Variation 6.Be3"
// both → "Sicilian Defense". "… Accepted / Declined / Refused" fold into the gambit itself.
// Chess.com spells some families differently from the Lichess list
const FAM_ALIAS = [["kings pawn opening", "kings pawn game"], ["queens pawn opening", "queens pawn game"], ["queens pawn", "queens pawn game"], ["alekhines defense", "alekhine defense"],
  ["russian game", "petrovs defense"], ["petroff defense", "petrovs defense"], ["nimzowitsch larsen attack", "nimzo larsen attack"], ["old benoni defense", "benoni defense"], ["ruy lopez opening", "ruy lopez"],
["giuoco piano", "italian game"], ["reti opening", "reti opening"], ["philidor defense", "philidor defense"], ["birds opening", "bird opening"]];
export function openingFamily(name) {
  if (famMemo.has(name)) return famMemo.get(name);
  let n = norm(name);
  for (const [a, b] of FAM_ALIAS) if ((n === a || n.startsWith(a + " ")) && !(n === b || n.startsWith(b + " "))) { n = b + n.slice(a.length); break; }
  let f = (FAM_N.find(([k]) => n === k || n.startsWith(k + " ")) || [])[1];
  if (!f) f = /[:,]/.test(name || "") ? name.split(/[:,]/)[0].trim() : /^([NBRQK]?[a-h]?[1-8]?x?[a-h][1-8](=[NBRQ])?|O-O(-O)?)[+#]?( |$)/.test(name || "") ? `1.${name.split(" ")[0]} (no name in the PGN)` : String(name || "?").split(/\s+/).slice(0, 3).join(" ");
  f = f.replace(/\s+(Accepted|Declined|Refused)$/, "");
  famMemo.set(name, f);
  return f;
}
function shortVariation(name, family) {
  const n = String(name || ""), nf = norm(family.replace(/\s+(Accepted|Declined|Refused)$/, ""));
  const w = n.split(/(\s+)/);
  for (let k = 1; k <= w.length; k++) {
    const head = norm(w.slice(0, k).join(""));
    if (head === nf) { const r = w.slice(k).join("").replace(/^[\s:,]+/, "").trim(); return r || "Main line"; }
    if (head.length > nf.length) break;
  }
  return n;
}

// ---------------------------------------------------------------- phases and transitions
// Per phase: how much win chance you gain or lose in it (start ≈ 50%, end = your result 100/50/0).
// Transitions: after the opening / after the middlegame you are better (≥ +1 pawn), equal, or worse (≤ −1): what follows?
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
// half-width of a 95% interval for the mean (normal approximation; t-ish widening for small samples)
function half95(xs) {
  const n = xs.length; if (n < 2) return Infinity;
  const m = mean(xs), sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1));
  const z = n < 5 ? 2.8 : n < 10 ? 2.3 : n < 30 ? 2.05 : 1.96;
  return (z * sd) / Math.sqrt(n);
}
// Average centipawn loss, accuracy and error rates for you and for your opponents, per phase and overall.
// The range is a 95% interval over games (moves inside one game aren't independent).
export function cplStats(games) {
  const gs = games.filter((g) => g.pst && g.pst.me);
  if (!gs.length) return null;
  const out = { games: gs.length };
  for (const k of ["all", "opening", "middlegame", "endgame"]) {
    out[k] = {};
    for (const side of ["me", "opp"]) {
      const rows = gs.map((g) => { const P = g.pst[side] || {}; if (k !== "all") return P[k];
        const v = Object.values(P); return v.length ? v.reduce((a, r) => a.map((x, i) => x + r[i]), [0, 0, 0, 0, 0, 0]) : null; }).filter((r) => r && r[0]);
      const T = rows.reduce((a, r) => a.map((x, i) => x + r[i]), [0, 0, 0, 0, 0, 0]);
      if (!T[0]) { out[k][side] = null; continue; }
      const per = rows.filter((r) => r[0] >= 3).map((r) => r[1] / r[0]);
      const acpl = T[1] / T[0], h = half95(per);
      out[k][side] = { games: rows.length, moves: T[0], acpl: Math.round(acpl), lo: isFinite(h) ? Math.max(0, Math.round(acpl - h)) : null, hi: isFinite(h) ? Math.round(acpl + h) : null,
        acc: +(T[2] / T[0]).toFixed(1), blunders: T[3], mistakes: T[4], inaccuracies: T[5], per100: +((100 * (T[3] + T[4])) / T[0]).toFixed(1) };
    }
  }
  return out;
}
const bucket = (cp) => (cp >= 100 ? "better" : cp <= -100 ? "worse" : "equal");
export function phaseFlow(games) {
  const gs = games.filter((g) => g.ph && typeof g.ph.res === "number");
  if (!gs.length) return null;
  const avg = (xs) => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : null);
  const gain = { opening: [], middlegame: [], endgame: [] };
  for (const g of gs) {
    const { w0, wMid, wEnd, res } = g.ph;
    gain.opening.push((wMid ?? wEnd ?? res) - w0);
    if (wMid !== null) gain.middlegame.push((wEnd ?? res) - wMid);
    if (wEnd !== null) gain.endgame.push(res - wEnd);
  }
  const P = {};
  for (const k of Object.keys(gain)) {
    const xs = gain[k];
    P[k] = { games: xs.length, avg: avg(xs), lost10: xs.length ? Math.round((100 * xs.filter((x) => x <= -10).length) / xs.length) : null, won10: xs.length ? Math.round((100 * xs.filter((x) => x >= 10).length) / xs.length) : null };
  }
  const withMid = gs.filter((g) => g.ph.wMid !== null), withEnd = gs.filter((g) => g.ph.wEnd !== null);
  const flow = { afterOpening: avg(withMid.map((g) => g.ph.wMid)), cpAfterOpening: avg(withMid.map((g) => g.ph.cMid / 100)), afterMiddlegame: avg(withEnd.map((g) => g.ph.wEnd)), cpAfterMiddlegame: avg(withEnd.map((g) => g.ph.cEnd / 100)), result: avg(gs.map((g) => g.ph.res)),
    midMove: withMid.length ? Math.round(avg(withMid.map((g) => g.ph.mMid ?? Math.floor(g.ph.mid / 2) + 1))) : null, endMove: withEnd.length ? Math.round(avg(withEnd.map((g) => g.ph.mEnd ?? Math.floor(g.ph.end / 2) + 1))) : null, reachedEnd: Math.round((100 * withEnd.length) / gs.length) };
  // transitions
  const outcome = (list) => { const n = list.length; if (!n) return null; const w = list.filter((g) => g.ph.res === 100).length, d = list.filter((g) => g.ph.res === 50).length; return { n, win: Math.round((100 * w) / n), draw: Math.round((100 * d) / n), loss: Math.round((100 * (n - w - d)) / n), score: Math.round(list.reduce((a, g) => a + g.ph.res, 0) / n) }; };
  const T = { opening: {}, middlegame: {}, openToMid: {} };
  for (const b of ["better", "equal", "worse"]) {
    const o = withMid.filter((g) => bucket(g.ph.cMid) === b);
    T.opening[b] = outcome(o);
    const m = withEnd.filter((g) => bucket(g.ph.cEnd) === b);
    T.middlegame[b] = outcome(m);
    const oe = o.filter((g) => g.ph.wEnd !== null);
    T.openToMid[b] = oe.length ? { n: oe.length, better: Math.round((100 * oe.filter((g) => bucket(g.ph.cEnd) === "better").length) / oe.length), equal: Math.round((100 * oe.filter((g) => bucket(g.ph.cEnd) === "equal").length) / oe.length), worse: Math.round((100 * oe.filter((g) => bucket(g.ph.cEnd) === "worse").length) / oe.length) } : null;
  }
  // Contribution of each phase averaged over ALL games (a game that never reaches a phase adds 0 there),
  // so start + opening + middlegame + endgame = your score exactly. Win chance is zero-sum, so a phase's
  // contribution is how much you out- or under-played your opponents there, not how hard the phase is.
  const contrib = {};
  for (const k of Object.keys(gain)) {
    const xs = gs.map((g) => { const { w0, wMid, wEnd, res } = g.ph;
      return k === "opening" ? (wMid ?? wEnd ?? res) - w0 : k === "middlegame" ? (wMid !== null ? (wEnd ?? res) - wMid : 0) : wEnd !== null ? res - wEnd : 0; });
    const m = mean(xs), h = half95(xs), ok = isFinite(h);
    contrib[k] = { avg: +m.toFixed(1), lo: ok ? +Math.max(-100, m - h).toFixed(1) : null, hi: ok ? +Math.min(100, m + h).toFixed(1) : null, reached: gain[k].length };
  }
  // shown with one decimal; the start absorbs the rounding so start + phases = score exactly on screen
  const resAvg = +mean(gs.map((g) => g.ph.res)).toFixed(1);
  const start = +(resAvg - contrib.opening.avg - contrib.middlegame.avg - contrib.endgame.avg).toFixed(1);
  const ended = { opening: gs.filter((g) => g.ph.wMid === null && g.ph.wEnd === null).length, middlegame: gs.filter((g) => g.ph.wMid !== null && g.ph.wEnd === null).length, endgame: withEnd.length };
  // where do you leave the most? Ranked on the contribution over all games.
  const ranked = Object.entries(contrib).filter(([k]) => P[k].games >= 3).sort((x, y) => x[1].avg - y[1].avg);
  const weakest = ranked[0]?.[0] || null, strongest = ranked.length > 1 ? ranked[ranked.length - 1][0] : null;
  // how sure: "clear" when the whole 95% range is below zero; "relative" when no phase loses on balance
  const wk = weakest ? contrib[weakest] : null;
  const verdict = !wk ? null : wk.hi !== null && wk.hi < 0 ? "clear" : wk.avg < 0 ? "likely" : "relative";
  return { games: gs.length, phase: P, flow, T, contrib, start, ended, weakest, strongest: strongest !== weakest ? strongest : null, verdict };
}
