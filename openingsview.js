// Opening library + my repertoire.
import { Chess } from "./vendor/chess.js";
import { PIECES } from "./pieces.js";
import { OPENINGS, SIDE_LABEL } from "./openings.js";

const IMG = Object.fromEntries(Object.entries(PIECES).map(([k, v]) => [k, "data:image/svg+xml;utf8," + encodeURIComponent(v)]));
const TYPE_NAME = { activist: "Activist", reflector: "Reflector", pragmatist: "Pragmatist", theoretician: "Theoretician" };
const THEORY = ["", "Little theory", "Some theory", "A lot of theory"];
const filt = { side: "all", fit: false, q: "" };

const sanList = (moves) => moves.split(/\s+/).filter(Boolean).map((t) => t.replace(/^\d+\./, ""));
function positions(o) { const c = new Chess(); const out = [{ fen: c.fen(), last: null }]; for (const s of sanList(o.moves)) { const m = c.move(s); out.push({ fen: c.fen(), last: [m.from, m.to], san: m.san }); } return out; }
function miniBoard(fen, flip) {
  const rows = fen.split(" ")[0].split("/"); const cells = [];
  for (let r = 0; r < 8; r++) { let f = 0; for (const ch of rows[r]) { if (/\d/.test(ch)) { for (let k = 0; k < +ch; k++) cells.push({ r, f: f++, p: null }); } else cells.push({ r, f: f++, p: ch }); } }
  const ordered = flip ? cells.slice().reverse() : cells;
  return `<div class="mini">${ordered.map((c) => `<div class="${(c.r + c.f) % 2 ? "d" : "l"}">${c.p ? `<img src="${IMG[c.p]}" alt="">` : ""}</div>`).join("")}</div>`;
}
function fitInfo(o, st) {
  if (!st) return null;
  const typeFit = o.types.includes(st.type);
  const gap = st.aggression == null ? null : Math.abs(o.sharp - st.aggression);
  const score = (typeFit ? 2 : 0) + (gap == null ? 0 : gap <= 20 ? 1.5 : gap <= 35 ? 0.5 : -1);
  return { typeFit, gap, score, good: score >= 2 };
}
function yourGames(o, st) {
  const A = st?.A; if (!A) return null;
  const color = o.side === "w" ? "w" : "b";
  const gs = A.openings.filter((x) => x.color === color && o.match.test(x.name));
  if (!gs.length) return null;
  const n = gs.reduce((a, x) => a + x.games, 0);
  const score = Math.round(gs.reduce((a, x) => a + x.scorePct * x.games, 0) / n);
  return { n, score };
}
const meter = (sharp) => `<div class="meter"><span style="text-align:right">Calm</span><div class="track"><i style="left:${sharp}%"></i></div><span>Sharp</span></div>`;

export function openingsView(v, arg, C) {
  if (arg?.id) { const o = OPENINGS.find((x) => x.id === arg.id); if (o) return detail(v, o, C); }
  const st = C.P() ? C.style() : null;
  const list = () => OPENINGS.filter((o) => (filt.side === "all" || o.side === filt.side) && (!filt.fit || fitInfo(o, st)?.good) && (!filt.q || (o.name + " " + o.eco + " " + o.moves).toLowerCase().includes(filt.q.toLowerCase())))
    .map((o) => ({ o, fit: fitInfo(o, st), g: yourGames(o, st) }))
    .sort((a, b) => (filt.fit ? (b.fit?.score ?? 0) - (a.fit?.score ?? 0) : 0));
  const draw = () => {
    const items = list();
    v.querySelector("#oplist").innerHTML = items.length ? items.map(({ o, fit, g }) => `<button class="op" data-id="${o.id}">${miniBoard(positions(o).slice(-1)[0].fen, o.side !== "w")}
        <div><h3>${C.esc(o.name)}</h3><div class="eco">${SIDE_LABEL[o.side]} · ${C.esc(o.eco)}</div><p>${C.esc(o.idea)}</p>
        <div class="tagline">${meter(o.sharp)}</div>
        <div class="tagline"><span class="pill">${THEORY[o.theory]}</span>${fit?.good ? `<span class="pill fit">Fits your style</span>` : ""}${g ? `<span class="pill">You: ${g.n} games, ${g.score}%</span>` : ""}</div></div></button>`).join("")
      : `<p class="muted">No openings match. Clear the search or the filters.</p>`;
    v.querySelectorAll(".op").forEach((b) => (b.onclick = () => C.go("openings", { id: b.dataset.id })));
    v.querySelectorAll(".chip[data-side]").forEach((c) => c.classList.toggle("on", c.dataset.side === filt.side));
    const fc = v.querySelector("#fitChip"); if (fc) fc.classList.toggle("on", filt.fit);
  };
  v.innerHTML = `<p class="muted" style="margin-top:-6px;max-width:68ch">What each opening is about, the plans that come with it, and its strong and weak sides, so you can pick what suits the way you play.${st ? ` Your player type: <b>${C.esc(st.typeName)}</b>${st.aggression != null ? `, ${st.aggression}/100 on the calm–sharp scale` : ""}.` : " Take the test or analyse your games to see which openings fit you."}</p>
    <div class="chips">${[["all", "All"], ["w", "As White"], ["e4", "Black vs 1.e4"], ["d4", "Black vs 1.d4"]].map(([k, l]) => `<button class="chip" data-side="${k}">${l}</button>`).join("")}
      ${st ? `<button class="chip" id="fitChip">Fits my style</button>` : ""}<input id="opq" placeholder="Search name, ECO or moves" style="flex:1 1 180px;border-radius:999px" value="${C.esc(filt.q)}"></div>
    <div class="oplist" id="oplist"></div>`;
  v.querySelectorAll(".chip[data-side]").forEach((c) => (c.onclick = () => { filt.side = c.dataset.side; draw(); }));
  const fc = v.querySelector("#fitChip"); if (fc) fc.onclick = () => { filt.fit = !filt.fit; draw(); };
  v.querySelector("#opq").oninput = (e) => { filt.q = e.target.value; draw(); };
  draw();
}

