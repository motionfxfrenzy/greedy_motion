import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  PAINTED_SCRIPT_MAX,
  PAINTED_SCRIPT_MIN,
  paintedDrawModes,
  paintedLookById,
  paintedLooks,
  paintedSeconds,
  renderCostMillitokens,
  voiceIds,
  type PaintedDrawMode,
  type PaintedProject,
  type ProjectScript,
  type ProjectState,
  type RenderJob,
  type VideoProject
} from "@videosaas/contracts";
import { callerId } from "../auth.ts";
import { config } from "../config.ts";
import { pool } from "../db/database.ts";
import { QUEUES } from "../jobs/queues.ts";
import { ensureMedia, readMedia } from "../media.ts";
import { getProject, savePaintedProject, updateProjectPainted } from "../projects/store.ts";
import { renderJobRepository } from "../render/repository.ts";
import { InsufficientTokens, refundSpend, spendTokens } from "../tokens/store.ts";
import {
  applyLookToSpec,
  applyPaintedSceneChanges,
  buildPaintedTimeline,
  generatePaintedStoryboard,
  getPaintedRuntimeJs,
  hydrateFromWorkerArchive,
  packPaintedWorkForWorker,
  paintedWorkDir,
  producePaintedAnimation
} from "./engine.ts";

const fail = (code: string, message: string, extra: object = {}) => ({ error: { code, message, ...extra } });
const MAX_ACTIVE = 2;
const MAX_COMMENTS = 5;
const COMMENT_MILLITOKENS = 1000;

const lookAvailable = (id: string) => {
  const look = paintedLookById(id);
  return Boolean(look) && (look!.engine === "doodle" || config.painted.oil);
};

const lookMedium = (id: string) => id.split(":")[1] ?? "marker";

type FilmRow = {
  id: string;
  project_id: string | null;
  state: RenderJob["state"];
  stage: string;
  progress: number;
  created_at: Date;
  request: { kind?: string; look?: string; script?: string; drawIn?: string; baseJobId?: string };
  output: { lines?: string[]; durationSeconds?: number } | null;
  error: { message?: string } | null;
};

const view = (row: FilmRow) => ({
  id: row.id,
  projectId: row.project_id ?? undefined,
  state: row.state,
  stage: row.stage,
  progress: row.progress,
  createdAt: row.created_at.toISOString(),
  look: row.request.look ?? "",
  script: row.request.script ?? "",
  drawIn: row.request.drawIn ?? "opening",
  ...(row.request.baseJobId ? { changedFrom: row.request.baseJobId } : {}),
  ...(row.output ? { durationSeconds: row.output.durationSeconds ?? null, lines: row.output.lines ?? [] } : {}),
  ...(row.error ? { error: row.error.message ?? "The film could not be made." } : {})
});

const FILM_COLUMNS = "id, project_id, state, stage, progress, created_at, request, output, error";

async function ownFilm(id: string, owner: string): Promise<FilmRow | null> {
  const result = await pool.query<FilmRow>(
    `select ${FILM_COLUMNS} from app.render_jobs where id = $1 and owner_id = $2 and request->>'kind' = 'painted'`,
    [id, owner]
  );
  return result.rows[0] ?? null;
}

function projectNameFrom(text: string, lookId: string): string {
  const first = text.trim().split(/[\n.!?]/)[0]?.trim() ?? "";
  if (first.length >= 3) return first.slice(0, 72);
  const look = paintedLookById(lookId);
  return look ? `${look.name} story film` : "Story film";
}

