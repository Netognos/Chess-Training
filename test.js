// TEST & PROFILE: adaptive position test (move + why), calculation depth, time, style,
// player type (Lars Bo Hansen model) and a combined player profile.
import { Chess } from "./vendor/chess.js";
import { Board } from "./board.js";
import { PLAYER_TYPES, QUESTIONNAIRE, STYLE_OPENINGS } from "./data.js";
import { explainMove, explainHtml } from "./explain.js";
import { aiKey, setAiKey, testKey, rubricFrom, judgeReasoning } from "./ai.js";

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
      <div class="card" id="aiCard"></div>
      <div class="card"><h2>Training modules</h2><p class="small">Practise one category at a time around your level, without a test score. Your results appear in the Log.</p>
      <div class="row">${TAC_CATS.concat(Object.keys(POS_GROUPS)).map((c) => `<button class="btn secondary small" data-prac="${C.esc(c)}">${C.esc(catLabel(c))}</button>`).join("")}</div></div>`;
    v.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = async () => { await startTest(p, b.dataset.mode, C); C.go("test"); }));
    aiSettings(v.querySelector("#aiCard"));
    v.querySelectorAll("[data-prac]").forEach((b) => (b.onclick = () => C.go("practice", { cat: b.dataset.prac })));
    v.querySelector("#toRes") && (v.querySelector("#toRes").onclick = (e) => { e.preventDefault(); C.go("results"); });
    return;
  }
  if (cur.items.length >= cur.plan.length) return questionnaireView(v, cur, C);
  await runItem(v, cur, C, { test: true });
}

// AI key settings card (used on the test start page, during a test and on the profile page)
export function aiSettings(el) {
  el.innerHTML = `<h2>AI coach (Gemini, free)</h2>
        <p class="small">With an AI key, an AI reads your written reasoning and checks how far you saw: the <b>idea</b> (e.g. the fork), the <b>danger</b> (e.g. capturing straight away loses your queen) and the <b>follow-up & plan</b> (e.g. move the queen first, keep the opponent passive). Rejecting the move for the right reason counts as half right. Stockfish supplies the chess facts; the AI only judges your text.</p>
        <ol class="small"><li>Go to <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> and sign in with a Google account.</li><li>Click <b>Create API key</b> and copy it (free, no credit card needed).</li><li>Paste it here and click Save.</li></ol>
        <div class="row"><input id="aiKey" type="password" class="grow" placeholder="Gemini API key" value="${aiKey() ? "••••••••••••" : ""}"><button class="btn secondary" id="aiSave">Save</button><button class="btn secondary" id="aiTest">Test</button>${aiKey() ? `<button class="btn secondary" id="aiDel">Remove</button>` : ""}</div>
        <div id="aiMsg" class="small" style="margin-top:6px">${aiKey() ? "✓ AI coach is on." : "AI coach is off."}</div>
        <p class="small muted">Your key stays in this browser only (not in backups or on GitHub). Position, moves and your notes are sent to Google Gemini for the assessment. Free tier: a limited number of requests per minute.</p>`;
  const msg = el.querySelector("#aiMsg");
  el.querySelector("#aiSave").onclick = () => { const k = el.querySelector("#aiKey").value.trim(); if (!k || k.startsWith("•")) return; setAiKey(k); msg.textContent = "Saved. Click Test to check it."; };
  el.querySelector("#aiTest").onclick = async () => { msg.textContent = "Testing…"; try { const r = await testKey(); msg.textContent = r.ok ? `✓ Works (model: ${r.model}).` : "Unexpected answer."; } catch (e) { msg.textContent = "✗ " + (e.message || e); } };
  el.querySelector("#aiDel") && (el.querySelector("#aiDel").onclick = () => { setAiKey(""); aiSettings(el); });
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

// ---- reading a written line ("Txf7 Kxf7 Dh5+" / "1.Rxf7 Kxf7 2.Qh5+" / UCI), Dutch or English piece letters
export function parseLine(fen, text) {
  const c = new Chess(fen); const moves = [];
  const toks = (text || "").replace(/…/g, "...").replace(/[,;]/g, " ").split(/\s+/).map((t) => t.replace(/^\d+\.(\.\.)?/, "").replace(/[!?]+$/, "")).filter((t) => t && !/^\d+\.*$/.test(t));
  for (const [i, raw] of toks.entries()) {
    let t = raw.replace(/^0-0-0/, "O-O-O").replace(/^0-0/, "O-O").replace(/^([DTLP])/, (m) => ({ D: "Q", T: "R", L: "B", P: "N" }[m])).replace(/=([DTLP])/, (m, x) => "=" + { D: "Q", T: "R", L: "B", P: "N" }[x]);
    let mv = null;
    try { mv = c.move(t, { strict: false }); } catch { mv = null; }
    if (!mv && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(raw)) { try { mv = c.move({ from: raw.slice(0, 2), to: raw.slice(2, 4), promotion: raw[4] }); } catch { mv = null; } }
    if (!mv) return { moves, error: { index: i, token: raw } };
    moves.push({ san: mv.san, uci: mv.from + mv.to + (mv.promotion || "") });
  }
  return { moves, error: null };
}

// Check a written line against the solution and, where it deviates, with the engine.
// Returns how many of YOUR moves are sound (consecutively from the start), plus notes.
async function gradeLine(C, fen, user, sol, deadline) {
  const pos = new Chess(fen); let own = 0, onSol = true, matchPlies = 0; const notes = [];
  for (let k = 0; k < user.length; k++) {
    const mine = k % 2 === 0, u = user[k];
    if (onSol && k < sol.length && u.uci === sol[k]) {
      pos.move({ from: u.uci.slice(0, 2), to: u.uci.slice(2, 4), promotion: u.uci[4] }); matchPlies++; if (mine) own++;
      if (pos.isCheckmate()) { notes.push(`${u.san}#: mate, as in the solution.`); break; }
      continue;
    }
    const before = pos.fen();
    if (mine) {
      const test = new Chess(before); test.move({ from: u.uci.slice(0, 2), to: u.uci.slice(2, 4), promotion: u.uci[4] });
      if (test.isCheckmate()) { own++; notes.push(`${u.san}: also mate. That works too!`); break; }
      const g = await C.gradeMove(before, u.uci, 700);
      if (g.drop < 3) { own++; onSol = false; notes.push(`${u.san}: different from the solution, but the engine finds it just as good.`); pos.move(u.san); continue; }
      notes.push(`${u.san}: this goes wrong here (−${g.drop.toFixed(0)}% win chance). Stronger is ${g.bestLine.split(" ")[0]}.`); break;
    } else {
      const g = await C.gradeMove(before, u.uci, 500);
      if (g.drop >= 10) { notes.push(`You assumed ${u.san} for your opponent, but they have a stronger defence: ${g.bestLine.split(" ")[0]}. Your line stops being reliable here.`); break; }
      onSol = false; notes.push(`${u.san}: a reasonable reply you considered (not the main line, but no blunder).`); pos.move(u.san);
    }
  }
  return { own, matchPlies, notes, onSol };
}

