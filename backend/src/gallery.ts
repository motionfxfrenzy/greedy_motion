import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { FastifyInstance } from "fastify";
import { featuredGalleryIds, findGalleryTemplate, galleryBrief, queryGallery } from "@videosaas/contracts";
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
  app.get<{ Querystring: { use_case?: string; q?: string; cursor?: string; limit?: string; featured?: string } }>("/v1/gallery/templates", async (request, reply) => {
    const { use_case, q, cursor, limit, featured } = request.query;
    if (cursor !== undefined && !/^\d{1,6}$/.test(cursor)) return reply.code(400).send({ error: { code: "invalid_request", message: "Unknown cursor." } });
    if (limit !== undefined && !/^\d{1,3}$/.test(limit)) return reply.code(400).send({ error: { code: "invalid_request", message: "Unknown limit." } });
    return reply.header("Cache-Control", cache).send(queryGallery({ useCase: use_case, q, cursor, limit: limit === undefined ? undefined : Number(limit), ...(featured === "1" ? { ids: featuredGalleryIds } : {}) }));
  });

  /** The starting values a chosen template fills in: the example prompt, structure, look, length and sound. */
  app.get<{ Params: { id: string } }>("/v1/gallery/templates/:id", async (request, reply) => {
    const item = findGalleryTemplate(request.params.id);
    if (!item) return reply.code(404).send({ error: { code: "not_found", message: "Unknown template." } });
    return reply.header("Cache-Control", cache).send({ id: item.id, name: item.name, ...(item.starterId ? { starterId: item.starterId } : {}), brief: galleryBrief(item), ...(item.reference ? { reference: { name: item.reference, url: `/v1/gallery/${item.reference}` } } : {}) });
  });

  app.get<{ Params: { name: string } }>("/v1/gallery/:name", async (request, reply) => {
    const { name } = request.params;
    if (!NAME.test(name)) return reply.code(404).send({ error: { code: "not_found", message: "Unknown preview." } });
    reply.header("Content-Type", types[name.slice(name.lastIndexOf(".") + 1)]!).header("Accept-Ranges", "bytes")
      .header("Cache-Control", "public, max-age=31536000, immutable").header("Cross-Origin-Resource-Policy", "cross-origin").header("X-Content-Type-Options", "nosniff");
    const range = request.headers.range;

    if (client && config.r2) {
      try {
        const object = await client.send(new GetObjectCommand({ Bucket: config.r2.mediaBucket, Key: `gallery/${name}`, ...(range ? { Range: range } : {}) }));
        if (object.ContentRange) reply.code(206).header("Content-Range", object.ContentRange);
        if (object.ContentLength !== undefined) reply.header("Content-Length", object.ContentLength);
        return reply.send(object.Body);
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404 || (error as { name?: string }).name === "NoSuchKey") return reply.code(404).header("Cache-Control", "no-store").send({ error: { code: "not_found", message: "Unknown preview." } });
        throw error;
      }
    }

    const file = join(config.galleryDir, name);
    const size = await stat(file).then((info) => info.size).catch(() => null);
    if (size === null) return reply.code(404).header("Cache-Control", "no-store").send({ error: { code: "not_found", message: "Unknown preview." } });
    const match = /^bytes=(\d*)-(\d*)$/.exec(range ?? "");
    if (!match) return reply.header("Content-Length", size).send(createReadStream(file));
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start >= size || start > end) return reply.code(416).header("Content-Range", `bytes */${size}`).send();
    return reply.code(206).header("Content-Range", `bytes ${start}-${end}/${size}`).header("Content-Length", end - start + 1).send(createReadStream(file, { start, end }));
  });
}
