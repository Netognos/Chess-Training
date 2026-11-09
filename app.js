import { Chess } from "./vendor/chess.js";
import { Engine, lineToCp, winPct, fmtScore } from "./engine.js";
import { Board } from "./board.js";
import { splitPgn, analyseGame, aggregate, pvToSan, parseGame, gameKey } from "./analysis.js";
import { diagnose, nextStepsFrom } from "./coach.js";
import { ENDGAMES, REPERTOIRES, TAG_ADVICE } from "./data.js";
import { readPosition } from "./reader.js";
import { probe, testingMove, gradeTB, moveScore } from "./tb.js";
import { mountExplorer, lichessToken, setLichessToken } from "./explorer.js";
import { LineBuilder, checkLine, sideReport, sideReportHtml, fmt as fmtLine } from "./lines.js";
import { explainMove, explainHtml } from "./explain.js";
import { testView, resultsView, profileView, practiceView, TAC_CATS, POS_GROUPS, playerElo, aiSettings, currentStyle } from "./test.js";
import { openingsView, repertoireView } from "./openingsview.js";

// ------------------------------------------------------------------ state
const KEY = "chesscoach.v1";
const INTERVALS = [0, 1, 3, 7, 21, 60];
let S = load();
let engine = null;
const getEngine = () => (engine ||= Engine.browser());
let viewGen = 0; // increases on every navigation; async work checks it before touching the page

// Repairs anything missing or malformed in the stored data, so an old version or a damaged backup never breaks the app.
function obj(x) { return x && typeof x === "object" && !Array.isArray(x) ? x : {}; }
function arr(x) { return Array.isArray(x) ? x : []; }
function normalise(s) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return null;
  const players = {};
  for (const [id, p0] of Object.entries(obj(s.players))) {
    if (!p0 || typeof p0 !== "object") continue;
    const p = { ...p0, id: String(p0.id || id), name: String(p0.name ?? "Player") || "Player" };
    for (const k of ["games", "puzzles", "endgames", "practice", "settings"]) p[k] = obj(p[k]);
    for (const k of ["reports", "customEndgames", "notebook", "log", "nextSteps", "tests"]) p[k] = arr(p[k]);
    // drop damaged entries inside the collections (an entry the pages can't show would break them)
    const isO = (x) => x && typeof x === "object" && !Array.isArray(x);
    const str = (x) => typeof x === "string";
    const keep = (m, ok) => Object.fromEntries(Object.entries(m).filter(([, x]) => isO(x) && ok(x)));
    p.games = keep(p.games, (g) => (g.color === "w" || g.color === "b") && typeof g.score === "number" && Array.isArray(g.errors));
    // games from older versions may lack newer fields: fill them in instead of dropping the game
    for (const g of Object.values(p.games)) { g.errors = g.errors.filter(isO).map((e) => ({ ...e, tags: arr(e.tags) })); g.phaseAcc = obj(g.phaseAcc); g.phaseMoves = obj(g.phaseMoves); if (g.style !== undefined) { g.style = obj(g.style); g.style.acc = obj(g.style.acc); } }
    p.puzzles = keep(p.puzzles, (z) => str(z.fen) && str(z.best));
    for (const z of Object.values(p.puzzles)) z.tags = arr(z.tags);
    p.endgames = keep(p.endgames, () => true);
    p.practice = keep(p.practice, () => true);
    p.reports = p.reports.filter((r) => isO(r) && str(r.date));
    p.customEndgames = p.customEndgames.filter((e) => isO(e) && str(e.fen) && str(e.id));
    p.notebook = p.notebook.filter((n) => isO(n) && str(n.fen)).map((n) => ({ ...n, answers: obj(n.answers), candidates: arr(n.candidates) }));
    p.log = p.log.filter((e) => isO(e) && str(e.text)).map((e) => ({ ...e, date: String(e.date || ""), type: String(e.type || "note") }));
    p.nextSteps = p.nextSteps.filter((s) => isO(s) && str(s.text));
    p.tests = p.tests.filter((t) => isO(t) && Array.isArray(t.items)).map((t) => { const items = t.items.filter(isO); return { ...t, items, plan: Array.isArray(t.plan) ? t.plan : items.map((i) => ({ kind: i.kind || "tac", cat: i.cat || "Calculation" })), est: obj(t.est), q: obj(t.q) }; });
    p.repertoire = { white: "", vsE4: "", vsD4: "", notes: "", ...obj(p.repertoire) };
    p.hours = +p.hours || 4;
    for (const k of ["lichess", "chesscom", "pgnName", "goal", "rating"]) p[k] = p[k] == null ? "" : String(p[k]);
    players[p.id] = p;
  }
  return { version: 1, ...s, players, current: players[s.current] ? s.current : Object.keys(players)[0] || null };
}
function load() {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try { const s = normalise(JSON.parse(raw)); if (s) return s; } catch {}
    // unreadable data: keep a copy instead of overwriting it silently
    try { localStorage.setItem(KEY + ".broken-" + Date.now(), raw); } catch {}
    setTimeout(() => toast("Your saved data couldn't be read. A copy was kept; restore a backup in Home → Log & backup."), 800);
  }
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
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v12h14V9"/><path d="M10 21v-6h4v6"/>',
  analyse: '<path d="M3 21h18"/><path d="M6 17V11"/><path d="M11 17V5"/><path d="M16 17v-8"/><path d="M21 17v-3"/>',
  train: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  test: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.6 1.6"/><path d="M9.5 2.5h5"/><path d="M12 2.5V6"/>',
  openings: '<path d="M2.5 5.5C5.5 4 9 4 12 5.8c3-1.8 6.5-1.8 9.5-.3v13.7c-3-1.5-6.5-1.5-9.5.3-3-1.8-6.5-1.8-9.5-.3z"/><path d="M12 5.8v13.7"/>',
  puzzle: '<path d="M8 3h4a2 2 0 1 1 4 0h3v5a2 2 0 1 0 0 4v5h-5a2 2 0 1 0-4 0H5v-5a2 2 0 1 0 0-4V3z"/>',
  king: '<path d="M12 2v5M9.5 4.5h5"/><path d="M7 21h10"/><path d="M8 18h8l1-7c-2-2-8-2-10 0z"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>`;
const SECTIONS = {
  home: { label: "Home", tabs: [["home", "Overview"], ["account", "Profile"], ["log", "Log & backup"]] },
  analyse: { label: "Analyse", tabs: [["games", "Games"], ["report", "Report"]] },
  train: { label: "Train", tabs: [["training", "Plan"], ["puzzles", "Puzzles"], ["endgames", "Endgames"], ["board", "Board"], ["notebook", "Notebook"]] },
  test: { label: "Test", tabs: [["test", "Test"], ["results", "Results"], ["profile", "Player profile"], ["practice", "Modules"]] },
  openings: { label: "Openings", tabs: [["openings", "Library"], ["repertoire", "My repertoire"]] },
};
const TITLES = { home: "", account: "Profile", log: "Log & backup", games: "Your games", report: "Report", training: "Training plan", puzzles: "Puzzles from your games", endgames: "Endgames",
  board: "Analysis board", notebook: "Notebook", test: "Thinking test", results: "Test results", profile: "Player profile", practice: "Training modules", openings: "Opening library", repertoire: "My repertoire" };
const OC = () => ({ ...C, style: () => currentStyle(P(), C), Board, icon });
const C = { gen: () => viewGen, P: () => P(), save: () => save(), go: (t, a) => go(t, a), esc, toast, today, logEvent, copy: (t) => copy(t), gradeMove: (...a) => gradeMove(...a), aggregate, engine: () => getEngine() };
const views = { home, account, games, report, training, puzzles, endgames, board, notebook, log,
  openings: (v, arg) => openingsView(v, arg, OC()), repertoire: (v) => repertoireView(v, OC()),
  test: (v) => testView(v, C), results: (v, a) => resultsView(v, C, a), profile: (v) => profileView(v, C), practice: (v, arg) => practiceView(v, arg, C) };
