import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { findTemplate, parseRenderRequest, type RenderJob } from "@videosaas/contracts";
import { config } from "./config.ts";
import { renderService } from "./render/service.ts";
import { renderJobRepository } from "./render/repository.ts";
import { NotReady, prepareBeatPlanRender } from "./plan/readiness.ts";
import type { Plan } from "./render/planner.ts";
import { PreviewUnavailable, previewBrandFont, previewBrandLogo, previewFont, previewGsap, previewRuntime, previewTemplateScreenshot, projectPreviewHtml } from "./preview/service.ts";
import { databaseReady, migrate, pool } from "./db/database.ts";
import { boss, startQueues } from "./jobs/queues.ts";
import { AssetRejected, readStaged, stageFont, stageLogo } from "./brand/assets.ts";
import { extractBrand } from "./brand/extract.ts";
import { registerPlanRoutes } from "./plan/routes.ts";
import { FetchRefused } from "./brand/safe-fetch.ts";
import { BrandInvalid, brandLogoPath, createBrand, getBrand, listBrands, validateBrandInput } from "./brand/store.ts";
import { addReviewComment, addScreenshot, applyReviewComments, createProject, getProject, listProjects, ProjectInvalid, removeReviewComment, removeScreenshot, screenshotFile, updateProject, updateProjectStudio } from "./projects/store.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

await app.register(cors, { origin: config.corsOrigins, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], allowedHeaders: ["Content-Type", "X-File-Type", "X-File-Name", "X-Screenshot-Purpose"] });
// Raw uploads (logo and font files) arrive as bytes; the route validates the content itself.
app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: 20_000_000 }, (_request, body, done) => done(null, body));

app.get("/healthz", async () => ({ status: "ok", service: "backend" }));
app.get("/readyz", async (_request, reply) => {
  const ready = await databaseReady();
  return reply.code(ready ? 200 : 503).send({ ready, database: ready });
});

const projectError = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, error: unknown) => {
  if (error instanceof ProjectInvalid) return reply.code(400).send({ error: { code: "invalid_project", message: error.message } });
  app.log.warn({ err: error }, "project request failed");
  return reply.code(422).send({ error: { code: "project_failed", message: error instanceof Error ? error.message : "Could not update this project." } });
};

/**
 * Jobs created before render jobs moved to Postgres exist only as a project reference and an MP4.
 * Rehydrate enough job metadata to keep those reviews playable instead of a fabricated preview.
 */
async function recoveredRenderJob(id: string): Promise<RenderJob | null> {
  const project = (await listProjects()).find((item) => item.renderJobId === id);
  if (!project) return null;
  const file = join(config.renderOutputDir, `${id}.mp4`);
  const outputExists = await stat(file).then(() => true).catch(() => false);
  const lines = project.script?.lines ?? [];
  const sceneDuration = lines.length ? 10 / lines.length : 10;
  const scenes = lines.map((line, index) => ({ id: `${id}-${index + 1}`, label: line.label, detail: line.onScreen, duration: sceneDuration }));
  const state: RenderJob["state"] = outputExists ? "ready" : project.state === "Render needs attention" ? "failed" : project.state === "Rendering draft" ? "rendering" : "queued";
  return {
    id,
    state,
    progress: outputExists || state === "failed" ? 100 : state === "rendering" ? 62 : 0,
    createdAt: project.updatedAt,
    revision: { id: `recovered-${id}`, title: project.name, scenes },
    ...(outputExists ? { output: { url: `/v1/renders/${id}`, format: "mp4" as const, durationSeconds: 10 } } : {}),
    ...(state === "failed" ? { error: { code: "render_failed", message: "The saved render did not produce a video file." } } : {})
  };
}

const previewNotFound = (reply: { code: (n: number) => { send: (body: unknown) => unknown } }, message: string) => reply.code(404).send({ error: { code: "not_found", message } });

// ---------- Browser-side HyperFrames preview ----------
// These routes are served to the frontend through its same-origin `/api/preview`
// rewrite. That lets the official player inspect and control its composition
// iframe while the backend remains the source of all template data and assets.
app.get<{ Params: { id: string } }>("/v1/preview/projects/:id", async (request, reply) => {
  const project = await getProject(request.params.id);
  if (!project) return previewNotFound(reply, "Project not found.");
  try {
    const html = await projectPreviewHtml(project);
    return reply
      .header("Content-Type", "text/html; charset=utf-8")
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'self' data: blob:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; media-src 'self'; connect-src 'none'; frame-ancestors 'self'")
      .send(html);
  } catch (error) {
    const message = error instanceof PreviewUnavailable ? error.message : "Could not build this Studio preview.";
    app.log.warn({ err: error, projectId: project.id }, "studio preview failed");
    return reply.code(503).send({ error: { code: "preview_unavailable", message } });
  }
});

