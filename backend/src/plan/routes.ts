import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { BEAT_LIMITS, aspectToFormat, beatPlanProblems, isLook, parseScriptBrief, plainText, type BeatPlan, type LookId, type ProjectScript, type ScriptBrief, type VideoProject } from "@videosaas/contracts";
import { getBrand } from "../brand/store.ts";
import { getProject, ProjectInvalid, updateProjectPlan } from "../projects/store.ts";
import { config } from "../config.ts";
import { readMedia } from "../media.ts";
import { AudioUnavailable, audioStatus, planAudioDir, producePlanAudio, type AudioPart } from "./audio.ts";
import { director } from "./director.ts";
import { SFX } from "./sound.ts";
import { registerSiteRoutes } from "../site/routes.ts";
import { planReadiness } from "./readiness.ts";
import { textValues } from "./composition.ts";
import { planPreviewHtml, projectTiming } from "./preview.ts";
import { beatTimes } from "./timing.ts";
import { PreviewUnavailable } from "../preview/service.ts";

const notFound = { error: { code: "not_found", message: "Project not found." } };

/** A script view of the plan, so existing screens (review, comments) keep working. */
function scriptFromPlan(plan: BeatPlan, source: ProjectScript["source"]): ProjectScript {
  return {
    source,
    lines: plan.beats.slice(0, 12).map((beat) => ({ label: beat.role[0].toUpperCase() + beat.role.slice(1), onScreen: (beat.on_screen ?? beat.keyword).slice(0, 180), ...(beat.line ? { voiceover: beat.line.slice(0, 240) } : {}) })),
    confirmed: false,
    updatedAt: new Date().toISOString()
  };
}

type BeatEdit = { id?: unknown; keyword?: unknown; on_screen?: unknown; line?: unknown };
/** "clean" is the default, so it is stored as no look at all (same as parseScriptBrief). */
const withLook = (brief: ScriptBrief, look: LookId): ScriptBrief => {
  const { look: _old, ...rest } = brief;
  return look === "clean" ? rest : { ...rest, look };
};

type PlanPatch = { beats?: BeatEdit[]; order?: unknown; suggestions?: { index?: unknown; accepted?: unknown }[]; look?: unknown };

