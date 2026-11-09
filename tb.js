// Lichess Syzygy tablebases (positions with up to 7 pieces): perfect knowledge of win / draw / loss.
// Used in the endgame trainer so the computer side plays the most testing move instead of "any move that wins / holds".
import { Chess } from "./vendor/chess.js";

const URL = "https://tablebase.lichess.ovh/standard?fen=";
const cache = new Map();
const pieces = (fen) => fen.split(" ")[0].replace(/[^a-zA-Z]/g, "").length;

// result for the side to move → TB JSON, or null (more than 7 pieces, offline, rate-limited…)
export async function probe(fen) {
  if (pieces(fen) > 7) return null;
  const key = fen.split(" ").slice(0, 4).join(" ");
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    for (let tries = 0; tries < 2; tries++) {
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
        const r = await fetch(URL + encodeURIComponent(fen), { signal: ctl.signal }); clearTimeout(t);
        if (r.status === 429) { await new Promise((res) => setTimeout(res, 1200)); continue; }
        if (!r.ok) return null;
        return await r.json();
      } catch { /* network */ }
    }
    return null;
  })();
  cache.set(key, p);
  const res = await p; if (!res) cache.delete(key);
  return res;
}

// How good a move is for the side that plays it. Each TB move carries the result for the OPPONENT after the move.
const SCORE = { loss: 3, "maybe-loss": 2.5, "blessed-loss": 2, draw: 2, "cursed-win": 2, "maybe-win": 1, win: 0, unknown: 2 };
export const moveScore = (m) => SCORE[m.category] ?? 2;
export const resultWord = (s) => (s >= 3 ? "win" : s >= 2 ? "draw" : "loss");
const after = (fen, uci) => { const c = new Chess(fen); c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); return c.fen(); };

// The computer's move: keep the best result, and among equally good moves choose the one that leaves you the fewest
// good answers (the most testing move). When losing it also prefers long resistance (Lichess lists those first).
export async function testingMove(fen) {
  const t = await probe(fen);
  if (!t || !t.moves?.length) return null;
  const best = Math.max(...t.moves.map(moveScore));
  const cands = t.moves.filter((m) => moveScore(m) === best);
  if (best >= 3 || cands.length === 1) return { move: cands[0], best, tb: t }; // winning: fastest win (listed first)
  let pick = cands[0], fewest = Infinity;
  for (const m of cands.slice(0, 5)) {
    const a = await probe(after(fen, m.uci)); if (!a || !a.moves?.length) continue;
    const top = Math.max(...a.moves.map(moveScore));
    const nGood = a.moves.filter((x) => moveScore(x) === top).length;
    if (nGood < fewest) { fewest = nGood; pick = m; }
  }
  return { move: pick, best, tb: t };
}

// Grade a move that was played in `fen`: did it keep the best possible result?
export async function gradeTB(fen, uci) {
  const t = await probe(fen);
  if (!t || !t.moves?.length) return null;
  const m = t.moves.find((x) => x.uci === uci); if (!m) return null;
  const best = Math.max(...t.moves.map(moveScore));
  const mine = moveScore(m);
  const good = t.moves.filter((x) => moveScore(x) === best).map((x) => x.san);
  return { ok: mine >= best, before: resultWord(best), after: resultWord(mine), good, bestUci: t.moves.find((x) => moveScore(x) === best).uci, dtz: m.dtz };
}
