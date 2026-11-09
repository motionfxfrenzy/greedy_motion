import { randomUUID } from "node:crypto";
import type { RenderJob, RenderRequest, VideoProject } from "@videosaas/contracts";
import type { Job } from "pg-boss";
import { config } from "../config.ts";
import { buildExport, requestExport, waitForAuthoring, type ExportRow } from "../plates/exports.ts";
import { wantedAspects } from "../plates/inputs.ts";
import { primaryAspect, type Aspect, type PlateComment } from "../plates/model.ts";
import { fixPlates, isPlateLook, startPlates } from "../plates/service.ts";
import { readProjectState } from "../plates/store.ts";
import { AnthropicPromptPlanner } from "./anthropic-planner.ts";
import { DeterministicPromptPlanner, VIDEO_SECONDS, applyBrand, planFromValues, requireTemplate, type Plan, type PromptPlanner } from "./planner.ts";
import { renderJobRepository, type FilmPrep, type StoredRenderJob } from "./repository.ts";
import { NotReady, prepareBeatPlanRender } from "../plan/readiness.ts";
import { refundSpend } from "../tokens/store.ts";
import { getBrand } from "../brand/store.ts";
import { produceAudio, type WorkerAudio } from "../audio/produce.ts";
import { getProject, updateProject } from "../projects/store.ts";
import { boss, PLAN_RETRY_DELAY_SECONDS, POLL, QUEUES, type RenderMessage } from "../jobs/queues.ts";
import { renderEvents } from "./events.ts";
import { projectTiming } from "../plan/preview.ts";
import { beatTimes } from "../plan/timing.ts";

const planner: PromptPlanner = config.planner === "anthropic" ? new AnthropicPromptPlanner() : new DeterministicPromptPlanner();

const codeOf = (error: unknown, fallback: string) => (error as { code?: string }).code ?? fallback;
const messageOf = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export const PLATE_AUTHOR_TIMEOUT_MS = 10 * 60_000;

export type CompanionPrepOutcome =
  | { state: ExportRow["state"]; id: string; manifestKey: string }
  | { state: "failed"; code: string; message: string };

export type PrepareFilmDeps = {
  getProject?: typeof getProject;
  updateProject?: typeof updateProject;
  isPlateLook?: typeof isPlateLook;
  startPlates?: typeof startPlates;
  readProjectState?: typeof readProjectState;
  fixPlates?: typeof fixPlates;
  waitForAuthoring?: typeof waitForAuthoring;
  buildExport?: typeof buildExport;
  requestExport?: typeof requestExport;
  prepareBeatPlanRender?: typeof prepareBeatPlanRender;
  refundSpend?: typeof refundSpend;
  repository?: Pick<typeof renderJobRepository, "updatePlanning" | "queueRender" | "failIfUnfinished" | "row">;
  now?: () => number;
  authorTimeoutMs?: number;
  log?: (entry: Record<string, unknown>) => void;
};

type ResolvedPrepareFilmDeps = Required<PrepareFilmDeps>;

const defaultLog = (entry: Record<string, unknown>) => {
  const line = JSON.stringify(entry);
  if (entry.level === "error") console.error(line);
  else console.log(line);
};

const defaultPrepareFilmDeps: ResolvedPrepareFilmDeps = {
  getProject,
  updateProject,
  isPlateLook,
  startPlates,
  readProjectState,
  fixPlates,
  waitForAuthoring,
  buildExport,
  requestExport,
  prepareBeatPlanRender,
  refundSpend,
  repository: renderJobRepository,
  now: () => Date.now(),
  authorTimeoutMs: PLATE_AUTHOR_TIMEOUT_MS,
  log: defaultLog
};

/** A storyboard film's job view: its beats with real lengths, so Review's timeline lines up with the film. */
function beatPlanRevision(project: VideoProject, durationSeconds: number): RenderJob["revision"] {
  const plan = project.beatPlan!;
  const timing = projectTiming(project);
  const times = timing ? beatTimes(timing) : {};
  return {
    id: randomUUID(),
    title: project.name,
    scenes: plan.beats.map((beat) => ({ id: beat.id, label: beat.role === "cta" ? "CTA" : beat.role[0]!.toUpperCase() + beat.role.slice(1), detail: beat.keyword, duration: times[beat.id] ? times[beat.id]!.end - times[beat.id]!.start : durationSeconds / plan.beats.length })),
    ...(project.request.brandId ? { brandId: project.request.brandId } : {}),
    look: project.brief?.look ?? "clean"
  };
}

