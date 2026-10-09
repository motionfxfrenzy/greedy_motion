import { isAuthorStage } from "../author-skills/bundle.ts";
import { proposeCompositionEdit } from "./assistant.ts";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, sep } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { lintHyperframeHtml } from "@hyperframes/lint";
import { frameShellHtml, isPreviewQuality, previewSize, type ProManifest, type RenderJob, type VideoProject } from "@videosaas/contracts";
import { callerId } from "../auth.ts";
import { config } from "../config.ts";
import { ensureMedia, ensureMediaDir, persistMedia, readMedia, removeMedia, saveMedia } from "../media.ts";
import { buildPlanRenderProject } from "../plan/render-project.ts";
import { getProject, updateProject, updateProjectPro } from "../projects/store.ts";
import { renderJobRepository } from "../render/repository.ts";
import { uploadDirectory } from "../storage.ts";
import { blankComposition } from "./blank.ts";
import { ProConflict, ProInvalid, MIME, checkWrites, proPath, requireRev, servePath, sha256 } from "./files.ts";

/**
 * The Pro Editor's project store. A pro user opens a project: its render folder is snapshotted into an editable HyperFrames
 * folder (`projects/<id>/pro/`, mirrored to R2 by media.ts) and from then on the editor reads and writes that folder.
 * Rules: every write names the revision it was made against (409 otherwise), paths are confined to text files inside the
 * folder, and the preview serves the folder's assets to a sandboxed frame by a token in the URL path (relative URLs do not
 * inherit `?t=`). Untrusted HTML and JS only ever run in that sandboxed frame.
 */

const HISTORY_KEEP = 20;
const proDir = (projectId: string) => join(config.projectsDir, projectId, "pro");
const historyDir = (projectId: string, rev: number) => join(proDir(projectId), ".history", String(rev));
const TEXT = new Set([".html", ".css", ".js", ".json"]);

/** Pro entitlement. No billing exists yet: local dev is always pro; otherwise an allowlist in PRO_USER_IDS ("*" for everyone). */
export function isPro(userId: string): boolean {
  if (config.auth.mode === "none") return true;
  const allowed = (process.env.PRO_USER_IDS ?? "").split(",").map((id) => id.trim().toLowerCase()).filter(Boolean);
  return allowed.includes("*") || allowed.includes(userId.toLowerCase());
}

const fail = (reply: FastifyReply, status: number, code: string, message: string, extra: object = {}) => reply.code(status).send({ error: { code, message, ...extra } });

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ProConflict) return fail(reply, 409, "conflict", error.message, { rev: error.currentRev });
  if (error instanceof ProInvalid) return fail(reply, error.code === "too_large" ? 413 : 400, error.code, error.message);
  throw error;
}

async function* textFiles(dir: string, base = ""): AsyncGenerator<string> {
  const { readdir } = await import("node:fs/promises");
  for (const entry of await readdir(join(dir, base), { withFileTypes: true }).catch(() => [])) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) yield* textFiles(dir, rel);
    else if (entry.isFile() && TEXT.has(extname(entry.name).toLowerCase())) yield rel;
  }
}

async function manifestOf(dir: string): Promise<ProManifest["files"]> {
  const files: ProManifest["files"] = {};
  for await (const rel of textFiles(dir)) {
    const bytes = await readFile(join(dir, rel));
    files[rel] = { size: bytes.length, sha256: sha256(bytes) };
  }
  return files;
}

function canvasOf(html: string) {
  const attr = (name: string) => Number(new RegExp(`data-${name}="(\\d+(?:\\.\\d+)?)"`).exec(html)?.[1]);
  return { width: attr("width") || 1920, height: attr("height") || 1080, duration: attr("duration") || 10 };
}

async function buildSnapshot(project: VideoProject, source: "beat-plan" | "blank", dir: string, options: { aspect?: "16:9" | "9:16" | "1:1"; durationSeconds?: number }) {
  if (source === "beat-plan") {
    if (!project.beatPlan) throw new ProInvalid("This project has no storyboard yet. Start from a blank composition instead.");
    const built = await buildPlanRenderProject(project, dir);
    return { durationSeconds: built.durationSeconds };
  }
  const blank = blankComposition(options.aspect ?? project.beatPlan?.canvas ?? "16:9", options.durationSeconds ?? 10);
  await mkdir(join(dir, "vendor"), { recursive: true });
  await cp(config.gsapPath, join(dir, "vendor/gsap.min.js"));
  await writeFile(join(dir, "index.html"), blank.html);
  return { durationSeconds: blank.durationSeconds };
}

