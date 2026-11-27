// Learn chess from zero: short lessons with exercises on the board, then games against an easy computer.
// Every exercise position has both kings (the rules engine needs them); lessons say when to ignore them.
import { Chess } from "./vendor/chess.js";
import { Board, IMG } from "./board.js";
import { lineToCp } from "./engine.js";

const PN = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const HOW = {
  r: "A rook moves in straight lines: up, down, left or right, as far as it likes, but it can't jump over pieces.",
  b: "A bishop moves diagonally, as far as it likes, and always stays on squares of the same colour.",
  q: "The queen moves like a rook and a bishop together: straight or diagonal, as far as she likes.",
  k: "The king moves one square in any direction, and may never move to a square where it can be taken.",
  n: "The knight jumps in an L: two squares one way, then one square to the side. It's the only piece that jumps over others.",
  p: "A pawn moves one square forward (two from its starting square) and captures one square diagonally forward. It never moves backwards.",
};

// type: reach (collect the stars, you keep moving), mate (checkmate in one), best (play one of the right moves), quiz
export const LESSONS = [
  { id: "goal", title: "The board and the goal", text: `<p>Chess is played on a board of 8×8 squares. Each player has 16 pieces: a king, a queen, two rooks, two bishops, two knights and eight pawns. <b>White moves first</b>, then the players take turns, one move each.</p><p>The goal is to <b>checkmate</b> the other king: attack it so that it can't escape. You'll learn exactly what that means in a few lessons. First: how each piece moves.</p><p class="small muted">Columns are called files (a to h), rows are ranks (1 to 8). So every square has a name, like e4.</p>`,
    ex: [
      { type: "show", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", msg: "This is how a game starts. White's pieces are at the bottom, Black's at the top. Tap \"Got it\" when you've had a look." },
      { type: "quiz", q: "What is the goal of a game of chess?", options: ["Capture all the opponent's pieces", "Checkmate the opponent's king", "Get a pawn to the other side"], answer: 1, explain: "Capturing pieces helps, but the game is won by checkmating the king." },
      { type: "quiz", q: "Who makes the first move?", options: ["White", "Black", "Whoever wants"], answer: 0, explain: "White always starts." },
    ] },
  { id: "setup", title: "Setting up the board", text: `<p>To play on a real board:</p><ol><li>Turn the board so each player has a <b>light square in the right-hand corner</b> ("light on the right").</li><li>Pawns fill the second row in front of each player.</li><li>In the corners the <b>rooks</b>, next to them the <b>knights</b>, then the <b>bishops</b>.</li><li>The <b>queen goes on her own colour</b>: the white queen on a light square (d1), the black queen on a dark square (d8). The king goes next to her.</li></ol>`,
    ex: [
      { type: "show", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", msg: "The starting position. Check: light square bottom right (h1), the white queen on d1, a light square." },
      { type: "quiz", q: "Which square must be in the right-hand corner in front of you?", options: ["A light square", "A dark square", "It doesn't matter"], answer: 0, explain: "\"Light on the right.\"" },
      { type: "quiz", q: "Where does the white queen start?", options: ["On the light square d1 (her own colour)", "On the dark square e1"], answer: 0, explain: "The queen goes on her own colour; the king next to her on e1." },
      { type: "quiz", q: "What stands in the corners?", options: ["Rooks", "Knights", "Kings"], answer: 0, explain: "Rooks in the corners, then knights, then bishops." },
    ] },
  { id: "rook", title: "The rook", piece: "r", text: `<p>${HOW.r}</p><p>Tap the rook (or drag it) and the dots show where it can go. Move it to the ★.</p>`,
    ex: [
      { type: "reach", fen: "8/8/7k/8/8/8/8/R5K1 w - - 0 1", targets: ["a8"], msg: "Move the rook to the star." },
      { type: "reach", fen: "k7/8/8/8/3R4/8/8/6K1 w - - 0 1", targets: ["d7", "h4"], msg: "Collect both stars, one move at a time." },
      { type: "reach", fen: "6k1/8/8/p3p3/8/8/8/R3K3 w - - 0 1", targets: ["a5", "e5"], msg: "Capture the two black pawns: move onto their square." },
    ] },
  { id: "bishop", title: "The bishop", piece: "b", text: `<p>${HOW.b}</p>`,
    ex: [
      { type: "reach", fen: "7k/8/8/8/8/8/8/2B3K1 w - - 0 1", targets: ["h6"], msg: "Move the bishop to the star." },
      { type: "reach", fen: "k7/8/8/8/3B4/8/8/6K1 w - - 0 1", targets: ["a7", "h8"], msg: "Collect both stars." },
      { type: "quiz", q: "A bishop stands on a dark square. Can it ever reach a light square?", options: ["Yes", "No"], answer: 1, explain: "A bishop moves only diagonally, so it stays on squares of one colour all game." },
    ] },
  { id: "queen", title: "The queen", piece: "q", text: `<p>${HOW.q} She is the strongest piece.</p>`,
    ex: [
      { type: "reach", fen: "1k6/8/8/8/8/8/8/3QK3 w - - 0 1", targets: ["d7", "a4", "h4"], msg: "Collect all three stars." },
      { type: "reach", fen: "6k1/1p6/8/8/8/5p2/8/Q5K1 w - - 0 1", targets: ["b7", "f3"], msg: "Capture both pawns." },
    ] },
  { id: "king", title: "The king", piece: "k", text: `<p>${HOW.k} If your king is attacked, you must deal with it right away. Losing the king (checkmate) loses the game.</p>`,
    ex: [
      { type: "reach", fen: "7k/8/8/8/8/8/8/K7 w - - 0 1", targets: ["c3"], msg: "Walk the king to the star (one square at a time)." },
      { type: "quiz", q: "May your king move to a square that an enemy piece attacks?", options: ["Yes, if it wants to", "No, never"], answer: 1, explain: "A king may never move into an attack. The game won't let you." },
    ] },
  { id: "knight", title: "The knight", piece: "n", text: `<p>${HOW.n} A knight always lands on a square of the other colour.</p>`,
    ex: [
      { type: "reach", fen: "7k/8/8/8/8/8/8/1N4K1 w - - 0 1", targets: ["c3"], msg: "Jump to the star." },
      { type: "reach", fen: "7k/8/8/8/8/8/8/1N4K1 w - - 0 1", targets: ["e4"], msg: "Now to this star: it takes two jumps." },
      { type: "reach", fen: "7k/8/8/3p4/8/2N5/8/6K1 w - - 0 1", targets: ["d5"], msg: "Capture the pawn. (Hint: from c3, a knight can reach d5 in one jump.)" },
    ] },
  { id: "pawn", title: "The pawn", piece: "p", text: `<p>${HOW.p} When a pawn reaches the last row, it <b>promotes</b>: it becomes a queen (or rook, bishop or knight, your choice).</p>`,
    ex: [
      { type: "reach", fen: "7k/8/8/8/8/8/4P3/6K1 w - - 0 1", targets: ["e4"], msg: "Move the pawn two squares forward (allowed from its starting square)." },
      { type: "reach", fen: "7k/8/8/8/3p4/4P3/8/6K1 w - - 0 1", targets: ["d4"], msg: "Capture the black pawn: pawns capture diagonally forward." },
      { type: "reach", fen: "8/3P4/7k/8/8/8/8/6K1 w - - 0 1", targets: ["d8"], msg: "Promote the pawn: move it to the last row and choose a queen." },
    ] },
  { id: "notation", title: "Reading moves", text: `<p>Moves are written with the piece letter and the square it goes to: <b>K</b> king, <b>Q</b> queen, <b>R</b> rook, <b>B</b> bishop, <b>N</b> knight (K is taken by the king). Pawns have no letter: <b>e4</b> is a pawn to e4.</p><p><b>x</b> means a capture, <b>+</b> check, <b>#</b> checkmate, <b>O-O</b> castling short, <b>O-O-O</b> castling long. A <b>?</b> marks a mistake, <b>!</b> a good move.</p>`,
    ex: [
      { type: "quiz", q: "What does Nf3 mean?", options: ["A knight moves to f3", "A pawn moves to f3", "The king moves to f3"], answer: 0, explain: "N is the knight." },
      { type: "quiz", q: "What does Bxe5+ mean?", options: ["Bishop to e5", "Bishop captures on e5, with check", "Bishop captures on e5, checkmate"], answer: 1, explain: "x = capture, + = check." },
      { type: "quiz", q: "And Qh7#?", options: ["Queen to h7, checkmate", "Queen to h7, check", "Queen to h7, a mistake"], answer: 0, explain: "# means checkmate." },
    ] },
  { id: "values", title: "Capturing and piece values", text: `<p>Pieces are not worth the same. A common guide: <b>pawn 1, knight 3, bishop 3, rook 5, queen 9</b>. The king can't be traded: it decides the game.</p><p>So taking a free piece is good, and giving away a strong piece for a weak one is bad. Before you capture, check whether the piece is defended.</p>`,
    ex: [
      { type: "quiz", q: "Which is worth more?", options: ["A rook (5)", "A knight and a pawn (3 + 1)"], answer: 0, explain: "5 against 4: the rook is worth a bit more." },
      { type: "best", fen: "6k1/5ppp/8/3q4/8/2N5/5PPP/6K1 w - - 0 1", ok: ["Nxd5"], msg: "Black's queen is not protected. Take it!", hint: "The knight on c3 can reach d5." },
      { type: "best", fen: "6k1/5ppp/4p3/3r3n/8/8/5PPP/3Q2K1 w - - 0 1", ok: ["Qxh5"], msg: "One black piece is free, the other is protected. Take the free one.", hint: "If you take the rook on d5, the pawn on e6 takes your queen back. What about the knight?" },
    ] },
  { id: "check", title: "Check", text: `<p>When a piece attacks the king, that's <b>check</b>. The player in check must get out of it at once, in one of three ways:</p><ol><li><b>Move</b> the king to a safe square,</li><li><b>Capture</b> the piece that gives check,</li><li><b>Block</b>: put a piece in between.</li></ol>`,
    ex: [
      { type: "best", fen: "4r1k1/8/8/8/8/8/3P1P2/R3K3 w - - 0 1", ok: ["Kd1", "Kf1"], msg: "Your king is in check from the rook on e8. Move the king out of check.", hint: "Squares next to the king that the rook doesn't attack." },
      { type: "best", fen: "6k1/8/8/8/1b6/8/4P3/2BQK3 w - - 0 1", ok: ["Bd2", "Qd2"], msg: "Check from the bishop on b4! Block it: put a piece in between.", hint: "The squares between the bishop and your king are c3 and d2. Which of your pieces can go there?" },
      { type: "best", fen: "4k3/8/8/8/8/8/4q3/4K3 w - - 0 1", ok: ["Kxe2"], msg: "Check from the queen! Capture it with your king: nothing protects it.", hint: "The king can take a piece next to it, if that piece isn't protected." },
    ] },
  { id: "mate", title: "Checkmate", text: `<p><b>Checkmate</b> is check with no way out: the king can't move to safety, the checking piece can't be captured, and the check can't be blocked. Checkmate ends the game.</p><p>Find the checkmate in one move in each position.</p>`,
    ex: [
      { type: "mate", fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", msg: "Checkmate in one move.", hint: "The black king is stuck behind its own pawns. Use the back row." },
      { type: "mate", fen: "7k/8/6K1/8/8/8/8/1Q6 w - - 0 1", msg: "Checkmate in one move.", hint: "Your king guards g7 and h7. Where can the queen give check?" },
      { type: "mate", fen: "k7/8/1K6/8/8/8/8/7R w - - 0 1", msg: "Checkmate in one move.", hint: "Your king keeps the black king on the edge." },
      { type: "mate", fen: "6k1/5p1p/6pQ/8/8/8/1B6/6K1 w - - 0 1", msg: "Checkmate in one move.", hint: "Your bishop on b2 points at g7." },
    ] },
  { id: "special", title: "Special moves and draws", text: `<p>Three rules that don't fit the normal moves: castling, en passant, and draws. One at a time.</p>`,
    ex: [
      { type: "best", intro: "<b>Castling</b>: once per game, the king moves two squares toward a rook, and the rook jumps to the other side of the king. Only if neither has moved, the squares between are empty, and the king isn't in check and doesn't cross an attacked square. It puts your king in safety.", fen: "r3k2r/pppq1ppp/2npbn2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 1", ok: ["O-O"], msg: "Castle short: drag the king two squares to the right.", hint: "Move the king from e1 to g1." },
      { type: "best", intro: "<b>En passant</b>: if an enemy pawn moves two squares and lands right next to your pawn, you may take it as if it had moved only one square. Only on the very next move.", fen: "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", ok: ["exd6"], msg: "Black just played d7-d5. Capture en passant.", hint: "Your pawn on e5 takes diagonally onto d6." },
      { type: "mate", intro: "<b>Stalemate</b> is the classic way to throw away a won game: the other side has no legal move but isn't in check. That's a draw!", fen: "7k/8/6K1/8/8/8/8/5Q2 w - - 0 1", msg: "Give checkmate in one, and don't stalemate! (Qf7 would be stalemate.)", hint: "Check the king along the back row, where your king covers the escape squares." },
      { type: "quiz", intro: "<b>Draws</b>: a game can also end equal: by stalemate, by the same position three times, by 50 moves without a capture or pawn move, or when nobody has enough pieces left to checkmate.", q: "Black to move: the black king isn't in check, but has no legal move. What happens?", options: ["Black loses", "It's a draw (stalemate)", "Black skips a turn"], answer: 1, explain: "Stalemate is a draw. Careful when you're winning: leave the king a square!" },
    ] },
  { id: "opening", title: "How to start a game", text: `<p>Three habits that make your first moves good:</p><ol><li><b>Take the centre</b> with a pawn (e4 or d4).</li><li><b>Develop</b>: bring knights and bishops out, towards the centre. Don't move the same piece twice without a reason.</li><li><b>Castle</b> early, so your king is safe.</li></ol><p>And on every move: <b>can my opponent take something of mine?</b> That one question saves most beginner games.</p>`,
    ex: [
      { type: "best", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", ok: ["e4", "d4"], msg: "Your first move: take the centre with a pawn.", hint: "The pawn in front of your king or queen, two squares." },
      { type: "best", fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1", ok: ["Nf3", "Nc3", "Bc4"], msg: "Now develop a piece towards the centre.", hint: "A knight or a bishop." },
      { type: "best", fen: "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1", ok: ["O-O"], msg: "Knight and bishop are out. Make your king safe.", hint: "Castle short." },
    ] },
];

export const LEVELS = [
  { n: 1, label: "Level 1 · just learning (≈400)", depth: 1, rand: 0.45, margin: 400 },
  { n: 2, label: "Level 2 · beginner (≈600)", depth: 2, rand: 0.28, margin: 250 },
  { n: 3, label: "Level 3 · casual (≈800)", depth: 4, rand: 0.16, margin: 150 },
  { n: 4, label: "Level 4 · club beginner (≈1000)", depth: 6, rand: 0.08, margin: 80 },
  { n: 5, label: "Level 5 · improving (≈1300)", depth: 9, rand: 0.03, margin: 40 },
  { n: 6, label: "Level 6 · club player (≈1600)", depth: 12, rand: 0, margin: 15 },
];

const sanOf = (fen, mv) => { try { return new Chess(fen).move(mv).san; } catch { return null; } };

export function learnView(v, arg, C) {
  const p = C.P(); p.learn ||= {};
  if (arg && arg.lesson) return lessonView(v, arg.lesson, C);
  if (arg && arg.play) return playView(v, C);
  const done = LESSONS.filter((l) => p.learn[l.id]).length;
  const next = LESSONS.find((l) => !p.learn[l.id]);
  const games = p.learn.games || [];
  v.innerHTML = `<div class="card"><h2>Learn the basics</h2><p>Short lessons on the rules, each with a few exercises on the board. Then play the computer at an easy level. ${done ? `<b>${done} of ${LESSONS.length}</b> lessons done.` : "About 30 minutes in total; do one or two a day."}</p>
      <div class="progress" style="margin:8px 0">${LESSONS.map((l) => `<span class="${p.learn[l.id] ? "done" : ""}"></span>`).join("")}</div>
      ${next ? `<button class="btn" data-lesson="${next.id}">${done ? "Continue" : "Start"}: ${C.esc(next.title)}</button>` : `<p><b>All lessons done!</b> Now play the computer, then load your games to find what to improve.</p>`}</div>
    <div class="card"><h2>Lessons</h2><div class="lessons">${LESSONS.map((l, i) => `<button class="lesson ${p.learn[l.id] ? "done" : ""}" data-lesson="${l.id}"><span class="n">${p.learn[l.id] ? "✓" : i + 1}</span><span>${C.esc(l.title)}<br><span class="small muted">${l.ex.length} exercise${l.ex.length === 1 ? "" : "s"}</span></span></button>`).join("")}</div></div>
    <div class="card"><h2>Play the computer</h2><p class="small">A full game against the computer at an easy level, with a hint button and take-backs. Start at level 1 and go up when you win.</p>
      ${games.length ? `<p class="small muted">Your games: ${games.length} · won ${games.filter((g) => g.res === "win").length} · best level won: ${Math.max(0, ...games.filter((g) => g.res === "win").map((g) => g.level))}</p>` : ""}
      <button class="btn ${next && done < 6 ? "secondary" : ""}" id="playBtn">Play a game</button></div>`;
  v.querySelectorAll("[data-lesson]").forEach((b) => (b.onclick = () => C.go("learn", { lesson: b.dataset.lesson })));
  v.querySelector("#playBtn").onclick = () => C.go("learn", { play: true });
}

// what a move is in words, for beginners: "the knight to e4 (Ne4)"
const say = (m) => {
  if (m.san.startsWith("O-O")) return `castling (${m.san})`;
  const where = m.captured ? (m.flags.includes("e") ? `takes the pawn on ${m.to[0]}${m.from[1]} en passant` : `takes the ${PN[m.captured]} on ${m.to}`) : `to ${m.to}`;
  return `the ${PN[m.piece]} ${where}${m.san.replace(/[+#]/g, "") === m.to ? "" : ` (${m.san})`}`;
};
const Cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// the names under the pieces, for the first lessons
const LEGEND = `<div class="plegend small">${[["k", "K", "king"], ["q", "Q", "queen"], ["r", "R", "rook"], ["b", "B", "bishop"], ["n", "N", "knight"], ["p", "P", "pawn"]].map(([t, u, n]) => `<span><img src="${IMG[u]}" alt="" width="26" height="26">${n}</span>`).join("")}</div>`;

function lessonView(v, id, C) {
  const p = C.P(); const L = LESSONS.find((l) => l.id === id); if (!L) return C.go("learn");
  const at = (p.learn.at ||= {});
  const okKey = L.id + ":ok";
  let k = Math.min(at[L.id] || 0, L.ex.length - 1), ok = k ? at[okKey] || 0 : 0;
  const idx = LESSONS.indexOf(L), nextL = LESSONS[idx + 1];
  // one column, in reading order: the lesson text, the task, the board, then right under it feedback and buttons
  v.innerHTML = `<div class="learnone">
    <div class="tstrip"><span class="tsl"><b>${idx + 1}. ${C.esc(L.title)}</b></span><span class="tsr"><span class="pill" id="lxn"></span></span></div>
    <details class="card ltext" ${k === 0 ? "open" : ""}><summary><b>About this lesson</b></summary>${L.text}</details>
    <div id="lmsg" class="ltask"></div><div id="lb"></div>
    <div id="lfb"></div><div class="row" style="gap:8px;margin-top:8px" id="lbtns"></div>
    <div class="row" style="gap:8px;margin-top:14px"><button class="btn secondary small" id="lback">All lessons</button></div></div>`;
  v.querySelector("#lback").onclick = () => C.go("learn");
  const bEl = v.querySelector("#lb");
  let brd = null;
  const fb = (cls, html) => (v.querySelector("#lfb").innerHTML = html ? `<div class="feedback ${cls}" style="margin-top:8px">${html}</div>` : "");
  const btns = (html) => (v.querySelector("#lbtns").innerHTML = html);
  const top = () => { const el = v.querySelector(".tstrip"); if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" }); };
  const finish = () => {
    p.learn[L.id] = true; delete at[L.id]; delete at[okKey]; C.save(); C.logEvent && C.logEvent("training", `Lesson done: ${L.title}`);
    bEl.innerHTML = ""; v.querySelector("#lxn").textContent = "Done";
    v.querySelector("#lmsg").innerHTML = `<b>Lesson done!</b> ${ok} of ${L.ex.length} exercises right first time.`;
    fb("ok", nextL ? `Next: <b>${C.esc(nextL.title)}</b>.` : "That was the last lesson. Time to play a game!");
    btns(nextL ? `<button class="btn" id="lnext">Next lesson</button><button class="btn secondary" id="lagain">Do it again</button>` : `<button class="btn" id="lplay">Play the computer</button>`);
    if (nextL) { v.querySelector("#lnext").onclick = () => C.go("learn", { lesson: nextL.id }); v.querySelector("#lagain").onclick = () => { at[L.id] = 0; C.go("learn", { lesson: L.id }); }; }
    else v.querySelector("#lplay").onclick = () => C.go("learn", { play: true });
    top();
  };
  const show = () => {
    if (k >= L.ex.length) return finish();
    at[L.id] = k; at[okKey] = ok; C.save();
    setTimeout(() => (bEl.firstChild || v.querySelector("#lmsg")).scrollIntoView({ block: "nearest" }), 30);
    const E = L.ex[k]; let first = true;
    if (k > 0) v.querySelector(".ltext").open = false;
    v.querySelector("#lxn").textContent = `Exercise ${k + 1} of ${L.ex.length}`;
    fb("", ""); btns(""); top();
    const intro = E.intro ? `<div class="small" style="margin-bottom:6px">${E.intro}</div>` : "";
    const advance = () => { if (first) ok++; k++; btns(`<button class="btn" id="lgo">${k >= L.ex.length ? "Finish" : "Next exercise"}</button>`); v.querySelector("#lgo").onclick = show; };
    const miss = () => { first = false; };
    if (E.type === "quiz") {
      bEl.innerHTML = ""; brd = null;
      v.querySelector("#lmsg").innerHTML = `${intro}<b>${C.esc(E.q)}</b>`;
      btns(E.options.map((o, i) => `<button class="btn secondary" data-opt="${i}">${C.esc(o)}</button>`).join(""));
      v.querySelectorAll("[data-opt]").forEach((b) => (b.onclick = () => {
        if (+b.dataset.opt === E.answer) { fb("ok", `Right! ${C.esc(E.explain)}`); advance(); }
        else { miss(); fb("bad", `Not quite. ${E.hint ? C.esc(E.hint) : "The answer is in the lesson text above"}. Try again.`); b.disabled = true; v.querySelector(".ltext").open = !E.hint; }
      }));
      return;
    }
    bEl.innerHTML = ""; const el = document.createElement("div"); bEl.appendChild(el);
    brd = new Board(el, { orientation: "w" });
    let left = (E.targets || []).slice();
    const reset = () => { left = (E.targets || []).slice(); brd.setFen(E.fen); brd.setMarks(Object.fromEntries(left.map((s) => [s, "star"]))); brd.locked = false; fb("", ""); };
    reset();
    v.querySelector("#lmsg").innerHTML = `${intro}<b>${C.esc(E.msg)}</b>`;
    if (idx <= 1 || L.piece) v.querySelector("#lmsg").insertAdjacentHTML("beforeend", LEGEND);
    if (E.type === "show") { brd.locked = true; btns(`<button class="btn" id="lgot">Got it</button>`); v.querySelector("#lgot").onclick = () => { k++; show(); }; return; }
    const helpBtns = () => btns(`${E.hint ? `<button class="btn secondary small" id="lhint">Hint</button>` : ""}<button class="btn secondary small" id="lreset">Start this exercise again</button>`);
    helpBtns();
    const bindHelp = () => { const h = v.querySelector("#lhint"); if (h) h.onclick = () => fb("info", C.esc(E.hint)); const r = v.querySelector("#lreset"); if (r) r.onclick = reset; };
    bindHelp();
    brd.onIllegal = (from, to, pc) => {
      if (pc.color !== "w") return fb("info", "That's a black piece: you play White here.");
      if (brd.chess.inCheck()) return fb("info", "Your king is in check! First get out of check: move the king, capture the piece that gives check, or block it.");
      fb("info", `The ${PN[pc.type]} can't go there. ${HOW[pc.type]}`);
    };
    brd.onMove = (m, before) => {
      if (E.type === "reach") {
        if (!left.includes(m.to)) fb("info", E.targets.length > 1 || /two|jumps|walk/i.test(E.msg) || m.piece === "k" ? `You moved ${say(m)}. Keep going.` : `You moved ${say(m)}: a legal move, but not to the star. Keep going from here, or start again.`);
        else { left = left.filter((s) => s !== m.to); fb("ok", left.length ? "★ Got it! Next star." : "★ Well done!"); }
        // you keep the move: White to move again (the black pieces stand still in these exercises)
        const parts = brd.fen().split(" "); parts[1] = "w"; parts[3] = "-";
        try { brd.setFen(parts.join(" "), { last: [m.from, m.to] }); } catch { brd.setFen(before); }
        brd.setMarks(Object.fromEntries(left.map((s) => [s, "star"])));
        // stuck: a pawn that went past its target can't come back
        // stuck: pawns never go back, so a star behind (or too far to the side of) every pawn can't be reached anymore
        const wp = brd.chess.board().flat().filter((x) => x && x.color === "w" && x.type !== "k");
        const canReach = (t) => wp.some((x) => x.type !== "p" || (+t[1] > +x.square[1] && Math.abs(t.charCodeAt(0) - x.square.charCodeAt(0)) <= +t[1] - +x.square[1]));
        if (left.length && m.piece === "p" && !left.every(canReach)) { fb("bad", "Your pawn can't reach the star anymore: pawns never go back. Start this exercise again."); btns(`<button class="btn" id="lreset">Start this exercise again</button>`); bindHelp(); }
        if (!left.length) { brd.locked = true; advance(); }
        return;
      }
      if (E.type === "mate") {
        if (brd.chess.isCheckmate()) { fb("ok", `Checkmate! You played ${say(m)}: the king is attacked and has no way out.`); brd.locked = true; advance(); return; }
        miss(); const chk = brd.chess.inCheck();
        // where can the king go? say it, so the next try is a real try
        const esc2 = chk ? brd.chess.moves({ verbose: true }) : [];
        const kEsc = esc2.filter((x) => x.piece === "k").map((x) => x.to), capChk = esc2.find((x) => x.captured && x.to === m.to), blk = esc2.find((x) => x.piece !== "k" && !x.captured);
        if (!chk && brd.chess.isStalemate()) fb("bad", `Careful: that's <b>stalemate</b>. The king isn't in check but has no legal move, so the game is a draw. Try again: give check.`);
        else fb("bad", chk ? `${C.esc(Cap(say(m)))} is check, but not mate: ${kEsc.length ? `the king can escape to ${kEsc.join(" or ")}` : capChk ? `your piece can be taken (${capChk.san})` : blk ? `the check can be blocked (${blk.san})` : "there's a way out"}. Try again.` : `${C.esc(Cap(say(m)))} is not check. Checkmate always starts with a check. Try again.`);
        setTimeout(() => brd.setFen(E.fen), 1200); return;
      }
      if (E.type === "best") {
        const okList = E.ok.map((x) => sanOf(E.fen, x) || x);
        if (okList.includes(m.san)) { fb("ok", `Yes! ${C.esc(Cap(say(m)))}.`); brd.locked = true; advance(); return; }
        miss();
        // why it's wrong, when we can tell: the piece you took was protected, or your piece can now be taken
        const back = brd.chess.moves({ verbose: true }).find((x) => x.to === m.to && x.captured);
        const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 99 };
        const why = m.captured && back ? ` That ${PN[m.captured]} was protected: ${back.san} takes your ${PN[m.piece]} back${VAL[m.piece] > VAL[m.captured] ? `, and your ${PN[m.piece]} is worth more` : ""}.` : back ? ` After it, your ${PN[m.piece]} can be taken (${back.san}).` : "";
        fb("bad", `You played ${C.esc(say(m))}. That's not it here.${C.esc(why)}${!why && E.hint ? ` Hint: ${C.esc(E.hint)}` : ""} Try again.`);
        setTimeout(() => brd.setFen(E.fen), 1600);
      }
    };
  };
  show();
}

// ------------------------------------------------------------------ play the computer
function playView(v, C) {
  const p = C.P(); p.learn ||= {};
  const st = (p.learn.play ||= { level: 1, color: "w" });
  v.innerHTML = `<div class="two"><div><div class="tstrip"><span class="tsl"><b id="pst">Your move</b></span><span class="tsr"><span class="pill" id="plv"></span></span></div><div id="gb"></div>
      <div class="row" style="gap:8px;margin-top:8px"><button class="btn secondary" id="gundo">↶ Take back</button><button class="btn secondary" id="ghint">Hint</button><button class="btn secondary" id="gnew">New game</button></div><div id="gfb" style="margin-top:8px"></div></div>
    <div><div class="card"><h2>Play the computer</h2>
      <label class="f">Level<select id="glevel">${LEVELS.map((L) => `<option value="${L.n}" ${L.n === st.level ? "selected" : ""}>${L.label}</option>`).join("")}</select></label>
      <label class="f">You play<select id="gcol"><option value="w" ${st.color === "w" ? "selected" : ""}>White (you start)</option><option value="b" ${st.color === "b" ? "selected" : ""}>Black</option></select></label>
      <p class="small muted">Changing the level or colour starts a new game. Before every move ask: <b>what does my opponent attack, and can they take something of mine after my move?</b></p>
      <div class="small" id="gmoves"></div></div>
      <button class="btn secondary" id="gback">Back to the lessons</button></div></div>`;
  const L = () => LEVELS.find((x) => x.n === st.level) || LEVELS[0];
  v.querySelector("#plv").textContent = L().label.split(" · ")[0];
  const brd = new Board(v.querySelector("#gb"), { orientation: st.color });
  const eng = C.engine();
  let over = false, thinking = false, gen = 0;
  const fb = (cls, h) => (v.querySelector("#gfb").innerHTML = h ? `<div class="feedback ${cls}">${h}</div>` : "");
  // the game survives a reload (phones reload tabs when you switch apps)
  const keep = () => { st.moves = over ? [] : brd.chess.history(); C.save(); };
  const status = () => {
    const c = brd.chess; keep(); v.querySelector("#gmoves").textContent = c.history().length ? c.history().map((m, i) => (i % 2 ? m : `${i / 2 + 1}. ${m}`)).join(" ") : "";
    if (c.isCheckmate()) { const youWon = c.turn() !== st.color; end(youWon ? "win" : "loss", youWon ? "Checkmate: you win! 🎉" : "Checkmate: the computer wins. Look at the last moves: what did you miss?"); return true; }
    if (c.isDraw() || c.isStalemate()) { end("draw", c.isStalemate() ? "Stalemate: it's a draw (the side to move has no legal move but isn't in check)." : "Draw."); return true; }
    v.querySelector("#pst").textContent = c.turn() === st.color ? (c.inCheck() ? "Your move: you're in check!" : "Your move") : "The computer is thinking…";
    return false;
  };
  const end = (res, msg) => {
    over = true; st.moves = []; brd.locked = true; v.querySelector("#pst").textContent = "Game over";
    fb(res === "win" ? "ok" : res === "loss" ? "bad" : "info", `${msg}<div class="row" style="gap:8px;margin-top:8px">${res === "win" && st.level < LEVELS.length ? `<button class="btn small" id="gup">Try level ${st.level + 1}</button>` : ""}<button class="btn secondary small" id="grev">Look at my mistakes</button></div>`);
    const rv = v.querySelector("#grev"); if (rv && C.analysePgn) rv.onclick = () => {
      const c = brd.chess, d = C.today().replace(/-/g, ".");
      const H = { Event: "Game vs computer", Site: "computer-" + Date.now(), Date: d, White: st.color === "w" ? p.name : `Computer level ${st.level}`, Black: st.color === "b" ? p.name : `Computer level ${st.level}`, Result: c.isCheckmate() ? (c.turn() === "w" ? "0-1" : "1-0") : "1/2-1/2" };
      const g = new Chess(); for (const mv of c.history()) g.move(mv); for (const [k2, x] of Object.entries(H)) g.setHeader(k2, x);
      const pgn = g.pgn();
      C.analysePgn(pgn, p.name);
    };
    (p.learn.games ||= []).push({ level: st.level, res, date: C.today(), moves: brd.chess.history().length }); C.save();
    C.logEvent && C.logEvent("training", `Game vs computer level ${st.level}: ${res}`);
    const up = v.querySelector("#gup"); if (up) up.onclick = () => { st.level++; C.save(); C.go("learn", { play: true }); };
  };
  const pick = async () => {
    const my = ++gen; thinking = true; brd.locked = true; status();
    const c = brd.chess, fen = c.fen(), lv = L();
    const legal = c.moves({ verbose: true });
    let mv = null;
    await new Promise((r) => setTimeout(r, 350));
    if (Math.random() < lv.rand) mv = legal[Math.floor(Math.random() * legal.length)];
    else {
      try {
        const lines = await eng.analyse(fen, { depth: lv.depth, multipv: 4, tag: "play" });
        const best = lineToCp(lines[0]);
        const ok = lines.filter((l) => l && l.pv && l.pv[0] && best - lineToCp(l) <= lv.margin);
        const ch = ok[Math.floor(Math.random() * ok.length)] || lines[0];
        mv = { from: ch.pv[0].slice(0, 2), to: ch.pv[0].slice(2, 4), promotion: ch.pv[0][4] };
      } catch { mv = legal[Math.floor(Math.random() * legal.length)]; }
    }
    if (my !== gen || over) return;
    const r = brd.play({ from: mv.from, to: mv.to, promotion: mv.promotion || "q" });
    thinking = false; if (!status()) brd.locked = false;
    if (r && r.captured) fb("info", `The computer took your ${PN[r.captured]} with ${C.esc(r.san)}.`);
  };
  brd.onMove = () => { fb("", ""); if (status()) return; pick(); };
  brd.onIllegal = (from, to, pc) => { if (pc.color !== st.color) return; fb("info", `The ${PN[pc.type]} can't go there${brd.chess.inCheck() ? " (you're in check: first get out of check)" : ""}. ${HOW[pc.type]}`); };
  const start = (resume) => { gen++; over = false; brd.setFen(new Chess().fen()); brd.setOrientation(st.color); brd.locked = false; fb("", "");
    if (resume && st.moves && st.moves.length) { for (const mv of st.moves) { try { brd.chess.move(mv); } catch { break; } } brd.render(); fb("info", "Your game continues where you left it."); }
    status(); if (!over && brd.chess.turn() !== st.color) pick(); };
  v.querySelector("#gnew").onclick = () => start(false);
  v.querySelector("#glevel").onchange = (e) => { st.level = +e.target.value; C.save(); C.go("learn", { play: true }); };
  v.querySelector("#gcol").onchange = (e) => { st.color = e.target.value; C.save(); C.go("learn", { play: true }); };
  v.querySelector("#gback").onclick = () => C.go("learn");
  v.querySelector("#gundo").onclick = () => { if (thinking) return; gen++; const c = brd.chess; if (!c.history().length) return; c.undo(); if (c.turn() !== st.color && c.history().length) c.undo();
    over = false; brd.sel = null; brd.last = null; brd.arrows = []; brd.render(); brd.locked = false; fb("", ""); status(); };
  v.querySelector("#ghint").onclick = async () => {
    if (over || thinking) return; fb("info", "Looking for a good move…");
    try { const [l] = await eng.analyse(brd.chess.fen(), { depth: 10, tag: "hint" }); const san = sanOf(brd.chess.fen(), { from: l.pv[0].slice(0, 2), to: l.pv[0].slice(2, 4), promotion: l.pv[0][4] });
      brd.setArrows([{ from: l.pv[0].slice(0, 2), to: l.pv[0].slice(2, 4) }]); fb("info", `Try <b>${C.esc(san)}</b> (the green arrow).`); } catch { fb("info", "No hint available right now."); }
  };
  start(true);
}
