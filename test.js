// TEST & PROFILE: adaptive position test (move + why), calculation depth, time, style,
// player type (Lars Bo Hansen model) and a combined player profile.
import { Chess } from "./vendor/chess.js";
import { Board } from "./board.js";
import { PLAYER_TYPES, QUESTIONNAIRE, STYLE_OPENINGS } from "./data.js";

let BANK = null;
async function bank() { if (!BANK) BANK = await import("./testbank.js"); return BANK; }

export const TAC_CATS = ["Attack & mate", "Defence", "Calculation", "Sacrifice", "Quiet moves", "Endgame"];
const TAC_KEY = { "Attack & mate": "mate", Defence: "defence", Calculation: "calculation", Sacrifice: "sacrifice", "Quiet moves": "quiet", Endgame: "endgame" };
export const POS_GROUPS = { initiative: "Initiative", prophylaxis: "Prophylaxis & restriction", coordination: "Coordination & development", space: "Space & centre", structure: "Weaknesses & structure", technique: "Trading & technique", kingsafety: "King safety" };
const MODES = {
  quick: { name: "Quick test", tac: { "Attack & mate": 1, Defence: 1, Calculation: 2, Sacrifice: 1, "Quiet moves": 1, Endgame: 1 }, pos: { initiative: 1, prophylaxis: 1, coordination: 1, space: 1, technique: 1 } },
  full: { name: "Full test", tac: Object.fromEntries(TAC_CATS.map((c) => [c, 3])), pos: Object.fromEntries(Object.keys(POS_GROUPS).map((g) => [g, 2])) },
};
const catLabel = (c) => POS_GROUPS[c] || c;
const expected = (rItem, rPlayer) => 1 / (1 + Math.pow(10, (rItem - rPlayer) / 400));
const normSan = (s) => (s || "").replace(/[+#!?]/g, "").trim();

// performance rating: R such that sum E = sum score, with a weak prior at `prior`
export function perfRating(items, prior = 1500) {
  const xs = items.map((i) => ({ r: i.rating, s: i.score })).concat([{ r: prior, s: 0.5 }]);
  let lo = 0, hi = 3500;
  for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; const e = xs.reduce((a, x) => a + expected(x.r, mid), 0); const s = xs.reduce((a, x) => a + x.s, 0); if (e < s) lo = mid; else hi = mid; }
  return Math.round((lo + hi) / 2);
}
export function playerElo(p) {
  const gs = Object.values(p.games || {}).filter((g) => g.playerElo && g.tc !== "bullet").sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  if (gs.length) return Math.round(gs.slice(0, 10).reduce((a, g) => a + +g.playerElo, 0) / Math.min(10, gs.length));
  return +p.rating || 1500;
}
function moveCharacter(fen, mv) {
  const c = new Chess(fen); const opp = c.turn() === "w" ? "b" : "w";
  let ek = null; for (const row of c.board()) for (const x of row) if (x && x.type === "k" && x.color === opp) ek = x.square;
  const dist = ek ? Math.max(Math.abs(mv.to.charCodeAt(0) - ek.charCodeAt(0)), Math.abs(+mv.to[1] - +ek[1])) : 9;
  const fwd = c.turn() === "w" ? +mv.to[1] - +mv.from[1] : +mv.from[1] - +mv.to[1];
  if (mv.san.includes("+") || mv.captured || dist <= 2 || (mv.piece === "p" && fwd > 0 && dist <= 3)) return "aggressive";
  if (fwd < 0 || mv.san.startsWith("K") || mv.san.startsWith("O-O")) return "solid";
  return "neutral";
}

// ------------------------------------------------------------------ TEST VIEW
export async function testView(v, C) {
  const p = C.P(); p.tests ||= [];
  const cur = p.tests.find((t) => !t.done);
  if (!cur) {
    const last = p.tests.filter((t) => t.done).slice(-1)[0];
    v.innerHTML = `<div class="card"><h2>Position test</h2>
      <p>You get positions from real games. Find the best move, and write down <b>why</b>, and which line you calculated. The test adapts to your level, measures how far you calculate and how long you need, and compares that with your rating (${playerElo(p)}).</p>
      <ul class="small"><li><b>Tactical</b> (Lichess puzzles, rated 600-3000): attack & mate, defence, calculation, sacrifices, quiet moves, endgame. If your first move is right, you keep playing the line: that shows how deep you calculated.</li>
      <li><b>Positional</b> (puzzles selected by WGM/WIM players): initiative, prophylaxis, coordination, space, structure, technique, king safety. There is no tactic here; the question is which move fits the position.</li>
      <li>At the end, 8 short questions about how you like to play. Together with your games, they give your <b>player type</b>.</li></ul>
      <p class="small muted">Tip: play it like a game. Think, write down your reasoning and the line you calculated, then move. The category stays hidden until you've answered.</p>
      <div class="row"><button class="btn" data-mode="quick">Quick test (12 positions, ~20 min)</button><button class="btn secondary" data-mode="full">Full test (32 positions, ~50 min)</button></div>
      ${last ? `<p class="small" style="margin-top:10px">Last test: ${C.esc(last.date)}, overall ${last.result?.overall ?? "–"}. <a href="#" id="toRes">See results</a></p>` : ""}</div>
      <div class="card"><h2>Training modules</h2><p class="small">Practise one category at a time around your level, without a test score. Your results appear in the Log.</p>
      <div class="row">${TAC_CATS.concat(Object.keys(POS_GROUPS)).map((c) => `<button class="btn secondary small" data-prac="${C.esc(c)}">${C.esc(catLabel(c))}</button>`).join("")}</div></div>`;
    v.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = async () => { await startTest(p, b.dataset.mode, C); C.go("test"); }));
    v.querySelectorAll("[data-prac]").forEach((b) => (b.onclick = () => C.go("practice", { cat: b.dataset.prac })));
    v.querySelector("#toRes") && (v.querySelector("#toRes").onclick = (e) => { e.preventDefault(); C.go("results"); });
    return;
  }
  if (cur.items.length >= cur.plan.length) return questionnaireView(v, cur, C);
  await runItem(v, cur, C, { test: true });
}

