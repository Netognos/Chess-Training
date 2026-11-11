// Weak points, in depth: for each kind of error (by cause, from analysis.js errorCause) what exactly goes wrong in
// YOUR games (patterns with numbers), the costliest positions with a short explanation each, the principles and a
// thinking routine to fix it, and where to learn more (books, YouTube, free Lichess material) for your level.
import { errorCause } from "./analysis.js";
import { miniBoard } from "./openingsview.js";

const YT = (q) => "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);

// lo/hi = the rating range a book or channel suits best (online ratings, roughly)
export const THEMES = {
  tactical: {
    title: "Tactics: missed and allowed",
    what: "Moves where a forcing move (check, capture, threat) decided things: you missed one for yourself, or your move let your opponent have one.",
    why: "At club level most games are decided by tactics, not by strategy. Almost always the cause is not a lack of knowledge but a missing check: the position wasn't scanned for forcing moves before moving.",
    principles: [
      ["Checks, captures, threats, every move", "Before you move, list every check, capture and threat for yourself, then for your opponent. Forcing moves first: they limit what the other side can do."],
      ["Blunder check", "Before letting go of the piece: \"After this move, what are ALL my opponent's checks and captures?\" Two seconds that save most lost games."],
      ["Loose pieces drop off", "An undefended piece (or one defended only by the king) is a tactical target. Count attackers and defenders of every piece that is exchanged or attacked."],
      ["Look for the motif, then calculate", "Typical signals: a king with no air, pieces on the same line (pin, skewer), a piece that defends two things (overload), a queen and king a knight's jump apart (fork)."],
      ["Calculate to the end of the forcing line", "Stop calculating only when there are no more checks or captures, then judge the position. Most misses happen one move before the end of the line."],
      ["When you are winning, ask what your opponent wants", "Many tactics are allowed in better positions: the opponent's last chance is a trick. Prevent it before you go for more."],
    ],
    routine: ["What did my opponent's last move change? What does it attack or prepare?", "List my checks, captures and threats. Calculate the most forcing one first.", "Pick a candidate move.", "Blunder check: their checks, captures and threats after my move.", "Play it."],
    train: [["practice", { cat: "Calculation" }, "Calculation module"], ["practice", { cat: "Defence" }, "Defence module"], ["practice", { cat: "Attack & mate" }, "Attack & mate module"], ["puzzles", { cause: "tactical" }, "Your own tactical mistakes as puzzles"]],
    books: [
      ["Winning Chess Tactics", "Yasser Seirawan", 800, 1500, "explains every tactical motif with clear examples; a good start"],
      ["1001 Chess Exercises for Club Players", "Frank Erwich", 1200, 1900, "exercises sorted by motif, then mixed: exactly the club level"],
      ["Forcing Chess Moves", "Charles Hertan", 1500, 2100, "trains you to look at checks and captures you'd normally reject"],
      ["The Woodpecker Method", "Axel Smith & Hans Tikkanen", 1600, 2400, "the same 1,000+ puzzles solved repeatedly, faster each cycle, to make patterns automatic"],
      ["Improve Your Chess Calculation", "R.B. Ramesh", 1800, 2500, "calculation exercises by level, with how to think through them"],
    ],
    yt: [
      ["Daniel Naroditsky: speedrun series", YT("Naroditsky speedrun"), "a grandmaster explaining every move, including the tactics both sides miss (archive: he died in October 2025)"],
      ["Chess Vibes: common tactical mistakes", YT("ChessVibes tactics mistakes"), "short lessons on patterns club players miss"],
      ["Hanging Pawns: tactics", YT("Hanging Pawns tactics"), "structured, calm explanations"],
    ],
    free: [["Lichess puzzle themes", "https://lichess.org/training/themes", "train one motif at a time (fork, pin, overloading…)"], ["Lichess Practice: checkmates", "https://lichess.org/practice", "the mating patterns, with exercises"]],
  },
  positional: {
    title: "Positional and planning errors",
    what: "Quiet moves that weren't tactical mistakes but made your position worse: a wrong plan, a bad piece placement, a pawn move that left holes, a wrong exchange.",
    why: "These moves rarely lose on the spot, which is why they are hard to notice. They add up: 3 or 4 of them and the position is lost without a single blunder.",
    principles: [
      ["Improve your worst piece", "When there is nothing forcing, find the piece that does the least and bring it to a better square. This is the default plan in most quiet positions."],
      ["Pawns can't go back", "Every pawn move leaves squares behind it that can never be defended by a pawn again. Ask what it weakens before you push."],
      ["Play where you are stronger", "Attack on the side where you have more space or more pieces (usually where your pawn chain points). Don't open the side where your king lives."],
      ["Exchanges change the position", "Trade pieces when you are ahead in material or when your opponent's piece is better than yours. Keep pieces on when you are attacking or your opponent is cramped."],
      ["Think in plans, not in single moves", "Decide what you want to achieve in the next 3-5 moves (open a file, win a weak pawn, put a knight on an outpost) and pick moves that serve it."],
      ["Prophylaxis: ask what your opponent wants", "Before your plan, find your opponent's plan and see if one move stops it while improving your position."],
    ],
    routine: ["What changed with the last move?", "Is anything forcing? (If yes, think tactically first.)", "What is my worst piece, and what is my opponent's plan?", "Pick a move that improves a piece or stops their plan, without creating a weakness.", "Blunder check."],
    train: [["practice", { cat: "prophylaxis" }, "Prophylaxis module"], ["practice", { cat: "coordination" }, "Coordination module"], ["practice", { cat: "structure" }, "Weaknesses & structure module"], ["puzzles", { cause: "positional" }, "Your own positional mistakes as puzzles"]],
    books: [
      ["Logical Chess: Move by Move", "Irving Chernev", 900, 1600, "every move of 33 games explained in plain words"],
      ["The Amateur's Mind", "Jeremy Silman", 1200, 1800, "shows how club players think in positions like these, and where it goes wrong"],
      ["Simple Chess", "Michael Stean", 1400, 1900, "the basic strategic ideas (weak squares, outposts, open files) in a short book"],
      ["How to Reassess Your Chess", "Jeremy Silman", 1500, 2100, "plans based on imbalances: what is different between the sides"],
      ["Chess Structures: A Grandmaster Guide", "Mauricio Flores Rios", 1700, 2400, "the plans that go with each common pawn structure"],
      ["Positional Decision Making in Chess", "Boris Gelfand", 2000, 2600, "how a top grandmaster makes quiet decisions"],
    ],
    yt: [
      ["Hanging Pawns: pawn structures and middlegame plans", YT("Hanging Pawns pawn structure middlegame plan"), "the plans behind the most common structures"],
      ["Saint Louis Chess Club: middlegame lectures", YT("Saint Louis Chess Club lecture middlegame strategy"), "long lectures by grandmasters, for all levels"],
      ["Dr. Can's Chess Clinic: explain every move", YT("Dr Can chess clinic explain every move"), "club-level games where every decision is explained"],
      ["Daniel Naroditsky: speedrun series", YT("Naroditsky speedrun positional"), "how a grandmaster plans against club players (archive)"],
    ],
    free: [["Lichess Practice: pieces and strategy", "https://lichess.org/practice", "short interactive lessons"], ["Lichess studies: pawn structures", "https://lichess.org/study/search?q=pawn+structures", "free community studies"]],
  },
  opening: {
    title: "Errors in the opening",
    what: "Mistakes and blunders before the middlegame starts: often a known trap, a wrong move order, or leaving the king in the centre too long.",
    why: "At club level you don't need more theory, you need the ideas: why the moves are played. Most opening errors are breaking a basic principle, not forgetting move 14 of a line.",
    principles: [
      ["Develop, castle, connect the rooks", "Knights and bishops out first, king to safety, then the rooks. Count your developed pieces against your opponent's."],
      ["One move per piece in the opening", "Moving the same piece twice, or many pawn moves, gives your opponent free tempi."],
      ["Fight for the centre", "Pawns and pieces aimed at e4, d4, e5, d5. Every opening is a plan for the centre."],
      ["Don't grab pawns with the queen early", "An early queen gets chased and costs you development, unless the pawn is really free."],
      ["Know the idea, not only the moves", "For each opening you play, know the typical plan and the 2-3 typical traps for both sides."],
      ["When they leave theory, think", "The moment your opponent plays something unknown, slow down: ask what it threatens and what it weakens."],
    ],
    routine: ["Is my king safe? Can I castle soon?", "Which of my pieces is still at home?", "What does the new move threaten?", "Develop with a purpose (towards the centre, with tempo if possible).", "Blunder check."],
    train: [["repertoire", null, "Your repertoire and its ideas"], ["openings", null, "Opening library with plans, strengths and weaknesses"], ["puzzles", { phase: "opening" }, "Your own opening mistakes as puzzles"]],
    books: [
      ["Logical Chess: Move by Move", "Irving Chernev", 900, 1600, "the opening principles shown in real games"],
      ["Discovering Chess Openings", "John Emms", 1000, 1700, "how to understand openings through principles instead of memory"],
      ["Mastering Chess Openings (vol. 1)", "John Watson", 1800, 2400, "why modern openings are played the way they are"],
    ],
    yt: [
      ["Hanging Pawns: opening explanations", YT("Hanging Pawns opening ideas explained"), "an opening explained through its ideas and plans"],
      ["GothamChess: opening guides", YT("GothamChess opening guide"), "entertaining introductions to the main openings, good for under 1600"],
    ],
    free: [["Lichess opening explorer", "https://lichess.org/analysis#explorer", "see what masters and players at your level play"], ["Lichess studies: your opening", "https://lichess.org/study", "search the name of your opening"]],
  },
  technique: {
    title: "Endgame technique",
    what: "Non-tactical errors in the endgame: wrong king moves, wrong pawn moves, trading into a lost ending, or not converting a winning one.",
    why: "Endgames are very concrete: a few known positions and rules decide most of them, and at club level few players know them. Every endgame you study pays off for the rest of your chess life.",
    principles: [
      ["Activate the king", "In the endgame the king is a strong piece: bring it to the centre or towards the pawns. A passive king loses most endgames."],
      ["Passed pawns must be pushed", "A passed pawn ties down your opponent's pieces. Support it and push it; stop the opponent's with the king or a piece behind/in front of it."],
      ["Rooks belong behind passed pawns", "Behind your own passed pawn, and behind your opponent's (Tarrasch rule). And rooks belong on active squares, even at the cost of a pawn."],
      ["Don't hurry", "When you are winning, first improve everything (king, rook, pawns) before you go for the decisive break. There's rarely a rush in the endgame."],
      ["Know the key positions", "King and pawn vs king (opposition, key squares), Lucena and Philidor in rook endings, wrong-coloured bishop. They come back all the time."],
      ["Count before you trade into a pawn ending", "A king-and-pawn ending is all-or-nothing. Before trading the last pieces, calculate it to the end: who queens first?"],
    ],
    routine: ["What is the material and which theoretical position is this close to?", "Where should my king be? Where is it now?", "Which pawns can become passed? Who is faster?", "Pick a plan and improve pieces before pushing.", "Before every trade: is the resulting ending won, drawn or lost?"],
    train: [["endgames", null, "Endgame positions for your level (play them vs the tablebase)"], ["practice", { cat: "Endgame" }, "Endgame module"], ["practice", { cat: "technique" }, "Trading & technique module"], ["puzzles", { cause: "technique" }, "Your own endgame mistakes as puzzles"]],
    books: [
      ["Silman's Complete Endgame Course", "Jeremy Silman", 700, 2000, "organised by rating: read only the chapters for your level and below"],
      ["100 Endgames You Must Know", "Jesús de la Villa", 1500, 2300, "the theoretical positions that come up most, with exercises"],
      ["Endgame Strategy", "Mikhail Shereshevsky", 1800, 2400, "the practical rules: king activity, two weaknesses, don't hurry"],
      ["Dvoretsky's Endgame Manual", "Mark Dvoretsky", 2000, 2700, "the reference, for when you want everything"],
    ],
    yt: [
      ["Saint Louis Chess Club: endgame lectures", YT("Saint Louis Chess Club endgame lecture"), "clear lectures on the key endings"],
      ["Daniel Naroditsky: endgame lessons", YT("Naroditsky endgame"), "practical endgame technique (archive)"],
      ["Hanging Pawns: endgames", YT("Hanging Pawns endgame"), "the basic theoretical positions explained step by step"],
    ],
    free: [["Lichess Practice: fundamental endgames", "https://lichess.org/practice", "opposition, Lucena, Philidor… to play out yourself"], ["Lichess: endgame tablebase", "https://lichess.org/analysis", "set up any position with 7 pieces or fewer and see the perfect result"]],
  },
  time: {
    title: "Time trouble",
    what: "Mistakes and blunders made with less than 10% of your starting time (or under 30 seconds) on the clock.",
    why: "It's rarely the last move that's the problem, but the earlier moves where too much time was spent. And in faster games, the habit of thinking long about obvious moves.",
    principles: [
      ["Budget your time", "Rough guide: by move 20 you should still have at least half of your time. Check the clock at fixed moments (move 10, 20, 30)."],
      ["Spend time on critical moments only", "Think long when the position changes: a capture, a pawn break, a choice between plans, the move after your opponent's surprise. Play obvious moves fast."],
      ["Recaptures and only moves: instantly", "Don't spend time on a move you will play anyway. Spend it on the next move instead."],
      ["When low on time: simplify and play safe", "No new complications. Keep pieces protected, keep the king safe, use the increment. A safe move beats the best move."],
      ["Play slower games", "Train at 15+10 or slower. You learn to think in slow games; fast games mostly train reflexes. The habit of using your time well carries over."],
    ],
    routine: ["Is this a critical moment (capture, break, plan choice)? Then take time.", "Otherwise: candidate, blunder check, play.", "At moves 10, 20, 30: compare my clock with my opponent's.", "Under 10%: simplify, protect everything, no new adventures."],
    train: [["puzzles", { cause: "time" }, "The positions where the clock beat you"], ["practice", { cat: "Calculation" }, "Faster calculation: Calculation module"]],
    books: [],
    yt: [
      ["Daniel Naroditsky: speedrun series", YT("Naroditsky speedrun time management"), "how a GM manages the clock in practice (archive)"],
      ["Time management in chess: lectures", YT("chess time management lecture club player"), "several coaches on how to budget the clock"],
    ],
    free: [["Lichess Puzzle Storm", "https://lichess.org/storm", "solve simple tactics quickly: makes easy decisions automatic, which saves time in games"]],
  },
};

