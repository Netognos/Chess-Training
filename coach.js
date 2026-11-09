// Turns the analysis profile into a coaching diagnosis + training plan.
import { BASE_SPLIT, TAG_ADVICE } from "./data.js";

const PH = { opening: "Openings", middlegame: "Middlegame", endgame: "Endgames" };

export function diagnose(A, player = {}) {
  const strengths = [], weaknesses = [];
  const phases = Object.keys(A.phaseMoves || {}).filter((p) => A.phaseMoves[p] >= 20);
  const F = A.phases;
  if (F && F.weakest && F.phase[F.weakest].avg < 0 && F.games >= 5) {
    // the same verdict as the "Phases and transitions" card: where win chance is lost, with the error rate as extra evidence
    const w = F.weakest, b = F.strongest;
    weaknesses.push({ key: "phase-" + w, area: PH[w], title: `Weakest phase: ${w}`,
      evidence: `You lose on average ${Math.abs(F.phase[w].avg)}% win chance in the ${w}${A.seriousPer100?.[w] != null ? `, with ${A.seriousPer100[w]} mistakes+blunders per 100 moves (accuracy ${A.phaseAcc[w]}%)` : ""}.` });
    if (b && b !== w) strengths.push({ title: `Strongest phase: ${b}`, evidence: `${F.phase[b].avg >= 0 ? "+" : ""}${F.phase[b].avg}% win chance per game in the ${b}${A.phaseAcc?.[b] != null ? `, accuracy ${A.phaseAcc[b]}%` : ""}.` });
  } else if (phases.length) {
    const byErr = [...phases].sort((a, b) => A.seriousPer100[b] - A.seriousPer100[a] || A.phaseAcc[a] - A.phaseAcc[b]);
    const worst = byErr[0], best = byErr[byErr.length - 1];
    if (A.seriousPer100[worst] > 0 && worst !== best)
      weaknesses.push({ key: "phase-" + worst, area: PH[worst], title: `Weakest phase: ${worst}`,
        evidence: `${A.seriousPer100[worst]} mistakes+blunders per 100 moves (accuracy ${A.phaseAcc[worst]}%), vs ${A.seriousPer100[best]} in the ${best}.` });
    strengths.push({ title: `Strongest phase: ${best}`, evidence: `Accuracy ${A.phaseAcc[best]}%, ${A.seriousPer100[best]} mistakes+blunders per 100 moves.` });
  }
  const totalSerious = Object.values(A.tags || {}).reduce((a, b) => a + b, 0) || 1;
  Object.entries(A.tags || {}).filter(([t, n]) => n >= 2 && TAG_ADVICE[t]).slice(0, 3).forEach(([t, n]) => {
    const adv = TAG_ADVICE[t];
    weaknesses.push({ key: "tag-" + t, area: adv.area, title: cap(t), evidence: `${n} of your serious errors (${Math.round(100 * n / totalSerious)}%). ${adv.why}`, drills: adv.drills, links: adv.links });
  });
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
  for (const o of A.openings || []) {
    if (o.games < 3 || o.wpAfter10 === null) continue;
    const side = o.color === "w" ? "White" : "Black";
    if (o.wpAfter10 >= 55) strengths.push({ title: `Opening: ${o.name} (${side})`, evidence: `${o.games} games: win chance after move 10 averages ${o.wpAfter10}%, score ${o.scorePct}%.` });
    else if (o.wpAfter10 <= 40) weaknesses.push({ key: "op-" + o.name, area: "Openings", title: `Opening problems: ${o.name} (${side})`, evidence: `${o.games} games: after move 10 your win chance is only ${o.wpAfter10}% on average. Review the main line and its typical plans, or switch.` });
  }
  for (const [t, e] of Object.entries(A.endgames || {})) if (e.games >= 3 && e.scorePct < 35)
    weaknesses.push({ key: "eg-" + t, area: "Endgames", title: `Weak in ${t}s`, evidence: `${e.games} games reached a ${t}, and you scored ${e.scorePct}%.`, drills: TAG_ADVICE["endgame technique"].drills, links: TAG_ADVICE["endgame technique"].links });
  const bc = A.byColor || {};
  if (bc.w && bc.b && bc.w.games >= 4 && bc.b.games >= 4 && Math.abs(bc.w.scorePct - bc.b.scorePct) >= 20) {
    const weak = bc.w.scorePct < bc.b.scorePct ? "Black" : "White";
    const other = weak === "White" ? "b" : "w";
    weaknesses.push({ key: "color", area: "Openings", title: `Results with ${weak === "White" ? "the white" : "the black"} pieces`,
      evidence: `You score ${weak === "White" ? bc.w.scorePct : bc.b.scorePct}% as ${weak}, against ${bc[other].scorePct}% with the other colour.` });
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
  if (gameMins) weekly.push({ what: "2 serious games (15+10 or slower)", mins: gameMins, how: "Write down your thoughts at 3 critical moments BEFORE you open the engine. Then import the games here." });
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
  steps.push("Solve the due puzzles from your own games (Puzzles tab)");
  return steps;
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