function detail(v, o, C) {
  const p = C.P(); const st = p ? C.style() : null; const fit = fitInfo(o, st); const g = yourGames(o, st);
  const pos = positions(o); let i = pos.length - 1;
  const slot = o.side === "w" ? "white" : o.side === "e4" ? "vsE4" : "vsD4";
  const mine = p?.repertoire?.ids?.[slot] === o.id;
  document.getElementById("pageTitle").textContent = o.name;
  v.innerHTML = `<button class="back" id="back">‹ All openings</button>
    <div class="two"><div><div id="ob"></div>
        <div class="movestrip" id="ms"></div>
        <div class="row"><button class="btn secondary small" id="first">⏮</button><button class="btn secondary small" id="prev">◀</button><button class="btn secondary small" id="next">▶</button><button class="btn secondary small" id="toBoard">Analyse this position</button></div></div>
      <div>
        <div class="row" style="justify-content:space-between;margin-bottom:6px"><span class="muted">${SIDE_LABEL[o.side]} · ${C.esc(o.eco)} · ${THEORY[o.theory]}</span>${meter(o.sharp)}</div>
        <div class="card"><h2>The idea</h2><p>${C.esc(o.idea)}</p><h3>Typical plans</h3><ul>${o.plans.map((x) => `<li>${C.esc(x)}</li>`).join("")}</ul></div>
        <div class="card procon"><div class="pro"><h3>Strong sides</h3><ul>${o.strengths.map((x) => `<li>${C.esc(x)}</li>`).join("")}</ul></div>
          <div class="con"><h3>Weaker sides</h3><ul>${o.weaknesses.map((x) => `<li>${C.esc(x)}</li>`).join("")}</ul></div></div>
        <div class="card"><h2>Who it suits</h2><p>${C.esc(o.fits)}</p>
          <div class="tagline">${Object.keys(TYPE_NAME).map((k) => `<span class="pill ${o.types.includes(k) ? (st?.type === k ? "fit" : "good") : ""}" style="${o.types.includes(k) ? "" : "opacity:.45"}">${TYPE_NAME[k]}</span>`).join("")}</div>
          ${st ? `<p class="small" style="margin-top:10px">${fit.typeFit ? `It suits your type (<b>${C.esc(st.typeName)}</b>).` : `It isn't a typical choice for a <b>${C.esc(st.typeName.toLowerCase())}</b>, which can be a good reason to play it in training games.`}${fit.gap != null ? ` On the calm–sharp scale it sits at ${o.sharp}, you at ${st.aggression}: ${fit.gap <= 20 ? "a close match" : fit.gap <= 35 ? "a reasonable match" : "quite far from your usual style"}.` : ""}</p>` : ""}
          ${g ? `<p class="small">In your analysed games: <b>${g.n} games, ${g.score}%</b> score.</p>` : ""}
          ${p ? `<div class="row" style="margin-top:8px"><button class="btn ${mine ? "secondary" : ""}" id="addRep">${mine ? "In your repertoire ✓" : `Use as my ${o.side === "w" ? "White opening" : o.side === "e4" ? "answer to 1.e4" : "answer to 1.d4"}`}</button></div>` : ""}</div>
      </div></div>`;
  const brd = new C.Board(v.querySelector("#ob"), { interactive: false }); brd.setOrientation(o.side === "w" ? "w" : "b");
  const toks = sanList(o.moves);
  const draw = () => {
    brd.setFen(pos[i].fen, { last: pos[i].last });
    v.querySelector("#ms").innerHTML = toks.map((s, k) => `${k % 2 === 0 ? `<span class="no">${k / 2 + 1}.</span>` : ""}<a href="#" data-k="${k + 1}" class="${k + 1 === i ? "on" : ""}">${C.esc(s)}</a>`).join("");
    v.querySelectorAll("#ms a").forEach((a) => (a.onclick = (e) => { e.preventDefault(); i = +a.dataset.k; draw(); }));
  };
  v.querySelector("#first").onclick = () => { i = 0; draw(); };
  v.querySelector("#prev").onclick = () => { i = Math.max(0, i - 1); draw(); };
  v.querySelector("#next").onclick = () => { i = Math.min(pos.length - 1, i + 1); draw(); };
  v.querySelector("#toBoard").onclick = () => C.go("board", { fen: pos[i].fen });
  v.querySelector("#back").onclick = () => C.go("openings");
  const ar = v.querySelector("#addRep");
  if (ar) ar.onclick = () => { p.repertoire ||= {}; p.repertoire.ids ||= {}; p.repertoire.ids[slot] = o.id; p.repertoire[slot] = o.name; C.save(); C.logEvent("repertoire", `${o.name} added to the repertoire`); C.toast("Added to your repertoire"); detail(v, o, C); };
  draw();
}