/**
 * Render pipeline, backend half. `create` persists a job and queues planning; the planning consumer
 * writes the storyboard and audio, then queues the render for the worker service. Completion and
 * dead-letter events update the project. Nothing here waits on a render, so any number of renders
 * can be in flight and the worker pool drains them at its own pace.
 */
export class RenderService {
  private readonly deps: ResolvedPrepareFilmDeps;

  constructor(deps: PrepareFilmDeps = {}) {
    this.deps = { ...defaultPrepareFilmDeps, ...deps };
  }

  /** Pass `id` when the caller must record the job id (e.g. on the project) before the job can finish. */
  async create(request: RenderRequest, options: { projectId?: string; ownerId?: string; plannedRevision?: Plan; id?: string } = {}) {
    const { projectId, ownerId, plannedRevision } = options;
    const job: RenderJob = {
      id: options.id ?? randomUUID(),
      state: "queued",
      progress: 0,
      createdAt: new Date().toISOString(),
      revision: { id: randomUUID(), title: "Planning your product story…", scenes: [] }
    };
    return renderJobRepository.createAndEnqueue(job, { request, ...(projectId ? { projectId } : {}), ...(ownerId ? { ownerId } : {}), ...(plannedRevision ? { plannedRevision } : {}) });
  }

  /**
   * Renders an approved storyboard exactly as previewed. The request returns at once: the planning consumer
   * directs the motion, builds the composition (prepareBeatPlanRender) and hands it to the render queue, and
   * every step reaches the page as a job event. Nothing is planned or generated beyond what the storyboard holds.
   */
  async createBeatPlanRender(project: VideoProject, jobId: string, prep: Omit<FilmPrep, "kind">, durationSeconds: number, options?: { idempotencyKey?: string }) {
    const job: RenderJob = { id: jobId, state: "queued", progress: 0, createdAt: new Date().toISOString(), revision: beatPlanRevision(project, durationSeconds) };
    return renderJobRepository.createAndEnqueue(job, {
      request: project.request,
      projectId: project.id,
      ownerId: prep.ownerId,
      prep: { kind: "beat-plan", ...prep },
      ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {})
    });
  }

  /** The storyboard half of the planning consumer: motion, composition and upload, then the render queue. */
  async prepareFilm(id: string, row: StoredRenderJob, prep: FilmPrep, overrides: PrepareFilmDeps = {}) {
    const d: ResolvedPrepareFilmDeps = { ...this.deps, ...overrides };
    const project = row.project_id ? await d.getProject(row.project_id) : null;
    if (!project?.beatPlan) {
      await this.failForGood(id, { code: "planning_failed", message: "This project no longer has a storyboard. Open it and render again." }, false, d);
      return;
    }
    if (d.isPlateLook(project.brief?.look)) {
      // Code-drawn plate scenes: apply any pending comments once, wait for any in-flight authoring across chosen ratios,
      // freeze the schema 2 export manifests under content-addressed keys in object storage, and hand the job to the render
      // worker, which verifies every scene bundle, draws any missing clips itself (or reuses cached clips from app.plate_clips),
      // and assembles the film.
      await d.repository.updatePlanning(id, { stage: "directing", progress: 25 });
      const companions: Partial<Record<Aspect, CompanionPrepOutcome>> = {};
      try {
        const aspect = primaryAspect(project);
        await d.startPlates(project.id);
        const state = await d.readProjectState(project.id);
        const pendingComments = (state.comments as (PlateComment & { fixing?: number })[]).filter((c) => c.fixing === undefined);
        if (pendingComments.length > 0) {
          try {
            await d.fixPlates(project.id);
            const scenes = [...new Set(pendingComments.map((c) => c.scene))].sort((a, b) => a - b);
            d.log({ level: "info", event: "render_applied_comments", projectId: project.id, scenes });
          } catch (error) {
            if (!(error instanceof Error && error.message === "Add a comment first.")) throw error;
          }
        }
        const aspects = [...new Set(wantedAspects(project, [...(project.brief?.aspects ?? []), ...(state.subtitles?.aspects ?? [])]))];
        const expectedScenes = (project.brief?.scriptBeats ?? []).length;
        const effectiveAuthorTimeoutMs = Math.max(d.authorTimeoutMs, expectedScenes * 45_000);
        const deadline = d.now() + effectiveAuthorTimeoutMs;
        const remainingTimeoutMs = () => Math.max(0, deadline - d.now());

        await d.waitForAuthoring(project.id, aspect, {
          timeoutMs: remainingTimeoutMs(),
          expectedScenes,
          onProgress: ({ done, total }) =>
            d.repository.updatePlanning(id, {
              stage: "directing",
              progress: 25 + Math.round((done / Math.max(1, total)) * 15)
            })
        });
        const built = await d.buildExport(project, aspect, prep.watermark);

        for (const ratio of aspects) {
          if (ratio === aspect) continue;
          try {
            await d.waitForAuthoring(project.id, ratio, {
              timeoutMs: remainingTimeoutMs(),
              expectedScenes
            });
            const exp = await d.requestExport(project, ratio, prep.watermark);
            companions[ratio] = { state: exp.state, id: exp.id, manifestKey: exp.manifest_key };
          } catch (companionError) {
            const failure = {
              code: codeOf(companionError, "render_failed"),
              message: messageOf(companionError, "Could not prepare this ratio.")
            };
            companions[ratio] = { state: "failed", ...failure };
            d.log({ level: "error", event: "render_companion_ratio_failed", jobId: id, projectId: project.id, aspect: ratio, ...failure });
          }
        }

        const renderInput = {
          kind: "plate-film",
          renderContractVersion: 1,
          manifestSchema: 2,
          id,
          projectId: project.id,
          aspect,
          manifestKey: built.manifestKey,
          manifestDigest: built.manifestDigest,
          durationSeconds: built.durationSeconds
        };
        await d.repository.queueRender(id, { ...beatPlanRevision(project, built.durationSeconds), id: row.revision.id }, renderInput);
        return { aspect, companions };
      } catch (error) {
        await this.failForGood(
          id,
          { code: codeOf(error, "render_failed"), message: messageOf(error, "Could not start the final video.") },
          false,
          d
        );
        return { aspect: primaryAspect(project), failed: true as const, companions };
      }
    }
    await d.repository.updatePlanning(id, { stage: "directing", progress: 25 });
    let prepared: Awaited<ReturnType<typeof prepareBeatPlanRender>>;
    try {
      prepared = await d.prepareBeatPlanRender(project, id, { watermark: prep.watermark });
    } catch (error) {
      // The storyboard changed after Render and no longer passes its checks: retrying cannot help.
      if (error instanceof NotReady) { await this.failForGood(id, { code: "not_ready", message: error.message }, false, d); return; }
      throw error;
    }
    // The worker's whole input: a prepared folder on the shared renders volume (or its R2 prefix). No API keys, no planning.
    const renderInput = { kind: "beat-plan", renderContractVersion: 1, id, workerDir: prepared.workerDir, ...(prepared.projectPrefix ? { projectPrefix: prepared.projectPrefix } : {}), durationSeconds: prepared.durationSeconds, canvas: prepared.canvas, ...(prep.motionBlur ? { motionBlur: true } : {}) };
    await d.repository.queueRender(id, { ...beatPlanRevision(project, prepared.durationSeconds), id: row.revision.id }, renderInput);
  }

  async draftScript(request: RenderRequest) {
    const brand = request.brandId ? await getBrand(request.brandId) : null;
    if (request.brandId && !brand) throw new Error("That brand kit no longer exists.");
    let plan = await planner.plan(request, brand ?? undefined);
    if (brand) plan = applyBrand(plan, brand);
    return plan.scenes.map((scene) => ({
      label: scene.label,
      onScreen: scene.detail,
      ...(request.audio?.voiceover ? { voiceover: scene.detail } : {})
    }));
  }

  /**
   * The first render seeds a Studio draft with the same planner result that it
   * queues. Later Studio renders never call the planner again: the persisted
   * template values are the render source of truth.
   */
  async planInitialStudio(project: VideoProject): Promise<Plan> {
    const brand = project.request.brandId ? await getBrand(project.request.brandId) : null;
    if (project.request.brandId && !brand) throw new Error("That brand kit no longer exists.");
    let plan = await planner.plan(project.request, brand ?? undefined);
    if (brand) plan = applyBrand(plan, brand);
    return plan;
  }

  /** Rebuilds a renderable plan from a saved Studio revision without re-prompting AI. */
  async planStudio(project: VideoProject): Promise<Plan> {
    if (!project.studio) throw new Error("Save the Studio draft before rendering it.");
    const template = requireTemplate(project.request.template);
    const brand = project.request.brandId ? await getBrand(project.request.brandId) : null;
    if (project.request.brandId && !brand) throw new Error("That brand kit no longer exists.");
    let plan = planFromValues(template, project.studio.values);
    if (brand) plan = applyBrand(plan, brand);

    // Audio is derived from the saved copy as well. It is deliberately bounded
    // so editing variables cannot create an unrenderable TTS request.
    const narration = project.request.audio?.voiceover
      ? plan.scenes.map((scene) => scene.detail.split(" · ")[0]).filter(Boolean).join(". ").slice(0, 180)
      : undefined;
    const musicPrompt = project.request.audio?.music
      ? `${project.request.style === "kinetic" ? "Driving, energetic" : project.request.style === "editorial" ? "Warm, textured" : "Bright, modern"} instrumental tech background, light percussion`
      : undefined;
    return { ...plan, ...(narration ? { narration } : {}), ...(musicPrompt ? { musicPrompt } : {}) };
  }

  /** Plans an actual revision from the persisted script and its review comments. */
  async reviseForComments(project: VideoProject) {
    if (!project.script?.confirmed) throw new Error("Confirm the project script before applying review comments.");
    if (project.comments.length === 0) throw new Error("Add at least one review comment before applying changes.");
    const brand = project.request.brandId ? await getBrand(project.request.brandId) : null;
    if (project.request.brandId && !brand) throw new Error("That brand kit no longer exists.");
    let plan = await planner.plan(project.request, brand ?? undefined, { script: project.script, comments: project.comments });
    if (brand) plan = applyBrand(plan, brand);
    return {
      plan,
      request: { ...project.request, style: plan.motionStyle ?? project.request.style },
      lines: plan.scenes.map((scene) => ({ label: scene.label, onScreen: scene.detail, ...(project.request.audio?.voiceover ? { voiceover: scene.detail } : {}) }))
    };
  }

  get(id: string) {
    return renderJobRepository.find(id);
  }

  /** Registers this replica's consumers. Safe to run on every backend replica. */
  async startConsumers() {
    this.workers.plan = await boss.work<RenderMessage>(QUEUES.plan, { localConcurrency: config.planConcurrency, pollingIntervalSeconds: POLL.live }, async ([job]) => this.plan(job!));
    await boss.work<RenderMessage>(QUEUES.finished, { localConcurrency: 2, pollingIntervalSeconds: POLL.live }, async ([job]) => this.syncProject(job!.data.jobId));
    this.workers.planDead = await boss.work<RenderMessage>(QUEUES.planDead, { pollingIntervalSeconds: POLL.dead }, async ([job]) => this.failForGood(job!.data.jobId, { code: "planning_failed", message: "We could not plan this video. Check the brief and brand kit, then render again." }, true));
    this.workers.videoDead = await boss.work<RenderMessage>(QUEUES.videoDead, { pollingIntervalSeconds: POLL.dead }, async ([job]) => this.failForGood(job!.data.jobId, { code: "render_failed", message: `We could not render this video after ${config.renderRetries + 1} attempts. Render again; if it keeps failing, the worker log for this job has the details.` }, false));
    // A failed render attempt (the worker records stage `retrying`) may have been the last: look for its dead letter now.
    renderEvents.observe((notice) => { if (notice.stage === "retrying") { this.wake(this.workers.videoDead, 1500); this.wake(this.workers.videoDead, 6000); } });
  }

  private workers: { plan?: string; planDead?: string; videoDead?: string } = {};

  /**
   * Queue consumers sleep between notifications (pg-boss polls only as a 30 s backstop). A new job wakes them, but a retry
   * coming due or a dead letter does not, so the code that caused one wakes the consumer itself: one fetch, at the right time.
   */
  private wake(workerId: string | undefined, afterMs: number) {
    if (workerId) setTimeout(() => boss.notifyWorker(workerId), afterMs).unref();
  }

  /** Planning consumer: storyboard, audio, worker input. Throwing schedules a pg-boss retry. */
  private async plan(message: Job<RenderMessage>) {
    const id = message.data.jobId;
    const row = await renderJobRepository.beginPlanning(id);
    if (!row) return; // Already planned or finished; a duplicate delivery.
    try {
      if (row.prep?.kind === "beat-plan") return await this.prepareFilm(id, row, row.prep);
      const request = row.request;
      const brand = request.brandId ? await getBrand(request.brandId) : null;
      if (request.brandId && !brand) throw Object.assign(new Error("That brand kit no longer exists. Choose another kit and render again."), { code: "planning_failed" });
      let plan = row.planned_revision;
      if (!plan) {
        try {
          plan = await planner.plan(request, brand ?? undefined);
        } catch (error) {
          throw Object.assign(error instanceof Error ? error : new Error("Planning failed."), { code: "planning_failed" });
        }
        if (brand) plan = applyBrand(plan, brand);
      }
      let revision: RenderJob["revision"] = { id: row.revision.id, title: plan.title, scenes: plan.scenes, template: plan.template, values: plan.values, planner: planner.info, ...(brand ? { brandId: brand.id } : {}) };
      await renderJobRepository.updatePlanning(id, { stage: "planning", progress: 30, revision });

      let workerAudio: WorkerAudio | undefined;
      if (request.audio && (request.audio.music || request.audio.voiceover)) {
        await renderJobRepository.updatePlanning(id, { stage: "audio", progress: 35 });
        try {
          const audio = await produceAudio(id, request.audio, plan, request.style);
          workerAudio = audio.worker;
          revision = { ...revision, audio: audio.result };
        } catch (error) {
          throw Object.assign(error instanceof Error ? error : new Error("Audio generation failed."), { code: "audio_failed" });
        }
      }

      const project = row.project_id ? await getProject(row.project_id) : null;
      const selectedScreenshotId = project?.studio?.assets.screenshot;
      const screenshotId = selectedScreenshotId && project?.screenshots.some((screenshot) => screenshot.id === selectedScreenshotId)
        ? selectedScreenshotId
        : project?.screenshots[0]?.id;
      const screenshot = row.project_id && screenshotId ? { projectId: row.project_id, screenshotId } : undefined;
      // The worker's whole input. It holds ids and copy only; the worker never sees API keys.
      const renderInput = {
        id,
        template: plan.template,
        theme: request.theme,
        variables: plan.values ?? {},
        durationSeconds: VIDEO_SECONDS,
        ...(brand ? { brandId: brand.id } : {}),
        ...(workerAudio ? { audio: workerAudio } : {}),
        ...(screenshot ? { screenshot } : {})
      };
      await renderJobRepository.queueRender(id, revision, renderInput);
    } catch (error) {
      const code = codeOf(error, "planning_failed");
      const failure = { code: code === "audio_failed" ? code : "planning_failed", message: row.prep ? "We could not prepare this film. Your tokens were returned; try again." : messageOf(error, "Planning failed.") };
      console.error(JSON.stringify({ level: "error", event: "render_planning_failed", jobId: id, ...failure }));
      await renderJobRepository.notePlanningError(id, failure);
      // pg-boss retries after the queue's retryDelay, or moves the job to the dead letter queue once retries run out.
      this.wake(this.workers.plan, PLAN_RETRY_DELAY_SECONDS * 1000 + 500);
      this.wake(this.workers.planDead, 1000);
      throw error;
    }
  }

  /** Dead-letter consumer and terminal failure handler: retries are exhausted or pre-draw failed, so the job fails and tokens are refunded. */
  private async failForGood(jobId: string, failure: { code: string; message: string }, keepRecorded: boolean, deps?: ResolvedPrepareFilmDeps) {
    const d = deps ?? this.deps;
    const row = await d.repository.failIfUnfinished(jobId, failure, keepRecorded);
    if (row) d.log({ level: "error", event: "render_job_failed", jobId, code: row.error?.code, message: row.error?.message });
    const target = row ?? (await d.repository.row(jobId));
    const effectiveCode = target?.error?.code ?? failure.code;
    let refunded = false;
    if (target?.prep?.spendEvent && target?.prep?.ownerId && effectiveCode !== "cancelled") {
      refunded = true;
      await d.refundSpend(target.prep.ownerId, target.prep.spendEvent).catch((error) =>
        d.log({ level: "error", event: "render_refund_failed", jobId, message: error instanceof Error ? error.message : String(error) })
      );
    }
    await this.syncProject(jobId, d, refunded);
  }

  /** Mirrors a finished job onto its project, unless the project has since moved to a newer render. */
  private async syncProject(jobId: string, deps?: ResolvedPrepareFilmDeps, alreadyRefunded = false) {
    const d = deps ?? this.deps;
    const row = await d.repository.row(jobId);
    if (!row || (row.state !== "ready" && row.state !== "failed")) return;
    if (!alreadyRefunded && row.state === "failed" && row.prep?.spendEvent && row.prep?.ownerId && row.error?.code !== "cancelled") {
      await d.refundSpend(row.prep.ownerId, row.prep.spendEvent).catch((error) =>
        d.log({ level: "error", event: "render_refund_failed", jobId, message: error instanceof Error ? error.message : String(error) })
      );
    }
    if (!row.project_id) return;
    const project = await d.getProject(row.project_id);
    if (!project || project.renderJobId !== jobId) return;
    await d.updateProject(project.id, { state: row.state === "ready" ? "Ready for review" : "Render needs attention", renderJobId: jobId });
  }
}

export const renderService = new RenderService();
