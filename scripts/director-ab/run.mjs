// Director A/B test: every brief on every model, then blind judging by both model families.
//   node run.mjs gen [briefId…]   plans -> out/plans/<brief>__<model>.json
//   node run.mjs judge            blind scores -> out/judgements.json
//   node run.mjs report           out/REPORT.md
// Needs ANTHROPIC_API_KEY and GEMINI_API_KEY (and DATABASE_URL set to anything; nothing connects to it).
process.env.APP_ENV ??= "local"; process.env.PLANNER ??= "anthropic";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
const here = import.meta.dirname, out = join(here, "out");
await mkdir(join(out, "plans"), { recursive: true });
const { briefs, models } = await import("./briefs.mjs");
const { AnthropicDirector, directorProblems, resolveVideoType } = await import("../../backend/src/plan/director.ts");
const { analyzeScreenshot } = await import("../../backend/src/plan/screenshots.ts");
const { llmJson } = await import("../../backend/src/llm.ts");
const { findGalleryTemplate, inferVideoType, wordBudget } = await import("../../packages/contracts/src/index.ts");
const { PLAYBOOKS } = await import("../../backend/src/skills/playbooks.ts");
const mode = process.argv[2] ?? "gen";
const only = process.argv.slice(3);
const pool = async (items, size, fn) => { const results = []; let i = 0; await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const n = i++; results[n] = await fn(items[n], n); } })); return results; };

/** Screenshots are read once and shared, so every model sees the same descriptions. */
async function analyses() {
  const file = join(out, "analyses.json");
  const cache = JSON.parse(await readFile(file, "utf8").catch(() => "{}"));
  for (const name of new Set(briefs.flatMap((b) => b.screens))) {
    if (cache[name]) continue;
    const bytes = await readFile(join(here, "screens", name));
    cache[name] = await analyzeScreenshot(bytes, name, "Dashboard");
    console.log("read", name, cache[name]?.title ?? "FAILED");
  }
  await writeFile(file, JSON.stringify(cache, null, 2));
  return cache;
}

function setup(brief, cache) {
  const template = brief.template ? findGalleryTemplate(brief.template) : undefined;
  const screenshots = brief.screens.map((name, i) => ({ id: `00000000-0000-4000-8000-00000000000${i + 1}`, name, purpose: "Dashboard", width: 1280, height: 800, ...(cache[name] ? { analysis: cache[name] } : {}) }));
  const spec = {
    scriptMode: "problem", text: brief.text, durationSeconds: brief.seconds, aspect: "16:9", motionProfile: "smooth", pace: "balanced", audio: { mode: "voiceover", voice: "Kore" }, captions: "key-phrases",
    template: null, theme: brief.theme, ...(brief.look ? { look: brief.look } : {}), ...(template ? { styleExample: template.id } : {}), ...(brief.product ? { productName: brief.product } : {}), screenshotIds: screenshots.map((s) => s.id)
  };
  const context = { brandName: brief.product ?? "Your product", ...(brief.description ? { brandDescription: brief.description } : {}), screenshots, ...(template ? { template: { id: template.id, name: template.name, group: template.group, summary: template.summary, bestFor: template.bestFor, skill: template.skill } } : {}) };
  return { spec, context };
}

if (mode === "gen") {
  const cache = await analyses();
  const jobs = briefs.filter((b) => !only.length || only.includes(b.id)).flatMap((brief) => models.map((model) => ({ brief, model })));
  await pool(jobs, 4, async ({ brief, model }) => {
    const file = join(out, "plans", `${brief.id}__${model.id}.json`);
    if (await readFile(file, "utf8").then(() => true, () => false)) return;
    const { spec, context } = setup(brief, cache);
    const director = new AnthropicDirector(fetch, { provider: model.provider, model: model.model });
    const started = Date.now();
    try {
      const { plan, problems } = await director.plan(spec, context);
      const type = resolveVideoType(spec, context);
      const words = plan.beats.reduce((n, b) => n + (b.line ? b.line.trim().split(/\s+/).length : 0), 0);
      const used = new Set(plan.beats.map((b) => b.ui?.screen).filter(Boolean));
      await writeFile(file, JSON.stringify({ brief: brief.id, model: model.id, ok: true, type, expected: brief.expect, ms: Date.now() - started, usage: director.usage, problems, beats: plan.beats.length, roles: plan.beats.map((b) => b.role), cta: plan.beats.some((b) => b.role === "cta"), shots: { used: used.size, total: context.screenshots.length }, words, budget: wordBudget(brief.seconds, "balanced"), plan }, null, 2));
      console.log("ok  ", brief.id.padEnd(18), model.id.padEnd(18), `${Math.round((Date.now() - started) / 1000)}s`, `problems=${problems.length}`, plan.beats.map((b) => b.role[0]).join(""));
    } catch (error) {
      await writeFile(file, JSON.stringify({ brief: brief.id, model: model.id, ok: false, error: String(error.message).slice(0, 400), ms: Date.now() - started }, null, 2));
      console.log("FAIL", brief.id.padEnd(18), model.id.padEnd(18), String(error.message).slice(0, 120));
    }
  });
}