export function repertoireView(v, C) {
  const p = C.P(); const st = C.style();
  const ids = p.repertoire?.ids || {};
  const slots = [["white", "w", "As White"], ["vsE4", "e4", "Against 1.e4"], ["vsD4", "d4", "Against 1.d4"]];
  const suggest = (side) => OPENINGS.filter((o) => o.side === side).map((o) => ({ o, f: fitInfo(o, st) })).sort((a, b) => (b.f?.score ?? 0) - (a.f?.score ?? 0)).slice(0, 2);
  const A = st?.A;
  v.innerHTML = `<div class="card"><h2>Your choices</h2>
      <table>${slots.map(([k, side, l]) => { const o = OPENINGS.find((x) => x.id === ids[k]); return `<tr><td style="width:34%"><b>${l}</b></td><td>${o ? `<a href="#" data-op="${o.id}">${C.esc(o.name)}</a> <span class="muted small">${C.esc(o.eco)}</span>` : p.repertoire?.[k] ? C.esc(p.repertoire[k]) : `<span class="muted">Not chosen yet</span>`}</td><td style="text-align:right"><button class="btn secondary small" data-side="${side}">${o ? "Change" : "Choose"}</button></td></tr>`; }).join("")}</table></div>
    ${st ? `<div class="card"><h2>Suggestions for a ${C.esc(st.typeName.toLowerCase())}</h2><p class="small muted">Based on your player type${st.aggression != null ? ` and your calm–sharp score (${st.aggression}/100)` : ""}.</p>
      <table>${slots.map(([, side, l]) => `<tr><td style="width:34%"><b>${l}</b></td><td>${suggest(side).map(({ o }) => `<a href="#" data-op="${o.id}">${C.esc(o.name)}</a>`).join(" or ")}</td></tr>`).join("")}</table></div>` : `<div class="card"><p>Take the thinking test or analyse your games, and this page suggests openings that fit your style.</p></div>`}
    ${A && A.openings.length ? `<div class="card"><h2>What you actually play</h2><p class="small muted">From your analysed games. Win chance after move 10 tells you whether the opening itself goes well.</p><div class="scroll"><table><tr><th>Colour</th><th>Opening</th><th>Games</th><th>Score</th><th>Win chance after move 10</th></tr>
      ${A.openings.slice(0, 10).map((o) => `<tr><td>${o.color === "w" ? "White" : "Black"}</td><td>${C.esc(o.name)}</td><td>${o.games}</td><td>${o.scorePct}%</td><td>${o.wpAfter10 ?? "–"}${o.wpAfter10 != null ? "%" : ""}</td></tr>`).join("")}</table></div></div>` : ""}`;
  v.querySelectorAll("[data-op]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); C.go("openings", { id: a.dataset.op }); }));
  v.querySelectorAll("[data-side]").forEach((b) => (b.onclick = () => { filt.side = b.dataset.side; filt.fit = !!st; C.go("openings"); }));
}
