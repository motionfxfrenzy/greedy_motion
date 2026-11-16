import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VideoProject } from "@videosaas/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { callerId, isOpen } from "../auth.ts";
import { config } from "../config.ts";
import { pool } from "../db/database.ts";
import { upstreamError } from "../http-errors.ts";
import { getProject, projectOwner } from "../projects/store.ts";
import { presignKey, putObject, type Bucket } from "../storage.ts";
import { parseAssetRef } from "./pack-assets.ts";
import { NotDrawn, exportSceneTargets, type ExportSceneTarget } from "./exports.ts";
import { FPS, isAspect, type Aspect } from "./model.ts";

/**
 * Fast export: the browser that previews a plates film draws each scene's clip on the user's GPU while Preview is idle and
 * uploads it here, so the export worker (software GL, ~400 ms a frame) finds every clip in its cache and only joins them.
 *
 *   GET /v1/projects/:id/plates/clip-targets?aspect=…            scenes of that ratio whose clip is not cached yet
 *   PUT /v1/projects/:id/plates/clips?aspect=…&bundleDigest=…    one scene clip (video/mp4, the picture only)
 *
 * A clip is accepted only for a bundleDigest that is one of the project's current export targets, and only after ffprobe
 * shows exactly what the worker's own probe would accept (h264, the export size, 30 fps, frames === bundleFrames). It is
 * stored at the worker's `clipCacheKey` in the outputs bucket and recorded in `app.plate_clips` with
 * `clip_meta.source = "browser"`; the worker probes such rows again before trusting them.
 */

export const MAX_BROWSER_CLIP_BYTES = 80 * 1024 * 1024;
/** Uploads a project may make in one window (each scene once per revision; a comment fix re-encodes only its scene). */
export const BROWSER_CLIP_RATE = { max: 40, windowMs: 10 * 60_000 };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGEST = /^[A-Za-z0-9]{16,128}$/;
const notFound = { error: { code: "not_found", message: "Not found." } };
const SLUGS: Record<string, Aspect> = { "16-9": "16:9", "9-16": "9:16", "1-1": "1:1" };
const parseAspect = (raw: unknown): Aspect | null => (isAspect(raw) ? raw : typeof raw === "string" && SLUGS[raw] ? SLUGS[raw]! : null);

/** The worker's clip storage key (worker/src/plates.mjs `clipCacheKey`): the same string, so the worker's lookup finds it. */
export function clipCacheKey(projectId: string, bDigest: string, eDigest: string, fsDigest: string, width: number, height: number): string {
  return `plates/${projectId}/clips/${String(bDigest).slice(0, 32)}-${String(eDigest).slice(0, 12)}-${String(fsDigest).slice(0, 12)}-${width}x${height}.mp4`;
}

export type ClipFacts = { codec?: string; width?: number; height?: number; pixFmt?: string; fps: number; frames: number; duration: number; format?: string };

/**
 * ffprobe facts, read the way the worker's `probeVideo` reads them (packets counted on the first video stream). The demuxer is
 * pinned to MP4/MOV and only the local file protocol is allowed, so an uploaded playlist or concat script cannot make ffprobe
 * open anything else.
 */
