import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { callerId } from "../auth.ts";
import { config } from "../config.ts";
import { presignOutput } from "../storage.ts";
import { renderEvents, type SceneNotice } from "./events.ts";
import { clipOutput, clipThumb, currentClips, scheduleDraw, type SceneClipView } from "./scenes.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = { error: { code: "not_found", message: "Not found." } };
/** One thumbnail read per clip at most this often, however fast frames are drawn. */
const THUMB_EVERY_MS = 700;

/**
 * The Preview's scene drawing (render/scenes.ts). Ownership of the project is checked by the access hook (access.ts),
 * as for every /v1/projects/:id route; the clip video also takes a media token (auth.ts) because a <video> sends no header.
 */
export async function registerSceneRoutes(app: FastifyInstance) {
  /** Draws the film's scenes in the background (debounced; unchanged scenes keep their clips). Free: tokens are taken at the final render. */
  app.post<{ Params: { id: string } }>("/v1/projects/:id/scenes/draw", async (request, reply) => {
    if (!uuid.test(request.params.id)) return reply.code(404).send(notFound);
    scheduleDraw(request.params.id, callerId(request));
    return reply.code(202).send({ clips: await currentClips(request.params.id) });
  });

  app.get<{ Params: { id: string } }>("/v1/projects/:id/scenes", async (request, reply) => {
    if (!uuid.test(request.params.id)) return reply.code(404).send(notFound);
    return { clips: await currentClips(request.params.id) };
  });

  /**
   * The scenes as server-sent events, the way the script streams on the Storyboard: the clip list at once, then a tick per
   * progress change, the list again when a clip changes state, and the latest drawn frame as it is drawn. Pushed by the
   * LISTEN hub (events.ts); without it, the list is reloaded every 3 s.
   */
  // Hijacked streams are not closed by the server on shutdown; end them first so closing does not wait for each client to leave.
  const sceneStreams = new Set<() => void>();
  app.addHook("preClose", async () => { for (const end of [...sceneStreams]) end(); });

  app.get<{ Params: { id: string } }>("/v1/projects/:id/scenes/events", async (request, reply) => {
    const projectId = request.params.id;
    if (!uuid.test(projectId)) return reply.code(404).send(notFound);
    const first = await currentClips(projectId);
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
    let closed = false;
    const send = (event: Record<string, unknown>) => { if (!closed) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`); };
    let ids = new Set(first.map((clip) => clip.id));
    const shown = new Map<string, number>();
    const reading = new Set<string>();
    const thumb = (id: string, frame: number | null) => {
      if (frame === null || shown.get(id) === frame || reading.has(id)) return;
      reading.add(id);
      void clipThumb(projectId, id).then((found) => {
        if (found && !closed) { shown.set(id, found.frame ?? frame); send({ type: "thumb", id, frame: found.frame, image: `data:image/jpeg;base64,${found.image.toString("base64")}` }); }
      }).catch(() => undefined).finally(() => setTimeout(() => reading.delete(id), THUMB_EVERY_MS));
    };
    let loading = false;
    let again = false;
    const reload = async () => {
      if (loading) { again = true; return; }
      loading = true;
      try {
        do {
          again = false;
          const clips: SceneClipView[] = await currentClips(projectId);
          ids = new Set(clips.map((clip) => clip.id));
          send({ type: "clips", clips });
          for (const clip of clips) if (clip.state !== "queued") thumb(clip.id, clip.thumbFrame);
        } while (again && !closed);
      } catch { /* the next change or the timer tries again */ } finally { loading = false; }
    };
    const onNotice = (notice: SceneNotice) => {
      if (notice.reload || !ids.has(notice.id)) { void reload(); return; }
      send({ type: "tick", id: notice.id, state: notice.state, framesDone: notice.framesDone ?? 0, framesTotal: notice.framesTotal });
      thumb(notice.id, notice.thumbFrame);
    };
    const unwatch = renderEvents.watchScenes(projectId, onNotice);
    const fallback = setInterval(() => { if (!renderEvents.live) void reload(); }, 3000);
    const ping = setInterval(() => { if (!closed) reply.raw.write(": ping\n\n"); }, 20_000);
    const end = () => { closed = true; sceneStreams.delete(end); unwatch(); clearInterval(fallback); clearInterval(ping); if (!reply.raw.writableEnded) reply.raw.end(); };
    sceneStreams.add(end);
    request.raw.on("close", end);
    send({ type: "clips", clips: first });
    for (const clip of first) if (clip.state !== "queued") thumb(clip.id, clip.thumbFrame);
  });

  /** A drawn scene clip (video only), so the person can watch what was actually drawn. */
  app.get<{ Params: { id: string; clipId: string } }>("/v1/projects/:id/scenes/:clipId/clip", async (request, reply) => {
    const { id, clipId } = request.params;
    if (!uuid.test(id) || !uuid.test(clipId)) return reply.code(404).send(notFound);
    const output = await clipOutput(id, clipId);
    if (output?.key && config.storageDriver === "r2") return reply.header("Cache-Control", "no-store").redirect(await presignOutput(output.key), 302);
    if (!output?.file || !/^scenes\/[0-9a-f-]{36}\/clips\/[0-9a-f]{64}\.mp4$/i.test(output.file)) return reply.code(404).send(notFound);
    const file = join(config.renderOutputDir, output.file);
    const size = await stat(file).then((info) => info.size).catch(() => null);
    if (size === null) return reply.code(404).send(notFound);
    // Clips are named by their signature, so a URL never changes what it shows.
    reply.header("Content-Type", "video/mp4").header("Accept-Ranges", "bytes").header("Cache-Control", "private, max-age=86400");
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
    if (!range) return reply.header("Content-Length", size).send(createReadStream(file));
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return reply.code(416).header("Content-Range", `bytes */${size}`).send();
    return reply.code(206).header("Content-Range", `bytes ${start}-${end}/${size}`).header("Content-Length", end - start + 1).send(createReadStream(file, { start, end }));
  });
}
