import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
process.env.PLANNER ??= "deterministic";
process.env.ANTHROPIC_API_KEY ??= "test";
process.env.GEMINI_API_KEY ??= "test";

const { scriptFrameKey, parseFrameMotion } = await import("@videosaas/contracts");
const { filmFrames, enrichMotion } = await import("../src/plan/frame-film.ts");
const { filmScenes, motionSignature } = await import("../src/plan/frame-motion.ts");
const { projectTiming } = await import("../src/plan/preview.ts");

// A frame that uses a gradient (the common case): scoping renames the gradient per frame.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><defs><linearGradient id="sky-grad"><stop offset="0" stop-color="#9cf"/><stop offset="1" stop-color="#fff"/></linearGradient></defs>
<rect id="bg" width="1280" height="720" fill="url(#sky-grad)"/><text id="title" x="640" y="80" font-size="40">Title</text>
${[0, 1, 2, 3, 4, 5].map((i) => `<circle id="dot${i}" cx="${300 + i * 120}" cy="400" r="20" fill="#f80"/>`).join("")}</svg>`;

const beat = { id: "b1", role: "hook", kind: "kinetic", keyword: "Dots", on_screen: null, line: "Many dots jiggle", verb: null, success: false, energy: "high", ui: null, motion: { entry: { axis: "x", dir: -1 }, exit: { axis: "y", dir: -1 } }, transition_out: { type: "end" } };
const scriptBeat = { keyword: "Dots", visual: "dots", onScreen: null, line: "Many dots jiggle" };
const brief = { aspect: "16:9", scriptBeats: [scriptBeat], pace: "balanced", durationSeconds: 5, audio: { mode: "none" } };
const project = {
  id: "00000000-0000-4000-8000-000000000001", brief, request: {},
  beatPlan: { canvas: "16:9", motion_profile: "smooth", captions: "key-phrases", target_duration_s: 5, audio: { music: null, voice: null, captions: "key-phrases" }, beats: [beat], suggestions: [] },
  scriptFrames: [{ key: scriptFrameKey(scriptBeat, brief), svg }]
};

test("the motion saved at authoring time is the motion the preview finds (same signature)", () => {
  const timing = projectTiming(project);
  const frames = filmFrames(project, timing);
  assert.ok(frames, "frames built");
  // The authoring paths (routes.ts, readiness.ts, step-billing.ts) hand filmFrames' frames to filmScenes.
  const authored = filmScenes(project, timing, frames).map(motionSignature);
  // Save a directed motion under that signature, as ensureFilmMotion does.
  const saved = [{ signature: authored[0], svg: "", motion: parseFrameMotion([{ kind: "vibrate", ids: ["dot0", "dot1", "dot2", "dot3"], mode: "jiggle", amp: 3, freq: 9, start: 0.4, end: 4 }], svg, 5) }];
  // The preview and render look the motion up through filmFrames.
  const previewFrames = filmFrames({ ...project, filmMotion: saved }, timing);
  const kinds = previewFrames[0].motion.map((m) => m.kind);
  assert.ok(kinds.includes("vibrate"), `the directed vibrate survives into the preview frames (got ${kinds.join(",") || "none"})`);
});

const { parseMotionText } = await import("../src/plan/frame-motion.ts");
const { withFrameFilm } = await import("../src/plan/frame-film.ts");

test("model output with prose, fences, trailing commas or bare keys still parses", () => {
  const text = 'Here you go:\n```json\n[\n  {kind: "vibrate", ids: ["dot0","dot1",], mode: "jiggle", amp: 3, freq: 9, start: 0.4, end: 4,},\n  // pointer\n  {"kind":"draw","ids":["dot2"],"start":1,"end":2}\n]\n```';
  const parsed = parseFrameMotion(parseMotionText(text), svg, 5);
  assert.deepEqual(parsed.map((m) => m.kind), ["vibrate", "draw"]);
});

test("end to end: model answer -> parsed -> stored under the authoring signature -> preview page carries the non-move kinds", async () => {
  const timing = projectTiming(project);
  const authored = filmScenes(project, timing, filmFrames(project, timing));
  const answer = '[{"kind":"grow","ids":["dot0"],"from":"bottom","start":0.3,"end":1.2},{"kind":"vibrate","ids":["dot1","dot2","dot3"],"mode":"wave","amp":3,"freq":8,"start":1,"end":4},{"kind":"move","id":"dot4","from":{"opacity":"0"},"start":0.2,"end":0.8}]';
  const stored = [{ signature: motionSignature(authored[0]), svg: authored[0].svg, motion: parseFrameMotion(parseMotionText(answer), authored[0].svg, 5) }];
  const frames = filmFrames({ ...project, filmMotion: stored }, timing);
  const html = await withFrameFilm("<html><head></head><body><div id=\"captions\" data-layout-allow-overlap></div></body></html>", frames, "explainer", []);
  const data = JSON.parse(/<script id="ff-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1].replace(/\\u003c/g, "<"));
  const kinds = new Set(data.beats[0].motion.map((m) => m.kind));
  for (const kind of ["grow", "vibrate", "move"]) assert.ok(kinds.has(kind), `${kind} reaches the preview page (got ${[...kinds].join(",")})`);
});
