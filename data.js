// Training content: endgame drills, recommendations, study split, openings.

// side = the side YOU play. If it is not that side's turn, the engine moves first.
// goal: "win" (mate / promote and keep a winning eval) or "draw" (hold for 20 moves or reach a drawn ending).
// grade: "engine" = moves graded by Stockfish; "theory" = engine eval is unreliable without tablebases.
export const ENDGAMES = [
  { id: "kqk", level: "Beginner (<1000)", theme: "Mate with K+Q vs K", fen: "8/8/8/4k3/8/8/8/3QK3 w - - 0 1",
    side: "w", goal: "win", grade: "engine",
    idea: "Put your queen a knight's move away from the enemy king to shrink its box, then bring your own king. Watch out for stalemate." },
  { id: "krk", level: "Beginner (<1000)", theme: "Mate with K+R vs K", fen: "8/8/8/4k3/8/8/8/R3K3 w - - 0 1",
    side: "w", goal: "win", grade: "engine",
    idea: "Box method: the rook cuts the king off, your king takes the opposition, and a rook check pushes the king back one rank. Use waiting rook moves when needed." },
  { id: "square-draw", level: "Beginner (1000-1200)", theme: "Rule of the square", fen: "7k/8/8/8/p7/8/8/4K3 w - - 0 1",
    side: "w", goal: "draw", grade: "engine",
    question: { prompt: "White to move. Can the white king catch the a-pawn?", options: ["Yes", "No"], answer: "Yes" },
    idea: "Draw the square from the pawn to its promotion rank. If your king can step inside it, you catch the pawn." },
  { id: "square-lose", level: "Beginner (1000-1200)", theme: "Rule of the square (outside)", fen: "7k/8/8/8/p7/8/8/5K2 w - - 0 1",
    side: "b", goal: "win", grade: "engine",
    question: { prompt: "White to move. Can the white king catch the a-pawn?", options: ["Yes", "No"], answer: "No" },
    idea: "One file further away and the king is outside the square, so the pawn runs through. You play Black: promote and win." },
  { id: "opposition-draw", level: "1200-1400", theme: "Opposition, K+P vs K", fen: "8/8/4k3/8/4K3/4P3/8/8 w - - 0 1",
    side: "b", goal: "draw", grade: "engine",
    question: { prompt: "White to move. What is the result with best play?", options: ["White wins", "Draw"], answer: "Draw" },
    idea: "Black has the opposition, so White's king can't reach a key square (d5/e5/f5). Defend as Black: keep the opposition, and go straight back in front of the pawn." },
  { id: "opposition-win", level: "1200-1400", theme: "Opposition, K+P vs K", fen: "8/8/4k3/8/4K3/4P3/8/8 b - - 0 1",
    side: "w", goal: "win", grade: "engine",
    question: { prompt: "Same position, but Black to move. What is the result?", options: ["White wins", "Draw"], answer: "White wins" },
    idea: "Black has to give way, so White's king reaches a key square in front of the pawn. Win it as White." },
  { id: "lucena", level: "1600-1800", theme: "Lucena position (building a bridge)", fen: "1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1",
    side: "w", goal: "win", grade: "engine",
    idea: "Cut the enemy king off with Rd1+, then bring the rook to the 4th rank (Rd4) so it can block the checks: 'building a bridge'." },
  { id: "philidor", level: "1600-1800", theme: "Philidor defence (3rd-rank defence)", fen: "4k3/8/1r6/4PK2/8/8/8/R7 b - - 0 1",
    side: "b", goal: "draw", grade: "engine",
    idea: "Keep your rook on your 3rd rank (the 6th) until the pawn steps onto it. Then drop to the 1st rank and check from behind." },
  { id: "kbn", level: "1800+", theme: "Mate with K+B+N vs K", fen: "8/8/8/4k3/8/8/8/1NB1K3 w - - 0 1",
    side: "w", goal: "win", grade: "theory", limit: 50,
    idea: "Your bishop on c1 is dark-squared, so you can only mate in a dark corner (a1 or h8). Drive the king to the edge, then into one of those corners, using the knight's W-manoeuvre. Stockfish without tablebases shows only about +1.5 here, so your moves are not graded by the engine. Just mate within 50 moves." },
];

// Study split (GM Davorin Kuljasevic, "How to Study Chess on Your Own")
export const BASE_SPLIT = { Tactics: 25, Endgames: 25, Middlegame: 20, "General (calculation, own games, thinking)": 20, Openings: 10 };