async function startTest(p, mode, C) {
  const M = MODES[mode];
  const plan = [];
  for (const [c, n] of Object.entries(M.tac)) for (let i = 0; i < n; i++) plan.push({ kind: "tac", cat: c });
  for (const [g, n] of Object.entries(M.pos)) for (let i = 0; i < n; i++) plan.push({ kind: "pos", cat: g });
  // interleave: shuffle, then alternate tac/pos
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const tac = shuffle(plan.filter((x) => x.kind === "tac")), pos = shuffle(plan.filter((x) => x.kind === "pos"));
  const mixed = []; while (tac.length || pos.length) { if (tac.length) mixed.push(tac.pop()); if (tac.length) mixed.push(tac.pop()); if (pos.length) mixed.push(pos.pop()); }
  const elo = playerElo(p);
  p.tests.push({ id: "t" + Date.now().toString(36), date: C.today(), mode, startRating: elo, est: { overall: elo }, plan: mixed, items: [], done: false });
  C.save(); C.logEvent("test", `${M.name} started (start rating ${elo})`);
}

async function pickItem(cur, slot) {
  const B = await bank();
  const used = new Set(cur.items.map((i) => i.id));
  const target = (cur.est[slot.cat] ?? cur.est.overall) + (slot.kind === "pos" ? -150 : 0) + (Math.random() * 160 - 80);
  const pool = slot.kind === "tac" ? B.TACTICAL.filter((x) => x.c === TAC_KEY[slot.cat]) : B.POSITIONAL.filter((x) => x.g.includes(slot.cat));
  const cands = pool.filter((x) => !used.has(x.id)).sort((a, b) => Math.abs(a.r - target) - Math.abs(b.r - target)).slice(0, 6);
  return cands[Math.floor(Math.random() * cands.length)];
}

