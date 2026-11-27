// Turns the analysis profile into a coaching diagnosis + training plan.
import { BASE_SPLIT, TAG_ADVICE } from "./data.js";
import { errorCause } from "./analysis.js";

const PH = { opening: "Openings", middlegame: "Middlegame", endgame: "Endgames" };

export function diagnose(A, player = {}) {
  const strengths = [], weaknesses = [];
  const phases = Object.keys(A.phaseMoves || {}).filter((p) => A.phaseMoves[p] >= 20);
  const F = A.phases, C = A.cpl;
  // Opponent comparison for one phase: your centipawn loss and serious errors against theirs, in the same games.
  const vsOpp = (w) => { const m = C?.[w]?.me, o = C?.[w]?.opp; if (!m || !o) return "";
    return ` Your average centipawn loss there is ${m.acpl} against ${o.acpl} for your opponents, with ${m.per100} vs ${o.per100} mistakes+blunders per 100 moves.`; };
  if (F) {
   if (F.weakest) {
    // Same verdict as the "Phases" card. Win chance is zero-sum, so this is "you vs your opponents in this
    // phase", not "how many errors happen here" (the middlegame has the most errors for everyone).
    const w = F.weakest, c = F.contrib[w], b = F.strongest;
    if (F.verdict !== "relative")
      weaknesses.push({ key: "phase-" + w, area: PH[w], title: `Weakest phase: ${w}`,
        evidence: `Over all ${F.games} games you lose ${Math.abs(c.avg)} points of win chance per game in the ${w} (${c.lo !== null ? `95% range ${c.lo} to ${c.hi}` : "too few games for a range"}${F.verdict === "likely" ? ", so not certain yet" : ""}).${vsOpp(w)}` });
    if (b && F.contrib[b].avg > 0) strengths.push({ title: `Strongest phase: ${b}`, evidence: `+${F.contrib[b].avg} points of win chance per game in the ${b}.${vsOpp(b)}` });
    if (F.verdict === "relative") strengths.push({ title: "No phase where you lose on balance", evidence: `Your smallest edge is in the ${w} (${c.avg >= 0 ? "+" : ""}${c.avg} per game). That's where there is the least to gain from, not a weakness.` });
   } // fewer than 3 games per phase: no phase verdict yet (the Phases card says the same)
  } else if (C && C.games >= 5) {
    const ds = ["opening", "middlegame", "endgame"].filter((k) => C[k]?.me && C[k]?.opp && C[k].me.moves >= 20).map((k) => [k, C[k].me.acpl - C[k].opp.acpl]).sort((x, y) => y[1] - x[1]);
    if (ds.length && ds[0][1] >= 10) weaknesses.push({ key: "phase-" + ds[0][0], area: PH[ds[0][0]], title: `Weakest phase: ${ds[0][0]}`, evidence: `You lose ${ds[0][1]} centipawns per move more than your opponents there.${vsOpp(ds[0][0])}` });
  } else if (phases.length) {
    // no phase data yet (older analysis): only report where most errors fall, with the caveat
    const byErr = [...phases].sort((a, b) => A.seriousPer100[b] - A.seriousPer100[a] || A.phaseAcc[a] - A.phaseAcc[b]);
    const worst = byErr[0], best = byErr[byErr.length - 1];
    if (A.seriousPer100[worst] > 0 && worst !== best)
      weaknesses.push({ key: "phase-" + worst, area: PH[worst], title: `Most errors: ${worst}`,
        evidence: `${A.seriousPer100[worst]} mistakes+blunders per 100 moves (accuracy ${A.phaseAcc[worst]}%), vs ${A.seriousPer100[best]} in the ${best}. That alone doesn't make it your weak phase: everyone errs most in the middlegame. Re-analyse your games to compare with your opponents.` });
  }
  // What exactly goes wrong, per phase and cause. Shown even when the phase is positive overall: winning the
  // middlegame on balance doesn't make the tactics you miss there harmless.
  const M = A.errMatrix;
  if (M && A.games >= 3) {
    const CAUSE = { time: "Time trouble", tactical: "Tactical errors", technique: "Endgame technique", positional: "Positional errors" };
    const cells = Object.entries(M).flatMap(([ph, cs]) => Object.entries(cs).map(([c, x]) => ({ ph, c, ...x }))).filter((x) => x.n >= 2).sort((a, b) => b.perGame - a.perGame);
    for (const x of cells.slice(0, 2)) {
      const net = F?.contrib?.[x.ph]?.avg;
      const e = x.ex[0];
      const ctx = net != null && net >= 0 ? ` Even though you come out ahead in the ${x.ph} overall (${net >= 0 ? "+" : ""}${net}), these errors cost you points you could have kept: your opponents' mistakes in the same phase win most of it back.` : net != null && net > -x.perGame ? ` On balance the ${x.ph} costs you ${net} per game, because your opponents also make mistakes.` : "";
      weaknesses.push({ key: `err-${x.ph}-${x.c}`, area: x.c === "tactical" ? "Tactics" : x.c === "technique" ? "Endgames" : x.c === "positional" ? (x.ph === "opening" ? "Openings" : "Middlegame") : "General (calculation, own games, thinking)",
        title: `${CAUSE[x.c]} in the ${x.ph}`,
        evidence: `${x.n} mistakes and blunders (${x.blunders} blunders), costing ${x.perGame} points of win chance per game.${ctx}${e ? ` Biggest: move ${e.moveNo} ${e.played}${e.best ? ` instead of ${e.best}` : ""} (−${Math.round(e.drop)}%).` : ""}`,
        drills: (TAG_ADVICE[{ time: "time trouble", tactical: "missed tactic / forcing move", technique: "endgame technique", positional: "positional / planning" }[x.c]] || {}).drills });
    }
  }
  // Remaining causes (not already listed per phase), counted exactly like the "What went wrong" table:
  // one cause per error, out of all mistakes and blunders.
  if (M && A.games >= 3) {
    const TAGOF = { time: "time trouble", tactical: "missed tactic / forcing move", technique: "endgame technique", positional: "positional / planning" };
    const all = Object.values(M).flatMap((cs) => Object.values(cs)); const totErr = all.reduce((a, x) => a + x.n, 0) || 1;
    const byC = {}; for (const cs of Object.values(M)) for (const [c, x] of Object.entries(cs)) byC[c] = (byC[c] || 0) + x.n;
    const egPlus = (F?.contrib?.endgame?.avg ?? -1) > 0;
    Object.entries(byC).filter(([c, n]) => n >= 3 && n / totErr >= 0.1 && TAG_ADVICE[TAGOF[c]] && !(c === "technique" && egPlus) && !weaknesses.some((w) => w.key.startsWith("err-") && w.key.endsWith("-" + c)))
      .sort((a, b) => b[1] - a[1]).slice(0, 2).forEach(([c, n]) => {
        const adv = TAG_ADVICE[TAGOF[c]];
        weaknesses.push({ key: "tag-" + TAGOF[c], area: adv.area, title: cap(TAGOF[c]), evidence: `${n} of your ${totErr} mistakes and blunders (${Math.round(100 * n / totErr)}%). ${adv.why}`, drills: adv.drills, links: adv.links });
      });
  }
  if (A.lostOnTime >= 2 && !weaknesses.some((w) => w.key === "tag-time trouble"))
    weaknesses.push({ key: "tag-time trouble", area: TAG_ADVICE["time trouble"].area, title: "Losing on time", evidence: `${A.lostOnTime} games lost on time.`, drills: TAG_ADVICE["time trouble"].drills, links: [] });
  const c = A.conversion || {}, r = A.resilience || {};
  if (c.chances >= 3) {
    const rate = Math.round(100 * c.won / c.chances);
    if (rate < 60 && !weaknesses.some((w) => w.key === "tag-threw away winning position"))
      weaknesses.push({ key: "conversion", area: "Middlegame", title: "Converting winning positions", evidence: `You reached a winning position (85%+) in ${c.chances} games but won only ${c.won} (${rate}%).`, drills: TAG_ADVICE["threw away winning position"].drills, links: TAG_ADVICE["threw away winning position"].links });
    else if (rate >= 80) strengths.push({ title: "Good technique when winning", evidence: `Won ${c.won} of ${c.chances} games where you had a winning position.` });
  }
  if (r.lost >= 3 && r.saved / r.lost >= 0.3) strengths.push({ title: "Fighting spirit", evidence: `You saved ${r.saved} of ${r.lost} lost positions.` });
  for (const o of A.families || A.openings || []) {
    if (o.games < 3 || o.wpAfter10 === null || /no name in the PGN/.test(o.name)) continue;
    const side = o.color === "w" ? "White" : "Black";
    // "Sicilian Defense" with White means you played against it
    const lab = /Defen[cs]e/.test(o.name) && o.color === "w" ? `as White against the ${o.name}` : `${o.name}, as ${side}`;
    if (o.wpAfter10 >= 55) strengths.push({ title: `Opening: ${lab}`, evidence: `${o.games} games: win chance after the opening averages ${o.wpAfter10}%, score ${o.scorePct}%.` });
    else if (o.wpAfter10 <= 40) weaknesses.push({ key: "op-" + o.name, area: "Openings", title: `Opening problems: ${lab}`, evidence: `${o.games} games: after the opening your win chance is only ${o.wpAfter10}% on average. Review the main line and its typical plans, or switch.` });
  }
  // a bad score in an endgame type is only a technique problem when you lose points IN the endgame (not when you
  // were already worse when it started) and play it less accurately than usual
  const egLeak = !A.phases || (A.phases.contrib?.endgame?.avg ?? 0) < -2;
  const accAll = (() => { const m = Object.values(A.phaseMoves || {}).reduce((a, b) => a + b, 0); return m ? Object.entries(A.phaseAcc).reduce((a, [k, x]) => a + x * A.phaseMoves[k], 0) / m : 100; })();
  for (const [t, e] of Object.entries(A.endgames || {})) if (e.games >= 3 && e.scorePct < 35 && egLeak && e.acc < accAll)
    weaknesses.push({ key: "eg-" + t, area: "Endgames", title: `Weak in ${t}s`, evidence: `${e.games} games reached a ${t}, and you scored ${e.scorePct}%.`, drills: TAG_ADVICE["endgame technique"].drills, links: TAG_ADVICE["endgame technique"].links });
  const bc = A.byColor || {};
  if (bc.w && bc.b && bc.w.games >= 4 && bc.b.games >= 4 && Math.abs(bc.w.scorePct - bc.b.scorePct) >= 20) {
    const weak = bc.w.scorePct < bc.b.scorePct ? "Black" : "White";
    const other = weak === "White" ? "b" : "w";
    weaknesses.push({ key: "color", area: "Openings", title: `Results with ${weak === "White" ? "the white" : "the black"} pieces`,
      evidence: `You score ${weak === "White" ? bc.w.scorePct : bc.b.scorePct}% as ${weak}, against ${bc[other].scorePct}% as ${weak === "White" ? "Black" : "White"}.${(() => { const wc = weak === "White" ? "w" : "b"; const o = (A.families || A.openings || []).filter((x) => x.color === wc && x.games >= 2 && !/no name/.test(x.name)).sort((a, b) => b.games - a.games)[0]; return o ? ` Your most played opening as ${weak}: ${o.name} (${o.games} games, ${o.scorePct}%). See Openings for where it goes wrong.` : ""; })()}` });
  }
  if (!strengths.length) strengths.push({ title: "Not enough data yet", evidence: "Analyse at least 15-20 games for a reliable picture." });
  return { strengths, weaknesses: weaknesses.slice(0, 6), plan: makePlan(weaknesses, player.hours || 4) };
}

