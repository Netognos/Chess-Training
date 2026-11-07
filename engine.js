// Stockfish UCI wrapper. Works with a Web Worker (browser) or any object
// with postMessage/onmessage-style plumbing (see makeNodeTransport in tests).

export class Engine {
  constructor(transport) {
    this.t = transport;
    this.listeners = new Set();
    this.t.onLine = (line) => this.listeners.forEach((f) => f(line));
    this.queue = Promise.resolve();
    this.ready = this._wait("uci", "uciok").then(() => {
      this.t.send("setoption name Hash value 32");
      return this._wait("isready", "readyok");
    });
  }

  static browser(url = "vendor/stockfish/stockfish-19-lite-single.js") {
    const w = new Worker(url);
    const t = { send: (c) => w.postMessage(c), onLine: null };
    w.onmessage = (e) => { if (typeof e.data === "string" && t.onLine) e.data.split("\n").forEach((l) => l && t.onLine(l)); };
    w.onerror = (e) => console.error("Stockfish worker error", e);
    return new Engine(t);
  }

  _wait(cmd, token) {
    return new Promise((res) => {
      const f = (l) => { if (l.startsWith(token)) { this.listeners.delete(f); res(); } };
      this.listeners.add(f);
      this.t.send(cmd);
    });
  }

  newGame() {
    this.queue = this.queue.then(() => { this.t.send("ucinewgame"); return this._wait("isready", "readyok"); });
    return this.queue;
  }

  // Returns [{multipv, cp, mate, pv:[uci...], depth}] with scores from the SIDE TO MOVE's point of view.
  analyse(fen, { movetime = 150, depth = null, multipv = 1 } = {}) {
    const job = async () => {
      await this.ready;
      const lines = new Map();
      const done = new Promise((res) => {
        const f = (l) => {
          if (l.startsWith("info") && l.includes(" pv ")) {
            const mp = +(l.match(/ multipv (\d+)/) || [0, 1])[1];
            const d = +(l.match(/ depth (\d+)/) || [0, 0])[1];
            const cp = l.match(/ score cp (-?\d+)/);
            const mate = l.match(/ score mate (-?\d+)/);
            if (l.includes(" lowerbound") || l.includes(" upperbound")) return;
            const pv = l.split(" pv ")[1].trim().split(/\s+/);
            lines.set(mp, { multipv: mp, depth: d, cp: cp ? +cp[1] : null, mate: mate ? +mate[1] : null, pv });
          } else if (l.startsWith("bestmove")) {
            this.listeners.delete(f);
            const best = l.split(" ")[1];
            if (!lines.size && best && best !== "(none)") lines.set(1, { multipv: 1, depth: 0, cp: 0, mate: null, pv: [best] });
            res();
          }
        };
        this.listeners.add(f);
      });
      this.t.send(`setoption name MultiPV value ${multipv}`);
      this.t.send(`position fen ${fen}`);
      this.t.send(depth ? `go depth ${depth}` : `go movetime ${movetime}`);
      await done;
      return [...lines.values()].sort((a, b) => a.multipv - b.multipv);
    };
    const p = this.queue.then(job);
    this.queue = p.catch(() => {});
    return p;
  }
}

// Score helpers -------------------------------------------------------------
export const MATE_CP = 10000;
export function lineToCp(line) {
  if (!line) return 0;
  if (line.mate !== null && line.mate !== undefined) {
    if (line.mate === 0) return -MATE_CP; // side to move is mated
    return line.mate > 0 ? MATE_CP - line.mate : -MATE_CP - line.mate;
  }
  return line.cp ?? 0;
}
export function winPct(cp) {
  const c = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}
export function moveAccuracy(wpBefore, wpAfter) {
  const d = Math.max(0, wpBefore - wpAfter);
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * d) - 3.1669));
}
export function fmtScore(line, flipForBlack = false) {
  if (!line) return "?";
  if (line.mate !== null && line.mate !== undefined) return `#${flipForBlack ? -line.mate : line.mate}`;
  const v = (flipForBlack ? -line.cp : line.cp) / 100;
  return (v > 0 ? "+" : "") + v.toFixed(2);
}