// Runs one position. opts.test → part of a test; otherwise practice (opts.cat, opts.onDone)
async function runItem(v, cur, C, opts) {
  const slot = opts.test ? cur.plan[cur.items.length] : { kind: TAC_CATS.includes(opts.cat) ? "tac" : "pos", cat: opts.cat };
  const est = opts.test ? cur.est : opts.est;
  const it = await pickItem({ items: opts.used || cur.items, est }, slot);
  if (!it) { v.innerHTML = `<div class="card"><p>No more positions in this category.</p></div>`; return; }
  const fen = it.fen, stm = fen.split(" ")[1];
  window.__ccItem = it;
  const sol = slot.kind === "tac" ? it.sol.split(" ") : [it.best];
  const nMine = Math.ceil(sol.length / 2);
  v.innerHTML = `<div class="two"><div><div id="tb"></div><div class="row" style="margin-top:8px"><button class="btn secondary" id="skip">I don't know / skip</button></div></div>
    <div><div class="card"><h2>${opts.test ? `Position ${cur.items.length + 1} of ${cur.plan.length}` : `Practice: ${C.esc(catLabel(opts.cat))}`}</h2>
      <div class="row" style="justify-content:space-between"><b>${stm === "w" ? "White" : "Black"} to move</b><span class="pill" id="timer">0:00</span></div>
      <p class="small muted">${slot.kind === "tac" ? "There is something concrete here. Find the best move." : "There's no tactic, so find the move that fits the position best."}${opts.test ? "" : ` · rating ≈ ${it.r}`}</p>
      <label class="f" style="margin-top:6px"><b style="color:var(--ink)">Why? (your reasoning)</b><textarea id="why" style="min-height:60px" placeholder="What do you see? Threats, weaknesses, plan…"></textarea></label>
      <label class="f" style="margin-top:6px"><b style="color:var(--ink)">The line you calculated</b><input id="line" placeholder="e.g. Rxf7 Kxf7 Qh5+ Kg8 Qxe8"></label>
      <p class="small muted">Then play your first move on the board.${slot.kind === "tac" ? " If it's right, you keep playing the line." : ""}</p>
      <div id="tfb"></div></div></div></div>`;
  const brd = new Board(v.querySelector("#tb")); brd.setFen(fen); brd.setOrientation(stm);
  const t0 = Date.now(); let tFirst = null, step = 0, depth = 0, finished = false, firstMove = null, character = null;
  const timer = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); const el = v.querySelector("#timer"); if (!el) return clearInterval(timer); el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }, 500);
  const finish = async (score, note) => {
    if (finished) return; finished = true; clearInterval(timer); brd.locked = true;
    const sanLine = (() => { const c = new Chess(fen); const o = []; for (const u of sol) { try { o.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san); } catch { break; } } return o; })();
    const planned = (v.querySelector("#line").value || "").split(/\s+/).map(normSan).filter((x) => x && !/^\d+\.+$/.test(x)).map((x) => x.replace(/^\d+\.+/, ""));
    let match = 0; for (let k = 0; k < Math.min(planned.length, sanLine.length); k++) { if (normSan(sanLine[k]) === planned[k]) match++; else break; }
    const rec = { id: it.id, kind: slot.kind, cat: slot.cat, rating: it.r, fen, score, depth, nMine, timeMs: (tFirst || Date.now()) - t0, totalMs: Date.now() - t0,
      move: firstMove, character, why: v.querySelector("#why").value, line: v.querySelector("#line").value, plannedMatch: match, solution: sanLine.join(" "), themes: it.th || it.t || [], url: it.url || (it.id ? `https://lichess.org/training/${it.id}` : "") };
    if (opts.test) {
      cur.items.push(rec);
      const K = Math.max(70, 320 / Math.sqrt(cur.items.length));
      cur.est.overall += K * (score - expected(it.r, cur.est.overall));
      const ce = cur.est[slot.cat] ?? cur.est.overall; cur.est[slot.cat] = ce + Math.max(90, 300 / Math.sqrt(cur.items.filter((x) => x.cat === slot.cat).length)) * (score - expected(it.r, ce));
    } else opts.onDone && opts.onDone(rec);
    C.save();
    const pct = Math.round(score * 100);
    v.querySelector("#tfb").innerHTML = `<div class="feedback ${score >= 0.99 ? "ok" : score > 0 ? "info" : "no"}"><b>${note}</b><br>Solution: <b>${C.esc(sanLine.join(" "))}</b>
      <div class="small" style="margin-top:4px">Category: ${C.esc(catLabel(slot.cat))} · position rating ≈ ${it.r} · your time ${Math.round(rec.timeMs / 1000)} s${slot.kind === "tac" && nMine > 1 ? ` · depth found ${depth}/${nMine} moves` : ""}${planned.length ? ` · your calculated line matched for ${match} ply` : ""} · score ${pct}%</div>
      ${rec.themes.length ? `<div class="small muted">Themes: ${C.esc(rec.themes.join(", "))}</div>` : ""}</div>
      <div class="row"><button class="btn" id="nextIt">${opts.test ? (cur.items.length >= cur.plan.length ? "To the questionnaire" : "Next position") : "Next"}</button><button class="btn secondary" id="toBoardIt">Open on Board</button></div>`;
    v.querySelector("#nextIt").onclick = () => (opts.test ? C.go("test") : runItem(v, cur, C, opts));
    v.querySelector("#toBoardIt").onclick = () => C.go("board", { fen });
  };
  v.querySelector("#skip").onclick = () => finish(0, "Skipped.");
  brd.onMove = async (mv, before) => {
    if (finished) return;
    if (step === 0) { tFirst = Date.now(); firstMove = mv.san; character = moveCharacter(before, mv); }
    const uci = mv.from + mv.to + (mv.promotion || "");
    const isMate = brd.chess.isCheckmate();
    if (slot.kind === "pos") {
      if (uci === sol[0]) return finish(1, `${mv.san}: correct!`);
      brd.locked = true; v.querySelector("#tfb").innerHTML = `<div class="feedback info">Checking with the engine…</div>`;
      const g = await C.gradeMove(before, uci, 1200);
      const sc = g.drop < 3 ? 0.7 : g.drop < 6 ? 0.4 : 0;
      return finish(sc, sc >= 0.7 ? `${mv.san}: a good alternative (the engine barely sees a difference).` : sc > 0 ? `${mv.san}: playable, but not the best plan.` : `${mv.san}: not the right idea (−${g.drop.toFixed(0)}% win chance).`);
    }
    if (uci === sol[step] || (isMate && step === sol.length - 1) || isMate) {
      depth++; step++;
      if (step >= sol.length || isMate) return finish(1, `Solved! ${depth} move${depth > 1 ? "s" : ""} found.`);
      brd.locked = true;
      setTimeout(() => { brd.play(sol[step]); step++; if (step >= sol.length) return finish(1, "Solved!"); brd.locked = false; v.querySelector("#tfb").innerHTML = `<div class="feedback ok">Right, keep going: ${depth}/${nMine}</div>`; }, 450);
      return;
    }
    const sc = depth === 0 ? 0 : 0.8 * depth / nMine;
    finish(sc, depth === 0 ? `${mv.san}: that's not it.` : `${mv.san}: you got ${depth} of ${nMine} moves right, then went wrong.`);
  };
}