app.get("/v1/preview/runtime.js", async (_request, reply) => {
  const file = await previewRuntime();
  return file
    ? reply.header("Content-Type", "application/javascript; charset=utf-8").header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff").send(file)
    : previewNotFound(reply, "HyperFrames runtime not found.");
});

app.get("/v1/preview/gsap.js", async (_request, reply) => {
  const file = await previewGsap();
  return file
    ? reply.header("Content-Type", "application/javascript; charset=utf-8").header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff").send(file)
    : previewNotFound(reply, "GSAP preview runtime not found.");
});

app.get<{ Params: { name: string } }>("/v1/preview/fonts/:name", async (request, reply) => {
  const file = await previewFont(request.params.name);
  if (!file) return previewNotFound(reply, "Preview font not found.");
  const type = request.params.name.endsWith(".woff2") ? "font/woff2" : request.params.name.endsWith(".woff") ? "font/woff" : request.params.name.endsWith(".ttf") ? "font/ttf" : "font/otf";
  return reply.header("Content-Type", type).header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff").send(file);
});

app.get<{ Params: { template: string } }>("/v1/preview/templates/:template/assets/screenshot.svg", async (request, reply) => {
  const file = await previewTemplateScreenshot(request.params.template);
  return file
    ? reply.header("Content-Type", "image/svg+xml").header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff").send(file)
    : previewNotFound(reply, "Template asset not found.");
});

app.get<{ Params: { id: string; screenshotId: string } }>("/v1/preview/projects/:id/screenshots/:screenshotId", async (request, reply) => {
  const image = await screenshotFile(request.params.id, request.params.screenshotId);
  return image
    ? reply.header("Content-Type", image.mime).header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff").send(image.data)
    : previewNotFound(reply, "Screenshot not found.");
});

app.get<{ Params: { id: string } }>("/v1/preview/brands/:id/logo", async (request, reply) => {
  const file = await previewBrandLogo(request.params.id);
  return file
    ? reply.header("Content-Type", "image/png").header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff").send(file)
    : previewNotFound(reply, "Brand logo not found.");
});

app.get<{ Params: { id: string; name: string } }>("/v1/preview/brands/:id/fonts/:name", async (request, reply) => {
  const file = await previewBrandFont(request.params.id, request.params.name);
  if (!file) return previewNotFound(reply, "Brand font not found.");
  const type = request.params.name.endsWith(".woff2") ? "font/woff2" : request.params.name.endsWith(".woff") ? "font/woff" : request.params.name.endsWith(".ttf") ? "font/ttf" : "font/otf";
  return reply.header("Content-Type", type).header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff").send(file);
});

// ---------- Persisted projects ----------
// Product flow v2: Script & Style → beat plan, storyboard edits, live composition (backend/src/plan).
await registerPlanRoutes(app);

app.get("/v1/projects", async () => ({ projects: await listProjects() }));

app.post("/v1/projects", async (request, reply) => {
  try {
    return reply.code(201).send(await createProject(request.body as { name?: unknown; request?: unknown }));
  } catch (error) {
    return projectError(reply, error);
  }
});

app.get<{ Params: { id: string } }>("/v1/projects/:id", async (request, reply) => {
  const project = await getProject(request.params.id);
  return project ?? reply.code(404).send({ error: { code: "not_found", message: "Project not found." } });
});

app.put<{ Params: { id: string } }>("/v1/projects/:id", async (request, reply) => {
  try {
    const project = await updateProject(request.params.id, request.body as Record<string, unknown>);
    return project ?? reply.code(404).send({ error: { code: "not_found", message: "Project not found." } });
  } catch (error) {
    return projectError(reply, error);
  }
});

