import { enqueueVisuals, visualStatus, VisualWorkerBusy } from "./visuals.ts";
import { materialBillingOn, visualDir, digest, verifyVisualAssets } from "./visual-state.ts";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { aspects, audioModes, captionModes, BEAT_LIMITS, effectiveBriefDurationSeconds, ensureScriptBeatIds, findGalleryTemplate, formatForDuration, inferVideoType, isAnimationTier, isPaidTier, isScriptLedDuration, materialCostMillitokens, materialCostMillitokensV2, parseScriptNotes, resolvePrimaryAspect, scriptFrameKey, SCRIPT_BEATS_MAX, SCRIPT_BEATS_MIN, getStyleFamily, parseScriptBeats, scenesFor, textEffects, transitionTypes, aspectToFormat, beatPlanProblems, isLook, parseScriptBrief, plainText, voices, voiceIds, voiceText, validateBeatLayoutHint, validateHyperFramesOverrides, type Aspect, type AudioMode, type Beat, type BeatPlan, type CaptionMode, type EditPatch, type LookId, type PlanAudio, type ProjectScript, type ScriptBeat, type ScriptBrief, type ScriptNotes, type VideoProject } from "@videosaas/contracts";
import { callerId } from "../auth.ts";
import { getBrand } from "../brand/store.ts";
import { registerRequestId, requestIdOf, upstreamError, upstreamSseError } from "../http-errors.ts";
import { getProject, ProjectInvalid, saveScriptFrame, setCoverFrame, setProjectPlanning, updateProject, updateProjectAudio, updateProjectPlan, type PlanMutationPatch } from "../projects/store.ts";
import { config } from "../config.ts";
import {
  PremiumRequiresSubscriptionError,
  QuoteStaleError,
  assertAnimationTierEntitled,
  effectiveBillingPolicyVersion,
  quoteAnimationStep,
  quoteElementEditStep,
  quoteFrameSketchStep,
  quotePlateDrawStep,
  quoteScriptStep,
  quoteStoryboardPlanStep,
  quoteVoiceMusicStep,
  releaseStepReservation,
  reserveStepTokens,
  resolveProjectAnimationTier,
  settlePartialStepReservation,
  settleStepReservation,
  settleVoiceMusicReservation,
  stepBillingOnForProject,
  verifyStepQuote
} from "../billing/step-billing.ts";
import { InsufficientTokens, refundSpend, spendTokens, tokenSummary } from "../tokens/store.ts";
import { synthesizeVoiceover, TTS_MODEL } from "../audio/gemini-tts.ts";
import { readMedia, saveMedia } from "../media.ts";
import { mediaToken, signPreviewUrls } from "../media-links.ts";
import { AudioUnavailable, audioStatus, planAudioDir, producePlanAudio, type AudioPart } from "./audio.ts";
import { filmFrames } from "./frame-film.ts";
import { ensureFilmMotion, filmScenes } from "./frame-motion.ts";
import { setPlateSubtitles } from "../plates/service.ts";
import { musicPrompt, produceMusic } from "./music.ts";
import { speakerSettings, takeKey, VOICE_RULES, voiceOneLine, voiceSettings } from "./voice.ts";
import { director } from "./director.ts";
import { directorContextFor } from "./context.ts";
import { draftScript, reviseScript } from "./script-draft.ts";
import { finishInsertedScene, finishScript, writeInsertedScene, writeScript } from "./script-writer.ts";
import { sketchFrame } from "./frame-sketch.ts";
import { readGalleryText } from "../gallery.ts";
import { rewriteBeat } from "./rewrite-beat.ts";
import { SFX } from "./sound.ts";
import { registerSiteRoutes } from "../site/routes.ts";
import { planReadiness } from "./readiness.ts";
import { textValues } from "./composition.ts";
import { planPreviewHtml, projectTiming } from "./preview.ts";
import {
  commitHyperFramesCommentEdits,
  computePlanVersion,
  EditRefusedError,
  InvalidSnapshotsError,
  proposeHyperFramesCommentEdits,
  StalePlanVersionError,
  type CommitEditResult
} from "./element-edits.ts";
import { beatTimes } from "./timing.ts";
import { PreviewUnavailable } from "../preview/service.ts";
import { ensurePromptAllowed } from "../moderation/creem.ts";
import { admitPreview, meteringOn } from "./preview-meter.ts";
import { tierFor } from "../billing/service.ts";
import { isPlateLook, startPlates } from "../plates/service.ts";

const notFound = { error: { code: "not_found", message: "Project not found." } };

