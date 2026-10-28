import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { PAINTED_SCRIPT_MAX, PAINTED_SCRIPT_MIN, paintedDrawModes, paintedLookById, paintedLooks, paintedSeconds, renderCostMillitokens, type PaintedDrawMode, type RenderJob } from "@videosaas/contracts";
import { callerId } from "../auth.ts";
import { config } from "../config.ts";
import { pool } from "../db/database.ts";
import { renderJobRepository } from "../render/repository.ts";
import { InsufficientTokens, refundSpend, spendTokens } from "../tokens/store.ts";

/**
 * Story films. A template names a look; the look names the drawing engine (doodle runs on any worker, oil needs a GPU
 * worker). The film is a render job like the others (same queue, progress stream, signed video URL), with its own worker
 * input: `kind: "painted"`. Tokens are taken before it is queued and returned if the film cannot be made
 * (render/service.ts failForGood). A comment on a finished film repaints only the scenes it names.
 */
const fail = (code: string, message: string, extra: object = {}) => ({ error: { code, message, ...extra } });
const MAX_ACTIVE = 2;
const MAX_COMMENTS = 5;
/** One comment is a small repaint: a rewritten scene, same voice and music. */
const COMMENT_MILLITOKENS = 1000;

const lookAvailable = (id: string) => {
  const look = paintedLookById(id);
  return Boolean(look) && (look!.engine === "doodle" || config.painted.oil);
};

type FilmRow = { id: string; state: RenderJob["state"]; stage: string; progress: number; created_at: Date; request: { kind?: string; look?: string; script?: string; drawIn?: string; baseJobId?: string }; output: { lines?: string[]; durationSeconds?: number } | null; error: { message?: string } | null };