// ------------------------------------------------------------------ PRACTICE (training modules)
export async function practiceView(v, arg, C) {
  const p = C.P(); const cat = arg?.cat || "Calculation";
  const st = (p.practice ||= {})[cat] ||= { est: playerElo(p) - 150, n: 0, solved: 0, used: [] };
  const opts = { cat, est: { overall: st.est }, used: st.used.map((id) => ({ id })),
    onDone: (rec) => { st.n++; if (rec.score >= 0.99) st.solved++; st.used.push(rec.id); st.used = st.used.slice(-300); st.est += 120 * (rec.score - expected(rec.rating, st.est)); opts.est.overall = st.est; opts.used = st.used.map((id) => ({ id }));
      C.logEvent("training", `${catLabel(cat)}: ${rec.score >= 0.99 ? "solved" : rec.score > 0 ? "partly" : "missed"} (≈${rec.rating})`); } };
  await runItem(v, null, C, opts);
}

// ------------------------------------------------------------------ QUESTIONNAIRE
function questionnaireView(v, cur, C) {
  cur.q ||= {};
  v.innerHTML = `<div class="card"><h2>Last part: how do you like to play?</h2><p class="small muted">There are no right or wrong answers. Choose what fits you best.</p>
    ${QUESTIONNAIRE.map((q, i) => `<div style="margin:12px 0"><b>${i + 1}. ${C.esc(q.q)}</b>${q.a.map(([t], j) => `<label class="row small" style="margin:4px 0"><input type="radio" name="q${i}" value="${j}" ${cur.q[i] === j ? "checked" : ""}> ${C.esc(t)}</label>`).join("")}</div>`).join("")}
    <button class="btn" id="finishTest">Finish test & see results</button></div>`;
  v.querySelectorAll("input[type=radio]").forEach((r) => (r.onchange = () => { cur.q[+r.name.slice(1)] = +r.value; C.save(); }));
  v.querySelector("#finishTest").onclick = () => {
    if (Object.keys(cur.q).length < QUESTIONNAIRE.length && !confirm("You haven't answered every question. Finish anyway?")) return;
    cur.done = true; cur.result = computeResult(C.P(), cur); C.save();
    C.logEvent("test", `Test finished: overall ${cur.result.overall}, type ${PLAYER_TYPES[cur.result.type].name}`);
    C.go("results");
  };
}

