// Runs the REAL planner call (same prompt, schema and repair loop as POST /v1/cutout-tales/render) against the
// configured model, for several scripts and both aspects, and checks every result with cutoutSpecProblems.
//   node --env-file=<backend .env> scripts/cutout-plan-local.mjs
process.env.PLANNER ??= "anthropic";
process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/unused";
const { planDraft, splitSentences } = await import("../backend/src/cutout-tales/routes.ts");
const { cutoutSpecProblems } = await import("../packages/contracts/src/cutout-tales.ts");
const scripts = [
  "Eighteen eighty-seven. A lone rider reached the town of Dustwater at sundown. The marshal was waiting at the saloon door. He did not smile. The rider tipped his hat and rode on.",
  "Maya started her bakery with two hundred dollars and a borrowed oven. Her landlord laughed at the plan. Her neighbour Tom lent her flour on credit. By winter there was a line down the street. The landlord asked for a job.",
  "In nineteen twenty, a young clerk named Arthur found a mistake in the company ledger. His boss called him into the office. Arthur told the truth. The boss shook his hand and gave him a promotion."
];
let failures = 0;
for (const [si, script] of scripts.entries()) {
  const parts = splitSentences(script); let t = 0.3;
  const sentences = parts.map((text) => { const d = 1.5 + text.length / 18; const s = { start: Math.round(t * 100) / 100, end: Math.round((t + d) * 100) / 100, text }; t += d + 0.45; return s; });
  for (const aspect of ["16:9", "9:16"]) {
    const started = Date.now();
    try {
      const r = await planDraft(sentences, aspect);
      if ("error" in r) { failures++; console.log(`script ${si} ${aspect}: FAILED after repair: ${r.error}`); continue; }
      const problems = cutoutSpecProblems(r.spec);
      console.log(`script ${si} ${aspect}: ${problems.length ? "INVALID " + problems.join("; ") : "ok"} — ${r.spec.shots.length} shots, ${r.spec.shots.reduce((n, s) => n + (s.overlays?.length ?? 0), 0)} overlays, ${((Date.now() - started) / 1000).toFixed(1)}s`);
      if (problems.length) failures++;
      if (process.env.OUT_DIR) { const { mkdirSync, writeFileSync } = await import("node:fs"); mkdirSync(process.env.OUT_DIR, { recursive: true }); writeFileSync(`${process.env.OUT_DIR}/plan-${si}-${aspect.replace(":", "x")}.json`, JSON.stringify(r.spec, null, 1)); }
      if (process.env.DUMP) console.log(JSON.stringify(r.spec.shots.map((s) => ({ set: s.set, cast: s.cast.map((c) => c.archetype + ":" + (c.name ?? "")), overlays: (s.overlays ?? []).map((o) => o.type + ":" + o.text) })), null, 1));
    } catch (error) { failures++; console.log(`script ${si} ${aspect}: ERROR ${error.message.slice(0, 300)}`); }
  }
}
console.log(failures ? `${failures} failure(s)` : "all planner runs produced valid shot lists");
process.exit(failures ? 1 : 0);
