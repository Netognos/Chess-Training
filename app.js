import { Chess } from "./vendor/chess.js";
import { Engine, lineToCp, winPct, fmtScore } from "./engine.js";
import { Board } from "./board.js";
import { splitPgn, analyseGame, aggregate, pvToSan, parseGame } from "./analysis.js";
import { diagnose, nextStepsFrom } from "./coach.js";
import { ENDGAMES, REPERTOIRES, TAG_ADVICE } from "./data.js";

// ------------------------------------------------------------------ state
const KEY = "chesscoach.v1";
const INTERVALS = [0, 1, 3, 7, 21, 60];
let S = load();
let engine = null;
const getEngine = () => (engine ||= Engine.browser());

function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.players) return s; } catch {}
  return { version: 1, current: null, players: {} };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast("Couldn't save (browser storage full?). Make a backup in Log."); console.error(e); }
}
const P = () => S.players[S.current];
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add("hidden"), 2600); }
function logEvent(type, text) { const p = P(); if (!p) return; p.log.unshift({ date: new Date().toISOString(), type, text }); save(); }
function newPlayer(d) {
  const id = "p" + Date.now().toString(36);
  S.players[id] = { id, name: d.name, lichess: d.lichess || "", chesscom: d.chesscom || "", pgnName: d.pgnName || "", rating: d.rating || "", goal: d.goal || "", hours: +d.hours || 4,
    createdAt: today(), games: {}, reports: [], puzzles: {}, endgames: {}, customEndgames: [], log: [], nextSteps: [], repertoire: { white: "", vsE4: "", vsD4: "", notes: "" }, settings: { movetime: 150 } };
  S.current = id; save(); return id;
}
function srs(item, ok) { item.attempts = (item.attempts || 0) + 1; if (ok) { item.successes = (item.successes || 0) + 1; item.box = Math.min((item.box || 0) + 1, 5); } else item.box = 1; item.due = addDays(INTERVALS[item.box]); item.last = today(); item.lastOk = ok; }

// ------------------------------------------------------------------ routing
const views = { home, games, report, puzzles, endgames, board, log };
let tab = "home";
function go(t, arg) {
  tab = t;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
  const v = $("#view"); v.innerHTML = "";
  if (!P() && t !== "home") { tab = "home"; home(v); return renderPicker(); }
  views[t](v, arg); renderPicker(); window.scrollTo(0, 0);
}
document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => go(b.dataset.tab)));
function renderPicker() {
  const sel = $("#playerSelect");
  const ps = Object.values(S.players);
  sel.innerHTML = ps.map((p) => `<option value="${p.id}" ${p.id === S.current ? "selected" : ""}>${esc(p.name)}</option>`).join("") + `<option value="__new">+ New player</option>`;
  sel.onchange = () => { if (sel.value === "__new") { S.current = null; save(); go("home"); } else { S.current = sel.value; save(); go(tab); } };
}

// ------------------------------------------------------------------ HOME
function home(v) {
  const p = P();
  if (!p) {
    v.innerHTML = `<div class="card"><h2>${Object.keys(S.players).length ? "New player" : "Welcome to Chess Coach"}</h2>
      <p class="muted">Each player gets their own profile, analysis, training plan and log. Fill in at least a name. The usernames let the app download your games.</p>
      ${profileForm({})}<div class="row" style="margin-top:12px"><button class="btn" id="create">Create player</button></div></div>
      <div class="card"><h2>How it works</h2><ol>
      <li><b>Games</b>: import your games from Lichess / Chess.com, or a PGN file, and analyse them with Stockfish.</li>
      <li><b>Report</b>: your strengths, weaknesses and a weekly training plan.</li>
      <li><b>Puzzles</b>: your own mistakes as puzzles, repeated at spaced intervals.</li>
      <li><b>Endgames</b>: theory positions to know, played out against the engine.</li>
      <li><b>Board</b>: analyse any position, play on against the engine, or copy it to ask Claude about the plan.</li>
      <li><b>Log</b>: what you've done and the next steps, plus backup and export.</li></ol></div>`;
    $("#create").onclick = () => { const d = readProfile(v); if (!d.name) return toast("Fill in a name"); newPlayer(d); logEvent("profile", "Player created"); go("home"); };
    return;
  }
  const duePz = Object.values(p.puzzles).filter((x) => !x.due || x.due <= today()).length;
  const dueEg = allEndgames(p).filter((e) => { const s = p.endgames[e.id]; return !s || s.due <= today(); }).length;
  const last = p.reports[0];
  v.innerHTML = `<div class="card"><h2>${esc(p.name)}</h2>
    <div class="stats">
      <div class="stat"><div class="v">${Object.keys(p.games).length}</div><div class="l">games analysed</div></div>
      <div class="stat"><div class="v">${last ? last.summary.scorePct + "%" : "–"}</div><div class="l">score in analysed games</div></div>
      <div class="stat"><div class="v">${duePz}</div><div class="l">puzzles due</div></div>
      <div class="stat"><div class="v">${dueEg}</div><div class="l">endgames to review</div></div>
    </div>
    <p class="muted small">${last ? `Last analysis: ${last.date} (${last.summary.games} games)` : "No analysis yet. Start in <b>Games</b>."}</p>
    <div class="row"><button class="btn" data-go="${Object.keys(p.games).length ? "puzzles" : "games"}">${Object.keys(p.games).length ? "Start training" : "Import games"}</button>
    <button class="btn secondary" data-go="report">Report & plan</button></div></div>
    <div class="card"><h2>Next steps</h2>${nextStepsHtml(p)}</div>
    <div class="card"><h2>Profile</h2>${profileForm(p)}<div class="row" style="margin-top:12px"><button class="btn secondary" id="saveP">Save profile</button><button class="btn secondary danger" id="delP" style="color:#fff">Delete player</button></div></div>`;
  v.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
  bindNextSteps(v, p);
  $("#saveP").onclick = () => { Object.assign(p, readProfile(v)); save(); renderPicker(); toast("Saved"); };
  $("#delP").onclick = () => { if (confirm(`Delete ${p.name} and all their data?`)) { delete S.players[p.id]; S.current = Object.keys(S.players)[0] || null; save(); go("home"); } };
}
function profileForm(p) {
  const f = (id, label, val, type = "text", ph = "") => `<label class="f">${label}<input id="pf_${id}" type="${type}" value="${esc(val ?? "")}" placeholder="${ph}"></label>`;
  return `<div class="form">${f("name", "Name", p.name)}${f("lichess", "Lichess username", p.lichess)}${f("chesscom", "Chess.com username", p.chesscom)}
    ${f("pgnName", "Name in PGN files (OTB)", p.pgnName, "text", "e.g. De Wilde, Sam")}${f("rating", "Rating (approx.)", p.rating)}${f("hours", "Hours per week for chess", p.hours ?? 4, "number")}
    ${f("goal", "Goal", p.goal, "text", "e.g. 1600 rapid by the summer")}</div>`;
}
function readProfile(v) { const g = (id) => $("#pf_" + id, v).value.trim(); return { name: g("name"), lichess: g("lichess"), chesscom: g("chesscom"), pgnName: g("pgnName"), rating: g("rating"), hours: +g("hours") || 4, goal: g("goal") }; }
function nextStepsHtml(p) {
  if (!p.nextSteps.length) return `<p class="muted">Steps appear automatically after an analysis. You can also add your own.</p>${addStepHtml()}`;
  return p.nextSteps.map((s, i) => `<label class="row" style="margin:4px 0"><input type="checkbox" data-step="${i}" ${s.done ? "checked" : ""}><span style="flex:1;${s.done ? "text-decoration:line-through;opacity:.6" : ""}">${esc(s.text)}</span></label>`).join("") + addStepHtml();
}
const addStepHtml = () => `<div class="row" style="margin-top:8px"><input class="grow" id="newStep" placeholder="Add a step…"><button class="btn secondary" id="addStep">Add</button><button class="btn secondary" id="clearSteps">Clear completed</button></div>`;
function bindNextSteps(v, p) {
  v.querySelectorAll("[data-step]").forEach((c) => (c.onchange = () => { const s = p.nextSteps[+c.dataset.step]; s.done = c.checked; if (c.checked) logEvent("step", "Done: " + s.text); save(); go(tab); }));
  $("#addStep", v).onclick = () => { const t = $("#newStep", v).value.trim(); if (t) { p.nextSteps.push({ text: t, done: false }); save(); go(tab); } };
  $("#clearSteps", v).onclick = () => { p.nextSteps = p.nextSteps.filter((s) => !s.done); save(); go(tab); };
}