let tab = "home";
const sectionOf = (t) => Object.keys(SECTIONS).find((k) => SECTIONS[k].tabs.some(([x]) => x === t)) || "home";
const lastTab = {};
function renderNav() {
  const sec = sectionOf(tab); lastTab[sec] = tab;
  $("#sections").innerHTML = Object.entries(SECTIONS).map(([k, s]) => `<button data-sec="${k}" class="${k === sec ? "active" : ""}" ${k === sec ? 'aria-current="page"' : ""}>${icon(k)}<span>${s.label}</span></button>`).join("");
  document.querySelectorAll("#sections button").forEach((b) => (b.onclick = () => go(lastTab[b.dataset.sec] || SECTIONS[b.dataset.sec].tabs[0][0])));
  const tabs = SECTIONS[sec].tabs;
  $("#tabs").innerHTML = tabs.length > 1 ? tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? "active" : ""}">${l}</button>`).join("") : "";
  document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => go(b.dataset.tab)));
  $("#pageTitle").textContent = TITLES[tab] ?? "";
}
window.__ccGo = (t, a) => go(t, a);
// sticky offsets follow the real height of the top bar and the sub-tabs (the top bar can grow on small phones)
function measureBars() {
  const r = document.documentElement.style;
  r.setProperty("--hdr", $(".topbar").offsetHeight + "px");
  r.setProperty("--sub", ($("#tabs").offsetHeight || 0) + "px");
}
if (window.ResizeObserver) { const ro = new ResizeObserver(measureBars); ro.observe($(".topbar")); ro.observe($("#tabs")); }
window.addEventListener("resize", measureBars);
function go(t, arg) {
  tab = t;
  const v = $("#view"); v.innerHTML = "";
  if (!P() && t !== "home" && t !== "openings") { tab = "home"; renderNav(); home(v); return renderPicker(); }
  renderNav();
  viewGen++;
  if (engine) engine.cancel(); // drop engine work that belonged to the previous page
  const fail = (e) => {
    console.error(e);
    // never loop: on Home itself, offer a way out instead of another "Back to Home"
    const p = P();
    v.innerHTML = `<div class="card"><h2>Something went wrong</h2><p style="color:var(--bad)">${esc(e.message || e)}</p>
      ${t === "home" && p ? `<p class="small">Part of ${esc(p.name)}'s data seems damaged. Download a backup first, then reset the analysed games and reports (your profile, notes, tests and log are kept).</p>
        <div class="row"><button class="btn secondary" id="errBk">Download backup</button><button class="btn danger" id="errReset">Reset games &amp; reports</button></div>`
      : `<div class="row"><button class="btn" id="errHome">Back to Home</button></div>`}</div>`;
    if ($("#errHome")) $("#errHome").onclick = () => go("home");
    if ($("#errBk")) $("#errBk").onclick = () => download(`chess-coach-backup-${today()}.json`, JSON.stringify(S, null, 1), "application/json");
    if ($("#errReset")) $("#errReset").onclick = () => { if (!confirm(`Remove ${p.name}'s analysed games, reports and puzzles?`)) return; p.games = {}; p.reports = []; p.puzzles = {}; save(); go("home"); };
  };
  // every page renders into its own container: late async work of a previous page writes into a detached node
  const root = document.createElement("div"); v.appendChild(root);
  try { Promise.resolve(views[t](root, arg)).catch(fail); } catch (e) { fail(e); }
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
  const dueEg = endgamesFor(p).filter((e) => { const s = p.endgames[e.id]; return !s || s.due <= today(); }).length;
  const last = p.reports[0];
  const nG = Object.keys(p.games).length;
  const tests = (p.tests || []).filter((t) => t.done);
  const st = currentStyle(p, C);
  const stepsDef = [["Profile", !!p.name, "account"], ["Accounts", !!(p.lichess || p.chesscom), "account"], ["Load games", nG > 0, "games"], ["Report", (p.reports || []).length > 0, "report"], ["Training", Object.keys(p.practice || {}).length > 0 || Object.values(p.puzzles).some((x) => x.attempts), "training"], ["Test", tests.length > 0, "test"]];
  const nDone = stepsDef.filter((x) => x[1]).length;
  const todo = (ic, title, sub, count, go_, label) => `<div class="todo"><div class="ic">${icon(ic)}</div><div><b>${title}</b><span class="small">${sub}</span></div><div class="row" style="gap:12px">${count ? `<span class="count">${count}</span>` : ""}<button class="btn ${count ? "" : "secondary"} small" data-go="${go_}">${label}</button></div></div>`;
  v.innerHTML = `<div class="hello"><div><div class="who">${new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening"},</div><h1 style="margin:0;font-size:34px;font-weight:780">${esc(p.name)}</h1></div>
      <div class="rating"><b>${playerElo(p)}</b>rating${st ? ` · ${esc(st.typeName)}` : ""}</div></div>
    <div class="card"><h2>Today</h2><div class="today">
      ${todo("puzzle", "Puzzles from your games", duePz ? "Your own mistakes, repeated at spaced intervals" : nG ? "Nothing due. Come back tomorrow" : "Import games first: your mistakes become puzzles", duePz, nG ? "puzzles" : "games", duePz ? "Solve" : nG ? "Open" : "Import")}
      ${todo("king", "Endgames to review", "Theory positions you play out against the engine", dueEg, "endgames", "Train")}
      ${todo("test", tests.length ? "Thinking test" : "Take the thinking test", tests.length ? (() => { const lt = tests[tests.length - 1]; const rated = lt.items.some((i) => i.kind !== "style" && i.rating); return `Last test ${esc(lt.date)}: ${rated ? `test rating ${lt.result?.overall ?? "–"}` : `${lt.items.length} style positions`}`; })() : "Measures calculation depth, style and player type", null, tests.length ? "results" : "test", tests.length ? "Results" : "Start")}
      ${todo("analyse", "Your games", nG ? `${nG} games analysed${last ? `, last report ${esc(last.date)}` : ""}` : "Load the last months from Lichess or Chess.com", null, "games", nG ? "Import new" : "Import")}
      ${todo("openings", "Openings", st ? `Ideas, strengths and weak sides, with what fits a ${esc(st.typeName.toLowerCase())}` : "Ideas, strengths and weak sides of 36 openings", null, "openings", "Browse")}
    </div></div>
    <div class="card"><h2>Next steps</h2>${nextStepsHtml(p)}</div>
    ${nDone < stepsDef.length ? `<div class="card"><h2>Getting started</h2><p class="small muted">${nDone} of ${stepsDef.length} done</p><div class="progress">${stepsDef.map(([, d]) => `<span class="${d ? "done" : ""}"></span>`).join("")}</div>
      <div class="steps" style="margin-top:12px">${stepsDef.map(([l, d, t], i) => `<button class="step ${d ? "done" : ""}" data-go="${t}"><div class="n">${i + 1}</div>${l}</div>`).join("")}</button></div>` : ""}`;
  v.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
  bindNextSteps(v, p);
}
function account(v) {
  const p = P();
  v.innerHTML = `<div class="card"><h2>${esc(p.name)}</h2><p class="small muted">The usernames let the app download your games. Rating is used when there are no games yet.</p>${profileForm(p)}
      <div class="row" style="margin-top:14px"><button class="btn" id="saveP">Save profile</button></div></div>
    <div class="card" id="aiCardA"></div>
    <div class="card"><h2>Lichess token (opening book statistics)</h2><p class="small muted">The opening book works without it. With a free personal Lichess token it also shows how often each move is played and how it scores, in master games and in Lichess games of 1800+ players. Create one (no permissions needed) at <a href="https://lichess.org/account/oauth/token/create?description=Chess%20Coach%20explorer" target="_blank" rel="noopener">lichess.org → API access tokens</a> and paste it here. It stays in this browser only and is not included in backups.</p>
      <div class="row"><input id="lit" class="grow" placeholder="${lichessToken() ? "•••••••• (saved)" : "lip_…"}" autocomplete="off"><button class="btn" id="litSave">Save</button>${lichessToken() ? '<button class="btn secondary" id="litDel">Remove</button>' : ""}</div><div id="litMsg" class="small" style="margin-top:6px"></div></div>
    <div class="card"><h2>Delete player</h2><p class="small muted">Removes ${esc(p.name)} and all games, puzzles, tests and notes from this browser. Make a backup first (Home → Log &amp; backup).</p><button class="btn danger" id="delP">Delete ${esc(p.name)}</button></div>`;
  aiSettings(v.querySelector("#aiCardA"));
  $("#litSave").onclick = () => { const t = $("#lit").value.trim(); if (!t) { $("#litMsg").textContent = "Paste your Lichess token in the field first."; return; } setLichessToken(t); toast("Lichess token saved"); go("account"); };
  if ($("#litDel")) $("#litDel").onclick = () => { setLichessToken(""); toast("Lichess token removed"); go("account"); };
  $("#saveP").onclick = () => { const d = readProfile(v); if (!d.name) return toast("Fill in a name"); Object.assign(p, d); save(); renderPicker(); v.querySelector("h2").textContent = p.name; toast("Profile saved"); };
  $("#delP").onclick = () => { if (confirm(`Delete ${p.name} and all their data?`)) {
      const q = loadQueue(); if (q?.player === p.id) { if (running) running.stop = true; saveQueue(null); $("#jobBar").classList.add("hidden"); }
      delete S.players[p.id]; S.current = Object.keys(S.players)[0] || null; save(); go("home"); } };
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
  $("#addStep", v).onclick = () => { const t = $("#newStep", v).value.trim(); if (!t) { toast("Type a step first"); $("#newStep", v).focus(); return; } p.nextSteps.push({ text: t, done: false }); save(); go(tab); };
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
      <label class="f">Analysis depth<select id="speed"><option value="80">Fast (≈ depth 12-14)</option><option value="150" selected>Normal (≈ depth 14-16)</option><option value="400">Deep (≈ depth 17-19)</option></select></label>
    </div>
    <div id="pgnBox" class="hidden" style="margin-top:10px"><textarea id="pgnText" placeholder="Paste PGN here (one or more games)…"></textarea>
      <div class="row" style="margin-top:6px"><input type="file" id="pgnFile" accept=".pgn,.txt"><label class="f" style="flex-direction:row;align-items:center;gap:6px">Your name in the PGN <input id="pgnName" value="${esc(p.pgnName || p.lichess || p.chesscom || "")}"></label></div></div>
    <label class="row small" style="margin-top:10px"><input type="checkbox" id="corr"> Also include correspondence games from Lichess and Chess.com (daily)</label>
    <label class="row small" style="margin-top:6px"><input type="checkbox" id="reanalyse"> Re-analyse games that are already loaded (needed for the style statistics on games from before this update)</label>
    <div class="row" style="margin-top:12px"><button class="btn" id="go">Load & analyse</button></div>
    <div id="prog" class="hidden" style="margin-top:12px"><div class="small" id="progText"></div><div class="bar" style="margin-top:6px"><div id="progBar"></div></div></div>
    <p class="small muted"><b>On your phone:</b> keep the app open. The screen stays on during the analysis (it won't lock by itself). If it does lock or the app closes, the analysis picks up where it stopped as soon as you open the app again. For many games, a computer is faster.</p>
    <p class="small muted">"Time control at least 10+0" counts a game as base time + 40 × increment, so 8+2 also qualifies. Already-analysed games are skipped, so you can safely stop and continue later. Lichess games with a server analysis go much faster.</p></div>
    <div class="card"><h2>Analysed games (${list.length})</h2>${list.length ? `<div class="scroll"><table><tr><th>Date</th><th>Opponent</th><th>Colour</th><th>Result</th><th>Accuracy</th><th>Errors</th><th>Depth</th><th>Opening</th></tr>
    ${list.map((g) => { const opp = g.color === "w" ? g.black : g.white; const res = g.score === 1 ? "win" : g.score === 0 ? "loss" : "draw";
      const e = (l) => g.errors.filter((x) => x.label === l).length;
      return `<tr><td>${esc(g.date)}</td><td>${g.site && g.site.startsWith("http") ? `<a href="${esc(g.site)}" target="_blank" rel="noopener">${esc(opp)}</a>` : esc(opp)} <span class="muted small">${esc(g.opponentElo || "")}</span></td><td>${g.color === "w" ? "White" : "Black"}</td><td>${res}</td><td>${g.accuracy ?? "–"}</td><td><span class="pill blunder">${e("blunder")}</span><span class="pill mistake">${e("mistake")}</span></td><td class="small">${g.usedPgnEvals ? "Lichess" : g.depth ?? "–"}</td><td class="small">${esc(g.opening)}</td></tr>`; }).join("")}</table></div>
    <div class="row" style="margin-top:10px"><button class="btn secondary" id="clearG">Delete all games</button></div>` : `<p class="muted">No games yet.</p>`}</div>`;
  const srcP = $("#srcP");
  srcP.onchange = () => $("#pgnBox").classList.toggle("hidden", !srcP.checked);
  srcP.onchange();
  $("#pgnFile").onchange = async (e) => { const f = e.target.files[0]; if (f) $("#pgnText").value = await f.text(); };
  $("#go").onclick = () => runImport(v);
  const pq = loadQueue();
  if (running) { $("#prog").classList.remove("hidden"); }
  else if (pq && pq.items?.length) { $("#prog").classList.remove("hidden"); $("#progText").innerHTML = `Paused analysis: ${pq.items.length} game${pq.items.length === 1 ? "" : "s"} left. <a href="#" id="resumeQ">Continue</a> · <a href="#" id="dropQ">Cancel</a>`;
    $("#resumeQ").onclick = (e) => { e.preventDefault(); processQueue(pq); }; $("#dropQ").onclick = (e) => { e.preventDefault(); saveQueue(null); $("#jobBar").classList.add("hidden"); go("games"); }; }
  if ($("#clearG")) $("#clearG").onclick = () => { if (confirm("Delete all analysed games for this player? (Puzzles and log are kept.)")) { p.games = {}; save(); go("games"); } };
}

function mostFrequentName(pgns) { const c = {}; for (const x of pgns) for (const t of ["White", "Black"]) { const m = new RegExp(`\\[${t} "([^"]+)"`).exec(x); if (m) c[m[1]] = (c[m[1]] || 0) + 1; } return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || ""; }
const tcEstimate = (tc) => { const m = /^(\d+)(?:\+(\d+))?$/.exec(tc || ""); return m ? +m[1] + 40 * +(m[2] || 0) : null; };
async function fetchGames(p, opts, status) {
  const out = [];
  const since = Date.now() - opts.months * 30.4 * 86400000;
  if (opts.lichess && p.lichess) {
    status("Fetching games from Lichess…");
    const q = new URLSearchParams({ max: opts.num * 2, since: Math.floor(since), clocks: "true", evals: "true", opening: "true", perfType: (opts.mintc >= 600 ? "rapid,classical" : "blitz,rapid,classical") + (opts.corr ? ",correspondence" : "") });
    const r = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(p.lichess)}?${q}`, { headers: { Accept: "application/x-chess-pgn" } });
    if (!r.ok) throw new Error(`Lichess answered ${r.status}. Is the username correct?`);
    for (const pgn of splitPgn(await r.text())) {
      const tc = (/\[TimeControl "([^"]+)"/.exec(pgn) || [])[1];
      if (tc === "-" || !tc) { if (!opts.corr) continue; }
      else { const est = tcEstimate(tc); if (est === null || est < opts.mintc) continue; }
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
      const mr = await fetch(arch[i]);
      if (!mr.ok) throw new Error(`Chess.com answered ${mr.status} for ${arch[i].slice(-7)}. Try again later, or choose a shorter period.`);
      let m; try { m = await mr.json(); } catch { throw new Error(`Chess.com sent an unreadable answer for ${arch[i].slice(-7)}. Try again later.`); }
      for (const g of (m.games || []).reverse()) {
        if (g.rules !== "chess" || !g.pgn) continue;
        if (g.time_class === "daily" && !opts.corr) continue;
        if ((g.end_time || 0) * 1000 < since) continue;
        if (g.time_class !== "daily") { const est = tcEstimate(g.time_control); if (est === null || est < opts.mintc) continue; }
        out.push({ pgn: g.pgn, name: p.chesscom, src: "chess.com" });
      }
    }
  }
  if (opts.pgn) {
    const pgns = splitPgn($("#pgnText").value);
    let name = $("#pgnName").value.trim();
    if (!name && pgns.length) name = mostFrequentName(pgns);
    if (name) { p.pgnName = name; save(); }
    for (const pgn of pgns) out.push({ pgn, name, src: "pgn" });
  }
  // newest first, capped
  const dateOf = (x) => ((/\[UTCDate "([^"]+)"/.exec(x.pgn) || /\[Date "([^"]+)"/.exec(x.pgn) || [])[1] || "");
  out.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  return out.slice(0, opts.num);
}

// ---- analysis job: a persisted queue, so it can resume after the phone locks or kills the app
const QKEY = "chesscoach.queue";
const loadQueue = () => { try { return JSON.parse(localStorage.getItem(QKEY)); } catch { return null; } };
function saveQueue(q) { try { if (q) localStorage.setItem(QKEY, JSON.stringify(q)); else localStorage.removeItem(QKEY); return true; } catch { return false; } }
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && "wakeLock" in navigator && document.visibilityState === "visible" && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => (wakeLock = null)); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { console.warn("Wake lock", e); }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && running) keepAwake(true); });
function jobUI(text, pct) {
  const b = $("#jobBar"); b.classList.remove("hidden");
  $("#jobText").textContent = text; if (pct !== undefined) $("#jobFill").style.width = pct.toFixed(1) + "%";
  const t = $("#progText"); if (t) { $("#prog").classList.remove("hidden"); t.textContent = text; if (pct !== undefined) $("#progBar").style.width = pct.toFixed(1) + "%"; }
}
// q given = paused job: keep the bar with a Resume button
function jobDone(text, q = null) {
  $("#jobBar").classList.remove("hidden");
  $("#jobText").textContent = text;
  const b = $("#jobStop"); b.textContent = "Resume"; b.classList.toggle("hidden", !q);
  const t = $("#progText"); if (t) t.textContent = text;
  if (!q) setTimeout(() => { if (!running) $("#jobBar").classList.add("hidden"); }, 6000);
}

async function runImport(v) {
  const p = P();
  if (running) return toast("An analysis is already running");
  const opts = { lichess: $("#srcL").checked, chesscom: $("#srcC").checked, corr: $("#corr").checked, pgn: $("#srcP").checked, months: +$("#months").value, mintc: +$("#mintc").value, num: +$("#num").value || 100 };
  const movetime = +$("#speed").value;
  const re = $("#reanalyse").checked;
  const src = [opts.lichess && "Lichess", opts.chesscom && "Chess.com", opts.pgn && "PGN"].filter(Boolean).join(" + ");
  $("#prog").classList.remove("hidden"); $("#go").disabled = true;
  try {
    if (!opts.lichess && !opts.chesscom && !opts.pgn) throw new Error("Choose at least one source.");
    const list = await fetchGames(p, opts, (t) => ($("#progText").textContent = t));
    if (!list.length) throw new Error("No games found for this period and time control.");
    const items = list.filter((x) => re || !p.games[gameKey(x.pgn)]);
    if (!items.length) { $("#progText").textContent = `${list.length} games found, all already analysed.`; return; }
    const q = { player: p.id, items, total: items.length, done: 0, added: 0, skipped: 0, movetime, src, started: new Date().toISOString() };
    if (!saveQueue(q)) toast("Couldn't save the queue (storage full): this analysis can't resume if the app gets closed.");
    $("#progText").textContent = `${list.length} games found, ${items.length} to analyse with ${engineCount()} engines in parallel. Estimated time: ~${Math.max(1, Math.round(items.length * movetime / 150 * 9 / 60 / engineCount()))} min.`;
    processQueue(q);
  } catch (e) {
    console.warn(e);
    const msg = e instanceof TypeError ? "Couldn't reach Lichess / Chess.com. Check your internet connection." : e.message || String(e);
    $("#progText").innerHTML = `<span style="color:var(--bad)">${esc(msg)}</span> · If downloading doesn't work, export the PGN from the website and paste it under 'PGN'.`;
  } finally { const g = $("#go"); if (g) g.disabled = false; }
}