// ------------------------------------------------------------------ RESULT COMPUTATION
export function computeResult(p, t, A = null) {
  const items = t.items, elo = t.startRating;
  const cats = {};
  for (const it of items) (cats[it.cat] ||= []).push(it);
  const R = { elo, overall: perfRating(items, elo), tactical: perfRating(items.filter((i) => i.kind === "tac"), elo), positional: perfRating(items.filter((i) => i.kind === "pos"), elo), cats: {} };
  for (const [c, l] of Object.entries(cats)) R.cats[c] = { rating: perfRating(l, R.overall), n: l.length, score: Math.round(100 * l.reduce((a, x) => a + x.score, 0) / l.length) };
  const long = items.filter((i) => i.kind === "tac" && i.nMine >= 2);
  R.depth = long.length ? { avg: +(long.reduce((a, x) => a + x.depth, 0) / long.length).toFixed(1), avgNeeded: +(long.reduce((a, x) => a + x.nMine, 0) / long.length).toFixed(1), full: long.filter((x) => x.score >= 0.99).length, n: long.length } : null;
  const planned = items.filter((i) => (i.line || "").trim());
  R.planned = planned.length ? { n: planned.length, avgMatch: +(planned.reduce((a, x) => a + x.plannedMatch, 0) / planned.length).toFixed(1) } : null;
  const times = items.filter((i) => i.move).map((i) => i.timeMs / 1000).sort((a, b) => a - b);
  R.time = times.length ? { median: Math.round(times[Math.floor(times.length / 2)]), correct: avg(items.filter((i) => i.score >= 0.99 && i.move).map((i) => i.timeMs / 1000)), wrong: avg(items.filter((i) => i.score < 0.5 && i.move).map((i) => i.timeMs / 1000)) } : null;
  const ch = items.filter((i) => i.character); const chWrong = items.filter((i) => i.character && i.score < 0.5);
  R.character = { aggressive: pct(ch, "aggressive"), solid: pct(ch, "solid"), wrongAggressive: pct(chWrong, "aggressive"), wrongSolid: pct(chWrong, "solid"), nWrong: chWrong.length };
  // ---- player type scores (0-100 each): test deltas + questionnaire + games
  const cr = (k) => R.cats[k]?.rating ?? R.overall;
  const m = (...ks) => ks.reduce((a, k) => a + cr(k), 0) / ks.length;
  const test = {
    activist: m("Attack & mate", "Sacrifice", "initiative") - m("Defence", "prophylaxis"),
    reflector: m("prophylaxis", "coordination") - m("Calculation"),
    pragmatist: m("Calculation", "Defence") - m("structure", "space"),
    theoretician: m("technique", "structure", "Endgame") - m("initiative", "Sacrifice"),
  };
  const q = { activist: 0, reflector: 0, pragmatist: 0, theoretician: 0 }; const map = { a: "activist", r: "reflector", p: "pragmatist", t: "theoretician" };
  for (const [i, j] of Object.entries(t.q || {})) for (const [k, pts] of Object.entries(QUESTIONNAIRE[i].a[j][1])) q[map[k]] += pts;
  const qTot = Object.values(q).reduce((a, b) => a + b, 0) || 1;
  const aggr = A?.style?.aggression ?? null;
  const scores = {};
  for (const k of Object.keys(q)) scores[k] = 25 + (q[k] / qTot - 0.25) * 120 + Math.max(-15, Math.min(15, test[k] / 20));
  if (aggr !== null) { scores.activist += (aggr - 50) / 5; scores.reflector -= (aggr - 50) / 10; }
  if (R.character.wrongAggressive > 60) scores.activist += 5; if (R.character.wrongSolid > 60) scores.reflector += 3;
  const tot = Object.values(scores).reduce((a, b) => a + Math.max(1, b), 0);
  R.types = Object.fromEntries(Object.entries(scores).map(([k, x]) => [k, Math.round(100 * Math.max(1, x) / tot)]));
  R.type = Object.entries(R.types).sort((a, b) => b[1] - a[1])[0][0];
  // aggressive (100) vs defensive (0)
  const qa = q.activist / qTot * 100;
  const testA = 50 + Math.max(-25, Math.min(25, (m("Attack & mate", "Sacrifice", "initiative") - m("Defence", "prophylaxis", "kingsafety")) / 12));
  const parts = [qa, testA].concat(aggr !== null ? [aggr] : []).concat(R.character.aggressive ? [R.character.aggressive] : []);
  R.aggression = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
  return R;
}
const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
const pct = (a, k) => (a.length ? Math.round(100 * a.filter((x) => x.character === k).length / a.length) : 0);

