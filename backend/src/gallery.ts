import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { FastifyInstance } from "fastify";
import { featuredGalleryIds, findGalleryTemplate, galleryBrief, galleryStyles, queryGallery } from "@videosaas/contracts";
import { config } from "./config.ts";

/**
 * Template previews (5-second clips and their posters). They are public marketing media with no user data, so the route
 * is open, but the R2 bucket stays private: the backend streams them. Names are content-addressed
 * (<id>.<sha256 prefix>.<ext>, scripts/publish-gallery.mjs), so a file never changes and browsers and CDNs may cache it
 * for a year. With STORAGE_DRIVER=r2 they live under `gallery/` in the media bucket; locally they are read from
 * GALLERY_DIR (var/gallery).
 */
const NAME = /^[a-z0-9][a-z0-9-]{0,80}\.[0-9a-f]{8}\.(?:mp4|webp|jpg|html)$/;
// A clip's source (html) is served as plain text, never as a page: it is reference code for the author, not content to render.
const types: Record<string, string> = { mp4: "video/mp4", webp: "image/webp", jpg: "image/jpeg", html: "text/plain; charset=utf-8" };
const client = config.r2
  ? new S3Client({ region: "auto", endpoint: config.r2.endpoint, credentials: { accessKeyId: config.r2.accessKeyId, secretAccessKey: config.r2.secretAccessKey } })
  : null;

export async function registerGalleryRoutes(app: FastifyInstance) {
  // The catalog changes only with a deploy, so a short public cache is safe. Locally it is revalidated every time, so a
  // re-published preview shows up on the next load. (The preview files themselves are content-addressed and immutable.)
  const cache = config.appEnv === "local" ? "no-cache" : "public, max-age=60, stale-while-revalidate=300";

  /** One page of starting points. Filtering, search and paging all happen here. */
  app.get<{ Querystring: { use_case?: string; q?: string; cursor?: string; limit?: string; featured?: string; look?: string } }>("/v1/gallery/templates", async (request, reply) => {
    const { use_case, q, cursor, limit, featured, look } = request.query;
    if (look !== undefined && !/^[a-z0-9-]{1,48}$/.test(look)) return reply.code(400).send({ error: { code: "invalid_request", message: "Unknown style." } });
    if (cursor !== undefined && !/^\d{1,6}$/.test(cursor)) return reply.code(400).send({ error: { code: "invalid_request", message: "Unknown cursor." } });
    if (limit !== undefined && !/^\d{1,3}$/.test(limit)) return reply.code(400).send({ error: { code: "invalid_request", message: "Unknown limit." } });
    const page = queryGallery({ useCase: use_case, q, look, cursor, limit: limit === undefined ? undefined : Number(limit), ...(featured === "1" ? { ids: featuredGalleryIds } : {}) });
    // A story film in an oil look is shown but locked until this deployment has a GPU worker (PAINTED_OIL=1).
    return reply.header("Cache-Control", cache).send({ ...page, items: page.items.map((card) => (card.paintedLook?.startsWith("oil:") && !config.painted.oil ? { ...card, locked: true } : card)) });
  });

  /** Every visual style with its example count and one real example clip: what the style picker lists. */
  app.get("/v1/gallery/styles", async (_request, reply) => reply.header("Cache-Control", cache).send({ items: galleryStyles() }));

  /** The starting values a chosen template fills in: the example prompt, structure, look, length and sound. */
  app.get<{ Params: { id: string } }>("/v1/gallery/templates/:id", async (request, reply) => {
    const item = findGalleryTemplate(request.params.id);
    if (!item) return reply.code(404).send({ error: { code: "not_found", message: "Unknown template." } });
    return reply.header("Cache-Control", cache).send({ id: item.id, name: item.name, ...(item.starterId ? { starterId: item.starterId } : {}), brief: galleryBrief(item), ...(item.reference ? { reference: { name: item.reference, url: `/v1/gallery/${item.reference}` } } : {}) });
  });

  app.get<{ Params: { name: string } }>("/v1/gallery/:name", async (request, reply) => {
    const { name } = request.params;
    if (!NAME.test(name)) return reply.code(404).send({ error: { code: "not_found", message: "Unknown preview." } });
    // Media headers go on only once the file is in hand: set earlier, an error's JSON body went out typed as an image
    // (Fastify refuses that with a 500) and with a one-year immutable cache, so one R2 hiccup broke a thumbnail for good.
    const media = () => reply.header("Content-Type", types[name.slice(name.lastIndexOf(".") + 1)]!).header("Accept-Ranges", "bytes")
      .header("Cache-Control", "public, max-age=31536000, immutable").header("Cross-Origin-Resource-Policy", "cross-origin").header("X-Content-Type-Options", "nosniff");
    const missing = () => reply.code(404).header("Cache-Control", "no-store").type("application/json; charset=utf-8").send({ error: { code: "not_found", message: "Unknown preview." } });
    const range = request.headers.range;

    if (client && config.r2) {
      let object;
      try {
        object = await client.send(new GetObjectCommand({ Bucket: config.r2.mediaBucket, Key: `gallery/${name}`, ...(range ? { Range: range } : {}) }));
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404 || (error as { name?: string }).name === "NoSuchKey") return missing();
        request.log.warn({ err: error, name, status }, "gallery preview read failed");
        return reply.code(502).header("Cache-Control", "no-store").header("Retry-After", "1").send({ error: { code: "preview_unavailable", message: "Preview temporarily unavailable." } });
      }
      media();
      if (object.ContentRange) reply.code(206).header("Content-Range", object.ContentRange);
      if (object.ContentLength !== undefined) reply.header("Content-Length", object.ContentLength);
      return reply.send(object.Body);
    }

    const file = join(config.galleryDir, name);
    const size = await stat(file).then((info) => info.size).catch(() => null);
    if (size === null) return missing();
    media();
    const match = /^bytes=(\d*)-(\d*)$/.exec(range ?? "");
    if (!match) return reply.header("Content-Length", size).send(createReadStream(file));
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start >= size || start > end) return reply.code(416).header("Content-Range", `bytes */${size}`).send();
    return reply.code(206).header("Content-Range", `bytes ${start}-${end}/${size}`).header("Content-Length", end - start + 1).send(createReadStream(file, { start, end }));
  });
}

/** A clip's reference source (its HTML) as text, from R2 or GALLERY_DIR; null when it is missing. Used as a style guide. */
export async function readGalleryText(name: string): Promise<string | null> {
  if (!NAME.test(name) || !name.endsWith(".html")) return null;
  if (client && config.r2) {
    try {
      const object = await client.send(new GetObjectCommand({ Bucket: config.r2.mediaBucket, Key: `gallery/${name}` }));
      return (await object.Body?.transformToString("utf-8")) ?? null;
    } catch { return null; }
  }
  return readFile(join(config.galleryDir, name), "utf-8").catch(() => null);
}
