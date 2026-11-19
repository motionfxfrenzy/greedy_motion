import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cutoutCanvas, cutoutSpecProblems, resolveCutoutTimings, type CutoutAspect, type CutoutDraft, type CutoutSpec, type SentenceTiming, type VideoProject } from "@videosaas/contracts";
import { config } from "../config.ts";
import { planDraft } from "../cutout-tales/plan.ts";
import { ensureMedia } from "../media.ts";
import { PreviewUnavailable } from "../preview/service.ts";
import { updateProjectCutout } from "../projects/store.ts";
import { audioMode, planAudioDir } from "./audio.ts";
import { projectTiming } from "./preview.ts";
import { soundTracks, withAudioContinuity, withSoundtrack } from "./sound.ts";
import type { PlanTiming } from "./timing.ts";

/**
 * Cutout tales inside the film pipeline. The brief's script becomes the beat plan as for every look; this module turns
 * those beats (and the brief's characters) into a stored, validated shot list (one planner call, JSON only), and then the
 * SAME composition is used by the storyboard, the animation preview and the render: one shot per beat, cut on the beat
 * boundaries of the plan clock, talking mouths on the voiceover takes. The worker needs nothing new.
 */
export const CUTOUT_LOOK = "cutout-tales";
export const isCutoutLook = (project: Pick<VideoProject, "brief">) => project.brief?.look === CUTOUT_LOOK;
const SUPPORTED_ASPECTS: readonly string[] = ["16:9", "9:16"];
export const cutoutAspectOf = (project: VideoProject): CutoutAspect | null => (project.beatPlan && SUPPORTED_ASPECTS.includes(project.beatPlan.canvas) ? (project.beatPlan.canvas as CutoutAspect) : null);

/** One "sentence" per beat on the film clock: its slot start, to the end of its voiceover when it has one. */
export function cutoutSentences(project: VideoProject, timing: PlanTiming): SentenceTiming[] {
  return project.beatPlan!.beats.map((beat, i) => {
    const t = timing.beats[i]!;
    const text = (beat.line ?? beat.on_screen ?? beat.keyword ?? "").trim() || beat.id;
    return { start: t.start, end: Math.max(t.start + 0.4, t.vo?.end ?? t.end), text };
  });
}

/** What the shot plan depends on: the beats' words and the characters. A change makes the stored plan stale. */
export function cutoutFingerprint(project: VideoProject): string {
  const plan = project.beatPlan!;
  return createHash("sha256").update(JSON.stringify([plan.canvas, plan.beats.map((b) => [b.id, b.line, b.on_screen, b.keyword]), plan.characters.map((c) => [c.id, c.description])])).digest("hex").slice(0, 24);
}

export const currentCutout = (project: VideoProject) => (project.beatPlan && project.cutout?.fingerprint === cutoutFingerprint(project) ? project.cutout : null);

/** Plans (or re-plans) the shots for the current beats and keeps them with the project. */
export async function planCutoutShots(project: VideoProject): Promise<NonNullable<VideoProject["cutout"]>> {
  const aspect = cutoutAspectOf(project);
  if (!aspect) throw new PreviewUnavailable("Cutout tales supports 16:9 and 9:16 films.");
  const timing = projectTiming(project)!;
  const planned = await planDraft(cutoutSentences(project, timing), aspect, project.beatPlan!.characters);
  if ("error" in planned) throw new PreviewUnavailable(`The shots could not be planned: ${planned.error.slice(0, 200)}`);
  const cutout = { draft: planned.draft, fingerprint: cutoutFingerprint(project), plannedAt: new Date().toISOString() };
  await updateProjectCutout(project.id, cutout);
  return cutout;
}

/** The renderable shot list: the stored draft resolved on the project's current plan clock. */
export function cutoutSpecFor(project: VideoProject): { spec: CutoutSpec; timing: PlanTiming } {
  const aspect = cutoutAspectOf(project);
  if (!aspect) throw new PreviewUnavailable("Cutout tales supports 16:9 and 9:16 films.");
  const cutout = currentCutout(project);
  if (!cutout) throw new PreviewUnavailable("The cutout shots are not planned for the current script yet.");
  const timing = projectTiming(project)!;
  const resolved = resolveCutoutTimings({ ...(cutout.draft as CutoutDraft), aspect }, cutoutSentences(project, timing));
  if ("error" in resolved) throw new PreviewUnavailable(`The cutout shots no longer fit the script: ${resolved.error.slice(0, 160)}`);
  const spec = resolved.spec;
  // the film's length is the plan clock's, not the resolver's default tail
  const total = Math.round(timing.total * 100) / 100;
  const last = spec.shots[spec.shots.length - 1]!;
  if (total > last.t0 + 0.5) { spec.duration = total; last.t1 = total; }
  const problems = cutoutSpecProblems(spec);
  if (problems.length) throw new PreviewUnavailable(`The cutout shot list is invalid: ${problems[0]}`);
  return { spec, timing };
}