// ------------------------------------------------------------------ GAMES
let running = null;
function games(v) {
  const p = P();
  const list = Object.values(p.games).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  v.innerHTML = `<div class="card"><h2>Import & analyse games</h2>
    <div class="form">
      <label class="f">Source<select id="src"><option value="lichess">Lichess (${esc(p.lichess || "username?")})</option><option value="chesscom">Chess.com (${esc(p.chesscom || "username?")})</option><option value="pgn">PGN (paste or file)</option></select></label>
      <label class="f">Number of games<input id="num" type="number" value="20" min="1" max="100"></label>
      <label class="f">Time controls<select id="perf"><option value="rapid,classical">Rapid + classical</option><option value="blitz,rapid,classical">Blitz + rapid + classical</option><option value="blitz">Blitz only</option><option value="all">All</option></select></label>
      <label class="f">Depth<select id="speed"><option value="80">Fast (≈7 s/game)</option><option value="150" selected>Normal (≈12 s/game)</option><option value="400">Deep (≈30 s/game)</option></select></label>
    </div>
    <div id="pgnBox" class="hidden" style="margin-top:10px"><textarea id="pgnText" placeholder="Paste PGN here (one or more games)…"></textarea>
      <div class="row" style="margin-top:6px"><input type="file" id="pgnFile" accept=".pgn,.txt"><label class="f" style="flex-direction:row;align-items:center;gap:6px">Your name in the PGN <input id="pgnName" value="${esc(p.pgnName || p.lichess || p.chesscom || "")}"></label></div></div>
    <div class="row" style="margin-top:12px"><button class="btn" id="go">Analyse</button><button class="btn secondary hidden" id="stop">Stop</button></div>
    <div id="prog" class="hidden" style="margin-top:12px"><div class="small" id="progText"></div><div class="bar" style="margin-top:6px"><div id="progBar"></div></div></div>
    <p class="muted small">Already-analysed games are skipped. Lichess games that already have a computer analysis are processed much faster.</p></div>
    <div class="card"><h2>Analysed games (${list.length})</h2>${list.length ? `<div class="scroll"><table><tr><th>Date</th><th>Opponent</th><th>Colour</th><th>Result</th><th>Accuracy</th><th>Errors</th><th>Opening</th></tr>
    ${list.map((g) => { const opp = g.color === "w" ? g.black : g.white; const res = g.score === 1 ? "win" : g.score === 0 ? "loss" : "draw";
      const e = (l) => g.errors.filter((x) => x.label === l).length;
      return `<tr><td>${esc(g.date)}</td><td>${g.site && g.site.startsWith("http") ? `<a href="${esc(g.site)}" target="_blank" rel="noopener">${esc(opp)}</a>` : esc(opp)} <span class="muted small">${esc(g.opponentElo || "")}</span></td><td>${g.color === "w" ? "White" : "Black"}</td><td>${res}</td><td>${g.accuracy ?? "–"}</td><td><span class="pill blunder">${e("blunder")}</span><span class="pill mistake">${e("mistake")}</span></td><td class="small">${esc(g.opening)}</td></tr>`; }).join("")}</table></div>
    <div class="row" style="margin-top:10px"><button class="btn secondary" id="clearG">Delete all games</button></div>` : `<p class="muted">No games yet.</p>`}</div>`;
  const src = $("#src");
  src.onchange = () => $("#pgnBox").classList.toggle("hidden", src.value !== "pgn");
  if (!p.lichess && p.chesscom) src.value = "chesscom";
  if (!p.lichess && !p.chesscom) src.value = "pgn";
  src.onchange();
  $("#pgnFile").onchange = async (e) => { const f = e.target.files[0]; if (f) $("#pgnText").value = await f.text(); };
  $("#go").onclick = () => runImport(v);
  $("#stop").onclick = () => { if (running) running.stop = true; };
  if ($("#clearG")) $("#clearG").onclick = () => { if (confirm("Delete all analysed games for this player? (Puzzles and log are kept.)")) { p.games = {}; save(); go("games"); } };
}

