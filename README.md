# ♞ Chess Coach

A personal chess trainer that runs entirely in your browser: on your laptop or your phone, with no server and no account. Stockfish 19 runs locally (WebAssembly).

- **Games**: import your games from Lichess or Chess.com (by username) or from a PGN file, and analyse them with Stockfish.
- **Report**: accuracy per phase (opening, middlegame, endgame); mistakes per 100 moves; the type of each error (missed tactic, hung piece, time trouble, endgame technique, positional); openings with your score and win chance after move 10; endgames reached; converting winning positions and saving lost ones. From that, it lists your **strengths and weak points** and builds a **weekly training plan**, based on GM Kuljasevic's study split and shifted toward your weak areas.
- **Puzzles**: your own biggest mistakes come back as puzzles, with spaced repetition (1, 3, 7, 21 and 60 days).
- **Endgames**: the theory positions you need to know (basic mates, square rule, opposition, Lucena, Philidor, K+B+N), played out against the engine. You can add your own positions.
- **Board**: analyse any position with the top 3 engine lines, play on against the engine, or copy the position as a "what's the plan here?" question for Claude.
- **Read the position**: a breakdown of any position without the engine (material and imbalances, loose and hanging pieces, the opponent's threats, your forcing moves, king safety, pawn structure, activity), plus what that means for your plan.
- **Think sheet**: the 5-question thinking routine and your candidate moves, each with the idea behind it. The engine checks the candidates only when you ask. Save it all to the **Notebook**.
- **How to evaluate**: a short guide to judging who is better and why, in the Board and Notebook tabs.
- **Log**: everything you do is logged per player, along with your next steps and repertoire notes. You can export it as Markdown, and back up or restore everything as JSON.

**Part 2: Test & profile**
- **Position test** (quick: 12 positions, full: 32): adaptive to your level. You play your move, write down *why* and which line you calculated. It measures your score per category, your calculation depth (how many moves of the solution you find), your time, and the character of your moves.
  - Tactical positions: Lichess puzzle database (CC0), rated 600-3000, categorised by Chess Coach into attack & mate, defence, calculation, sacrifice, quiet move and endgame.
  - Positional positions: [neilgd/chess-position-analysis-results](https://github.com/neilgd/chess-position-analysis-results) (MIT): 2,204 positional puzzles selected and classified by WIM/FM Liwia Jarocka, WGM Michalina Rudzińska and WGM Margarita Voyska.
  - The approach follows IM Igor Khmelnitsky's *Chess Exam and Training Guide* (a rating per category instead of one overall number).
- **Player profile**: your player type following GM Lars Bo Hansen's model (activist, reflector, pragmatist, theoretician; as described by GM Karsten Müller and GM Luis Engel), based on the test, a questionnaire and the style statistics from your games (sacrifices, opposite-side castling, accuracy when ahead/equal/behind, …). It also shows the openings you play now, the ones you score worst against, the openings that fit your type, and your work points.
- **Training modules**: practise per category at your level.

Multiple players are supported: each one has their own profile, analysis, puzzles and log.

## Put it online with GitHub Pages (5 minutes)

1. Create a new repository on GitHub, e.g. `chess-coach` (**Public**: GitHub Pages is free for public repos).
2. Upload all files from this folder: **Add file → Upload files**, then drag in the whole contents, including the `vendor` folder. Commit.
3. Go to **Settings → Pages**. Under *Build and deployment*, set Source = **Deploy from a branch**, Branch = **main**, folder **/ (root)**. Save.
4. After about a minute, the app is live at `https://<your-username>.github.io/chess-coach/`. Open it on your phone and use "Add to Home Screen".

From the command line:

```bash
cd chess-coach
git init && git add . && git commit -m "Chess Coach"
git branch -M main
git remote add origin https://github.com/<your-username>/chess-coach.git
git push -u origin main
# then enable Pages as in step 3
```

## Run it locally

You need a small web server, because ES modules and Web Workers don't work from `file://`:

```bash
cd chess-coach
python -m http.server 8000
# open http://localhost:8000
```

## Good to know

- **Your data stays in your browser** (localStorage). Make a backup regularly via **Log → Backup**. Use the same backup to move to another device (laptop ↔ phone).
- **Analysis speed**: about 7–12 s per game on a laptop, slower on a phone. Lichess games that already have a server analysis are processed much faster, because their evaluations are reused.
- **Engine limits**: this Stockfish build has no endgame tablebases. For K+B+N vs K it shows only about +1.5, even though the position is a forced win, so that drill only checks whether you mate within 50 moves.
- **Error tags** are rules of thumb, e.g. "the best move was a capture or check" counts as a missed tactic. They are good for spotting patterns across many games; for any single position, look at it yourself.
- **Downloading games**: the Lichess and Chess.com APIs allow requests from browsers. If it ever fails, export a PGN on the website and paste it in.

## Project structure

| File | Contents |
| --- | --- |
| `index.html`, `style.css` | Page and styling |
| `app.js` | UI: tabs, storage, training flows |
| `analysis.js` | PGN → per-game analysis → player profile |
| `coach.js` | Diagnosis, strengths/weak points, training plan |
| `test.js` | Test, results, player profile, training modules |
| `testbank.js` | Test positions (tactical + positional) |
| `reader.js` | "Read the position": rule-based position breakdown |
| `engine.js` | Stockfish (UCI) wrapper |
| `board.js` | Chessboard (tap or drag) |
| `data.js` | Endgame positions, training advice, starter repertoires |
| `vendor/` | chess.js (BSD-2), Stockfish 19 lite WASM (GPLv3) |

## Licence

GPL-3.0 (see `LICENSE`), because Stockfish is GPLv3. Piece images: Colin M.L. Burnett (cburnett), GPLv2+. chess.js: BSD-2-Clause (`vendor/chess.js.LICENSE`).