// ------------------------------------------------------------------ RESULTS
export function resultsView(v, C) {
  const p = C.P(); const done = (p.tests || []).filter((t) => t.done);
  if (!done.length) { v.innerHTML = `<div class="card"><h2>Results</h2><p>You haven't finished a test yet.</p><button class="btn" id="toT">Take the test</button></div>`; v.querySelector("#toT").onclick = () => C.go("test"); return; }
  const t = done[done.length - 1];
  const A = Object.keys(p.games || {}).length ? C.aggregate(Object.values(p.games)) : null;
  const R = t.result = computeResult(p, t, A); C.save();
  const rows = Object.entries(R.cats).sort((a, b) => a[1].rating - b[1].rating);
  const bar = (val, lo = 600, hi = 2800) => `<div class="bar" style="height:10px"><div style="width:${Math.max(2, Math.min(100, (val - lo) / (hi - lo) * 100))}%"></div></div>`;
  v.innerHTML = `<div class="card"><h2>Test result (${C.esc(t.date)}, ${C.esc(MODES[t.mode].name)})</h2>
    <div class="stats"><div class="stat"><div class="v">${R.overall}</div><div class="l">test rating (your games: ${R.elo})</div></div>
    <div class="stat"><div class="v">${R.tactical}</div><div class="l">tactical</div></div><div class="stat"><div class="v">${R.positional}</div><div class="l">positional</div></div>
    ${R.depth ? `<div class="stat"><div class="v">${R.depth.avg}/${R.depth.avgNeeded}</div><div class="l">calculation depth (moves found / needed)</div></div>` : ""}
    ${R.time ? `<div class="stat"><div class="v">${R.time.median}s</div><div class="l">median time to first move</div></div>` : ""}</div>
    <p class="small muted">Test ratings come from the puzzle ratings (Lichess scale) and your scores. Lichess puzzle ratings tend to run somewhat higher than game ratings, and one test of ${t.items.length} positions gives an indication (±150), not an exact number. Compare above all your <b>categories with each other</b>.</p></div>
    <div class="card"><h2>Per category (weakest first)</h2><table>${rows.map(([c, x]) => `<tr><td>${C.esc(catLabel(c))}</td><td style="width:40%">${bar(x.rating)}</td><td><b>${x.rating}</b> <span class="small muted">${x.rating - R.elo >= 0 ? "+" : ""}${x.rating - R.elo} vs Elo · ${x.n} pos.</span></td><td><button class="btn secondary small" data-prac="${C.esc(c)}">Train</button></td></tr>`).join("")}</table></div>
    <div class="card"><h2>How do you think?</h2><ul class="small">
      ${R.depth ? `<li><b>Calculation depth:</b> on positions with 2+ moves you found on average ${R.depth.avg} of ${R.depth.avgNeeded} moves; ${R.depth.full}/${R.depth.n} fully solved. ${R.depth.avg / R.depth.avgNeeded < 0.6 ? "You often stop calculating too early: keep going until the position is quiet (no more checks or captures)." : "You calculate lines through well."}</li>` : ""}
      ${R.planned ? `<li><b>Your written lines:</b> on average ${R.planned.avgMatch} ply matched the solution (${R.planned.n} positions with a line).</li>` : `<li>You didn't write down any lines. Next time, write the line you calculated, so you can see how far you thought ahead.</li>`}
      ${R.time ? `<li><b>Time:</b> median ${R.time.median}s to your first move${R.time.correct ? `; right answers ${R.time.correct}s` : ""}${R.time.wrong ? `, wrong answers ${R.time.wrong}s` : ""}. ${R.time.wrong && R.time.correct && R.time.wrong < R.time.correct * 0.7 ? "Your wrong answers came faster than your right ones: you play too quickly when you think you see it. Do a blunder check!" : ""}</li>` : ""}
      <li><b>Character of your moves:</b> ${R.character.aggressive}% aggressive (check, capture, toward the king), ${R.character.solid}% solid. ${R.character.nWrong ? `Of your wrong answers, ${R.character.wrongAggressive}% were aggressive and ${R.character.wrongSolid}% solid.` : ""}</li></ul></div>
    <div class="card"><h2>Your answers</h2><div class="scroll"><table><tr><th>#</th><th>Category</th><th>Rating</th><th>Your move</th><th>Solution</th><th>Score</th><th>Time</th><th>Your reasoning</th></tr>
      ${t.items.map((i, k) => `<tr><td>${k + 1}</td><td class="small">${C.esc(catLabel(i.cat))}</td><td>${i.rating}</td><td>${C.esc(i.move || "–")}</td><td class="small">${C.esc(i.solution)}</td><td>${Math.round(i.score * 100)}%</td><td>${Math.round(i.timeMs / 1000)}s</td><td class="small">${C.esc(i.why || "")}${i.line ? `<br><i>line: ${C.esc(i.line)}</i>` : ""}</td></tr>`).join("")}</table></div>
      <div class="row" style="margin-top:8px"><button class="btn secondary" id="copyT">Copy for Claude (feedback on my reasoning)</button><button class="btn" id="toProf">See my player profile</button></div></div>`;
  v.querySelectorAll("[data-prac]").forEach((b) => (b.onclick = () => C.go("practice", { cat: b.dataset.prac })));
  v.querySelector("#toProf").onclick = () => C.go("profile");
  v.querySelector("#copyT").onclick = () => C.copy(`Chess test. Give feedback on my REASONING per position (not just the move): what did I see right, what did I miss, and what does that say about how I think?\nMy rating: ${R.elo}. Test rating ${R.overall} (tactical ${R.tactical}, positional ${R.positional}).\n\n` +
    t.items.map((i, k) => `${k + 1}. [${catLabel(i.cat)}, ≈${i.rating}] FEN ${i.fen}\n   My move: ${i.move || "-"} (${Math.round(i.timeMs / 1000)}s), solution: ${i.solution}, score ${Math.round(i.score * 100)}%\n   My reasoning: ${i.why || "-"}${i.line ? `\n   My line: ${i.line}` : ""}`).join("\n"));
}

// ------------------------------------------------------------------ PROFILE
export function profileView(v, C) {
  const p = C.P();
  const t = (p.tests || []).filter((x) => x.done).slice(-1)[0];
  const gs = Object.values(p.games || {});
  const A = gs.length ? C.aggregate(gs) : null;
  if (!t && !A) { v.innerHTML = `<div class="card"><h2>Player profile</h2><p>Analyse your games (Analyse → Games) and/or take the test first.</p></div>`; return; }
  const R = t ? computeResult(p, t, A) : null;
  const type = R ? R.type : guessTypeFromGames(A);
  const T = PLAYER_TYPES[type], O = STYLE_OPENINGS[type];
  const S = A?.style;
  const aggr = R ? R.aggression : S?.aggression ?? null;
  const rep = A ? repertoireFromGames(A) : null;
  const weakCats = R ? Object.entries(R.cats).sort((a, b) => a[1].rating - b[1].rating).slice(0, 3).map(([c]) => c) : [];
  v.innerHTML = `<div class="card"><h2>${C.esc(p.name)}: player profile</h2>
    <div class="stats"><div class="stat"><div class="v">${R ? R.elo : playerElo(p)}</div><div class="l">rating (games)</div></div>${R ? `<div class="stat"><div class="v">${R.overall}</div><div class="l">test rating</div></div>` : ""}
    <div class="stat"><div class="v">${C.esc(T.name)}</div><div class="l">dominant player type${R ? "" : " (from games only, take the test!)"}</div></div>
    ${aggr !== null ? `<div class="stat"><div class="v">${aggr}</div><div class="l">aggressive (100) ↔ defensive (0)</div></div>` : ""}</div></div>
    ${R ? `<div class="card"><h2>Player type (Lars Bo Hansen model)</h2><p class="small muted">Everyone has something of all four types; one usually dominates. Based on your test categories, the questionnaire${S ? " and your games" : ""}.</p>
      ${Object.entries(R.types).sort((a, b) => b[1] - a[1]).map(([k, x]) => `<div style="display:grid;grid-template-columns:105px 1fr 42px;gap:8px;align-items:center;margin:6px 0"><b>${PLAYER_TYPES[k].name}</b><div class="bar" style="height:10px"><div style="width:${x}%"></div></div><span>${x}%</span></div>`).join("")}</div>` : ""}
    <div class="card"><h2>You as ${C.esc(T.name.toLowerCase())}</h2><p>${C.esc(T.traits)} <span class="small muted">(Like ${C.esc(T.examples)}.)</span></p>
      <h3>Strengths</h3><ul class="small">${T.strengths.map((x) => `<li>${C.esc(x)}</li>`).join("")}</ul>
      <h3>Typical pitfalls</h3><ul class="small">${T.weaknesses.map((x) => `<li>${C.esc(x)}</li>`).join("")}</ul>
      <h3>Work points</h3><ul class="small">${T.work.map((x) => `<li>${C.esc(x)}</li>`).join("")}</ul>
      <div class="row">${[...new Set(T.modules.concat(weakCats))].map((c) => `<button class="btn secondary small" data-prac="${C.esc(c)}">Train: ${C.esc(catLabel(c))}</button>`).join("")}</div></div>
    ${S ? `<div class="card"><h2>Style in your games (${S.games} games)</h2><table class="small">
      <tr><td>Checks / captures / moves near the enemy king</td><td>${S.checksPct}% / ${S.capturesPct}% / ${S.kingZonePct}% of your moves</td></tr>
      <tr><td>Sacrifices (≥2 points, not won straight back)</td><td>${S.sacSound} sound, ${S.sacUnsound} unsound (${S.sacPer10} per 10 games)</td></tr>
      <tr><td>Opposite-side castling</td><td>${S.oppCastlePct}% of games${S.stormPerGame ? `, ${S.stormPerGame} pawn-storm moves per game` : ""}</td></tr>
      <tr><td>Queens traded before move 20</td><td>${S.earlyQueenTradePct}% of games</td></tr>
      <tr><td><b>Accuracy when you're ahead / equal / behind</b></td><td><b>${S.acc.ahead ?? "–"} / ${S.acc.equal ?? "–"} / ${S.acc.behind ?? "–"}</b></td></tr></table>
      <p class="small">${styleComment(S)}</p></div>` : (A ? `<div class="card"><p class="small">Analyse new games (or re-analyse them) for style statistics.</p></div>` : "")}
    <div class="card"><h2>Openings</h2>
      ${rep ? `<h3>What you play now</h3><table class="small">${rep.map((r) => `<tr><td>${C.esc(r.label)}</td><td>${C.esc(r.name)}</td><td>${r.games} games, ${r.scorePct}%</td></tr>`).join("")}</table>` : ""}
      ${A && A.hardest.length ? `<h3>Hardest for you (lowest score)</h3><table class="small">${A.hardest.map((o) => `<tr><td>${o.color === "w" ? "as White" : "as Black"}</td><td>${C.esc(o.name)}</td><td>${o.games} games, ${o.scorePct}%${o.wpAfter10 != null ? `, win chance after move 10 ${o.wpAfter10}%` : ""}</td></tr>`).join("")}</table>
        <p class="small muted">Win chance after move 10 is low? Then study the opening itself. Is it fine? Then the problem is the middlegame plan: study model games in that structure.</p>` : ""}
      <h3>What fits a ${C.esc(T.name.toLowerCase())}</h3>
      <div class="small"><b>White:</b><ul>${O.white.map(([l, w]) => `<li><b>${C.esc(l)}</b>: ${C.esc(w)}</li>`).join("")}</ul><b>Black:</b><ul>${O.black.map(([l, w]) => `<li><b>${C.esc(l)}</b>: ${C.esc(w)}</li>`).join("")}</ul>
      <p><b>Uncomfortable for your type:</b> ${C.esc(O.hard)}</p>
      <p class="muted">Advice: pick an opening that fits your style, but also train the opposite. An activist who only plays sharp lines never learns to defend, and a reflector who avoids sharp positions keeps calculating poorly.</p></div></div>
    <div class="card"><div class="row"><button class="btn secondary" id="copyProf">Copy profile for Claude (opening & training plan)</button></div></div>`;
  v.querySelectorAll("[data-prac]").forEach((b) => (b.onclick = () => C.go("practice", { cat: b.dataset.prac })));
  v.querySelector("#copyProf").onclick = () => C.copy(`My chess profile. Build a concrete opening repertoire (with variations) and a 4-week training plan that fit me.\n\nRating ${R ? R.elo : playerElo(p)}${R ? `, test rating ${R.overall} (tactical ${R.tactical}, positional ${R.positional})` : ""}.\nPlayer type: ${T.name}${R ? ` (${Object.entries(R.types).map(([k, x]) => `${PLAYER_TYPES[k].name} ${x}%`).join(", ")})` : ""}. Aggressive/defensive: ${aggr ?? "?"}/100.\n` +
    (R ? `Categories: ${Object.entries(R.cats).map(([c, x]) => `${catLabel(c)} ${x.rating}`).join(", ")}.\n` : "") + (R?.depth ? `Calculation depth: ${R.depth.avg}/${R.depth.avgNeeded}. Median time ${R.time?.median}s.\n` : "") +
    (S ? `Games: accuracy ahead/equal/behind ${S.acc.ahead}/${S.acc.equal}/${S.acc.behind}; sacrifices ${S.sacPer10}/10 games; opposite-side castling ${S.oppCastlePct}%.\n` : "") +
    (rep ? `Current repertoire: ${rep.map((r) => `${r.label}: ${r.name} (${r.games}x, ${r.scorePct}%)`).join("; ")}.\n` : "") + (A?.hardest?.length ? `Hardest openings: ${A.hardest.map((o) => `${o.color === "w" ? "W" : "B"} ${o.name} (${o.scorePct}%)`).join("; ")}.` : ""));
}

function styleComment(S) {
  const out = [];
  const { ahead, equal, behind } = S.acc;
  if (ahead && behind) {
    if (behind > ahead + 3) out.push("You play more accurately when you're worse than when you're better: you defend well, but you let winning positions slip. Work on technique and calm when you're ahead.");
    else if (ahead > behind + 3) out.push("You play better when you're ahead than when you're behind. In bad positions you lose your accuracy: practise defending (Defence module) and stay calm in worse positions.");
  }
  if (S.sacPer10 >= 5) out.push(`You sacrifice often (${S.sacPer10} per 10 games)${S.sacUnsound > S.sacSound ? ", but more often unsoundly than soundly: calculate first, or prepare it with one extra move" : ", and mostly soundly"}.`);
  if (S.earlyQueenTradePct >= 30) out.push("You often trade queens early, which points to a technical, low-risk style.");
  if (S.oppCastlePct >= 25) out.push("You often end up with opposite-side castling: sharp races where tempo counts.");
  return out.join(" ") || "No extreme patterns: a fairly balanced style.";
}
function guessTypeFromGames(A) {
  const s = A?.style; if (!s) return "pragmatist";
  if (s.aggression >= 60) return "activist";
  if (s.earlyQueenTradePct >= 30) return "theoretician";
  if ((s.acc.equal ?? 0) >= 90 && s.aggression < 40) return "reflector";
  return "pragmatist";
}
function repertoireFromGames(A) {
  const pick = (c, re) => A.openings.filter((o) => o.color === c && (!re || re.test(o.name))).sort((a, b) => b.games - a.games)[0];
  const out = [];
  const w = pick("w"); if (w) out.push({ label: "Most played as White", name: w.name, games: w.games, scorePct: w.scorePct });
  const be4 = pick("b", /Sicilian|French|Caro|Scandinavian|Pirc|Modern|Alekhine|Italian|Ruy|Spanish|Scotch|Petrov|Petroff|King'?s Pawn|Vienna|Philidor|Four Knights|Owen|Nimzowitsch|^e4/i); if (be4) out.push({ label: "As Black vs 1.e4", name: be4.name, games: be4.games, scorePct: be4.scorePct });
  const bd4 = pick("b", /Queen'?s|Indian|Slav|Gr[uü]nfeld|Dutch|Benoni|Budapest|Catalan|London|Nimzo|Bogo|Trompowsky|Colle|English|Reti|R[ée]ti|^d4|^c4|^Nf3/i); if (bd4) out.push({ label: "As Black vs 1.d4", name: bd4.name, games: bd4.games, scorePct: bd4.scorePct });
  return out.length ? out : null;
}