const JUDGE_SCHEMA = { type: "object", additionalProperties: false, required: ["scores", "ranking", "notes"], properties: {
  scores: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "type_fit", "structure", "script", "context_use", "screenshot_use", "faithfulness"], properties: { label: { type: "string" }, type_fit: { type: "integer" }, structure: { type: "integer" }, script: { type: "integer" }, context_use: { type: "integer" }, screenshot_use: { type: "integer" }, faithfulness: { type: "integer" } } } },
  ranking: { type: "array", items: { type: "string" } }, notes: { type: "string" } } };
const JUDGE_SYSTEM = [
  "You are a senior video director and script editor judging storyboards written by different directors for the same brief. You do not know which director wrote which.",
  "Score every storyboard 1-10 (10 = ready to produce) on: type_fit (is it the right KIND of film for the brief: a lesson must teach and not sell, an ad must hook and ask; wrong tone or a forced sales ending on an educational film is a serious fault), structure (arc, pacing, one idea per beat, a clear ending), script (spoken-language quality: clear, concrete, adds to the picture instead of describing it, no filler or cliché), context_use (uses the template, look and theme named in the brief, and its scene types), screenshot_use (every supplied screenshot used on a beat about what it really shows, with the right region named; score 5 if there are no screenshots), faithfulness (no invented facts, numbers or features beyond the brief).",
  "ranking: labels best to worst. notes: two sentences on what separated them."
].join("\n");

const compact = (r) => ({ beats: r.plan.beats.map((b, i) => ({ n: i + 1, role: b.role, kind: b.kind, voiceover: b.line, key_phrase: b.keyword, on_screen: b.on_screen, scene: b.scene ?? null, ...(b.ui ? { screenshot_shown: b.ui.screen, action: `${b.ui.action} ${b.ui.target}` } : {}) })), music: r.plan.audio.music?.prompt ?? null });

if (mode === "judge") {
  const cache = await analyses();
  const judges = [{ provider: "anthropic", model: "claude-opus-5-5" }, { provider: "gemini", model: "gemini-4-argon" }];
  const files = (await readdir(join(out, "plans"))).filter((f) => f.endsWith(".json"));
  const results = [];
  for (const brief of briefs.filter((b) => !only.length || only.includes(b.id))) {
    const runs = [];
    for (const f of files.filter((x) => x.startsWith(brief.id + "__"))) { const r = JSON.parse(await readFile(join(out, "plans", f), "utf8")); if (r.ok) runs.push(r); }
    const { spec, context } = setup(brief, cache);
    for (const judge of judges) {
      // A different shuffle per judge so position never favours a model.
      const order = [...runs].sort(() => Math.random() - 0.5);
      const labels = order.map((_, i) => String.fromCharCode(65 + i));
      const shots = context.screenshots.map((s, i) => `screenshot ${i} (${s.name}): ${s.analysis ? `${s.analysis.title}. ${s.analysis.summary}` : "no description"}`).join("\n") || "no screenshots";
      const user = [`BRIEF: ${brief.text}`, `Duration ${brief.seconds}s, voiceover. Intended kind of film: ${brief.expect}. What that kind of film is for: ${PLAYBOOKS[brief.expect].purpose}`, brief.template ? `Starting template: ${context.template?.name} (${context.template?.group}): ${context.template?.summary}` : "No template.", brief.look ? `Look: ${brief.look}` : "", `Screenshots supplied:\n${shots}`, ...order.map((r, i) => `\n=== STORYBOARD ${labels[i]} ===\n${JSON.stringify(compact(r))}`)].filter(Boolean).join("\n");
      try {
        const res = await llmJson({ provider: judge.provider, model: judge.model, system: JUDGE_SYSTEM, user, schema: JUDGE_SCHEMA, maxTokens: 8000, timeoutMs: 180_000 });
        const parsed = JSON.parse(res.text);
        for (const s of parsed.scores) { const i = labels.indexOf(s.label); if (i >= 0) results.push({ brief: brief.id, judge: judge.model, model: order[i].model, ...s, rank: parsed.ranking.indexOf(s.label) + 1 }); }
        console.log("judged", brief.id.padEnd(18), judge.model, "ranking:", parsed.ranking.map((l) => order[labels.indexOf(l)]?.model).join(" > "));
      } catch (error) { console.log("JUDGE FAIL", brief.id, judge.model, String(error.message).slice(0, 120)); }
    }
  }
  await writeFile(join(out, "judgements.json"), JSON.stringify(results, null, 2));
}