// What each error type means, and how to train it.
export const TAG_ADVICE = {
  "missed tactic / forcing move": {
    area: "Tactics",
    why: "The engine's best move was a check, capture or promotion that you didn't play, so you missed tactical chances.",
    drills: [
      "Every move, ask: what checks, captures and threats do I have? Do this before anything else.",
      "15-20 min of puzzles a day: Lichess themes Fork, Pin, Discovered attack, Double check.",
      "Woodpecker cycle: one set of ~100 puzzles, solved again and again, faster each round.",
    ],
    links: [["Lichess puzzle themes", "https://lichess.org/training/themes"], ["Fork", "https://lichess.org/training/fork"], ["Pin", "https://lichess.org/training/pin"]],
  },
  "hung material / allowed tactic": {
    area: "General (calculation, own games, thinking)",
    why: "After your move the opponent could win a piece. This is usually a habit problem (no blunder check), not missing knowledge.",
    drills: [
      "Blunder check before every move: what are ALL of my opponent's checks, captures and threats after this move?",
      "Play 15+10 or slower, and spend 10 seconds on the blunder check even in easy positions.",
      "Lichess themes Hanging piece and Trapped piece.",
    ],
    links: [["Hanging piece", "https://lichess.org/training/hangingPiece"], ["Trapped piece", "https://lichess.org/training/trappedPiece"]],
  },
  "missed mate": {
    area: "Tactics",
    why: "You had a forced mate and didn't find it.",
    drills: ["Mate-in-2 and mate-in-3 puzzles daily.", "Learn the basic mating patterns: back rank, smothered, Anastasia, Arabian."],
    links: [["Mate in 2", "https://lichess.org/training/mateIn2"], ["Mate in 3", "https://lichess.org/training/mateIn3"]],
  },
  "allowed mate": {
    area: "General (calculation, own games, thinking)",
    why: "Your move allowed a forced mate, which means king safety was overlooked.",
    drills: ["Check every opponent check after your move.", "Make luft (h3/h6) in time, and watch the back rank.", "Lichess theme Back-rank mate."],
    links: [["Back-rank mate", "https://lichess.org/training/backRankMate"]],
  },
  "time trouble": {
    area: "General (calculation, own games, thinking)",
    why: "The mistake came with less than 30 s, or less than 10% of your starting time, left on the clock.",
    drills: [
      "Budget your time: spend less on the opening and save it for the critical moments.",
      "Choose increment time controls (15+10, 10+5).",
      "In easy positions, play your first good candidate. Think long only when the position is critical.",
    ],
    links: [],
  },
  "endgame technique": {
    area: "Endgames",
    why: "The mistakes came in the endgame.",
    drills: ["Do the Endgames tab in this app (the theory positions).", "Lichess Practice: Checkmates, Pawn endgames, Rook endgames.", "Silman's Complete Endgame Course: the chapter for your rating."],
    links: [["Lichess Practice", "https://lichess.org/practice"], ["Endgame puzzles", "https://lichess.org/training/endgame"]],
  },
  "threw away winning position": {
    area: "Middlegame",
    why: "You had a winning position (80%+ win chance) and let it slip.",
    drills: [
      "When you're winning: first stop the opponent's counterplay, then simplify (trade pieces, not pawns).",
      "Play winning positions out against the engine (Analysis board: load a winning position and play on).",
    ],
    links: [["Advantage puzzles", "https://lichess.org/training/advantage"]],
  },
  "positional / planning": {
    area: "Middlegame",
    why: "There was no direct tactic: you lost the thread positionally, through piece placement, pawn structure or the wrong plan.",
    drills: [
      "Before each move, find your worst piece and improve it.",
      "Learn the plans for the pawn structures of your openings: IQP, Carlsbad, French chain.",
      "Study annotated master games in your own openings (Lichess opening explorer, Masters).",
    ],
    links: [["Opening explorer", "https://lichess.org/analysis#explorer"]],
  },
};

// Starter repertoires for club players, each with the reason it is a good fit.
export const REPERTOIRES = [
  { style: "Solid / positional", white: "1.d4 + London System (Bf4, e3, Nf3, c3)", vsE4: "Caro-Kann (1...c6)", vsD4: "Queen's Gambit Declined (1...d5 2.c4 e6)",
    why: "Little theory and the same structures every game, so the plans are easy to learn: your pieces have fixed squares and you play the middlegame you know. Weaker side: it can be slow, so you have to create chances yourself." },
  { style: "Classical / all-round", white: "1.e4 + Italian (2.Nf3 3.Bc4)", vsE4: "1...e5 (Italian/Spanish structures)", vsD4: "Queen's Gambit Declined",
    why: "Teaches the classical principles: centre, development, castling, and open lines for your pieces. You'll be at home in the most common positions at club level. Weaker side: more theory to learn against the Spanish and the Open games." },
  { style: "Sharp / tactical", white: "1.e4 + Open Sicilian (2.Nf3 3.d4)", vsE4: "Sicilian (1...c5)", vsD4: "King's Indian (1...Nf6 2...g6)",
    why: "Unbalanced positions with chances for both sides, which suits players who calculate well and attack. Weaker side: a lot of theory, and mistakes get punished hard. Choose this only if tactics are a strength in your report." },
];
