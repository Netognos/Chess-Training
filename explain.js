// Explain WHY a move is good (from engine lines + board facts) and check the player's written thoughts against it.
// No language model: everything is derived from Stockfish lines and the position; the text check is keyword/move based.
import { Chess } from "./vendor/chess.js";
import { lineToCp } from "./engine.js";
import { pvToSan } from "./analysis.js";

const V = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const NAME = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const other = (c) => (c === "w" ? "b" : "w");
const fmt = (cp) => (cp >= 9000 ? "mate" : cp <= -9000 ? "getting mated" : (cp >= 0 ? "+" : "") + (cp / 100).toFixed(1));
const uciMove = (c, u) => { try { return c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch { return null; } };
function withTurn(fen, color) { const p = fen.split(" "); p[1] = color; p[3] = "-"; try { return new Chess(p.join(" ")); } catch { return null; } }
function pieces(c, color) { const o = []; for (const row of c.board()) for (const x of row) if (x && (!color || x.color === color)) o.push(x); return o; }
// enemy pieces attacked by `color`, as a set of squares
function attackedSet(c, color) { return new Set(pieces(c, other(color)).filter((x) => c.attackers(x.square, color).length).map((x) => x.square)); }

// Concepts we can detect, with words a player might write (Dutch + English)
const CONCEPTS = {
  double: { label: "double attack / fork", kw: ["vork", "fork", "dubbele aanval", "double attack", "twee stukken", "two pieces", "beide", "both"] },
  queenAway: { label: "the opponent's queen has to move", kw: ["dame weg", "dame moet", "queen away", "queen moves", "queen must", "dame vlucht", "dame verplaatsen"] },
  retreat: { label: "opponent's piece has to retreat to a passive square", kw: ["passief", "passive", "terug", "retreat", "back", "achteruit", "slecht veld"] },
  pin: { label: "pin / x-ray on a line (why you can't capture straight away)", kw: ["pen", "pin", "x-ray", "röntgen", "rontgen", "e-lijn", "e-file", "lijn open", "file open", "opent de", "opens the"] },
  unpin: { label: "first remove the pin (defend the piece / move it off the line)", kw: ["eerst", "first", "dekken", "defend", "dekt", "uit de penning", "unpin", "weg van de", "off the"] },
  space: { label: "gaining space / tempo", kw: ["ruimte", "space", "tempo", "initiatief", "initiative", "opdringen", "push"] },
  development: { label: "developing a piece", kw: ["ontwikkel", "develop", "loper eruit", "activ"] },
  check: { label: "check", kw: ["schaak", "check"] },
  material: { label: "winning material", kw: ["win", "wint", "materiaal", "material", "stuk winnen", "piece up"] },
  mate: { label: "mating attack", kw: ["mat", "mate", "checkmate"] },
  trade: { label: "trading pieces", kw: ["ruil", "trade", "exchange", "afruilen"] },
};

export async function explainMove(eng, fen, bestUci, userText = "", userLine = "") {
  const me = fen.split(" ")[1], opp = other(me);
  const root = new Chess(fen);
  const facts = [], concepts = new Set(), keyMoves = new Set();
  // 1. engine view of the position
  const top = await eng.analyse(fen, { movetime: 1500, multipv: 3 });
  const best = bestUci || top[0]?.pv[0];
  const c1 = new Chess(fen); const m = uciMove(c1, best);
  if (!m) return null;
  keyMoves.add(m.san.replace(/[+#]/g, ""));
  const bestCp = lineToCp(top.find((l) => l.pv[0] === best) || top[0]);
  // 2. what the move does
  const before = attackedSet(root, me), after = attackedSet(c1, me);
  const newly = [...after].filter((s) => !before.has(s)).map((s) => ({ ...c1.get(s), square: s })).filter((p) => p.type !== "p");
  if (m.san.includes("+")) { facts.push(`${m.san} gives check.`); concepts.add("check"); }
  if (newly.length >= 2) { facts.push(`${m.san} attacks two pieces at once: the ${newly.map((p) => `${NAME[p.type]} on ${p.square}`).join(" and the ")} (a double attack).`); concepts.add("double"); if (newly.some((p) => p.type === "q")) concepts.add("queenAway"); }
  else if (newly.length === 1) { facts.push(`${m.san} attacks the ${NAME[newly[0].type]} on ${newly[0].square}.`); if (newly[0].type === "q") concepts.add("queenAway"); }
  if (m.piece === "p" && !m.captured && newly.length) concepts.add("space");
  if (m.captured) { facts.push(`${m.san} captures a ${NAME[m.captured]}.`); concepts.add("material"); }
  if (["n", "b"].includes(m.piece) && ((me === "w" && m.from[1] === "1") || (me === "b" && m.from[1] === "8"))) concepts.add("development");
  // 3. opponent's best answer
  let reply = null, c2 = null;
  if (!c1.isGameOver()) {
    const [r] = await eng.analyse(c1.fen(), { movetime: 1000 });
    if (r?.pv[0]) {
      c2 = new Chess(c1.fen()); reply = uciMove(c2, r.pv[0]);
      const line = pvToSan(c1.fen(), r.pv, 7);
      keyMoves.add(reply.san.replace(/[+#]/g, ""));
      const backward = opp === "w" ? +reply.to[1] < +reply.from[1] : +reply.to[1] > +reply.from[1];
      let desc = `The opponent's best answer is ${reply.san}`;
      if (backward && reply.piece !== "p" && !reply.captured) {
        const t1 = withTurn(c1.fen(), opp), t2 = withTurn(c2.fen(), opp);
        const mob1 = t1 ? t1.moves({ square: reply.from }).length : null, mob2 = t2 ? t2.moves({ square: reply.to }).length : null;
        desc += `: the ${NAME[reply.piece]} has to retreat${mob1 !== null && mob2 !== null && mob2 < mob1 ? ` (from ${mob1} to ${mob2} available moves, so it gets more passive)` : ""}`;
        concepts.add("retreat");
      } else if (reply.captured) desc += ` (capturing a ${NAME[reply.captured]})`;
      facts.push(`${desc}. Main line: ${line}.`);
      // your follow-up in the main line
      if (r.pv[1]) {
        const c3 = new Chess(c2.fen()); const f = uciMove(c3, r.pv[1]);
        if (f) {
          keyMoves.add(f.san.replace(/[+#]/g, ""));
          const defended = pieces(c3, me).filter((p) => p.type !== "k" && p.square !== f.to && c3.attackers(p.square, me).includes(f.to) && !c2.attackers(p.square, me).length);
          const onLine = (sq) => sq[0] === f.from[0] || sq[1] === f.from[1];
          if (defended.length) { facts.push(`Then ${f.san} defends your ${NAME[defended[0].type]} on ${defended[0].square}.`); concepts.add("unpin"); }
          else if (f.piece === "q" && onLine(f.from)) { facts.push(`Then ${f.san}: your queen leaves the line it was on.`); concepts.add("unpin"); }
          else facts.push(`Your follow-up in that line is ${f.san}.`);
        }
      }
    }
  }
  // 4. tempting captures that fail: after the opponent's best answer, after their other good answers,
  //    and after the reply the player expected in their own line
  const tempting = [];
  const replyPositions = [];
  if (c2 && !c2.isGameOver()) replyPositions.push({ c: c2, san: reply.san });
  if (!c1.isGameOver()) {
    const rs = await eng.analyse(c1.fen(), { movetime: 700, multipv: 3 });
    for (const r of rs.slice(1)) { const t = new Chess(c1.fen()); const x = uciMove(t, r.pv[0]); if (x) replyPositions.push({ c: t, san: x.san }); }
    const ul = (userLine || "").replace(/^\s*\S+/, "").trim().split(/\s+/)[0];
    if (ul) { const t = new Chess(c1.fen()); let x = null; try { x = t.move(ul.replace(/^D/, "Q").replace(/^T/, "R").replace(/^L/, "B").replace(/^P/, "N")); } catch {} if (x) { const i = replyPositions.findIndex((r) => r.san === x.san); if (i >= 0) replyPositions.splice(i, 1); replyPositions.unshift({ c: t, san: x.san, user: true }); } }
  }
  const seen = new Set();
  for (const rp of replyPositions.slice(0, 4)) {
    const base = rp.c; if (base.isGameOver()) continue;
    const caps = base.moves({ verbose: true }).filter((x) => x.captured && V[x.captured] >= 3 && !seen.has(x.san)).slice(0, 2);
    if (!caps.length) continue;
    const [b0] = await eng.analyse(base.fen(), { movetime: 500 });
    const bcp = lineToCp(b0);
    for (const cap of caps) {
      const t = new Chess(base.fen()); t.move(cap.san);
      if (t.isCheckmate()) continue;
      const [rr] = await eng.analyse(t.fen(), { movetime: 500 });
      const aft = -lineToCp(rr);
      if (bcp - aft < 100 || !rr?.pv[0]) continue;
      seen.add(cap.san);
      const t2 = new Chess(t.fen()); const ref = uciMove(t2, rr.pv[0]);
      let why = `After ${rp.san}${rp.user ? " (the move you expected)" : ""}, ${cap.san}${bcp - aft >= 250 ? "? looks tempting but fails" : " is possible but weaker"}: ${ref.san}${ref.captured ? ` takes your ${NAME[ref.captured]}` : ""} (${fmt(aft)} instead of ${fmt(bcp)}).`;
      const v = cap.from;
      if (ref.captured && (ref.from[0] === v[0] || ref.from[1] === v[1] || Math.abs(ref.from.charCodeAt(0) - v.charCodeAt(0)) === Math.abs(+ref.from[1] - +v[1]))) {
        why += ` Your ${NAME[cap.piece]} on ${v} was blocking that line, so capturing opens it. First defend or move the piece behind it.`; concepts.add("pin");
      }
      tempting.push(why); keyMoves.add(ref.san.replace(/[+#]/g, ""));
    }
  }
  if (tempting.length) concepts.add("unpin");
  // 5. alternatives
  const alts = top.filter((l) => l.pv[0] !== best).map((l) => ({ san: new Chess(fen).move({ from: l.pv[0].slice(0, 2), to: l.pv[0].slice(2, 4), promotion: l.pv[0][4] }).san, cp: lineToCp(l) }));

  // 6. compare with what the player wrote
  const text = (userText + " " + userLine).toLowerCase();
  const said = new Set(Object.entries(CONCEPTS).filter(([, c]) => c.kw.some((w) => text.includes(w))).map(([k]) => k));
  const PN = { q: ["dame", "queen"], n: ["paard", "knight"], r: ["toren", "rook"], b: ["loper", "bishop"], k: ["koning", "king"] };
  if (newly.length >= 2 && newly.filter((p) => (PN[p.type] || []).some((w) => text.includes(w))).length >= 2 && /(valt|aanval|attack|bedreig|threat)/.test(text)) said.add("double");
  const mentioned = [...new Set(((userText + " " + userLine).match(/\b(O-O(-O)?|0-0(-0)?|[KQRBNDTLP]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBNDTLP])?)/g) || []).map((t) => t.replace(/^D/, "Q").replace(/^T/, "R").replace(/^L/, "B").replace(/^P/, "N").replace(/^0-0-0/, "O-O-O").replace(/^0-0/, "O-O")))];
  const hitMoves = mentioned.filter((t) => keyMoves.has(t));
  const conceptCheck = [...concepts].map((k) => ({ k, label: CONCEPTS[k].label, hit: said.has(k) }));
  return { san: m.san, bestCp, facts, tempting, alts, conceptCheck, hitMoves, mentioned, keyMoves: [...keyMoves] };
}

export function explainHtml(x, esc) {
  if (!x) return "";
  const ok = x.conceptCheck.filter((c) => c.hit), miss = x.conceptCheck.filter((c) => !c.hit);
  return `<div class="card" style="margin-top:10px"><h3 style="margin-top:0">Why ${esc(x.san)}?</h3>
    <ul class="small">${x.facts.map((f) => `<li>${esc(f)}</li>`).join("")}${x.tempting.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
    ${x.alts.length ? `<p class="small muted">Engine: ${esc(x.san)} ${(x.bestCp / 100 >= 0 ? "+" : "") + (x.bestCp / 100).toFixed(1)}; alternatives ${x.alts.map((a) => `${esc(a.san)} ${(a.cp / 100 >= 0 ? "+" : "") + (a.cp / 100).toFixed(1)}`).join(", ")} (from your point of view).</p>` : ""}
    <h3>Your thoughts compared</h3>
    ${x.conceptCheck.length ? `<ul class="small">${ok.map((c) => `<li>✓ You saw: <b>${esc(c.label)}</b></li>`).join("")}${miss.map((c) => `<li>✗ Not in your notes: <b>${esc(c.label)}</b></li>`).join("")}</ul>` : ""}
    ${x.mentioned.length ? `<p class="small">Moves in your notes: ${x.mentioned.map((t) => (x.hitMoves.includes(t) ? `<b>${esc(t)} ✓</b>` : esc(t))).join(", ")}${x.hitMoves.length ? " (✓ = also in the engine's main line)." : "."}</p>` : ""}
    <p class="small muted">Rough check on keywords and moves, not a real reading of your text. For real feedback: Results → "Copy for Claude".</p></div>`;
}
