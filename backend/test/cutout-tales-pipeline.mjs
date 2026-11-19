// Cutout tales inside the film pipeline, without services: the look is a normal catalog look, a project's beats become
// beat-aligned sentences, a stored shot plan resolves on the plan clock, goes stale when the script changes, and the
// prepared render folder satisfies the worker's render contract (manifest + preflight).
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.PLANNER = "deterministic";
process.env.DATABASE_URL = "postgres://unused@127.0.0.1:1/unused";
process.env.CUTOUT_TALES_ENABLED = "1";
const { isLook, getLook } = await import("../../packages/contracts/src/index.ts");
const { isCutoutLook, cutoutSentences, cutoutFingerprint, currentCutout, cutoutSpecFor, cutoutPreviewHtml, buildCutoutRenderProject, takeCutoutPlanSlot, resetCutoutPlanSlots, CUTOUT_PLAN_MAX, CUTOUT_PLAN_WINDOW_MS } = await import("../src/plan/cutout.ts");
const { planReadiness } = await import("../src/plan/readiness.ts");
const { projectTiming } = await import("../src/plan/preview.ts");
const { preflightRender } = await import("../../worker/src/render-preflight.mjs");
const { cutoutSpecProblems } = await import("../../packages/contracts/src/cutout-tales.ts");

assert.ok(isLook("cutout-tales")); assert.equal(getLook("cutout-tales").renderMode, "native"); assert.equal(getLook("cutout-tales").renderer, "cutout");

const v = (axis, dir) => ({ axis, dir });
const beat = (id, line, role = "feature") => ({ id, role, kind: "kinetic", producer: "engine", line, verb: null, keyword: line.split(" ").slice(0, 2).join(" "), on_screen: null, success: false, energy: "medium", motion: { camera: "push", entry: v("x", -1), exit: v("x", 1) }, transition_out: { type: "cut" } });
const lines = ["A lone rider reached the town at sundown.", "The marshal was waiting at the saloon door.", "He did not smile.", "The rider tipped his hat and rode on."];
const project = {
  id: "11111111-1111-4111-8111-111111111111", name: "t", request: { format: "landscape" }, screenshots: [], comments: [], state: "Draft storyboard",
  brief: { scriptMode: "own", text: lines.join(" "), look: "cutout-tales", aspect: "16:9", pace: "balanced", motionProfile: "smooth", audio: { mode: "none", captions: "none" }, durationSeconds: 20, captions: "none" },
  beatPlan: { canvas: "16:9", target_duration_s: 20, clock: "beats", brand: { name: "T", motion_profile: "smooth" }, characters: [{ id: "rider", description: "a lone rider in a long coat" }], beats: lines.map((l, i) => beat(`b${i + 1}`, l)), audio: { voice: null, music: null, captions: "none" } }
};
assert.ok(isCutoutLook(project));

// Re-plan rate limit: a project gets CUTOUT_PLAN_MAX planner runs per window; force-replan loops are refused until the oldest run ages out.
{
  resetCutoutPlanSlots();
  const t0 = 1_000_000;
  for (let i = 0; i < CUTOUT_PLAN_MAX; i++) assert.equal(takeCutoutPlanSlot("p1", t0 + i).ok, true);
  const refused = takeCutoutPlanSlot("p1", t0 + 10);
  assert.equal(refused.ok, false);
  assert.ok(refused.retryAfterSeconds > 0 && refused.retryAfterSeconds <= CUTOUT_PLAN_WINDOW_MS / 1000);
  assert.equal(takeCutoutPlanSlot("p2", t0 + 10).ok, true, "another film is not affected");
  assert.equal(takeCutoutPlanSlot("p1", t0 + CUTOUT_PLAN_WINDOW_MS + 1).ok, true, "a slot frees once the oldest run leaves the window");
  resetCutoutPlanSlots();
}
const timing = projectTiming(project);
const sentences = cutoutSentences(project, timing);
assert.equal(sentences.length, 4);
assert.deepEqual(sentences.map((s) => s.start), timing.beats.map((b) => b.start), "one sentence per beat, on the beat's slot start");
assert.equal(currentCutout(project), null, "no plan yet");
assert.ok(planReadiness(project).blocking.some((b) => /Plan the cutout shots/.test(b.message)), "Submit is blocked until the shots are planned");

const draft = { aspect: "16:9", seed: 3, shots: [
  { sentences: [0, 0], set: "silhouette", mood: "gold", props: ["riders"], cast: [], overlays: [{ type: "year", text: "1887", atSentence: 0 }] },
  { sentences: [1, 2], set: "western_town", mood: "dusk", cast: [{ archetype: "marshal", name: "Hale", x: 0.7, flip: true, talkSentences: [0] }, { archetype: "drifter", name: "Cade", x: 0.3, look: { shirt: "#aa3322" } }], overlays: [{ type: "tag", text: "HALE", target: 0, atSentence: 0 }] },
  { sentences: [3, 3], set: "silhouette", mood: "gold", props: ["rider"], cast: [] }
] };
const planned = { ...project, cutout: { draft, fingerprint: cutoutFingerprint(project), plannedAt: new Date().toISOString() } };
assert.ok(currentCutout(planned));
assert.equal(planReadiness(planned).blocking.some((b) => /cutout/i.test(b.message)), false);
const { spec } = cutoutSpecFor(planned);
assert.deepEqual(cutoutSpecProblems(spec), []);
assert.equal(spec.shots[0].t0, 0); assert.equal(spec.shots[1].t0, Math.round(timing.beats[1].start * 100) / 100, "cuts land on beat boundaries");
assert.equal(spec.duration, Math.round(timing.total * 100) / 100, "the film runs the plan clock's length");
assert.ok(spec.shots[1].cast[0].talk.length, "the speaker's mouth follows the line window");

// the script changed after planning: the stored plan is stale and the preview refuses until it is replanned
const edited = { ...planned, beatPlan: { ...planned.beatPlan, beats: planned.beatPlan.beats.map((b, i) => (i === 2 ? { ...b, line: "He frowned." } : b)) } };
assert.equal(currentCutout(edited), null);
assert.throws(() => cutoutSpecFor(edited), /not planned/);
const portrait = { ...planned, beatPlan: { ...planned.beatPlan, canvas: "1:1" } };
assert.throws(() => cutoutSpecFor(portrait), /16:9 and 9:16/);

const html = await cutoutPreviewHtml(planned);
assert.match(html, /\/api\/preview\/gsap\.js/); assert.match(html, /"spec":\{"version":1/); assert.ok(html.includes("Grow With Kaz"));

const dir = await mkdtemp(join(tmpdir(), "cutout-render-"));
const built = await buildCutoutRenderProject(planned, dir);
assert.equal(built.durationSeconds, spec.duration);
const folder = await preflightRender(dir, { requireManifest: true });
assert.equal(folder.manifest.scenes.length, 3); assert.equal(folder.manifest.totalFrames, Math.round(spec.duration * 30));
for (const f of ["index.html", "variables.json", "vendor/gsap.min.js", "fonts/fonts.css"]) await stat(join(dir, f));
assert.match(await readFile(join(dir, "index.html"), "utf8"), /data-width="1920" data-height="1080"/);
await rm(dir, { recursive: true, force: true });
console.log("cutout-tales pipeline tests passed");