/** Applies storyboard edits. Returns the edited plan, or the problems that block it. */
export function applyPlanEdits(project: VideoProject, patch: PlanPatch): { plan: BeatPlan } | { problems: string[] } {
  if (!project.beatPlan || !project.brief) return { problems: ["Generate the plan first."] };
  const plan: BeatPlan = structuredClone(project.beatPlan);
  // Plain text only (markdown markers would be drawn and voiced literally).
  const text = (value: unknown, max: number) => (typeof value === "string" ? plainText(value).slice(0, max) : undefined);
  for (const edit of patch.beats ?? []) {
    const beat = plan.beats.find((item) => item.id === edit.id);
    if (!beat) return { problems: [`Unknown beat "${String(edit.id)}".`] };
    const keyword = text(edit.keyword, BEAT_LIMITS.keywordChars + 20);
    const onScreen = edit.on_screen === null ? null : text(edit.on_screen, BEAT_LIMITS.onScreenChars + 20);
    const line = edit.line === null ? null : text(edit.line, BEAT_LIMITS.lineChars + 40);
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
  const problems = beatPlanProblems(plan, project.brief);
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

export async function registerPlanRoutes(app: FastifyInstance) {
  await registerSiteRoutes(app);
  /** Script & Style → the director → beat plan, script and suggestions. */
  app.post<{ Params: { id: string } }>("/v1/projects/:id/plan", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send(notFound);
    const parsed = parseScriptBrief(request.body);
    if ("error" in parsed) return reply.code(400).send({ error: { code: "invalid_brief", message: parsed.error } });
    const brief = parsed.brief;
    const screenshots = project.screenshots
      .filter((shot) => !brief.screenshotIds || brief.screenshotIds.includes(shot.id))
      .sort((a, b) => (brief.screenshotIds ? brief.screenshotIds.indexOf(a.id) - brief.screenshotIds.indexOf(b.id) : 0))
      .map((shot) => ({ id: shot.id, name: shot.name, purpose: shot.purpose }));
    const brandId = brief.brandId ?? project.request.brandId;
    const brand = brandId ? await getBrand(brandId) : null;
    const brandName = brand?.name ?? brief.productName ?? project.name;
    try {
      // The site read for this project, when the brief names that product URL (POST /v1/projects/:id/site).
      const host = (value: string) => { try { return new URL(/^https?:/i.test(value) ? value : `https://${value}`).hostname.replace(/^www\./, ""); } catch { return ""; } };
      const site = brief.productUrl && project.site && host(project.site.url) === host(brief.productUrl) ? project.site : undefined;
      const result = await director.plan(brief, { brandName, ...(brand?.description ? { brandDescription: brand.description } : {}), screenshots, ...(site ? { site: { url: site.url, title: site.title, description: site.description, facts: site.facts, text: site.text } } : {}) });
      const voiced = brief.audio.mode === "voiceover" || brief.audio.mode === "both";
      const music = brief.audio.mode === "music" || brief.audio.mode === "both";
      const updated = await updateProjectPlan(project.id, (current) => ({
        brief,
        beatPlan: result.plan,
        script: scriptFromPlan(result.plan, brief.scriptMode === "own" ? "provided" : "generated"),
        state: "Draft storyboard",
        // Keep the existing render request in step with the brief (format and audio) for the current pipeline.
        request: { ...current.request, format: aspectToFormat(brief.aspect), audio: { music, voiceover: voiced, voice: current.request.audio?.voice ?? "Kore" }, ...(brandId ? { brandId } : {}) }
      }));
      if (!updated) return reply.code(404).send(notFound);
      return reply.code(201).send({ project: updated, problems: result.problems, model: result.model });
    } catch (error) {
      if (error instanceof ProjectInvalid) return reply.code(400).send({ error: { code: "invalid_project", message: error.message } });
      app.log.warn({ err: error }, "script director failed");
      return reply.code(502).send({ error: { code: "director_failed", message: error instanceof Error ? error.message : "The script director failed." } });
    }
  });

  /** Storyboard edits: text, order, and accept/reject of suggestions. 422 with problems when an edit breaks the standards. */
  app.patch<{ Params: { id: string } }>("/v1/projects/:id/plan", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send(notFound);
    const patch = (request.body ?? {}) as PlanPatch;
    // The drawing style is visual only (colours and fonts stay the brand's), so it changes without replanning.
    if (patch.look !== undefined && !isLook(patch.look)) return reply.code(400).send({ error: { code: "invalid_look", message: "Unknown look." } });
    const result = applyPlanEdits(project, patch);
    if ("problems" in result) return reply.code(422).send({ error: { code: "plan_problems", message: result.problems[0] }, problems: result.problems });
    try {
      const updated = await updateProjectPlan(project.id, (current) => ({
        brief: current.brief && isLook(patch.look) ? withLook(current.brief, patch.look) : current.brief,
        beatPlan: result.plan,
        script: scriptFromPlan(result.plan, current.script?.source ?? "generated")
      }));
      return updated ?? reply.code(404).send(notFound);
    } catch (error) {
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
  app.post<{ Params: { id: string }; Body: { parts?: unknown } }>("/v1/projects/:id/plan/audio", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send(notFound);
    if (!project.beatPlan) return reply.code(409).send({ error: { code: "no_plan", message: "Generate the plan first." } });
    const raw = request.body?.parts;
    if (raw !== undefined && (!Array.isArray(raw) || raw.some((part) => part !== "voice" && part !== "music"))) {
      return reply.code(400).send({ error: { code: "invalid_parts", message: "parts must list \"voice\" and/or \"music\"." } });
    }
    try {
      const result = await producePlanAudio(project.id, () => getProject(project.id), raw as AudioPart[] | undefined);
      if (!result) return reply.code(404).send(notFound);
      const timing = projectTiming(result.project)!;
      return {
        project: result.project,
        audio: audioStatus(result.project),
        durationSeconds: timing.total,
        beatTimes: beatTimes(timing),
        warnings: [...result.warnings, ...timing.warnings],
        spent_usd: result.spentUsd
      };
    } catch (error) {
      if (error instanceof AudioUnavailable) return reply.code(503).send({ error: { code: "audio_unavailable", message: error.message } });
      app.log.warn({ err: error, projectId: project.id }, "plan audio failed");
      return reply.code(502).send({ error: { code: "audio_failed", message: error instanceof Error ? error.message : "The voiceover failed." } });
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
    return {
      engine: "beat-plan",
      baseUrl: `/v1/preview/plans/${project.id}`,
      canvas: project.beatPlan.canvas,
      // The composition's real length (the last beat's end; within ±10% of target_duration_s).
      durationSeconds: timing.total,
      variables: textValues(beats),
      // The plan clock (backend/src/plan/timing.ts): each beat's slot on the film, in seconds.
      beatTimes: Object.fromEntries(beats.map((beat) => [beat.id, times[beat.id]])),
      // The plan's sound: which lines have takes (the rest play silent on estimated timing) and the bed.
      audio: audioStatus(project),
      // What Submit needs: blocking items (each with the beat to fix) and non-blocking notes (readiness.ts).
      readiness: planReadiness(project),
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
      const html = await planPreviewHtml(project);
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
}
