import type { FastifyInstance } from "fastify";
import { callerId } from "./auth.ts";
import { config } from "./config.ts";
import { query } from "./db/database.ts";

/**
 * The Library: every screenshot a person has uploaded to any project, newest first, one page at a time. The page is cut
 * in SQL (the rows come from each project's `screenshots` array), so a large library never loads whole projects and the
 * browser only receives the page it shows. `cursor` is the offset of the next item.
 */
export type LibraryItem = { id: string; projectId: string; projectName: string; name: string; purpose: string; width: number; height: number; createdAt: string };
export type LibraryPage = { items: LibraryItem[]; total: number; nextCursor: string | null };

const MAX = 60;

export async function registerLibraryRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { cursor?: string; limit?: string } }>("/v1/library", async (request, reply) => {
    const { cursor, limit } = request.query;
    if (cursor !== undefined && !/^\d{1,7}$/.test(cursor)) return reply.code(400).send({ error: { code: "invalid_request", message: "Unknown cursor." } });
    if (limit !== undefined && !/^\d{1,3}$/.test(limit)) return reply.code(400).send({ error: { code: "invalid_request", message: "Unknown limit." } });
    const take = Math.min(Math.max(Number(limit ?? 24) || 24, 1), MAX);
    const offset = Number(cursor ?? 0);
    const { rows } = await query<{ project_id: string; project_name: string; screenshot: Record<string, unknown>; total: string }>(
      `select p.id::text as project_id, p.name as project_name, s.value as screenshot, count(*) over() as total
         from app.projects p
         cross join lateral jsonb_array_elements(coalesce(p.data->'screenshots', '[]'::jsonb)) as s(value)
        where p.owner_id = $1 or (p.owner_id is null and $1 = $2)
        order by s.value->>'createdAt' desc, s.value->>'id'
        limit $3 offset $4`,
      [callerId(request), config.legacyOwnerId || null, take, offset]
    );
    const total = rows[0] ? Number(rows[0].total) : 0;
    const items = rows.map((row): LibraryItem => ({
      id: String(row.screenshot.id), projectId: row.project_id, projectName: row.project_name, name: String(row.screenshot.name ?? "Screenshot"),
      purpose: String(row.screenshot.purpose ?? "Dashboard"), width: Number(row.screenshot.width) || 0, height: Number(row.screenshot.height) || 0, createdAt: String(row.screenshot.createdAt ?? "")
    }));
    return reply.header("Cache-Control", "private, no-store").send({ items, total, nextCursor: offset + take < total ? String(offset + take) : null } satisfies LibraryPage);
  });
}