export async function openPro(project: VideoProject, source: "beat-plan" | "blank", options: { aspect?: "16:9" | "9:16" | "1:1"; durationSeconds?: number } = {}) {
  const scratch = await mkdtemp(join(tmpdir(), "pro-open-"));
  try {
    const built = await buildSnapshot(project, source, scratch, options);
    const target = proDir(project.id);
    await removeMedia(target); // a half-written earlier attempt must not leak into this one
    await mkdir(target, { recursive: true });
    await cp(scratch, target, { recursive: true });
    await persistMedia(target);
    const html = await readFile(join(target, "index.html"), "utf8");
    const canvas = canvasOf(html);
    const now = new Date().toISOString();
    const manifest: ProManifest = {
      engine: "hyperframes", rev: 1, entry: "index.html", canvas: { width: canvas.width, height: canvas.height }, durationSeconds: built.durationSeconds || canvas.duration,
      source, files: await manifestOf(target), openedAt: now, updatedAt: now, previews: []
    };
    return manifest;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function registerProRoutes(app: FastifyInstance) {
  // The editor routes need the pro entitlement; the preview GET below does not (it only serves the owner's own folder).
  app.addHook("preHandler", async (request, reply) => {
    const path = request.url.split("?")[0];
    if (!/^\/v1\/projects\/[^/]+\/pro(?:\/|$)/.test(path)) return;
    if (!isPro(callerId(request))) return fail(reply, 403, "not_pro", "The Pro editor is not part of this plan yet.");
  });

  app.get<{ Params: { id: string } }>("/v1/projects/:id/pro", async (request, reply) => {
    const project = await getProject(request.params.id);
    if (!project) return fail(reply, 404, "not_found", "Project not found.");
    return { pro: project.pro ?? null };
  });

  app.post<{ Params: { id: string }; Body: { source?: unknown; aspect?: unknown; durationSeconds?: unknown } | undefined }>("/v1/projects/:id/pro/open", async (request, reply) => {
    try {
      const project = await getProject(request.params.id);
      if (!project) return fail(reply, 404, "not_found", "Project not found.");
      if (project.pro) return { pro: project.pro, created: false };
      const body = request.body ?? {};
      const source = body.source === "blank" || !project.beatPlan ? "blank" : "beat-plan";
      const aspect = body.aspect === "9:16" || body.aspect === "1:1" ? body.aspect : "16:9";
      const durationSeconds = typeof body.durationSeconds === "number" && body.durationSeconds >= 1 && body.durationSeconds <= 120 ? body.durationSeconds : 10;
      const manifest = await openPro(project, source, { aspect, durationSeconds });
      // Re-check under the lock: a second tab may have opened the project while this one built its snapshot.
      let created = false;
      const saved = await updateProjectPro(project.id, async (current) => {
        if (current.pro) return undefined;
        created = true;
        return manifest;
      });
      if (!saved) return fail(reply, 404, "not_found", "Project not found.");
      return reply.code(created ? 201 : 200).send({ pro: saved.pro, created });
    } catch (error) {
      if (error instanceof Error && /Audio file .* is missing|Generate the plan first/.test(error.message)) return fail(reply, 409, "not_ready", error.message);
      return mapError(reply, error);
    }
  });

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>("/v1/projects/:id/pro/file", async (request, reply) => {
    try {
      const project = await getProject(request.params.id);
      if (!project?.pro) return fail(reply, 404, "not_found", "Open the project in the Pro editor first.");
      const path = proPath(request.query.path ?? project.pro.entry);
      const bytes = await readMedia(join(proDir(project.id), path));
      if (!bytes) return fail(reply, 404, "not_found", "That file does not exist.");
      return { path, content: bytes.toString("utf8"), rev: project.pro.rev };
    } catch (error) {
      return mapError(reply, error);
    }
  });

  // Claude proposes exact edits against the browser's current (possibly unsaved) source; the editor shows
  // the diff and its normal revisioned PUT saves only after the user applies it.
  app.post<{ Params: { id: string }; Body: { baseRev?: unknown; task?: unknown; target?: unknown; html?: unknown; stage?: unknown } }>("/v1/projects/:id/pro/assist", { bodyLimit: 2_200_000 }, async (request, reply) => {
    try {
      const project = await getProject(request.params.id);
      if (!project?.pro) return fail(reply, 404, "not_found", "Open the project in the Pro editor first.");
      requireRev(project.pro, request.body?.baseRev);
      const { task, target, html, stage } = request.body ?? {};
      if (stage !== undefined && !isAuthorStage(stage)) return fail(reply, 400, "invalid_request", "Unknown author stage.");
      if (typeof task !== "string" || typeof target !== "string" || typeof html !== "string" || task.length > 1200 || target.length > 200 || html.length > 2_000_000) return fail(reply, 400, "invalid_request", "Send a task, selected target and current composition HTML.");
      return await proposeCompositionEdit(task, target, html, fetch, stage);
    } catch (error) {
      if (error instanceof ProConflict || error instanceof ProInvalid) return mapError(reply, error);
      return fail(reply, 422, "author_failed", error instanceof Error ? error.message : "Could not propose an edit.");
    }
  });

  // A batch may hold several files up to PRO_LIMITS.fileBytes each; Fastify's default 1 MB body limit would cut that short.
  app.put<{ Params: { id: string }; Body: { baseRev?: unknown; files?: unknown } }>("/v1/projects/:id/pro/files", { bodyLimit: 6_000_000 }, async (request, reply) => {
    try {
      const id = request.params.id;
      const body = (request.body ?? {}) as { baseRev?: unknown; files?: unknown };
      let result: ProManifest | undefined;
      const saved = await updateProjectPro(id, async (current) => {
        const manifest = current.pro;
        if (!manifest) throw new ProInvalid("Open the project in the Pro editor first.", "not_open");
        requireRev(manifest, body.baseRev);
        const writes = checkWrites(manifest.files, body.files);
        // Keep what these writes replace, so a bad edit can be recovered. Only the touched files are copied.
        const previous = historyDir(id, manifest.rev);
        for (const w of writes) {
          const old = await readMedia(join(proDir(id), w.path));
          if (old) await saveMedia(join(previous, w.path), old);
        }
        const files = { ...manifest.files };
        for (const w of writes) {
          await saveMedia(join(proDir(id), w.path), w.content);
          files[w.path] = { size: Buffer.byteLength(w.content), sha256: sha256(w.content) };
        }
        const rev = manifest.rev + 1;
        if (rev > HISTORY_KEEP) await removeMedia(historyDir(id, rev - HISTORY_KEEP - 1));
        const html = writes.find((w) => w.path === manifest.entry)?.content;
        const canvas = html ? canvasOf(html) : null;
        result = { ...manifest, rev, files, updatedAt: new Date().toISOString(), ...(canvas ? { canvas: { width: canvas.width, height: canvas.height }, durationSeconds: canvas.duration } : {}) };
        return result;
      });
      if (!saved) return fail(reply, 404, "not_found", "Project not found.");
      return { rev: result!.rev, files: result!.files, updatedAt: result!.updatedAt };
    } catch (error) {
      if (error instanceof ProInvalid && error.code === "not_open") return fail(reply, 409, "not_open", error.message);
      return mapError(reply, error);
    }
  });

  app.post<{ Params: { id: string }; Body: { path?: unknown } | undefined }>("/v1/projects/:id/pro/lint", async (request, reply) => {
    try {
      const project = await getProject(request.params.id);
      if (!project?.pro) return fail(reply, 404, "not_found", "Open the project in the Pro editor first.");
      const path = proPath(request.body?.path ?? project.pro.entry);
      const bytes = await readMedia(join(proDir(project.id), path));
      if (!bytes) return fail(reply, 404, "not_found", "That file does not exist.");
      const result = await lintHyperframeHtml(bytes.toString("utf8"), { filePath: path, host: "studio" });
      return { rev: project.pro.rev, ok: result.ok, errorCount: result.errorCount, warningCount: result.warningCount, findings: result.findings.map((f) => ({ code: f.code, severity: f.severity, message: f.message, line: f.line, elementId: f.elementId, fixHint: f.fixHint })) };
    } catch (error) {
      return mapError(reply, error);
    }
  });

  /**
   * Renders the saved folder through the same queue and worker as every other render. A preview (540p / 720p) renders cheaply
   * and is scaled down; `final` renders the composition as written and is gated by lint errors. Only a final render becomes the
   * project's render (Review shows it): a preview never touches `renderJobId`, so syncProject ignores it.
   */
  app.post<{ Params: { id: string }; Body: { quality?: unknown } | undefined }>("/v1/projects/:id/pro/render", async (request, reply) => {
    try {
      const project = await getProject(request.params.id);
      if (!project?.pro) return fail(reply, 404, "not_found", "Open the project in the Pro editor first.");
      const pro = project.pro;
      const quality = request.body?.quality === undefined ? "draft540" : request.body.quality;
      if (!isPreviewQuality(quality)) return fail(reply, 400, "invalid_request", "`quality` must be draft540, preview720 or final.");

      if (quality === "final") {
        const entry = await readMedia(join(proDir(project.id), pro.entry));
        if (!entry) return fail(reply, 404, "not_found", "The composition file is missing.");
        const lint = await lintHyperframeHtml(entry.toString("utf8"), { filePath: pro.entry, host: "studio" });
        if (lint.errorCount > 0) return fail(reply, 409, "lint_errors", `${lint.errorCount} error${lint.errorCount === 1 ? "" : "s"} block a full render. Fix them in Checks.`, { findings: lint.findings.filter((f) => f.severity === "error").map((f) => ({ code: f.code, message: f.message, elementId: f.elementId, fixHint: f.fixHint })) });
      }

      const jobId = randomUUID();
      await ensureMediaDir(proDir(project.id));
      const staged = join(config.renderOutputDir, jobId, "project");
      await cp(proDir(project.id), staged, { recursive: true, filter: (source) => !source.includes(`${sep}.history`) });
      let projectPrefix: string | undefined;
      if (config.storageDriver === "r2") {
        projectPrefix = `jobs/${jobId}/project`;
        await uploadDirectory(staged, projectPrefix);
        await rm(join(config.renderOutputDir, jobId), { recursive: true, force: true });
      }

      const size = previewSize(pro.canvas, quality);
      const job: RenderJob = {
        id: jobId, state: "rendering", progress: 45, createdAt: new Date().toISOString(),
        revision: { id: randomUUID(), title: project.name, scenes: [{ id: "composition", label: "Composition", detail: quality === "final" ? "Full render" : `Preview ${size.height}p`, duration: pro.durationSeconds }] }
      };
      // The job is recorded on the project first, so a render that finishes quickly always finds its project.
      if (quality === "final") await updateProject(project.id, { state: "Rendering draft", renderJobId: jobId });
      else await updateProjectPro(project.id, async (current) => (current.pro ? { ...current.pro, previews: [{ jobId, quality, rev: current.pro.rev, createdAt: job.createdAt }, ...current.pro.previews].slice(0, 10) } : undefined));
      const created = await renderJobRepository.createReadyAndEnqueue(job, {
        request: project.request,
        projectId: project.id,
        renderInput: { kind: "pro", id: jobId, workerDir: `/renders/${jobId}/project`, ...(projectPrefix ? { projectPrefix } : {}), durationSeconds: pro.durationSeconds, quality, previewWidth: size.width, previewHeight: size.height }
      });
      return reply.code(202).send({ job: created, quality, size, rev: pro.rev });
    } catch (error) {
      return mapError(reply, error);
    }
  });

  /**
   * Serves the folder to the preview frame. The frame runs on THIS origin, which is not the app's, so it can load its own
   * scripts, images and fonts but cannot reach the app's cookies, storage or DOM (the iframe is sandboxed without top
   * navigation, forms or popups). The media token rides in the path (`/pro/@<token>/<file>`) because the page's relative URLs
   * do not inherit a `?t=` query. `__frame.html` is the shell the editor posts compositions into (contracts/frame.ts).
   * The CSP gives compositions their own files and nothing else: no network, no framing by other sites.
   */
  const frameAncestors = ["'self'", ...config.corsOrigins].join(" ");
  const csp = `default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-ancestors ${frameAncestors}`;
  app.get<{ Params: { id: string; tok: string; "*": string } }>("/v1/preview/projects/:id/pro/:tok/*", async (request, reply) => {
    if (!request.params.tok.startsWith("@")) return fail(reply, 404, "not_found", "That file does not exist.");
    const secure = (type: string) => reply.header("Content-Type", type).header("X-Content-Type-Options", "nosniff").header("Content-Security-Policy", csp).header("Cache-Control", "private, max-age=30");
    try {
      if (request.params["*"] === "__frame.html") return secure(MIME.html!).send(frameShellHtml());
      const rel = servePath(request.params["*"] || "index.html");
      const file = join(proDir(request.params.id), rel);
      if (!(await ensureMedia(file))) return fail(reply, 404, "not_found", "That file does not exist.");
      const bytes = await readFile(file);
      const type = MIME[extname(rel).slice(1).toLowerCase()];
      if (!type) return fail(reply, 404, "not_found", "That file does not exist.");
      return secure(type).header("Access-Control-Allow-Origin", "*").header("Cross-Origin-Resource-Policy", "cross-origin").send(bytes);
    } catch (error) {
      if (error instanceof ProInvalid) return fail(reply, 404, "not_found", "That file does not exist.");
      throw error;
    }
  });
}