export function probeClip(file: string, { ffprobe = "ffprobe", timeoutMs = 20_000 } = {}): Promise<ClipFacts> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobe, [
      "-v", "error", "-protocol_whitelist", "file", "-f", "mov", "-count_packets", "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,width,height,pix_fmt,r_frame_rate,nb_read_packets,duration:format=duration,format_name",
      "-of", "json", file
    ]);
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("ffprobe timed out.")); }, timeoutMs);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code) return reject(new Error(`ffprobe failed (${code}): ${err.slice(-300)}`));
      try {
        const parsed = JSON.parse(out) as { streams?: Record<string, unknown>[]; format?: { duration?: string; format_name?: string } };
        const s = parsed.streams?.[0] ?? {};
        const [num, den] = String(s.r_frame_rate ?? "0/1").split("/").map(Number);
        resolve({
          codec: s.codec_name as string | undefined,
          width: s.width as number | undefined,
          height: s.height as number | undefined,
          pixFmt: s.pix_fmt as string | undefined,
          fps: den ? num! / den : 0,
          frames: Number(s.nb_read_packets),
          duration: Number(s.duration ?? parsed.format?.duration ?? 0),
          format: parsed.format?.format_name
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

/** Why a probed clip cannot stand in for the worker's drawing of this scene, or null when it can. Mirrors `isClipProbeValid`. */
export function clipProblem(facts: ClipFacts, target: Pick<ExportSceneTarget, "width" | "height" | "bundleFrames">): string | null {
  if (facts.codec !== "h264") return `The clip must be H.264, not ${facts.codec ?? "unknown"}.`;
  if (facts.width !== target.width || facts.height !== target.height) return `The clip is ${facts.width}x${facts.height}, expected ${target.width}x${target.height}.`;
  if (Math.abs(Number(facts.fps) - FPS) > 1e-6) return `The clip is ${facts.fps} fps, expected ${FPS}.`;
  if (facts.frames !== target.bundleFrames) return `The clip has ${facts.frames} frames, expected ${target.bundleFrames}.`;
  if (facts.pixFmt && facts.pixFmt !== "yuv420p" && facts.pixFmt !== "yuvj420p") return `The clip's pixel format is ${facts.pixFmt}, expected yuv420p.`;
  return null;
}

/** MP4 files start with an `ftyp` box. */
export const looksLikeMp4 = (bytes: Buffer) => bytes.length > 12 && bytes.subarray(4, 8).toString("latin1") === "ftyp";

/** A fixed-window counter per project (one backend instance; enough to stop a runaway tab). */
export function createRateLimiter({ max, windowMs }: { max: number; windowMs: number }, now: () => number = Date.now) {
  const hits = new Map<string, { start: number; count: number }>();
  return (key: string): boolean => {
    const t = now();
    const cur = hits.get(key);
    if (!cur || t - cur.start >= windowMs) {
      hits.set(key, { start: t, count: 1 });
      if (hits.size > 10_000) for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
      return true;
    }
    if (cur.count >= max) return false;
    cur.count += 1;
    return true;
  };
}

export type BrowserClipRow = {
  bundleDigest: string; engineDigest: string; fontSetDigest: string; size: string;
  width: number; height: number; fps: number; frames: number; clipKey: string; clipMeta: Record<string, unknown>;
};

export type BrowserClipDeps = {
  enabled: () => boolean;
  getProject: (id: string) => Promise<VideoProject | null>;
  targets: (project: VideoProject, aspect: Aspect) => Promise<ExportSceneTarget[]>;
  probe: (file: string) => Promise<ClipFacts>;
  putClip: (key: string, bytes: Buffer) => Promise<void>;
  /** Inserts the cache row (`on conflict do nothing`); true when this call inserted it. */
  recordClip: (row: BrowserClipRow) => Promise<boolean>;
  presignBundle: (key: string) => Promise<string>;
  /** A short-lived link to one of the project's FULL-size template pictures (uploads or outputs bucket); never the smaller preview copy. */
  presignAsset: (bucket: Bucket, key: string) => Promise<string>;
  allow: (projectId: string) => boolean;
};

const defaultPresign = async (bucket: Bucket, key: string, seconds: number) => {
  if (config.storageDriver !== "r2") return `/local-storage/${bucket}/${encodeURIComponent(key)}?expires=${seconds}`;
  return presignKey(bucket, key, { seconds, contentType: "text/html" });
};

export const defaultBrowserClipDeps = (): BrowserClipDeps => ({
  // The clip cache lives in object storage: without R2 (local filesystem mode) the worker has nowhere to find it.
  enabled: () => config.storageDriver === "r2" && process.env.BROWSER_CLIPS !== "off",
  getProject,
  targets: exportSceneTargets,
  probe: (file) => probeClip(file),
  putClip: (key, bytes) => putObject("outputs", key, bytes, "video/mp4"),
  recordClip: async (row) => {
    const { rowCount } = await pool.query(
      `insert into app.plate_clips (bundle_digest, engine_digest, font_set_digest, size, width, height, fps, frames, clip_key, still_key, clip_meta, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, null, $10::jsonb, now())
       on conflict (bundle_digest, engine_digest, font_set_digest, size) do nothing`,
      [row.bundleDigest, row.engineDigest, row.fontSetDigest, row.size, row.width, row.height, row.fps, row.frames, row.clipKey, JSON.stringify(row.clipMeta)]
    );
    return (rowCount ?? 0) > 0;
  },
  presignBundle: (key) => defaultPresign("uploads", key, 900),
  presignAsset: async (bucket, key) => (config.storageDriver !== "r2" ? `/local-storage/${bucket}/${encodeURIComponent(key)}?expires=900` : presignKey(bucket, key, { seconds: 900 })),
  allow: createRateLimiter(BROWSER_CLIP_RATE)
});

/** The ownership hook (access.ts) already hides other users' projects; this repeats the check where bytes are written. */
const ownsProject = (request: FastifyRequest, project: VideoProject) => isOpen(request) || projectOwner(project) === callerId(request);

export async function registerBrowserClipRoutes(app: FastifyInstance, overrides: Partial<BrowserClipDeps> = {}) {
  const deps: BrowserClipDeps = { ...defaultBrowserClipDeps(), ...overrides };

  app.get<{ Params: { id: string }; Querystring: { aspect?: string } }>("/v1/projects/:id/plates/clip-targets", async (request, reply) => {
    const { id } = request.params;
    const aspect = parseAspect(request.query?.aspect);
    if (!uuid.test(id) || !aspect) return reply.code(404).send(notFound);
    const project = await deps.getProject(id);
    if (!project || !ownsProject(request, project)) return reply.code(404).send(notFound);
    reply.header("Cache-Control", "no-store");
    if (!deps.enabled()) return { aspect, enabled: false, total: 0, cached: 0, targets: [] };
    try {
      const all = await deps.targets(project, aspect);
      const missing = all.filter((t) => !t.hasClip);
      const targets = await Promise.all(missing.map(async (t) => ({
        index: t.index,
        variantId: t.variantId,
        bundleDigest: t.bundleDigest,
        bundleSha: t.bundleSha,
        bundleFrames: t.bundleFrames,
        width: t.width,
        height: t.height,
        fps: FPS,
        params: t.params,
        bundleUrl: await deps.presignBundle(t.bundleKey),
        // A scene with template pictures: links to the FULL pictures it is drawn with (depth maps that exist) and their digest.
        ...(t.assets && t.assetsDigest
          ? {
              assetsDigest: t.assetsDigest,
              assets: Object.fromEntries((await Promise.all(Object.entries(t.assets).map(async ([name, ref]) => {
                const parsed = parseAssetRef(ref);
                return parsed && parsed.key.startsWith(`plates/${id}/assets/`) ? [name, await deps.presignAsset(parsed.bucket, parsed.key)] as const : null;
              }))).filter((e): e is readonly [string, string] => e !== null))
            }
          : {})
      })));
      return { aspect, enabled: true, total: all.length, cached: all.length - missing.length, targets };
    } catch (error) {
      if (error instanceof NotDrawn) return { aspect, enabled: true, state: error.state, total: 0, cached: 0, targets: [] };
      return reply.code(409).send(upstreamError(request, error, "plates", "Could not list the scene clips."));
    }
  });

  await app.register(async (scope) => {
    scope.addContentTypeParser("video/mp4", { parseAs: "buffer", bodyLimit: MAX_BROWSER_CLIP_BYTES }, (_request, body, done) => done(null, body));
    scope.put<{ Params: { id: string }; Querystring: { aspect?: string; bundleDigest?: string; assetsDigest?: string } }>("/v1/projects/:id/plates/clips", { bodyLimit: MAX_BROWSER_CLIP_BYTES }, async (request, reply) => {
      const { id } = request.params;
      const aspect = parseAspect(request.query?.aspect);
      const digest = typeof request.query?.bundleDigest === "string" ? request.query.bundleDigest.trim() : "";
      if (!uuid.test(id) || !aspect) return reply.code(404).send(notFound);
      if (!DIGEST.test(digest)) return reply.code(400).send({ error: { code: "invalid_clip", message: "bundleDigest is missing or malformed." } });
      const body = request.body;
      if (!Buffer.isBuffer(body) || !looksLikeMp4(body)) return reply.code(415).send({ error: { code: "invalid_clip", message: "Send the clip as video/mp4." } });
      const project = await deps.getProject(id);
      if (!project || !ownsProject(request, project)) return reply.code(404).send(notFound);
      if (!deps.enabled()) return reply.code(409).send({ error: { code: "unavailable", message: "Browser clips are not used here." } });
      if (!deps.allow(id)) return reply.code(429).send({ error: { code: "rate_limited", message: "Too many clips for this project; the export will draw the rest." } });

      let targets: ExportSceneTarget[];
      try {
        targets = await deps.targets(project, aspect);
      } catch (error) {
        if (error instanceof NotDrawn) return reply.code(409).send({ error: { code: "not_drawn", message: error.message } });
        return reply.code(409).send(upstreamError(request, error, "plates", "Could not check the scene."));
      }
      // A scene with template pictures is one clip per (bundle, pictures): the browser says which pictures it drew with.
      const pictureDigest = typeof request.query?.assetsDigest === "string" ? request.query.assetsDigest.trim() : "";
      const target = targets.find((t) => t.bundleDigest === digest && (t.assetsDigest ?? "") === pictureDigest);
      if (!target) return reply.code(409).send({ error: { code: "stale_scene", message: "That scene is not part of this film any more." } });
      if (target.hasClip) return reply.code(200).send({ ok: true, duplicate: true, index: target.index });

      const dir = await mkdtemp(join(tmpdir(), "browser-clip-"));
      try {
        const file = join(dir, "clip.mp4");
        await writeFile(file, body);
        let facts: ClipFacts;
        try {
          facts = await deps.probe(file);
        } catch {
          return reply.code(422).send({ error: { code: "invalid_clip", message: "The clip could not be read as MP4." } });
        }
        const problem = clipProblem(facts, target);
        if (problem) return reply.code(422).send({ error: { code: "invalid_clip", message: problem }, facts });

        const clipKey = clipCacheKey(project.id, target.cacheDigest, target.engineDigest, target.fontSetDigest, target.width, target.height);
        await deps.putClip(clipKey, body);
        const inserted = await deps.recordClip({
          bundleDigest: target.cacheDigest,
          engineDigest: target.engineDigest,
          fontSetDigest: target.fontSetDigest,
          size: target.size,
          width: target.width,
          height: target.height,
          fps: FPS,
          frames: target.bundleFrames,
          clipKey,
          clipMeta: { source: "browser", bytes: body.length, variantId: target.variantId, gen: target.gen, rev: target.rev, uploadedAt: new Date().toISOString() }
        });
        return reply.code(inserted ? 201 : 200).send({ ok: true, duplicate: !inserted, index: target.index });
      } catch (error) {
        return reply.code(502).send(upstreamError(request, error, "plates", "Could not store the clip."));
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    });
  });
}