// Which theme an error belongs to: positional errors in the opening get their own opening theme
export function themeOf(e) { const c = errorCause(e); return c === "positional" && e.phase === "opening" ? "opening" : c; }

const PIECE = { K: "king", Q: "queen", R: "rook", B: "bishop", N: "knight", P: "pawn" };
const pieceOf = (san) => (/^[KQRBN]/.test(san || "") ? san[0] : /^O-O/.test(san || "") ? "K" : "P");
const pct = (n, t) => (t ? Math.round((100 * n) / t) : 0);

// everything you need for one theme, from the stored games
export function themeData(p, key) {
  const games = Object.values(p.games || {});
  const errs = [];
  for (const g of games) for (const e of g.errors || []) if ((e.label === "mistake" || e.label === "blunder") && themeOf(e) === key) errs.push({ ...e, g });
  const all = games.reduce((a, g) => a + (g.errors || []).filter((e) => e.label === "mistake" || e.label === "blunder").length, 0);
  return { errs: errs.sort((a, b) => b.drop - a.drop), all, games: games.length, lost: +(errs.reduce((a, e) => a + (e.drop || 0), 0) / Math.max(1, games.length)).toFixed(1) };
}

// patterns in your own errors of this theme, as short sentences with numbers
export function patterns(key, D) {
  const E = D.errs, n = E.length, out = [];
  if (!n) return out;
  out.push(`${n} of your ${D.all} mistakes and blunders (${pct(n, D.all)}%) are of this kind, costing ${D.lost} points of win chance per game on average.`);
  const bl = E.filter((e) => e.label === "blunder").length; if (bl) out.push(`${bl} of them (${pct(bl, n)}%) were blunders (−15% or more).`);
  const ahead = E.filter((e) => e.evalBefore >= 1.5).length, behind = E.filter((e) => e.evalBefore <= -1.5).length;
  if (ahead >= 2 && pct(ahead, n) >= 30) out.push(`${ahead} (${pct(ahead, n)}%) came when you were already better by 1.5 pawns or more: the danger is relaxing when ahead.`);
  if (behind >= 2 && pct(behind, n) >= 30) out.push(`${behind} (${pct(behind, n)}%) came when you were already worse: under pressure, defending accurately is the weak spot.`);
  const pc = {}; for (const e of E) { const k = pieceOf(e.played); pc[k] = (pc[k] || 0) + 1; }
  const top = Object.entries(pc).sort((a, b) => b[1] - a[1])[0];
  if (top && n >= 3 && pct(top[1], n) >= 35) out.push(`In ${top[1]} of them (${pct(top[1], n)}%) the move you played was a ${PIECE[top[0]]} move.`);
  if (key === "tactical") {
    const missed = E.filter((e) => /[x+#]/.test(e.best || "")).length, allowed = E.filter((e) => (e.tags || []).some((t) => /hung|allowed/.test(t))).length;
    out.push(`In ${missed} (${pct(missed, n)}%) the better move was itself a check or capture: a forcing move you didn't find. In ${allowed} (${pct(allowed, n)}%) your move left material or mate to your opponent.`);
    const mate = E.filter((e) => (e.tags || []).some((t) => /mate/.test(t))).length; if (mate) out.push(`${mate} involved a mate (missed or allowed).`);
  }
  if (key === "positional") {
    const pawn = E.filter((e) => pieceOf(e.played) === "P").length; if (pawn >= 2) out.push(`${pawn} (${pct(pawn, n)}%) were pawn moves. Pawn moves can't be taken back: they are the ones to check twice.`);
    const q = E.filter((e) => pieceOf(e.played) === "Q").length; if (q >= 2) out.push(`${q} were queen moves: the queen often goes on a trip while other pieces wait.`);
  }
  if (key === "opening") {
    const fam = {}; for (const e of E) { const f = e.g.opening || "?"; fam[f] = (fam[f] || 0) + 1; }
    const tf = Object.entries(fam).sort((a, b) => b[1] - a[1]).slice(0, 3);
    out.push(`Where: ${tf.map(([f, c]) => `${f} (${c})`).join(", ")}.`);
    const early = E.filter((e) => e.moveNo <= 8).length; if (early) out.push(`${early} came in the first 8 moves, inside known theory: worth looking up the line.`);
    const castleBest = E.filter((e) => /^O-O/.test(e.best || "")).length; if (castleBest) out.push(`In ${castleBest} Stockfish wanted you to castle.`);
  }
  if (key === "technique") {
    const types = {}; for (const e of E) { const t = e.g.endgame?.type || "?"; types[t] = (types[t] || 0) + 1; }
    out.push(`Endgame types: ${Object.entries(types).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t} (${c})`).join(", ")}.`);
    const king = E.filter((e) => pieceOf(e.best) === "K" && pieceOf(e.played) !== "K").length; if (king) out.push(`In ${king} the better move was a king move: king activity.`);
    const thrown = E.filter((e) => e.evalBefore >= 2).length; if (thrown) out.push(`${thrown} came in endgames you were winning (+2 or more).`);
  }
  if (key === "time") {
    const mv = Math.round(E.reduce((a, e) => a + e.moveNo, 0) / n);
    out.push(`On average around move ${mv}. ${E.filter((e) => e.clock != null && e.clock < 10).length} with less than 10 seconds left.`);
    const tc = {}; for (const e of E) { const t = e.g.tc || "?"; tc[t] = (tc[t] || 0) + 1; }
    out.push(`By time control: ${Object.entries(tc).map(([t, c]) => `${t} ${c}`).join(", ")}.`);
  }
  return out;
}

// a short explanation for one of your positions: what went wrong and which principle applies
export function explain(e) {
  const b = e.best || "", pl = e.played || "", t = e.tags || [], out = [];
  if (/#/.test(b)) out.push(`${b} was mate. Always check every check first: mates hide behind them.`);
  else if (/\+/.test(b) && /x/.test(b)) out.push(`${b} is a capture with check: the most forcing kind of move, and it was available.`);
  else if (/x/.test(b)) out.push(`${b} captures: scan all captures (also the ones that look like they lose material) before deciding.`);
  else if (/\+/.test(b)) out.push(`${b} is a check: a forcing move you didn't use.`);
  else if (/^O-O/.test(b)) out.push(`Stockfish wanted ${b}: king safety first.`);
  else if (pieceOf(b) === "K" && e.phase === "endgame") out.push(`${b}: activate the king, the strongest endgame piece.`);
  if (t.some((x) => /hung/.test(x))) out.push(`After ${pl} your opponent could win material: blunder check (their checks, captures and threats) before moving.`);
  if (t.some((x) => /allowed mate/.test(x))) out.push(`${pl} allowed a mate: look at your king's escape squares and their checks.`);
  if (t.includes("time trouble")) out.push(`You had ${e.clock != null ? `${e.clock}s` : "little time"} left: in time trouble, keep it simple and safe.`);
  if (e.evalBefore >= 2) out.push(`You were winning (${e.evalBefore > 0 ? "+" : ""}${e.evalBefore}). When ahead: remove your opponent's counterplay first, then simplify.`);
  if (!out.length && pieceOf(pl) === "P") out.push(`${pl} is a pawn move: it can't be undone and gives up squares. ${b} keeps the position flexible.`);
  if (!out.length) out.push(`${b} was better. The idea behind it shows in the engine line: ${e.bestLine || b}.`);
  return out;
}

export function deepDiveHtml(p, key, esc, elo) {
  const T = THEMES[key], D = themeData(p, key);
  const pats = patterns(key, D);
  const fit = (lo, hi) => elo >= lo - 100 && elo <= hi + 100;
  const books = T.books.filter(([, , lo, hi]) => fit(lo, hi));
  const bookList = (books.length ? books : T.books).map(([t, a, lo, hi, w]) => `<li><b>${esc(t)}</b> (${esc(a)}) <span class="muted small">${lo}–${hi}</span><br><span class="small">${esc(w)}</span></li>`).join("");
  const pos = D.errs.slice(0, 6);
  return `<div class="card"><h2>${esc(T.title)}</h2><p>${esc(T.what)}</p><p class="small muted">${esc(T.why)}</p>
    ${pats.length ? `<h3>In your games</h3><ul>${pats.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="muted">No mistakes or blunders of this kind in your analysed games.</p>`}</div>
    ${pos.length ? `<div class="card"><h2>Your positions</h2><p class="small muted">Your ${pos.length} costliest moves of this kind. Look at the position, find the better move yourself, then open the explanation.</p>
      <div class="ddpos">${pos.map((e, i) => `<div class="ddp">${miniBoard(e.fen, e.fen.split(" ")[1] === "b")}
        <div><b>Move ${e.moveNo}, ${e.fen.split(" ")[1] === "w" ? "White" : "Black"} to move</b> <span class="pill ${e.label}">−${Math.round(e.drop)}%</span>
        <div class="small muted">${esc(e.g.opening || "")}${e.g.date && !/\?/.test(e.g.date) ? ` · ${esc(e.g.date)}` : ""}${e.g.site && /^https?:/.test(e.g.site) ? ` · <a href="${esc(e.g.site)}" target="_blank" rel="noopener">game</a>` : ""}</div>
        <details class="small"><summary>Show what happened</summary><p>You played <b>${esc(e.played)}</b>; better was <b>${esc(e.best)}</b>${e.bestLine ? ` (${esc(e.bestLine)})` : ""}.</p><ul>${explain(e).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>
        <button class="btn secondary small" data-ddfen="${esc(e.fen)}">Open on board</button></div></div>`).join("")}</div></div>` : ""}
    <div class="card"><h2>Principles to follow</h2><ol class="ddprin">${T.principles.map(([h, x]) => `<li><b>${esc(h)}</b>. ${esc(x)}</li>`).join("")}</ol>
      <h3>Before every move</h3><ol class="small">${T.routine.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div>
    <div class="card"><h2>Train it here</h2><div class="row" style="gap:8px;flex-wrap:wrap">${T.train.map(([tab, arg, l]) => `<button class="btn secondary" data-ddgo="${tab}" data-ddarg="${esc(JSON.stringify(arg))}">${esc(l)}</button>`).join("")}</div></div>
    <div class="card"><h2>Learn more</h2>
      ${T.books.length ? `<h3>Books${books.length ? ` for around ${elo}` : ""}</h3><ul class="ddlist">${bookList}</ul>` : ""}
      <h3>YouTube</h3><ul class="ddlist">${T.yt.map(([n, u, w]) => `<li><a href="${u}" target="_blank" rel="noopener"><b>${esc(n)}</b></a><br><span class="small">${esc(w)}</span></li>`).join("")}</ul>
      <h3>Free on Lichess</h3><ul class="ddlist">${T.free.map(([n, u, w]) => `<li><a href="${u}" target="_blank" rel="noopener"><b>${esc(n)}</b></a><br><span class="small">${esc(w)}</span></li>`).join("")}</ul>
      <p class="small muted">The YouTube links open a search, so you always land on current videos. Rating ranges are a rough guide.</p></div>`;
}