async function fetchGames(p, src, num, perf) {
  if (src === "lichess") {
    if (!p.lichess) throw new Error("Fill in a Lichess username on Home.");
    const q = new URLSearchParams({ max: num, clocks: "true", evals: "true", opening: "true" });
    if (perf !== "all") q.set("perfType", perf);
    const r = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(p.lichess)}?${q}`, { headers: { Accept: "application/x-chess-pgn" } });
    if (!r.ok) throw new Error(`Lichess answered ${r.status}. Is the username correct?`);
    return { pgns: splitPgn(await r.text()), name: p.lichess };
  }
  if (src === "chesscom") {
    if (!p.chesscom) throw new Error("Fill in a Chess.com username on Home.");
    const u = p.chesscom.toLowerCase();
    const r = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(u)}/games/archives`);
    if (!r.ok) throw new Error(`Chess.com answered ${r.status}. Is the username correct?`);
    const arch = (await r.json()).archives || [];
    const allowed = perf === "all" ? null : perf.split(",").map((x) => (x === "classical" ? "daily" : x)).concat(perf.includes("classical") ? ["classical"] : []);
    const out = [];
    for (let i = arch.length - 1; i >= 0 && out.length < num; i--) {
      const m = await (await fetch(arch[i])).json();
      for (const g of (m.games || []).reverse()) {
        if (g.rules !== "chess" || !g.pgn) continue;
        if (allowed && !allowed.includes(g.time_class)) continue;
        out.push(g.pgn); if (out.length >= num) break;
      }
    }
    return { pgns: out, name: p.chesscom };
  }
  const text = $("#pgnText").value;
  const pgns = splitPgn(text);
  let name = $("#pgnName").value.trim();
  if (!name && pgns.length) { const c = {}; for (const x of pgns) for (const t of ["White", "Black"]) { const m = new RegExp(`\\[${t} "([^"]+)"`).exec(x); if (m) c[m[1]] = (c[m[1]] || 0) + 1; } name = Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || ""; }
  if (name) { p.pgnName = name; save(); }
  return { pgns: pgns.slice(0, num), name };
}