/** Persists a validated Studio revision; values and screenshot ids never live only in the browser. */
app.patch<{ Params: { id: string } }>("/v1/projects/:id/studio", async (request, reply) => {
  try {
    const project = await updateProjectStudio(request.params.id, request.body as { values?: unknown; assets?: unknown });
    return project ?? reply.code(404).send({ error: { code: "not_found", message: "Project not found." } });
  } catch (error) {
    return projectError(reply, error);
  }
});

app.post<{ Params: { id: string } }>("/v1/projects/:id/script", async (request, reply) => {
  try {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send({ error: { code: "not_found", message: "Project not found." } });
    const lines = await renderService.draftScript(project.request);
    const updated = await updateProject(project.id, { script: { source: "generated", lines, confirmed: false } });
    return reply.code(201).send(updated);
  } catch (error) {
    return projectError(reply, error);
  }
});

app.post<{ Params: { id: string } }>("/v1/projects/:id/render", async (request, reply) => {
  try {
    let project = await getProject(request.params.id);
    if (!project) return reply.code(404).send({ error: { code: "not_found", message: "Project not found." } });

    // An approved storyboard renders exactly as previewed: no planner, no generation, nothing that can
    // fail after Submit. Readiness is checked again here; the storyboard already disables Submit.
    if (project.beatPlan) {
      const jobId = randomUUID();
      let prepared: Awaited<ReturnType<typeof prepareBeatPlanRender>>;
      try {
        prepared = await prepareBeatPlanRender(project, jobId);
      } catch (error) {
        if (error instanceof NotReady) return reply.code(409).send({ error: { code: "not_ready", message: error.message }, readiness: error.readiness });
        throw error;
      }
      await updateProject(project.id, { state: "Rendering draft", renderJobId: jobId });
      return reply.code(202).send(await renderService.createBeatPlanRender(project, jobId, prepared));
    }

    if (!project.script?.confirmed) return reply.code(400).send({ error: { code: "script_unconfirmed", message: "Check and confirm the script before rendering." } });
    if (project.screenshots.length === 0) return reply.code(400).send({ error: { code: "screenshots_missing", message: "Upload at least one verified screenshot before rendering." } });

    // Persist a normalized Studio snapshot before queuing. The initial render is
    // planned once to seed it; later renders use exactly the saved draft and do
    // not let a fresh planner response overwrite user edits.
    let plannedRevision: Plan;
    if (project.studio) {
      plannedRevision = await renderService.planStudio(project);
    } else {
      plannedRevision = await renderService.planInitialStudio(project);
      const template = findTemplate(project.request.template);
      const saved = await updateProjectStudio(project.id, {
        values: plannedRevision.values,
        assets: template?.variables.some((variable) => variable.id === "screenshot" && variable.type === "image") && project.screenshots[0]
          ? { screenshot: project.screenshots[0].id }
          : {}
      });
      if (!saved) return reply.code(404).send({ error: { code: "not_found", message: "Project not found." } });
      project = saved;
    }

    // Record the job on the project first, so a render that finishes quickly always finds its project.
    const jobId = randomUUID();
    await updateProject(project.id, { state: "Rendering draft", renderJobId: jobId });
    return reply.code(202).send(await renderService.create(project.request, { projectId: project.id, plannedRevision, id: jobId }));
  } catch (error) {
    const project = await getProject(request.params.id);
    if (project) await updateProject(project.id, { state: "Render needs attention" });
    app.log.error({ err: error, projectId: request.params.id }, "could not queue render");
    return reply.code(503).send({ error: { code: "queue_unavailable", message: "The render queue is not reachable. Your project is saved; try rendering again in a moment." } });
  }
});

app.put<{ Params: { id: string } }>("/v1/projects/:id/approve", async (request, reply) => {
  const project = await updateProject(request.params.id, { state: "Approved", approvedAt: new Date().toISOString() });
  return project ?? reply.code(404).send({ error: { code: "not_found", message: "Project not found." } });
});

app.post<{ Params: { id: string } }>("/v1/projects/:id/comments", async (request, reply) => {
  try {
    const project = await addReviewComment(request.params.id, request.body);
    return project ? reply.code(201).send(project) : reply.code(404).send({ error: { code: "not_found", message: "Project not found." } });
  } catch (error) {
    return projectError(reply, error);
  }
});

