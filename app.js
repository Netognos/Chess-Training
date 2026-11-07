import { Chess } from "./vendor/chess.js";
import { Engine, lineToCp, winPct, fmtScore } from "./engine.js";
import { Board } from "./board.js";
import { splitPgn, analyseGame, aggregate, pvToSan, parseGame } from "./analysis.js";
import { diagnose, nextStepsFrom } from "./coach.js";
import { ENDGAMES, REPERTOIRES, TAG_ADVICE } from "./data.js";
import { readPosition } from "./reader.js";
import { testView, resultsView, profileView, practiceView, TAC_CATS, POS_GROUPS, playerElo } from "./test.js";

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
    createdAt: today(), games: {}, reports: [], puzzles: {}, endgames: {}, customEndgames: [], notebook: [], log: [], nextSteps: [], repertoire: { white: "", vsE4: "", vsD4: "", notes: "" }, settings: { movetime: 150 } };
  S.current = id; save(); return id;
}
function srs(item, ok) { item.attempts = (item.attempts || 0) + 1; if (ok) { item.successes = (item.successes || 0) + 1; item.box = Math.min((item.box || 0) + 1, 5); } else item.box = 1; item.due = addDays(INTERVALS[item.box]); item.last = today(); item.lastOk = ok; }

// ------------------------------------------------------------------ routing
const SECTIONS = {
  analyse: [["home", "Start"], ["games", "Games"], ["report", "Report"], ["training", "Training"], ["puzzles", "Puzzles"], ["endgames", "Endgames"], ["board", "Board"], ["notebook", "Notebook"], ["log", "Log"]],
  test: [["test", "Test"], ["results", "Results"], ["profile", "Profile"], ["practice", "Modules"]],
};
const C = { P: () => P(), save: () => save(), go: (t, a) => go(t, a), esc, toast, today, logEvent, copy: (t) => copy(t), gradeMove: (...a) => gradeMove(...a), aggregate };
const views = { home, games, report, training, puzzles, endgames, board, notebook, log,
  test: (v) => testView(v, C), results: (v) => resultsView(v, C), profile: (v) => profileView(v, C), practice: (v, arg) => practiceView(v, arg, C) };