const KW = {
  mate: ["mat", "mate", "checkmat"], fork: ["vork", "fork", "dubbele aanval", "double attack"], pin: ["pen", "pin", "gepend"], skewer: ["spies", "skewer", "doorschuif"],
  sacrifice: ["offer", "sacrif", "sac "], promotion: ["promo", "dame halen", "promote", "queening"], defence: ["verdedig", "defen", "dreig", "threat", "dek", "cover", "redden"],
  attack: ["koning", "king", "aanval", "attack"], trade: ["ruil", "trade", "exchang", "afruil"], space: ["ruimte", "space", "centrum", "centre", "center"],
  weakness: ["zwak", "weak", "gat", "hole", "voorpost", "outpost", "isol"], prophylaxis: ["profyla", "prophyla", "voorkom", "prevent", "beperk", "restrict"],
  coordination: ["coörd", "coord", "verbeter", "improve", "activ", "slechtste stuk", "worst piece", "ontwikkel", "develop"], endgame: ["eindspel", "endgame", "vrijpion", "passed", "oppositie", "opposition"],
};
const THEME_KW = { mate: ["mate", "attack"], defence: ["defence"], sacrifice: ["sacrifice"], quiet: ["prophylaxis", "coordination"], endgame: ["endgame"], calculation: [], tactics: ["fork", "pin", "skewer"],
  initiative: ["attack", "space"], prophylaxis: ["prophylaxis"], restriction: ["prophylaxis"], coordination: ["coordination"], development: ["coordination"], space: ["space"], centrecontrol: ["space"],
  exploitingweakness: ["weakness"], fixingstructure: ["weakness"], trading: ["trade"], kingsafety: ["defence", "attack"] };