app.post<{ Params: { id: string } }>("/v1/projects/:id/comments/apply", async (request, reply) => {
  try {
    const project = await getProject(request.params.id);
    if (!project) return reply.code(404).send({ error: { code: "not_found", message: "Project not found." } });
    const revision = await renderService.reviseForComments(project);
    const jobId = randomUUID();
    const updated = await applyReviewComments(project.id, {
      request: revision.request,
      script: { source: "generated", lines: revision.lines, confirmed: true },
      commentIds: project.comments.map((comment) => comment.id),
      renderJobId: jobId,
      // The revised plan is the source of the new render, so reflect it in
      // Studio before the job is queued. Re-opening Studio now shows this draft,
      // not stale pre-comment copy.
      studioValues: revision.plan.values
    });
    if (!updated) return reply.code(404).send({ error: { code: "not_found", message: "Project not found." } });
    try {
      const job = await renderService.create(revision.request, { projectId: project.id, plannedRevision: revision.plan, id: jobId });
      return reply.code(202).send({ project: updated, job });
    } catch (error) {
      await updateProject(project.id, { state: "Render needs attention" });
      throw error;
    }
  } catch (error) {
    return projectError(reply, error);
  }
});

app.delete<{ Params: { id: string; commentId: string } }>("/v1/projects/:id/comments/:commentId", async (request, reply) => {
  const project = await removeReviewComment(request.params.id, request.params.commentId);
  return project ?? reply.code(404).send({ error: { code: "not_found", message: "Comment not found." } });
});

app.post<{ Params: { id: string } }>("/v1/projects/:id/screenshots", async (request, reply) => {
  const body = request.body;
  if (!Buffer.isBuffer(body)) return reply.code(400).send({ error: { code: "invalid_upload", message: "Send screenshot file bytes." } });
  try {
    const name = typeof request.headers["x-file-name"] === "string" ? request.headers["x-file-name"] : "screenshot";
    const purpose = request.headers["x-screenshot-purpose"];
    const allowedPurposes = ["Dashboard", "Setup", "Report", "Mobile"] as const;
    const mime = typeof request.headers["x-file-type"] === "string" ? request.headers["x-file-type"] : "";
    const project = await addScreenshot(request.params.id, name, mime, body, allowedPurposes.includes(purpose as typeof allowedPurposes[number]) ? purpose as typeof allowedPurposes[number] : "Dashboard");
    return project ? reply.code(201).send(project) : reply.code(404).send({ error: { code: "not_found", message: "Project not found." } });
  } catch (error) {
    return projectError(reply, error);
  }
});

app.delete<{ Params: { id: string; screenshotId: string } }>("/v1/projects/:id/screenshots/:screenshotId", async (request, reply) => {
  const project = await removeScreenshot(request.params.id, request.params.screenshotId);
  return project ?? reply.code(404).send({ error: { code: "not_found", message: "Screenshot not found." } });
});

app.get<{ Params: { id: string; screenshotId: string } }>("/v1/projects/:id/screenshots/:screenshotId", async (request, reply) => {
  const image = await screenshotFile(request.params.id, request.params.screenshotId);
  if (!image) return reply.code(404).send({ error: { code: "not_found", message: "Screenshot not found." } });
  return reply.header("Content-Type", image.mime).header("Cache-Control", "no-store").send(image.data);
});

app.post("/v1/render-jobs", async (request, reply) => {
  const renderRequest = parseRenderRequest(request.body);
  if (!renderRequest) {
    return reply.code(400).send({ error: { code: "invalid_request", message: "Write a prompt between 12 and 600 characters and choose a supported format and motion system." } });
  }
  return reply.code(202).send(await renderService.create(renderRequest));
});

app.get<{ Params: { id: string } }>("/v1/render-jobs/:id", async (request, reply) => {
  const job = uuid.test(request.params.id) ? await renderService.get(request.params.id) ?? await recoveredRenderJob(request.params.id) : null;
  if (!job) return reply.code(404).send({ error: { code: "not_found", message: "That render job does not exist." } });
  return reply.header("Cache-Control", "no-store").send(job);
});