let tab = "home";
const sectionOf = (t) => (SECTIONS.test.some(([k]) => k === t) ? "test" : "analyse");
function renderNav() {
  const sec = sectionOf(tab);
  document.querySelectorAll("#sections button").forEach((b) => { b.classList.toggle("active", b.dataset.sec === sec); b.onclick = () => go(b.dataset.sec === "test" ? "test" : "home"); });
  $("#tabs").innerHTML = SECTIONS[sec].map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? "active" : ""}">${l}</button>`).join("");
  document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => go(b.dataset.tab)));
}
function go(t, arg) {
  tab = t;
  const v = $("#view"); v.innerHTML = "";
  if (!P() && t !== "home") { tab = "home"; renderNav(); home(v); return renderPicker(); }
  renderNav();
  Promise.resolve(views[t](v, arg)).catch((e) => { console.error(e); v.innerHTML = `<div class="card"><p style="color:var(--bad)">Something went wrong: ${esc(e.message || e)}</p></div>`; });
  renderPicker(); window.scrollTo(0, 0);
}
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
      <li><b>Games</b>: load the last months of your Lichess and/or Chess.com games (at least 10+0) and analyse them with Stockfish.</li>
      <li><b>Test & profile</b> (second part): a test with positions where you give your move and the reason why. It measures calculation depth, time and style, and works out your player type, the openings that fit you and your work points.</li>
      <li><b>Report</b>: your strengths, weaknesses and a weekly training plan.</li>
      <li><b>Puzzles</b>: your own mistakes as puzzles, repeated at spaced intervals.</li>
      <li><b>Endgames</b>: theory positions to know, played out against the engine.</li>
      <li><b>Board</b>: analyse any position, play on against the engine, or copy it to ask Claude about the plan.</li>
      <li><b>Notebook</b>: your own thoughts and candidate moves per position, checked by the engine.</li>
      <li><b>Log</b>: what you've done and the next steps, plus backup and export.</li></ol></div>`;
    $("#create").onclick = () => { const d = readProfile(v); if (!d.name) return toast("Fill in a name"); newPlayer(d); logEvent("profile", "Player created"); go("home"); };
    return;
  }
  const duePz = Object.values(p.puzzles).filter((x) => !x.due || x.due <= today()).length;
  const dueEg = allEndgames(p).filter((e) => { const s = p.endgames[e.id]; return !s || s.due <= today(); }).length;
  const last = p.reports[0];
  const nG = Object.keys(p.games).length;
  const stepsDef = [["1", "Profile", !!p.name, "home"], ["2", "Accounts", !!(p.lichess || p.chesscom), "home"], ["3", "Load games", nG > 0, "games"], ["4", "Statistics", nG > 0, "report"], ["5", "Strengths & weak points", nG > 0, "report"], ["6", "Training", Object.keys(p.practice || {}).length > 0, "training"]];
  v.innerHTML = `<div class="card"><h2>Step by step</h2><div class="steps">${stepsDef.map(([n, l, d, t]) => `<div class="step ${d ? "done" : ""}" data-go="${t}"><div class="n">${n}</div>${l}</div>`).join("")}
    <div class="step" data-go="test"><div class="n">→</div>Test & player profile</div></div>
    ${!(p.lichess || p.chesscom) ? `<p class="small" style="margin-top:8px">Fill in your Lichess and/or Chess.com username under <b>Profile</b> below.</p>` : ""}</div>
  <div class="card"><h2>${esc(p.name)}</h2>
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
  v.innerHTML = `<div class="card"><h2>Load & analyse games</h2>
    <div class="form">
      <label class="f">Sources<span class="row" style="gap:12px;color:var(--ink)"><label class="row small"><input type="checkbox" id="srcL" ${p.lichess ? "checked" : "disabled"}> Lichess${p.lichess ? ` (${esc(p.lichess)})` : ""}</label><label class="row small"><input type="checkbox" id="srcC" ${p.chesscom ? "checked" : "disabled"}> Chess.com${p.chesscom ? ` (${esc(p.chesscom)})` : ""}</label><label class="row small"><input type="checkbox" id="srcP" ${!p.lichess && !p.chesscom ? "checked" : ""}> PGN</label></span></label>
      <label class="f">Period<select id="months"><option value="1">Last month</option><option value="3" selected>Last 3 months</option><option value="6">Last 6 months</option><option value="12">Last 12 months</option></select></label>
      <label class="f">Time control at least<select id="mintc"><option value="300">5+0</option><option value="600" selected>10+0</option><option value="1300">15+10</option><option value="1800">30+0</option></select></label>
      <label class="f">Max. number of games<input id="num" type="number" value="100" min="1" max="500"></label>
      <label class="f">Depth<select id="speed"><option value="80">Fast (≈7 s/game)</option><option value="150" selected>Normal (≈12 s/game)</option><option value="400">Deep (≈30 s/game)</option></select></label>
    </div>
    <div id="pgnBox" class="hidden" style="margin-top:10px"><textarea id="pgnText" placeholder="Paste PGN here (one or more games)…"></textarea>
      <div class="row" style="margin-top:6px"><input type="file" id="pgnFile" accept=".pgn,.txt"><label class="f" style="flex-direction:row;align-items:center;gap:6px">Your name in the PGN <input id="pgnName" value="${esc(p.pgnName || p.lichess || p.chesscom || "")}"></label></div></div>
    <label class="row small" style="margin-top:10px"><input type="checkbox" id="reanalyse"> Re-analyse games that are already loaded (needed for the style statistics on games from before this update)</label>
    <div class="row" style="margin-top:12px"><button class="btn" id="go">Load & analyse</button><button class="btn secondary hidden" id="stop">Stop</button></div>
    <div id="prog" class="hidden" style="margin-top:12px"><div class="small" id="progText"></div><div class="bar" style="margin-top:6px"><div id="progBar"></div></div></div>
    <p class="small muted">"Time control at least 10+0" counts a game as base time + 40 × increment, so 8+2 also qualifies. Already-analysed games are skipped, so you can safely stop and continue later. Lichess games with a server analysis go much faster.</p></div>
    <div class="card"><h2>Analysed games (${list.length})</h2>${list.length ? `<div class="scroll"><table><tr><th>Date</th><th>Opponent</th><th>Colour</th><th>Result</th><th>Accuracy</th><th>Errors</th><th>Opening</th></tr>
    ${list.map((g) => { const opp = g.color === "w" ? g.black : g.white; const res = g.score === 1 ? "win" : g.score === 0 ? "loss" : "draw";
      const e = (l) => g.errors.filter((x) => x.label === l).length;
      return `<tr><td>${esc(g.date)}</td><td>${g.site && g.site.startsWith("http") ? `<a href="${esc(g.site)}" target="_blank" rel="noopener">${esc(opp)}</a>` : esc(opp)} <span class="muted small">${esc(g.opponentElo || "")}</span></td><td>${g.color === "w" ? "White" : "Black"}</td><td>${res}</td><td>${g.accuracy ?? "–"}</td><td><span class="pill blunder">${e("blunder")}</span><span class="pill mistake">${e("mistake")}</span></td><td class="small">${esc(g.opening)}</td></tr>`; }).join("")}</table></div>
    <div class="row" style="margin-top:10px"><button class="btn secondary" id="clearG">Delete all games</button></div>` : `<p class="muted">No games yet.</p>`}</div>`;
  const srcP = $("#srcP");
  srcP.onchange = () => $("#pgnBox").classList.toggle("hidden", !srcP.checked);
  srcP.onchange();
  $("#pgnFile").onchange = async (e) => { const f = e.target.files[0]; if (f) $("#pgnText").value = await f.text(); };
  $("#go").onclick = () => runImport(v);
  $("#stop").onclick = () => { if (running) running.stop = true; };
  if ($("#clearG")) $("#clearG").onclick = () => { if (confirm("Delete all analysed games for this player? (Puzzles and log are kept.)")) { p.games = {}; save(); go("games"); } };
}

const tcEstimate = (tc) => { const m = /^(\d+)(?:\+(\d+))?$/.exec(tc || ""); return m ? +m[1] + 40 * +(m[2] || 0) : null; };
async function fetchGames(p, opts, status) {
  const out = [];
  const since = Date.now() - opts.months * 30.4 * 86400000;
  if (opts.lichess && p.lichess) {
    status("Fetching games from Lichess…");
    const q = new URLSearchParams({ max: opts.num * 2, since: Math.floor(since), clocks: "true", evals: "true", opening: "true", perfType: opts.mintc >= 600 ? "rapid,classical,correspondence" : "blitz,rapid,classical" });
    const r = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(p.lichess)}?${q}`, { headers: { Accept: "application/x-chess-pgn" } });
    if (!r.ok) throw new Error(`Lichess answered ${r.status}. Is the username correct?`);
    for (const pgn of splitPgn(await r.text())) {
      const tc = (/\[TimeControl "([^"]+)"/.exec(pgn) || [])[1];
      const est = tcEstimate(tc); if (est === null || est < opts.mintc) continue;
      out.push({ pgn, name: p.lichess, src: "lichess" });
    }
  }
  if (opts.chesscom && p.chesscom) {
    status("Fetching games from Chess.com…");
    const u = p.chesscom.toLowerCase();
    const r = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(u)}/games/archives`);
    if (!r.ok) throw new Error(`Chess.com answered ${r.status}. Is the username correct?`);
    const sinceD = new Date(since); const cut = sinceD.getFullYear() * 12 + sinceD.getMonth();
    const arch = ((await r.json()).archives || []).filter((a) => { const m = /(\d{4})\/(\d{2})$/.exec(a); return m && +m[1] * 12 + (+m[2] - 1) >= cut; });
    for (let i = arch.length - 1; i >= 0; i--) {
      status(`Fetching games from Chess.com… (${arch[i].slice(-7)})`);
      const m = await (await fetch(arch[i])).json();
      for (const g of (m.games || []).reverse()) {
        if (g.rules !== "chess" || !g.pgn || g.time_class === "daily") continue;
        if ((g.end_time || 0) * 1000 < since) continue;
        const est = tcEstimate(g.time_control); if (est === null || est < opts.mintc) continue;
        out.push({ pgn: g.pgn, name: p.chesscom, src: "chess.com" });
      }
    }
  }
  if (opts.pgn) {
    const pgns = splitPgn($("#pgnText").value);
    let name = $("#pgnName").value.trim();
    if (!name && pgns.length) { const c = {}; for (const x of pgns) for (const t of ["White", "Black"]) { const m = new RegExp(`\\[${t} "([^"]+)"`).exec(x); if (m) c[m[1]] = (c[m[1]] || 0) + 1; } name = Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || ""; }
    if (name) { p.pgnName = name; save(); }
    for (const pgn of pgns) out.push({ pgn, name, src: "pgn" });
  }
  // newest first, capped
  const dateOf = (x) => ((/\[UTCDate "([^"]+)"/.exec(x.pgn) || /\[Date "([^"]+)"/.exec(x.pgn) || [])[1] || "");
  out.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  return out.slice(0, opts.num);
}