async function runImport(v) {
  const p = P();
  const src = $("#src").value, num = +$("#num").value || 20, perf = $("#perf").value, movetime = +$("#speed").value;
  const prog = $("#prog"), txt = $("#progText"), bar = $("#progBar");
  prog.classList.remove("hidden"); $("#go").disabled = true; $("#stop").classList.remove("hidden");
  running = { stop: false };
  try {
    txt.textContent = "Fetching games…";
    const { pgns, name } = await fetchGames(p, src, num, perf);
    if (!pgns.length) throw new Error("No games found.");
    txt.textContent = "Starting Stockfish…";
    const eng = getEngine(); await eng.ready;
    let done = 0, added = 0, skipped = 0;
    for (const pgn of pgns) {
      if (running.stop) break;
      const site = (/\[Site "([^"]+)"/.exec(pgn) || [])[1];
      const link = (/\[Link "([^"]+)"/.exec(pgn) || [])[1];
      const gid = link || (site && site.startsWith("http") ? site : null);
      if (gid && p.games[gid]) { done++; skipped++; continue; }
      let r;
      try {
        r = await analyseGame(eng, pgn, name, { movetime }, (k, n) => {
          txt.textContent = `Game ${done + 1} of ${pgns.length}: position ${k}/${n}`;
          bar.style.width = (100 * (done + k / n) / pgns.length).toFixed(1) + "%";
        });
      } catch (e) { console.warn("Game failed", e); r = { skipped: "parse error" }; }
      done++;
      if (r.skipped) { skipped++; continue; }
      if (link) { r.site = link; r.id = link; }
      p.games[r.id] = r; added++; save();
      bar.style.width = (100 * done / pgns.length).toFixed(1) + "%";
    }
    txt.textContent = `Done: ${added} new games analysed${skipped ? `, ${skipped} skipped (already done, too short, or the name doesn't match)` : ""}.`;
    if (added) { buildReport(p); logEvent("analysis", `${added} games analysed (${src}). Total ${Object.keys(p.games).length}.`); toast("Analysis done. See Report."); setTimeout(() => go("report"), 900); }
    else if (skipped && !added) txt.textContent += ` Check that "${name}" is the exact name in the games.`;
  } catch (e) {
    console.error(e);
    txt.innerHTML = `<span style="color:var(--bad)">${esc(e.message || e)}</span>${src !== "pgn" ? " · If downloading doesn't work, export the PGN from the website and paste it under 'PGN'." : ""}`;
  } finally { $("#go").disabled = false; $("#stop").classList.add("hidden"); running = null; }
}

function buildReport(p) {
  const A = aggregate(Object.values(p.games));
  const D = diagnose(A, p);
  // seed puzzles from critical positions
  for (const e of A.critical) {
    const key = `${e.game}#${e.ply}`;
    if (!p.puzzles[key]) p.puzzles[key] = { key, fen: e.fen, played: e.played, best: e.best, bestLine: e.bestLine, game: e.game, moveNo: e.moveNo, color: e.color, phase: e.phase, tags: e.tags, evalBefore: e.evalBefore, drop: e.drop, box: 0, due: today() };
  }
  const summary = { games: A.games, scorePct: A.scorePct, phaseAcc: A.phaseAcc, per100: A.seriousPer100, topTags: Object.keys(A.tags).slice(0, 3) };
  p.reports.unshift({ date: today(), summary });
  p.reports = p.reports.slice(0, 30);
  p.nextSteps = nextStepsFrom(D).map((t) => ({ text: t, done: false, auto: true })).concat(p.nextSteps.filter((s) => !s.done && !s.auto)).slice(0, 8);
  save();
}

// ------------------------------------------------------------------ REPORT
function report(v) {
  const p = P();
  const gs = Object.values(p.games);
  if (!gs.length) { v.innerHTML = `<div class="card"><h2>Report</h2><p>No analysed games yet.</p><button class="btn" id="g">Import games</button></div>`; $("#g").onclick = () => go("games"); return; }
  const A = aggregate(gs), D = diagnose(A, p);
  const ph = ["opening", "middlegame", "endgame"].filter((x) => A.phaseAcc[x] != null);
  const hist = p.reports.slice(0, 6);
  v.innerHTML = `
  <div class="card"><h2>Overview: ${A.games} games</h2><div class="stats">
    <div class="stat"><div class="v">${A.scorePct}%</div><div class="l">score</div></div>
    ${ph.map((x) => `<div class="stat"><div class="v">${A.phaseAcc[x]}</div><div class="l">${x} accuracy · ${A.seriousPer100[x]} errors/100 moves</div></div>`).join("")}
    <div class="stat"><div class="v">${A.conversion.chances ? Math.round(100 * A.conversion.won / A.conversion.chances) + "%" : "–"}</div><div class="l">won positions converted (${A.conversion.won}/${A.conversion.chances})</div></div>
    <div class="stat"><div class="v">${A.resilience.lost ? A.resilience.saved + "/" + A.resilience.lost : "–"}</div><div class="l">lost positions saved</div></div>
  </div><p class="muted small">Errors/100 = mistakes + blunders per 100 of your moves in that phase. Blunder = win chance drops ≥ 15%, mistake ≥ 10% (Lichess thresholds).</p></div>
  <div class="card"><h2>Strengths</h2>${D.strengths.map((s) => `<div class="list-item strong"><b>${esc(s.title)}</b><span class="small">${esc(s.evidence)}</span></div>`).join("")}</div>
  <div class="card"><h2>Points to work on</h2>${D.weaknesses.length ? D.weaknesses.map((w) => `<div class="list-item weak"><b>${esc(w.title)}</b><span class="small">${esc(w.evidence)}</span>
     ${w.drills ? `<ul class="small">${w.drills.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}${w.links && w.links.length ? `<div class="small">${w.links.map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${esc(t)}</a>`).join(" · ")}</div>` : ""}</div>`).join("") : `<p class="muted">No clear weak points. Analyse more games.</p>`}</div>
  <div class="card"><h2>Training plan: ${p.hours} h per week</h2>
    <p class="small muted">Based on GM Kuljasevic's study split (tactics 25 · endgames 25 · middlegame 20 · general 20 · openings 10), shifted toward your weak points. Change your hours per week on Home.</p>
    ${D.plan.weekly.map((w) => `<div class="list-item ${w.weak ? "weak" : ""}"><b>${esc(w.what)} · ${w.mins} min/week${D.plan.split[w.what] !== undefined ? ` (${D.plan.split[w.what]}%)` : ""}${w.weak ? ' <span class="pill mistake">focus</span>' : ""}</b><span class="small">${esc(w.how)}</span></div>`).join("")}</div>
  <div class="card"><h2>What kind of errors?</h2><p class="small muted">Mistakes and blunders by type (one error can have several tags).</p>
    <table>${Object.entries(A.tags).map(([t, n]) => `<tr><td>${esc(t)}</td><td>${n}</td><td class="small muted">${esc(TAG_ADVICE[t]?.why || "")}</td></tr>`).join("") || "<tr><td>None</td></tr>"}</table></div>
  <div class="card"><h2>Openings</h2><div class="scroll"><table><tr><th>Colour</th><th>Opening</th><th>Games</th><th>Score</th><th>Win chance after move 10</th><th>Opening accuracy</th></tr>
    ${A.openings.slice(0, 15).map((o) => `<tr><td>${o.color === "w" ? "White" : "Black"}</td><td>${esc(o.name)}</td><td>${o.games}</td><td>${o.scorePct}%</td><td>${o.wpAfter10 ?? "–"}${o.wpAfter10 !== null ? "%" : ""}</td><td>${o.acc ?? "–"}</td></tr>`).join("")}</table></div>
    <p class="small muted">Win chance after move 10 is below 45%? Then the opening isn't working for you. A low score while the win chance is fine means the problem comes later in the game.</p></div>
  <div class="card"><h2>Repertoire</h2>${repertoireHtml(p, A)}</div>
  <div class="card"><h2>Endgames reached</h2><table><tr><th>Type</th><th>Games</th><th>Score</th><th>Accuracy</th></tr>
    ${Object.entries(A.endgames).map(([t, e]) => `<tr><td>${esc(t)}</td><td>${e.games}</td><td>${e.scorePct}%</td><td>${e.acc}</td></tr>`).join("") || "<tr><td colspan=4 class='muted'>No endgames reached yet</td></tr>"}</table></div>
  ${hist.length > 1 ? `<div class="card"><h2>Progress</h2><div class="scroll"><table><tr><th>Date</th><th>Games</th><th>Score</th><th>Opening</th><th>Middlegame</th><th>Endgame</th><th>Top error</th></tr>
    ${hist.map((h) => `<tr><td>${h.date}</td><td>${h.summary.games}</td><td>${h.summary.scorePct}%</td>${["opening", "middlegame", "endgame"].map((x) => `<td>${h.summary.phaseAcc[x] ?? "–"} / ${h.summary.per100[x] ?? "–"}</td>`).join("")}<td class="small">${esc(h.summary.topTags[0] || "")}</td></tr>`).join("")}</table></div><p class="small muted">Per phase: accuracy / errors per 100 moves.</p></div>` : ""}
  <div class="card"><h2>Talk it through with Claude</h2><p class="small">Copy this summary and paste it into a chat with Claude for in-depth advice on plans, openings or a training schedule.</p><button class="btn secondary" id="copyRep">Copy summary for Claude</button></div>`;
  bindRepertoire(v, p);
  $("#copyRep").onclick = () => copy(claudeSummary(p, A, D));
}
function repertoireHtml(p, A) {
  const r = p.repertoire;
  const sug = suggestStyle(A);
  return `<div class="form">
    <label class="f">As White<input id="rp_white" value="${esc(r.white)}" placeholder="e.g. 1.e4, Italian"></label>
    <label class="f">Against 1.e4<input id="rp_vsE4" value="${esc(r.vsE4)}" placeholder="e.g. Caro-Kann"></label>
    <label class="f">Against 1.d4 / other<input id="rp_vsD4" value="${esc(r.vsD4)}" placeholder="e.g. QGD"></label></div>
    <label class="f" style="margin-top:8px">Notes / key lines<textarea id="rp_notes" placeholder="Main ideas, plans, lines to remember…">${esc(r.notes)}</textarea></label>
    <div class="row" style="margin-top:8px"><button class="btn secondary" id="rpSave">Save repertoire</button></div>
    <h3>Starter repertoires</h3><p class="small muted">${esc(sug.reason)}</p>
    ${REPERTOIRES.map((x, i) => `<div class="list-item ${x.style === sug.style ? "strong" : ""}"><b>${esc(x.style)}${x.style === sug.style ? " · fits your profile" : ""}</b>
      <span class="small">White: ${esc(x.white)} · vs 1.e4: ${esc(x.vsE4)} · vs 1.d4: ${esc(x.vsD4)}</span><div class="small muted">${esc(x.why)}</div>
      <button class="btn secondary small" data-rep="${i}" style="margin-top:6px">Use this</button></div>`).join("")}`;
}
function suggestStyle(A) {
  const t = A.tags || {}, tot = Object.values(t).reduce((a, b) => a + b, 0) || 1;
  const tactical = ((t["hung material / allowed tactic"] || 0) + (t["missed tactic / forcing move"] || 0) + (t["allowed mate"] || 0)) / tot;
  if (tactical >= 0.5) return { style: "Solid / positional", reason: "Many of your errors are tactical (missed or allowed tactics). A solid repertoire with recognisable structures gives you calmer positions while you train tactics." };
  if ((A.phaseAcc.middlegame || 0) >= 85 && (t["positional / planning"] || 0) / tot < 0.3) return { style: "Sharp / tactical", reason: "Your middlegame is accurate and you make few positional errors, so you can handle sharp, unbalanced positions." };
  return { style: "Classical / all-round", reason: "A classical repertoire teaches the most important principles and suits an all-round profile." };
}
function bindRepertoire(v, p) {
  $("#rpSave", v).onclick = () => { p.repertoire = { white: $("#rp_white").value, vsE4: $("#rp_vsE4").value, vsD4: $("#rp_vsD4").value, notes: $("#rp_notes").value }; save(); logEvent("repertoire", "Repertoire updated"); toast("Saved"); };
  v.querySelectorAll("[data-rep]").forEach((b) => (b.onclick = () => { const x = REPERTOIRES[+b.dataset.rep]; $("#rp_white").value = x.white; $("#rp_vsE4").value = x.vsE4; $("#rp_vsD4").value = x.vsD4; toast("Filled in. Click 'Save repertoire'."); }));
}
function claudeSummary(p, A, D) {
  return `I'm training my chess with my Chess Coach app. Here is my profile. Help me with a concrete plan and explanations.\n\nPlayer: ${p.name}${p.rating ? `, rating ~${p.rating}` : ""}${p.goal ? `, goal: ${p.goal}` : ""}, ${p.hours} h/week.\n` +
    `Analysed games: ${A.games}, score ${A.scorePct}%.\nAccuracy per phase: ${Object.entries(A.phaseAcc).map(([k, x]) => `${k} ${x} (${A.seriousPer100[k]} errors/100 moves)`).join(", ")}.\n` +
    `Error types: ${Object.entries(A.tags).map(([k, n]) => `${k}: ${n}`).join("; ")}.\nWinning positions converted: ${A.conversion.won}/${A.conversion.chances}; lost positions saved: ${A.resilience.saved}/${A.resilience.lost}.\n` +
    `Openings: ${A.openings.slice(0, 6).map((o) => `${o.color === "w" ? "W" : "B"} ${o.name} (${o.games}x, ${o.scorePct}%, win chance after move 10 ${o.wpAfter10}%)`).join("; ")}.\n` +
    `Repertoire: White ${p.repertoire.white || "?"}, vs e4 ${p.repertoire.vsE4 || "?"}, vs d4 ${p.repertoire.vsD4 || "?"}.\n` +
    `Strengths: ${D.strengths.map((s) => s.title).join("; ")}.\nWeak points: ${D.weaknesses.map((w) => w.title).join("; ")}.\n` +
    `Biggest mistakes (FEN · played · best):\n${A.critical.slice(0, 5).map((e) => `- ${e.fen} · ${e.played} · ${e.best} (${e.bestLine})`).join("\n")}`;
}
async function copy(text) { try { await navigator.clipboard.writeText(text); toast("Copied"); } catch { prompt("Copy this text:", text); } }

// ------------------------------------------------------------------ PUZZLES
function puzzles(v) {
  const p = P();
  const all = Object.values(p.puzzles);
  const due = all.filter((x) => !x.due || x.due <= today()).sort((a, b) => (a.box || 0) - (b.box || 0) || b.drop - a.drop);
  if (!all.length) { v.innerHTML = `<div class="card"><h2>Puzzles from your own games</h2><p>Analyse games first: your biggest mistakes become puzzles here.</p><button class="btn" id="g">Import games</button></div>`; $("#g").onclick = () => go("games"); return; }
  const known = all.filter((x) => (x.box || 0) >= 4).length;
  v.innerHTML = `<div class="two"><div><div id="pb"></div><div class="row" style="margin-top:8px"><button class="btn secondary" id="hint">Hint</button><button class="btn secondary" id="show">Show solution</button><button class="btn secondary" id="explore">Open on Board</button><button class="btn" id="next">Next</button></div></div>
    <div><div class="card"><h2>Your mistakes as puzzles</h2><div class="small muted">${due.length} due · ${all.length} total · ${known} known</div><div id="pinfo" style="margin-top:10px"></div><div id="pfb"></div></div>
    <div class="card"><h2>How it works</h2><p class="small">Every position comes from your own game, at the moment you went wrong. Find the best move. Get it right and you'll see it again after 1, 3, 7, 21 and 60 days. Get it wrong and it comes back tomorrow. Ask yourself first: <b>what does my opponent threaten, and what checks, captures and threats do I have?</b></p></div></div></div>`;
  const brd = new Board($("#pb"), { orientation: "w" });
  let cur = null, idx = 0, solved = false, tries = 0;
  const show = () => {
    cur = due[idx]; solved = false; tries = 0; $("#pfb").innerHTML = "";
    if (!cur) { $("#pinfo").innerHTML = `<div class="feedback ok">No more puzzles due today. Well done! Come back tomorrow, or practise endgames.</div>`; brd.locked = true; return; }
    brd.locked = false; brd.setFen(cur.fen); brd.setOrientation(cur.fen.split(" ")[1]);
    const side = cur.fen.split(" ")[1] === "w" ? "White" : "Black";
    $("#pinfo").innerHTML = `<b>Move ${cur.moveNo}, you're ${side}</b> (${esc(cur.phase)}). Eval before your move: ${cur.evalBefore > 0 ? "+" : ""}${cur.evalBefore}.<br><span class="small muted">In the game you played <b>${esc(cur.played)}</b>${cur.game && cur.game.startsWith("http") ? ` · <a href="${esc(cur.game)}" target="_blank" rel="noopener">game</a>` : ""}. Find a better move.</span>`;
  };
  brd.onMove = async (mv, before) => {
    if (!cur || solved) return;
    brd.locked = true; tries++;
    $("#pfb").innerHTML = `<div class="feedback info">Checking…</div>`;
    const g = await gradeMove(before, mv.lan || mv.from + mv.to + (mv.promotion || ""));
    const ok = g.drop < 5 || mv.san === cur.best;
    if (ok) {
      solved = true; if (tries === 1) srs(cur, true); else srs(cur, false);
      $("#pfb").innerHTML = `<div class="feedback ok"><b>${esc(mv.san)}: correct!</b> ${tries > 1 ? "(on attempt " + tries + ")" : ""}<br><span class="small">Engine line: ${esc(g.bestLine)}</span></div>${tagHelp(cur)}`;
      logEvent("puzzle", `Puzzle (move ${cur.moveNo}) ${tries === 1 ? "solved" : "solved on attempt " + tries}`);
    } else {
      $("#pfb").innerHTML = `<div class="feedback no"><b>${esc(mv.san)}</b> isn't it (you lose ${g.drop.toFixed(0)}% win chance: ${esc(g.verdict)}). ${tries < 2 ? "Try again." : "Look at the solution."}</div>`;
      setTimeout(() => { brd.setFen(before); brd.locked = false; }, 900);
      if (tries >= 2) { srs(cur, false); solved = true; logEvent("puzzle", `Puzzle (move ${cur.moveNo}) not solved`); }
    }
    save(); brd.locked = solved;
  };
  $("#hint").onclick = () => { if (!cur) return; const m = new Chess(cur.fen).move(cur.best); $("#pfb").innerHTML = `<div class="feedback info">Hint: look at your ${pieceName(m.piece)}${m.captured ? " (it can capture something)" : ""}${m.san.includes("+") ? ", with check" : ""}.</div>`; };
  $("#show").onclick = () => { if (!cur) return; const m = new Chess(cur.fen).move(cur.best); brd.setFen(cur.fen); brd.setArrows([{ from: m.from, to: m.to }]); if (!solved) { srs(cur, false); save(); solved = true; } $("#pfb").innerHTML = `<div class="feedback info">Solution: <b>${esc(cur.best)}</b>, line ${esc(cur.bestLine)}</div>${tagHelp(cur)}`; brd.locked = true; };
  $("#explore").onclick = () => cur && go("board", { fen: cur.fen });
  $("#next").onclick = () => { idx++; show(); };
  show();
}
function tagHelp(pz) { const t = (pz.tags || []).filter((x) => TAG_ADVICE[x]); return t.length ? `<div class="small" style="margin-top:6px">Type of mistake: ${t.map((x) => `<span class="pill">${esc(x)}</span>`).join("")}<br><span class="muted">${esc(TAG_ADVICE[t[0]].why)}</span></div>` : ""; }
const pieceName = (p) => ({ p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" }[p]);

async function gradeMove(fen, uci, movetime = 900) {
  const eng = getEngine();
  const [best] = await eng.analyse(fen, { movetime });
  const c = new Chess(fen); c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  let after;
  if (c.isCheckmate()) after = 10000; else if (c.isDraw()) after = 0; else { const [l] = await eng.analyse(c.fen(), { movetime }); after = -lineToCp(l); }
  const bcp = lineToCp(best);
  const drop = Math.max(0, winPct(bcp) - winPct(after));
  const verdict = drop < 2 ? "best" : drop < 5 ? "good" : drop < 10 ? "inaccuracy" : drop < 15 ? "mistake" : "blunder";
  return { drop, verdict, bestCp: bcp, afterCp: after, bestUci: best?.pv[0], bestLine: pvToSan(fen, best?.pv || [], 8) };
}

// ------------------------------------------------------------------ ENDGAMES
const allEndgames = (p) => ENDGAMES.concat(p.customEndgames || []);
function endgames(v, arg) {
  const p = P();
  const list = allEndgames(p);
  v.innerHTML = `<div class="two"><div><div id="eb"></div><div class="row" style="margin-top:8px"><button class="btn secondary" id="reset">Restart</button><button class="btn secondary" id="idea">Show idea</button><button class="btn secondary" id="toBoard">Open on Board</button></div></div>
    <div><div class="card" id="epanel"></div><div class="card"><h2>Positions to know</h2><div class="scroll"><table><tr><th>Position</th><th>Level</th><th>Status</th></tr>
    ${list.map((e) => { const s = p.endgames[e.id]; const st = !s ? "new" : (s.box || 0) >= 4 ? "known" : "learning"; const due = !s || s.due <= today();
      return `<tr><td><a href="#" data-eg="${e.id}">${esc(e.theme)}</a></td><td class="small">${esc(e.level)}</td><td><span class="pill ${st === "known" ? "good" : st === "learning" ? "inaccuracy" : ""}">${st}</span>${due && s ? ' <span class="pill mistake">review</span>' : ""}</td></tr>`; }).join("")}</table></div>
    <p class="small muted">Add your own positions from the Board tab ("Add as endgame drill").</p></div></div></div>`;
  const brd = new Board($("#eb"));
  let cur = null, moves = 0, over = false;
  const panel = $("#epanel");
  const start = async (e) => {
    cur = e; moves = 0; over = false;
    brd.setFen(e.fen); brd.setOrientation(e.side); brd.locked = true;
    const goalTxt = e.goal === "win" ? `Win with ${e.side === "w" ? "White" : "Black"}${e.limit ? ` within ${e.limit} moves` : ""}` : `Hold the draw with ${e.side === "w" ? "White" : "Black"}`;
    panel.innerHTML = `<h2>${esc(e.theme)}</h2><div class="small muted">${esc(e.level)}</div><p><b>Task:</b> ${goalTxt}. The engine defends as well as it can.</p>
      ${e.question ? `<div id="q"><p><b>First, a question:</b> ${esc(e.question.prompt)}</p><div class="row">${e.question.options.map((o) => `<button class="btn secondary" data-a="${esc(o)}">${esc(o)}</button>`).join("")}</div></div>` : ""}
      <div id="efb"></div><div id="ideaBox" class="hidden feedback info small">${esc(e.idea)}</div>`;
    panel.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => {
      const ok = b.dataset.a === e.question.answer;
      $("#q").innerHTML = `<div class="feedback ${ok ? "ok" : "no"}">${ok ? "Correct" : "Not quite"}: ${esc(e.question.answer)}. ${esc(e.idea)}</div>`;
      begin();
    }));
    if (!e.question) begin();
  };
  const begin = async () => {
    $("#efb").innerHTML = `<div class="feedback info">Your move.</div>`;
    if (brd.chess.turn() !== cur.side) { brd.locked = true; await engineReply(); }
    brd.locked = over;
  };
  const engineReply = async () => {
    const [l] = await getEngine().analyse(brd.fen(), { movetime: 600 });
    if (l && l.pv[0]) brd.play(l.pv[0]);
    checkEnd();
  };
  const finish = (ok, msg) => {
    over = true; brd.locked = true;
    const s = (p.endgames[cur.id] ||= {}); srs(s, ok); save();
    logEvent("endgame", `${cur.theme}: ${ok ? "succeeded" : "failed"} (${moves} moves)`);
    $("#efb").innerHTML = `<div class="feedback ${ok ? "ok" : "no"}"><b>${ok ? "Well done!" : "Not this time."}</b> ${esc(msg)}${ok ? "" : "<br>" + esc(cur.idea)}</div>`;
  };
  const checkEnd = () => {
    const c = brd.chess;
    if (c.isCheckmate()) { const youWon = c.turn() !== cur.side; finish(youWon && cur.goal === "win", youWon ? "Checkmate!" : "You were mated."); return true; }
    if (c.isDraw()) { finish(cur.goal === "draw", cur.goal === "draw" ? "Draw: held." : "It's a draw, but the position was winning."); return true; }
    return false;
  };
  brd.onMove = async (mv, before) => {
    if (!cur || over) return;
    brd.locked = true; moves++;
    if (checkEnd()) return;
    const ownWinCheck = cur.grade === "engine";
    let g = null;
    if (ownWinCheck) {
      $("#efb").innerHTML = `<div class="feedback info">…</div>`;
      g = await gradeMove(before, mv.lan || mv.from + mv.to + (mv.promotion || ""), 500);
      const yourCp = g.afterCp;
      if (cur.goal === "win" && g.bestCp > 300 && yourCp < 150) { finish(false, `${mv.san} lets the win slip (${g.verdict}). Best was ${g.bestLine.split(" ")[0]}.`); brd.setArrows([{ from: g.bestUci.slice(0, 2), to: g.bestUci.slice(2, 4) }]); return; }
      if (cur.goal === "draw" && yourCp < -300 && g.bestCp > -150) { finish(false, `${mv.san} loses (${g.verdict}). Best was ${g.bestLine.split(" ")[0]}.`); return; }
      if (cur.goal === "win" && mv.promotion && yourCp > 500) { finish(true, `Promoted, and the position is winning (${(yourCp / 100).toFixed(1)}).`); return; }
      if (cur.goal === "draw" && moves >= 20) { finish(true, "20 moves held. The draw is safe."); return; }
    }
    if (cur.limit && moves >= cur.limit) { finish(false, `${cur.limit} moves without mate.`); return; }
    await engineReply();
    if (!over) { brd.locked = false; $("#efb").innerHTML = `<div class="feedback info">Move ${moves}${g ? ` · ${g.verdict === "best" || g.verdict === "good" ? "✓ good move" : g.verdict}` : ""}. Your move.</div>`; }
  };
  $("#reset").onclick = () => cur && start(cur);
  $("#idea").onclick = () => $("#ideaBox")?.classList.remove("hidden");
  $("#toBoard").onclick = () => go("board", { fen: brd.fen() });
  v.querySelectorAll("[data-eg]").forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); start(list.find((x) => x.id === a.dataset.eg)); window.scrollTo(0, 0); }));
  const first = (arg && list.find((x) => x.id === arg.id)) || list.find((e) => { const s = p.endgames[e.id]; return !s || s.due <= today(); }) || list[0];
  start(first);
}

