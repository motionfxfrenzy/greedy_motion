import { randomUUID } from "node:crypto";
import type { RenderJob, RenderRequest, VideoProject } from "@videosaas/contracts";
import type { Job } from "pg-boss";
import { config } from "../config.ts";
import { AnthropicPromptPlanner } from "./anthropic-planner.ts";
import { DeterministicPromptPlanner, VIDEO_SECONDS, applyBrand, planFromValues, requireTemplate, type Plan, type PromptPlanner } from "./planner.ts";
import { renderJobRepository } from "./repository.ts";
import { getBrand } from "../brand/store.ts";
import { produceAudio, type WorkerAudio } from "../audio/produce.ts";
import { getProject, updateProject } from "../projects/store.ts";
import { boss, QUEUES, type RenderMessage } from "../jobs/queues.ts";
import { projectTiming } from "../plan/preview.ts";
import { beatTimes } from "../plan/timing.ts";

const planner: PromptPlanner = config.planner === "anthropic" ? new AnthropicPromptPlanner() : new DeterministicPromptPlanner();

const codeOf = (error: unknown, fallback: string) => (error as { code?: string }).code ?? fallback;
const messageOf = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

/**
 * Render pipeline, backend half. `create` persists a job and queues planning; the planning consumer
 * writes the storyboard and audio, then queues the render for the worker service. Completion and
 * dead-letter events update the project. Nothing here waits on a render, so any number of renders
 * can be in flight and the worker pool drains them at its own pace.
 */
export class RenderService {
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
   * Renders an approved storyboard exactly as previewed. `prepared` is the folder written by
   * prepareBeatPlanRender (composition, variables, fonts, shots, voice, music, SFX), so nothing is
   * planned or generated here: the job goes straight to the render queue.
   */
  async createBeatPlanRender(project: VideoProject, jobId: string, prepared: { workerDir: string; projectPrefix?: string; durationSeconds: number; canvas: string }, options: { motionBlur?: boolean } = {}) {
    const plan = project.beatPlan!;
    const timing = projectTiming(project);
    const times = timing ? beatTimes(timing) : {};
    const job: RenderJob = {
      id: jobId,
      state: "rendering",
      progress: 45,
      createdAt: new Date().toISOString(),
      revision: {
        id: randomUUID(),
        title: project.name,
        // Real beat lengths, so Review's timeline lines up with the film.
        scenes: plan.beats.map((beat) => ({ id: beat.id, label: beat.role === "cta" ? "CTA" : beat.role[0]!.toUpperCase() + beat.role.slice(1), detail: beat.keyword, duration: times[beat.id] ? times[beat.id]!.end - times[beat.id]!.start : prepared.durationSeconds / plan.beats.length })),
        ...(project.request.brandId ? { brandId: project.request.brandId } : {})
      }
    };
    return renderJobRepository.createReadyAndEnqueue(job, {
      request: project.request,
      projectId: project.id,
      // The worker's whole input: a prepared folder on the shared renders volume. No API keys, no planning.
      renderInput: { kind: "beat-plan", renderContractVersion: 1, id: jobId, workerDir: prepared.workerDir, ...(prepared.projectPrefix ? { projectPrefix: prepared.projectPrefix } : {}), durationSeconds: prepared.durationSeconds, canvas: prepared.canvas, ...(options.motionBlur ? { motionBlur: true } : {}) }
    });
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
    await boss.work<RenderMessage>(QUEUES.plan, { localConcurrency: config.planConcurrency }, async ([job]) => this.plan(job!));
    await boss.work<RenderMessage>(QUEUES.finished, { localConcurrency: 2 }, async ([job]) => this.syncProject(job!.data.jobId));
    await boss.work<RenderMessage>(QUEUES.planDead, async ([job]) => this.failForGood(job!.data.jobId, { code: "planning_failed", message: "We could not plan this video. Check the brief and brand kit, then render again." }, true));
    await boss.work<RenderMessage>(QUEUES.videoDead, async ([job]) => this.failForGood(job!.data.jobId, { code: "render_failed", message: `We could not render this video after ${config.renderRetries + 1} attempts. Render again; if it keeps failing, the worker log for this job has the details.` }, false));
  }

  /** Planning consumer: storyboard, audio, worker input. Throwing schedules a pg-boss retry. */
  private async plan(message: Job<RenderMessage>) {
    const id = message.data.jobId;
    const row = await renderJobRepository.beginPlanning(id);
    if (!row) return; // Already planned or finished; a duplicate delivery.
    try {
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
      const failure = { code: code === "audio_failed" ? code : "planning_failed", message: messageOf(error, "Planning failed.") };
      console.error(JSON.stringify({ level: "error", event: "render_planning_failed", jobId: id, ...failure }));
      await renderJobRepository.notePlanningError(id, failure);
      throw error;
    }
  }

  /** Dead-letter consumer: retries are exhausted, so the job fails and the project shows why. */
  private async failForGood(jobId: string, failure: { code: string; message: string }, keepRecorded: boolean) {
    const row = await renderJobRepository.failIfUnfinished(jobId, failure, keepRecorded);
    if (row) console.error(JSON.stringify({ level: "error", event: "render_job_failed", jobId, code: row.error?.code, message: row.error?.message }));
    await this.syncProject(jobId);
  }

  /** Mirrors a finished job onto its project, unless the project has since moved to a newer render. */
  private async syncProject(jobId: string) {
    const row = await renderJobRepository.row(jobId);
    if (!row?.project_id || (row.state !== "ready" && row.state !== "failed")) return;
    const project = await getProject(row.project_id);
    if (!project || project.renderJobId !== jobId) return;
    await updateProject(project.id, { state: row.state === "ready" ? "Ready for review" : "Render needs attention", renderJobId: jobId });
  }
}

export const renderService = new RenderService();