async function runImport(v) {
  const p = P();
  const opts = { lichess: $("#srcL").checked, chesscom: $("#srcC").checked, pgn: $("#srcP").checked, months: +$("#months").value, mintc: +$("#mintc").value, num: +$("#num").value || 100 };
  const movetime = +$("#speed").value;
  const re = $("#reanalyse").checked;
  const src = [opts.lichess && "Lichess", opts.chesscom && "Chess.com", opts.pgn && "PGN"].filter(Boolean).join(" + ");
  const prog = $("#prog"), txt = $("#progText"), bar = $("#progBar");
  prog.classList.remove("hidden"); $("#go").disabled = true; $("#stop").classList.remove("hidden");
  running = { stop: false };
  try {
    if (!opts.lichess && !opts.chesscom && !opts.pgn) throw new Error("Choose at least one source.");
    const list = await fetchGames(p, opts, (t) => (txt.textContent = t));
    if (!list.length) throw new Error("No games found for this period and time control.");
    const todo = list.filter((x) => { const l = (/\[Link "([^"]+)"/.exec(x.pgn) || [])[1]; const s2 = (/\[Site "([^"]+)"/.exec(x.pgn) || [])[1]; const id = l || (s2 && s2.startsWith("http") ? s2 : null); return re || !(id && p.games[id]); }).length;
    txt.textContent = `${list.length} games found (${todo} new). Estimated time: ~${Math.max(1, Math.round(todo * movetime / 150 * 12 / 60))} min.`;
    await new Promise((r) => setTimeout(r, 1200));
    const pgns = list.map((x) => x.pgn);
    txt.textContent = "Starting Stockfish…";
    const eng = getEngine(); await eng.ready;
    let done = 0, added = 0, skipped = 0;
    for (const [gi, pgn] of pgns.entries()) {
      if (running.stop) break;
      const name = list[gi].name;
      const site = (/\[Site "([^"]+)"/.exec(pgn) || [])[1];
      const link = (/\[Link "([^"]+)"/.exec(pgn) || [])[1];
      const gid = link || (site && site.startsWith("http") ? site : null);
      if (gid && p.games[gid] && !re) { done++; skipped++; continue; }
      let r;
      try {
        r = await analyseGame(eng, pgn, name, { movetime }, (k, n) => {
          txt.textContent = `Game ${done + 1} of ${pgns.length} (${list[gi].src}): position ${k}/${n}`;
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
    else if (skipped && !added) txt.textContent += " All games were already analysed, or the name didn't match.";
  } catch (e) {
    console.error(e);
    txt.innerHTML = `<span style="color:var(--bad)">${esc(e.message || e)}</span> · If downloading doesn't work, export the PGN from the website and paste it under 'PGN'.`;
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
  <div class="card"><h2>Next</h2><div class="row"><button class="btn" id="toTrain">6. Start training</button><button class="btn secondary" id="toProfile">Your style & player profile</button></div></div>
  <div class="card"><h2>Talk it through with Claude</h2><p class="small">Copy this summary and paste it into a chat with Claude for in-depth advice on plans, openings or a training schedule.</p><button class="btn secondary" id="copyRep">Copy summary for Claude</button></div>`;
  bindRepertoire(v, p);
  $("#copyRep").onclick = () => copy(claudeSummary(p, A, D));
  $("#toTrain").onclick = () => go("training");
  $("#toProfile").onclick = () => go("profile");
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

// ------------------------------------------------------------------ TRAINING (step 6)
const MODULE_MAP = {
  "missed tactic / forcing move": ["Attack & mate", "Sacrifice", "Calculation"],
  "hung material / allowed tactic": ["Defence", "Quiet moves"],
  "allowed mate": ["Defence", "kingsafety"],
  "positional / planning": ["coordination", "prophylaxis", "space", "structure"],
  "endgame technique": ["Endgame", "technique"],
  "threw away winning position": ["technique", "prophylaxis"],
  "missed mate": ["Attack & mate"],
};
const MOD_LABEL = (c) => POS_GROUPS[c] || c;
function training(v) {
  const p = P();
  const gs = Object.values(p.games);
  const A = gs.length ? aggregate(gs) : null, D = A ? diagnose(A, p) : null;
  const rec = [];
  if (A) {
    for (const t of Object.keys(A.tags)) for (const m of MODULE_MAP[t] || []) if (!rec.includes(m)) rec.push(m);
    const worst = Object.keys(A.seriousPer100).sort((a, b) => A.seriousPer100[b] - A.seriousPer100[a])[0];
    if (worst === "endgame" && !rec.includes("Endgame")) rec.unshift("Endgame");
  }
  const lastTest = (p.tests || []).filter((t) => t.done).slice(-1)[0];
  if (lastTest?.result) Object.entries(lastTest.result.cats).sort((a, b) => a[1].rating - b[1].rating).slice(0, 3).forEach(([c]) => { if (!rec.includes(c)) rec.unshift(c); });
  const all = TAC_CATS.concat(Object.keys(POS_GROUPS));
  const prog = (c) => { const x = (p.practice || {})[c]; return x ? `${x.solved}/${x.n} solved · level ≈ ${Math.round(x.est)}` : "not started yet"; };
  const duePz = Object.values(p.puzzles).filter((x) => !x.due || x.due <= today()).length;
  v.innerHTML = `<div class="card"><h2>Your training</h2>
    <p class="small">Based on ${A ? `your ${A.games} analysed games` : "your profile"}${lastTest ? " and your last test" : ""}. Start with the modules at the top: they target your weak points.</p>
    <h3>Recommended modules</h3>${rec.length ? rec.slice(0, 6).map((c, i) => `<div class="list-item ${i < 3 ? "weak" : ""}"><div class="row" style="justify-content:space-between"><span><b>${esc(MOD_LABEL(c))}</b> <span class="small muted">${prog(c)}</span></span><button class="btn small" data-prac="${esc(c)}">Train</button></div></div>`).join("") : `<p class="muted small">Analyse games or take the test first.</p>`}
    <h3>Daily routine (${p.hours} h/week)</h3><ol class="small">
      <li><b>Puzzles from your own games</b>: ${duePz} due today. <a href="#" data-go="puzzles">Go</a></li>
      <li><b>Module of the day</b>: 10 positions from the first recommended module, with the Think sheet for each position.</li>
      <li><b>Endgames</b>: 1 theory position to play out. <a href="#" data-go="endgames">Go</a></li>
      <li><b>Serious games</b> (15+10 or slower): afterwards, load them on the Games tab and check your mistakes.</li></ol>
    ${D ? `<h3>Weekly schedule</h3>${D.plan.weekly.map((w) => `<div class="list-item ${w.weak ? "weak" : ""}"><b>${esc(w.what)} · ${w.mins} min/week</b><span class="small">${esc(w.how)}</span></div>`).join("")}` : ""}</div>
    <div class="card"><h2>All modules</h2><div class="scroll"><table>${all.map((c) => `<tr><td>${esc(MOD_LABEL(c))}</td><td class="small muted">${TAC_CATS.includes(c) ? "tactical" : "positional"}</td><td class="small">${prog(c)}</td><td><button class="btn secondary small" data-prac="${esc(c)}">Train</button></td></tr>`).join("")}</table></div></div>`;
  v.querySelectorAll("[data-prac]").forEach((b) => (b.onclick = () => go("practice", { cat: b.dataset.prac })));
  v.querySelectorAll("[data-go]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); go(a.dataset.go); }));
}

// ------------------------------------------------------------------ PUZZLES
function puzzles(v) {
  const p = P();
  const all = Object.values(p.puzzles);
  const due = all.filter((x) => !x.due || x.due <= today()).sort((a, b) => (a.box || 0) - (b.box || 0) || b.drop - a.drop);
  if (!all.length) { v.innerHTML = `<div class="card"><h2>Puzzles from your own games</h2><p>Analyse games first: your biggest mistakes become puzzles here.</p><button class="btn" id="g">Import games</button></div>`; $("#g").onclick = () => go("games"); return; }
  const known = all.filter((x) => (x.box || 0) >= 4).length;
  v.innerHTML = `<div class="two"><div><div id="pb"></div><div class="row" style="margin-top:8px"><button class="btn secondary" id="hint">Hint</button><button class="btn secondary" id="show">Show solution</button><button class="btn secondary" id="explore">Open on Board</button><button class="btn" id="next">Next</button></div>
    <div class="row" style="margin-top:8px"><button class="btn secondary" id="pRead">Read the position</button><button class="btn secondary" id="pSheet">Think sheet</button></div>
    <div class="card hidden" id="pReadOut" style="margin-top:12px"></div><div class="card hidden" id="pSheetOut" style="margin-top:12px"></div></div>
    <div><div class="card"><h2>Your mistakes as puzzles</h2><div class="small muted">${due.length} due · ${all.length} total · ${known} known</div><div id="pinfo" style="margin-top:10px"></div><div id="pfb"></div></div>
    <div class="card"><h2>How it works</h2><p class="small">Every position comes from your own game, at the moment you went wrong. Find the best move. Get it right and you'll see it again after 1, 3, 7, 21 and 60 days. Get it wrong and it comes back tomorrow. Ask yourself first: <b>what does my opponent threaten, and what checks, captures and threats do I have?</b></p></div></div></div>`;
  const brd = new Board($("#pb"), { orientation: "w" });
  let cur = null, idx = 0, solved = false, tries = 0;
  const show = () => {
    cur = due[idx]; solved = false; tries = 0; $("#pfb").innerHTML = "";
    if (!cur) { $("#pinfo").innerHTML = `<div class="feedback ok">No more puzzles due today. Well done! Come back tomorrow, or practise endgames.</div>`; brd.locked = true; return; }
    brd.locked = false; brd.setFen(cur.fen); brd.setOrientation(cur.fen.split(" ")[1]);
    const side = cur.fen.split(" ")[1] === "w" ? "White" : "Black";
    $("#pinfo").innerHTML = `<b>Move ${cur.moveNo}, you're ${side}</b> (${esc(cur.phase)}). Eval before your move: ${cur.evalBefore > 0 ? "+" : ""}${cur.evalBefore}.<br><span class="small muted">${cur.played === "?" ? "Your own position: find the best move." : `In the game you played <b>${esc(cur.played)}</b>${cur.game && cur.game.startsWith("http") ? ` · <a href="${esc(cur.game)}" target="_blank" rel="noopener">game</a>` : ""}. Find a better move.`}</span>`;
    $("#pReadOut").classList.add("hidden"); $("#pSheetOut").classList.add("hidden");
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
  $("#pRead").onclick = () => { if (!cur) return; const o = $("#pReadOut"); o.classList.toggle("hidden"); if (!o.classList.contains("hidden")) o.innerHTML = `<h2>Read the position</h2>` + readerHtml(cur.fen); };
  $("#pSheet").onclick = () => { if (!cur) return; const o = $("#pSheetOut"); o.classList.toggle("hidden"); if (!o.classList.contains("hidden")) thinkSheet(o, () => cur.fen, { source: "puzzle", title: `Puzzle: move ${cur.moveNo}${cur.game ? " (" + cur.game.split("/").pop() + ")" : ""}` }); };
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
  const p = P(); p.settings ||= {};
  v.innerHTML = `<div class="two"><div><div id="ab"></div>
    <div class="row" style="margin-top:8px"><button class="btn secondary" id="undo">↶ Undo</button><button class="btn secondary" id="flip">⇅ Flip</button><button class="btn secondary" id="startpos">Start position</button><button class="btn secondary" id="clear">Empty FEN</button></div>
</div>
    <div><div class="card"><h2>Analysis</h2>
      <label class="f">FEN<input id="fen"></label><div class="row" style="margin-top:6px"><button class="btn secondary" id="load">Load FEN</button><button class="btn secondary" id="pgnLoad">Load PGN…</button></div>
      <div class="row" style="margin-top:10px"><label class="row small"><input type="checkbox" id="auto" ${p.settings.autoEngine ? "checked" : ""}> Show engine</label><label class="row small"><input type="checkbox" id="vs"> Engine plays the other side</label></div>
      <div class="lines" id="lines" style="margin-top:8px"></div><div class="small muted" id="moves" style="margin-top:8px"></div></div>
      <div class="card" id="sheet"></div>
      <div class="card"><h2>Read the position</h2><p class="small muted">Material, loose pieces, threats, kings, pawns and activity, plus what that means for the plan. Fill in the Think sheet first, then compare.</p>
      <button class="btn secondary" id="readBtn">Read the position</button><div id="readOut" style="margin-top:8px"></div>${evalGuideHtml()}</div>
      <div class="card"><h2>Next</h2><div class="row"><button class="btn secondary" id="claude">Copy for Claude (plan question)</button><button class="btn secondary" id="addPz">Add as puzzle</button><button class="btn secondary" id="addEg">Add as endgame drill</button></div>
      <p class="small muted">"Copy for Claude" copies the position, your moves and the engine lines as a question, ready to paste into a chat with Claude.</p></div></div></div>`;
  const brd = new Board($("#ab"));
  const hist = [];
  let lastLines = [];
  const startFen = arg?.fen || new Chess().fen();
  brd.setFen(startFen); brd.setOrientation(startFen.split(" ")[1]);
  thinkSheet($("#sheet"), () => brd.fen(), { note: arg?.note || null, source: "board" });
  let readOpen = false;
  const drawRead = () => { if (readOpen) $("#readOut").innerHTML = readerHtml(brd.fen()); };
  $("#readBtn").onclick = () => { readOpen = !readOpen; $("#readBtn").textContent = readOpen ? "Hide reading" : "Read the position"; $("#readOut").innerHTML = readOpen ? readerHtml(brd.fen()) : ""; };
  let token = 0;
  const refresh = async () => {
    $("#fen").value = brd.fen();
    $("#moves").textContent = hist.length ? "Moves: " + hist.map((h) => h.san).join(" ") : "";
    const c = brd.chess;
    drawRead();
    if (c.isGameOver()) { $("#lines").innerHTML = `<div>${c.isCheckmate() ? "Checkmate" : "Draw"}</div>`; return; }
    if (!$("#auto").checked) { $("#lines").innerHTML = `<div class="muted small">Engine hidden. Think first, then tick "Show engine".</div>`; brd.setArrows([]); return; }
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
  $("#load").onclick = () => { try { const f = $("#fen").value.trim(); new Chess(f); hist.length = 0; brd.setFen(f); brd.setOrientation(f.split(" ")[1]); refresh(); } catch (e) { toast("Invalid FEN"); } };
  $("#pgnLoad").onclick = () => { const t = prompt("Paste a PGN (one game):"); if (!t) return; try { const g = parseGame(t); hist.length = 0; brd.setFen(g.fens[g.fens.length - 1]); g.moves.forEach((m, i) => hist.push({ san: m.san, before: g.fens[i] })); refresh(); } catch { toast("Couldn't read the PGN"); } };
  $("#auto").onchange = () => { p.settings.autoEngine = $("#auto").checked; save(); refresh(); };
  $("#addPz").onclick = async () => {
    const fen = brd.fen(); toast("Engine is looking for the best move…");
    const [l] = await getEngine().analyse(fen, { movetime: 1500 });
    if (!l?.pv[0]) return toast("No move found");
    const m = new Chess(fen).move({ from: l.pv[0].slice(0, 2), to: l.pv[0].slice(2, 4), promotion: l.pv[0][4] });
    const key = "own#" + Date.now().toString(36);
    p.puzzles[key] = { key, fen, played: "?", best: m.san, bestLine: pvToSan(fen, l.pv, 8), game: "", moveNo: +fen.split(" ")[5], color: fen.split(" ")[1], phase: "own position", tags: [], evalBefore: +(lineToCp(l) / 100).toFixed(2), drop: 0, box: 0, due: today() };
    save(); logEvent("puzzle", "Own position added as puzzle"); toast("Added under Puzzles");
  };
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

// ------------------------------------------------------------------ THINKING TOOLS (reader + think sheet + notebook)
const QUESTIONS = [
  ["material", "1. Material & imbalances", "Who has more? Are there special imbalances (bishop pair, two minors vs rook, exchange)?"],
  ["threats", "2. Opponent's threats & loose pieces", "What did their last move change? What do THEY want to take or check next? Which pieces (yours or theirs) are loose or hanging?"],
  ["forcing", "3. My forcing moves", "Checks, captures and threats that I have. Do any of them work?"],
  ["structure", "4. Kings & pawn structure", "Whose king is weaker? Passed, isolated or doubled pawns? Open files? Which pawn breaks are there?"],
  ["plan", "5. Plan: worst piece & goal", "Which of my pieces is worst, and where does it belong? What is my goal for the next 3-5 moves?"],
];

function readerHtml(fen) {
  let R; try { R = readPosition(fen); } catch (e) { return `<p class="muted">Couldn't read this position.</p>`; }
  const sec = (t, k) => `<h3>${t}</h3><ul class="small">${R.sections[k].map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  return `<div class="feedback info small"><b>What this means for ${R.turn === "w" ? "White" : "Black"} (to move):</b><ul>${R.hints.map((h) => `<li>${esc(h)}</li>`).join("")}</ul></div>` +
    sec("Material", "material") + sec("Loose & hanging pieces", "loose") + sec("Threats (opponent)", "threats") + sec("Forcing moves (side to move)", "forcing") +
    sec("King safety", "kings") + sec("Pawn structure & files", "pawns") + sec("Activity", "activity") +
    `<p class="small muted">Rule-based reading (no engine): good for spotting facts, but you have to judge what matters most. Then compare with the engine.</p>`;
}

// Think sheet: 5 questions + candidate moves with ideas, checked by the engine on request.
// getFen() returns the position the sheet is about; note = existing notebook entry or null.
function thinkSheet(container, getFen, { note = null, source = "board", title = "" } = {}) {
  const p = P();
  const n = note || { id: null, answers: {}, candidates: [{ move: "", idea: "" }], conclusion: "", title };
  container.innerHTML = `<h2>Think sheet</h2>
    <p class="small muted">Answer the questions BEFORE you look at the engine. Short notes are fine, the point is that you look.</p>
    ${QUESTIONS.map(([k, t, help]) => `<label class="f" style="margin-top:8px"><b style="color:var(--ink)">${t}</b><span class="small">${help}</span><textarea data-q="${k}" style="min-height:52px">${esc(n.answers[k] || "")}</textarea></label>`).join("")}
    <h3>Candidate moves</h3><p class="small muted">Write 2-3 moves with the idea behind each one, and the opponent's best answer you expect.</p>
    <div id="cands"></div>
    <div class="row" style="margin-top:6px"><button class="btn secondary" id="addCand">+ Candidate</button><button class="btn" id="checkCands">Check candidates with engine</button></div>
    <label class="f" style="margin-top:10px"><b style="color:var(--ink)">Conclusion / what I learned</b><textarea id="concl" style="min-height:52px">${esc(n.conclusion || "")}</textarea></label>
    <div class="row" style="margin-top:8px"><input class="grow" id="noteTitle" placeholder="Title (e.g. 'Middlegame vs X, move 22')" value="${esc(n.title || "")}"><button class="btn secondary" id="saveNote">Save to notebook</button></div>`;
  const cands = container.querySelector("#cands");
  const drawCands = () => {
    cands.innerHTML = n.candidates.map((c, i) => `<div class="list-item" style="margin:6px 0"><div class="row"><input data-cm="${i}" placeholder="Move (e.g. Nd7)" value="${esc(c.move)}" style="width:110px">
      <input class="grow" data-ci="${i}" placeholder="Idea: why this move, what do I expect?" value="${esc(c.idea)}"><button class="btn secondary small" data-cx="${i}" title="Remove">✕</button></div>
      ${c.verdict ? `<div class="small" style="margin-top:4px"><span class="pill ${c.verdict === "best" || c.verdict === "good" ? "good" : c.verdict}">${esc(c.verdict)}</span> eval ${esc(c.evalTxt)} · line: ${esc(c.line)}</div>` : ""}
      ${c.error ? `<div class="small" style="color:var(--bad)">${esc(c.error)}</div>` : ""}</div>`).join("");
    cands.querySelectorAll("[data-cm]").forEach((x) => (x.oninput = () => { n.candidates[+x.dataset.cm].move = x.value.trim(); n.candidates[+x.dataset.cm].verdict = null; }));
    cands.querySelectorAll("[data-ci]").forEach((x) => (x.oninput = () => (n.candidates[+x.dataset.ci].idea = x.value)));
    cands.querySelectorAll("[data-cx]").forEach((x) => (x.onclick = () => { n.candidates.splice(+x.dataset.cx, 1); drawCands(); }));
  };
  drawCands();
  const collect = () => { container.querySelectorAll("[data-q]").forEach((t) => (n.answers[t.dataset.q] = t.value)); n.conclusion = container.querySelector("#concl").value; n.title = container.querySelector("#noteTitle").value.trim(); };
  container.querySelector("#addCand").onclick = () => { collect(); n.candidates.push({ move: "", idea: "" }); drawCands(); };
  container.querySelector("#checkCands").onclick = async (ev) => {
    collect(); const fen = getFen(); const btn = ev.target; btn.disabled = true; btn.textContent = "Checking…";
    const stm = fen.split(" ")[1];
    for (const c of n.candidates) {
      c.error = null; c.verdict = null;
      if (!c.move) continue;
      let mv; try { mv = new Chess(fen).move(c.move); } catch { mv = null; }
      if (!mv) { c.error = `"${c.move}" is not a legal move in this position.`; continue; }
      c.move = mv.san;
      const g = await gradeMove(fen, mv.from + mv.to + (mv.promotion || ""), 1200);
      c.verdict = g.verdict; const sg = (x) => (x >= 0 ? "+" : "") + (x / 100).toFixed(2);
      c.evalTxt = `${sg(g.afterCp)} for ${stm === "w" ? "White" : "Black"} (best move: ${sg(g.bestCp)})`;
      const after = new Chess(fen); after.move(c.move);
      const [l] = await getEngine().analyse(after.fen(), { movetime: 600 });
      c.line = `${mv.san} ${pvToSan(after.fen(), l?.pv || [], 6)}`.trim();
      c.best = g.bestLine.split(" ")[0];
    }
    const bestTxt = n.candidates.find((c) => c.best)?.best;
    drawCands(); btn.disabled = false; btn.textContent = "Check candidates with engine";
    if (bestTxt && !n.candidates.some((c) => c.move === bestTxt)) cands.insertAdjacentHTML("beforeend", `<div class="feedback info small">The engine's top move is <b>${esc(bestTxt)}</b>, which is not on your list. Which question would have led you to it?</div>`);
  };
  container.querySelector("#saveNote").onclick = () => {
    collect();
    const entry = { ...n, id: n.id || "n" + Date.now().toString(36), fen: getFen(), date: n.date || today(), updated: today(), source, title: n.title || `Position ${today()}` };
    p.notebook ||= [];
    const i = p.notebook.findIndex((x) => x.id === entry.id);
    if (i >= 0) p.notebook[i] = entry; else { p.notebook.unshift(entry); logEvent("notebook", "Position saved: " + entry.title); }
    n.id = entry.id; save(); toast("Saved in Notebook");
  };
  return { collect, note: n };
}

function evalGuideHtml() {
  return `<details><summary><b>How do I evaluate a position?</b> (tap to open)</summary>
  <div class="small" style="margin-top:8px">
  <p><b>Who is better, and why?</b> Go through these four factors, roughly in order of importance:</p>
  <ol><li><b>Material</b>: pawn 1, knight/bishop 3, rook 5, queen 9. Two minor pieces vs a rook ≈ +1 for the pieces in the middlegame. The bishop pair is worth about half a pawn in open positions.</li>
  <li><b>King safety</b>: a king with few pawns in front of it, or open files toward it, can outweigh material, especially with queens on the board.</li>
  <li><b>Activity</b>: which pieces do something, and which are passive? Look for the worst piece of each side. Who has open files and outposts?</li>
  <li><b>Pawn structure</b>: passed pawns (strong, push them), isolated or doubled pawns (weak, targets), pawn breaks (how you open the position).</li></ol>
  <p><b>From evaluation to plan:</b> if you are ahead in material, remove counterplay and trade pieces. If the enemy king is weak, attack it. If you have the better structure, trade into an endgame. If you have a passive piece, improve it first.</p>
  <p><b>Finding candidate moves:</b></p>
  <ol><li>Forcing moves first: <b>checks, captures, threats</b>, for both sides.</li>
  <li>No tactics? Then look at <b>improving moves</b>: worst piece to a better square, a rook to an open file, a pawn break, prophylaxis (stop their plan).</li>
  <li>Pick 2-3 candidates. For EACH one: what is the opponent's best reply? The candidate that holds up best against the best reply wins.</li>
  <li><b>Blunder check</b> before you play: what does this piece leave unprotected? Which line opens? What can the opponent take or check now?</li></ol>
  <p><b>Reading the engine number</b> (+ = good for White): ±0.3 equal · ±0.7 slightly better · ±1.5 clearly better · ±3 or more winning. The number says WHO is better; your four factors say WHY.</p>
  <p><b>Order matters:</b> pieces before pawns (a pawn move can't be undone), moves with tempo first, and grab free material before trading.</p>
  </div></details>`;
}

// ------------------------------------------------------------------ NOTEBOOK
function notebook(v) {
  const p = P(); p.notebook ||= [];
  v.innerHTML = `<div class="card"><h2>Notebook</h2><p class="small">Your positions with your own thoughts, candidate moves and conclusions. Make new ones on the <b>Board</b> (Think sheet → Save), or from a puzzle.</p>${evalGuideHtml()}</div>
    ${p.notebook.length ? p.notebook.map((n) => `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(n.title)}</h2><span class="small muted">${esc(n.date)}${n.updated && n.updated !== n.date ? " · updated " + esc(n.updated) : ""}</span></div>
      <div class="small muted" style="margin:4px 0 8px">FEN: <code>${esc(n.fen)}</code></div>
      ${QUESTIONS.filter(([k]) => n.answers?.[k]).map(([k, t]) => `<div class="small"><b>${t}</b>: ${esc(n.answers[k])}</div>`).join("")}
      ${n.candidates?.filter((c) => c.move).length ? `<h3>Candidates</h3>${n.candidates.filter((c) => c.move).map((c) => `<div class="small">• <b>${esc(c.move)}</b>: ${esc(c.idea || "")} ${c.verdict ? `<span class="pill ${c.verdict === "best" || c.verdict === "good" ? "good" : c.verdict}">${esc(c.verdict)}</span>` : ""}</div>`).join("")}` : ""}
      ${n.conclusion ? `<div class="feedback info small"><b>Conclusion:</b> ${esc(n.conclusion)}</div>` : ""}
      <div class="row" style="margin-top:8px"><button class="btn secondary" data-open="${n.id}">Open on Board</button><button class="btn secondary" data-copy="${n.id}">Copy for Claude</button><button class="btn secondary" data-del="${n.id}">Delete</button></div></div>`).join("") : `<div class="card"><p class="muted">No positions saved yet.</p><button class="btn" id="toB">Go to Board</button></div>`}`;
  $("#toB") && ($("#toB").onclick = () => go("board"));
  v.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => { const n = p.notebook.find((x) => x.id === b.dataset.open); go("board", { fen: n.fen, note: n }); }));
  v.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => { if (confirm("Delete this position?")) { p.notebook = p.notebook.filter((x) => x.id !== b.dataset.del); save(); go("notebook"); } }));
  v.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => { const n = p.notebook.find((x) => x.id === b.dataset.copy); copy(noteForClaude(n)); }));
}
function noteForClaude(n) {
  return `Chess position: give feedback on my thinking. Is my assessment right, which candidate is best and WHY, and what did I miss?\n\nFEN: ${n.fen}\n\n` +
    QUESTIONS.map(([k, t]) => `${t}: ${n.answers?.[k] || "-"}`).join("\n") +
    `\n\nMy candidates:\n${(n.candidates || []).filter((c) => c.move).map((c) => `- ${c.move}: ${c.idea || ""}${c.verdict ? ` [engine: ${c.verdict}, ${c.evalTxt}]` : ""}`).join("\n")}\n\nConclusion: ${n.conclusion || "-"}`;
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
  if ((p.notebook || []).length) L.push("## Notebook", ...p.notebook.slice(0, 30).map((n) => `- **${n.title}** (${n.date}): ${(n.candidates || []).filter((c) => c.move).map((c) => c.move + (c.idea ? " [" + c.idea + "]" : "")).join("; ")}${n.conclusion ? " → " + n.conclusion : ""}`), "");
  L.push("## Next steps", ...p.nextSteps.map((s) => `- [${s.done ? "x" : " "}] ${s.text}`), "", "## Log", ...p.log.slice(0, 100).map((l) => `- ${l.date.slice(0, 10)} · ${l.type} · ${l.text}`));
  return L.join("\n");
}

// ------------------------------------------------------------------ boot
if (!S.current || !S.players[S.current]) S.current = Object.keys(S.players)[0] || null;
go("home");
window.__chesscoach = { get state() { return S; }, go };