// ------------------------------------------------------------------ BOARD (analysis)
function board(v, arg) {
  const p = P();
  v.innerHTML = `<div class="two"><div><div id="ab"></div>
    <div class="row" style="margin-top:8px"><button class="btn secondary" id="undo">↶ Undo</button><button class="btn secondary" id="flip">⇅ Flip</button><button class="btn secondary" id="startpos">Start position</button><button class="btn secondary" id="clear">Empty FEN</button></div></div>
    <div><div class="card"><h2>Analysis</h2>
      <label class="f">FEN<input id="fen" class="grow"></label><div class="row" style="margin-top:6px"><button class="btn secondary" id="load">Load FEN</button><button class="btn secondary" id="pgnLoad">Load PGN…</button></div>
      <div class="row" style="margin-top:10px"><label class="row small"><input type="checkbox" id="auto" checked> Engine analysis</label><label class="row small"><input type="checkbox" id="vs"> Engine plays the other side</label></div>
      <div class="lines" id="lines" style="margin-top:8px"></div><div class="small muted" id="moves" style="margin-top:8px"></div></div>
      <div class="card"><h2>Next</h2><div class="row"><button class="btn secondary" id="claude">Copy for Claude (plan question)</button><button class="btn secondary" id="addEg">Add as endgame drill</button></div>
      <p class="small muted">"Copy for Claude" copies the position, your moves and the engine lines as a question, ready to paste into a chat with Claude: "what is the plan here and why?"</p></div></div></div>`;
  const brd = new Board($("#ab"));
  const hist = [];
  let lastLines = [];
  const startFen = arg?.fen || new Chess().fen();
  brd.setFen(startFen); brd.setOrientation(startFen.split(" ")[1]);
  let token = 0;
  const refresh = async () => {
    $("#fen").value = brd.fen();
    $("#moves").textContent = hist.length ? "Moves: " + hist.map((h) => h.san).join(" ") : "";
    const c = brd.chess;
    if (c.isGameOver()) { $("#lines").innerHTML = `<div>${c.isCheckmate() ? "Checkmate" : "Draw"}</div>`; return; }
    if (!$("#auto").checked) { $("#lines").innerHTML = ""; return; }
    const my = ++token; $("#lines").innerHTML = `<div class="muted">Thinking…</div>`;
    const fen = brd.fen();
    const res = await getEngine().analyse(fen, { movetime: 1200, multipv: 3 });
    if (my !== token) return;
    lastLines = res;
    const black = fen.split(" ")[1] === "b";
    $("#lines").innerHTML = res.map((l) => `<div><b>${fmtScore(l, black)}</b> ${esc(pvToSan(fen, l.pv, 10))}</div>`).join("") + `<div class="muted small">Eval from White's point of view · depth ${res[0]?.depth || "?"}</div>`;
    if (res[0]?.pv[0]) brd.setArrows([{ from: res[0].pv[0].slice(0, 2), to: res[0].pv[0].slice(2, 4) }]);
  };
  brd.onMove = async (mv, before) => {
    hist.push({ san: mv.san, before });
    if ($("#vs").checked && !brd.chess.isGameOver()) {
      brd.locked = true;
      const [l] = await getEngine().analyse(brd.fen(), { movetime: 700 });
      if (l?.pv[0]) { const b = brd.fen(); const r = brd.play(l.pv[0]); if (r) hist.push({ san: r.san, before: b }); }
      brd.locked = false;
    }
    refresh();
  };
  $("#undo").onclick = () => { const h = hist.pop(); if (h) { brd.setFen(h.before); refresh(); } };
  $("#flip").onclick = () => brd.flip();
  $("#startpos").onclick = () => { hist.length = 0; brd.setFen(new Chess().fen()); refresh(); };
  $("#clear").onclick = () => { $("#fen").value = ""; $("#fen").focus(); };
  $("#load").onclick = () => { try { const f = $("#fen").value.trim(); new Chess(f); hist.length = 0; brd.setFen(f); refresh(); } catch (e) { toast("Invalid FEN"); } };
  $("#pgnLoad").onclick = () => { const t = prompt("Paste a PGN (one game):"); if (!t) return; try { const g = parseGame(t); hist.length = 0; brd.setFen(g.fens[g.fens.length - 1]); g.moves.forEach((m, i) => hist.push({ san: m.san, before: g.fens[i] })); refresh(); } catch { toast("Couldn't read the PGN"); } };
  $("#auto").onchange = refresh;
  $("#claude").onclick = () => {
    const fen = brd.fen(), black = fen.split(" ")[1] === "b";
    copy(`Chess question: what is the right plan in this position, and WHY? Explain the pawn structure, the worst piece of each side, and the 2-3 candidate plans.\n\nFEN: ${fen}\n${hist.length ? "Moves played to get here: " + hist.map((h) => h.san).join(" ") + "\n" : ""}Stockfish (eval from White's view):\n${lastLines.map((l) => `${fmtScore(l, black)} ${pvToSan(fen, l.pv, 8)}`).join("\n")}\n\nMy idea was: …`);
  };
  $("#addEg").onclick = () => {
    const fen = brd.fen(); const theme = prompt("Name for this position (e.g. 'Rook endgame from my game vs X'):"); if (!theme) return;
    const goal = confirm("Goal: OK = WIN with the side to move, Cancel = HOLD THE DRAW with the side to move") ? "win" : "draw";
    p.customEndgames.push({ id: "c" + Date.now().toString(36), level: "Own position", theme, fen, side: fen.split(" ")[1], goal, grade: "engine", idea: "Your own position: work out the plan first, then check it with the engine on the Board." });
    save(); logEvent("endgame", "Position added: " + theme); toast("Added under Endgames");
  };
  refresh();
}