const rewriteFontUrls = (css: string, to: string) => css.replace(/url\(\s*(["'])?fonts\//g, (_m, q: string) => `url(${q ?? ""}${to}/`);

function stamp(html: string, spec: CutoutSpec): string {
  const { width, height } = cutoutCanvas[spec.aspect];
  const root = /<div id="root"[^>]*>/.exec(html);
  if (!root) throw new PreviewUnavailable("The cutout-tales template has no #root element.");
  const stamped = root[0].replace(/data-width="\d+"/, `data-width="${width}"`).replace(/data-height="\d+"/, `data-height="${height}"`).replace(/data-duration="[\d.]+"/, `data-duration="${spec.duration}"`);
  const json = JSON.stringify({ spec }).replace(/</g, "\\u003c");
  return html.replace(root[0], () => stamped)
    .replace(/<meta name="viewport" content="[^"]*">/, `<meta name="viewport" content="width=${width}, height=${height}">`)
    .replace(/<script id="hf-variables" type="application\/json">[\s\S]*?<\/script>/, () => `<script id="hf-variables" type="application/json">${json}</script>`);
}

const tracksFor = (project: VideoProject, timing: PlanTiming, fileUrl: (file: string) => string) => soundTracks({
  plan: project.beatPlan!, timing, audio: project.planAudio, fileUrl, sfxUrl: (name) => `sfx/${name}.mp3`, hasShot: () => false, mode: audioMode(project), sfx: false, beatGrid: null
}).tracks;

/** The live composition for the storyboard and the animation preview (absolute /api/preview URLs, loaded through srcdoc). */
export async function cutoutPreviewHtml(project: VideoProject): Promise<string> {
  const { spec, timing } = cutoutSpecFor(project);
  const [template, fontCss] = await Promise.all([readFile(join(config.templatesDir, "cutout-tales/index.html"), "utf8"), readFile(join(config.fontsDir, "fonts.css"), "utf8")]);
  const bootstrap = [`<script src="/api/preview/runtime.js"></script>`, `<script src="/api/preview/gsap.js"></script>`].join("\n  ");
  let html = stamp(template, spec).replace('<script src="vendor/gsap.min.js"></script>', () => bootstrap);
  if (!html.includes("/api/preview/gsap.js")) throw new PreviewUnavailable("The cutout-tales template has no supported preview bootstrap.");
  html = withSoundtrack(html, tracksFor(project, timing, (file) => `/api/preview/plans/${project.id}/audio/${file}`));
  html = withAudioContinuity(html);
  return html.replace("</head>", () => `  <style id="fonts">\n${rewriteFontUrls(fontCss, "/api/preview/fonts")}\n  </style>\n</head>`);
}

/** The prepared render folder: the same composition with relative assets, voice takes copied in, and its own manifest. */
export async function buildCutoutRenderProject(project: VideoProject, dir: string) {
  const { spec, timing } = cutoutSpecFor(project);
  const [template, fontCss] = await Promise.all([readFile(join(config.templatesDir, "cutout-tales/index.html"), "utf8"), readFile(join(config.fontsDir, "fonts.css"), "utf8")]);
  await mkdir(join(dir, "vendor"), { recursive: true });
  await cp(config.gsapPath, join(dir, "vendor/gsap.min.js"));
  await cp(config.fontsDir, join(dir, "fonts"), { recursive: true });
  const tracks = tracksFor(project, timing, (file) => `audio/${file}`);
  for (const track of tracks) {
    const from = join(planAudioDir(project.id), track.src.slice("audio/".length));
    if (!(await ensureMedia(from))) throw new Error(`Audio file ${track.src} is missing; generate the audio again.`);
    await mkdir(join(dir, track.src, ".."), { recursive: true });
    await cp(from, join(dir, track.src));
  }
  let html = withSoundtrack(stamp(template, spec), tracks);
  html = html.replace("</head>", () => `  <style id="fonts">\n${fontCss}\n  </style>\n</head>`);
  await writeFile(join(dir, "index.html"), html);
  await writeFile(join(dir, "variables.json"), "{}");
  // The worker's render contract (worker/src/render-preflight.mjs): contiguous scenes, one per shot, and file fingerprints.
  let next = 0;
  const scenes = spec.shots.map((shot, i) => {
    const startFrame = next, endFrame = Math.max(startFrame + 1, Math.round(shot.t1 * 30));
    next = endFrame;
    return { id: `s${i + 1}`, startFrame, endFrame, route: { renderer: "canvas2d", treatment: CUTOUT_LOOK, graphic: "none", editability: "parameters-and-live-text", reason: "Code-drawn cutout shot." } };
  });
  const files: Record<string, { sha256: string; bytes: number }> = {};
  for (const file of ["index.html", "variables.json"]) { const bytes = await readFile(join(dir, file)); files[file] = { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length }; }
  const { width, height } = cutoutCanvas[spec.aspect];
  await writeFile(join(dir, "render-manifest.json"), JSON.stringify({ version: 1, compositor: "hyperframes", workerClass: "browser", fps: 30, canvas: { width, height }, totalFrames: next, scenes, files }, null, 2));
  return { timing, tracks, durationSeconds: spec.duration };
}
