import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { tierFor } from "../billing/service.ts";
import { config } from "../config.ts";
import { registerRequestId, upstreamError } from "../http-errors.ts";
import { projectOwner, getProject } from "../projects/store.ts";
import { PLANS } from "../tokens/plan.ts";
import { presignKey, safeDownloadFilename, type Bucket } from "../storage.ts";
import { bundleDigest } from "./digest.ts";
import { NotDrawn, currentExport, requestExport } from "./exports.ts";
import { desiredVariants, isPlateLook } from "./inputs.ts";
import { aspectSlug, isAspect, primaryAspect, type Aspect } from "./model.ts";
import { addPlateComment, drawAspectPlates, fixPlates, plateStatus, removePlateComment, setPlateSubtitles, startPlates } from "./service.ts";
import { getCachedClip, getRevision, getVariant, listVariants, matchVariantsToDesired, requestVariantClip, submitCheckReport, type CheckReportInput, type VariantRow } from "./store.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = { error: { code: "not_found", message: "Not found." } };
const slugAspect = (slug: string): Aspect | null => slug === "16-9" ? "16:9" : slug === "9-16" ? "9:16" : slug === "1-1" ? "1:1" : null;
const slugOf = (aspect: Aspect) => aspect === "16:9" ? "16-9" : aspect === "9:16" ? "9-16" : "1-1";
const BUNDLE_STATES = new Set(["bundled", "checked", "rendering", "drawn"]);
const MAX_CHECK_PART_BYTES = 16_384;

const isPlainObject = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const withinBytes = (v: unknown, maxBytes: number): boolean => {
  try {
    return Buffer.byteLength(JSON.stringify(v), "utf8") <= maxBytes;
  } catch {
    return false;
  }
};

const defaultPresign: typeof presignKey = async (bucket: Bucket, key: string, options = {}) => {
  if (config.storageDriver !== "r2") {
    const fn = options.filename ? `&disposition=attachment&filename=${encodeURIComponent(options.filename.replace(/[^\w.\- ]/g, "_"))}` : "";
    return `/local-storage/${bucket}/${encodeURIComponent(key)}?expires=${options.seconds ?? 3600}${fn}`;
  }
  return presignKey(bucket, key, options);
};

const PLATE_DOMAIN_MESSAGES = new Set([
  "This project's style is not a code-drawn plate style.",
  "Write the script and storyboard first.",
  "Aspect must be 16:9, 9:16, or 1:1.",
  "Write what should change.",
  "Pick a moment in the film.",
  "Add a comment first.",
  "Wait for the scenes that are being drawn."
]);

const isPlateDomainError = (error: unknown): error is Error =>
  error instanceof Error && PLATE_DOMAIN_MESSAGES.has(error.message);