// ------------------------------------------------------------------ LOG
function log(v) {
  const p = P();
  v.innerHTML = `<div class="card"><h2>Next steps</h2>${nextStepsHtml(p)}</div>
  <div class="card"><h2>Add a note</h2><textarea id="note" placeholder="e.g. 'Session with Claude about the Caro-Kann: main plan …', or tournament results"></textarea><div class="row" style="margin-top:6px"><button class="btn secondary" id="addNote">Save note</button></div></div>
  <div class="card"><h2>Log</h2>${p.log.length ? `<table>${p.log.slice(0, 200).map((l) => `<tr><td class="small muted" style="white-space:nowrap">${l.date.slice(0, 10)}</td><td><span class="pill">${esc(l.type)}</span></td><td>${esc(l.text)}</td></tr>`).join("")}</table>` : `<p class="muted">Nothing logged yet.</p>`}</div>
  <div class="card"><h2>Export & backup</h2><p class="small">Your data is stored only in this browser. Back it up regularly, or use the backup to move to another device.</p>
    <div class="row"><button class="btn secondary" id="md">Export training log (Markdown)</button><button class="btn secondary" id="bk">Backup all players (JSON)</button><label class="btn secondary" style="cursor:pointer">Restore backup<input type="file" id="rs" accept=".json" class="hidden"></label></div></div>`;
  bindNextSteps(v, p);
  $("#addNote").onclick = () => { const t = $("#note").value.trim(); if (t) { logEvent("note", t); go("log"); } };
  $("#md").onclick = () => download(`chess-coach-${slug(p.name)}.md`, markdownLog(p), "text/markdown");
  $("#bk").onclick = () => download(`chess-coach-backup-${today()}.json`, JSON.stringify(S), "application/json");
  $("#rs").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const d = JSON.parse(await f.text()); if (!d.players) throw 0; if (!confirm("Replace everything in this browser with the backup?")) return; S = d; save(); go("home"); toast("Backup restored"); } catch { toast("Not a valid backup"); }
  };
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
function download(name, text, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
function markdownLog(p) {
  const gs = Object.values(p.games); const A = gs.length ? aggregate(gs) : null; const D = A ? diagnose(A, p) : null;
  const L = [`# Chess Coach: ${p.name}`, "", `Updated: ${today()}`, "", "## Profile", `- Lichess: ${p.lichess || "–"} · Chess.com: ${p.chesscom || "–"} · Rating: ${p.rating || "–"}`, `- Goal: ${p.goal || "–"} · ${p.hours} h/week`, ""];
  if (A) {
    L.push(`## Diagnosis (${A.games} games, score ${A.scorePct}%)`, "| Phase | Accuracy | Errors/100 moves |", "|---|---|---|", ...Object.keys(A.phaseAcc).map((k) => `| ${k} | ${A.phaseAcc[k]} | ${A.seriousPer100[k]} |`), "");
    L.push("### Strengths", ...D.strengths.map((s) => `- **${s.title}**: ${s.evidence}`), "", "### Points to work on", ...D.weaknesses.map((w) => `- **${w.title}**: ${w.evidence}`), "");
    L.push("## Training plan", ...D.plan.weekly.map((w) => `- ${w.what}: ${w.mins} min/week. ${w.how}`), "");
  }
  L.push("## Repertoire", `- White: ${p.repertoire.white || "–"}`, `- vs 1.e4: ${p.repertoire.vsE4 || "–"}`, `- vs 1.d4: ${p.repertoire.vsD4 || "–"}`, p.repertoire.notes ? `\n${p.repertoire.notes}` : "", "");
  L.push("## Endgame tracker", "| Position | Status | Next review |", "|---|---|---|", ...allEndgames(p).map((e) => { const s = p.endgames[e.id]; return `| ${e.theme} | ${!s ? "new" : s.box >= 4 ? "known" : "learning"} | ${s ? s.due : "–"} |`; }), "");
  const pz = Object.values(p.puzzles); L.push(`## Puzzles from own games`, `${pz.length} total, ${pz.filter((x) => x.box >= 4).length} known, ${pz.filter((x) => !x.due || x.due <= today()).length} due.`, "");
  L.push("## Next steps", ...p.nextSteps.map((s) => `- [${s.done ? "x" : " "}] ${s.text}`), "", "## Log", ...p.log.slice(0, 100).map((l) => `- ${l.date.slice(0, 10)} · ${l.type} · ${l.text}`));
  return L.join("\n");
}

// ------------------------------------------------------------------ boot
if (!S.current || !S.players[S.current]) S.current = Object.keys(S.players)[0] || null;
go("home");
window.__chesscoach = { get state() { return S; }, go };