if (mode === "report") {
  const files = (await readdir(join(out, "plans"))).filter((f) => f.endsWith(".json"));
  const runs = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(out, "plans", f), "utf8"))));
  const judgements = JSON.parse(await readFile(join(out, "judgements.json"), "utf8").catch(() => "[]"));
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const f1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : "–");
  const lines = ["# Director A/B: Claude vs Gemini", "", `${briefs.length} briefs × ${models.length} models. Plans are scored by automatic checks and by blind judges from both model families (Claude Opus 5.5 and Gemini 4 Argon, positions shuffled, labels hidden).`, "", "## Automatic checks", "", "| Model | Plans ok | Clean after repair | Sales ending on a taught film | Screenshots used | Voiceover vs budget | Avg time | Avg tokens out |", "|---|---|---|---|---|---|---|---|"];
  for (const m of models) {
    const r = runs.filter((x) => x.model === m.id);
    const ok = r.filter((x) => x.ok);
    const taught = ok.filter((x) => ["explainer", "tutorial", "data"].includes(x.expected));
    const shots = ok.filter((x) => x.shots.total > 0);
    lines.push(`| ${m.id} | ${ok.length}/${r.length} | ${ok.filter((x) => x.problems.length === 0).length}/${ok.length} | ${taught.filter((x) => x.cta).length}/${taught.length} | ${shots.reduce((a, x) => a + x.shots.used, 0)}/${shots.reduce((a, x) => a + x.shots.total, 0)} | ${f1(avg(ok.map((x) => x.words / x.budget * 100)))}% | ${f1(avg(ok.map((x) => x.ms / 1000)))}s | ${Math.round(avg(ok.map((x) => x.usage?.outputTokens ?? 0)))} |`);
  }
  lines.push("", "## Blind judge scores (1-10, average over briefs and both judges)", "", "| Model | Type fit | Structure | Script | Context use | Screenshots | Faithfulness | Overall | Avg rank (1 = best) |", "|---|---|---|---|---|---|---|---|---|");
  const dims = ["type_fit", "structure", "script", "context_use", "screenshot_use", "faithfulness"];
  for (const m of models) {
    const j = judgements.filter((x) => x.model === m.id);
    const cols = dims.map((d) => avg(j.map((x) => x[d])));
    lines.push(`| ${m.id} | ${cols.map(f1).join(" | ")} | **${f1(avg(cols))}** | ${f1(avg(j.map((x) => x.rank)))} |`);
  }
  lines.push("", "## By kind of film (overall score, average of both judges)", "", `| Kind | ${models.map((m) => m.id).join(" | ")} |`, `|---|${models.map(() => "---").join("|")}|`);
  for (const kind of ["explainer", "tutorial", "demo", "promo", "story", "data"]) {
    const ids = briefs.filter((b) => b.expect === kind).map((b) => b.id);
    lines.push(`| ${kind} | ${models.map((m) => f1(avg(judgements.filter((x) => x.model === m.id && ids.includes(x.brief)).map((x) => avg(dims.map((d) => x[d])))))).join(" | ")} |`);
  }
  lines.push("", "## Judge agreement", "");
  for (const judge of [...new Set(judgements.map((x) => x.judge))]) lines.push(`- ${judge}: ${models.map((m) => `${m.id} ${f1(avg(judgements.filter((x) => x.judge === judge && x.model === m.id).map((x) => avg(dims.map((d) => x[d])))))}`).join(", ")}`);
  const inferred = briefs.map((b) => { const { spec, context } = setup(b, {}); return [b.id, b.expect, resolveVideoType(spec, context)]; });
  lines.push("", "## Video-type inference (words + template only, no model)", "", inferred.map(([id, want, got]) => `- ${id}: expected ${want}, inferred ${got} ${want === got ? "✓" : "✗"}`).join("\n"));
  await writeFile(join(out, "REPORT.md"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));
}