function scriptFromPainted(lines: { say: string; scene?: string }[], mode: "idea" | "script"): ProjectScript {
  return {
    source: mode === "idea" ? "generated" : "provided",
    lines: lines.slice(0, 12).map((line, index) => ({
      label: `Scene ${index + 1}`,
      onScreen: line.say.slice(0, 180) || `Scene ${index + 1}`,
      voiceover: line.say.slice(0, 240),
      ...(line.scene ? { visual: line.scene.slice(0, 240) } : {})
    })),
    confirmed: true,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Adopts any standalone `app.render_jobs` painted rows (`project_id is null`) into `app.projects`
 * so all Story films created earlier also appear in the Projects workspace (`/studio`).
 */
async function adoptLegacyPaintedFilms(ownerId: string) {
  const { rows } = await pool.query<FilmRow>(
    `select ${FILM_COLUMNS} from app.render_jobs where owner_id = $1 and request->>'kind' = 'painted' and project_id is null order by created_at desc limit 30`,
    [ownerId]
  );
  for (const row of rows) {
    const projectId = row.id;
    const existing = await getProject(projectId);
    if (!existing) {
      const lookId = row.request.look || "doodle:marker";
      const scriptText = row.request.script || (row.output?.lines ?? []).join("\n") || "Story film";
      const drawIn: PaintedDrawMode = row.request.drawIn === "each" ? "each" : "opening";
      const lines = (row.output?.lines?.length ? row.output.lines : scriptText.split(/\n+/).filter(Boolean)).map((say) => ({
        say,
        shots: [{ place: "meadow", time: "day" }]
      }));
      const state: ProjectState =
        row.state === "ready" ? "Ready for review" : row.state === "failed" ? "Render needs attention" : "Rendering draft";
      const createdAt = row.created_at.toISOString();
      const spec = applyLookToSpec({ lines }, lookId, drawIn, "9:16");
      const timeline = buildPaintedTimeline(spec);
      const painted: PaintedProject = {
        look: lookId,
        drawIn,
        aspect: "9:16",
        voice: "Charon",
        mode: "script",
        script: scriptText,
        spec,
        timeline
      };
      const project: VideoProject = {
        id: projectId,
        ownerId,
        name: projectNameFrom(scriptText, lookId),
        state,
        createdAt,
        updatedAt: createdAt,
        request: {
          prompt: scriptText.slice(0, 600).padEnd(12, "."),
          format: "portrait",
          style: "clean",
          theme: "neutral",
          template: "product-launch",
          audio: { music: true, voiceover: true, voice: "Charon" }
        },
        script: scriptFromPainted(lines, "script"),
        screenshots: [],
        comments: [],
        renderJobId: row.id,
        coverFrame: `/painted/${lookMedium(lookId)}.jpg`,
        filmSeconds: row.output?.durationSeconds ?? Math.round(timeline.duration),
        painted
      };
      await savePaintedProject(project);
    }
    await pool.query("update app.render_jobs set project_id = $1 where id = $2 and project_id is null", [projectId, row.id]);
  }
}

function sendAudioRange(request: FastifyRequest, reply: FastifyReply, bytes: Buffer, type: string) {
  reply
    .header("Content-Type", type)
    .header("Accept-Ranges", "bytes")
    .header("Cache-Control", "private, no-cache")
    .header("X-Content-Type-Options", "nosniff");
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(request.headers.range ?? ""));
  if (!range || (!range[1] && !range[2])) return reply.header("Content-Length", bytes.length).send(bytes);
  const start = range[1] ? Number(range[1]) : Math.max(0, bytes.length - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
  if (start >= bytes.length || start > end) return reply.code(416).header("Content-Range", `bytes */${bytes.length}`).send();
  return reply
    .code(206)
    .header("Content-Range", `bytes ${start}-${end}/${bytes.length}`)
    .header("Content-Length", end - start + 1)
    .send(bytes.subarray(start, end + 1));
}

export async function registerPaintedRoutes(app: FastifyInstance) {
  // Ensure legacy painted jobs appear in /v1/projects whenever a user loads their projects list.
  app.addHook("preHandler", async (request) => {
    if (request.method === "GET" && request.url.split("?")[0] === "/v1/projects") {
      await adoptLegacyPaintedFilms(callerId(request)).catch((err) => request.log.warn({ err }, "could not adopt legacy painted films"));
    }
  });

  /** Concatenated browser runtime (`kit.js`..`stage.js`) for drawing storyboard frames and playing in-browser animation. */
  app.get("/v1/preview/painted-runtime.js", async (_request, reply) => {
    const js = await getPaintedRuntimeJs();
    return reply
      .header("Content-Type", "application/javascript; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .header("X-Content-Type-Options", "nosniff")
      .send(js);
  });

  /** Streams the mixed animation audio (`audio.m4a`) for the in-browser Animation step (`?t=<mediaToken>`). */
  app.get<{ Params: { id: string } }>("/v1/preview/projects/:id/painted-audio", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project?.painted) return reply.code(404).send(fail("not_found", "Audio not found."));
    const bytes = await readMedia(join(paintedWorkDir(project.id), "audio.m4a"));
    if (!bytes) return reply.code(404).send(fail("not_found", "Animation audio has not been built yet."));
    return sendAudioRange(request, reply, bytes, "audio/mp4");
  });

  /** The looks the picker shows, and whether this deployment can draw each one. */
  app.get("/v1/painted/looks", async (_request, reply) =>
    reply.header("Cache-Control", "public, max-age=60").send({
      looks: paintedLooks.map((look) => ({
        id: look.id,
        engine: look.engine,
        name: look.name,
        blurb: look.blurb,
        script: look.script,
        available: lookAvailable(look.id)
      })),
      scriptMin: PAINTED_SCRIPT_MIN,
      scriptMax: PAINTED_SCRIPT_MAX
    })
  );

  app.get("/v1/painted/films", async (request) => {
    const owner = callerId(request);
    await adoptLegacyPaintedFilms(owner).catch(() => undefined);
    const result = await pool.query<FilmRow>(
      `select ${FILM_COLUMNS} from app.render_jobs where owner_id = $1 and request->>'kind' = 'painted' order by created_at desc limit 30`,
      [owner]
    );
    return { films: result.rows.map(view) };
  });

  app.get<{ Params: { id: string } }>("/v1/painted/films/:id", async (request, reply) => {
    if (!/^[0-9a-f-]{36}$/i.test(request.params.id)) return reply.code(404).send(fail("not_found", "Film not found."));
    const row = await ownFilm(request.params.id, callerId(request));
    return row ? view(row) : reply.code(404).send(fail("not_found", "Film not found."));
  });

  /**
   * Step 1 -> Step 2: Creates (or updates) a Story film project and generates its Storyboard (`spec` + `timeline`).
   * Runs asynchronously on the backend while updating `project.painted.busy` stages (`writing` -> `directing` -> `objects`).
   */
  app.post<{
    Body: {
      projectId?: unknown;
      mode?: unknown;
      text?: unknown;
      script?: unknown;
      look?: unknown;
      drawIn?: unknown;
      aspect?: unknown;
      voice?: unknown;
      musicMood?: unknown;
      forceRegenerate?: unknown;
    };
  }>("/v1/painted/projects", async (request, reply) => {
    const body = request.body ?? {};
    const mode: "idea" | "script" = body.mode === "idea" ? "idea" : "script";
    const rawText = typeof body.text === "string" ? body.text : typeof body.script === "string" ? body.script : "";
    const text = rawText.replace(/\r/g, "").trim();
    if (text.length < PAINTED_SCRIPT_MIN || text.length > PAINTED_SCRIPT_MAX) {
      return reply.code(400).send(fail("invalid_request", `Write between ${PAINTED_SCRIPT_MIN} and ${PAINTED_SCRIPT_MAX} characters.`));
    }
    const look = typeof body.look === "string" ? paintedLookById(body.look) : undefined;
    if (!look) return reply.code(400).send(fail("invalid_request", "Choose one of the looks."));
    if (!lookAvailable(look.id)) return reply.code(409).send(fail("look_unavailable", `${look.name} is not available yet.`));
    const drawIn: PaintedDrawMode = paintedDrawModes.includes(body.drawIn as PaintedDrawMode) ? (body.drawIn as PaintedDrawMode) : "opening";
    const aspect: "9:16" | "16:9" = body.aspect === "16:9" ? "16:9" : "9:16";
    const voice = typeof body.voice === "string" && voiceIds.includes(body.voice) ? body.voice : "Charon";
    const musicMood = typeof body.musicMood === "string" ? body.musicMood.trim().slice(0, 80) : undefined;
    const forceRegenerate = body.forceRegenerate === true;

    const owner = callerId(request);
    const existingId = typeof body.projectId === "string" && /^[0-9a-f-]{36}$/i.test(body.projectId) ? body.projectId : null;
    const existing = existingId ? await getProject(existingId) : null;
    if (existing && existing.ownerId !== owner) return reply.code(404).send(fail("not_found", "Project not found."));

    // If the project already has a storyboard/animation for the same script and the user didn't ask to regenerate from scratch,
    // keep the existing storyboard and animation and only update look/aspect/drawIn!
    if (
      existing?.painted?.spec?.lines?.length &&
      !forceRegenerate &&
      ((mode === "script" && existing.painted.script.trim() === text) || (mode === "idea" && existing.painted.idea?.trim() === text))
    ) {
      const updatedSpec = applyLookToSpec(existing.painted.spec, look.id, drawIn, aspect);
      const updatedTimeline = buildPaintedTimeline(updatedSpec);
      const voiceChanged = voice !== existing.painted.voice;
      const kept = await updateProjectPainted(existing.id, (current) => ({
        request: {
          ...current.request,
          format: aspect === "16:9" ? "landscape" : "portrait",
          audio: { music: true, voiceover: true, voice }
        },
        painted: {
          ...current.painted!,
          look: look.id,
          drawIn,
          aspect,
          voice,
          ...(musicMood !== undefined ? { musicMood: musicMood || undefined } : {}),
          spec: updatedSpec,
          timeline: updatedTimeline,
          ...(voiceChanged ? { audioVersion: undefined } : {}),
          busy: null
        }
      }));
      return reply.code(200).send({ project: kept ?? existing });
    }

    const now = new Date().toISOString();
    const projectId = existing?.id ?? randomUUID();
    const busy = {
      status: "running" as const,
      phase: "storyboard" as const,
      stage: mode === "idea" ? "writing" : "directing",
      startedAt: now
    };
    const painted: PaintedProject = {
      look: look.id,
      drawIn,
      aspect,
      voice,
      ...(musicMood ? { musicMood } : {}),
      mode,
      ...(mode === "idea" ? { idea: text } : {}),
      script: mode === "script" ? text : existing?.painted?.script ?? "",
      busy
    };

    const baseRequest = {
      prompt: text.slice(0, 600).padEnd(12, "."),
      format: (aspect === "16:9" ? "landscape" : "portrait") as "landscape" | "portrait",
      style: "clean" as const,
      theme: "neutral",
      template: "product-launch",
      audio: { music: true, voiceover: true, voice }
    };

    const saved = existing
      ? (await updateProjectPainted(projectId, () => ({
          name: projectNameFrom(text, look.id),
          state: "Draft storyboard",
          request: baseRequest,
          coverFrame: existing.coverFrame ?? `/painted/${look.medium}.jpg`,
          painted
        })))!
      : await savePaintedProject({
          id: projectId,
          ownerId: owner,
          name: projectNameFrom(text, look.id),
          state: "Draft storyboard",
          createdAt: now,
          updatedAt: now,
          request: baseRequest,
          screenshots: [],
          comments: [],
          coverFrame: `/painted/${look.medium}.jpg`,
          painted
        });

    const workDir = paintedWorkDir(projectId);
    void (async () => {
      try {
        const result = await generatePaintedStoryboard({
          mode,
          text,
          look: look.id,
          drawIn,
          aspect,
          workDir,
          onStage: async (stage, draft) => {
            await updateProjectPainted(projectId, (current) => ({
              ...(draft ? { name: projectNameFrom(draft.script, look.id), script: scriptFromPainted(draft.spec.lines, mode), filmSeconds: Math.round(draft.timeline.duration) } : {}),
              painted: current.painted
                ? {
                    ...current.painted,
                    ...(draft ? { script: draft.script, spec: draft.spec, timeline: draft.timeline } : {}),
                    busy: { ...busy, stage }
                  }
                : painted
            }));
          }
        });
        await updateProjectPainted(projectId, (current) => ({
          name: projectNameFrom(result.script, look.id),
          state: "Draft storyboard",
          script: scriptFromPainted(result.spec.lines, mode),
          filmSeconds: Math.round(result.timeline.duration),
          painted: {
            ...(current.painted ?? painted),
            script: result.script,
            spec: result.spec,
            timeline: result.timeline,
            audioVersion: undefined,
            busy: null
          }
        }));
      } catch (error) {
        request.log.warn({ err: error, projectId }, "painted storyboard generation failed");
        const message = error instanceof Error ? error.message : "Could not generate the storyboard.";
        await updateProjectPainted(projectId, (current) => ({
          painted: {
            ...(current.painted ?? painted),
            busy: { ...busy, status: "failed", error: message }
          }
        })).catch(() => undefined);
      }
    })();

    return reply.code(202).send({ project: saved });
  });

  /** Hydrates an older Story film project from its stored worker archive (`painted/<jobId>/work.tgz`) if needed. */
  app.post<{ Params: { id: string } }>("/v1/painted/projects/:id/hydrate", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project || project.ownerId !== callerId(request) || !project.painted) {
      return reply.code(404).send(fail("not_found", "Project not found."));
    }
    const jobId = project.renderJobId ?? project.id;
    const hydrated = await hydrateFromWorkerArchive(jobId, paintedWorkDir(project.id));
    if (!hydrated) return { project };
    const updated = await updateProjectPainted(project.id, (current) => ({
      filmSeconds: Math.round(hydrated.timeline.duration),
      script: scriptFromPainted(hydrated.spec.lines, current.painted?.mode ?? "script"),
      painted: {
        ...current.painted!,
        script: hydrated.spec.lines.map((l) => l.say).join("\n"),
        spec: hydrated.spec,
        timeline: hydrated.timeline,
        audioVersion: (current.painted?.audioVersion ?? 0) + 1,
        busy: null
      }
    }));
    return { project: updated ?? project };
  });

  /**
   * Inline edits on Step 2 (Storyboard) or Step 3 (Animation): dialogue text (`lines`), `look`, `drawIn`, `aspect`,
   * `voice`, `musicMood`, or `coverFrame` thumbnail. Rebuilds `timeline` immediately.
   */
  app.patch<{
    Params: { id: string };
    Body: {
      look?: unknown;
      drawIn?: unknown;
      aspect?: unknown;
      voice?: unknown;
      musicMood?: unknown;
      coverFrame?: unknown;
      lines?: { index?: unknown; say?: unknown; scene?: unknown }[];
    };
  }>("/v1/painted/projects/:id", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project || project.ownerId !== callerId(request) || !project.painted) {
      return reply.code(404).send(fail("not_found", "Project not found."));
    }
    const body = request.body ?? {};
    const nextLookId = typeof body.look === "string" && paintedLookById(body.look) ? body.look : project.painted.look;
    if (!lookAvailable(nextLookId)) return reply.code(409).send(fail("look_unavailable", "That look is not available yet."));
    const nextDrawIn: PaintedDrawMode = paintedDrawModes.includes(body.drawIn as PaintedDrawMode)
      ? (body.drawIn as PaintedDrawMode)
      : project.painted.drawIn;
    const nextAspect: "9:16" | "16:9" = body.aspect === "16:9" || body.aspect === "9:16" ? body.aspect : project.painted.aspect;
    const nextVoice = typeof body.voice === "string" && voiceIds.includes(body.voice) ? body.voice : project.painted.voice;
    const nextMood = typeof body.musicMood === "string" ? body.musicMood.trim().slice(0, 80) : project.painted.musicMood;
    const coverFrame =
      typeof body.coverFrame === "string" && (body.coverFrame.startsWith("data:image/") || body.coverFrame.startsWith("/painted/"))
        ? body.coverFrame
        : undefined;

    let spec = project.painted.spec ? structuredClone(project.painted.spec) : undefined;
    let voiceInvalidated = nextVoice !== project.painted.voice;

    if (spec && Array.isArray(body.lines)) {
      for (const edit of body.lines) {
        const idx = Number(edit?.index);
        if (!Number.isInteger(idx) || !spec.lines[idx]) continue;
        if (typeof edit.say === "string" && edit.say.trim()) {
          const nextSay = edit.say.trim().slice(0, 320);
          if (nextSay !== spec.lines[idx]!.say) {
            spec.lines[idx]!.say = nextSay;
            delete spec.lines[idx]!.audio;
            voiceInvalidated = true;
          }
        }
        if (typeof edit.scene === "string") {
          spec.lines[idx]!.scene = edit.scene.trim().slice(0, 320);
        }
      }
    }

    if (spec) {
      spec = applyLookToSpec(spec, nextLookId, nextDrawIn, nextAspect);
    }
    const timeline = spec ? buildPaintedTimeline(spec) : project.painted.timeline;
    const nextScript = spec ? spec.lines.map((l) => l.say).join("\n") : project.painted.script;

    const updated = await updateProjectPainted(project.id, (current) => ({
      ...(coverFrame ? { coverFrame } : {}),
      ...(timeline ? { filmSeconds: Math.round(timeline.duration) } : {}),
      ...(spec ? { script: scriptFromPainted(spec.lines, current.painted?.mode ?? "script") } : {}),
      request: {
        ...current.request,
        format: nextAspect === "16:9" ? "landscape" : "portrait",
        audio: { music: true, voiceover: true, voice: nextVoice }
      },
      painted: {
        ...current.painted!,
        look: nextLookId,
        drawIn: nextDrawIn,
        aspect: nextAspect,
        voice: nextVoice,
        ...(nextMood !== undefined ? { musicMood: nextMood || undefined } : {}),
        script: nextScript,
        ...(spec ? { spec } : {}),
        ...(timeline ? { timeline } : {}),
        ...(voiceInvalidated ? { audioVersion: undefined } : {})
      }
    }));

    return { project: updated ?? project };
  });

  /**
   * Step 2 (Storyboard) or Step 3 (Animation): Rewrites 1..5 scenes from user comments (`comments: [{ line, text }]`).
   * Updates `spec` and `timeline` in seconds, and if the project is already animated (`audioVersion` present),
   * re-mixes `audio.m4a` so the in-browser animation updates without rendering an MP4!
   */
  app.post<{ Params: { id: string }; Body: { comments?: unknown } }>("/v1/painted/projects/:id/changes", async (request, reply) => {
    const owner = callerId(request);
    const project = await getProject(request.params.id);
    if (!project || project.ownerId !== owner || !project.painted?.spec) {
      return reply.code(404).send(fail("not_found", "Storyboard not found."));
    }
    if (project.painted.busy?.status === "running") {
      return reply.code(409).send(fail("busy", "A change is already running on this film."));
    }
    const lineCount = project.painted.spec.lines.length;
    const raw = Array.isArray(request.body?.comments) ? (request.body!.comments as unknown[]) : [];
    const comments = raw.flatMap((entry) => {
      const item = entry as { line?: unknown; text?: unknown };
      const line = Number(item?.line);
      const text = typeof item?.text === "string" ? item.text.replace(/\s+/g, " ").trim() : "";
      return Number.isInteger(line) && line >= 0 && line < lineCount && text.length >= 3 ? [{ line, text: text.slice(0, 300) }] : [];
    });
    if (!comments.length || comments.length > MAX_COMMENTS) {
      return reply.code(400).send(fail("invalid_request", `Comment on 1 to ${MAX_COMMENTS} scenes.`));
    }

    const busy = {
      status: "running" as const,
      phase: "changes" as const,
      stage: "directing",
      startedAt: new Date().toISOString()
    };
    const started = await updateProjectPainted(project.id, (current) => ({
      painted: { ...current.painted!, busy }
    }));

    const workDir = paintedWorkDir(project.id);
    const wasAnimated = Boolean(project.painted.audioVersion);

    void (async () => {
      try {
        const changed = await applyPaintedSceneChanges({
          spec: project.painted!.spec!,
          comments,
          look: project.painted!.look,
          drawIn: project.painted!.drawIn,
          aspect: project.painted!.aspect,
          workDir,
          onStage: async (stage) => {
            await updateProjectPainted(project.id, (current) => ({
              painted: current.painted ? { ...current.painted, busy: { ...busy, stage } } : undefined
            }));
          }
        });

        let finalSpec = changed.spec;
        let finalTimeline = changed.timeline;
        let nextAudioVersion = project.painted!.audioVersion;
        const hasAudioFile = wasAnimated && (await ensureMedia(join(workDir, "audio.m4a")));

        // Keep the existing animation audio unless a comment actually changed the spoken dialogue words (or audio.m4a is missing)
        if (wasAnimated && (changed.linesChanged || !hasAudioFile)) {
          const animated = await producePaintedAnimation({
            spec: finalSpec,
            look: project.painted!.look,
            drawIn: project.painted!.drawIn,
            aspect: project.painted!.aspect,
            voice: project.painted!.voice,
            musicMood: project.painted!.musicMood,
            workDir,
            onStage: async (stage) => {
              await updateProjectPainted(project.id, (current) => ({
                painted: current.painted ? { ...current.painted, busy: { ...busy, stage } } : undefined
              }));
            }
          });
          finalSpec = animated.spec;
          finalTimeline = animated.timeline;
          nextAudioVersion = (nextAudioVersion ?? 0) + 1;
        }

        await updateProjectPainted(project.id, (current) => ({
          state: wasAnimated ? "Ready for review" : current.state,
          filmSeconds: Math.round(finalTimeline.duration),
          script: scriptFromPainted(finalSpec.lines, current.painted?.mode ?? "script"),
          painted: {
            ...current.painted!,
            script: finalSpec.lines.map((l) => l.say).join("\n"),
            spec: finalSpec,
            timeline: finalTimeline,
            ...(nextAudioVersion !== undefined ? { audioVersion: nextAudioVersion } : {}),
            busy: null
          }
        }));
      } catch (error) {
        request.log.warn({ err: error, projectId: project.id }, "painted scene change failed");
        const message = error instanceof Error ? error.message : "Could not apply the scene changes.";
        await updateProjectPainted(project.id, (current) => ({
          painted: current.painted ? { ...current.painted, busy: { ...busy, status: "failed", error: message } } : undefined
        })).catch(() => undefined);
      }
    })();

    return reply.code(202).send({ project: started ?? project });
  });

  /**
   * Step 2 -> Step 3 (Create Animation): Records the voiceover per line, composes the music bed,
   * mixes `audio.m4a`, and computes the exact `timeline` for the in-browser Animation player. No MP4 rendering!
   */
  app.post<{ Params: { id: string } }>("/v1/painted/projects/:id/animate", async (request, reply) => {
    const owner = callerId(request);
    const project = await getProject(request.params.id);
    if (!project || project.ownerId !== owner || !project.painted?.spec) {
      return reply.code(404).send(fail("not_found", "Generate the storyboard first."));
    }
    if (project.painted.busy?.status === "running" && project.painted.busy.phase === "animate") {
      return reply.code(202).send({ project });
    }
    const workDir = paintedWorkDir(project.id);
    const allLinesVoiced = project.painted.spec.lines.every((l) => Boolean(l.audio?.seconds && l.audio.seconds > 0));
    if (project.painted.audioVersion && allLinesVoiced && (await ensureMedia(join(workDir, "audio.m4a")))) {
      return reply.code(200).send({ project });
    }

    const busy = {
      status: "running" as const,
      phase: "animate" as const,
      stage: "voice",
      startedAt: new Date().toISOString()
    };
    const started = await updateProjectPainted(project.id, (current) => ({
      painted: { ...current.painted!, busy }
    }));
    void (async () => {
      try {
        const result = await producePaintedAnimation({
          spec: project.painted!.spec!,
          look: project.painted!.look,
          drawIn: project.painted!.drawIn,
          aspect: project.painted!.aspect,
          voice: project.painted!.voice,
          musicMood: project.painted!.musicMood,
          workDir,
          onStage: async (stage) => {
            await updateProjectPainted(project.id, (current) => ({
              painted: current.painted ? { ...current.painted, busy: { ...busy, stage } } : undefined
            }));
          }
        });
        await updateProjectPainted(project.id, (current) => ({
          state: "Ready for review",
          filmSeconds: Math.round(result.timeline.duration),
          painted: {
            ...current.painted!,
            spec: result.spec,
            timeline: result.timeline,
            audioVersion: (current.painted?.audioVersion ?? 0) + 1,
            busy: null
          }
        }));
      } catch (error) {
        request.log.warn({ err: error, projectId: project.id }, "painted animation build failed");
        const message = error instanceof Error ? error.message : "Could not build the animation audio.";
        await updateProjectPainted(project.id, (current) => ({
          painted: current.painted ? { ...current.painted, busy: { ...busy, status: "failed", error: message } } : undefined
        })).catch(() => undefined);
      }
    })();

    return reply.code(202).send({ project: started ?? project });
  });

  /**
   * Step 3 -> Step 4 (Final Render): Charges tokens, uploads the prepared `work.tgz` (`spec.json`, `recipes/`, `tts/`, `music.*`)
   * so the worker renders the exact approved animation into an MP4, and queues the worker job.
   */
  app.post<{ Params: { id: string } }>("/v1/painted/projects/:id/render", async (request, reply) => {
    const owner = callerId(request);
    const project = await getProject(request.params.id);
    if (!project || project.ownerId !== owner || !project.painted?.spec) {
      return reply.code(404).send(fail("not_found", "Build the storyboard and animation before rendering."));
    }
    const look = paintedLookById(project.painted.look);
    if (!look) return reply.code(400).send(fail("invalid_request", "Choose one of the looks."));
    if (!lookAvailable(look.id)) return reply.code(409).send(fail("look_unavailable", `${look.name} is not available yet.`));

    const active = await pool.query<{ n: string }>(
      "select count(*) as n from app.render_jobs where owner_id = $1 and request->>'kind' = 'painted' and state in ('queued', 'planning', 'rendering')",
      [owner]
    );
    if (Number(active.rows[0]?.n) >= MAX_ACTIVE) {
      return reply.code(429).send(fail("too_many_films", "Two films are already being rendered. Wait for one to finish."));
    }

    const jobId = randomUUID();
    const seconds = Math.max(10, Math.ceil(project.painted.timeline?.duration ?? paintedSeconds(project.painted.script)));
    let spend: { charged: boolean; event: string } | null = null;
    try {
      spend = await spendTokens(owner, renderCostMillitokens(seconds), "painted", jobId, project.id);
    } catch (error) {
      if (error instanceof InsufficientTokens) {
        return reply.code(402).send(
          fail(
            "insufficient_tokens",
            `This film needs ${error.needed} tokens and you have ${error.remaining}. Add tokens or choose a plan.`,
            { needed: error.needed, remaining: error.remaining }
          )
        );
      }
      throw error;
    }

    try {
      const workDir = paintedWorkDir(project.id);
      const packed = await packPaintedWorkForWorker(project.id, workDir);
      const scenes = project.painted.spec.lines.map((line, i) => ({
        id: `${project.id}-${i + 1}`,
        label: `Scene ${i + 1}`,
        detail: line.say.slice(0, 120),
        duration: line.audio?.seconds ?? seconds / Math.max(1, project.painted!.spec!.lines.length)
      }));
      const job: RenderJob = {
        id: jobId,
        state: "rendering",
        progress: 45,
        createdAt: new Date().toISOString(),
        revision: { id: randomUUID(), title: project.name, scenes, look: "doodle" }
      };
      const queued = await renderJobRepository.createFormatAndEnqueue(job, {
        ownerId: owner,
        projectId: project.id,
        request: {
          kind: "painted",
          look: look.id,
          script: project.painted.script,
          drawIn: project.painted.drawIn,
          ...(packed ? { baseJobId: project.id } : {}),
          ...(spend.charged ? { spend: spend.event } : {})
        },
        renderInput: {
          kind: "painted",
          id: jobId,
          look: look.id,
          script: project.painted.script,
          drawIn: project.painted.drawIn,
          format: project.painted.aspect,
          ...(packed ? { baseJobId: project.id, fixes: [] } : {}),
          durationSeconds: seconds
        },
        ...(look.engine === "oil" ? { queue: QUEUES.videoGpu } : {})
      });
      const updated = await updateProjectPainted(project.id, () => ({
        state: "Rendering draft",
        renderJobId: jobId
      }));
      return reply.code(202).send({
        job: queued,
        project: updated ?? project,
        seconds,
        tokens: renderCostMillitokens(seconds) / 1000
      });
    } catch (error) {
      if (spend?.charged) {
        await refundSpend(owner, spend.event).catch((refundError) => request.log.error({ err: refundError }, "could not return tokens"));
      }
      request.log.error({ err: error }, "could not queue story film render");
      return reply.code(503).send(fail("queue_unavailable", "The render queue is not reachable. Nothing was charged; try again in a moment."));
    }
  });

  // ---- Legacy direct endpoints kept for backwards compatibility ----

  app.post<{ Body: { script?: unknown; look?: unknown; drawIn?: unknown } }>("/v1/painted/films", async (request, reply) => {
    const body = request.body ?? {};
    const script = typeof body.script === "string" ? body.script.replace(/\r/g, "").trim() : "";
    if (script.length < PAINTED_SCRIPT_MIN || script.length > PAINTED_SCRIPT_MAX)
      return reply.code(400).send(fail("invalid_request", `Write between ${PAINTED_SCRIPT_MIN} and ${PAINTED_SCRIPT_MAX} characters.`));
    const look = typeof body.look === "string" ? paintedLookById(body.look) : undefined;
    if (!look) return reply.code(400).send(fail("invalid_request", "Choose one of the looks."));
    if (!lookAvailable(look.id)) return reply.code(409).send(fail("look_unavailable", `${look.name} is not available yet.`));
    const drawIn: PaintedDrawMode = paintedDrawModes.includes(body.drawIn as PaintedDrawMode) ? (body.drawIn as PaintedDrawMode) : "opening";

    const owner = callerId(request);
    const active = await pool.query<{ n: string }>(
      "select count(*) as n from app.render_jobs where owner_id = $1 and request->>'kind' = 'painted' and state in ('queued', 'planning', 'rendering')",
      [owner]
    );
    if (Number(active.rows[0]?.n) >= MAX_ACTIVE)
      return reply.code(429).send(fail("too_many_films", "Two films are already being made. Wait for one to finish."));

    const jobId = randomUUID();
    const seconds = paintedSeconds(script);
    let spend: { charged: boolean; event: string } | null = null;
    try {
      spend = await spendTokens(owner, renderCostMillitokens(seconds), "painted", jobId);
    } catch (error) {
      if (error instanceof InsufficientTokens)
        return reply.code(402).send(
          fail("insufficient_tokens", `This film needs ${error.needed} tokens and you have ${error.remaining}. Add tokens or choose a plan.`, {
            needed: error.needed,
            remaining: error.remaining
          })
        );
      throw error;
    }
    try {
      const job: RenderJob = {
        id: jobId,
        state: "rendering",
        progress: 45,
        createdAt: new Date().toISOString(),
        revision: { id: randomUUID(), title: "Story film", scenes: [], look: "doodle" }
      };
      const queued = await renderJobRepository.createFormatAndEnqueue(job, {
        ownerId: owner,
        request: { kind: "painted", look: look.id, script, drawIn, ...(spend.charged ? { spend: spend.event } : {}) },
        renderInput: { kind: "painted", id: jobId, look: look.id, script, drawIn, durationSeconds: seconds },
        ...(look.engine === "oil" ? { queue: QUEUES.videoGpu } : {})
      });
      return reply.code(202).send({ ...queued, seconds, tokens: renderCostMillitokens(seconds) / 1000 });
    } catch (error) {
      if (spend?.charged) await refundSpend(owner, spend.event).catch((refundError) => request.log.error({ err: refundError }, "could not return tokens"));
      request.log.error({ err: error }, "could not queue story film");
      return reply.code(503).send(fail("queue_unavailable", "The render queue is not reachable. Nothing was charged; try again in a moment."));
    }
  });

  app.post<{ Params: { id: string }; Body: { comments?: unknown } }>("/v1/painted/films/:id/changes", async (request, reply) => {
    const owner = callerId(request);
    if (!/^[0-9a-f-]{36}$/i.test(request.params.id)) return reply.code(404).send(fail("not_found", "Film not found."));
    const base = await ownFilm(request.params.id, owner);
    if (!base) return reply.code(404).send(fail("not_found", "Film not found."));
    if (base.state !== "ready") return reply.code(409).send(fail("not_ready", "Wait for the film to finish before changing it."));
    const lineCount = base.output?.lines?.length ?? 0;
    const raw = Array.isArray(request.body?.comments) ? (request.body!.comments as unknown[]) : [];
    const comments = raw.flatMap((entry) => {
      const item = entry as { line?: unknown; text?: unknown };
      const line = Number(item?.line);
      const text = typeof item?.text === "string" ? item.text.replace(/\s+/g, " ").trim() : "";
      return Number.isInteger(line) && line >= 0 && line < lineCount && text.length >= 3 ? [{ line, say: text.slice(0, 300) }] : [];
    });
    if (!comments.length || comments.length > MAX_COMMENTS) return reply.code(400).send(fail("invalid_request", `Comment on 1 to ${MAX_COMMENTS} scenes.`));
    const active = await pool.query<{ n: string }>(
      "select count(*) as n from app.render_jobs where owner_id = $1 and request->>'kind' = 'painted' and state in ('queued', 'planning', 'rendering')",
      [owner]
    );
    if (Number(active.rows[0]?.n) >= MAX_ACTIVE) return reply.code(429).send(fail("too_many_films", "Two films are already being made. Wait for one to finish."));

    const jobId = randomUUID();
    let spend: { charged: boolean; event: string } | null = null;
    try {
      spend = await spendTokens(owner, COMMENT_MILLITOKENS * comments.length, "painted-change", jobId);
    } catch (error) {
      if (error instanceof InsufficientTokens)
        return reply
          .code(402)
          .send(fail("insufficient_tokens", `This change needs ${error.needed} tokens and you have ${error.remaining}.`, { needed: error.needed, remaining: error.remaining }));
      throw error;
    }
    try {
      const job: RenderJob = {
        id: jobId,
        state: "rendering",
        progress: 45,
        createdAt: new Date().toISOString(),
        revision: { id: randomUUID(), title: "Story film", scenes: [], look: "doodle" }
      };
      const queued = await renderJobRepository.createFormatAndEnqueue(job, {
        ownerId: owner,
        request: {
          kind: "painted",
          look: base.request.look,
          script: base.request.script,
          drawIn: base.request.drawIn,
          baseJobId: base.id,
          comments,
          ...(spend.charged ? { spend: spend.event } : {})
        },
        renderInput: {
          kind: "painted",
          id: jobId,
          look: base.request.look,
          drawIn: base.request.drawIn,
          baseJobId: base.id,
          fixes: comments,
          durationSeconds: base.output?.durationSeconds ?? 60
        },
        ...(base.request.look?.startsWith("oil:") ? { queue: QUEUES.videoGpu } : {})
      });
      return reply.code(202).send(queued);
    } catch (error) {
      if (spend?.charged) await refundSpend(owner, spend.event).catch((refundError) => request.log.error({ err: refundError }, "could not return tokens"));
      request.log.error({ err: error }, "could not queue story film change");
      return reply.code(503).send(fail("queue_unavailable", "The render queue is not reachable. Nothing was charged; try again in a moment."));
    }
  });
}
