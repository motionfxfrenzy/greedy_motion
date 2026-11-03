import type { FastifyInstance } from "fastify";
import { tierFor } from "../billing/service.ts";
import { projectOwner, getProject } from "../projects/store.ts";
import { PLANS } from "../tokens/plan.ts";
import { presignKey } from "../storage.ts";
import { NotDrawn, currentExport, requestExport } from "./exports.ts";
import { isAspect, primaryAspect, type Aspect } from "./model.ts";
import { addPlateComment, drawAspectPlates, fixPlates, plateStatus, removePlateComment, setPlateSubtitles, startPlates } from "./service.ts";
import { listVariants } from "./store.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = { error: { code: "not_found", message: "Not found." } };
const slugAspect = (slug: string): Aspect | null => slug === "16-9" ? "16:9" : slug === "9-16" ? "9:16" : slug === "1-1" ? "1:1" : null;
const slugOf = (aspect: Aspect) => aspect === "16:9" ? "16-9" : aspect === "9:16" ? "9-16" : "1-1";

/** Code-drawn plate scenes. Ownership is checked by the access hook as for every /v1/projects/:id route; every file is served from object storage. */
export async function registerPlateRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/v1/projects/:id/plates", async (request, reply) => {
    if (!uuid.test(request.params.id)) return reply.code(404).send(notFound);
    return plateStatus(request.params.id);
  });

  /** Starts (or resumes) drawing every scene of the storyboard. Unchanged scenes keep their clips; the work continues on the queues. */
  app.post<{ Params: { id: string } }>("/v1/projects/:id/plates/draw", async (request, reply) => {
    if (!uuid.test(request.params.id)) return reply.code(404).send(notFound);
    try { return reply.code(202).send(await startPlates(request.params.id)); }
    catch (error) { return reply.code(409).send({ error: { code: "plates", message: error instanceof Error ? error.message : "Could not draw the scenes." } }); }
  });

  app.post<{ Params: { id: string }; Body: { at?: number; body?: string } }>("/v1/projects/:id/plates/comments", async (request, reply) => {
    if (!uuid.test(request.params.id)) return reply.code(404).send(notFound);
    try { return reply.code(201).send(await addPlateComment(request.params.id, { at: request.body?.at, body: request.body?.body })); }
    catch (error) { return reply.code(400).send({ error: { code: "plates", message: error instanceof Error ? error.message : "Could not add the comment." } }); }
  });
  app.delete<{ Params: { id: string; commentId: string } }>("/v1/projects/:id/plates/comments/:commentId", async (request, reply) => {
    if (!uuid.test(request.params.id) || !/^[0-9a-f]{12}$/.test(request.params.commentId)) return reply.code(404).send(notFound);
    await removePlateComment(request.params.id, request.params.commentId);
    return reply.code(204).send();
  });
  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>("/v1/projects/:id/plates/subtitles", async (request, reply) => {
    if (!uuid.test(request.params.id)) return reply.code(404).send(notFound);
    return setPlateSubtitles(request.params.id, request.body ?? {});
  });
  app.post<{ Params: { id: string } }>("/v1/projects/:id/plates/fix", async (request, reply) => {
    if (!uuid.test(request.params.id)) return reply.code(404).send(notFound);
    try { return reply.code(202).send(await fixPlates(request.params.id)); }
    catch (error) { return reply.code(409).send({ error: { code: "plates", message: error instanceof Error ? error.message : "Could not redraw the scenes." } }); }
  });
  app.post<{ Params: { id: string }; Body: { aspect?: string } }>("/v1/projects/:id/plates/draw-aspect", async (request, reply) => {
    if (!uuid.test(request.params.id)) return reply.code(404).send(notFound);
    const aspect = request.body?.aspect;
    if (!isAspect(aspect)) return reply.code(400).send({ error: { code: "invalid_aspect", message: "Aspect must be 16:9, 9:16, or 1:1." } });
    try { return reply.code(202).send(await drawAspectPlates(request.params.id, aspect)); }
    catch (error) { return reply.code(409).send({ error: { code: "plates", message: error instanceof Error ? error.message : "Could not draw this dimension." } }); }
  });

  /** A scene's clip: a short-lived link into object storage (the browser's player does its own range requests there). */
  app.get<{ Params: { id: string; index: string }; Querystring: { aspect?: string } }>("/v1/projects/:id/plates/:index/clip", async (request, reply) => {
    const { id, index } = request.params;
    if (!uuid.test(id) || !/^\d{1,2}$/.test(index)) return reply.code(404).send(notFound);
    const project = await getProject(id);
    const aspect = isAspect(request.query.aspect) ? request.query.aspect : project ? primaryAspect(project) : "16:9";
    const row = (await listVariants(id)).find((v) => v.scene_index === Number(index) && v.aspect === aspect && v.clip_key);
    if (!row?.clip_key) return reply.code(404).send(notFound);
    return reply.header("Cache-Control", "no-store").redirect(await presignKey("outputs", row.clip_key, { seconds: 900, contentType: "video/mp4" }), 302);
  });

  /** A scene's verified mid-scene still. */
  app.get<{ Params: { id: string; index: string }; Querystring: { aspect?: string } }>("/v1/projects/:id/plates/:index/still", async (request, reply) => {
    const { id, index } = request.params;
    if (!uuid.test(id) || !/^\d{1,2}$/.test(index)) return reply.code(404).send(notFound);
    const project = await getProject(id);
    const aspect = isAspect(request.query.aspect) ? request.query.aspect : project ? primaryAspect(project) : "16:9";
    const row = (await listVariants(id)).find((v) => v.scene_index === Number(index) && v.aspect === aspect && v.still_key);
    if (!row?.still_key) return reply.code(404).send(notFound);
    return reply.header("Cache-Control", "no-store").redirect(await presignKey("outputs", row.still_key, { seconds: 900, contentType: "image/png" }), 302);
  });

  /**
   * Companion export of one ratio, at no token cost. POST requests it (idempotent: an unchanged film returns the same finished
   * file); the answer says where it stands. GET .../export/<ratio> downloads the finished file.
   */
  app.post<{ Params: { id: string }; Body: { aspect?: string } }>("/v1/projects/:id/plates/export", async (request, reply) => {
    const { id } = request.params;
    const aspect = request.body?.aspect;
    if (!uuid.test(id) || !isAspect(aspect)) return reply.code(404).send(notFound);
    const project = await getProject(id);
    if (!project) return reply.code(404).send(notFound);
    try {
      const watermark = PLANS[await tierFor(projectOwner(project))].watermark;
      const row = await requestExport(project, aspect, watermark);
      return reply.code(row.state === "ready" ? 200 : 202).send({ state: row.state, progress: row.progress, stage: row.stage, aspect, ...(row.state === "ready" ? { url: `/v1/projects/${id}/plates/export/${slugOf(aspect)}` } : {}), ...(row.state === "failed" ? { error: row.error?.message ?? "The export failed." } : {}) });
    } catch (error) {
      if (error instanceof NotDrawn) return reply.code(202).send({ state: error.state === "failed" ? "failed" : "drawing", progress: 0, aspect, error: error.state === "failed" ? error.message : undefined });
      return reply.code(409).send({ error: { code: "plates", message: error instanceof Error ? error.message : "Could not start the export." } });
    }
  });

  app.get<{ Params: { id: string; aspect: string } }>("/v1/projects/:id/plates/export/:aspect", async (request, reply) => {
    const { id } = request.params;
    const aspect = slugAspect(request.params.aspect);
    if (!uuid.test(id) || !aspect) return reply.code(404).send(notFound);
    const row = await currentExport(id, aspect);
    if (!row) return reply.code(404).send(notFound);
    if (row.state !== "ready" || !row.output_key) return reply.code(409).send({ error: { code: "export_not_ready", message: "This export is not finished yet." }, state: row.state, progress: row.progress });
    return reply.header("Cache-Control", "no-store").redirect(await presignKey("outputs", row.output_key, { seconds: 900, filename: `film-${slugOf(aspect)}.mp4`, contentType: "video/mp4" }), 302);
  });
}