// Several Stockfish workers in parallel (one game each): ~N× faster on multi-core devices.
const pool = [];
function engineCount() {
  const cores = navigator.hardwareConcurrency || 2;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  return Math.max(1, Math.min(mobile ? 3 : 6, cores - 1));
}
function enginePool(n) { while (pool.length < n) pool.push(Engine.browser()); return pool.slice(0, n); }

async function processQueue(q) {
  if (running) return;
  const p = S.players[q.player];
  if (!p) { saveQueue(null); return; }
  running = { stop: false }; q.paused = false; saveQueue(q);
  $("#jobStop").textContent = "Pause"; $("#jobStop").classList.remove("hidden");
  await keepAwake(true);
  const n = Math.min(engineCount(), q.items.length);
  jobUI(`Starting ${n} Stockfish engine${n > 1 ? "s" : ""}… (${q.items.length} games to go)`);
  const engines = enginePool(n);
  const t0 = Date.now(), doneAtStart = q.done;
  const progress = {}; const depths = [];
  const show = () => {
    const partial = Object.values(progress).reduce((a, x) => a + x, 0);
    const doneNow = q.done - doneAtStart, el = (Date.now() - t0) / 1000;
    const eta = doneNow ? Math.round(el / doneNow * q.items.length / 60) : null;
    const dep = depths.length ? Math.round(depths.reduce((a, b) => a + b, 0) / depths.length) : null;
    jobUI(`Analysing ${p.name}: ${q.done} of ${q.total} games done · ${n} engine${n > 1 ? "s" : ""}${dep ? ` · depth ≈${dep}` : ""}${eta !== null ? (eta < 1 ? " · less than a minute left" : ` · ~${eta} min left`) : ""}${wakeLock ? " · screen stays on" : ""}`, 100 * (q.done + partial) / q.total);
  };
  const inflight = new Set();
  const worker = async (eng, wi) => {
    await eng.ready;
    while (!running.stop) {
      const it = q.items.find((x) => !inflight.has(x)); if (!it) break;
      inflight.add(it);
      let r;
      try { r = await analyseGame(eng, it.pgn, it.name, { movetime: q.movetime }, (k, m) => { progress[wi] = k / m; show(); }); }
      catch (e) { console.warn("Game failed", e); r = { skipped: "parse error" }; }
      progress[wi] = 0;
      q.items.splice(q.items.indexOf(it), 1); inflight.delete(it); q.done++;
      if (r.skipped) q.skipped++;
      else { const link = (/\[Link "([^"]+)"/.exec(it.pgn) || [])[1]; if (link) { r.site = link; r.id = link; } p.games[r.id] = r; q.added++; if (r.depth) depths.push(r.depth); save(); }
      saveQueue(q); show();
    }
  };
  try {
    await Promise.all(engines.map((e, i) => worker(e, i)));
    if (running.stop && q.items.length) { // paused with games still to do (pausing during the last game just finishes)
      if (!S.players[q.player]) { saveQueue(null); jobDone("Analysis stopped."); return; }
      q.paused = true; saveQueue(q);
      if (q.added) buildReport(p);
      jobDone(`Paused: ${q.items.length} game${q.items.length === 1 ? "" : "s"} left.`, q);
      return;
    }
    saveQueue(null);
    for (const e of pool) e.terminate(); pool.length = 0; // free the extra workers
    const secs = Math.round((Date.now() - t0) / 1000);
    jobDone(`Done: ${q.added} game${q.added === 1 ? "" : "s"} analysed in ${secs < 60 ? secs + " s" : "~" + Math.round(secs / 60) + " min"}${q.skipped ? `, ${q.skipped} skipped (too short or the name didn't match)` : ""}.`);
    if (q.added) { buildReport(p); logEvent("analysis", `${q.added} game${q.added === 1 ? "" : "s"} analysed (${q.src}). Total ${Object.keys(p.games).length}.`); toast("Analysis done. See Report."); if (S.current === p.id && tab === "games") setTimeout(() => go("report"), 900); }
  } finally { running = null; keepAwake(false); }
}
function resumeBanner() {
  const q = loadQueue();
  if (!q || running) return;
  if (!S.players[q.player] || !q.items?.length) { saveQueue(null); return; }
  if (q.paused) { jobDone(`Analysis paused for ${S.players[q.player].name}: ${q.items.length} of ${q.total} games left.`, q); return; }
  jobUI(`Analysis interrupted for ${S.players[q.player].name}: ${q.items.length} of ${q.total} games left. Resuming…`, 100 * q.done / q.total);
  setTimeout(() => processQueue(q), 1500);
}

function buildReport(p) {
  const A = aggregate(Object.values(p.games));
  const D = diagnose(A, p);
  // seed puzzles from critical positions
  for (const e of A.critical) {
    // key includes the position: games without a unique Site header ("?") no longer overwrite each other
    const key = `${e.game}#${e.ply}#${e.fen.split(" ").slice(0, 2).join(" ")}`;
    if (!p.puzzles[key] && !Object.values(p.puzzles).some((x) => x.fen === e.fen && x.played === e.played)) p.puzzles[key] = { key, fen: e.fen, played: e.played, best: e.best, bestLine: e.bestLine, game: e.game, moveNo: e.moveNo, color: e.color, phase: e.phase, tags: e.tags, evalBefore: e.evalBefore, drop: e.drop, box: 0, due: today() };
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
    <div class="stat"><div class="v">${A.scorePct}%</div><div class="l">score: ${A.wins} won · ${A.draws} drawn · ${A.losses} lost</div></div>
    ${ph.map((x) => `<div class="stat"><div class="v">${A.phaseAcc[x]}</div><div class="l">${x} accuracy · ${A.seriousPer100[x]} errors/100 moves</div></div>`).join("")}
    <div class="stat"><div class="v">${A.conversion.chances ? Math.round(100 * A.conversion.won / A.conversion.chances) + "%" : "–"}</div><div class="l">won positions converted (${A.conversion.won}/${A.conversion.chances})</div></div>
    <div class="stat"><div class="v">${A.resilience.lost ? A.resilience.saved + "/" + A.resilience.lost : "–"}</div><div class="l">lost positions saved</div></div>
  </div>
  <details class="small" style="margin-top:8px"><summary><b>What do these numbers mean?</b></summary>
  <ul>
    <li><b>Score</b> = your points as a percentage: a win is 1 point, a draw ½, a loss 0, divided by the number of games. So it's not a win/loss ratio: draws count for half. 50% means you score as much as your opponents, which is normal when the matchmaking puts you against equally rated players.</li>
    <li><b>Accuracy</b> (0-100) = how close your moves are to Stockfish's best move, with the same formula as Lichess. Accuracy follows the win chance, so small inaccuracies in a balanced position cost more than in a position that's already won. Over a whole game, 90+ is very good, and 80-90 is normal for club level in rapid.</li>
    <li><b>Errors/100 moves</b> = mistakes + blunders per 100 of your own moves in that phase. A <b>blunder</b> costs at least 15% win chance, a <b>mistake</b> at least 10%, an <b>inaccuracy</b> at least 5% (Lichess thresholds).</li>
    <li><b>Converted / saved</b>: games where your win chance went above 85% (or below 15%), and how they ended.</li>
    <li><b>Analysis depth</b>: ${A.depth ? `Stockfish 19 (lite) looked on average <b>${A.depth} half-moves</b> deep per position` : "unknown for older games"}${A.serverAnalysed ? `; ${A.serverAnalysed} games reused the Lichess server analysis` : ""}. Depth 14-16 reliably finds mistakes and blunders at club level, and depth 18+ is roughly what Lichess uses for a quick server analysis.</li>
  </ul></details></div>
  ${phasesHtml(A.phases, Object.keys(p.games).length)}
  <div class="card"><h2>Strengths</h2>${D.strengths.map((s) => `<div class="list-item strong"><b>${esc(s.title)}</b><span class="small">${esc(s.evidence)}</span></div>`).join("")}</div>
  <div class="card"><h2>Points to work on</h2>${D.weaknesses.length ? D.weaknesses.map((w) => `<div class="list-item weak"><b>${esc(w.title)}</b><span class="small">${esc(w.evidence)}</span>
     ${w.drills ? `<ul class="small">${w.drills.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}${w.links && w.links.length ? `<div class="small">${w.links.map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${esc(t)}</a>`).join(" · ")}</div>` : ""}</div>`).join("") : `<p class="muted">No clear weak points. Analyse more games.</p>`}</div>
  <div class="card"><h2>Training plan: ${p.hours} h per week</h2>
    <p class="small muted">Based on GM Kuljasevic's study split (tactics 25 · endgames 25 · middlegame 20 · general 20 · openings 10), shifted toward your weak points. Change your hours per week under Home → Profile.</p>
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
  <div class="card"><h2>Next</h2><div class="row"><button class="btn" id="toTrain">Start training</button><button class="btn secondary" id="toProfile">Your style & player profile</button></div></div>
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
    (A.phases ? `Phases (Lichess division, win-chance change per phase): opening ${A.phases.phase.opening.avg}%, middlegame ${A.phases.phase.middlegame.avg ?? "-"}%, endgame ${A.phases.phase.endgame.avg ?? "-"}%. After the opening: ${A.phases.flow.afterOpening}% win chance; entering the endgame: ${A.phases.flow.afterMiddlegame ?? "-"}%. Most lost in the ${A.phases.weakest}.\n` : "") +
    `Analysed games: ${A.games}, score ${A.scorePct}%.\nAccuracy per phase: ${Object.entries(A.phaseAcc).map(([k, x]) => `${k} ${x} (${A.seriousPer100[k]} errors/100 moves)`).join(", ")}.\n` +
    `Error types: ${Object.entries(A.tags).map(([k, n]) => `${k}: ${n}`).join("; ")}.\nWinning positions converted: ${A.conversion.won}/${A.conversion.chances}; lost positions saved: ${A.resilience.saved}/${A.resilience.lost}.\n` +
    `Openings: ${A.openings.slice(0, 6).map((o) => `${o.color === "w" ? "W" : "B"} ${o.name} (${o.games}x, ${o.scorePct}%, win chance after move 10 ${o.wpAfter10 ?? "?"}${o.wpAfter10 != null ? "%" : ""})`).join("; ")}.\n` +
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
const MOD_LABEL = (c) => POS_GROUPS[c] || (c === "style" ? "Style positions" : c);
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
  const lastTest = (p.tests || []).filter((t) => t.done && Object.keys(t.result?.cats || {}).length).slice(-1)[0];
  if (lastTest?.result) Object.entries(lastTest.result.cats).sort((a, b) => a[1].rating - b[1].rating).slice(0, 3).forEach(([c]) => { if (!rec.includes(c)) rec.unshift(c); });
  const all = TAC_CATS.concat(Object.keys(POS_GROUPS)).concat(["style", "Deep calculation"]);
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
    <div class="card"><h2>All modules</h2><div class="scroll"><table>${all.map((c) => `<tr><td>${esc(MOD_LABEL(c))}</td><td class="small muted">${TAC_CATS.includes(c) || c === "Deep calculation" ? "tactical" : c === "style" ? "style" : "positional"}</td><td class="small">${prog(c)}</td><td><button class="btn secondary small" data-prac="${esc(c)}">Train</button></td></tr>`).join("")}</table></div></div>`;
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
  v.innerHTML = `<div class="two"><div><div id="pb"></div><div id="plb"></div><div class="row" style="margin-top:8px"><button class="btn" id="pCheck">Check my lines</button></div><div class="row" style="margin-top:8px"><button class="btn secondary" id="hint">Hint</button><button class="btn secondary" id="show">Show solution</button><button class="btn secondary" id="explore">Open on Board</button><button class="btn" id="next">Next</button></div>
    <div class="row" style="margin-top:8px"><button class="btn secondary" id="pRead">Read the position</button><button class="btn secondary" id="pSheet">Think sheet</button><button class="btn secondary" id="pWhy">Explain the solution</button></div>
    <div id="pWhyOut"></div>
    <div class="card hidden" id="pReadOut" style="margin-top:12px"></div><div class="card hidden" id="pSheetOut" style="margin-top:12px"></div></div>
    <div><div class="card"><h2>Your mistakes as puzzles</h2><div class="small muted">${due.length} due · ${all.length} total · ${known} known</div><div id="pinfo" style="margin-top:10px"></div><div id="pfb"></div></div>
    <div class="card"><h2>How it works</h2><p class="small">Every position comes from your own game, at the moment you went wrong. Put your move <b>and the line you expect</b> on the board: the pieces stay where they are, every move is written down. A move for the other side starts an extra line (another defence or another idea). Press <b>Check my lines</b> and Stockfish judges your main line (★) and the extra lines. Find the best move. Get it right and you'll see it again after 1, 3, 7, 21 and 60 days. Get it wrong and it comes back tomorrow. Ask yourself first: <b>what does my opponent threaten, and what checks, captures and threats do I have?</b></p></div></div></div>`;
  const brd = new Board($("#pb"), { orientation: "w" });
  let cur = null, idx = 0, solved = false, tries = 0, lb = null;
  const lock = () => { if (lb) { lb.destroy(); lb = null; $("#plb").innerHTML = ""; } brd.locked = true; $("#pCheck").disabled = true; };
  const show = () => {
    cur = due[idx]; solved = false; tries = 0; $("#pfb").innerHTML = "";
    if (!cur) { $("#pinfo").innerHTML = `<div class="feedback ok">No more puzzles due today. Well done! Come back tomorrow, or practise endgames.</div>`; lock(); return; }
    brd.locked = false; brd.setFen(cur.fen); brd.setOrientation(cur.fen.split(" ")[1]);
    if (lb) lb.destroy();
    lb = new LineBuilder({ board: brd, rootFen: cur.fen, el: $("#plb"), esc }); $("#pCheck").disabled = false;
    // think-time: let the engine already evaluate the position and the best move
    getEngine().cancel();
    analyseMemo(cur.fen, { movetime: 900 }).then(([b]) => { if (b?.pv[0]) { const c = new Chess(cur.fen); try { c.move({ from: b.pv[0].slice(0, 2), to: b.pv[0].slice(2, 4), promotion: b.pv[0][4] }); if (!c.isGameOver()) analyseMemo(c.fen(), { movetime: 900 }); } catch {} } });
    const side = cur.fen.split(" ")[1] === "w" ? "White" : "Black";
    $("#pinfo").innerHTML = `<b>Move ${cur.moveNo}, you're ${side}</b> (${esc(cur.phase)}). Eval before your move: ${Math.abs(cur.evalBefore) >= 90 ? (cur.evalBefore > 0 ? "a forced mate for you" : "you are getting mated") : (cur.evalBefore > 0 ? "+" : "") + cur.evalBefore}.<br><span class="small muted">${cur.played === "?" ? "Your own position: find the best move." : `In the game you played <b>${esc(cur.played)}</b>${cur.game && cur.game.startsWith("http") ? ` · <a href="${esc(cur.game)}" target="_blank" rel="noopener">game</a>` : ""}. Find a better move.`}</span>`;
    $("#pReadOut").classList.add("hidden"); $("#pSheetOut").classList.add("hidden"); $("#pWhyOut").innerHTML = "";
  };
  $("#pCheck").onclick = async () => {
    if (!cur || solved || !lb) return;
    const main = lb.lines[lb.main];
    if (!main || !main.moves.length) { $("#pfb").innerHTML = `<div class="feedback info">Put at least your first move on the board.</div>`; return; }
    const btn = $("#pCheck"); btn.disabled = true; tries++;
    $("#pfb").innerHTML = `<div class="feedback info">Stockfish is checking your lines…</div>`;
    const first = main.moves[0];
    const g = await gradeMove(cur.fen, first.uci);
    const ok = g.drop < 5 || first.san === cur.best;
    let lineHtml = "";
    if (main.moves.length >= 2) {
      const r = await checkLine(gradeMove, cur.fen, main.moves, { ms: 400, maxPlies: 8 });
      lineHtml += `<p class="small" style="margin-top:6px"><b>Your main line</b> ${esc(fmtLine(cur.fen, main.moves))}: ${r.stopped !== null ? "breaks down" : r.holds ? "holds up ✓" : "partly OK"}<br>${esc(r.notes.join(" · "))}</p>`;
    }
    const sides = lb.sideLines();
    if (sides.length || main.moves.length) {
      try { const rep = await sideReport({ gradeMove, eng: getEngine(), root: cur.fen, main: main.moves, sides, ms: 400 }); lineHtml += sideReportHtml(rep, esc, cur.fen, main.moves); } catch (e) { console.warn(e); }
    }
    if (ok) {
      solved = true; srs(cur, tries === 1);
      $("#pfb").innerHTML = `<div class="feedback ok"><b>${esc(first.san)}: correct!</b> ${tries > 1 ? "(on attempt " + tries + ")" : ""}<br><span class="small">Engine line: ${esc(g.bestLine)}</span>${lineHtml}</div>${tagHelp(cur)}`;
      logEvent("puzzle", `Puzzle (move ${cur.moveNo}) ${tries === 1 ? "solved" : "solved on attempt " + tries}`); lock();
    } else {
      $("#pfb").innerHTML = `<div class="feedback no"><b>${esc(first.san)}</b> isn't it (you lose ${g.drop.toFixed(0)}% win chance: ${esc(g.verdict)}). ${tries < 2 ? "Change your lines and check again." : "Look at the solution."}${lineHtml}</div>`;
      if (tries >= 2) { srs(cur, false); solved = true; logEvent("puzzle", `Puzzle (move ${cur.moveNo}) not solved`); lock(); } else btn.disabled = false;
    }
    save();
  };
  $("#hint").onclick = () => { if (!cur) return; const m = new Chess(cur.fen).move(cur.best); $("#pfb").innerHTML = `<div class="feedback info">Hint: look at your ${pieceName(m.piece)}${m.captured ? " (it can capture something)" : ""}${m.san.includes("+") ? ", with check" : ""}.</div>`; };
  $("#show").onclick = () => { if (!cur) return; const m = new Chess(cur.fen).move(cur.best); lock(); brd.setFen(cur.fen); brd.setArrows([{ from: m.from, to: m.to }]); if (!solved) { srs(cur, false); save(); solved = true; } $("#pfb").innerHTML = `<div class="feedback info">Solution: <b>${esc(cur.best)}</b>, line ${esc(cur.bestLine)}</div>${tagHelp(cur)}`; brd.locked = true; };
  $("#explore").onclick = () => cur && go("board", { fen: cur.fen });
  $("#next").onclick = () => { idx++; show(); };
  $("#pWhy").onclick = async () => {
    if (!cur) return; const out = $("#pWhyOut"); const m = new Chess(cur.fen).move(cur.best);
    out.innerHTML = `<div class="feedback info small">Stockfish is working out why ${esc(cur.best)} is the move…</div>`;
    const sheet = $("#pSheetOut"); const notes = sheet && !sheet.classList.contains("hidden") ? [...sheet.querySelectorAll("textarea, input")].map((x) => x.value).join(" ") : "";
    try { out.innerHTML = explainHtml(await explainMove(getEngine(), cur.fen, m.from + m.to + (m.promotion || ""), notes, ""), esc); } catch (e) { out.innerHTML = ""; console.warn(e); }
    if (!solved) { srs(cur, false); save(); solved = true; lock(); }
  };
  $("#pRead").onclick = () => { if (!cur) return; const o = $("#pReadOut"); o.classList.toggle("hidden"); if (!o.classList.contains("hidden")) o.innerHTML = `<h2>Read the position</h2>` + readerHtml(cur.fen); };
  $("#pSheet").onclick = () => { if (!cur) return; const o = $("#pSheetOut"); o.classList.toggle("hidden"); if (!o.classList.contains("hidden")) thinkSheet(o, () => cur.fen, { source: "puzzle", title: `Puzzle: move ${cur.moveNo}${cur.game ? " (" + cur.game.split("/").pop() + ")" : ""}` }); };
  show();
}
function tagHelp(pz) { const t = (pz.tags || []).filter((x) => TAG_ADVICE[x]); return t.length ? `<div class="small" style="margin-top:6px">Type of mistake: ${t.map((x) => `<span class="pill">${esc(x)}</span>`).join("")}<br><span class="muted">${esc(TAG_ADVICE[t[0]].why)}</span></div>` : ""; }
const pieceName = (p) => ({ p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" }[p]);

// Remembers analyses (per engine generation, so cancelled work is never reused), so positions that were
// looked at in the background while you think don't have to be analysed again.
const memo = new Map();
function analyseMemo(fen, opts) {
  const eng = getEngine(); const k = `${eng.gen}|${fen}|${opts.movetime}|${opts.multipv || 1}`;
  if (!memo.has(k)) { if (memo.size > 300) memo.clear(); memo.set(k, eng.analyse(fen, opts)); }
  return memo.get(k);
}
async function gradeMove(fen, uci, movetime = 900) {
  const eng = { analyse: analyseMemo };
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
const allEndgames = (p) => ENDGAMES.concat((p.customEndgames || []).map((c) => ({ r: 0, opp: "", hint: "", ...c })));
// the endgames that fit the player: from about 400 below their rating (own positions always), unless "show easier" is on
const endgamesFor = (p) => { const elo = playerElo(p); return allEndgames(p).filter((e) => p.settings.egEasy || !e.r || e.r >= elo - 400 || e.level === "Own position").sort((a, b) => (a.r || 9999) - (b.r || 9999)); };
function endgames(v, arg) {
  const p = P();
  const list = endgamesFor(p);
  const hidden = allEndgames(p).length - list.length;
  v.innerHTML = `<div class="two"><div><div id="eb"></div>
      <div class="row" style="margin-top:8px"><button class="btn secondary" id="reset">Restart</button><button class="btn secondary" id="hint">Hint</button><button class="btn" id="nextEg">Next endgame</button><button class="btn secondary" id="toBoard">Open on Board</button></div></div>
    <div><div class="card" id="epanel"></div>
      <div class="card"><h2>Positions for your level</h2><p class="small muted">Chosen for a rating of about ${playerElo(p)}.${hidden ? ` ${hidden} easier position${hidden > 1 ? "s are" : " is"} hidden.` : ""} <label class="row small" style="display:inline-flex;margin-left:6px"><input type="checkbox" id="egEasy" ${p.settings.egEasy ? "checked" : ""}> show easier positions</label></p>
      <div class="scroll"><table><tr><th>Position</th><th>Level</th><th>Status</th></tr>
      ${list.map((e) => { const s = p.endgames[e.id]; const st = !s ? "new" : (s.box || 0) >= 4 ? "known" : "learning"; const due = !s || s.due <= today();
        return `<tr><td><a href="#" data-eg="${e.id}">${esc(e.theme)}</a><div class="small muted">${esc(e.level || "")}</div></td><td class="small">${e.r ? "≈" + e.r : "own"}</td><td><span class="pill ${st === "known" ? "good" : st === "learning" ? "inaccuracy" : ""}">${st}</span>${due && s ? ' <span class="pill mistake">review</span>' : ""}</td></tr>`; }).join("")}</table></div>
      <p class="small muted">Positions with up to 7 pieces are played with the Lichess tablebases: perfect play, and the computer picks the move that is hardest for you. Add your own positions from the Board ("Add as endgame drill").</p></div></div></div>`;
  $("#egEasy").onchange = (e) => { p.settings.egEasy = e.target.checked; save(); go("endgames", { id: cur?.id }); };
  const brd = new Board($("#eb"));
  let cur = null, moves = 0, over = false, attempt = 0, hints = 0;
  const panel = $("#epanel");
  const start = async (e) => {
    attempt++; getEngine().cancel(); // a Restart drops whatever the engine was still doing for the old attempt
    cur = e; moves = 0; over = false; hints = 0;
    brd.setFen(e.fen); brd.setOrientation(e.side); brd.locked = true; brd.setArrows([]);
    const goalTxt = e.goal === "win" ? `Win with ${e.side === "w" ? "White" : "Black"}${e.limit ? ` within ${e.limit} moves` : ""}` : `Hold the draw with ${e.side === "w" ? "White" : "Black"}`;
    panel.innerHTML = `<h2>${esc(e.theme)}</h2><div class="small muted">${esc(e.level || "")}${e.r ? ` · ≈${e.r}` : ""}</div>
      <p><b>Task:</b> ${goalTxt}.</p>${e.opp ? `<p class="small"><b>What the computer tries:</b> ${esc(e.opp)}</p>` : ""}
      ${e.question ? `<div id="q"><p><b>First, a question:</b> ${esc(e.question.prompt)}</p><div class="row">${e.question.options.map((o) => `<button class="btn secondary" data-a="${esc(o)}">${esc(o)}</button>`).join("")}</div></div>` : ""}
      <div id="efb"></div><div id="hintBox"></div><div id="src" class="small muted"></div>`;
    panel.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => {
      const ok = b.dataset.a === e.question.answer;
      $("#q").innerHTML = `<div class="feedback ${ok ? "ok" : "no"}">${ok ? "Correct" : "Not quite"}: ${esc(e.question.answer)}. ${esc(e.idea)}</div>`;
      begin();
    }));
    probe(e.fen).then((t) => { if (cur === e) $("#src").textContent = t ? "Perfect play: Lichess tablebase." : "Played by Stockfish (more than 7 pieces, or the tablebase can't be reached)."; });
    if (!e.question) begin();
  };
  const begin = async () => {
    const my = attempt;
    if (brd.chess.turn() !== cur.side) { brd.locked = true; $("#efb").innerHTML = `<div class="feedback info">The computer moves first…</div>`; await engineReply(); if (my !== attempt) return; }
    if (!over) $("#efb").innerHTML = `<div class="feedback info">Your move.</div>`;
    brd.locked = over;
  };
  // the computer's move: tablebase (most testing move) when possible, otherwise Stockfish
  const engineReply = async () => {
    const my = attempt; const fen = brd.fen();
    const t = await testingMove(fen);
    if (my !== attempt || brd.fen() !== fen) return;
    if (t) brd.play(t.move.uci);
    else { const [l] = await getEngine().analyse(fen, { movetime: 700 }); if (my !== attempt || brd.fen() !== fen) return; if (l && l.pv[0]) brd.play(l.pv[0]); }
    checkEnd();
  };
  const finish = (ok, msg) => {
    over = true; brd.locked = true;
    const clean = ok && hints < 2;
    const s = (p.endgames[cur.id] ||= {}); srs(s, clean); save();
    logEvent("endgame", `${cur.theme}: ${ok ? "succeeded" : "failed"}${ok && hints ? ` (with ${hints} hint${hints > 1 ? "s" : ""})` : ""} (${moves} move${moves === 1 ? "" : "s"})`);
    $("#efb").innerHTML = `<div class="feedback ${ok ? "ok" : "no"}"><b>${ok ? "Well done!" : "Not this time."}</b> ${esc(msg)}${ok && hints >= 2 ? " (You used hints, so it comes back sooner.)" : ""}${ok ? "" : "<br>" + esc(cur.idea)}</div>`;
    $("#hintBox").innerHTML = "";
  };
  const checkEnd = () => {
    const c = brd.chess;
    if (c.isCheckmate()) { const youWon = c.turn() !== cur.side; finish(youWon && cur.goal === "win", youWon ? "Checkmate!" : "You were mated."); return true; }
    if (c.isDraw()) { finish(cur.goal === "draw", cur.goal === "draw" ? "Draw: held." : "It's a draw, but the position was winning."); return true; }
    return false;
  };
  // hint 1: the idea · hint 2: which piece · hint 3: the move itself
  $("#hint").onclick = async () => {
    if (!cur || over) return;
    hints++;
    const box = $("#hintBox");
    if (hints === 1) { box.innerHTML = `<div class="feedback info small"><b>Idea:</b> ${esc(cur.idea)}${cur.hint ? `<br><b>Hint:</b> ${esc(cur.hint)}` : ""}</div>`; return; }
    if (brd.chess.turn() !== cur.side) return;
    box.innerHTML = `<div class="feedback info small">Looking…</div>`;
    const fen = brd.fen(); const t = await probe(fen);
    let uci = null;
    if (t?.moves?.length) { const best = Math.max(...t.moves.map(moveScore)); uci = t.moves.find((m) => moveScore(m) === best).uci; }
    else { const [l] = await getEngine().analyse(fen, { movetime: 800 }); uci = l?.pv[0] || null; }
    if (!uci || brd.fen() !== fen) { box.innerHTML = ""; return; }
    const pc = brd.chess.get(uci.slice(0, 2)); const names = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
    if (hints === 2) box.innerHTML = `<div class="feedback info small"><b>Hint 2:</b> move your <b>${names[pc?.type] || "piece"}</b> (on ${uci.slice(0, 2)}).</div>`;
    else { box.innerHTML = `<div class="feedback info small"><b>Hint 3:</b> the arrow shows a move that keeps the ${cur.goal === "win" ? "win" : "draw"}.</div>`; brd.setArrows([{ from: uci.slice(0, 2), to: uci.slice(2, 4) }]); }
  };
  brd.onMove = async (mv, before) => {
    if (!cur || over) return;
    const my = attempt;
    brd.locked = true; moves++; brd.setArrows([]);
    if (checkEnd()) return;
    const uci = mv.from + mv.to + (mv.promotion || "");
    $("#efb").innerHTML = `<div class="feedback info">…</div>`;
    const tg = await gradeTB(before, uci);
    if (my !== attempt) return;
    let note = "";
    if (tg) {
      if (!tg.ok) { finish(false, `${mv.san} throws away the ${tg.before} (after it the position is a ${tg.after === "loss" ? "loss" : tg.after} for you). Moves that kept it: ${tg.good.slice(0, 5).join(", ")}.`); brd.setArrows([{ from: tg.bestUci.slice(0, 2), to: tg.bestUci.slice(2, 4) }]); return; }
      note = "✓ keeps the " + tg.before;
      const pieceCount = brd.fen().split(" ")[0].replace(/[^a-zA-Z]/g, "").length;
      // won and simplified to a basic mate (K+Q/K+R vs K) for a player above that level: done
      if (cur.goal === "win" && tg.before === "win" && pieceCount <= 3 && (cur.r || 0) >= 1200 && !brd.chess.isCheckmate()) { finish(true, "You reached a basic won ending (king and major piece against the king)."); return; }
      if (cur.goal === "win" && mv.promotion && pieceCount <= 4) { finish(true, "Promoted, and the tablebase says it's winning."); return; }
    } else if (cur.grade !== "theory") {
      const g = await gradeMove(before, uci, 500);
      if (my !== attempt) return;
      const yourCp = g.afterCp;
      if (cur.goal === "win" && g.bestCp > 300 && yourCp < 150) { finish(false, `${mv.san} lets the win slip (${g.verdict}). Best was ${g.bestLine.split(" ")[0]}.`); brd.setArrows([{ from: g.bestUci.slice(0, 2), to: g.bestUci.slice(2, 4) }]); return; }
      if (cur.goal === "draw" && yourCp < -300 && g.bestCp > -150) { finish(false, `${mv.san} loses (${g.verdict}). Best was ${g.bestLine.split(" ")[0]}.`); return; }
      if (cur.goal === "win" && mv.promotion && yourCp > 500) { finish(true, `Promoted, and the position is winning (${(yourCp / 100).toFixed(1)}).`); return; }
      note = g.verdict === "best" || g.verdict === "good" ? "✓ good move" : g.verdict;
    }
    if (cur.goal === "draw" && moves >= 20) { finish(true, "20 moves held. The draw is safe."); return; }
    if (cur.goal === "win" && !cur.limit && moves >= 60) { finish(false, "60 moves and still no win: the position stays winning, but look for the faster plan (see the idea)."); return; }
    if (cur.limit && moves >= cur.limit) { finish(false, `${cur.limit} moves without mate.`); return; }
    $("#efb").innerHTML = `<div class="feedback info">Move ${moves}${note ? ` · ${esc(note)}` : ""}. The computer is thinking…</div>`;
    await engineReply();
    if (my !== attempt) return;
    if (!over) { brd.locked = false; $("#efb").innerHTML = `<div class="feedback info">Move ${moves}${note ? ` · ${esc(note)}` : ""}. Your move.</div>`; }
  };
  $("#reset").onclick = () => cur && start(cur);
  $("#nextEg").onclick = () => { const i = list.indexOf(cur); const nxt = list.slice(i + 1).find((e) => { const s = p.endgames[e.id]; return !s || s.due <= today(); }) || list[(i + 1) % list.length]; start(nxt); window.scrollTo(0, 0); };
  $("#toBoard").onclick = () => go("board", { fen: brd.fen() });
  v.querySelectorAll("[data-eg]").forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); start(list.find((x) => x.id === a.dataset.eg)); window.scrollTo(0, 0); }));
  const first = (arg && list.find((x) => x.id === arg.id)) || list.find((e) => { const s = p.endgames[e.id]; return !s || s.due <= today(); }) || list[0];
  if (first) start(first); else panel.innerHTML = `<p class="muted">No positions to show.</p>`;
}