/** Code-drawn plate scenes. Ownership is checked by the access hook as for every /v1/projects/:id route; every file is served from object storage. */
export async function registerPlateRoutes(app: FastifyInstance, options?: { presign?: typeof presignKey }) {
  registerRequestId(app);
  const signKey = options?.presign ?? defaultPresign;

  app.get<{ Params: { id: string } }>("/v1/projects/:id/plates", async (request, reply) => {
    if (!uuid.test(request.params.id)) return reply.code(404).send(notFound);
    return plateStatus(request.params.id);
  });

  /** Starts (or resumes) drawing every scene of the storyboard. Unchanged scenes keep their clips; the work continues on the queues. */
  app.post<{ Params: { id: string } }>("/v1/projects/:id/plates/draw", async (request, reply) => {
    if (!uuid.test(request.params.id)) return reply.code(404).send(notFound);
    try { return reply.code(202).send(await startPlates(request.params.id)); }
    catch (error) {
      if (isPlateDomainError(error)) return reply.code(409).send({ error: { code: "plates", message: error.message } });
      return reply.code(409).send(upstreamError(request, error, "plates", "Could not draw the scenes."));
    }
  });

  app.post<{ Params: { id: string }; Body: { at?: number; body?: string } }>("/v1/projects/:id/plates/comments", async (request, reply) => {
    if (!uuid.test(request.params.id)) return reply.code(404).send(notFound);
    try { return reply.code(201).send(await addPlateComment(request.params.id, { at: request.body?.at, body: request.body?.body })); }
    catch (error) {
      if (isPlateDomainError(error)) return reply.code(400).send({ error: { code: "plates", message: error.message } });
      return reply.code(400).send(upstreamError(request, error, "plates", "Could not add the comment."));
    }
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
    catch (error) {
      if (isPlateDomainError(error)) return reply.code(409).send({ error: { code: "plates", message: error.message } });
      return reply.code(409).send(upstreamError(request, error, "plates", "Could not redraw the scenes."));
    }
  });
  app.post<{ Params: { id: string }; Body: { aspect?: string } }>("/v1/projects/:id/plates/draw-aspect", async (request, reply) => {
    if (!uuid.test(request.params.id)) return reply.code(404).send(notFound);
    const aspect = request.body?.aspect;
    if (!isAspect(aspect)) return reply.code(400).send({ error: { code: "invalid_aspect", message: "Aspect must be 16:9, 9:16, or 1:1." } });
    try { return reply.code(202).send(await drawAspectPlates(request.params.id, aspect)); }
    catch (error) {
      if (isPlateDomainError(error)) return reply.code(409).send({ error: { code: "plates", message: error.message } });
      return reply.code(409).send(upstreamError(request, error, "plates", "Could not draw this dimension."));
    }
  });

  /** Short-lived bundle URL, manifest, digest and current revision params for live browser execution. */
  app.get<{ Params: { id: string; variantId: string } }>("/v1/projects/:id/plates/:variantId/bundle", async (request, reply) => {
    const { id, variantId } = request.params;
    if (!uuid.test(id) || !uuid.test(variantId)) return reply.code(404).send(notFound);
    const row = await getVariant(variantId);
    if (!row || row.project_id !== id || !BUNDLE_STATES.has(row.state) || !row.bundle_key) {
      return reply.code(404).send(notFound);
    }
    const rev = await getRevision(row.id, row.rev);
    const params = rev?.params ?? {};
    const digest = row.bundle_digest ?? rev?.bundle_digest ?? bundleDigest({ manifest: row.bundle_manifest, params });
    const seconds = 900;
    const expiresAt = new Date(Date.now() + seconds * 1000).toISOString();
    const url = await signKey("uploads", row.bundle_key, { seconds, contentType: "text/html" });
    return reply
      .header("Cache-Control", "no-store")
      .code(200)
      .send({ url, expiresAt, bundleDigest: digest, gen: row.gen, rev: row.rev, manifest: row.bundle_manifest ?? {}, params });
  });

  /** Fenced, idempotent browser check report for a live variant. */
  app.post<{ Params: { id: string; variantId: string }; Body: Record<string, unknown> }>(
    "/v1/projects/:id/plates/:variantId/check",
    async (request, reply) => {
      const { id, variantId } = request.params;
      if (!uuid.test(id) || !uuid.test(variantId)) return reply.code(404).send(notFound);
      const body = request.body;
      if (!isPlainObject(body)) {
        return reply.code(400).send({ code: "invalid_check", error: { code: "invalid_check", message: "Request body must be a JSON object." } });
      }
      const { gen, bundleDigest: digest, host, device, results } = body;
      if (typeof gen !== "number" || !Number.isInteger(gen) || gen < 1) {
        return reply.code(400).send({ code: "invalid_check", error: { code: "invalid_check", message: "gen must be a positive integer." } });
      }
      if (typeof digest !== "string" || !digest.trim() || digest.length > 128) {
        return reply.code(400).send({ code: "invalid_check", error: { code: "invalid_check", message: "bundleDigest must be a non-empty string." } });
      }
      if (host !== "worker") {
        return reply.code(400).send({ code: "invalid_check", error: { code: "invalid_check", message: 'host must be "worker".' } });
      }
      if (device !== undefined && (!isPlainObject(device) || !withinBytes(device, MAX_CHECK_PART_BYTES))) {
        return reply.code(400).send({ code: "invalid_check", error: { code: "invalid_check", message: "device must be an object of at most 16 KB." } });
      }
      if (!isPlainObject(results) || typeof results.ok !== "boolean" || !withinBytes(results, MAX_CHECK_PART_BYTES)) {
        return reply.code(400).send({ code: "invalid_check", error: { code: "invalid_check", message: "results must be an object with boolean ok and at most 16 KB." } });
      }
      if (results.ok === false && results.kind !== "code" && results.kind !== "env") {
        return reply.code(400).send({ code: "invalid_check", error: { code: "invalid_check", message: 'Failed check results must specify kind "code" or "env".' } });
      }

      const outcome = await submitCheckReport(
        variantId,
        {
          gen,
          bundleDigest: digest,
          host,
          ...(device ? { device } : {}),
          results: results as CheckReportInput["results"]
        },
        id
      );

      if (outcome.status === "not_found") return reply.code(404).send(notFound);
      if (outcome.status === "not_live") {
        return reply.code(409).send({ code: "not_live", error: { code: "not_live", message: "This project is not in live preview mode." } });
      }
      if (outcome.status === "invalid_host") {
        return reply.code(400).send({ code: "invalid_check", error: { code: "invalid_check", message: 'host must be "worker".' } });
      }
      if (outcome.status === "dropped") {
        return reply.code(204).send();
      }
      return reply.code(200).send(outcome.body);
    }
  );

  /** Fallback clip request: enqueues `plate-render` once for a `bundled` or `checked` variant, capped per project. */
  app.post<{ Params: { id: string; variantId: string } }>("/v1/projects/:id/plates/:variantId/clip-request", async (request, reply) => {
    const { id, variantId } = request.params;
    if (!uuid.test(id) || !uuid.test(variantId)) return reply.code(404).send(notFound);
    const outcome = await requestVariantClip(id, variantId);
    if (outcome.status === "not_found") return reply.code(404).send(notFound);
    if (outcome.status === "invalid_state") {
      return reply.code(409).send({ code: "invalid_state", error: { code: "invalid_state", message: "Scene is not in bundled or checked state." } });
    }
    if (outcome.status === "clip_cap") {
      return reply.code(429).send({ code: "clip_cap", error: { code: "clip_cap", message: "Too many preview clips are already queued or rendering for this project." } });
    }
    return reply.code(202).send(outcome.body);
  });

  async function resolveCompatibleVariant(projectId: string, sceneIndex: number, requestedAspect?: string): Promise<VariantRow | undefined> {
    const [project, allVariants] = await Promise.all([getProject(projectId), listVariants(projectId)]);
    const aspect = isAspect(requestedAspect) ? requestedAspect : project ? primaryAspect(project) : "16:9";
    if (project && isPlateLook(project.brief?.look) && (project.brief?.scriptBeats?.length ?? 0) > 0) {
      const desired = await desiredVariants(project, [aspect], allVariants);
      const { matched } = matchVariantsToDesired(
        allVariants.filter((v) => v.aspect === aspect),
        desired,
        { allowSyntheticSignature: true }
      );
      return matched.get(`${sceneIndex}:${aspect}`)?.row;
    }
    return allVariants.find((v) => v.scene_index === sceneIndex && v.aspect === aspect);
  }

  /** A scene's clip: a short-lived link into object storage (the browser's player does its own range requests there). */
  app.get<{ Params: { id: string; index: string }; Querystring: { aspect?: string } }>("/v1/projects/:id/plates/:index/clip", async (request, reply) => {
    const { id, index } = request.params;
    if (!uuid.test(id) || !/^\d{1,2}$/.test(index)) return reply.code(404).send(notFound);
    const row = await resolveCompatibleVariant(id, Number(index), request.query.aspect);
    let clipKey = row?.clip_key ?? null;
    if (!clipKey && row?.bundle_digest) {
      const cached = await getCachedClip(row.bundle_digest, row.width, row.height);
      clipKey = cached?.clip_key ?? null;
    }
    if (!clipKey) return reply.code(404).send(notFound);
    return reply.header("Cache-Control", "no-store").redirect(await signKey("outputs", clipKey, { seconds: 900, contentType: "video/mp4" }), 302);
  });

  /** A scene's verified mid-scene still. */
  app.get<{ Params: { id: string; index: string }; Querystring: { aspect?: string } }>("/v1/projects/:id/plates/:index/still", async (request, reply) => {
    const { id, index } = request.params;
    if (!uuid.test(id) || !/^\d{1,2}$/.test(index)) return reply.code(404).send(notFound);
    const row = await resolveCompatibleVariant(id, Number(index), request.query.aspect);
    let stillKey = row?.still_key ?? null;
    if (!stillKey && row?.bundle_digest) {
      const cached = await getCachedClip(row.bundle_digest, row.width, row.height);
      stillKey = cached?.still_key ?? null;
    }
    if (!stillKey) return reply.code(404).send(notFound);
    return reply.header("Cache-Control", "no-store").redirect(await signKey("outputs", stillKey, { seconds: 900, contentType: "image/png" }), 302);
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
      return reply.code(row.state === "ready" ? 200 : 202).send({
        state: row.state,
        progress: row.progress,
        stage: row.stage,
        aspect,
        signature: row.signature,
        ...(row.state === "ready" ? { url: `/v1/projects/${id}/plates/export/${slugOf(aspect)}?v=${encodeURIComponent(row.signature)}` } : {}),
        ...(row.state === "failed" ? { error: row.error?.message ?? "The export failed." } : {})
      });
    } catch (error) {
      if (error instanceof NotDrawn) return reply.code(202).send({ state: error.state === "failed" ? "failed" : "drawing", progress: 0, aspect, error: error.state === "failed" ? error.message : undefined });
      if (isPlateDomainError(error)) return reply.code(409).send({ error: { code: "plates", message: error.message } });
      return reply.code(409).send(upstreamError(request, error, "plates", "Could not start the export."));
    }
  });

  app.get<{ Params: { id: string; aspect: string }; Querystring: { download?: string; filename?: string; v?: string } }>("/v1/projects/:id/plates/export/:aspect", async (request, reply) => {
    const { id } = request.params;
    const aspect = slugAspect(request.params.aspect);
    if (!uuid.test(id) || !aspect) return reply.code(404).send(notFound);
    const vParam = typeof request.query?.v === "string" ? request.query.v.trim() : undefined;
    const row = await currentExport(id, aspect, vParam);
    if (!row) return reply.code(404).send(notFound);
    if (row.state !== "ready" || !row.output_key) return reply.code(409).send({ error: { code: "export_not_ready", message: "This export is not finished yet." }, state: row.state, progress: row.progress });

    const dlParam = typeof request.query?.download === "string" ? request.query.download.trim() : "";
    const fnParam = typeof request.query?.filename === "string" ? request.query.filename.trim() : "";
    const wantDownload = Boolean((dlParam && dlParam !== "0" && dlParam !== "false") || fnParam);
    const requestedName = fnParam || (dlParam && dlParam !== "1" && dlParam !== "true" ? dlParam : undefined);
    const downloadFilename = wantDownload ? safeDownloadFilename(requestedName, `${id}-${aspectSlug(aspect)}.mp4`) : undefined;

    if (config.storageDriver !== "r2" && !options?.presign && /^plates\/[0-9a-f-]{36}\//i.test(row.output_key)) {
      const localFile = join(config.renderOutputDir, row.output_key);
      const size = await stat(localFile).then((info) => info.size).catch(() => null);
      if (size !== null) {
        reply.header("Content-Type", "video/mp4").header("Accept-Ranges", "bytes").header("Cache-Control", "no-store");
        if (downloadFilename) {
          reply.header("Content-Disposition", `attachment; filename="${downloadFilename}"`);
        }
        const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
        if (!range) return reply.header("Content-Length", size).send(createReadStream(localFile));
        const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (start >= size || start > end) return reply.code(416).header("Content-Range", `bytes */${size}`).send();
        return reply.code(206)
          .header("Content-Range", `bytes ${start}-${end}/${size}`)
          .header("Content-Length", end - start + 1)
          .send(createReadStream(localFile, { start, end }));
      }
    }

    return reply
      .header("Cache-Control", "no-store")
      .redirect(
        await signKey("outputs", row.output_key, {
          seconds: 900,
          ...(downloadFilename ? { filename: downloadFilename } : {}),
          contentType: "video/mp4"
        }),
        302
      );
  });
}
