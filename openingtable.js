// Opening results grouped by family (Sicilian, Queen's Gambit, …); each family opens into its variations.
const pc = (n, tot) => (tot ? Math.round((100 * n) / tot) : 0);
const wdl = (o) => `${o.wins ?? "–"} / ${o.draws ?? "–"} / ${o.losses ?? "–"}`;

export function familyTableHtml(fams, esc, { limit = 15, acc = true, tid = "fam" } = {}) {
  const total = fams.reduce((a, f) => a + f.games, 0);
  const row = (o, cls, label, extra = "") => `<tr class="${cls}" ${extra}><td>${o.color === "w" ? "White" : "Black"}</td><td>${label}</td><td>${o.games} <span class="muted small">(${pc(o.games, total)}%)</span></td><td class="small">${wdl(o)}</td><td><b>${o.scorePct}%</b></td><td>${o.wpAfter10 ?? "–"}${o.wpAfter10 != null ? "%" : ""}</td>${acc ? `<td>${o.acc ?? "–"}</td>` : ""}</tr>`;
  return `<div class="scroll"><table class="famtable"><tr><th>Colour</th><th>Opening</th><th>Games</th><th>Won / drawn / lost</th><th>Score</th><th>Win chance after the opening</th>${acc ? "<th>Opening accuracy</th>" : ""}</tr>
    ${fams.slice(0, limit).map((f, i) => {
      const many = f.vars.length > 1;
      const label = many ? `<button class="linkbtn" data-fam-toggle="${tid}-${i}" aria-expanded="false">▸ <b>${esc(f.name)}</b></button> <span class="muted small">${f.vars.length} variation${f.vars.length === 1 ? "" : "s"}</span>` : `<b>${esc(f.name)}</b>`;
      return row(f, "fam", label) + (many ? f.vars.map((v) => row(v, `var hidden`, `<span class="varname">${esc(v.short)}</span>`, `data-var-of="${tid}-${i}"`)).join("") : "");
    }).join("")}</table></div>
    ${fams.length > limit ? `<p class="small muted">${fams.length - limit} more opening famil${fams.length - limit === 1 ? "y" : "ies"} with fewer games not shown.</p>` : ""}`;
}

export function bindFamilyTable(root) {
  root.querySelectorAll("[data-fam-toggle]").forEach((b) => (b.onclick = () => {
    const id = b.dataset.famToggle, open = b.getAttribute("aria-expanded") !== "true";
    b.setAttribute("aria-expanded", open); b.firstChild.textContent = open ? "▾ " : "▸ ";
    root.querySelectorAll(`[data-var-of="${id}"]`).forEach((r) => r.classList.toggle("hidden", !open));
  }));
}
