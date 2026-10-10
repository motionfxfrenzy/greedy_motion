import { visualStatus, currentClips } from "./visual-state.ts";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { beatPlanProblems, resolveSceneRoute, type VideoProject } from "@videosaas/contracts";
import { config } from "../config.ts";
import { uploadDirectory } from "../storage.ts";
import { audioStatus } from "./audio.ts";
import { projectTiming } from "./preview.ts";
import { buildPlanRenderProject } from "./render-project.ts";
import { TIMING_RULES } from "./timing.ts";

/**
 * Everything that can stop a film is decided on the storyboard, never at render time: the plan's
 * rules, the generated sound for the current lines, the hook and the length. Submit renders exactly
 * what passed here (the render generates nothing: no planner, no TTS, no music), so a render can
 * only fail for infrastructure reasons.
 */
export type Readiness = {
  ok: boolean;
  /** Each item blocks Submit; `beat` points the storyboard at the frame to fix. */
  blocking: { beat: string | null; message: string }[];
  /** Worth a look, never blocking. */
  warnings: { beat: string | null; message: string }[];
  durationSeconds: number | null;
};

const beatOf = (message: string) => /^(b\d+)(?:→b\d+)?:/.exec(message)?.[1] ?? /\((b\d+)\)/.exec(message)?.[1] ?? null;

export function planReadiness(project: VideoProject): Readiness {
  const plan = project.beatPlan;
  if (!plan) return { ok: false, blocking: [{ beat: null, message: "Generate the storyboard first." }], warnings: [], durationSeconds: null };
  const blocking: Readiness["blocking"] = beatPlanProblems(plan, project.brief).map((message) => ({ beat: beatOf(message), message }));
  const visuals = visualStatus(project);
  if (visuals.required && (visuals.status !== "ready" || visuals.ready !== visuals.total)) blocking.push({ beat: null, message: `Generate the selected style’s material scenes before rendering (${visuals.ready}/${visuals.total} ready${visuals.status === "stale" ? "; storyboard changed" : ""}).` });
  const clips = currentClips(project);
  for (const beat of plan.beats) {
    try {
      const route = resolveSceneRoute(beat, project.brief?.look);
      if (route.renderer === "media" && !visuals.required && !clips[beat.id]) blocking.push({beat:beat.id,message:"This scene needs footage before export; its graphic fallback is preview-only."});
      if (route.renderer !== "media" && beat.kind === "ui" && !project.screenshots.some(s=>s.id === beat.ui?.screen)) blocking.push({beat:beat.id,message:"Restore or choose this scene’s screenshot before export."});
    } catch { /* beatPlanProblems reports invalid scene directions above. */ }
  }
  const audio = audioStatus(project);
  if (audio.voice && audio.voice.stale.length) {
    blocking.push({ beat: audio.voice.stale[0], message: audio.voice.ready === 0 ? "The voiceover hasn't been generated yet." : `${audio.voice.stale.length} edited line${audio.voice.stale.length === 1 ? " needs" : "s need"} the voice made again (${audio.voice.stale.join(", ")}).` });
  }
  if (audio.music && !audio.music.ready) blocking.push({ beat: null, message: "The music hasn't been generated yet." });

  const timing = projectTiming(project)!;
  const warnings: Readiness["warnings"] = [];
  for (const message of timing.warnings) {
    // The hook and the length are part of the brief's promise; a voice gap is a pacing note.
    const hard = /the hook runs|more than \d+s \+ 10%|too short for/.test(message);
    // The hook-length word rule already names this beat; one message per problem.
    if (/the hook runs/.test(message) && blocking.some((item) => /hook line is/.test(item.message))) continue;
    (hard ? blocking : warnings).push({ beat: beatOf(message), message });
  }
  // Brand consistency: a project made from a product website should wear that website's brand kit. Without one
  // it renders in a gallery theme, which is allowed but almost never intended.
  const brandId = project.brief?.brandId ?? project.request.brandId;
  if (!brandId && (project.brief?.productUrl || project.site)) {
    warnings.push({ beat: null, message: "This video uses a gallery theme, not your brand. Choose the brand kit read from your website so its colours, fonts and logo are used." });
  }
  const target = plan.target_duration_s;
  if (Math.abs(timing.total - target) > target * TIMING_RULES.tolerance + 0.05 && !blocking.some((item) => /10%|too short/.test(item.message))) {
    blocking.push({ beat: null, message: `The film runs ${timing.total.toFixed(1)}s; the brief asks for ${target}s (±10%).` });
  }
  return { ok: blocking.length === 0, blocking, warnings, durationSeconds: timing.total };
}

export class NotReady extends Error {
  readiness: Readiness;
  constructor(readiness: Readiness) {
    super(readiness.blocking[0]?.message ?? "The storyboard is not ready to render.");
    this.readiness = readiness;
  }
}

/**
 * Submit, pipeline side: re-checks readiness, then writes the finished render folder to
 * <renderOutputDir>/<jobId>/project (the worker sees it at /renders/<jobId>/project). The worker only
 * runs `hyperframes render project --variables-file project/variables.json`.
 */
export async function prepareBeatPlanRender(project: VideoProject, jobId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw new Error("Invalid job id.");
  const readiness = planReadiness(project);
  if (!readiness.ok) throw new NotReady(readiness);
  const dir = join(config.renderOutputDir, jobId, "project");
  const built = await buildPlanRenderProject(project, dir);
  // Object storage: the worker has no shared disk, so the finished folder goes to the uploads bucket and the
  // job carries only its key prefix. The local copy is then redundant.
  let projectPrefix: string | undefined;
  if (config.storageDriver === "r2") {
    projectPrefix = `jobs/${jobId}/project`;
    await uploadDirectory(dir, projectPrefix);
    await rm(join(config.renderOutputDir, jobId), { recursive: true, force: true });
  }
  return { dir, workerDir: `/renders/${jobId}/project`, projectPrefix, durationSeconds: built.durationSeconds, canvas: project.beatPlan!.canvas, tracks: built.tracks.length };
}