// ------------------------------------------------------------------ phases and transitions (report)
const PH_NAME = { opening: "Opening", middlegame: "Middlegame", endgame: "Endgame" };
const sgn = (x, d = 1) => (x > 0 ? "+" : x < 0 ? "−" : "±") + Math.abs(x).toFixed(d);
function phasesHtml(F, total) {
  if (!F) return `<div class="card"><h2>Phases and transitions</h2><p class="muted">None of your games has the phase data yet. Re-analyse them (Games → tick "Re-analyse games already analysed") to see where you gain and lose.</p></div>`;
  const P = F.phase, fl = F.flow;
  const col = (k) => { const x = P[k]; if (!x.games) return `<div class="phase"><div class="pn">${PH_NAME[k]}</div><div class="muted small">not reached</div></div>`;
    return `<div class="phase ${k === F.weakest ? "leak" : k === F.strongest ? "gainer" : ""}"><div class="pn">${PH_NAME[k]}</div><div class="pv">${sgn(x.avg)}<small>%</small></div><div class="small muted">average win-chance change · ${x.games} game${x.games === 1 ? "" : "s"}</div><div class="small">lost ≥ 10% in ${x.lost10}% · gained ≥ 10% in ${x.won10}%</div></div>`; };
  const outRow = (label, o) => (o ? `<tr><td>${label}</td><td>${o.n}</td><td>${o.win}%</td><td>${o.draw}%</td><td>${o.loss}%</td><td><b>${o.score}%</b></td></tr>` : `<tr><td>${label}</td><td>0</td><td colspan="4" class="muted">no games</td></tr>`);
  const L = { better: "Better (≥ +1)", equal: "Equal (−1 … +1)", worse: "Worse (≤ −1)" };
  const tip = F.weakest === "opening" ? "Most is lost before the middlegame starts: look at your openings (Openings → My repertoire) and the first critical decisions."
    : F.weakest === "middlegame" ? "Most is lost in the middlegame: calculation, plans and tactics. Puzzles from your games and the thinking test target exactly this."
    : F.weakest === "endgame" ? "Most is lost in the endgame: technique and theory. Train the endgames for your level (Train → Endgames)." : "";
  const tm = F.T.openToMid;
  return `<div class="card"><h2>Phases and transitions</h2>
    <p class="small muted" style="margin-top:-6px">${F.games} of ${total} game${total === 1 ? "" : "s"}. Phases are divided like Lichess does it. Each phase shows how much win chance you gain or lose in it, from the start (≈ 50%) to your actual result.</p>
    ${total > F.games ? `<div class="feedback warn small">${total - F.games} older game${total - F.games === 1 ? " has" : "s have"} no phase data yet and ${total - F.games === 1 ? "is" : "are"} left out here (the accuracy per phase above still mixes in the old division for ${total - F.games === 1 ? "it" : "them"}). Re-analyse: Games → tick "Re-analyse games already analysed" → Load &amp; analyse.</div>` : ""}
    <div class="phases">${["opening", "middlegame", "endgame"].map(col).join('<div class="arrow" aria-hidden="true">→</div>')}</div>
    ${F.weakest ? (P[F.weakest].avg < 0 ? `<p><b>You leave the most in the ${F.weakest}</b> (${sgn(P[F.weakest].avg)}% per game)${F.strongest && F.strongest !== F.weakest ? `, and do best in the ${F.strongest} (${sgn(P[F.strongest].avg)}%)` : ""}. ${tip}</p>`
      : `<p><b>You don't lose win chance in any phase on average.</b> Your smallest gain is in the ${F.weakest} (${sgn(P[F.weakest].avg)}% per game)${F.strongest && F.strongest !== F.weakest ? `, the biggest in the ${F.strongest} (${sgn(P[F.strongest].avg)}%)` : ""}.</p>`) : `<p class="small muted">At least 3 games per phase are needed before naming your weakest phase.</p>`}
    <div class="stats" style="margin:10px 0">
      ${fl.afterOpening !== null ? `<div class="stat"><div class="v">${fl.afterOpening}%</div><div class="l">win chance after the opening (${sgn(fl.cpAfterOpening, 2)}), middlegame from move ${fl.midMove}</div></div>` : `<div class="stat"><div class="v">–</div><div class="l">no game reached a middlegame</div></div>`}
      ${fl.afterMiddlegame !== null ? `<div class="stat"><div class="v">${fl.afterMiddlegame}%</div><div class="l">win chance entering the endgame (${sgn(fl.cpAfterMiddlegame, 2)}), from move ${fl.endMove} · ${fl.reachedEnd}% of games</div></div>` : `<div class="stat"><div class="v">–</div><div class="l">no game reached an endgame</div></div>`}
      <div class="stat"><div class="v">${fl.result}%</div><div class="l">final score</div></div></div>
    <h3>After the opening → final result</h3><div class="scroll"><table><tr><th>After the opening</th><th>Games</th><th>Won</th><th>Draw</th><th>Lost</th><th>Score</th></tr>${["better", "equal", "worse"].map((k) => outRow(L[k], F.T.opening[k])).join("")}</table></div>
    <h3>After the opening → entering the endgame</h3><div class="scroll"><table><tr><th>After the opening</th><th>Games</th><th>Still better</th><th>Equal</th><th>Worse</th></tr>${["better", "equal", "worse"].map((k) => tm[k] ? `<tr><td>${L[k]}</td><td>${tm[k].n}</td><td>${tm[k].better}%</td><td>${tm[k].equal}%</td><td>${tm[k].worse}%</td></tr>` : `<tr><td>${L[k]}</td><td>0</td><td colspan="3" class="muted">no games reached an endgame</td></tr>`).join("")}</table></div>
    <h3>Entering the endgame → final result</h3><div class="scroll"><table><tr><th>Entering the endgame</th><th>Games</th><th>Won</th><th>Draw</th><th>Lost</th><th>Score</th></tr>${["better", "equal", "worse"].map((k) => outRow(L[k], F.T.middlegame[k])).join("")}</table></div>
    <details class="small" style="margin-top:8px"><summary><b>How is this worked out?</b></summary><ul>
      <li><b>Phases</b> follow the Lichess rules (its "Divider"): the middlegame starts at the first position with at most 10 pieces other than kings and pawns, or with fewer than 4 pieces left on a player's back rank, or where white and black pieces are clearly mixed. The endgame starts when at most 6 pieces other than kings and pawns are left. Chess.com doesn't publish its rules.</li>
      <li><b>Win chance</b> uses the Lichess formula on the Stockfish evaluation, from your point of view. The phase change is the win chance at the end of the phase minus the one at its start; the end of the game counts as your result (100 win, 50 draw, 0 loss), so a loss on time or a resignation counts too.</li>
      <li><b>Better / equal / worse</b>: at least one pawn up (+1.0), between −1 and +1, or at least one pawn down, at the moment the phase changes.</li>
      <li>${total - F.games ? `${total - F.games} older game${total - F.games === 1 ? " has" : "s have"} no phase data yet: re-analyse to include ${total - F.games === 1 ? "it" : "them"}.` : "All analysed games are included."}</li></ul></details></div>`;
}

// ------------------------------------------------------------------ BOARD (analysis)
function board(v, arg) {
  const p = P(); p.settings ||= {};
  v.innerHTML = `<div class="two"><div><div id="ab"></div>
    <div class="row" style="margin-top:8px"><button class="btn secondary" id="undo">↶ Undo</button><button class="btn secondary" id="flip">⇅ Flip</button><button class="btn secondary" id="startpos">Start position</button><button class="btn secondary" id="clear">Empty FEN</button></div>
</div>
    <div><div class="card"><h2>Analysis</h2>
      <label class="f">FEN<input id="fen"></label><div class="row" style="margin-top:6px"><button class="btn secondary" id="load">Load FEN</button><button class="btn secondary" id="pgnLoad">Load PGN…</button></div>
      <div class="row" style="margin-top:10px"><label class="row small"><input type="checkbox" id="auto" ${p.settings.autoEngine ? "checked" : ""}> Show engine</label><label class="row small"><input type="checkbox" id="vs"> Engine plays the other side</label><label class="row small"><input type="checkbox" id="bookT" ${p.settings.book || arg?.book ? "checked" : ""}> Opening book</label></div>
      <div class="lines" id="lines" style="margin-top:8px"></div><div class="small muted" id="moves" style="margin-top:8px"></div></div>
      <div class="card ${p.settings.book || arg?.book ? "" : "hidden"}" id="bookCard"><h2>Opening book</h2><div id="ex"></div></div>
      <div class="card" id="sheet"></div>
      <div class="card"><h2>Read the position</h2><p class="small muted">Material, loose pieces, threats, kings, pawns and activity, plus what that means for the plan. Fill in the Think sheet first, then compare.</p>
      <button class="btn secondary" id="readBtn">Read the position</button><div id="readOut" style="margin-top:8px"></div>${evalGuideHtml()}</div>
      <div class="card"><h2>Next</h2><div class="row"><button class="btn secondary" id="claude">Copy for Claude (plan question)</button><button class="btn secondary" id="addPz">Add as puzzle</button><button class="btn secondary" id="addEg">Add as endgame drill</button></div><div id="egForm" class="hidden" style="margin-top:10px"><div class="form"><label class="f">Name<input id="egName" placeholder="e.g. Rook endgame vs Jan"></label><label class="f">Task for the side to move<select id="egGoal"><option value="win">Win</option><option value="draw">Hold the draw</option></select></label></div><div class="row" style="margin-top:8px"><button class="btn" id="egSave">Add to Endgames</button></div></div>
      <p class="small muted">"Copy for Claude" copies the position, your moves and the engine lines as a question, ready to paste into a chat with Claude.</p></div></div></div>`;
  const brd = new Board($("#ab"));
  const hist = [];
  let lastLines = [], lastLinesFen = null;
  const startFen = arg?.fen || new Chess().fen();
  brd.setFen(startFen); brd.setOrientation(startFen.split(" ")[1]);
  thinkSheet($("#sheet"), () => brd.fen(), { note: arg?.note || null, source: "board" });
  let readOpen = false;
  const drawRead = () => { if (readOpen) $("#readOut").innerHTML = readerHtml(brd.fen()); };
  $("#readBtn").onclick = () => { readOpen = !readOpen; $("#readBtn").textContent = readOpen ? "Hide reading" : "Read the position"; $("#readOut").innerHTML = readOpen ? readerHtml(brd.fen()) : ""; };
  let token = 0, ex = null;
  const showBook = () => {
    const on = $("#bookT").checked; $("#bookCard").classList.toggle("hidden", !on);
    if (on && !ex) ex = mountExplorer($("#ex"), { getFen: () => brd.fen(), p, esc, go, onMove: (uci) => { const before = brd.fen(); const r = brd.play(uci); if (r) brd.onMove(r, before); } });
    else if (on) ex.refresh();
  };
  const refresh = async () => {
    $("#fen").value = brd.fen();
    if (ex && $("#bookT").checked) ex.refresh();
    $("#moves").textContent = hist.length ? "Moves: " + hist.map((h) => h.san).join(" ") : "";
    const c = brd.chess;
    drawRead();
    if (c.isGameOver()) { $("#lines").innerHTML = `<div>${c.isCheckmate() ? "Checkmate" : "Draw"}</div>`; return; }
    if (!$("#auto").checked) { $("#lines").innerHTML = `<div class="muted small">Engine hidden. Think first, then tick "Show engine".</div>`; brd.setArrows([]); return; }
    const my = ++token; $("#lines").innerHTML = `<div class="muted">Thinking…</div>`;
    const fen = brd.fen();
    getEngine().cancel("lines"); // only the current position matters (other engine work keeps going)
    const res = await getEngine().analyse(fen, { movetime: 1200, multipv: 3, tag: "lines" });
    if (my !== token) return;
    lastLines = res; lastLinesFen = fen;
    const black = fen.split(" ")[1] === "b";
    $("#lines").innerHTML = res.map((l) => `<div><b>${fmtScore(l, black)}</b> ${esc(pvToSan(fen, l.pv, 10))}</div>`).join("") + `<div class="muted small">Eval from White's point of view · depth ${res[0]?.depth || "?"}</div>`;
    if (res[0]?.pv[0]) brd.setArrows([{ from: res[0].pv[0].slice(0, 2), to: res[0].pv[0].slice(2, 4) }]);
  };
  brd.onMove = async (mv, before) => {
    hist.push({ san: mv.san, before });
    if ($("#vs").checked && !brd.chess.isGameOver()) {
      brd.locked = true;
      const fenNow = brd.fen();
      getEngine().cancel("reply");
      const [l] = await getEngine().analyse(fenNow, { movetime: 700, tag: "reply" });
      if (brd.fen() !== fenNow) { brd.locked = false; return; } // the position changed meanwhile (undo / new position)
      if (l?.pv[0]) { const b = brd.fen(); const r = brd.play(l.pv[0]); if (r) hist.push({ san: r.san, before: b, engine: true }); }
      brd.locked = false;
    }
    refresh();
  };
  // undo takes back the engine's reply too, so it's your turn again
  $("#undo").onclick = () => { let h = hist.pop(); if (h?.engine && hist.length) h = hist.pop(); if (h) { getEngine().cancel("lines"); getEngine().cancel("reply"); brd.setFen(h.before); brd.locked = false; refresh(); } };
  $("#flip").onclick = () => brd.flip();
  $("#startpos").onclick = () => { hist.length = 0; brd.setFen(new Chess().fen()); refresh(); };
  $("#clear").onclick = () => { $("#fen").value = ""; $("#fen").focus(); };
  $("#load").onclick = () => { try { const f = $("#fen").value.trim(); new Chess(f); hist.length = 0; brd.setFen(f); brd.setOrientation(f.split(" ")[1]); refresh(); } catch (e) { toast("Invalid FEN"); } };
  $("#pgnLoad").onclick = () => { const t = prompt("Paste a PGN (one game):"); if (!t) return; try { const g = parseGame(t); hist.length = 0; brd.setFen(g.fens[g.fens.length - 1]); g.moves.forEach((m, i) => hist.push({ san: m.san, before: g.fens[i] })); refresh(); } catch { toast("Couldn't read the PGN"); } };
  $("#auto").onchange = () => { p.settings.autoEngine = $("#auto").checked; save(); refresh(); };
  $("#bookT").onchange = () => { p.settings.book = $("#bookT").checked; save(); showBook(); };
  if ($("#bookT").checked) showBook();
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
    copy(`Chess question: what is the right plan in this position, and WHY? Explain the pawn structure, the worst piece of each side, and the 2-3 candidate plans.\n\nFEN: ${fen}\n${hist.length ? "Moves played to get here: " + hist.map((h) => h.san).join(" ") + "\n" : ""}${lastLinesFen === fen && lastLines.length ? `Stockfish (eval from White's view):\n${lastLines.map((l) => `${fmtScore(l, black)} ${pvToSan(fen, l.pv, 8)}`).join("\n")}` : "(no engine lines for this position)"}\n\nMy idea was: …`);
  };
  $("#addEg").onclick = () => {
    const box = $("#egForm"); box.classList.toggle("hidden");
    if (!box.classList.contains("hidden")) { $("#egName").value = ""; $("#egName").focus(); }
  };
  $("#egSave").onclick = () => {
    const theme = $("#egName").value.trim(); if (!theme) { toast("Give the position a name"); $("#egName").focus(); return; }
    const fen = brd.fen(); const goal = $("#egGoal").value;
    p.customEndgames.push({ id: "c" + Date.now().toString(36), level: "Own position", theme, fen, side: fen.split(" ")[1], goal, grade: "engine", idea: "Your own position: work out the plan first, then check it with the engine on the Board." });
    save(); logEvent("endgame", "Position added: " + theme); toast("Added under Endgames"); $("#egForm").classList.add("hidden");
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
      c.verdict = g.verdict; const sg = (x) => (x >= 9000 ? "mate" : x <= -9000 ? "getting mated" : (x >= 0 ? "+" : "") + (x / 100).toFixed(2));
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
  <div class="card"><h2>Log</h2>${p.log.length ? `<div class="scroll"><table>${p.log.slice(0, 200).map((l) => `<tr><td class="small muted" style="white-space:nowrap">${l.date.slice(0, 10)}</td><td><span class="pill">${esc(l.type)}</span></td><td class="anywhere">${esc(l.text)}</td></tr>`).join("")}</table></div>` : `<p class="muted">Nothing logged yet.</p>`}</div>
  <div class="card"><h2>Export & backup</h2><p class="small">Your data is stored only in this browser. Back it up regularly, or use the backup to move to another device.</p>
    <div class="row"><button class="btn secondary" id="md">Export training log (Markdown)</button><button class="btn secondary" id="bk">Backup all players (JSON)</button><label class="btn secondary" style="cursor:pointer">Restore backup<input type="file" id="rs" accept=".json" class="visually-hidden"></label></div></div>`;
  bindNextSteps(v, p);
  $("#addNote").onclick = () => { const t = $("#note").value.trim(); if (!t) { toast("Type a note first"); $("#note").focus(); return; } logEvent("note", t); toast("Note added"); go("log"); };
  $("#md").onclick = () => download(`chess-coach-${slug(p.name)}.md`, markdownLog(p), "text/markdown");
  $("#bk").onclick = () => download(`chess-coach-backup-${today()}.json`, JSON.stringify(S), "application/json");
  $("#rs").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const d = normalise(JSON.parse(await f.text())); if (!d || !Object.keys(d.players).length) throw 0; if (!confirm("Replace everything in this browser with the backup?")) return; S = d; save(); go("home"); toast("Backup restored"); } catch { toast("Not a valid backup"); }
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

// ------------------------------------------------------------------ install as app (PWA)
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW registration failed", e));
let installEvt = null;
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; $("#installBtn").classList.remove("hidden"); });
window.addEventListener("appinstalled", () => { $("#installBtn").classList.add("hidden"); toast("Chess Coach is installed"); });
$("#installBtn").onclick = async () => {
  if (installEvt) { installEvt.prompt(); await installEvt.userChoice; installEvt = null; $("#installBtn").classList.add("hidden"); return; }
  alert("iPhone/iPad: tap the Share button in Safari, then 'Add to Home Screen'.\nAndroid: Chrome menu ⋮ → 'Install app'.\nComputer: the install icon at the right of the Chrome/Edge address bar.");
};
if (!standalone() && /iPhone|iPad|iPod/.test(navigator.userAgent)) $("#installBtn").classList.remove("hidden");

// ------------------------------------------------------------------ boot
if (!S.current || !S.players[S.current]) S.current = Object.keys(S.players)[0] || null;
$("#jobStop").onclick = () => {
  if (running) { running.stop = true; $("#jobStop").classList.add("hidden"); $("#jobText").textContent = "Pausing: the games being analysed now are finished first…"; return; }
  const q = loadQueue(); if (q && q.items?.length) processQueue(q);
};
setTimeout(resumeBanner, 800);
const startTab = new URLSearchParams(location.search).get("tab");
go(startTab && views[startTab] ? startTab : "home");
window.__chesscoach = { get state() { return S; }, go };