/** Director jobs running in this process. Shutdown waits for them, so a deploy does not drop a script half-written. */
const runningPlans = new Set<Promise<void>>();
const jobs = new Map<string, AbortController>();
const planReservations = new Map<string, string>();
export const MAX_PLAN_ATTEMPTS = 3;
export const PLAN_RESUME_GRACE_MS = 5_000;
export const isPlanRunning = (projectId: string) => jobs.has(projectId);
export function clearRunningPlansForTest(projectId?: string) {
  if (projectId) {
    jobs.delete(projectId);
    return;
  }
  jobs.clear();
}
export async function waitForPlans(timeoutMs: number) {
  if (runningPlans.size === 0) return;
  await Promise.race([Promise.allSettled([...runningPlans]), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
}

function spawnPlanExecution(input: {
  project: VideoProject;
  brief: ScriptBrief;
  planReservationId: string | null;
  startedAtIso: string;
  attempt: number;
  resuming: boolean;
  logInfo?: (obj: Record<string, unknown>, msg: string) => void;
  logError?: (obj: Record<string, unknown>, msg: string) => void;
  requestId?: string;
}): void {
  const { project, brief, planReservationId, startedAtIso, attempt, resuming } = input;
  if (planReservationId) {
    planReservations.set(project.id, planReservationId);
  }
  const controller = new AbortController();
  jobs.set(project.id, controller);
  const startedAt = Date.now();
  input.logInfo?.(
    { event: resuming ? "plan_resumed" : "plan_started", projectId: project.id, attempt, resuming, template: brief.styleExample ?? null },
    resuming ? "plan resumed after restart" : "plan started"
  );
  const job = (async () => {
    try {
      const { context, videoType, brandId } = await directorContextFor(project, brief);
      const result = await director.plan({ ...brief, videoType }, context, controller.signal);
      if (controller.signal.aborted) {
        if (planReservationId) {
          planReservations.delete(project.id);
          await releaseStepReservation(planReservationId).catch(() => undefined);
        }
        return;
      }
      const voiced = brief.audio.mode === "voiceover" || brief.audio.mode === "both";
      const music = brief.audio.mode === "music" || brief.audio.mode === "both";
      await updateProjectPlan(project.id, (current) => ({
        brief: {
          ...brief,
          videoType,
          // Preserve any newer scriptBeats edits made by the user while background planning was running
          ...(current.brief?.scriptBeats?.length ? { scriptBeats: current.brief.scriptBeats } : {}),
          ...(current.brief?.scriptNotes ? { scriptNotes: current.brief.scriptNotes } : {})
        },
        beatPlan: result.plan,
        script: {
          ...scriptFromPlan(result.plan, brief.scriptMode === "own" ? "provided" : "generated"),
          ...(current.script?.title ? { title: current.script.title } : {}),
          videoType
        },
        state: "Draft storyboard",
        request: {
          ...current.request,
          format: aspectToFormat(brief.aspect),
          audio: { music, voiceover: voiced, voice: current.request.audio?.voice ?? "Kore" },
          ...(brandId ? { brandId } : {})
        }
      }));
      if (planReservationId) {
        planReservations.delete(project.id);
        await settleStepReservation(planReservationId).catch(() => undefined);
      }
      input.logInfo?.(
        {
          event: "plan_done",
          projectId: project.id,
          attempt,
          resumed: resuming,
          ms: Date.now() - startedAt,
          model: result.model,
          ...(result.repairedFrom ? { repairedFrom: result.repairedFrom } : {}),
          ...(result.problems.length ? { problems: result.problems } : {})
        },
        "plan applied"
      );
    } catch (error) {
      if (planReservationId) {
        planReservations.delete(project.id);
        await releaseStepReservation(planReservationId).catch(() => undefined);
      }
      if (controller.signal.aborted) return; // cancelled: the cancel route already recorded it
      input.logError?.(
        { event: "plan_failed", projectId: project.id, attempt, ms: Date.now() - startedAt, err: error, ...(input.requestId ? { requestId: input.requestId } : {}) },
        "script director failed"
      );
      const message = error instanceof ProjectInvalid ? error.message : "The script director failed.";
      await setProjectPlanning(project.id, {
        status: "failed",
        startedAt: startedAtIso,
        attempt,
        error: message
      }).catch(() => undefined);
    } finally {
      if (jobs.get(project.id) === controller) jobs.delete(project.id);
    }
  })();
  runningPlans.add(job);
  void job.finally(() => runningPlans.delete(job));
}

/**
 * Reconciles an interrupted in-flight storyboard planning job (`planning.status === "running"` with no active in-process worker).
 * Automatically resumes transient server-restart interruptions up to `MAX_PLAN_ATTEMPTS` with `resuming: true`
 * ("Resuming your storyboard"), preserving user edits and reservations, and never resurrecting cancelled jobs.
 */
export async function reconcileInterruptedPlanning(
  project: VideoProject,
  options?: { graceMs?: number; maxAttempts?: number; nowMs?: number }
): Promise<VideoProject> {
  if (!project.planning || project.planning.status !== "running") return project;
  if (isPlanRunning(project.id)) return project;
  const nowMs = options?.nowMs ?? Date.now();
  const graceMs = options?.graceMs ?? PLAN_RESUME_GRACE_MS;
  const maxAttempts = options?.maxAttempts ?? MAX_PLAN_ATTEMPTS;
  const startedMs = Date.parse(project.planning.startedAt);
  if (Number.isFinite(startedMs) && nowMs - startedMs < graceMs) {
    return project;
  }

  const prevAttempt = Math.max(1, project.planning.attempt ?? 1);
  const savedReservationId = project.planning.reservationId ?? planReservations.get(project.id) ?? null;
  const resumeBrief = project.planning.brief ?? project.brief;

  if (resumeBrief && prevAttempt < maxAttempts) {
    const nextAttempt = prevAttempt + 1;
    const nextStartedAt = new Date(nowMs).toISOString();
    const updated =
      (await setProjectPlanning(
        project.id,
        {
          status: "running",
          startedAt: nextStartedAt,
          resuming: true,
          attempt: nextAttempt,
          ...(savedReservationId ? { reservationId: savedReservationId } : {}),
          brief: resumeBrief
        },
        resumeBrief
      )) ?? project;
    if (!isPlanRunning(project.id) && updated.planning?.status === "running") {
      spawnPlanExecution({
        project: updated,
        brief: resumeBrief,
        planReservationId: savedReservationId,
        startedAtIso: nextStartedAt,
        attempt: nextAttempt,
        resuming: true
      });
    }
    return updated;
  }

  if (savedReservationId) {
    planReservations.delete(project.id);
    await releaseStepReservation(savedReservationId).catch(() => undefined);
  }
  return (
    (await setProjectPlanning(project.id, {
      status: "failed",
      startedAt: project.planning.startedAt,
      attempt: prevAttempt,
      error: "Planning was interrupted by a server restart. Click Retry to continue."
    })) ?? project
  );
}
type SceneInsertWriter = typeof writeInsertedScene;
let sceneInsertWriterOverride: SceneInsertWriter | null = null;
export function setSceneInsertWriterForTest(writer: SceneInsertWriter | null) {
  sceneInsertWriterOverride = writer;
}

export type SceneInsertApiResult = {
  project: VideoProject;
  insertedBeat: ScriptBeat;
  position: number;
  beats: ScriptBeat[];
  notes: ScriptNotes | null;
  flags: { beat: number; message: string }[];
};

const sceneInsertIdempotency = new Map<string, Promise<SceneInsertApiResult>>();
const meteredSceneInsertKeys = new Set<string>();

/** A script view of the plan, so existing screens (review, comments) keep working. */
function scriptFromPlan(plan: BeatPlan, source: ProjectScript["source"]): ProjectScript {
  return {
    source,
    lines: plan.beats.slice(0, SCRIPT_BEATS_MAX).map((beat) => ({ label: beat.role[0].toUpperCase() + beat.role.slice(1), onScreen: (beat.on_screen ?? beat.keyword).slice(0, 180), ...(beat.line ? { voiceover: beat.line.slice(0, 240) } : {}) })),
    confirmed: false,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Builds or updates a BeatPlan directly from the Script Canvas beats in <1ms so the in-browser animation
 * does not have to wait 90-120s for a separate LLM director pass when the user has already approved the script and frames.
 */
function buildPlanFromScriptBeats(brief: ScriptBrief, beats: ScriptBeat[], existing?: BeatPlan): BeatPlan {
  const voiced = brief.audio.mode === "voiceover" || brief.audio.mode === "both";
  const music = brief.audio.mode === "music" || brief.audio.mode === "both";
  const count = beats.length;
  const planBeats: Beat[] = beats.map((beat, index) => {
    const prev = existing?.beats[index];
    const role: Beat["role"] =
      prev?.role ??
      (index === 0 ? "hook" : index === count - 1 ? "cta" : index === count - 2 ? "insight" : "step");
    const kind: Beat["kind"] = prev?.kind ?? (index === count - 1 && !brief.scriptNotes?.example ? "title" : "kinetic");
    return {
      ...(prev?.render ? { render: prev.render } : {}),
      id: `b${index + 1}`,
      role,
      kind,
      producer: prev?.producer ?? "hyperframes",
      line: beat.line ?? null,
      verb: prev?.verb ?? null,
      keyword: (beat.keyword || `Scene ${index + 1}`).trim(),
      on_screen: beat.onScreen ?? null,
      success: prev?.success ?? (index === count - 2 && count >= 3),
      energy: prev?.energy ?? (index === 0 || index === count - 1 ? "high" : "medium"),
      ...(prev?.ui ? { ui: prev.ui } : {}),
      motion: prev?.motion ?? {
        camera: "steady",
        entry: { axis: "x", dir: -1 },
        exit: { axis: "x", dir: -1 },
        text_effect: "waterfall"
      },
      ...(prev?.fallback ? { fallback: prev.fallback } : {}),
      sfx: prev?.sfx ?? null,
      scene: prev?.scene ?? null,
      ...(prev?.hints ? { hints: prev.hints } : {}),
      transition_out: { type: index === count - 1 ? "end" : (prev?.transition_out.type && prev.transition_out.type !== "end" ? prev.transition_out.type : "j-cut") }
    };
  });
  const effectiveSec = effectiveBriefDurationSeconds(brief, beats);
  return {
    version: "1.0",
    mode: brief.scriptMode === "own" ? "own-script" : "problem-only",
    template: brief.template ?? existing?.template ?? null,
    format: formatForDuration(effectiveSec),
    canvas: brief.aspect,
    target_duration_s: effectiveSec,
    ...(isScriptLedDuration(brief) ? { duration_mode: "script" as const } : {}),
    clock: voiced ? "voiceover" : "beats",
    brand: {
      name: brief.productName ?? existing?.brand.name ?? "",
      motion_profile: brief.motionProfile,
      style_frame: existing?.brand.style_frame ?? null
    },
    characters: existing?.characters ?? [],
    beats: planBeats,
    audio: {
      voice: voiced
        ? {
            engine: "gemini-tts",
            voice: brief.audio.voice ?? existing?.audio.voice?.voice ?? "Kore",
            speed: 1,
            direction: existing?.audio.voice?.direction ?? "clear, engaging narration"
          }
        : null,
      music: music
        ? {
            source: "lyria",
            prompt: brief.audio.musicMood ?? existing?.audio.music?.prompt ?? "warm modern instrumental",
            ...(existing?.audio.music?.bpm ? { bpm: existing.audio.music.bpm } : {})
          }
        : null,
      captions: brief.captions
    },
    approvals: ["script", "storyboard", "motion-preview"],
    suggestions: existing?.suggestions ?? [],
    ...(existing?.overrides && Object.keys(existing.overrides).length > 0 ? { overrides: existing.overrides } : {}),
    estimate: existing?.estimate ?? { generated_shots: 0, api_usd: 0.25 }
  };
}

function makeInsertedPlanBeat(beat: ScriptBeat, index: number, total: number, notes?: ScriptNotes | null): Beat {
  const role: Beat["role"] = index === 0 ? "hook" : index === total - 1 ? "cta" : "step";
  const kind: Beat["kind"] = index === total - 1 && !notes?.example ? "title" : "kinetic";
  return {
    id: `b${index + 1}`,
    role,
    kind,
    producer: "hyperframes",
    line: beat.line ?? null,
    verb: null,
    keyword: (beat.keyword || `Scene ${index + 1}`).trim(),
    on_screen: beat.onScreen ?? null,
    success: false,
    energy: index === 0 || index === total - 1 ? "high" : "medium",
    motion: {
      camera: "steady",
      entry: { axis: "x", dir: -1 },
      exit: { axis: "x", dir: -1 },
      text_effect: "waterfall"
    },
    sfx: null,
    scene: null,
    transition_out: { type: index === total - 1 ? "end" : "j-cut" }
  };
}

function rechainPlanBeats(planBeats: Beat[], scriptBeats: ScriptBeat[]): Beat[] {
  const total = planBeats.length;
  const out = planBeats.map((b, i) => {
    const sb = scriptBeats[i];
    const isLast = i === total - 1;
    const prevType = b.transition_out?.type;
    const nextTransitionType: Beat["transition_out"]["type"] = isLast ? "end" : prevType && prevType !== "end" ? prevType : "j-cut";
    return {
      ...b,
      id: `b${i + 1}`,
      keyword: (sb?.keyword ?? b.keyword ?? `Scene ${i + 1}`).trim(),
      on_screen: sb !== undefined ? (sb.onScreen ?? null) : (b.on_screen ?? null),
      line: sb !== undefined ? (sb.line ?? null) : (b.line ?? null),
      motion: {
        ...b.motion,
        entry: { ...(b.motion?.entry ?? { axis: "x", dir: -1 }) },
        exit: { ...(b.motion?.exit ?? { axis: "x", dir: -1 }) }
      },
      transition_out: {
        ...b.transition_out,
        type: nextTransitionType
      }
    };
  });
  for (let i = 1; i < out.length; i++) {
    out[i]!.motion.entry = { ...out[i - 1]!.motion.exit };
  }
  return out;
}

function remapOverridesOnInsert(
  overrides: BeatPlan["overrides"] | undefined,
  position: number,
  restoredForPosition?: Record<string, unknown> | null
): BeatPlan["overrides"] | undefined {
  if (!overrides && (!restoredForPosition || Object.keys(restoredForPosition).length === 0)) return undefined;
  const next: Record<string, NonNullable<BeatPlan["overrides"]>[string]> = {};
  for (const [key, val] of Object.entries(overrides ?? {})) {
    const m = /^b(\d+)(:.*|$)/.exec(key);
    if (!m) {
      next[key] = val;
      continue;
    }
    const oldIdx = Number(m[1]) - 1;
    const newIdx = oldIdx >= position ? oldIdx + 1 : oldIdx;
    next[`b${newIdx + 1}${m[2]}`] = val;
  }
  if (restoredForPosition) {
    for (const [suffix, val] of Object.entries(restoredForPosition)) {
      const fullKey = suffix.startsWith(":") || suffix === "" ? `b${position + 1}${suffix}` : suffix;
      next[fullKey] = val as NonNullable<BeatPlan["overrides"]>[string];
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function remapOverridesOnRemove(
  overrides: BeatPlan["overrides"] | undefined,
  removeIndex: number
): { next: BeatPlan["overrides"] | undefined; removed: Record<string, unknown> } {
  const removed: Record<string, unknown> = {};
  if (!overrides) return { next: undefined, removed };
  const next: Record<string, NonNullable<BeatPlan["overrides"]>[string]> = {};
  for (const [key, val] of Object.entries(overrides)) {
    const m = /^b(\d+)(:.*|$)/.exec(key);
    if (!m) {
      next[key] = val;
      continue;
    }
    const oldIdx = Number(m[1]) - 1;
    if (oldIdx === removeIndex) {
      removed[m[2] || ""] = val;
    } else {
      const newIdx = oldIdx > removeIndex ? oldIdx - 1 : oldIdx;
      next[`b${newIdx + 1}${m[2]}`] = val;
    }
  }
  return { next: Object.keys(next).length > 0 ? next : undefined, removed };
}

function remapPlanAudioOnInsert(
  audio: PlanAudio | undefined,
  position: number,
  insertedBeat: ScriptBeat
): PlanAudio | undefined {
  if (!audio?.voice?.lines) return audio;
  const insertedText = voiceText(insertedBeat.line);
  let restoredMatch = false;
  const lines = audio.voice.lines.map((line) => {
    const m = /^b(\d+)$/.exec(line.beat);
    if (m) {
      const oldIdx = Number(m[1]) - 1;
      const newIdx = oldIdx >= position ? oldIdx + 1 : oldIdx;
      return { ...line, beat: `b${newIdx + 1}` };
    }
    if (!restoredMatch && insertedText && line.text === insertedText && line.beat.startsWith("archived:")) {
      restoredMatch = true;
      return { ...line, beat: `b${position + 1}` };
    }
    return line;
  });
  return {
    ...audio,
    voice: { ...audio.voice, lines }
  };
}

function remapPlanAudioOnRemove(audio: PlanAudio | undefined, removeIndex: number): PlanAudio | undefined {
  if (!audio?.voice?.lines) return audio;
  const lines = audio.voice.lines.map((line) => {
    const m = /^b(\d+)$/.exec(line.beat);
    if (!m) return line;
    const oldIdx = Number(m[1]) - 1;
    if (oldIdx === removeIndex) {
      return { ...line, beat: `archived:b${removeIndex + 1}` };
    }
    const newIdx = oldIdx > removeIndex ? oldIdx - 1 : oldIdx;
    return { ...line, beat: `b${newIdx + 1}` };
  });
  return {
    ...audio,
    voice: { ...audio.voice, lines }
  };
}

export function reconcileProjectAfterSceneInsert(
  current: VideoProject,
  options: {
    brief: ScriptBrief;
    previousBeats: ScriptBeat[];
    position: number;
    insertedBeat: ScriptBeat;
    notes?: ScriptNotes | null;
    planBeatOverride?: Beat | null;
    restoredOverrides?: Record<string, unknown> | null;
  }
): PlanMutationPatch {
  const { brief: incomingBrief, previousBeats, position, insertedBeat, notes, planBeatOverride, restoredOverrides } = options;
  const nextBeats = ensureScriptBeatIds([
    ...previousBeats.slice(0, position),
    insertedBeat,
    ...previousBeats.slice(position)
  ]);
  const keepOverLength = current.keepOverLength ?? current.brief?.keepOverLength ?? incomingBrief.keepOverLength;
  const nextNotes = notes !== undefined ? notes : incomingBrief.scriptNotes ?? current.brief?.scriptNotes;
  const nextBrief: ScriptBrief = {
    ...incomingBrief,
    scriptBeats: nextBeats,
    ...(nextNotes ? { scriptNotes: nextNotes } : {}),
    ...(keepOverLength ? { keepOverLength: true } : {})
  };

  let nextPlan: BeatPlan | undefined = current.beatPlan ? structuredClone(current.beatPlan) : undefined;
  if (nextPlan) {
    const existingBeats = nextPlan.beats.length === previousBeats.length
      ? nextPlan.beats
      : buildPlanFromScriptBeats(incomingBrief, previousBeats, nextPlan).beats;
    const insertedPlanBeat = planBeatOverride
      ? structuredClone(planBeatOverride)
      : makeInsertedPlanBeat(insertedBeat, position, nextBeats.length, nextNotes);
    const rawPlanBeats = [
      ...existingBeats.slice(0, position),
      insertedPlanBeat,
      ...existingBeats.slice(position)
    ];
    nextPlan.beats = rechainPlanBeats(rawPlanBeats, nextBeats);
    const effectiveSec = effectiveBriefDurationSeconds(nextBrief, nextBeats);
    nextPlan.target_duration_s = effectiveSec;
    nextPlan.format = formatForDuration(effectiveSec);
    nextPlan.canvas = nextBrief.aspect;
    if (isScriptLedDuration(nextBrief)) nextPlan.duration_mode = "script";
    else delete nextPlan.duration_mode;
    const nextOverrides = remapOverridesOnInsert(nextPlan.overrides, position, restoredOverrides);
    if (nextOverrides) nextPlan.overrides = nextOverrides;
    else delete nextPlan.overrides;
    if (Array.isArray(nextPlan.suggestions)) {
      nextPlan.suggestions = nextPlan.suggestions.map((s) => {
        const m = /^b(\d+)$/.exec(s.beat);
        if (!m) return s;
        const oldIdx = Number(m[1]) - 1;
        return { ...s, beat: `b${(oldIdx >= position ? oldIdx + 1 : oldIdx) + 1}` };
      });
    }
  } else {
    nextPlan = buildPlanFromScriptBeats(nextBrief, nextBeats);
  }

  const nextAudio = remapPlanAudioOnInsert(current.planAudio, position, insertedBeat);
  const firstFrameKey = scriptFrameKey(nextBeats[0]!, nextBrief);
  const savedFirstSvg = (current.scriptFrames ?? []).find((f) => f.key === firstFrameKey)?.svg;
  const requiresNewRender = ["Ready for review", "Revisions needed", "Approved", "Render needs attention"].includes(current.state);

  return {
    brief: nextBrief,
    beatPlan: nextPlan,
    script: scriptFromPlan(nextPlan, nextBrief.scriptMode === "own" ? "provided" : "generated"),
    state: requiresNewRender ? "Draft storyboard" : current.state,
    ...(nextAudio ? { planAudio: nextAudio } : {}),
    ...(savedFirstSvg ? { coverFrame: savedFirstSvg } : {}),
    ...(requiresNewRender ? { filmSeconds: undefined } : {}),
    ...(keepOverLength !== undefined ? { keepOverLength } : {})
  };
}

export function reconcileProjectAfterSceneRemove(
  current: VideoProject,
  options: {
    index: number;
    brief?: ScriptBrief | null;
    beats?: ScriptBeat[] | null;
  }
): {
  patch: PlanMutationPatch;
  removedBeat: ScriptBeat;
  removedPlanBeat: Beat | null;
  removedOverrides: Record<string, unknown>;
  beats: ScriptBeat[];
} {
  const baseBrief = options.brief ?? current.brief;
  if (!baseBrief) throw new ProjectInvalid("Generate the storyboard first.");
  const sourceBeats = ensureScriptBeatIds(
    options.beats ??
      baseBrief.scriptBeats ??
      current.brief?.scriptBeats ??
      (current.beatPlan?.beats ?? []).map((b) => ({
        keyword: b.keyword,
        visual: null,
        onScreen: b.on_screen ?? null,
        line: b.line ?? null
      }))
  );
  const { index } = options;
  if (!Number.isInteger(index) || index < 0 || index >= sourceBeats.length) {
    throw new ProjectInvalid("Choose an existing scene to remove.");
  }
  if (sourceBeats.length <= SCRIPT_BEATS_MIN) {
    throw new ProjectInvalid("A storyboard needs at least one scene.");
  }
  const removedBeat = sourceBeats[index]!;
  const nextBeats = [...sourceBeats.slice(0, index), ...sourceBeats.slice(index + 1)];
  const keepOverLength = current.keepOverLength ?? current.brief?.keepOverLength ?? baseBrief.keepOverLength;
  const nextBrief: ScriptBrief = {
    ...baseBrief,
    scriptBeats: nextBeats,
    ...(keepOverLength ? { keepOverLength: true } : {})
  };

  let removedPlanBeat: Beat | null = null;
  let removedOverrides: Record<string, unknown> = {};
  let nextPlan: BeatPlan | undefined = current.beatPlan ? structuredClone(current.beatPlan) : undefined;
  if (nextPlan) {
    const existingBeats = nextPlan.beats.length === sourceBeats.length
      ? nextPlan.beats
      : buildPlanFromScriptBeats(baseBrief, sourceBeats, nextPlan).beats;
    removedPlanBeat = existingBeats[index] ? structuredClone(existingBeats[index]!) : null;
    const remainingPlanBeats = [...existingBeats.slice(0, index), ...existingBeats.slice(index + 1)];
    nextPlan.beats = rechainPlanBeats(remainingPlanBeats, nextBeats);
    const effectiveSec = effectiveBriefDurationSeconds(nextBrief, nextBeats);
    nextPlan.target_duration_s = effectiveSec;
    nextPlan.format = formatForDuration(effectiveSec);
    nextPlan.canvas = nextBrief.aspect;
    if (isScriptLedDuration(nextBrief)) nextPlan.duration_mode = "script";
    else delete nextPlan.duration_mode;
    const remappedOv = remapOverridesOnRemove(nextPlan.overrides, index);
    removedOverrides = remappedOv.removed;
    if (remappedOv.next) nextPlan.overrides = remappedOv.next;
    else delete nextPlan.overrides;
    if (Array.isArray(nextPlan.suggestions)) {
      nextPlan.suggestions = nextPlan.suggestions
        .filter((s) => s.beat !== `b${index + 1}`)
        .map((s) => {
          const m = /^b(\d+)$/.exec(s.beat);
          if (!m) return s;
          const oldIdx = Number(m[1]) - 1;
          return { ...s, beat: `b${(oldIdx > index ? oldIdx - 1 : oldIdx) + 1}` };
        });
    }
  } else {
    nextPlan = buildPlanFromScriptBeats(nextBrief, nextBeats);
  }

  const nextAudio = remapPlanAudioOnRemove(current.planAudio, index);
  const firstFrameKey = scriptFrameKey(nextBeats[0]!, nextBrief);
  const savedFirstSvg = (current.scriptFrames ?? []).find((f) => f.key === firstFrameKey)?.svg;
  const requiresNewRender = ["Ready for review", "Revisions needed", "Approved", "Render needs attention"].includes(current.state);

  return {
    patch: {
      brief: nextBrief,
      beatPlan: nextPlan,
      script: scriptFromPlan(nextPlan, nextBrief.scriptMode === "own" ? "provided" : "generated"),
      state: requiresNewRender ? "Draft storyboard" : current.state,
      ...(nextAudio ? { planAudio: nextAudio } : {}),
      ...(savedFirstSvg ? { coverFrame: savedFirstSvg } : {}),
      ...(requiresNewRender ? { filmSeconds: undefined } : {}),
      ...(keepOverLength !== undefined ? { keepOverLength } : {})
    },
    removedBeat,
    removedPlanBeat,
    removedOverrides,
    beats: nextBeats
  };
}

type BeatEdit = { id?: unknown; keyword?: unknown; on_screen?: unknown; line?: unknown; camera?: unknown; text_effect?: unknown; transition?: unknown; sfx?: unknown; scene?: unknown; hints?: unknown };
/** "clean" is the default, so it is stored as no look at all (same as parseScriptBrief). */
const withLook = (brief: ScriptBrief, look: LookId): ScriptBrief => {
  const { look: _old, ...rest } = brief;
  return look === "clean" ? rest : { ...rest, look };
};

type PlanPatch = { beats?: BeatEdit[]; order?: unknown; suggestions?: { index?: unknown; accepted?: unknown }[]; look?: unknown; styleFamily?: unknown; styleExample?: unknown; captions?: unknown; audioMode?: unknown; aspect?: unknown; aspects?: unknown; overrides?: unknown; animationTier?: unknown };

/** Applies storyboard edits. Returns the edited plan, or the problems that block it. */
export function applyPlanEdits(project: VideoProject, patch: PlanPatch): { plan: BeatPlan } | { problems: string[] } {
  if (!project.beatPlan || !project.brief) return { problems: ["Generate the plan first."] };
  const plan: BeatPlan = structuredClone(project.beatPlan);
  if (patch.aspect !== undefined) {
    if (typeof patch.aspect !== "string" || !(aspects as readonly string[]).includes(patch.aspect)) {
      return { problems: ["Choose 16:9, 9:16 or 1:1."] };
    }
    plan.canvas = patch.aspect as Aspect;
  }
  if (patch.captions !== undefined) {
    if (typeof patch.captions !== "string" || !(captionModes as readonly string[]).includes(patch.captions)) {
      return { problems: ["Choose captions: key phrases, full or off."] };
    }
    plan.audio.captions = patch.captions as CaptionMode;
  }
  if (patch.audioMode !== undefined) {
    if (typeof patch.audioMode !== "string" || !(audioModes as readonly string[]).includes(patch.audioMode)) {
      return { problems: ["Choose voiceover, music, both or none."] };
    }
  }
  if (patch.overrides !== undefined) {
    if (patch.overrides === null) {
      delete plan.overrides;
    } else if (typeof patch.overrides === "object" && !Array.isArray(patch.overrides)) {
      const merged: Record<string, unknown> = { ...(plan.overrides ?? {}) };
      for (const [k, v] of Object.entries(patch.overrides as Record<string, unknown>)) {
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      const checked = validateHyperFramesOverrides(merged);
      if ("error" in checked) return { problems: [checked.error] };
      if (Object.keys(checked.overrides).length > 0) plan.overrides = checked.overrides;
      else delete plan.overrides;
    } else {
      return { problems: ["Overrides must be an object keyed by element id."] };
    }
  }
  // Plain text only (markdown markers would be drawn and voiced literally).
  const text = (value: unknown, max: number) => (typeof value === "string" ? plainText(value).slice(0, max) : undefined);
  for (const edit of patch.beats ?? []) {
    const beat = plan.beats.find((item) => item.id === edit.id);
    if (!beat) return { problems: [`Unknown beat "${String(edit.id)}".`] };
    const keyword = text(edit.keyword, BEAT_LIMITS.keywordChars + 20);
    const onScreen = edit.on_screen === null ? null : text(edit.on_screen, BEAT_LIMITS.onScreenChars + 20);
    const line = edit.line === null ? null : text(edit.line, BEAT_LIMITS.lineChars + 40);
    // Direction notes: how the camera moves, how the words enter, how the beat hands over, and what it sounds like.
    const camera = text(edit.camera, 200);
    if (camera) beat.motion.camera = camera;
    if (edit.text_effect === null || (typeof edit.text_effect === "string" && (textEffects as readonly string[]).includes(edit.text_effect))) beat.motion.text_effect = edit.text_effect;
    if (typeof edit.transition === "string" && edit.transition !== "end" && (transitionTypes as readonly string[]).includes(edit.transition) && beat.transition_out.type !== "end") beat.transition_out = { ...beat.transition_out, type: edit.transition as typeof beat.transition_out.type };
    if (edit.sfx === null) beat.sfx = null; else { const sfx = text(edit.sfx, 200); if (sfx !== undefined) beat.sfx = sfx || null; }
    if (edit.scene === null) beat.scene = null;
    else if (typeof edit.scene === "string" && scenesFor(project.brief.look, project.brief.styleFamily).some((scene) => scene.id === edit.scene)) beat.scene = edit.scene;
    if (edit.hints !== undefined) {
      const checkedHint = validateBeatLayoutHint(edit.hints);
      if ("error" in checkedHint) return { problems: [checkedHint.error] };
      if (checkedHint.hints) beat.hints = checkedHint.hints;
      else delete beat.hints;
    }
    if (keyword !== undefined) beat.keyword = keyword;
    if (onScreen !== undefined) beat.on_screen = onScreen || null;
    if (line !== undefined) beat.line = line || null;
    // A rewritten line may drop the verb the cursor clicks on; clear it (the action then lands at the
    // beat's default point) rather than rejecting the user's wording.
    if (line !== undefined && beat.verb && !(beat.line ?? "").toLowerCase().includes(beat.verb.toLowerCase())) beat.verb = null;
  }
  if (patch.order !== undefined) {
    const order = Array.isArray(patch.order) ? patch.order.filter((id): id is string => typeof id === "string") : [];
    if (order.length !== plan.beats.length || new Set(order).size !== order.length || order.some((id) => !plan.beats.some((beat) => beat.id === id))) {
      return { problems: ["The new order must list every beat exactly once."] };
    }
    plan.beats = order.map((id) => plan.beats.find((beat) => beat.id === id)!);
    // Re-chain the seams: each beat now enters the way the beat before it exits (seam ledger),
    // so a reorder never breaks velocity matching. Exits (each beat's own motion) are kept.
    for (let i = 1; i < plan.beats.length; i++) plan.beats[i].motion.entry = { ...plan.beats[i - 1].motion.exit };
  }
  for (const choice of patch.suggestions ?? []) {
    const index = typeof choice.index === "number" ? choice.index : -1;
    if (!plan.suggestions[index] || typeof choice.accepted !== "boolean") return { problems: ["Choose accept or reject for an existing suggestion."] };
    plan.suggestions[index].accepted = choice.accepted;
  }
  // Own-script lines are the user's words, so edits there are allowed; the generated-mode word budget still applies.
  const problems = beatPlanProblems(plan, project.brief, { editing: true });
  return problems.length ? { problems } : { plan };
}

/** Serves an audio file with byte ranges: browsers only seek <audio> on responses that accept ranges. */
function sendMedia(request: FastifyRequest, reply: FastifyReply, bytes: Buffer, type: string) {
  reply.header("Content-Type", type).header("Accept-Ranges", "bytes").header("Cache-Control", "private, max-age=31536000, immutable").header("X-Content-Type-Options", "nosniff");
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(request.headers.range ?? ""));
  if (!range || (!range[1] && !range[2])) return reply.send(bytes);
  const start = range[1] ? Number(range[1]) : Math.max(0, bytes.length - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
  if (start >= bytes.length || start > end) return reply.code(416).header("Content-Range", `bytes */${bytes.length}`).send();
  return reply.code(206).header("Content-Range", `bytes ${start}-${end}/${bytes.length}`).send(bytes.subarray(start, end + 1));
}

const audioType = (file: string) => (file.endsWith(".wav") ? "audio/wav" : "audio/mpeg");

const isVisualEnqueueDomainError = (error: unknown): error is Error =>
  error instanceof VisualWorkerBusy ||
  error instanceof ProjectInvalid ||
  (error instanceof Error &&
    (error.message === "Material generation needs GEMINI_API_KEY on the backend." ||
      error.message === "This style does not need generated scenes." ||
      /^Choose a project reservation ceiling up to \$/.test(error.message) ||
      /^A provider (submission was interrupted|operation failed permanently)/.test(error.message) ||
      /^This project needs a cumulative reservation of \$/.test(error.message)));

const VISUAL_STATUS_DOMAIN_MESSAGES = new Set([
  "Generation worker interrupted. Retry to resume saved operations.",
  "The storyboard changed during generation. Generate scenes for the updated storyboard.",
  "Generation budget reached."
]);

export async function registerPlanRoutes(app: FastifyInstance) {
  registerRequestId(app);
  await registerSiteRoutes(app);
  app.get<{ Params: { id: string } }>("/v1/projects/:id/visuals", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send(notFound);
    const status = visualStatus(project);
    try { await verifyVisualAssets(project); }
    catch (error) {
      const requestId = requestIdOf(request);
      request.log.error({ err: error, requestId }, "Material asset unavailable.");
      return { ...status, status: "failed", error: "Material asset unavailable.", requestId };
    }
    if (status.status === "failed" && status.error && !VISUAL_STATUS_DOMAIN_MESSAGES.has(status.error)) {
      const requestId = requestIdOf(request);
      request.log.error({ err: new Error(status.error), requestId }, "Material generation failed.");
      return { ...status, error: "Material generation failed.", requestId };
    }
    return status;
  });
  app.post<{ Params: { id: string }; Body: { budgetUsd?: number } }>("/v1/projects/:id/visuals", async (request, reply) => {
    try {
      const current = await getProject(request.params.id);
      if (!current) return reply.code(404).send(notFound);
      const userId = callerId(request);
      let billing: import("./visuals.ts").MaterialBilling | undefined;
      if (materialBillingOn()) {
        const userTier = await tierFor(userId);
        if (!isPaidTier(userTier)) {
          return reply.code(402).send({
            error: {
              code: "material_requires_plan",
              message: "Generated scenes are included with paid plans. Choose a plan to generate scenes.",
              tier: userTier
            }
          });
        }
        const isV2 = effectiveBillingPolicyVersion(current) === "v2_step_tier";
        billing = {
          charge: async (usd, runId) => {
            const milli = isV2 ? materialCostMillitokensV2(usd) : materialCostMillitokens(usd);
            const spend = await spendTokens(userId, milli, "material", `${current.id}:${runId}`, current.id);
            return async () => {
              if (spend.charged) await refundSpend(userId, spend.event);
            };
          }
        };
      }
      const project = await enqueueVisuals(request.params.id, Number(request.body?.budgetUsd), undefined, billing);
      return project ? reply.code(202).send(visualStatus(project)) : reply.code(404).send(notFound);
    } catch (error) {
      if (error instanceof InsufficientTokens) {
        return reply.code(402).send({
          error: {
            code: "insufficient_tokens",
            message: `Generating these scenes needs ${error.needed} tokens and you have ${error.remaining}. Add tokens or choose a plan.`,
            needed: error.needed,
            remaining: error.remaining
          }
        });
      }
      if (isVisualEnqueueDomainError(error)) return reply.code(409).send({ error: { code: "visual_generation", message: error.message } });
      return reply.code(409).send(upstreamError(request, error, "visual_generation", "Generation unavailable."));
    }
  });
  app.get<{ Params: { id: string; file: string } }>("/v1/preview/plans/:id/visuals/:file", async (request, reply) => {
    const { id, file } = request.params;
    if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f]{64}\.(png|mp4)$/.test(file)) return reply.code(404).send(notFound);
    const project = await getProject(id);
    const assets = [project?.planVisuals?.styleKey, ...Object.values(project?.planVisuals?.shots ?? {}).flatMap(s => [s.clip, s.keyframe, s.assemblySheet, s.startFrame])];
    const asset = assets.find(a => a?.file === file);
    if (!asset) return reply.code(404).send(notFound);
    const bytes = await readMedia(join(visualDir(id), file));
    return bytes && digest(bytes) === asset.sha256 ? sendMedia(request, reply, bytes, file.endsWith(".mp4") ? "video/mp4" : "image/png") : reply.code(404).send(notFound);
  });
  const STALE_MS = 4 * 60_000;
  const stale = (planning: { startedAt: string } | undefined) => !planning || Date.now() - Date.parse(planning.startedAt) > STALE_MS;

  /**
   * Script & Style → the director → beat plan, script and suggestions. The director runs as a job on the server: this answers 202
   * at once with the project (`planning.status === "running"`), the page polls the project, and the plan is applied when the model
   * finishes, whether or not the page is still open. A second request while one is running joins it instead of starting another.
   */
  /**
   * The script canvas: writes only the script and streams it as it is written (server-sent events), so the first words show
   * in a few seconds instead of after the whole storyboard. `{ t }` events carry text; the last event is `{ done, beats, flags }`
   * or `{ error }`. With `instruction` and `previous` it changes an existing script. Nothing is saved: the page keeps the
   * script and sends it with the brief (`scriptBeats`) when it asks for the storyboard.
   */
  app.post<{ Params: { id: string }; Body: { brief?: unknown; instruction?: unknown; previous?: unknown; notes?: unknown; only?: unknown; quoteId?: string } }>("/v1/projects/:id/script/stream", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send(notFound);
    const parsed = parseScriptBrief(request.body?.brief);
    if ("error" in parsed) return reply.code(400).send({ error: { code: "invalid_brief", message: parsed.error } });
    const instruction = typeof request.body?.instruction === "string" ? request.body.instruction.trim().slice(0, 400) : "";
    const previous = parseScriptBeats(request.body?.previous) ?? undefined;
    if (instruction && !previous) return reply.code(400).send({ error: { code: "invalid_script", message: "Send the current script with the change." } });
    if (!(await ensurePromptAllowed(reply, [parsed.brief.text, parsed.brief.productName, instruction], `project_${project.id}:script_stream`))) return;
    const only = previous && Array.isArray(request.body?.only)
      ? [...new Set(request.body.only.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < previous.length))].sort((a, b) => a - b)
      : [];
    const notes = parseScriptNotes(request.body?.notes);
    const { context } = await directorContextFor(project, parsed.brief);

    const userId = callerId(request);
    let reservationId: string | null = null;
    if (stepBillingOnForProject(project)) {
      try {
        const quote = await quoteScriptStep({
          userId,
          project,
          brief: parsed.brief,
          ...(only.length ? { onlyIndices: only } : {}),
          persist: false
        });
        const reservation = await reserveStepTokens({
          userId,
          projectId: project.id,
          quote,
          quoteIdFromClient: request.body?.quoteId,
          ledgerReason: only.length ? "script_edit" : "script"
        });
        if (reservation.reservedMilli > 0) reservationId = reservation.id;
      } catch (error) {
        if (error instanceof QuoteStaleError) {
          return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message }, quote: error.freshQuote });
        }
        if (error instanceof InsufficientTokens) {
          return reply.code(402).send({
            error: {
              code: "insufficient_tokens",
              message: `Writing this script needs ${error.needed} tokens and you have ${error.remaining}. Add tokens or choose a plan.`,
              needed: error.needed,
              remaining: error.remaining
            }
          });
        }
        throw error;
      }
    }

    const controller = new AbortController();
    request.raw.on("close", () => controller.abort());
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
    const send = (event: unknown) => { if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`); };
    const started = Date.now();
    let firstMs: number | null = null;
    let text = "";
    let settled = false;
    try {
      for await (const chunk of writeScript({ brief: parsed.brief, context, ...(instruction && previous ? { instruction, previous, notes, ...(only.length ? { only } : {}) } : {}) }, controller.signal)) {
        if (firstMs === null) firstMs = Date.now() - started;
        text += chunk;
        send({ t: chunk });
      }
      const { beats, notes: plan, flags } = finishScript(text, parsed.brief, context, only.length && previous ? { previous, only, notes } : undefined);
      if (beats.length === 0) throw new Error("The script came back empty. Try again.");
      if (reservationId) {
        await settleStepReservation(reservationId).catch(() => undefined);
        settled = true;
      }
      send({ done: true, beats, notes: plan ?? (instruction ? notes : null), flags, ms: Date.now() - started });
      app.log.info({ event: "script_streamed", projectId: project.id, firstMs, ms: Date.now() - started, beats: beats.length, flags: flags.length, change: Boolean(instruction), only: only.length || undefined }, "script streamed");
    } catch (error) {
      if (reservationId && !settled) {
        await releaseStepReservation(reservationId).catch(() => undefined);
      }
      if (!controller.signal.aborted) {
        send(upstreamSseError(request, error, "Could not write the script."));
      }
    } finally {
      if (reservationId && !settled) {
        await releaseStepReservation(reservationId).catch(() => undefined);
      }
      reply.raw.end();
    }
  });

  /**
   * Dedicated single-scene insertion at a boundary (`0..previous.length`, e.g. `2` = between Scene 2 and Scene 3).
   * Generates ONE scene from neighboring story/cast/style context, leaves every other scene byte-for-byte untouched,
   * reconciles `brief.scriptBeats`, `beatPlan`, `planAudio` and transition seams atomically, and deduplicates by `idempotencyKey`.
   */
  app.post<{
    Params: { id: string };
    Body: {
      brief?: unknown;
      previous?: unknown;
      position?: unknown;
      prompt?: unknown;
      notes?: unknown;
      idempotencyKey?: unknown;
    };
  }>("/v1/projects/:id/script/scenes/insert", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send(notFound);
    if (project.state === "Rendering draft") {
      return reply.code(409).send({
        error: { code: "invalid_project", message: "Wait for the current render to finish before changing the storyboard." }
      });
    }

    const parsedBrief = request.body?.brief ? parseScriptBrief(request.body.brief) : project.brief ? { brief: project.brief } : { error: "Send the project brief." };
    if ("error" in parsedBrief) {
      return reply.code(400).send({ error: { code: "invalid_brief", message: parsedBrief.error } });
    }
    const brief = parsedBrief.brief;

    const rawPrevious = request.body?.previous ?? project.brief?.scriptBeats;
    if (Array.isArray(rawPrevious) && rawPrevious.length >= SCRIPT_BEATS_MAX) {
      return reply.code(422).send({
        error: { code: "max_scenes", message: `A storyboard can have at most ${SCRIPT_BEATS_MAX} scenes.` }
      });
    }
    const previous = ensureScriptBeatIds(parseScriptBeats(rawPrevious) ?? []);
    if (previous.length === 0) {
      return reply.code(400).send({ error: { code: "invalid_script", message: "Send the current storyboard scenes." } });
    }
    if (previous.length >= SCRIPT_BEATS_MAX) {
      return reply.code(422).send({
        error: { code: "max_scenes", message: `A storyboard can have at most ${SCRIPT_BEATS_MAX} scenes.` }
      });
    }

    const position = request.body?.position;
    if (typeof position !== "number" || !Number.isInteger(position) || position < 0 || position > previous.length) {
      return reply.code(400).send({
        error: { code: "invalid_position", message: `Choose a valid scene boundary between 0 and ${previous.length}.` }
      });
    }

    if (typeof request.body?.prompt !== "string") {
      return reply.code(400).send({
        error: { code: "invalid_prompt", message: "Describe the new scene in at least a few words." }
      });
    }
    const trimmedPrompt = plainText(request.body.prompt).replace(/\s+/g, " ").trim();
    if (trimmedPrompt.length < 3) {
      return reply.code(400).send({
        error: { code: "invalid_prompt", message: "Describe the new scene in at least 3 characters." }
      });
    }
    if (trimmedPrompt.length > 400) {
      return reply.code(400).send({
        error: { code: "invalid_prompt", message: "Keep the scene description under 400 characters." }
      });
    }

    const headerIdem = request.headers["idempotency-key"] ?? request.headers["x-idempotency-key"];
    const rawIdem = typeof headerIdem === "string" ? headerIdem : typeof request.body?.idempotencyKey === "string" ? request.body.idempotencyKey : "";
    const idemKey = rawIdem.trim().slice(0, 128);
    const idemScopeKey = idemKey ? `${project.id}:${idemKey}` : "";

    if (idemScopeKey && sceneInsertIdempotency.has(idemScopeKey)) {
      try {
        return await sceneInsertIdempotency.get(idemScopeKey)!;
      } catch (error) {
        return reply.code(502).send(upstreamError(request, error, "scene_insert_failed", "Could not write the new scene. Try again."));
      }
    }

    if (!(await ensurePromptAllowed(reply, [brief.text, brief.productName, trimmedPrompt], `project_${project.id}:scene_insert`))) {
      return;
    }

    const userId = callerId(request);
    let insertReservationId: string | null = null;
    if (stepBillingOnForProject(project)) {
      if (!idemScopeKey || !meteredSceneInsertKeys.has(idemScopeKey)) {
        try {
          const quote = await quoteScriptStep({ userId, project, brief, isSingleSceneInsert: true, persist: false });
          const reservation = await reserveStepTokens({
            userId,
            projectId: project.id,
            quote,
            ledgerReason: "scene_insert"
          });
          if (reservation.reservedMilli > 0) insertReservationId = reservation.id;
          if (idemScopeKey) meteredSceneInsertKeys.add(idemScopeKey);
        } catch (error) {
          if (error instanceof InsufficientTokens) {
            return reply.code(402).send({
              error: {
                code: "insufficient_tokens",
                message: `Adding a scene needs ${error.needed} tokens and you have ${error.remaining}. Add tokens or choose a plan.`,
                needed: error.needed,
                remaining: error.remaining
              }
            });
          }
          throw error;
        }
      }
    } else if (meteringOn() && (!idemScopeKey || !meteredSceneInsertKeys.has(idemScopeKey))) {
      const refusal = await admitPreview(userId, project.id, await tierFor(userId));
      if (refusal) return reply.code(402).send(refusal);
      if (idemScopeKey) meteredSceneInsertKeys.add(idemScopeKey);
    }

    const notes = parseScriptNotes(request.body?.notes) ?? brief.scriptNotes ?? project.brief?.scriptNotes ?? null;
    const controller = new AbortController();
    request.raw.on("close", () => {
      if (!reply.sent && request.raw.aborted) controller.abort();
    });

    const runInsert = async (): Promise<SceneInsertApiResult> => {
      const { context } = await directorContextFor(project, brief);
      const writer = sceneInsertWriterOverride ?? writeInsertedScene;
      const text = await writer(
        {
          brief,
          context,
          previous,
          position,
          prompt: trimmedPrompt,
          notes
        },
        controller.signal
      );
      const beatId = `sb-${randomUUID().slice(0, 8)}`;
      const finished = finishInsertedScene(text, brief, context, {
        previous,
        position,
        notes,
        beatId
      });
      const updated = await updateProjectPlan(project.id, (current) => {
        const latestBeats = current.brief?.scriptBeats?.length === previous.length
          ? ensureScriptBeatIds(
              current.brief.scriptBeats.map((b, i) => ({
                ...b,
                ...(previous[i]?.id ? { id: previous[i]!.id } : {})
              }))
            )
          : previous;
        return reconcileProjectAfterSceneInsert(current, {
          brief,
          previousBeats: latestBeats,
          position,
          insertedBeat: finished.insertedBeat,
          notes: finished.notes
        });
      });
      if (!updated) throw new ProjectInvalid("Project not found.");
      const persistedBeats = updated.brief?.scriptBeats ?? finished.beats;
      return {
        project: updated,
        insertedBeat: persistedBeats[position] ?? finished.insertedBeat,
        position,
        beats: persistedBeats,
        notes: finished.notes,
        flags: finished.flags
      };
    };

    const task = runInsert();
    if (idemScopeKey) {
      sceneInsertIdempotency.set(idemScopeKey, task);
    }
    try {
      const result = await task;
      if (insertReservationId) await settleStepReservation(insertReservationId).catch(() => undefined);
      return reply.send(result);
    } catch (error) {
      if (insertReservationId) await releaseStepReservation(insertReservationId).catch(() => undefined);
      if (idemScopeKey) sceneInsertIdempotency.delete(idemScopeKey);
      if (error instanceof ProjectInvalid) {
        return reply.code(400).send({ error: { code: "invalid_project", message: error.message } });
      }
      return reply.code(502).send(
        upstreamError(request, error, "scene_insert_failed", error instanceof Error ? error.message : "Could not write the new scene. Try again.")
      );
    }
  });

  /**
   * Dedicated scene removal at `index` (`0..beats.length - 1`), enforcing minimum 1 scene and keeping existing assets/takes
   * intact on disk and in `planAudio`/`scriptFrames` so Undo can restore the scene with zero regeneration cost.
   */
  app.post<{
    Params: { id: string };
    Body: {
      index?: unknown;
      brief?: unknown;
      beats?: unknown;
    };
  }>("/v1/projects/:id/script/scenes/remove", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send(notFound);
    if (project.state === "Rendering draft") {
      return reply.code(409).send({
        error: { code: "invalid_project", message: "Wait for the current render to finish before changing the storyboard." }
      });
    }
    const index = request.body?.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
      return reply.code(400).send({ error: { code: "invalid_index", message: "Choose a valid scene to remove." } });
    }
    const parsedBrief = request.body?.brief ? parseScriptBrief(request.body.brief) : null;
    if (parsedBrief && "error" in parsedBrief) {
      return reply.code(400).send({ error: { code: "invalid_brief", message: parsedBrief.error } });
    }
    const parsedBeats = request.body?.beats !== undefined ? parseScriptBeats(request.body.beats) : null;
    if (request.body?.beats !== undefined && !parsedBeats) {
      return reply.code(400).send({ error: { code: "invalid_script", message: "Send the current storyboard scenes." } });
    }

    let removedInfo: ReturnType<typeof reconcileProjectAfterSceneRemove> | null = null;
    try {
      const updated = await updateProjectPlan(project.id, (current) => {
        const currentCount = (parsedBeats ?? current.brief?.scriptBeats ?? current.beatPlan?.beats ?? []).length;
        if (currentCount <= SCRIPT_BEATS_MIN) {
          throw new Error("MIN_SCENES");
        }
        if (index >= currentCount) {
          throw new Error("OUT_OF_RANGE");
        }
        removedInfo = reconcileProjectAfterSceneRemove(current, {
          index,
          brief: parsedBrief && !("error" in parsedBrief) ? parsedBrief.brief : current.brief,
          beats: parsedBeats
        });
        return removedInfo.patch;
      });
      if (!updated || !removedInfo) return reply.code(404).send(notFound);
      const info = removedInfo as ReturnType<typeof reconcileProjectAfterSceneRemove>;
      return reply.send({
        project: updated,
        index,
        removedBeat: info.removedBeat,
        removedPlanBeat: info.removedPlanBeat,
        removedOverrides: info.removedOverrides,
        beats: updated.brief?.scriptBeats ?? info.beats
      });
    } catch (error) {
      if (error instanceof Error && error.message === "MIN_SCENES") {
        return reply.code(422).send({ error: { code: "min_scenes", message: "A storyboard needs at least one scene." } });
      }
      if (error instanceof Error && error.message === "OUT_OF_RANGE") {
        return reply.code(400).send({ error: { code: "invalid_index", message: "Choose an existing scene to remove." } });
      }
      if (error instanceof ProjectInvalid) {
        return reply.code(400).send({ error: { code: "invalid_project", message: error.message } });
      }
      throw error;
    }
  });

  /**
   * Restores a previously removed scene at `index` (`0..beats.length`), re-attaching its saved `Beat`, overrides,
   * cached reference frame, and voiceover take.
   */
  app.post<{
    Params: { id: string };
    Body: {
      index?: unknown;
      beat?: unknown;
      planBeat?: unknown;
      overrides?: unknown;
      brief?: unknown;
      beats?: unknown;
    };
  }>("/v1/projects/:id/script/scenes/restore", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send(notFound);
    if (project.state === "Rendering draft") {
      return reply.code(409).send({
        error: { code: "invalid_project", message: "Wait for the current render to finish before changing the storyboard." }
      });
    }
    const index = request.body?.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
      return reply.code(400).send({ error: { code: "invalid_index", message: "Choose a valid position to restore the scene." } });
    }
    const restoredList = parseScriptBeats([request.body?.beat]);
    const restoredBeat = restoredList?.[0];
    if (!restoredBeat) {
      return reply.code(400).send({ error: { code: "invalid_beat", message: "Send the scene to restore." } });
    }
    const parsedBrief = request.body?.brief ? parseScriptBrief(request.body.brief) : null;
    if (parsedBrief && "error" in parsedBrief) {
      return reply.code(400).send({ error: { code: "invalid_brief", message: parsedBrief.error } });
    }
    const parsedBeats = request.body?.beats !== undefined ? parseScriptBeats(request.body.beats) : null;
    if (request.body?.beats !== undefined && !parsedBeats) {
      return reply.code(400).send({ error: { code: "invalid_script", message: "Send the current storyboard scenes." } });
    }

    try {
      const updated = await updateProjectPlan(project.id, (current) => {
        const baseBrief = (parsedBrief && !("error" in parsedBrief) ? parsedBrief.brief : null) ?? current.brief;
        if (!baseBrief) throw new ProjectInvalid("Generate the storyboard first.");
        const previousBeats = ensureScriptBeatIds(
          parsedBeats ??
            current.brief?.scriptBeats ??
            (current.beatPlan?.beats ?? []).map((b) => ({
              keyword: b.keyword,
              visual: null,
              onScreen: b.on_screen ?? null,
              line: b.line ?? null
            }))
        );
        if (previousBeats.length >= SCRIPT_BEATS_MAX) {
          throw new Error("MAX_SCENES");
        }
        if (index > previousBeats.length) {
          throw new Error("OUT_OF_RANGE");
        }
        const planBeatOverride =
          request.body?.planBeat && typeof request.body.planBeat === "object"
            ? (request.body.planBeat as Beat)
            : null;
        const restoredOverrides =
          request.body?.overrides && typeof request.body.overrides === "object" && !Array.isArray(request.body.overrides)
            ? (request.body.overrides as Record<string, unknown>)
            : null;
        return reconcileProjectAfterSceneInsert(current, {
          brief: baseBrief,
          previousBeats,
          position: index,
          insertedBeat: restoredBeat,
          planBeatOverride,
          restoredOverrides
        });
      });
      if (!updated) return reply.code(404).send(notFound);
      return reply.send({
        project: updated,
        index,
        restoredBeat,
        beats: updated.brief?.scriptBeats ?? []
      });
    } catch (error) {
      if (error instanceof Error && error.message === "MAX_SCENES") {
        return reply.code(422).send({
          error: { code: "max_scenes", message: `A storyboard can have at most ${SCRIPT_BEATS_MAX} scenes.` }
        });
      }
      if (error instanceof Error && error.message === "OUT_OF_RANGE") {
        return reply.code(400).send({ error: { code: "invalid_index", message: "Choose a valid position to restore the scene." } });
      }
      if (error instanceof ProjectInvalid) {
        return reply.code(400).send({ error: { code: "invalid_project", message: error.message } });
      }
      throw error;
    }
  });

  /**
   * Reference frames for the script canvas: one still SVG per beat in the chosen template's style, streamed as server-sent
   * events (`{ index, svg }` or `{ index, error }` as each is drawn, then `{ done }`). `indices` limits it to the beats that
   * changed. Each frame is saved on the project (`scriptFrames`) under its key, and a beat whose key is already saved is
   * sent back at once instead of being drawn again.
   */
  app.post<{ Params: { id: string }; Body: { brief?: unknown; beats?: unknown; indices?: unknown; notes?: unknown; quoteId?: string } }>("/v1/projects/:id/script/frames", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send(notFound);
    const parsed = parseScriptBrief(request.body?.brief);
    if ("error" in parsed) return reply.code(400).send({ error: { code: "invalid_brief", message: parsed.error } });
    const beats = parseScriptBeats(request.body?.beats);
    if (!beats) return reply.code(400).send({ error: { code: "invalid_script", message: "Send the script to draw." } });
    if (!(await ensurePromptAllowed(reply, [parsed.brief.text, ...beats.map((b) => [b.keyword, b.onScreen, b.line, b.visual].filter(Boolean).join(" "))], `project_${project.id}:script_frames`))) return;
    const wanted = Array.isArray(request.body?.indices)
      ? [...new Set(request.body.indices.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < beats.length))]
      : beats.map((_, i) => i);
    const brief = parsed.brief;
    const template = brief.styleExample ? findGalleryTemplate(brief.styleExample) : undefined;
    const code = template?.reference ? await readGalleryText(template.reference) : null;
    const style = template && code ? { name: template.name, code } : null;
    const notes = parseScriptNotes(request.body?.notes) ?? brief.scriptNotes ?? null;

    const userId = callerId(request);
    let framesReservationId: string | null = null;
    if (stepBillingOnForProject(project)) {
      try {
        const quote = await quoteFrameSketchStep({
          userId,
          project,
          brief,
          beats,
          wantedIndices: wanted,
          persist: false
        });
        const reservation = await reserveStepTokens({
          userId,
          projectId: project.id,
          quote,
          quoteIdFromClient: request.body?.quoteId,
          ledgerReason: "frames"
        });
        if (reservation.reservedMilli > 0) framesReservationId = reservation.id;
      } catch (error) {
        if (error instanceof QuoteStaleError) {
          return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message }, quote: error.freshQuote });
        }
        if (error instanceof InsufficientTokens) {
          return reply.code(402).send({
            error: {
              code: "insufficient_tokens",
              message: `Drawing these storyboard frames needs ${error.needed} tokens and you have ${error.remaining}. Add tokens or choose a plan.`,
              needed: error.needed,
              remaining: error.remaining
            }
          });
        }
        throw error;
      }
    }

    const controller = new AbortController();
    request.raw.on("close", () => controller.abort());
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
    const send = (event: unknown) => { if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`); };
    const started = Date.now();
    let failed = 0;
    let delivered = 0;
    // Four at a time: each frame takes a few seconds, and the first ones should land while the person is still reading.
    const keyFor = (index: number) => scriptFrameKey(beats[index]!, brief);
    const saved = new Map((project.scriptFrames ?? []).map((frame) => [frame.key, frame.svg]));
    for (const index of wanted) { const svg = saved.get(keyFor(index)); if (svg) send({ index, svg }); }
    // Frame 1 is the project card's thumbnail, so the card always shows how the film opens.
    if (wanted.includes(0) && saved.get(keyFor(0))) await setCoverFrame(project.id, saved.get(keyFor(0))!).catch(() => undefined);
    const queue = wanted.filter((index) => !saved.has(keyFor(index)));
    const drawnCount = queue.length;
    const draw = async () => {
      for (let index = queue.shift(); index !== undefined && !controller.signal.aborted; index = queue.shift()) {
        try {
          const svg = await sketchFrame({ beat: beats[index]!, index, count: beats.length, aspect: brief.aspect, topic: brief.text, style, look: brief.look ?? "clean", notes }, controller.signal);
          send({ index, svg });
          await saveScriptFrame(project.id, { key: keyFor(index), svg }).catch((error) => app.log.warn({ err: error, projectId: project.id }, "frame not saved"));
          if (index === 0) await setCoverFrame(project.id, svg).catch(() => undefined);
          delivered += 1;
        } catch (error) {
          if (controller.signal.aborted) return;
          failed += 1;
          send(upstreamSseError(request, error, "Could not draw this frame.", { index }));
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(4, queue.length) }, draw));
    } finally {
      if (framesReservationId) {
        await settlePartialStepReservation(framesReservationId, delivered, "frames-stream").catch(() => undefined);
      }
    }
    send({ done: true, ms: Date.now() - started });
    app.log.info({ event: "frames_sketched", projectId: project.id, frames: wanted.length, drawn: drawnCount, failed, styled: Boolean(style), ms: Date.now() - started }, "frames sketched");
    reply.raw.end();
  });

  /**
   * Streams scene-by-scene voiceover takes (and optional music bed) in parallel as Server-Sent Events
   * (`{ type: "take", index, file, seconds, progress }`, `{ type: "take-error", index, error, progress }`,
   * `{ type: "music", file, seconds, progress }`, `{ type: "done", progress: 100, failed, project }`).
   * Does not wait for `beatPlan`: works directly from the Storyboard's `beats` and `brief`, and saves each
   * take onto `project.planAudio` as soon as it finishes so the browser can play each scene immediately.
   */
  app.post<{ Params: { id: string }; Body: { brief?: unknown; beats?: unknown; indices?: unknown; force?: unknown; includeMusic?: unknown; quoteId?: string } }>("/v1/projects/:id/script/voice", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send(notFound);
    if (!config.geminiApiKey) return reply.code(503).send({ error: { code: "audio_unavailable", message: "Voiceover and music need GEMINI_API_KEY." } });

    const parsedBrief = request.body?.brief ? parseScriptBrief(request.body.brief) : null;
    const brief = parsedBrief && !("error" in parsedBrief) ? parsedBrief.brief : project.brief;
    if (!brief) return reply.code(400).send({ error: { code: "invalid_brief", message: "Send the project brief." } });

    const parsedBeats = parseScriptBeats(request.body?.beats) ?? project.brief?.scriptBeats;
    const beats = parsedBeats ?? (project.beatPlan?.beats ?? []).map((b) => ({ keyword: b.keyword, onScreen: b.on_screen ?? null, line: b.line ?? null, visual: null }));
    if (!beats.length) return reply.code(400).send({ error: { code: "invalid_script", message: "Send the script scenes to voice." } });

    const force = request.body?.force === true;
    const hasScopedIndices = Array.isArray(request.body?.indices);
    const candidateIndices = hasScopedIndices
      ? [...new Set((request.body!.indices as unknown[]).filter((i): i is number => Number.isInteger(i) && Number(i) >= 0 && Number(i) < beats.length))]
      : beats.map((_, i) => i);
    const wanted = candidateIndices.filter((i) => Boolean(voiceText(beats[i]?.line)));
    const wantMusic =
      request.body?.includeMusic !== false &&
      !hasScopedIndices &&
      (brief.audio.mode === "music" || brief.audio.mode === "both") &&
      (force || !project.planAudio?.music);

    const userId = callerId(request);
    let voiceReservationId: string | null = null;
    if (stepBillingOnForProject(project)) {
      try {
        const quote = await quoteVoiceMusicStep({
          userId,
          project,
          brief,
          beats,
          ...(hasScopedIndices ? { wantedIndices: candidateIndices } : {}),
          force,
          includeMusic: request.body?.includeMusic !== false,
          persist: false
        });
        const reservation = await reserveStepTokens({
          userId,
          projectId: project.id,
          quote,
          quoteIdFromClient: request.body?.quoteId,
          ledgerReason: "voice"
        });
        if (reservation.reservedMilli > 0) voiceReservationId = reservation.id;
      } catch (error) {
        if (error instanceof QuoteStaleError) {
          return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message }, quote: error.freshQuote });
        }
        if (error instanceof InsufficientTokens) {
          return reply.code(402).send({
            error: {
              code: "insufficient_tokens",
              message: `Recording voiceover and music needs ${error.needed} tokens and you have ${error.remaining}. Add tokens or choose a plan.`,
              needed: error.needed,
              remaining: error.remaining
            }
          });
        }
        throw error;
      }
    }

    const controller = new AbortController();
    request.raw.on("close", () => controller.abort());
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });
    const send = (event: unknown) => {
      if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const settings = voiceSettings({ ...project, brief });
    const dir = planAudioDir(project.id);
    const totalSteps = Math.max(1, wanted.length + (wantMusic ? 1 : 0));
    let completedSteps = 0;
    let failed = 0;
    let voiceDelivered = 0;
    let musicDelivered = false;
    const progressPct = () => Math.min(99, Math.round((completedSteps / totalSteps) * 100));

    send({ type: "start", total: totalSteps, progress: 2 });

    // Emit any already-cached takes on the project immediately when not forcing a re-record
    const existingVoiceMatches = !force && project.planAudio?.voice?.voice === settings.voice;
    const existingByText = new Map(
      existingVoiceMatches ? (project.planAudio?.voice?.lines ?? []).map((l) => [l.text, l]) : []
    );
    // Character voices: each line's speaker (from the script; plan-only beats fall back to the saved script).
    const speakerAt = (index: number) => (beats[index] as { speaker?: string | null } | undefined)?.speaker ?? brief.scriptBeats?.[index]?.speaker ?? project.brief?.scriptBeats?.[index]?.speaker;
    const lineSettings = (index: number) => speakerSettings(settings, speakerAt(index));
    const reusable = (index: number, cleaned: string) => {
      const cached = existingByText.get(cleaned);
      // With characters a take is reused only when it was made in this speaker's current voice and delivery.
      return cached && (settings.cast !== "characters" || cached.file === `vo/${takeKey(lineSettings(index), cleaned)}.wav`) ? cached : undefined;
    };
    const queue: number[] = [];
    for (const index of wanted) {
      const cleaned = voiceText(beats[index]?.line);
      const cached = reusable(index, cleaned);
      if (cached) {
        completedSteps += 1;
        send({ type: "take", index, file: cached.file, seconds: cached.seconds, progress: progressPct() });
      } else {
        queue.push(index);
      }
    }

    const voiceWorker = async () => {
      for (let index = queue.shift(); index !== undefined && !controller.signal.aborted; index = queue.shift()) {
        const beatId = project.beatPlan?.beats[index]?.id ?? `b${index + 1}`;
        const rawLine = beats[index]?.line ?? "";
        try {
          const res = await voiceOneLine(config.geminiApiKey, dir, lineSettings(index), beatId, rawLine, force);
          if (controller.signal.aborted) return;
          const spentUsd = Math.round(res.spentSeconds * VOICE_RULES.usdPerSecond * 10000) / 10000;
          await updateProjectAudio(project.id, (current) => {
            const before = current.planAudio;
            const prevLines = before?.voice?.voice === settings.voice ? (before.voice.lines ?? []) : [];
            const filtered = prevLines.filter((l) => l.beat !== beatId && l.text !== res.line.text);
            const nextLines = [...filtered, res.line];
            return {
              voice: {
                engine: "gemini-tts",
                model: TTS_MODEL,
                voice: settings.voice,
                direction: settings.direction,
                pace: settings.pace,
                lines: nextLines
              },
              music: before?.music ?? null,
              cost_usd: Math.round(((before?.cost_usd ?? 0) + spentUsd) * 10000) / 10000,
              updatedAt: new Date().toISOString()
            } satisfies PlanAudio;
          });
          completedSteps += 1;
          voiceDelivered += 1;
          send({ type: "take", index, file: res.line.file, seconds: res.line.seconds, progress: progressPct() });
        } catch (error) {
          if (controller.signal.aborted) return;
          failed += 1;
          completedSteps += 1;
          send(
            upstreamSseError(request, error, "Could not record voiceover for this scene.", {
              type: "take-error",
              index,
              progress: progressPct()
            })
          );
        }
      }
    };

    const musicJob = wantMusic
      ? (async () => {
          try {
            const targetSeconds = effectiveBriefDurationSeconds(brief, beats);
            const prompt = musicPrompt(project.beatPlan, brief, targetSeconds);
            const track = await produceMusic(config.geminiApiKey, dir, prompt, targetSeconds);
            if (controller.signal.aborted) return;
            await updateProjectAudio(project.id, (current) => {
              const before = current.planAudio;
              return {
                voice: before?.voice ?? null,
                music: {
                  source: "lyria",
                  model: track.model,
                  prompt: track.prompt,
                  file: track.file,
                  seconds: Math.round(track.seconds * 1000) / 1000
                },
                cost_usd: Math.round(((before?.cost_usd ?? 0) + (track.spentUsd ?? 0)) * 10000) / 10000,
                updatedAt: new Date().toISOString()
              } satisfies PlanAudio;
            });
            completedSteps += 1;
            musicDelivered = true;
            send({ type: "music", file: track.file, seconds: track.seconds, progress: progressPct() });
          } catch (error) {
            if (controller.signal.aborted) return;
            completedSteps += 1;
            send(
              upstreamSseError(request, error, "Could not generate background music.", {
                type: "music-error",
                progress: progressPct()
              })
            );
          }
        })()
      : Promise.resolve();

    try {
      await Promise.all([
        Promise.all(Array.from({ length: Math.min(VOICE_RULES.concurrency, queue.length) }, voiceWorker)),
        musicJob
      ]);
    } finally {
      if (voiceReservationId) {
        await settleVoiceMusicReservation(voiceReservationId, voiceDelivered, musicDelivered, "voice-stream").catch(() => undefined);
      }
    }

    const latest = await getProject(project.id);
    send({ type: "done", progress: 100, failed, project: latest });
    reply.raw.end();
  });

  /**
   * Step 2 (Storyboard) -> Step 3 (Animation): Prepares ONLY the in-browser animation (no MP4 worker encoding!).
   * Streams SSE progress (`0% -> 100%`) as missing frames, voiceover/music, and per-scene SVG animations (`ensureFilmMotion`)
   * finish in parallel.
   */
  app.post<{ Params: { id: string }; Body: { brief?: unknown; beats?: unknown; animationTier?: unknown; quoteId?: string } }>("/v1/projects/:id/script/animate", async (request, reply) => {
    let project = await getProject(request.params.id);
    if (!project) return reply.code(404).send(notFound);

    if (request.body?.animationTier !== undefined && !isAnimationTier(request.body.animationTier)) {
      return reply.code(400).send({ error: { code: "invalid_tier", message: 'Animation tier must be "standard" or "premium".' } });
    }

    const parsedBrief = request.body?.brief ? parseScriptBrief(request.body.brief) : null;
    const rawBrief = parsedBrief && !("error" in parsedBrief) ? parsedBrief.brief : project.brief;
    if (!rawBrief) return reply.code(400).send({ error: { code: "invalid_brief", message: "Send the project brief." } });

    const beats = parseScriptBeats(request.body?.beats) ?? rawBrief.scriptBeats ?? project.brief?.scriptBeats;
    if (!beats || !beats.length) return reply.code(400).send({ error: { code: "invalid_script", message: "Send the storyboard scenes." } });

    const userId = callerId(request);
    const requestedTier = resolveProjectAnimationTier(project, rawBrief, request.body?.animationTier);
    let routeSnapshot;
    try {
      ({ routeSnapshot } = await assertAnimationTierEntitled(userId, requestedTier));
    } catch (error) {
      if (error instanceof PremiumRequiresSubscriptionError) {
        return reply.code(402).send({ error: { code: error.code, message: error.message, tier: error.tier } });
      }
      throw error;
    }

    const brief: ScriptBrief = { ...rawBrief, scriptBeats: beats, animationTier: requestedTier };

    let framesReservationId: string | null = null;
    let audioReservationId: string | null = null;
    let animCodeReservationId: string | null = null;
    if (stepBillingOnForProject(project)) {
      try {
        const animQuote = await quoteAnimationStep({
          userId,
          project,
          brief,
          beats,
          tier: requestedTier,
          persist: false
        });
        await verifyStepQuote(request.body?.quoteId, userId, animQuote);
        if (animQuote.milli > 0) {
          const bal = await tokenSummary(userId);
          if (Math.round(bal.remaining * 1000) < animQuote.milli) {
            throw new InsufficientTokens(animQuote.tokens, bal.remaining);
          }
        }
        if (animQuote.framesQuote.milli > 0) {
          const fRes = await reserveStepTokens({
            userId,
            projectId: project.id,
            quote: animQuote.framesQuote,
            ledgerReason: "frames"
          });
          if (fRes.reservedMilli > 0) framesReservationId = fRes.id;
        }
        if (animQuote.audioQuote.milli > 0) {
          const aRes = await reserveStepTokens({
            userId,
            projectId: project.id,
            quote: animQuote.audioQuote,
            ledgerReason: "voice"
          });
          if (aRes.reservedMilli > 0) audioReservationId = aRes.id;
        }
        if (animQuote.animationCodeQuote.milli > 0) {
          const cRes = await reserveStepTokens({
            userId,
            projectId: project.id,
            quote: animQuote.animationCodeQuote,
            routeSnapshot,
            ledgerReason: animQuote.isPlate ? "plate_draw" : "animation"
          });
          if (cRes.reservedMilli > 0) animCodeReservationId = cRes.id;
        }
      } catch (error) {
        if (framesReservationId) await releaseStepReservation(framesReservationId).catch(() => undefined);
        if (audioReservationId) await releaseStepReservation(audioReservationId).catch(() => undefined);
        if (animCodeReservationId) await releaseStepReservation(animCodeReservationId).catch(() => undefined);
        if (error instanceof QuoteStaleError) {
          return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message }, quote: error.freshQuote });
        }
        if (error instanceof InsufficientTokens) {
          return reply.code(402).send({
            error: {
              code: "insufficient_tokens",
              message: `Creating this animation needs ${error.needed} tokens and you have ${error.remaining}. Add tokens or choose a plan.`,
              needed: error.needed,
              remaining: error.remaining
            }
          });
        }
        throw error;
      }
    }

    // Cancel any slow background director job since we build/sync the BeatPlan from the approved Storyboard beats here
    jobs.get(project.id)?.abort();
    jobs.delete(project.id);

    const plan = buildPlanFromScriptBeats(brief, beats, project.beatPlan);
    const voiced = brief.audio.mode === "voiceover" || brief.audio.mode === "both";
    const music = brief.audio.mode === "music" || brief.audio.mode === "both";
    project =
      (await updateProjectPlan(project.id, (current) => ({
        brief,
        beatPlan: plan,
        animationTier: requestedTier,
        script: { ...scriptFromPlan(plan, brief.scriptMode === "own" ? "provided" : "generated"), confirmed: true },
        state: current.state === "Approved" ? "Approved" : "Ready for review",
        request: {
          ...current.request,
          format: aspectToFormat(brief.aspect),
          audio: { music, voiceover: voiced, voice: brief.audio.voice ?? current.request.audio?.voice ?? "Kore" },
          ...(brief.brandId ? { brandId: brief.brandId } : {})
        }
      }))) ?? project;

    const controller = new AbortController();
    request.raw.on("close", () => controller.abort());
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });
    const send = (event: unknown) => {
      if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    let framesDelivered = 0;
    let voiceDelivered = 0;
    let musicDelivered = false;
    let motionDelivered = 0;
    let delegatedToPlates = false;
    try {
      // 1. Check any missing (or explicitly force-redrawn) reference frames and draw them in parallel (4 at a time)
      const forceSet = new Set(
        Array.isArray((request.body as { forceIndices?: unknown })?.forceIndices)
          ? ((request.body as { forceIndices: unknown[] }).forceIndices.filter((i): i is number => Number.isInteger(i) && Number(i) >= 0 && Number(i) < beats.length))
          : []
      );
      const keyFor = (index: number) => scriptFrameKey(beats[index]!, brief);
      const savedFrames = new Map((project.scriptFrames ?? []).map((frame) => [frame.key, frame.svg]));
      const missingFrames = beats.map((_, i) => i).filter((i) => forceSet.has(i) || !savedFrames.has(keyFor(i)));
      if (missingFrames.length > 0) {
        const template = brief.styleExample ? findGalleryTemplate(brief.styleExample) : undefined;
        const code = template?.reference ? await readGalleryText(template.reference) : null;
        const style = template && code ? { name: template.name, code } : null;
        const notes = brief.scriptNotes ?? null;
        let framesDone = beats.length - missingFrames.length;
        send({ type: "stage", stage: "frames", done: framesDone, total: beats.length, progress: Math.round((framesDone / beats.length) * 25) });
        const frameQueue = [...missingFrames];
        await Promise.all(
          Array.from({ length: Math.min(4, frameQueue.length) }, async () => {
            for (let idx = frameQueue.shift(); idx !== undefined && !controller.signal.aborted; idx = frameQueue.shift()) {
              try {
                const svg = await sketchFrame(
                  { beat: beats[idx]!, index: idx, count: beats.length, aspect: brief.aspect, topic: brief.text, style, look: brief.look ?? "clean", notes },
                  controller.signal
                );
                await saveScriptFrame(project!.id, { key: keyFor(idx), svg });
                if (idx === 0) await setCoverFrame(project!.id, svg).catch(() => undefined);
                framesDelivered += 1;
              } catch {
                // Keep going if a single frame sketch fails
              }
              framesDone += 1;
              send({ type: "frame", index: idx, done: framesDone, total: beats.length, progress: Math.round((framesDone / beats.length) * 25) });
            }
          })
        );
        project = (await getProject(project.id)) ?? project;
      }
      if (framesReservationId) {
        await settlePartialStepReservation(framesReservationId, framesDelivered, "animate-frames").catch(() => undefined);
        framesReservationId = null;
      }

      // 2. Record any missing voiceover takes (4 in parallel) and music bed in parallel
      if ((voiced || music) && config.geminiApiKey) {
        const settings = voiceSettings({ ...project, brief });
        const dir = planAudioDir(project.id);
        const existingVoiceMatches = project.planAudio?.voice?.voice === settings.voice;
        const existingByText = new Map(existingVoiceMatches ? (project.planAudio?.voice?.lines ?? []).map((l) => [l.text, l]) : []);
        // Character voices: each line in its speaker's voice; a kept take must have been made in that voice.
        const lineSettings = (i: number) => speakerSettings(settings, beats[i]?.speaker);
        const wantedVoice = voiced
          ? beats.map((_, i) => i).filter((i) => {
              const cleaned = voiceText(beats[i]?.line);
              const cached = existingByText.get(cleaned);
              const kept = cached && (settings.cast !== "characters" || cached.file === `vo/${takeKey(lineSettings(i), cleaned)}.wav`);
              return Boolean(cleaned) && !kept;
            })
          : [];
        const wantMusicBed = music && !project.planAudio?.music;
        const audioTotal = wantedVoice.length + (wantMusicBed ? 1 : 0);
        if (audioTotal > 0) {
          let audioDone = 0;
          send({ type: "stage", stage: "voice", done: 0, total: audioTotal, progress: 28 });
          const voiceQueue = [...wantedVoice];
          const voiceWorkers = Array.from({ length: Math.min(VOICE_RULES.concurrency, voiceQueue.length) }, async () => {
            for (let idx = voiceQueue.shift(); idx !== undefined && !controller.signal.aborted; idx = voiceQueue.shift()) {
              const beatId = `b${idx + 1}`;
              try {
                const res = await voiceOneLine(config.geminiApiKey, dir, lineSettings(idx), beatId, beats[idx]?.line ?? "", false);
                const spentUsd = Math.round(res.spentSeconds * VOICE_RULES.usdPerSecond * 10000) / 10000;
                await updateProjectAudio(project!.id, (current) => {
                  const before = current.planAudio;
                  const prevLines = before?.voice?.voice === settings.voice ? (before.voice.lines ?? []) : [];
                  const filtered = prevLines.filter((l) => l.beat !== beatId && l.text !== res.line.text);
                  return {
                    voice: {
                      engine: "gemini-tts",
                      model: TTS_MODEL,
                      voice: settings.voice,
                      direction: settings.direction,
                      pace: settings.pace,
                      lines: [...filtered, res.line]
                    },
                    music: before?.music ?? null,
                    cost_usd: Math.round(((before?.cost_usd ?? 0) + spentUsd) * 10000) / 10000,
                    updatedAt: new Date().toISOString()
                  } satisfies PlanAudio;
                });
                voiceDelivered += 1;
              } catch {
                // Non-fatal: timing falls back to estimate for any unvoiced beat
              }
              audioDone += 1;
              send({
                type: "voice",
                index: idx,
                done: audioDone,
                total: audioTotal,
                progress: 25 + Math.round((audioDone / audioTotal) * 25)
              });
            }
          });
          const musicPromise = wantMusicBed
            ? (async () => {
                try {
                  const targetSeconds = plan.target_duration_s || 30;
                  const prompt = musicPrompt(plan, brief, targetSeconds);
                  const track = await produceMusic(config.geminiApiKey, dir, prompt, targetSeconds);
                  await updateProjectAudio(project!.id, (current) => {
                    const before = current.planAudio;
                    return {
                      voice: before?.voice ?? null,
                      music: {
                        source: "lyria",
                        model: track.model,
                        prompt: track.prompt,
                        file: track.file,
                        seconds: Math.round(track.seconds * 1000) / 1000
                      },
                      cost_usd: Math.round(((before?.cost_usd ?? 0) + (track.spentUsd ?? 0)) * 10000) / 10000,
                      updatedAt: new Date().toISOString()
                    } satisfies PlanAudio;
                  });
                  musicDelivered = true;
                } catch {
                  // Non-fatal: plays without music bed
                }
                audioDone += 1;
                send({
                  type: "music",
                  done: audioDone,
                  total: audioTotal,
                  progress: 25 + Math.round((audioDone / audioTotal) * 25)
                });
              })()
            : Promise.resolve();
          await Promise.all([...voiceWorkers, musicPromise]);
          project = (await getProject(project.id)) ?? project;
        }
      }
      if (audioReservationId) {
        await settleVoiceMusicReservation(audioReservationId, voiceDelivered, musicDelivered, "animate-audio").catch(() => undefined);
        audioReservationId = null;
      }

      // 3. For code-drawn plate styles, reconcile and start plate scenes; for HyperFrames, direct per-scene SVG motion
      if (isPlateLook(brief.look)) {
        send({ type: "stage", stage: "motion", done: 0, total: beats.length, progress: 55 });
        let plateResId: string | undefined;
        if (animCodeReservationId && stepBillingOnForProject(project)) {
          const drawQuote = await quotePlateDrawStep({ userId, project, tier: requestedTier, persist: false });
          if (drawQuote.toAuthor.length === 0) {
            await releaseStepReservation(animCodeReservationId).catch(() => undefined);
            animCodeReservationId = null;
          } else {
            plateResId = animCodeReservationId;
            delegatedToPlates = true;
          }
        }
        await startPlates(project.id, [], {
          routeSnapshot,
          ...(plateResId ? { reservationId: plateResId } : {})
        });
        for (let idx = 0; idx < beats.length; idx++) {
          send({
            type: "motion",
            index: idx,
            done: idx + 1,
            total: beats.length,
            cached: false,
            progress: 55 + Math.round(((idx + 1) / Math.max(1, beats.length)) * 43)
          });
        }
      } else {
        const timing = projectTiming(project);
        const frames = timing ? filmFrames(project, timing) : null;
        if (timing && frames) {
          const scenes = filmScenes(project, timing, frames);
          send({ type: "stage", stage: "motion", done: 0, total: scenes.length, progress: 52 });
          project = await ensureFilmMotion(
            project,
            scenes,
            60_000,
            ({ index, done, total, cached, ok }) => {
              if (!cached && ok) motionDelivered += 1;
              send({
                type: "motion",
                index,
                done,
                total,
                cached,
                progress: 50 + Math.round((done / Math.max(1, total)) * 48)
              });
            },
            routeSnapshot.motion
          );
          project = (await setCoverFrame(project.id, frames[0]!.svg, timing.total)) ?? project;
        }
        if (animCodeReservationId) {
          await settlePartialStepReservation(animCodeReservationId, motionDelivered, "animate-done").catch(() => undefined);
          animCodeReservationId = null;
        }
      }

      const finalProject = (await getProject(project.id)) ?? project;
      send({ type: "done", progress: 100, project: finalProject });
    } catch (error) {
      if (framesReservationId) {
        await settlePartialStepReservation(framesReservationId, framesDelivered, "animate-frames-error").catch(() => undefined);
        framesReservationId = null;
      }
      if (audioReservationId) {
        await settleVoiceMusicReservation(audioReservationId, voiceDelivered, musicDelivered, "animate-audio-error").catch(() => undefined);
        audioReservationId = null;
      }
      if (animCodeReservationId && !delegatedToPlates) {
        await settlePartialStepReservation(animCodeReservationId, motionDelivered, "animate-error").catch(() => undefined);
        animCodeReservationId = null;
      }
      send(
        upstreamSseError(request, error, "Could not prepare the browser animation.", {
          type: "error"
        })
      );
    } finally {
      if (framesReservationId) {
        await settlePartialStepReservation(framesReservationId, framesDelivered, "animate-frames-finally").catch(() => undefined);
      }
      if (audioReservationId) {
        await settleVoiceMusicReservation(audioReservationId, voiceDelivered, musicDelivered, "animate-audio-finally").catch(() => undefined);
      }
      if (animCodeReservationId && !delegatedToPlates) {
        await settlePartialStepReservation(animCodeReservationId, motionDelivered, "animate-finally").catch(() => undefined);
      }
      reply.raw.end();
    }
  });

  app.post<{ Params: { id: string } }>("/v1/projects/:id/plan", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send(notFound);
    if (project.planning?.status === "running" && jobs.has(project.id) && !stale(project.planning)) return reply.code(202).send({ project });
    const parsed = parseScriptBrief(request.body);
    if ("error" in parsed) return reply.code(400).send({ error: { code: "invalid_brief", message: parsed.error } });
    const brief = parsed.brief;
    if (!(await ensurePromptAllowed(reply, [brief.text, brief.productName], `project_${project.id}:plan`))) return;
    const userId = callerId(request);
    if (brief.animationTier === "premium") {
      try {
        await assertAnimationTierEntitled(userId, "premium");
      } catch (error) {
        if (error instanceof PremiumRequiresSubscriptionError) {
          return reply.code(402).send({ error: { code: error.code, message: error.message, tier: error.tier } });
        }
        throw error;
      }
    }
    let planReservationId: string | null = null;
    if (stepBillingOnForProject(project)) {
      try {
        const quoteId = (request.body as { quoteId?: string } | undefined)?.quoteId;
        const quote = await quoteStoryboardPlanStep({ userId, project, brief, persist: false });
        const reservation = await reserveStepTokens({
          userId,
          projectId: project.id,
          quote,
          quoteIdFromClient: quoteId,
          ledgerReason: "storyboard"
        });
        if (reservation.reservedMilli > 0) {
          planReservationId = reservation.id;
          planReservations.set(project.id, reservation.id);
        }
      } catch (error) {
        if (error instanceof QuoteStaleError) {
          return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message }, quote: error.freshQuote });
        }
        if (error instanceof InsufficientTokens) {
          return reply.code(402).send({
            error: {
              code: "insufficient_tokens",
              message: `Building the storyboard needs ${error.needed} tokens and you have ${error.remaining}. Add tokens or choose a plan.`,
              needed: error.needed,
              remaining: error.remaining
            }
          });
        }
        throw error;
      }
    }
    const startedAtIso = new Date().toISOString();
    const started = await setProjectPlanning(
      project.id,
      {
        status: "running",
        startedAt: startedAtIso,
        resuming: false,
        attempt: 1,
        ...(planReservationId ? { reservationId: planReservationId } : {}),
        brief
      },
      brief
    );
    if (!started) {
      if (planReservationId) {
        planReservations.delete(project.id);
        await releaseStepReservation(planReservationId).catch(() => undefined);
      }
      return reply.code(404).send(notFound);
    }
    spawnPlanExecution({
      project: started,
      brief,
      planReservationId,
      startedAtIso,
      attempt: 1,
      resuming: false,
      logInfo: (obj, msg) => app.log.info(obj, msg),
      logError: (obj, msg) => request.log.error(obj, msg),
      requestId: requestIdOf(request)
    });
    return reply.code(202).send({ project: started });
  });

  /**
   * The script first: a short call (seconds, not a minute) that writes the film's script scene by scene, so the person can read it,
   * correct it like a document and only then ask for the storyboard (POST /plan with scriptMode "own", built from this script).
   */
  app.post<{ Params: { id: string } }>("/v1/projects/:id/script-draft", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send(notFound);
    const parsed = parseScriptBrief(request.body);
    if ("error" in parsed) return reply.code(400).send({ error: { code: "invalid_brief", message: parsed.error } });
    if (!(await ensurePromptAllowed(reply, [parsed.brief.text, parsed.brief.productName], `project_${project.id}:script_draft`))) return;
    const userId = callerId(request);
    let draftResId: string | null = null;
    if (stepBillingOnForProject(project)) {
      try {
        const quote = await quoteScriptStep({ userId, project, brief: parsed.brief, persist: false });
        const reservation = await reserveStepTokens({ userId, projectId: project.id, quote, ledgerReason: "script" });
        if (reservation.reservedMilli > 0) draftResId = reservation.id;
      } catch (error) {
        if (error instanceof InsufficientTokens) {
          return reply.code(402).send({ error: { code: "insufficient_tokens", message: `Writing this script needs ${error.needed} tokens and you have ${error.remaining}. Add tokens or choose a plan.`, needed: error.needed, remaining: error.remaining } });
        }
        throw error;
      }
    }
    try {
      // The words come from the problem text here; a pasted script is already a script.
      const brief = { ...parsed.brief, scriptMode: "problem" as const };
      const { context } = await directorContextFor(project, brief);
      const draft = await draftScript(brief, context, AbortSignal.timeout(100_000));
      const updated = await updateProject(project.id, { script: draft.script });
      if (draftResId) await settleStepReservation(draftResId).catch(() => undefined);
      return reply.code(201).send(updated);
    } catch (error) {
      if (draftResId) await releaseStepReservation(draftResId).catch(() => undefined);
      if (error instanceof ProjectInvalid) return reply.code(400).send({ error: { code: "invalid_project", message: error.message } });
      return reply.code(502).send(upstreamError(request, error, "script_failed", "The script could not be written. Try again."));
    }
  });

  /** Applies an instruction ("make it shorter", "add a scene about pricing") to the script as the person has edited it. */
  app.post<{ Params: { id: string }; Body: { instruction?: unknown; brief?: unknown } }>("/v1/projects/:id/script-draft/revise", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send(notFound);
    if (!project.script) return reply.code(409).send({ error: { code: "no_script", message: "Write the script first." } });
    const instruction = typeof request.body?.instruction === "string" ? request.body.instruction.trim().slice(0, 500) : "";
    if (instruction.length < 3) return reply.code(400).send({ error: { code: "invalid_instruction", message: "Say what to change." } });
    const parsed = parseScriptBrief(request.body?.brief);
    if ("error" in parsed) return reply.code(400).send({ error: { code: "invalid_brief", message: parsed.error } });
    if (!(await ensurePromptAllowed(reply, [instruction, parsed.brief.text, parsed.brief.productName], `project_${project.id}:script_revise`))) return;
    const userId = callerId(request);
    let reviseResId: string | null = null;
    if (stepBillingOnForProject(project)) {
      try {
        const quote = await quoteScriptStep({ userId, project, brief: parsed.brief, persist: false });
        const reservation = await reserveStepTokens({ userId, projectId: project.id, quote, ledgerReason: "script_edit" });
        if (reservation.reservedMilli > 0) reviseResId = reservation.id;
      } catch (error) {
        if (error instanceof InsufficientTokens) {
          return reply.code(402).send({ error: { code: "insufficient_tokens", message: `Revising this script needs ${error.needed} tokens and you have ${error.remaining}. Add tokens or choose a plan.`, needed: error.needed, remaining: error.remaining } });
        }
        throw error;
      }
    }
    try {
      const brief = { ...parsed.brief, scriptMode: "problem" as const };
      const { context } = await directorContextFor(project, brief);
      const draft = await reviseScript(project.script, instruction, brief, context, AbortSignal.timeout(100_000));
      const updated = await updateProject(project.id, { script: draft.script });
      if (reviseResId) await settleStepReservation(reviseResId).catch(() => undefined);
      return reply.send(updated);
    } catch (error) {
      if (reviseResId) await releaseStepReservation(reviseResId).catch(() => undefined);
      if (error instanceof ProjectInvalid) return reply.code(400).send({ error: { code: "invalid_project", message: error.message } });
      return reply.code(502).send(upstreamError(request, error, "script_failed", "The change could not be made. Try again."));
    }
  });

  /** Stops the director for this project; the model call is cancelled and nothing is applied. */
  app.delete<{ Params: { id: string } }>("/v1/projects/:id/plan/job", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send(notFound);
    jobs.get(project.id)?.abort();
    jobs.delete(project.id);
    const pendingResId = planReservations.get(project.id) ?? project.planning?.reservationId ?? null;
    if (pendingResId) {
      planReservations.delete(project.id);
      await releaseStepReservation(pendingResId).catch(() => undefined);
    }
    if (project.planning?.status !== "running") return reply.send({ project });
    const updated = await setProjectPlanning(project.id, { status: "cancelled", startedAt: project.planning.startedAt });
    return reply.send({ project: updated });
  });

  /** Rewrites one frame's words from an instruction ("make it punchier", "mention the warranty"); nothing else changes. */
  app.post<{ Params: { id: string; beatId: string }; Body: { instruction?: unknown } }>("/v1/projects/:id/plan/beats/:beatId/rewrite", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send(notFound);
    const beat = project.beatPlan?.beats.find((item) => item.id === request.params.beatId);
    if (!project.beatPlan || !beat) return reply.code(404).send({ error: { code: "not_found", message: "Frame not found." } });
    const instruction = typeof request.body?.instruction === "string" ? plainText(request.body.instruction).slice(0, 300).trim() : "";
    if (instruction.length < 3) return reply.code(400).send({ error: { code: "invalid_instruction", message: "Say what to change in a few words." } });
    if (!(await ensurePromptAllowed(reply, [instruction], `project_${project.id}:beat_rewrite_${beat.id}`))) return;
    const userId = callerId(request);
    let beatResId: string | null = null;
    if (stepBillingOnForProject(project) && project.brief) {
      try {
        const quote = await quoteScriptStep({ userId, project, brief: project.brief, isSingleBeatRewrite: true, persist: false });
        const reservation = await reserveStepTokens({ userId, projectId: project.id, quote, ledgerReason: "beat_rewrite" });
        if (reservation.reservedMilli > 0) beatResId = reservation.id;
      } catch (error) {
        if (error instanceof InsufficientTokens) {
          return reply.code(402).send({ error: { code: "insufficient_tokens", message: `Rewriting this frame needs ${error.needed} tokens and you have ${error.remaining}. Add tokens or choose a plan.`, needed: error.needed, remaining: error.remaining } });
        }
        throw error;
      }
    }
    let rewrite;
    try { rewrite = await rewriteBeat(project.beatPlan, beat, instruction, project.brief); }
    catch (error) {
      if (beatResId) await releaseStepReservation(beatResId).catch(() => undefined);
      return reply.code(502).send(upstreamError(request, error, "rewrite_failed", "Could not rewrite the frame."));
    }
    const result = applyPlanEdits(project, { beats: [{ id: beat.id, ...rewrite }] });
    if ("problems" in result) {
      if (beatResId) await releaseStepReservation(beatResId).catch(() => undefined);
      return reply.code(422).send({ error: { code: "plan_problems", message: result.problems[0] }, problems: result.problems });
    }
    const updated = await updateProjectPlan(project.id, (current) => ({ brief: current.brief, beatPlan: result.plan, script: scriptFromPlan(result.plan, current.script?.source ?? "generated") }));
    if (beatResId) await settleStepReservation(beatResId).catch(() => undefined);
    return updated ?? reply.code(404).send(notFound);
  });

  /** Storyboard edits: text, order, and accept/reject of suggestions. 422 with problems when an edit breaks the standards. */
  app.patch<{ Params: { id: string } }>("/v1/projects/:id/plan", async (request, reply) => {
    const patch = (request.body ?? {}) as PlanPatch;
    // The drawing style is visual only (colours and fonts stay the brand's), so it changes without replanning.
    if (patch.look !== undefined && !isLook(patch.look)) return reply.code(400).send({ error: { code: "invalid_look", message: "Unknown look." } });
    if (patch.animationTier !== undefined && !isAnimationTier(patch.animationTier)) {
      return reply.code(400).send({ error: { code: "invalid_tier", message: 'Animation tier must be "standard" or "premium".' } });
    }
    if (patch.animationTier === "premium") {
      try {
        await assertAnimationTierEntitled(callerId(request), "premium");
      } catch (error) {
        if (error instanceof PremiumRequiresSubscriptionError) {
          return reply.code(402).send({ error: { code: error.code, message: error.message, tier: error.tier } });
        }
        throw error;
      }
    }
    let planProblems: string[] | null = null;
    try {
      const updated = await updateProjectPlan(request.params.id, (current) => {
        const result = applyPlanEdits(current, patch);
        if ("problems" in result) {
          planProblems = result.problems;
          throw new Error("PLAN_PROBLEMS");
        }
        // A style change keeps the plan's words; the scenes belong to the style, so any the new style does not have are cleared.
        let brief = current.brief && isLook(patch.look) ? withLook(current.brief, patch.look) : current.brief;
        if (brief && isAnimationTier(patch.animationTier)) {
          brief = { ...brief, animationTier: patch.animationTier };
        }
        if (brief && patch.styleFamily !== undefined) {
          const { styleFamily: _old, ...rest } = brief;
          const family = typeof patch.styleFamily === "string" ? getStyleFamily(patch.styleFamily) : undefined;
          brief = family && family.look === (brief.look ?? "clean") ? { ...rest, styleFamily: family.id } : rest;
        }
        if (brief && patch.styleExample !== undefined) {
          const { styleExample: _oldExample, ...rest } = brief;
          const example = typeof patch.styleExample === "string" ? findGalleryTemplate(patch.styleExample) : undefined;
          brief = example && example.look === (brief.look ?? "clean") ? { ...rest, styleExample: example.id } : rest;
        }
        if (brief && typeof patch.captions === "string" && (captionModes as readonly string[]).includes(patch.captions)) {
          brief = { ...brief, captions: patch.captions as CaptionMode };
        }
        if (brief && typeof patch.audioMode === "string" && (audioModes as readonly string[]).includes(patch.audioMode)) {
          brief = { ...brief, audio: { ...brief.audio, mode: patch.audioMode as AudioMode } };
        }
        if (brief && (patch.aspect !== undefined || patch.aspects !== undefined)) {
          const validAspects = Array.isArray(patch.aspects)
            ? aspects.filter((a) => (patch.aspects as unknown[]).includes(a))
            : undefined;
          const nextPrimary =
            typeof patch.aspect === "string" && (aspects as readonly string[]).includes(patch.aspect)
              ? (validAspects?.length ? resolvePrimaryAspect(patch.aspect, validAspects) : (patch.aspect as Aspect))
              : validAspects?.length
                ? resolvePrimaryAspect(brief.aspect, validAspects)
                : brief.aspect;
          brief = {
            ...brief,
            aspect: nextPrimary,
            ...(validAspects?.length ? { aspects: validAspects } : {})
          };
        }
        const valid = new Set(scenesFor(brief?.look, brief?.styleFamily).map((scene) => scene.id));
        const plan = { ...result.plan, canvas: brief?.aspect ?? result.plan.canvas, beats: result.plan.beats.map((beat) => (beat.scene && !valid.has(beat.scene) ? { ...beat, scene: null } : beat)) };
        if (
          brief?.scriptBeats &&
          current.beatPlan?.beats &&
          brief.scriptBeats.length === current.beatPlan.beats.length &&
          (patch.order !== undefined || patch.beats !== undefined)
        ) {
          const oldPlanBeats = current.beatPlan.beats;
          const oldScriptBeats = brief.scriptBeats;
          const syncedScriptBeats: ScriptBeat[] = plan.beats.map((pb, idx) => {
            const oldIdx = oldPlanBeats.findIndex((ob) => ob.id === pb.id);
            const baseSb = (oldIdx >= 0 ? oldScriptBeats[oldIdx] : oldScriptBeats[idx]) ?? {
              keyword: pb.keyword,
              visual: null,
              onScreen: pb.on_screen ?? null,
              line: pb.line ?? null
            };
            return {
              ...baseSb,
              keyword: pb.keyword,
              onScreen: pb.on_screen ?? null,
              line: pb.line ?? null
            };
          });
          brief = { ...brief, scriptBeats: ensureScriptBeatIds(syncedScriptBeats) };
        }
        return {
          brief,
          beatPlan: plan,
          ...(isAnimationTier(patch.animationTier) ? { animationTier: patch.animationTier } : {}),
          script: scriptFromPlan(plan, current.script?.source ?? "generated"),
          ...(brief ? { request: { ...current.request, format: aspectToFormat(brief.aspect) } } : {})
        };
      });
      if (updated && typeof patch.captions === "string" && (captionModes as readonly string[]).includes(patch.captions)) {
        await setPlateSubtitles(project.id, { mode: patch.captions }).catch(() => undefined);
      }
      return updated ?? reply.code(404).send(notFound);
    } catch (error) {
      if (planProblems) return reply.code(422).send({ error: { code: "plan_problems", message: planProblems[0] }, problems: planProblems });
      if (error instanceof ProjectInvalid) return reply.code(400).send({ error: { code: "invalid_project", message: error.message } });
      throw error;
    }
  });

  /**
   * The plan's sound (voiceover takes + music bed), generated in parallel and cached per line, so
   * after a storyboard edit only the edited lines are voiced again. Body: `{ parts?: ["voice", "music"] }`
   * (default: everything the brief's audio mode needs). The measured takes become the clock, so the
   * response carries the re-timed `durationSeconds` and `beatTimes`.
   */
  app.post<{ Params: { id: string }; Body: { parts?: unknown; quoteId?: string } }>("/v1/projects/:id/plan/audio", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send(notFound);
    if (!project.beatPlan && !project.brief?.scriptBeats?.length) return reply.code(409).send({ error: { code: "no_plan", message: "Generate the plan first." } });
    const raw = request.body?.parts;
    if (raw !== undefined && (!Array.isArray(raw) || raw.some((part) => part !== "voice" && part !== "music"))) {
      return reply.code(400).send({ error: { code: "invalid_parts", message: "parts must list \"voice\" and/or \"music\"." } });
    }
    const userId = callerId(request);
    let audioReservationId: string | null = null;
    if (stepBillingOnForProject(project) && project.brief) {
      const beats =
        project.brief.scriptBeats ??
        (project.beatPlan?.beats ?? []).map((b) => ({
          id: b.id,
          keyword: b.keyword,
          visual: null,
          onScreen: b.on_screen ?? null,
          line: b.line ?? null
        }));
      const includeMusic = !Array.isArray(raw) || raw.includes("music");
      const includeVoice = !Array.isArray(raw) || raw.includes("voice");
      try {
        const quote = await quoteVoiceMusicStep({
          userId,
          project,
          brief: project.brief,
          beats,
          ...(includeVoice ? {} : { wantedIndices: [] }),
          includeMusic,
          persist: false
        });
        const reservation = await reserveStepTokens({
          userId,
          projectId: project.id,
          quote,
          quoteIdFromClient: request.body?.quoteId,
          ledgerReason: "voice"
        });
        if (reservation.reservedMilli > 0) audioReservationId = reservation.id;
      } catch (error) {
        if (error instanceof QuoteStaleError) {
          return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message }, quote: error.freshQuote });
        }
        if (error instanceof InsufficientTokens) {
          return reply.code(402).send({
            error: {
              code: "insufficient_tokens",
              message: `Recording voiceover and music needs ${error.needed} tokens and you have ${error.remaining}. Add tokens or choose a plan.`,
              needed: error.needed,
              remaining: error.remaining
            }
          });
        }
        throw error;
      }
    }
    try {
      const result = await producePlanAudio(project.id, () => getProject(project.id), raw as AudioPart[] | undefined);
      if (!result) {
        if (audioReservationId) await releaseStepReservation(audioReservationId).catch(() => undefined);
        return reply.code(404).send(notFound);
      }
      if (audioReservationId) await settleStepReservation(audioReservationId).catch(() => undefined);
      const timing = projectTiming(result.project);
      return {
        project: result.project,
        audio: audioStatus(result.project),
        durationSeconds: timing?.total ?? (result.project.brief ? effectiveBriefDurationSeconds(result.project.brief) : 30),
        beatTimes: timing ? beatTimes(timing) : {},
        warnings: [...result.warnings, ...(timing?.warnings ?? [])],
        spent_usd: result.spentUsd
      };
    } catch (error) {
      if (audioReservationId) await releaseStepReservation(audioReservationId).catch(() => undefined);
      if (error instanceof AudioUnavailable) return reply.code(503).send({ error: { code: "audio_unavailable", message: error.message } });
      return reply.code(502).send(upstreamError(request, error, "audio_failed", "The voiceover failed."));
    }
  });

  /** A generated voiceover take or music bed (`vo/<hash>.wav`, `music/<hash>.mp3|wav`), for the storyboard page. */
  app.get<{ Params: { projectId: string; folder: string; file: string } }>("/v1/preview/plans/:projectId/audio/:folder/:file", async (request, reply) => {
    const { projectId, folder, file } = request.params;
    if (!/^[0-9a-f-]{36}$/i.test(projectId) || (folder !== "vo" && folder !== "music") || !/^[0-9a-f]{20}\.(wav|mp3)$/.test(file)) return reply.code(404).send(notFound);
    const bytes = await readMedia(join(planAudioDir(projectId), folder, file)).catch(() => null);
    if (!bytes) return reply.code(404).send({ error: { code: "not_found", message: "Audio not found." } });
    return sendMedia(request, reply, bytes, audioType(file));
  });

  /** The shipped SFX library (worker/templates/beat-plan/sfx, Pixabay Content License). */
  app.get<{ Params: { file: string } }>("/v1/preview/plan-sfx/:file", async (request, reply) => {
    const name = request.params.file.replace(/\.mp3$/, "");
    if (!Object.hasOwn(SFX, name) || !request.params.file.endsWith(".mp3")) return reply.code(404).send({ error: { code: "not_found", message: "Sound not found." } });
    const bytes = await readFile(join(config.templatesDir, "beat-plan", "sfx", request.params.file)).catch(() => null);
    if (!bytes) return reply.code(404).send({ error: { code: "not_found", message: "Sound not found." } });
    return sendMedia(request, reply, bytes, "audio/mpeg");
  });

  const inFlightVoicePreviews = new Map<string, Promise<Buffer>>();

  /** Voice sample preview for any prebuilt Gemini TTS voice (`voices` in @videosaas/contracts), cached on disk after first synthesis. */
  app.get<{ Params: { voice: string }; Querystring: { cached?: string } }>("/v1/voices/:voice/preview", async (request, reply) => {
    const voiceId = request.params.voice;
    if (!voiceIds.includes(voiceId)) return reply.code(404).send({ error: { code: "not_found", message: "Unknown voice." } });
    const cacheDir = join(config.audioDir, "_voice_previews");
    const cacheFile = join(cacheDir, `${voiceId}.wav`);
    const cachedBytes = (await readFile(cacheFile).catch(() => null)) ?? (await readMedia(cacheFile).catch(() => null));
    if (cachedBytes) {
      return sendMedia(request, reply, cachedBytes, "audio/wav");
    }
    if (request.query.cached === "1" || !config.geminiApiKey) {
      return reply.code(503).send({ error: { code: "audio_unavailable", message: "Sample preview is not cached yet or GEMINI_API_KEY is unavailable." } });
    }
    const meta = voices.find((v) => v.id === voiceId);
    const sampleText = `Hello, I'm ${meta?.label ?? voiceId}. Every story has a rhythm, and here is how I sound.`;
    try {
      let pending = inFlightVoicePreviews.get(voiceId);
      if (!pending) {
        pending = (async () => {
          const { wav } = await synthesizeVoiceover(config.geminiApiKey, {
            text: sampleText,
            voice: voiceId,
            style: `${meta?.character ?? "Clear, natural"} narration`
          });
          await mkdir(cacheDir, { recursive: true });
          await saveMedia(cacheFile, wav).catch(() => writeFile(cacheFile, wav).catch(() => undefined));
          return wav;
        })().finally(() => {
          inFlightVoicePreviews.delete(voiceId);
        });
        inFlightVoicePreviews.set(voiceId, pending);
      }
      const wav = await pending;
      return sendMedia(request, reply, wav, "audio/wav");
    } catch (e) {
      return reply.code(502).send({ error: { code: "tts_failed", message: e instanceof Error ? e.message : "Could not synthesize voice preview." } });
    }
  });

  /**
   * Composition source for the live storyboard (@hyperframes/player 0.8.111).
   * The beat-plan composition engine (worker/templates/beat-plan) renders the project's plan at its own
   * canvas and length; `baseUrl` serves its page, `variables` are the editable text values (the same keys
   * as the page's <script id="hf-variables"> block) and `beatTimes` is the plan clock (timing.ts).
   */
  app.get<{ Params: { id: string }; Querystring: { beat?: string } }>("/v1/projects/:id/composition", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send(notFound);
    if (!project.beatPlan) return reply.code(409).send({ error: { code: "no_plan", message: "Generate the plan first." } });
    const beats = request.query.beat ? project.beatPlan.beats.filter((beat) => beat.id === request.query.beat) : project.beatPlan.beats;
    if (request.query.beat && beats.length === 0) return reply.code(404).send({ error: { code: "not_found", message: "Beat not found." } });
    const timing = projectTiming(project)!;
    const times = beatTimes(timing);
    const readiness = planReadiness(project);
    return {
      engine: "beat-plan",
      baseUrl: `/v1/preview/plans/${project.id}`,
      canvas: project.beatPlan.canvas,
      // The composition's real length (plate films use their rendered scene timeline; others use the plan clock).
      durationSeconds: readiness.durationSeconds ?? timing.total,
      variables: textValues(beats),
      ...(project.beatPlan.overrides && Object.keys(project.beatPlan.overrides).length > 0
        ? { overrides: project.beatPlan.overrides }
        : {}),
      // The plan clock (backend/src/plan/timing.ts): each beat's slot on the film, in seconds.
      beatTimes: Object.fromEntries(beats.map((beat) => [beat.id, times[beat.id]])),
      // The plan's sound: which lines have takes (the rest play silent on estimated timing) and the bed.
      audio: audioStatus(project),
      visuals: visualStatus(project),
      // What Submit needs: blocking items (each with the beat to fix) and non-blocking notes (readiness.ts).
      readiness,
      slots: beats.flatMap((beat) => [
        { id: `${beat.id}.keyword`, beat: beat.id, budget: { chars: BEAT_LIMITS.keywordChars, words: BEAT_LIMITS.keywordWords } },
        { id: `${beat.id}.on_screen`, beat: beat.id, budget: { chars: BEAT_LIMITS.onScreenChars } },
        { id: `${beat.id}.line`, beat: beat.id, budget: { words: BEAT_LIMITS.lineWords } }
      ])
    };
  });

  /**
   * The beat-plan composition engine page for the live storyboard (served to the browser via the
   * frontend's same-origin /api/preview rewrite). Text edits arrive by rewriting its
   * <script id="hf-variables" type="application/json"> block; see backend/src/plan/preview.ts.
   */
  app.get<{ Params: { projectId: string } }>("/v1/preview/plans/:projectId", async (request, reply) => {
    const project = await getProject(request.params.projectId);
    if (!project) return reply.code(404).send(notFound);
    if (!project.beatPlan) return reply.code(409).send({ error: { code: "no_plan", message: "Generate the plan first." } });
    try {
      const html = signPreviewUrls(await planPreviewHtml(project), mediaToken(callerId(request)).token);
      return reply
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "default-src 'self' data: blob:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; media-src 'self'; connect-src 'none'; frame-ancestors 'self'")
        .send(html);
    } catch (error) {
      const message = error instanceof PreviewUnavailable ? error.message : "Could not build this storyboard preview.";
      app.log.warn({ err: error, projectId: project.id }, "beat-plan preview failed");
      return reply.code(503).send({ error: { code: "preview_unavailable", message } });
    }
  });

  /**
   * Step 1 of the two-step comment edit protocol:
   * Browser sends `comments` and `measured: { canvas, snapshots: { [commentId]: FrameElementsSnapshot[] } }`.
   * Server strictly validates snapshot shapes/bounds, translates comments (rules first, then model),
   * and returns per-comment candidate `EditPatch`es (or `{ refused: reason }`) plus `planVersion`.
   * Nothing is saved.
   */
  app.post<{
    Params: { id: string };
    Body: {
      comments?: unknown;
      measured?: unknown;
    };
  }>("/v1/projects/:id/plan/edit/propose", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send(notFound);
    if (!project.beatPlan || !project.brief) {
      return reply.code(409).send({ error: { code: "no_plan", message: "Generate the plan first." } });
    }
    const body = request.body ?? {};
    const commentTexts = Array.isArray(body.comments)
      ? body.comments
          .map((c) => (c && typeof c === "object" && typeof (c as { body?: unknown }).body === "string" ? (c as { body: string }).body : ""))
          .filter(Boolean)
      : [];
    if (commentTexts.some((t) => t.length > 2000)) {
      return reply.code(400).send({ error: { code: "comment_too_long", message: "A comment can be at most 2000 characters." } });
    }
    if (commentTexts.length > 0 && !(await ensurePromptAllowed(reply, commentTexts, `project_${project.id}:plan_edit_propose`))) {
      return;
    }

    const userId = callerId(request);
    let elementEditReservationId: string | null = null;
    try {
      const proposed = await proposeHyperFramesCommentEdits(
        project,
        {
          comments: body.comments,
          measured: body.measured
        },
        {
          admitBatch: async ({ modelCount, ruleCount, fingerprints }) => {
            if (stepBillingOnForProject(project)) {
              const quote = await quoteElementEditStep({
                userId,
                project,
                modelCommentCount: modelCount,
                ruleCommentCount: ruleCount,
                commentFingerprints: fingerprints,
                persist: false
              });
              const reservation = await reserveStepTokens({
                userId,
                projectId: project.id,
                quote,
                ledgerReason: "element_edit"
              });
              if (reservation.reservedMilli > 0) {
                elementEditReservationId = reservation.id;
              }
              return null;
            }
            return meteringOn() ? admitPreview(userId, project.id, await tierFor(userId)) : null;
          },
          finishBatch: async (deliveredModelCount) => {
            if (elementEditReservationId) {
              const resId = elementEditReservationId;
              elementEditReservationId = null;
              await settlePartialStepReservation(resId, deliveredModelCount, "element-edit-done");
            }
          }
        }
      );
      return proposed;
    } catch (error) {
      if (elementEditReservationId) {
        await releaseStepReservation(elementEditReservationId).catch(() => undefined);
      }
      if (error instanceof InsufficientTokens) {
        return reply.code(402).send({
          error: {
            code: "insufficient_tokens",
            message: `Applying this comment needs ${error.needed} tokens and you have ${error.remaining}. Add tokens or choose a plan.`,
            needed: error.needed,
            remaining: error.remaining
          }
        });
      }
      if (error instanceof InvalidSnapshotsError) {
        return reply.code(400).send({
          error: { code: error.code, message: error.message }
        });
      }
      const isTimeout =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError" || /timed?\s*out|aborted/i.test(error.message));
      const status = isTimeout ? 503 : 502;
      return reply.code(status).send(
        upstreamError(request, error, "propose_failed", "Could not translate the comment. Try again.")
      );
    }
  });

  /**
   * Step 2 of the two-step comment edit protocol:
   * Browser applies candidate patches locally via `hf-variables`, re-samples the active window,
   * and sends `{ planVersion, items: [{ id, patch, before, after }] }`.
   * Server verifies `planVersion` (409 if stale) inside the store's serialised compare-and-set,
   * runs the pure `classifyEditPatch` / `checkSceneHintLayout` classifiers on the snapshots,
   * saves element `overrides` or beat `hints` / re-fitted text, and returns `{ project, plan, planVersion, results }`.
   */
  app.post<{
    Params: { id: string };
    Body: {
      planVersion?: unknown;
      items?: unknown;
    };
  }>("/v1/projects/:id/plan/edit/commit", async (request, reply) => {
    const body = request.body ?? {};
    let committed: CommitEditResult | undefined;
    let noPlan = false;
    try {
      const saved = await updateProjectPlan(
        request.params.id,
        (current) => {
          if (!current.beatPlan || !current.brief) {
            noPlan = true;
            throw new Error("NO_PLAN");
          }
          committed = commitHyperFramesCommentEdits(current, {
            planVersion: body.planVersion,
            items: body.items
          });
          return {
            brief: current.brief,
            beatPlan: committed.plan,
            script: scriptFromPlan(committed.plan, current.script?.source ?? "generated")
          };
        },
        {
          expectedVersion: typeof body.planVersion === "string" ? body.planVersion : "",
          versionOf: computePlanVersion,
          onVersionMismatch: (currentVersion) => new StalePlanVersionError(currentVersion)
        }
      );
      if (!saved || !committed) return reply.code(404).send(notFound);

      return {
        project: saved,
        plan: saved.beatPlan,
        planVersion: computePlanVersion(saved),
        results: committed.results,
        ...(committed.results.length === 1
          ? { patch: committed.results[0]!.patch, decision: committed.results[0]!.decision }
          : {})
      };
    } catch (error) {
      if (noPlan) {
        return reply.code(409).send({ error: { code: "no_plan", message: "Generate the plan first." } });
      }
      if (error instanceof ProjectInvalid) {
        return reply.code(400).send({ error: { code: "invalid_project", message: error.message } });
      }
      if (error instanceof StalePlanVersionError) {
        return reply.code(409).send({
          error: { code: error.code, message: error.message },
          planVersion: error.currentPlanVersion
        });
      }
      if (error instanceof InvalidSnapshotsError) {
        return reply.code(400).send({
          error: { code: error.code, message: error.message }
        });
      }
      if (error instanceof EditRefusedError) {
        return reply.code(422).send({
          error: { code: error.code, message: error.message, ...(error.commentId ? { commentId: error.commentId } : {}) },
          problems: [error.message],
          details: error.details ?? null,
          ...(error.commentId ? { commentId: error.commentId } : {})
        });
      }
      throw error;
    }
  });

  /**
   * Undo an element-level override (`DELETE /v1/projects/:id/plan/overrides/:el` or `?hint=1` to clear a beat's hint/overrides).
   */
  app.delete<{
    Params: { id: string; el: string };
    Querystring: { hint?: string; planVersion?: string };
  }>("/v1/projects/:id/plan/overrides/:el", async (request, reply) => {
    let elId: string;
    try {
      elId = decodeURIComponent(request.params.el);
    } catch {
      return reply.code(400).send({ error: { code: "invalid_element_id", message: "Invalid element id." } });
    }
    if (!elId || !/^[a-zA-Z0-9_:-]{1,64}$/.test(elId)) {
      return reply.code(400).send({ error: { code: "invalid_element_id", message: "Invalid element id." } });
    }
    const expectedVersion =
      typeof request.query.planVersion === "string" && request.query.planVersion.trim()
        ? request.query.planVersion.trim()
        : undefined;
    let noPlan = false;
    try {
      const saved = await updateProjectPlan(
        request.params.id,
        (current) => {
          if (!current.beatPlan) {
            noPlan = true;
            throw new Error("NO_PLAN");
          }
          const plan = structuredClone(current.beatPlan);
          if (plan.overrides && Object.prototype.hasOwnProperty.call(plan.overrides, elId)) {
            delete plan.overrides[elId];
            if (Object.keys(plan.overrides).length === 0) delete plan.overrides;
          }
          if (request.query.hint === "1") {
            const beatId = elId.split(":")[0];
            const beat = plan.beats.find((b) => b.id === beatId || b.id === elId);
            if (beat) delete beat.hints;
          }
          return {
            brief: current.brief,
            beatPlan: plan,
            script: scriptFromPlan(plan, current.script?.source ?? "generated")
          };
        },
        expectedVersion !== undefined
          ? {
              expectedVersion,
              versionOf: computePlanVersion,
              onVersionMismatch: (currentVersion) => new StalePlanVersionError(currentVersion)
            }
          : undefined
      );
      return saved ?? reply.code(404).send(notFound);
    } catch (error) {
      if (noPlan) {
        return reply.code(409).send({ error: { code: "no_plan", message: "Generate the plan first." } });
      }
      if (error instanceof ProjectInvalid) {
        return reply.code(400).send({ error: { code: "invalid_project", message: error.message } });
      }
      if (error instanceof StalePlanVersionError) {
        return reply.code(409).send({
          error: { code: error.code, message: error.message },
          planVersion: error.currentPlanVersion
        });
      }
      throw error;
    }
  });
}