function ideaCheck(text, themes) {
  const t = " " + (text || "").toLowerCase() + " ";
  const said = Object.entries(KW).filter(([, ws]) => ws.some((w) => t.includes(w))).map(([k]) => k);
  const want = [...new Set(themes.flatMap((x) => THEME_KW[x] || []))];
  return { said, want, hit: said.filter((x) => want.includes(x)) };
}

// Runs one position. opts.test → part of a test; otherwise practice (opts.cat, opts.onDone)
async function runItem(v, cur, C, opts) {
  const slot = opts.test ? cur.plan[cur.items.length] : { kind: TAC_CATS.includes(opts.cat) ? "tac" : "pos", cat: opts.cat };
  const est = opts.test ? cur.est : opts.est;
  const it = await pickItem({ items: opts.used || cur.items, est }, slot);
  if (!it) { v.innerHTML = `<div class="card"><p>No more positions in this category.</p></div>`; return; }
  window.__ccItem = it;
  const fen = it.fen, stm = fen.split(" ")[1];
  const sol = slot.kind === "tac" ? it.sol.split(" ") : [it.best];
  const solSan = (() => { const c = new Chess(fen); const o = []; for (const u of sol) { try { o.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san); } catch { break; } } return o; })();
  const nMine = Math.ceil(sol.length / 2);
  const themes = (it.c ? [it.c] : []).concat(it.t || it.th || []);
  v.innerHTML = `<div class="two"><div><div id="tb"></div><div class="row" style="margin-top:8px" id="stepBtns"></div></div>
    <div><div class="card"><h2>${opts.test ? `Position ${cur.items.length + 1} of ${cur.plan.length}` : `Practice: ${C.esc(catLabel(opts.cat))}`}</h2>
      <div class="row" style="justify-content:space-between"><b>${stm === "w" ? "White" : "Black"} to move</b><span class="pill" id="timer">0:00</span></div>
      <p class="small muted">${slot.kind === "tac" ? "There is something concrete here. Don't play on the board: write down your idea and the <b>whole line</b> you see, as far as you can calculate it." : "There's no direct tactic. Write down your move and the idea or plan behind it."}${opts.test ? "" : ` · rating ≈ ${it.r}`}</p>
      <div class="small" style="margin:6px 0">AI coach: ${aiKey() ? "<b>on</b>" : "<b>off</b>"} · <a href="#" id="aiToggle">${aiKey() ? "settings" : "set up (free)"}</a></div><div id="aiInline" class="card hidden"></div>
      <div id="stage"></div><div id="tfb"></div></div></div></div>`;
  const brd = new Board(v.querySelector("#tb")); brd.setFen(fen); brd.setOrientation(stm); brd.locked = true;
  v.querySelector("#aiToggle").onclick = (e) => { e.preventDefault(); const el = v.querySelector("#aiInline"); el.classList.toggle("hidden"); if (!el.classList.contains("hidden")) aiSettings(el); };
  const t0 = Date.now(); let tSubmit = null, finished = false, depthStart = null, depthTotal = 0, stages = 0, allNotes = [], firstMove = null, character = null, ideaTxt = "", lineTxt = "", moveScore = null;
  const timer = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); const el = v.querySelector("#timer"); if (!el) return clearInterval(timer); el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }, 500);
  const scrollFb = () => v.querySelector("#tfb").scrollIntoView({ behavior: "smooth", block: "nearest" });

  const stepper = (lineSan, startFen) => {
    let i = 0; const b = v.querySelector("#stepBtns");
    b.innerHTML = `<button class="btn secondary small" id="sBack">◀</button><button class="btn secondary small" id="sFwd">▶ Play through the solution</button><button class="btn secondary small" id="toBoardIt">Open on Board</button>`;
    const draw = () => { const c = new Chess(startFen); let last = null; for (let k = 0; k < i; k++) { const m = c.move(lineSan[k]); last = [m.from, m.to]; } brd.setFen(c.fen(), { last }); };
    b.querySelector("#sBack").onclick = () => { i = Math.max(0, i - 1); draw(); };
    b.querySelector("#sFwd").onclick = () => { i = Math.min(lineSan.length, i + 1); draw(); };
    b.querySelector("#toBoardIt").onclick = () => C.go("board", { fen });
  };

  const finish = async (note) => {
    if (finished) return; finished = true; clearInterval(timer);
    let base;
    if (slot.kind === "pos") base = moveScore ?? 0;
    else base = depthStart === null ? 0 : depthStart >= nMine ? 1 : Math.min(1, (depthStart + 0.5 * Math.max(0, depthTotal - depthStart)) / nMine);
    v.querySelector("#stage").innerHTML = "";
    const useAI = !!aiKey() && !!(ideaTxt || lineTxt);
    v.querySelector("#tfb").innerHTML = `<div class="feedback info">${C.esc(note)}<br><span class="small">Stockfish is working out why ${C.esc(solSan[0])} is the move${useAI ? ", and the AI coach is reading your reasoning" : ""}…</span></div>`;
    scrollFb();
    let x = null, ai = null, aiErr = null;
    try { x = await explainMove(C.engine(), fen, sol[0], ideaTxt, lineTxt); } catch (e) { console.warn(e); }
    if (useAI && x) {
      try {
        const [top] = await C.engine().analyse(fen, { movetime: 600 });
        ai = await judgeReasoning({ fen, side: stm === "w" ? "White" : "Black", category: catLabel(slot.cat), rating: it.r, solution: solSan.join(" "),
          engineLine: x.facts.find((f) => f.includes("Main line")) || solSan.join(" "), evalText: `${x.san} ${(x.bestCp / 100).toFixed(1)} for the player`,
          alternatives: x.alts.map((a) => `${a.san} ${(a.cp / 100).toFixed(1)}`).join(", ") || "-", rubric: rubricFrom(x, solSan.join(" ")),
          userMove: firstMove, userLine: lineTxt, userNotes: ideaTxt });
      } catch (e) { aiErr = e.message || String(e); console.warn(e); }
    }
    let score = base;
    if (ai) { score = 0.5 * base + 0.5 * ai.understanding; if (base < 0.5 && ai.rejected) score = Math.max(score, 0.45); }
    const rec = { id: it.id, kind: slot.kind, cat: slot.cat, rating: it.r, fen, score, moveScore: base, depth: depthStart ?? 0, depthTotal, stages, nMine,
      timeMs: (tSubmit || Date.now()) - t0, totalMs: Date.now() - t0, move: firstMove, character, why: ideaTxt, line: lineTxt, plannedMatch: depthStart ?? 0,
      solution: solSan.join(" "), themes, notes: allNotes, url: it.url || (it.c ? `https://lichess.org/training/${it.id}` : ""),
      explain: x ? { saw: x.conceptCheck.filter((c) => c.hit).map((c) => c.label), missed: x.conceptCheck.filter((c) => !c.hit).map((c) => c.label) } : null,
      ai: ai ? { idea: ai.levels.idea.credit, danger: ai.levels.danger.credit, followup: ai.levels.followup.credit, rejected: ai.rejected, feedback: ai.feedback, missed: ai.missed } : null };
    if (opts.test) {
      cur.items.push(rec);
      const K = Math.max(70, 320 / Math.sqrt(cur.items.length));
      cur.est.overall += K * (score - expected(it.r, cur.est.overall));
      const ce = cur.est[slot.cat] ?? cur.est.overall; cur.est[slot.cat] = ce + Math.max(90, 300 / Math.sqrt(cur.items.filter((x2) => x2.cat === slot.cat).length)) * (score - expected(it.r, ce));
    } else opts.onDone && opts.onDone(rec);
    C.save();
    const lvl = (id, label) => { const l = ai.levels[id]; return `<li>${l.credit >= 1 ? "✓" : l.credit > 0 ? "½" : "✗"} <b>${label}</b>${l.evidence && l.evidence !== "-" ? `: <i>"${C.esc(l.evidence)}"</i>` : ""}</li>`; };
    v.querySelector("#tfb").innerHTML = `<div class="feedback ${score >= 0.9 ? "ok" : score > 0 ? "info" : "no"}"><b>${C.esc(note)}</b><br>Solution: <b>${C.esc(solSan.join(" "))}</b>
      <div class="small" style="margin-top:6px">${slot.kind === "tac" ? `<b>Calculated from the start:</b> ${depthStart ?? 0} of ${nMine} of your moves${depthTotal > (depthStart ?? 0) ? ` · <b>with help</b> (after moves had been played): ${depthTotal} of ${nMine}` : ""}<br>` : ""}
      Score for this position: <b>${Math.round(score * 100)}%</b>${ai ? ` (move/line ${Math.round(base * 100)}% + understanding ${Math.round(ai.understanding * 100)}%)` : ""} · time to your answer: ${Math.round(rec.timeMs / 1000)} s · ${C.esc(catLabel(slot.cat))} · rating ≈ ${it.r}</div>
      ${allNotes.length ? `<ul class="small">${allNotes.map((n) => `<li>${C.esc(n)}</li>`).join("")}</ul>` : ""}</div>
      ${ai ? `<div class="card" style="margin-top:10px"><h3 style="margin-top:0">AI coach: how far did you see?</h3><ul class="small">${lvl("idea", "Idea (what the move does)")}${lvl("danger", "Danger (why the obvious follow-up fails / the opponent's defence)")}${lvl("followup", "Follow-up & plan")}</ul>
        ${ai.rejected ? `<p class="small"><b>Half right:</b> you didn't play the move, but you rejected it for the real danger.</p>` : ""}
        <p class="small">${C.esc(ai.feedback)}</p>${ai.missed ? `<p class="small"><b>Most important thing you missed:</b> ${C.esc(ai.missed)}</p>` : ""}</div>`
        : aiErr ? `<div class="feedback no small">AI coach unavailable: ${C.esc(aiErr)}</div>` : !aiKey() && (ideaTxt || lineTxt) ? `<p class="small muted">Tip: add a free Gemini key on the Test start page, and the AI coach will judge your reasoning (idea, danger, follow-up).</p>` : ""}
      ${explainHtml(x, C.esc)}
      <p class="small muted">How the score works: your move/line counts for ${ai ? "half, and the depth of your understanding (idea 35%, danger 35%, follow-up 30%) for the other half" : "100% if you saw the whole line from the start; moves found only after help count for half"}. Positional positions: the best move = 100%, an equally good alternative 70%, playable 40%.</p>
      <div class="row"><button class="btn" id="nextIt">${opts.test ? (cur.items.length >= cur.plan.length ? "To the questionnaire" : "Next position") : "Next"}</button></div>`;
    stepper(solSan, fen);
    v.querySelector("#nextIt").onclick = () => (opts.test ? C.go("test") : runItem(v, cur, C, opts));
  };

  // stage: position after `pre` plies of the solution; user writes the rest
  const stage = (pre) => {
    const c = new Chess(fen); let last = null;
    for (const u of sol.slice(0, pre)) { const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); last = [m.from, m.to]; }
    const sfen = c.fen(); brd.setFen(sfen, { last }); brd.setOrientation(stm);
    const first = pre === 0;
    v.querySelector("#stage").innerHTML = `${first ? "" : `<div class="feedback info small">Correct so far. Your opponent replied <b>${C.esc(solSan[pre - 1])}</b> (see the board). <b>Continue the line from here.</b> This counts as "with help".</div>`}
      ${first ? `<label class="f" style="margin-top:6px"><b style="color:var(--ink)">Your idea: what's going on and why?</b><textarea id="why" style="min-height:60px" placeholder="E.g. 'The black king has no escape squares, so after Rxf7 there's a back-rank mate'"></textarea></label>` : ""}
      <label class="f" style="margin-top:6px"><b style="color:var(--ink)">${slot.kind === "tac" ? (first ? "Your line (your moves AND the opponent's replies)" : "Continue the line") : "Your move (optional: + how you continue)"}</b>
      <input id="line" placeholder="${slot.kind === "tac" ? "e.g. Txf7 Kxf7 Dh5+ Kg8 Dxe8 (Dutch or English letters)" : "e.g. Pd2 (and then Pf1-e3)"}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <div id="perr" class="small" style="color:var(--bad);margin-top:4px"></div>
      <div class="row" style="margin-top:8px"><button class="btn" id="submit">Submit answer</button><button class="btn secondary" id="skip">${first ? "I don't know / skip" : "Show solution"}</button></div>`;
    const inp = v.querySelector("#line");
    inp.focus({ preventScroll: true });
    inp.onkeydown = (e) => { if (e.key === "Enter") v.querySelector("#submit").click(); };
    v.querySelector("#skip").onclick = () => finish(first ? "Skipped." : `You found ${depthTotal} of ${nMine} moves.`);
    v.querySelector("#submit").onclick = async () => {
      const txt = inp.value.trim();
      if (!txt) { v.querySelector("#perr").textContent = "Write down at least your first move."; return; }
      const parsed = parseLine(sfen, txt);
      if (parsed.error) { v.querySelector("#perr").textContent = `"${parsed.error.token}" (move ${parsed.error.index + 1} of your line) is not a legal move${parsed.error.index ? " after the moves before it" : " in this position"}. Fix it and submit again; this doesn't count as a mistake.`; return; }
      if (first) { tSubmit = Date.now(); ideaTxt = v.querySelector("#why").value; lineTxt = txt; const m0 = new Chess(fen).move(parsed.moves[0].san); firstMove = m0.san; character = moveCharacter(fen, m0); }
      else lineTxt += " | " + txt;
      v.querySelector("#submit").disabled = true; v.querySelector("#tfb").innerHTML = `<div class="feedback info">Stockfish is checking your line…</div>`; scrollFb();
      stages++;
      if (slot.kind === "pos") {
        const u = parsed.moves[0];
        if (u.uci === sol[0]) { moveScore = 1; allNotes.push(`${u.san}: exactly the move the grandmaster panel chose.`); }
        else { const g = await C.gradeMove(fen, u.uci, 1200); moveScore = g.drop < 3 ? 0.7 : g.drop < 6 ? 0.4 : 0; allNotes.push(g.drop < 3 ? `${u.san}: a good alternative; the engine barely sees a difference.` : g.drop < 6 ? `${u.san}: playable, but not the best plan (−${g.drop.toFixed(0)}% win chance).` : `${u.san}: not the right idea (−${g.drop.toFixed(0)}% win chance). The engine prefers ${g.bestLine.split(" ")[0]}.`); }
        if (parsed.moves.length > 2) { const gl = await gradeLine(C, fen, parsed.moves, sol); if (gl.own > 1) allNotes.push(`Your follow-up holds up for ${gl.own} of your moves.`); }
        return finish(moveScore >= 1 ? "Correct!" : moveScore > 0 ? "Partly right." : "Not the right move.");
      }
      const gl = await gradeLine(C, sfen, parsed.moves, sol.slice(pre));
      allNotes.push(...gl.notes.map((n) => (first ? "" : "(continued) ") + n));
      const gotOwn = gl.own;
      if (first) depthStart = gotOwn;
      depthTotal = Math.ceil(pre / 2) + gotOwn;
      if (depthTotal >= nMine || (gl.notes.some((n) => n.includes("mate")) && gotOwn > 0)) { depthTotal = Math.max(depthTotal, nMine); if (first) depthStart = nMine; return finish(first ? `Excellent! You saw the whole line (${nMine} moves) straight away.` : `Solved, after help: ${depthStart} from the start, ${nMine} in total.`); }
      if (gotOwn === 0 && first) return finish("Your first move isn't right.");
      if (!gl.onSol || gotOwn === 0) return finish(first ? `Partly: ${gotOwn} of ${nMine} moves sound.` : `With help you got to ${depthTotal} of ${nMine}.`);
      // continue from the position after the correct moves + the opponent's reply
      stage(pre + gotOwn * 2);
    };
  };
  stage(0);
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
  R.depth = long.length ? { avg: +(long.reduce((a, x) => a + x.depth, 0) / long.length).toFixed(1), avgHelp: +(long.reduce((a, x) => a + (x.depthTotal ?? x.depth), 0) / long.length).toFixed(1), avgNeeded: +(long.reduce((a, x) => a + x.nMine, 0) / long.length).toFixed(1), full: long.filter((x) => x.score >= 0.99).length, n: long.length } : null;
  const planned = items.filter((i) => (i.line || "").trim());
  R.planned = planned.length ? { n: planned.length, avgMatch: +(planned.reduce((a, x) => a + x.plannedMatch, 0) / planned.length).toFixed(1) } : null;
  const times = items.filter((i) => i.move).map((i) => i.timeMs / 1000).sort((a, b) => a - b);
  R.time = times.length ? { median: Math.round(times[Math.floor(times.length / 2)]), correct: avg(items.filter((i) => i.score >= 0.99 && i.move).map((i) => i.timeMs / 1000)), wrong: avg(items.filter((i) => i.score < 0.5 && i.move).map((i) => i.timeMs / 1000)) } : null;
  const ai = items.filter((i) => i.ai);
  R.ai = ai.length ? { n: ai.length, idea: Math.round(100 * ai.reduce((a, x) => a + x.ai.idea, 0) / ai.length), danger: Math.round(100 * ai.reduce((a, x) => a + x.ai.danger, 0) / ai.length), followup: Math.round(100 * ai.reduce((a, x) => a + x.ai.followup, 0) / ai.length), rejected: ai.filter((x) => x.ai.rejected).length } : null;
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
    <p class="small muted"><b>Test rating</b> = the rating at which your result would be "expected", worked out from the difficulty (rating) of each position and your score on it, the way a performance rating is calculated in a tournament. Test ratings come from the puzzle ratings (Lichess scale) and your scores. Lichess puzzle ratings tend to run somewhat higher than game ratings, and one test of ${t.items.length} positions gives an indication (±150), not an exact number. Compare above all your <b>categories with each other</b>.</p></div>
    <div class="card"><h2>Per category (weakest first)</h2><table>${rows.map(([c, x]) => `<tr><td>${C.esc(catLabel(c))}</td><td style="width:40%">${bar(x.rating)}</td><td><b>${x.rating}</b> <span class="small muted">${x.rating - R.elo >= 0 ? "+" : ""}${x.rating - R.elo} vs Elo · ${x.n} pos.</span></td><td><button class="btn secondary small" data-prac="${C.esc(c)}">Train</button></td></tr>`).join("")}</table></div>
    <div class="card"><h2>How do you think?</h2><ul class="small">
      ${R.depth ? `<li><b>Calculation depth:</b> on positions with 2+ moves, you saw on average <b>${R.depth.avg} of ${R.depth.avgNeeded}</b> of your moves <b>from the start</b>, and <b>${R.depth.avgHelp}</b> once the first moves had been played for you. ${R.depth.full}/${R.depth.n} completely right from the start. ${R.depth.avgHelp - R.depth.avg >= 0.7 ? "Big gap between 'from the start' and 'with help': you do find the moves, but you don't see them far enough ahead. Train by calculating long puzzles without moving the pieces, and write down the whole line." : R.depth.avg / R.depth.avgNeeded < 0.6 ? "You often stop calculating too early: keep going until the position is quiet (no more checks or captures)." : "You calculate lines through well."}</li>` : ""}

      ${R.time ? `<li><b>Time:</b> median ${R.time.median}s to your first move${R.time.correct ? `; right answers ${R.time.correct}s` : ""}${R.time.wrong ? `, wrong answers ${R.time.wrong}s` : ""}. ${R.time.wrong && R.time.correct && R.time.wrong < R.time.correct * 0.7 ? "Your wrong answers came faster than your right ones: you play too quickly when you think you see it. Do a blunder check!" : ""}</li>` : ""}
      ${R.ai ? `<li><b>Depth of understanding</b> (AI coach, ${R.ai.n} positions): you saw the <b>idea</b> in ${R.ai.idea}%, the <b>danger</b> in ${R.ai.danger}% and the <b>follow-up & plan</b> in ${R.ai.followup}% of positions. ${R.ai.danger < R.ai.idea - 15 ? "You often see the idea but not the danger behind it: before you play, ask what goes wrong after the most obvious follow-up." : R.ai.followup < R.ai.danger - 15 ? "You see the ideas and dangers, but the follow-up plan is the next step: what do you play AFTER the first moves?" : ""}${R.ai.rejected ? ` ${R.ai.rejected}× you rejected the right move for the right reason (half right).` : ""}</li>` : ""}
      <li><b>Character of your moves:</b> ${R.character.aggressive}% aggressive (check, capture, toward the king), ${R.character.solid}% solid. ${R.character.nWrong ? `Of your wrong answers, ${R.character.wrongAggressive}% were aggressive and ${R.character.wrongSolid}% solid.` : ""}</li></ul></div>
    <div class="card"><h2>Your answers</h2><div class="scroll"><table><tr><th>#</th><th>Category</th><th>Rating</th><th>Your line</th><th>Solution</th><th>Depth</th><th>Score</th><th>Time</th><th>Your reasoning</th></tr>
      ${t.items.map((i, k) => `<tr><td>${k + 1}</td><td class="small">${C.esc(catLabel(i.cat))}</td><td>${i.rating}</td><td class="small">${C.esc(i.line || i.move || "–")}</td><td class="small">${C.esc(i.solution)}</td><td class="small">${i.kind === "tac" ? `${i.depth}${(i.depthTotal ?? i.depth) > i.depth ? `→${i.depthTotal}` : ""}/${i.nMine}` : "–"}</td><td>${Math.round(i.score * 100)}%</td><td>${Math.round(i.timeMs / 1000)}s</td><td class="small">${C.esc(i.why || "")}</td></tr>`).join("")}</table></div>
      <div class="row" style="margin-top:8px"><button class="btn secondary" id="copyT">Copy for Claude (feedback on my reasoning)</button><button class="btn" id="toProf">See my player profile</button></div></div>`;
  v.querySelectorAll("[data-prac]").forEach((b) => (b.onclick = () => C.go("practice", { cat: b.dataset.prac })));
  v.querySelector("#toProf").onclick = () => C.go("profile");
  v.querySelector("#copyT").onclick = () => C.copy(`Chess test. Give feedback on my REASONING per position (not just the move): what did I see right, what did I miss, and what does that say about how I think?\nMy rating: ${R.elo}. Test rating ${R.overall} (tactical ${R.tactical}, positional ${R.positional}).\n\n` +
    t.items.map((i, k) => `${k + 1}. [${catLabel(i.cat)}, ≈${i.rating}] FEN ${i.fen}\n   My move: ${i.move || "-"} (${Math.round(i.timeMs / 1000)}s), solution: ${i.solution}, score ${Math.round(i.score * 100)}%\n   My reasoning: ${i.why || "-"}${i.line ? `\n   My line: ${i.line}` : ""}${i.ai ? `\n   AI coach: idea ${i.ai.idea}, danger ${i.ai.danger}, follow-up ${i.ai.followup}. ${i.ai.feedback}` : i.explain ? `\n   App check: saw ${i.explain.saw.join("; ") || "-"}; missed ${i.explain.missed.join("; ") || "-"}` : ""}`).join("\n"));
}

// ------------------------------------------------------------------ PROFILE
export function profileView(v, C) {
  const p = C.P();
  const t = (p.tests || []).filter((x) => x.done).slice(-1)[0];
  const gs = Object.values(p.games || {});
  const A = gs.length ? C.aggregate(gs) : null;
  if (!t && !A) { v.innerHTML = `<div class="card"><h2>Player profile</h2><p>Analyse your games (Analyse → Games) and/or take the test first.</p></div><div class="card" id="aiCardP"></div>`; aiSettings(v.querySelector("#aiCardP")); return; }
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
    <div class="card" id="aiCardP"></div>
    <div class="card"><div class="row"><button class="btn secondary" id="copyProf">Copy profile for Claude (opening & training plan)</button></div></div>`;
  v.querySelectorAll("[data-prac]").forEach((b) => (b.onclick = () => C.go("practice", { cat: b.dataset.prac })));
  aiSettings(v.querySelector("#aiCardP"));
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
