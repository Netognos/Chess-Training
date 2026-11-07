// AI coach (Google Gemini, free tier). The player's own API key is stored only in this browser
// (localStorage, not in backups) and sent only to generativelanguage.googleapis.com.
// The engine supplies the chess facts; the language model only judges the player's written reasoning against them.

const KEY = "chesscoach.gemini", MKEY = "chesscoach.gemini.model";
const BASE = "https://generativelanguage.googleapis.com/v1beta";
export const aiKey = () => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };
export const setAiKey = (k) => { try { k ? localStorage.setItem(KEY, k.trim()) : localStorage.removeItem(KEY); } catch {} };
const getModel = () => { try { return localStorage.getItem(MKEY) || "gemini-flash-latest"; } catch { return "gemini-flash-latest"; } };

async function pickModel(key) {
  const r = await fetch(`${BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
  if (!r.ok) throw new Error(`Gemini: ${r.status}`);
  const ms = ((await r.json()).models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent") && /flash/i.test(m.name) && !/image|tts|live|audio|embed|omni/i.test(m.name));
  const pref = ms.find((m) => /flash-latest/.test(m.name)) || ms.filter((m) => !/lite|preview/.test(m.name)).sort((a, b) => b.name.localeCompare(a.name))[0] || ms[0];
  if (!pref) throw new Error("No Gemini Flash model available for this key");
  const id = pref.name.replace(/^models\//, ""); try { localStorage.setItem(MKEY, id); } catch {}
  return id;
}

async function generate(prompt, schema, retried = false) {
  const key = aiKey(); if (!key) throw new Error("No Gemini key");
  const model = getModel();
  const r = await fetch(`${BASE}/models/${model}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: schema } }),
  });
  if (r.status === 404 && !retried) { await pickModel(key); return generate(prompt, schema, true); }
  if (r.status === 429) throw new Error("Gemini rate limit reached (free tier). Wait a minute and try again.");
  if (!r.ok) { const t = await r.text(); throw new Error(`Gemini ${r.status}: ${t.slice(0, 160)}`); }
  const j = await r.json();
  const txt = j.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  return JSON.parse(txt);
}

export async function testKey() {
  const out = await generate('Reply with {"ok": true}.', { type: "OBJECT", properties: { ok: { type: "BOOLEAN" } }, required: ["ok"] });
  return { ok: !!out.ok, model: getModel() };
}

// Build the three understanding levels from the engine explanation (see explain.js)
export function rubricFrom(x, solutionLine) {
  const followup = x.facts.find((f) => /^Then |^Your follow-up/.test(f));
  const reply = x.facts.find((f) => f.startsWith("The opponent's best answer"));
  return [
    { id: "idea", what: `The point of ${x.san}: ${x.facts.find((f) => f.startsWith(x.san)) || "the key idea of the move"}` },
    { id: "danger", what: x.tempting.length ? `The danger / why the obvious follow-up fails: ${x.tempting[0]}` : `The opponent's best defence and what it threatens: ${reply || "-"}` },
    { id: "followup", what: `The correct follow-up and plan: ${[reply, followup].filter(Boolean).join(" ")} (main line ${solutionLine})` },
  ];
}

export async function judgeReasoning({ fen, side, category, rating, solution, engineLine, evalText, alternatives, rubric, userMove, userLine, userNotes }) {
  const schema = {
    type: "OBJECT",
    properties: {
      levels: { type: "ARRAY", items: { type: "OBJECT", properties: { id: { type: "STRING" }, credit: { type: "NUMBER" }, evidence: { type: "STRING" } }, required: ["id", "credit", "evidence"] } },
      rejected_for_right_reason: { type: "BOOLEAN" },
      feedback: { type: "STRING" },
      missed: { type: "STRING" },
    },
    required: ["levels", "rejected_for_right_reason", "feedback", "missed"],
  };
  const prompt = `You are a strict but encouraging chess coach. You judge how deeply a player UNDERSTOOD a position, based ONLY on what they wrote.
The chess facts below come from Stockfish and are correct. Do not add your own variations or claims beyond these facts.

Position (FEN): ${fen}
Side to move (the player): ${side}
Category: ${category}, difficulty rating about ${rating}
Best move / solution: ${solution}
Engine main line: ${engineLine}
Engine evaluation: ${evalText}
Alternatives: ${alternatives}

Three levels of understanding for this position:
${rubric.map((r) => `- ${r.id}: ${r.what}`).join("\n")}

The player's answer:
- Move / line they wrote: ${userLine || userMove || "(none)"}
- Their notes: ${userNotes || "(none)"}

Task:
1. For each level (idea, danger, followup) give credit 1 (clearly expressed in their notes or line), 0.5 (partly / vaguely), or 0 (absent). A correct move alone is NOT proof of understanding: look at what they wrote. Quote their words as evidence (or "-").
2. rejected_for_right_reason = true only if they did NOT choose the best move, but their notes show they considered it and rejected it because of the real danger (level "danger"). That is half right.
3. feedback: 2 to 4 sentences to the player, in the same language as their notes (Dutch if they wrote Dutch; English if they wrote nothing). Say what they saw well, what they missed, and the one thought that would have taken them to the next level.
4. missed: one short sentence with the most important thing they missed (same language).`;
  const out = await generate(prompt, schema);
  const lv = Object.fromEntries((out.levels || []).map((l) => [l.id, { credit: Math.max(0, Math.min(1, +l.credit || 0)), evidence: l.evidence || "" }]));
  for (const id of ["idea", "danger", "followup"]) lv[id] ||= { credit: 0, evidence: "" };
  const understanding = 0.35 * lv.idea.credit + 0.35 * lv.danger.credit + 0.3 * lv.followup.credit;
  return { levels: lv, understanding, rejected: !!out.rejected_for_right_reason, feedback: out.feedback || "", missed: out.missed || "" };
}