export function makePlan(weaknesses, hours) {
  const split = { ...BASE_SPLIT };
  const keys = Object.keys(split);
  const weakAreas = [...new Set(weaknesses.slice(0, 3).map((w) => w.area))].filter((a) => split[a] !== undefined);
  let budget = 15;
  for (const a of weakAreas) { const add = Math.min(8, budget); split[a] += add; budget -= add; }
  const added = 15 - budget;
  const donors = keys.filter((k) => !weakAreas.includes(k));
  const donorTotal = donors.reduce((s, k) => s + split[k], 0) || 1;
  for (const k of donors) split[k] = Math.max(5, split[k] - added * split[k] / donorTotal);
  const sum = keys.reduce((s, k) => s + split[k], 0);
  for (const k of keys) split[k] = Math.round(100 * split[k] / sum);
  const mins = hours * 60;
  const gameMins = hours >= 3 ? 100 : 0; // 2 serious games incl. own analysis
  const studyMins = mins - gameMins;
  const perArea = Object.fromEntries(keys.map((k) => [k, Math.round(studyMins * split[k] / 100 / 5) * 5]));
  const weekly = [];
  if (gameMins) weekly.push({ what: "Play, then look at your mistakes", mins: gameMins, how: "Write down your thoughts at 3 critical moments BEFORE you open the engine. Then import the games here." });
  const how = {
    Tactics: "Puzzles on the themes from your report (Lichess puzzle themes), plus the Puzzles tab (your own mistakes).",
    Endgames: "Endgames tab: theory positions plus playing them out against the engine. Lichess Practice.",
    Middlegame: "Board tab: load positions from your games and work out the plan yourself first. Annotated master games in your openings.",
    "General (calculation, own games, thinking)": "Thinking routine (threats, forcing moves, best piece, blunder check) and calculation: work through puzzles without moving the pieces.",
    Openings: "Review your repertoire lines and the typical plans. Look up where your own games left the theory.",
  };
  for (const k of keys) if (perArea[k] > 0) weekly.push({ what: k, mins: perArea[k], how: how[k], weak: weakAreas.includes(k) });
  return { split, weekly, hours, weakAreas };
}

export function nextStepsFrom(diag) {
  const steps = [];
  for (const w of diag.weaknesses.slice(0, 3)) steps.push(w.drills ? `${w.title}: ${w.drills[0]}` : `${w.title}: work on it for 2 weeks`);
  steps.push("Puzzles from your own games, whenever some are due (Home shows how many)");
  return steps;
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