app.get<{ Params: { id: string } }>("/v1/renders/:id", async (request, reply) => {
  const { id } = request.params;
  if (!uuid.test(id)) return reply.code(404).send({ error: { code: "not_found", message: "Rendered video not found." } });
  // Each render attempt writes its own file; the job row records the attempt that won. Older jobs used <id>.mp4.
  const stored = (await renderJobRepository.row(id))?.output?.file;
  const file = join(config.renderOutputDir, stored && /^[a-f0-9-]{36}(-a\d+)?\.mp4$/i.test(stored) ? stored : `${id}.mp4`);
  const size = await stat(file).then((info) => info.size).catch(() => null);
  if (size === null) return reply.code(503).send({ error: { code: "video_unavailable", message: "The worker did not leave an output file." } });

  reply.header("Content-Type", "video/mp4").header("Accept-Ranges", "bytes").header("Cache-Control", "no-store");
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
  if (!range) return reply.header("Content-Length", size).send(createReadStream(file));
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || start > end) return reply.code(416).header("Content-Range", `bytes */${size}`).send();
  return reply.code(206)
    .header("Content-Range", `bytes ${start}-${end}/${size}`)
    .header("Content-Length", end - start + 1)
    .send(createReadStream(file, { start, end }));
});

// ---------- Brand kits ----------
const brandError = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, error: unknown) => {
  if (error instanceof FetchRefused || error instanceof AssetRejected || error instanceof BrandInvalid) return reply.code(400).send({ error: { code: "invalid_request", message: error.message } });
  app.log.warn({ err: error }, "brand request failed");
  return reply.code(422).send({ error: { code: "brand_failed", message: error instanceof Error ? error.message : "Could not process the brand." } });
};

app.post<{ Body: { url?: string } }>("/v1/brands/extract", async (request, reply) => {
  const url = typeof request.body?.url === "string" ? request.body.url.trim() : "";
  if (!url || url.length > 300) return reply.code(400).send({ error: { code: "invalid_request", message: "Enter your product's website URL." } });
  try {
    return await extractBrand(url);
  } catch (error) {
    if (error instanceof Error && /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET/.test(error.message)) return reply.code(400).send({ error: { code: "unreachable", message: "That website could not be reached." } });
    return brandError(reply, error);
  }
});

app.put<{ Params: { kind: string } }>("/v1/brands/assets/:kind", async (request, reply) => {
  const body = request.body;
  if (!Buffer.isBuffer(body) || body.length === 0) return reply.code(400).send({ error: { code: "invalid_request", message: "Send the file bytes as application/octet-stream." } });
  try {
    if (request.params.kind === "logo") return reply.code(201).send(await stageLogo(body));
    if (request.params.kind === "font") return reply.code(201).send(await stageFont(body));
    return reply.code(404).send({ error: { code: "not_found", message: "Unknown asset kind." } });
  } catch (error) {
    return brandError(reply, error);
  }
});

app.get<{ Params: { assetId: string } }>("/v1/brands/assets/:assetId/preview", async (request, reply) => {
  try {
    const { data } = await readStaged(request.params.assetId, "logo");
    return reply.header("Content-Type", "image/png").header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff").send(data);
  } catch {
    return reply.code(404).send({ error: { code: "not_found", message: "Logo not found." } });
  }
});

app.post("/v1/brands", async (request, reply) => {
  try {
    return reply.code(201).send(await createBrand(validateBrandInput(request.body)));
  } catch (error) {
    return brandError(reply, error);
  }
});

app.get("/v1/brands", async () => ({ brands: await listBrands() }));

app.get<{ Params: { id: string } }>("/v1/brands/:id", async (request, reply) => {
  const kit = await getBrand(request.params.id);
  return kit ?? reply.code(404).send({ error: { code: "not_found", message: "Brand kit not found." } });
});

app.get<{ Params: { id: string } }>("/v1/brands/:id/logo", async (request, reply) => {
  const path = brandLogoPath(request.params.id);
  const size = path ? await stat(path).then((info) => info.size).catch(() => null) : null;
  if (!path || size === null) return reply.code(404).send({ error: { code: "not_found", message: "This brand kit has no logo." } });
  return reply.header("Content-Type", "image/png").header("Content-Length", size).header("X-Content-Type-Options", "nosniff").send(createReadStream(path));
});

async function shutdown(signal: string) {
  app.log.info({ signal }, "backend shutting down");
  await app.close();
  // Let in-flight planning finish; anything left is redelivered to another replica after its heartbeat lapses.
  await boss.stop({ graceful: true, timeout: 20_000 }).catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await migrate();
await startQueues();
await renderService.startConsumers();
await app.listen({ port: config.port, host: config.host });
app.log.info({ appEnv: config.appEnv, planner: config.anthropicApiKey ? "anthropic" : "deterministic", planConcurrency: config.planConcurrency }, "backend ready");
