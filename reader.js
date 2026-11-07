// "Read the position": a human-style breakdown of a position, without the engine.
// Material & imbalances, loose/hanging pieces, threats, forcing moves, king safety,
// pawn structure, activity, and plan hints derived from those facts.
import { Chess } from "./vendor/chess.js";

const V = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const NAME = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const FILES = "abcdefgh";
const side = (c) => (c === "w" ? "White" : "Black");
const other = (c) => (c === "w" ? "b" : "w");
const HOME = { w: { r: ["a1", "h1"], n: ["b1", "g1"], b: ["c1", "f1"], q: ["d1"] }, b: { r: ["a8", "h8"], n: ["b8", "g8"], b: ["c8", "f8"], q: ["d8"] } };
const atHome = (p) => (HOME[p.color][p.type] || []).includes(p.square);
const MAXMOB = { n: 8, b: 13, r: 14, q: 27 };

function pieces(ch) { const out = []; for (const row of ch.board()) for (const p of row) if (p) out.push(p); return out; }
function withTurn(fen, color) {
  const parts = fen.split(" "); parts[1] = color; parts[3] = "-"; // no en passant after a null move
  try { return new Chess(parts.join(" ")); } catch { return null; }
}

export function readPosition(fen) {
  const ch = new Chess(fen);
  const turn = ch.turn();
  const all = pieces(ch);
  const R = { fen, turn, sections: {}, hints: [] };

  // ---------------- material
  const mat = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const p of all) if (p.type !== "k") mat[p.color][p.type]++;
  const pts = (c) => Object.entries(mat[c]).reduce((s, [t, n]) => s + V[t] * n, 0);
  const diff = pts("w") - pts("b");
  const imb = [];
  const minors = (c) => mat[c].n + mat[c].b;
  for (const c of ["w", "b"]) {
    const o = other(c);
    if (mat[c].b >= 2 && mat[o].b < 2) imb.push(`${side(c)} has the bishop pair: good in open positions, so open lines.`);
    if (minors(c) - minors(o) === 2 && mat[o].r - mat[c].r === 1) imb.push(`${side(c)} has two minor pieces against a rook. The pieces are usually stronger in the middlegame (with queens on, many targets). The rook gains strength in the endgame and with open files.`);
    if (minors(c) - minors(o) === 1 && mat[o].r - mat[c].r === 1) imb.push(`${side(o)} is up the exchange (rook vs minor piece). The rook needs open files; the minor piece wants a strong, protected square.`);
    if (mat[c].q - mat[o].q === 1 && mat[c].q > 0) imb.push(`${side(c)} has a queen against ${mat[o].r * 5 + minors(o) * 3 - (mat[c].r * 5 + minors(c) * 3)} points of pieces: the queen needs targets and checks, the pieces need coordination.`);
  }
  R.material = { w: pts("w"), b: pts("b"), diff, mat, imbalances: imb };
  R.sections.material = [
    `White ${pts("w")} · Black ${pts("b")} → ${diff === 0 ? "material is equal" : `${side(diff > 0 ? "w" : "b")} is ${Math.abs(diff)} point${Math.abs(diff) > 1 ? "s" : ""} up`}.`,
    `Pawns: White ${mat.w.p}, Black ${mat.b.p}. Pieces (Q/R/B/N): White ${mat.w.q}/${mat.w.r}/${mat.w.b}/${mat.w.n}, Black ${mat.b.q}/${mat.b.r}/${mat.b.b}/${mat.b.n}.`,
    ...imb,
  ];

  // ---------------- loose & hanging pieces
  const loose = [];
  for (const p of all) {
    if (p.type === "k") continue;
    const att = ch.attackers(p.square, other(p.color));
    const def = ch.attackers(p.square, p.color);
    const minAtt = att.length ? Math.min(...att.map((s) => V[ch.get(s).type] || 0)) : null;
    let status = null;
    if (att.length && !def.length) status = "HANGING (attacked, not defended)";
    else if (att.length && minAtt < V[p.type]) status = `attacked by a cheaper piece (${att.filter((s) => V[ch.get(s).type] < V[p.type]).map((s) => NAME[ch.get(s).type] + " " + s).join(", ")})`;
    else if (att.length > def.length && p.type !== "p") status = `attacked ${att.length}×, defended only ${def.length}×`;
    else if (!def.length && p.type !== "p" && !atHome(p)) status = "loose (undefended): a target for forks and double attacks";
    if (status) loose.push({ color: p.color, piece: p.type, square: p.square, status, attackers: att, defenders: def, critical: status.startsWith("HANGING") || status.startsWith("attacked by") });
  }
  R.loose = loose;
  R.sections.loose = loose.length
    ? loose.sort((a, b) => b.critical - a.critical).map((l) => `${side(l.color)} ${NAME[l.piece]} on ${l.square}: ${l.status}.`)
    : ["No loose or hanging pieces."];

  // ---------------- threats (what the opponent could do if it were their move) & own forcing moves
  const capInfo = (c2, m) => {
    const target = V[m.captured || "p"] || 0, attacker = V[m.piece];
    const after = new Chess(c2.fen()); after.move(m);
    const defended = after.attackers(m.to, after.turn()).length > 0;
    const gain = !defended ? target : target - attacker;
    return { gain, defended };
  };
  const forcing = (c2) => {
    const out = [];
    for (const m of c2.moves({ verbose: true })) {
      const check = m.san.includes("+") || m.san.includes("#");
      let gain = null;
      if (m.captured) gain = capInfo(c2, m).gain;
      if (check || (gain !== null && gain > 0) || m.promotion) out.push({ san: m.san, check, mate: m.san.includes("#"), gain, promo: !!m.promotion });
    }
    return out.sort((a, b) => (b.mate - a.mate) || ((b.gain ?? 0) - (a.gain ?? 0)) || (b.check - a.check)).slice(0, 8);
  };
  const mine = forcing(ch);
  const oppBoard = ch.inCheck() ? null : withTurn(fen, other(turn));
  const theirs = oppBoard ? forcing(oppBoard) : [];
  const fmt = (f) => `${f.san}${f.mate ? " (mate!)" : ""}${f.gain > 0 ? ` (wins ~${f.gain})` : ""}${f.promo ? " (promotes)" : ""}${f.check && !f.mate ? " (check)" : ""}`;
  R.forcing = { mine, theirs };
  R.sections.threats = [
    ch.inCheck() ? `${side(turn)} is in CHECK: deal with that first.` : theirs.length ? `If ${side(other(turn))} could move now: ${theirs.map(fmt).join(", ")}.` : `${side(other(turn))} has no direct checks or winning captures.`,
  ];
  R.sections.forcing = [mine.length ? `${side(turn)}'s forcing moves (checks, winning captures): ${mine.map(fmt).join(", ")}.` : `${side(turn)} has no checks or winning captures, so think about improving pieces (a quiet move).`];

  // ---------------- king safety
  const ks = {};
  for (const c of ["w", "b"]) {
    const k = all.find((p) => p.type === "k" && p.color === c).square;
    const f = FILES.indexOf(k[0]), r = +k[1], dir = c === "w" ? 1 : -1;
    let shield = 0, openNear = [];
    for (let df = -1; df <= 1; df++) {
      const ff = f + df; if (ff < 0 || ff > 7) continue;
      const file = FILES[ff];
      const own = all.filter((p) => p.type === "p" && p.color === c && p.square[0] === file);
      if (own.some((p) => (+p.square[1] - r) * dir >= 1 && (+p.square[1] - r) * dir <= 2)) shield++;
      if (!own.length) openNear.push(file);
    }
    let zoneAtt = 0;
    for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
      const ff = f + df, rr = r + dr; if (ff < 0 || ff > 7 || rr < 1 || rr > 8) continue;
      zoneAtt += ch.attackers(FILES[ff] + rr, other(c)).length;
    }
    const oppQ = mat[other(c)].q > 0;
    const score = shield * 2 - openNear.length * 1.5 - zoneAtt * 0.7 + (oppQ ? 0 : 2);
    ks[c] = { square: k, shield, openNear, zoneAtt, verdict: score >= 4 ? "safe" : score >= 1.5 ? "somewhat exposed" : "weak" };
  }
  R.kings = ks;
  R.sections.kings = ["w", "b"].map((c) => `${side(c)} king ${ks[c].square}: ${ks[c].verdict}. Pawn shield ${ks[c].shield}/3${ks[c].openNear.length ? `, no own pawn on file(s) ${ks[c].openNear.join(", ")}` : ""}, ${ks[c].zoneAtt} enemy attack(s) on the squares around it.`);

  // ---------------- pawn structure
  const pawns = (c) => all.filter((p) => p.type === "p" && p.color === c).map((p) => p.square);
  const ps = {};
  for (const c of ["w", "b"]) {
    const mine = pawns(c), theirsP = pawns(other(c));
    const files = mine.map((s) => s[0]);
    const isolated = mine.filter((s) => { const fi = FILES.indexOf(s[0]); return !files.some((x) => Math.abs(FILES.indexOf(x) - fi) === 1); });
    const doubled = [...new Set(files.filter((x, i) => files.indexOf(x) !== i))];
    const passed = mine.filter((s) => {
      const fi = FILES.indexOf(s[0]), r = +s[1];
      return !theirsP.some((t) => Math.abs(FILES.indexOf(t[0]) - fi) <= 1 && (c === "w" ? +t[1] > r : +t[1] < r));
    });
    ps[c] = { isolated, doubled, passed };
  }
  const openFiles = [], halfOpen = { w: [], b: [] };
  for (const f of FILES) {
    const w = pawns("w").some((s) => s[0] === f), b = pawns("b").some((s) => s[0] === f);
    if (!w && !b) openFiles.push(f); else if (!w) halfOpen.w.push(f); else if (!b) halfOpen.b.push(f);
  }
  R.pawns = { ...ps, openFiles, halfOpen };
  R.sections.pawns = [
    ...["w", "b"].map((c) => `${side(c)}: ${[ps[c].passed.length ? `passed pawn(s) ${ps[c].passed.join(", ")}` : null, ps[c].isolated.length ? `isolated ${ps[c].isolated.join(", ")}` : null, ps[c].doubled.length ? `doubled on ${ps[c].doubled.join(", ")}-file` : null].filter(Boolean).join(" · ") || "no special pawns"}.`),
    `Open files: ${openFiles.join(", ") || "none"}${halfOpen.w.length ? ` · half-open for White: ${halfOpen.w.join(", ")}` : ""}${halfOpen.b.length ? ` · half-open for Black: ${halfOpen.b.join(", ")}` : ""}.`,
  ];

  // ---------------- activity
  const act = {};
  for (const c of ["w", "b"]) {
    const b2 = c === turn ? ch : withTurn(fen, c);
    if (!b2) { act[c] = null; continue; }
    const list = all.filter((p) => p.color === c && !"pk".includes(p.type) && !(atHome(p) && ch.moveNumber() <= 10)).map((p) => ({ ...p, mob: b2.moves({ square: p.square, verbose: true }).length }));
    list.sort((a, b) => a.mob / MAXMOB[a.type] - b.mob / MAXMOB[b.type]);
    act[c] = { total: b2.moves().length, worst: list[0] || null, list };
  }
  R.activity = act;
  R.sections.activity = ["w", "b"].filter((c) => act[c]).map((c) => `${side(c)}: ${act[c].total} legal moves${act[c].worst ? `. Worst piece: ${NAME[act[c].worst.type]} on ${act[c].worst.square} (${act[c].worst.mob} move${act[c].worst.mob === 1 ? "" : "s"})` : ""}.`);

  // ---------------- plan hints (for the side to move)
  const me = turn, opp = other(turn), H = R.hints;
  const myDiff = me === "w" ? diff : -diff;
  const freeCaps = mine.filter((f) => f.gain > 0 && !f.check);
  if (ch.inCheck()) H.push("You're in check. Consider all three answers: move the king, block, or capture the checking piece.");
  const myHanging = loose.filter((l) => l.color === me && l.critical);
  if (mine.some((f) => f.mate)) H.push("There is a MATE in one. Look at your checks!");
  if (myHanging.length) H.push(`Danger first: your ${myHanging.map((l) => `${NAME[l.piece]} on ${l.square}`).join(", ")} ${myHanging.length > 1 ? "are" : "is"} under attack. Save, defend or counter-attack, and only then make your plans.`);
  if (freeCaps.length) H.push(`Free material? ${freeCaps.slice(0, 3).map((f) => f.san).join(", ")} seem to win material. Check that nothing of yours becomes loose afterwards (blunder check), and then just take it.`);
  if (theirs.some((f) => f.gain > 0 || f.mate)) H.push(`Your opponent's threat: ${theirs.filter((f) => f.gain > 0 || f.mate).slice(0, 3).map(fmt).join(", ")}. Does your move stop this?`);
  const twoMinors = minors(me) - minors(opp) === 2 && mat[opp].r - mat[me].r === 1;
  if (myDiff >= 2) H.push("You're ahead in material. Remove counterplay first, then trade PIECES (not pawns). The fewer pieces on the board, the more your extra material counts." + (freeCaps.length ? " But grab the free material first." : ""));
  if (twoMinors && ks[opp].verdict !== "safe") H.push("Two minor pieces vs a rook, and the enemy king is weak: keep the queens on for now. Your pieces + queen attack better than the rook can defend.");
  else if (myDiff <= -2) H.push("You're behind in material. Avoid trades, look for activity, pressure on the king, complications, or a fortress.");
  if (ks[opp].verdict === "weak") H.push(`The ${side(opp).toLowerCase()} king is weak: bring pieces toward it (queen + one piece is often enough) and open lines toward it.`);
  if (ks[me].verdict === "weak") H.push("Your own king is weak: be careful with pawn moves around it, and trading queens takes away the danger.");
  if (ps[me].passed.length) H.push(`You have a passed pawn (${ps[me].passed.join(", ")}). Support it (a rook behind it) and push it when it's safe.`);
  if (ps[opp].passed.length) H.push(`The opponent has a passed pawn (${ps[opp].passed.join(", ")}). Block it with a piece directly in front of it (a knight is ideal).`);
  if (ps[opp].isolated.length) H.push(`Target the weak pawn(s) ${ps[opp].isolated.join(", ")}: attack them with pieces and occupy the square in front of them.`);
  const myRooks = all.filter((p) => p.color === me && p.type === "r");
  const goodFiles = openFiles.concat(halfOpen[me]);
  if (myRooks.length && goodFiles.length && !myRooks.some((r) => goodFiles.includes(r.square[0]))) H.push(`Rooks belong on open files: ${goodFiles.join(", ")}.`);
  if (act[me]?.worst && act[me].worst.mob <= 2) H.push(`Improve your worst piece: the ${NAME[act[me].worst.type]} on ${act[me].worst.square} has only ${act[me].worst.mob} move${act[me].worst.mob === 1 ? "" : "s"}. Where would it be better?`);
  if (mat[me].b >= 2 && mat[opp].b < 2) H.push("You have the bishop pair: open the position (pawn breaks).");
  if (!H.length) H.push("No direct tactics: find your worst piece and improve it, or a pawn break that frees your position.");
  return R;
}
