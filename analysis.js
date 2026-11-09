// Game analysis: PGN -> per-game data -> player profile.
import { Chess } from "./vendor/chess.js";
import { lineToCp, winPct, moveAccuracy, MATE_CP } from "./engine.js";

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
  return /correspondence|iccf|schemingmind|lechenicher/i.test(site || "") || tc === "-" || /^\d+\/\d+$/.test(tc || "") || /^1\/\d+/.test(tc || "");
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
  const [b, i] = parseTc(tc); if (b === null) return "unknown";
  const e = b + 40 * i; return e < 180 ? "bullet" : e < 480 ? "blitz" : e < 1500 ? "rapid" : "classical";
}
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
  for (const i of need) {
    const t = terminal(g.fens[i]);
    if (t) evals[i] = t;
    else {
      // Spend less time where it hardly matters: the first moves of the game (theory) and
      // positions that are already decided (|eval| > 7). Errors there barely change the win chance.
      const prev = i > 0 ? evals[i - 1] : null;
      const cheap = (!havePgn && i < 8) || (prev && Math.abs(prev.cp) >= 700);
      const [line] = await engine.analyse(g.fens[i], { movetime: cheap ? Math.max(25, Math.round(opts.movetime * 0.3)) : opts.movetime });
      const stm = g.fens[i].split(" ")[1];
      const cp = lineToCp(line);
      evals[i] = { cp: stm === "w" ? cp : -cp, pv: line ? line.pv : [] };
      if (line && !cheap && line.mate == null) depths.push(line.depth); // mate searches report huge depths
    }
    onPos && onPos(++k, need.size);
  }
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
  const { evals, usedPgnEvals, depth } = await evaluate(engine, g, color, { movetime: opts.movetime || 150 }, onPos);

  const [base] = parseTc(H.TimeControl);
  const sign = color === "w" ? 1 : -1;
  const res = H.Result || "*";
  let score = { "1-0": 1, "0-1": 0, "1/2-1/2": 0.5 }[res]; if (score !== undefined && color === "b") score = 1 - score;
  const phaseAcc = { opening: [], middlegame: [], endgame: [] };
  const errors = [];
  let maxWp = 0, minWp = 100, firstEnd = null, wpAfterOpening = null;
  const st = { moves: 0, checks: 0, captures: 0, advances: 0, kingZone: 0, sacSound: 0, sacUnsound: 0, storm: 0, acc: { ahead: [], equal: [], behind: [] } };
  const castle = {};
  let queensOffPly = null;
  for (let i = 0; i < g.moves.length; i++) {
    const m = g.moves[i];
    if (m.flags.includes("k")) castle[m.color] = "k"; else if (m.flags.includes("q")) castle[m.color] = "q";
    if (queensOffPly === null && !/q/i.test(g.fens[i + 1].split(" ")[0])) queensOffPly = i + 1;
  }
  const opp = color === "w" ? "b" : "w";
  const oppCastle = castle.w && castle.b && castle.w !== castle.b;
  for (let i = 0; i < g.moves.length; i++) {
    const fen = g.fens[i];
    const ph = phaseOf(fen, i);
    if (ph === "endgame" && !firstEnd) firstEnd = { ply: i, type: endgameType(fen) };
    if (g.moves[i].color !== color) continue;
    const cpB = sign * evals[i].cp, cpA = sign * evals[i + 1].cp;
    const wpB = winPct(cpB), wpA = winPct(cpA);
    if (i >= 20) { maxWp = Math.max(maxWp, wpA); minWp = Math.min(minWp, wpA); if (wpAfterOpening === null) wpAfterOpening = wpB; }
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
  const avg = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null);
  return {
    id: gameKey(pgn),
    site: H.Site || "", date: H.UTCDate || H.Date || "", white: H.White, black: H.Black, color, result: res, score,
    playerElo: color === "w" ? H.WhiteElo : H.BlackElo, opponentElo: color === "w" ? H.BlackElo : H.WhiteElo,
    timeControl: H.TimeControl || "", tc: tcCategory(H.TimeControl, H.Site), termination: H.Termination || "", opening, eco: H.ECO || "",
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
  const errs = games.flatMap((g) => g.errors.map((e) => ({ ...e, game: g.site, color: g.color, opening: g.opening })));
  A.errorCounts = {}; for (const e of errs) A.errorCounts[e.label] = (A.errorCounts[e.label] || 0) + 1;
  const serious = errs.filter((e) => e.label !== "inaccuracy");
  A.seriousPer100 = {}; for (const p of Object.keys(cnt)) A.seriousPer100[p] = +(100 * serious.filter((e) => e.phase === p).length / cnt[p]).toFixed(1);
  A.tags = {}; for (const e of serious) for (const t of e.tags || []) A.tags[t] = (A.tags[t] || 0) + 1;
  A.tags = Object.fromEntries(Object.entries(A.tags).sort((a, b) => b[1] - a[1]));
  const op = {}; for (const g of games) (op[`${g.color}|${g.opening}`] ||= []).push(g);
  A.openings = Object.entries(op).map(([k, v]) => {
    const [color, name] = k.split("|"); const wp = v.map((x) => x.wpAfterOpening).filter((x) => x !== null);
    const oa = v.map((x) => x.phaseAcc.opening).filter((x) => x != null);
    return { color, name, games: v.length, scorePct: pct(v.map((x) => x.score)), wpAfter10: wp.length ? +(wp.reduce((a, b) => a + b, 0) / wp.length).toFixed(1) : null, acc: oa.length ? +(oa.reduce((a, b) => a + b, 0) / oa.length).toFixed(1) : null };
  }).sort((a, b) => b.games - a.games);
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