const view = (row: FilmRow) => ({
  id: row.id,
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

const FILM_COLUMNS = "id, state, stage, progress, created_at, request, output, error";

async function ownFilm(id: string, owner: string): Promise<FilmRow | null> {
  const result = await pool.query<FilmRow>(`select ${FILM_COLUMNS} from app.render_jobs where id = $1 and owner_id = $2 and request->>'kind' = 'painted'`, [id, owner]);
  return result.rows[0] ?? null;
}

export async function registerPaintedRoutes(app: FastifyInstance) {
  /** The looks the picker shows, and whether this deployment can draw each one. */
  app.get("/v1/painted/looks", async (_request, reply) => reply.header("Cache-Control", "public, max-age=60").send({
    looks: paintedLooks.map((look) => ({ id: look.id, engine: look.engine, name: look.name, blurb: look.blurb, script: look.script, available: lookAvailable(look.id) })),
    scriptMin: PAINTED_SCRIPT_MIN,
    scriptMax: PAINTED_SCRIPT_MAX
  }));

  app.get("/v1/painted/films", async (request) => {
    const result = await pool.query<FilmRow>(`select ${FILM_COLUMNS} from app.render_jobs where owner_id = $1 and request->>'kind' = 'painted' order by created_at desc limit 30`, [callerId(request)]);
    return { films: result.rows.map(view) };
  });

  app.get<{ Params: { id: string } }>("/v1/painted/films/:id", async (request, reply) => {
    if (!/^[0-9a-f-]{36}$/i.test(request.params.id)) return reply.code(404).send(fail("not_found", "Film not found."));
    const row = await ownFilm(request.params.id, callerId(request));
    return row ? view(row) : reply.code(404).send(fail("not_found", "Film not found."));
  });

  app.post<{ Body: { script?: unknown; look?: unknown; drawIn?: unknown } }>("/v1/painted/films", async (request, reply) => {
    const body = request.body ?? {};
    const script = typeof body.script === "string" ? body.script.replace(/\r/g, "").trim() : "";
    if (script.length < PAINTED_SCRIPT_MIN || script.length > PAINTED_SCRIPT_MAX) return reply.code(400).send(fail("invalid_request", `Write between ${PAINTED_SCRIPT_MIN} and ${PAINTED_SCRIPT_MAX} characters.`));
    const look = typeof body.look === "string" ? paintedLookById(body.look) : undefined;
    if (!look) return reply.code(400).send(fail("invalid_request", "Choose one of the looks."));
    if (!lookAvailable(look.id)) return reply.code(409).send(fail("look_unavailable", `${look.name} is not available yet.`));
    const drawIn: PaintedDrawMode = paintedDrawModes.includes(body.drawIn as PaintedDrawMode) ? (body.drawIn as PaintedDrawMode) : "opening";

    const owner = callerId(request);
    const active = await pool.query<{ n: string }>("select count(*) as n from app.render_jobs where owner_id = $1 and request->>'kind' = 'painted' and state in ('queued', 'planning', 'rendering')", [owner]);
    if (Number(active.rows[0]?.n) >= MAX_ACTIVE) return reply.code(429).send(fail("too_many_films", "Two films are already being made. Wait for one to finish."));

    const jobId = randomUUID();
    const seconds = paintedSeconds(script);
    let spend: { charged: boolean; event: string } | null = null;
    try {
      spend = await spendTokens(owner, renderCostMillitokens(seconds), "painted", jobId);
    } catch (error) {
      if (error instanceof InsufficientTokens) return reply.code(402).send(fail("insufficient_tokens", `This film needs ${error.needed} tokens and you have ${error.remaining}. Add tokens or choose a plan.`, { needed: error.needed, remaining: error.remaining }));
      throw error;
    }
    try {
      const job: RenderJob = { id: jobId, state: "rendering", progress: 45, createdAt: new Date().toISOString(), revision: { id: randomUUID(), title: "Story film", scenes: [], look: "doodle" } };
      const queued = await renderJobRepository.createFormatAndEnqueue(job, {
        ownerId: owner,
        // `kind` and `spend` stay on the server: the list views read them, the dead-letter consumer refunds from `spend`.
        request: { kind: "painted", look: look.id, script, drawIn, ...(spend.charged ? { spend: spend.event } : {}) },
        renderInput: { kind: "painted", id: jobId, look: look.id, script, drawIn, durationSeconds: seconds }
      });
      return reply.code(202).send({ ...queued, seconds, tokens: renderCostMillitokens(seconds) / 1000 });
    } catch (error) {
      if (spend?.charged) await refundSpend(owner, spend.event).catch((refundError) => request.log.error({ err: refundError }, "could not return tokens"));
      request.log.error({ err: error }, "could not queue story film");
      return reply.code(503).send(fail("queue_unavailable", "The render queue is not reachable. Nothing was charged; try again in a moment."));
    }
  });

  /** Comments on a finished film: each names a line and what should change. Only those scenes are rewritten and painted again. */
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
    const active = await pool.query<{ n: string }>("select count(*) as n from app.render_jobs where owner_id = $1 and request->>'kind' = 'painted' and state in ('queued', 'planning', 'rendering')", [owner]);
    if (Number(active.rows[0]?.n) >= MAX_ACTIVE) return reply.code(429).send(fail("too_many_films", "Two films are already being made. Wait for one to finish."));

    const jobId = randomUUID();
    let spend: { charged: boolean; event: string } | null = null;
    try {
      spend = await spendTokens(owner, COMMENT_MILLITOKENS * comments.length, "painted-change", jobId);
    } catch (error) {
      if (error instanceof InsufficientTokens) return reply.code(402).send(fail("insufficient_tokens", `This change needs ${error.needed} tokens and you have ${error.remaining}.`, { needed: error.needed, remaining: error.remaining }));
      throw error;
    }
    try {
      const job: RenderJob = { id: jobId, state: "rendering", progress: 45, createdAt: new Date().toISOString(), revision: { id: randomUUID(), title: "Story film", scenes: [], look: "doodle" } };
      const queued = await renderJobRepository.createFormatAndEnqueue(job, {
        ownerId: owner,
        request: { kind: "painted", look: base.request.look, script: base.request.script, drawIn: base.request.drawIn, baseJobId: base.id, comments, ...(spend.charged ? { spend: spend.event } : {}) },
        renderInput: { kind: "painted", id: jobId, look: base.request.look, drawIn: base.request.drawIn, baseJobId: base.id, fixes: comments, durationSeconds: base.output?.durationSeconds ?? 60 }
      });
      return reply.code(202).send(queued);
    } catch (error) {
      if (spend?.charged) await refundSpend(owner, spend.event).catch((refundError) => request.log.error({ err: refundError }, "could not return tokens"));
      request.log.error({ err: error }, "could not queue story film change");
      return reply.code(503).send(fail("queue_unavailable", "The render queue is not reachable. Nothing was charged; try again in a moment."));
    }
  });
}
