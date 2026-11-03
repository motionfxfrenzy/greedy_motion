import { randomUUID } from "node:crypto";
import type pg from "pg";
import { pool } from "../db/database.ts";
import { boss, inTransaction, QUEUES } from "../jobs/queues.ts";
import { kickWorkers } from "../jobs/worker-launcher.ts";
import { aspectSlug, type Aspect, type PlateComment, type PlateSubtitles, type VariantState } from "./model.ts";

/**
 * Postgres access for plate scenes. Postgres is the only authority: an empty result means "nothing drawn", never "look on
 * disk". Every state change that must be followed by a message (author / render) commits with that message in ONE
 * transaction (pg-boss `db` option), so work can never be recorded without being queued, or queued without being recorded.
 * The reconciler (reconcile.ts) re-queues anything whose message was lost after all.
 */

export type VariantRow = {
  id: string; project_id: string; scene_index: number; aspect: Aspect; signature: string; gen: number; rev: number; keyword: string;
  frames: number; fps: number; width: number; height: number; state: VariantState; stage: string | null; frames_done: number | null;
  author_owner: string | null; author_until: Date | null; authored: number; repairs: number;
  repair: { error: string; previousKey: string | null } | null; revise: { notes: string; codeKey: string | null } | null; draft_source: string | null;
  render_attempt: number; source_key: string | null; bundle_key: string | null; bundle_manifest: Record<string, unknown> | null;
  still_key: string | null; clip_key: string | null; clip_meta: Record<string, unknown> | null; error: { code?: string; message: string } | null;
  timings: Record<string, number>; enqueued_at: Date | null; updated_at: Date; drawn_at: Date | null;
};

export const prefixOf = (v: Pick<VariantRow, "project_id" | "aspect" | "scene_index" | "gen">) => `plates/${v.project_id}/${aspectSlug(v.aspect)}/${v.scene_index}/g${v.gen}/`;

export type Desired = { index: number; aspect: Aspect; signature: string; frames: number; width: number; height: number; keyword: string };

const COLUMNS = "*";

export async function listVariants(projectId: string): Promise<VariantRow[]> {
  const { rows } = await pool.query<VariantRow>(`select ${COLUMNS} from app.plate_variants where project_id = $1 order by scene_index, aspect`, [projectId]);
  return rows;
}
export async function getVariant(id: string): Promise<VariantRow | null> {
  const { rows } = await pool.query<VariantRow>(`select ${COLUMNS} from app.plate_variants where id = $1`, [id]);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- messages
type SendClient = pg.PoolClient;
/** Records the send time on the row and queues the message inside the caller's transaction. */
async function queue(client: SendClient, row: Pick<VariantRow, "id" | "gen">, name: typeof QUEUES.plateAuthor | typeof QUEUES.plateRender) {
  await client.query("update app.plate_variants set enqueued_at = now() where id = $1", [row.id]);
  await boss.send(name, { variantId: row.id, gen: row.gen }, { db: inTransaction(client) });
}

async function garbage(client: SendClient, row: VariantRow, delay: string) {
  await client.query(
    `insert into app.plate_garbage (prefix, project_id, next_sweep_at) values ($1, $2, now() + $3::interval)
     on conflict (prefix) do nothing`,
    [prefixOf(row), row.project_id, delay]
  );
}

/**
 * Makes the stored variants match the desired ones, under a per-project lock:
 *  - a missing variant is created and queued for authoring;
 *  - one with the same signature is kept (a drawn one is never redrawn; a failed one is retried: from its saved bundle when
 *    it has one, so an infrastructure failure never costs another model call);
 *  - one whose signature changed is superseded: `gen` is raised (every in-flight write of the old gen is fenced out),
 *    its artifacts are scheduled for deletion, and it is queued again from scratch;
 *  - rows beyond the storyboard are removed.
 * Returns how many messages were queued.
 */
export async function reconcileVariants(projectId: string, desired: Desired[], options: { scenes: number }): Promise<{ queued: number }> {
  const client = await pool.connect();
  let queued = 0;
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`plate:${projectId}`]);
    const { rows } = await client.query<VariantRow>("select * from app.plate_variants where project_id = $1 for update", [projectId]);
    const byKey = new Map(rows.map((r) => [`${r.scene_index}:${r.aspect}`, r]));
    const wanted = new Set(desired.map((d) => `${d.index}:${d.aspect}`));
    for (const row of rows) {
      // Scenes the storyboard no longer has go; a ratio that is merely not selected keeps its drawn clips for when it is again.
      if (!wanted.has(`${row.scene_index}:${row.aspect}`) && row.scene_index >= options.scenes) {
        await garbage(client, row, "1 hour");
        await client.query("delete from app.plate_variants where id = $1", [row.id]);
      }
    }
    for (const d of desired) {
      const row = byKey.get(`${d.index}:${d.aspect}`);
      if (!row) {
        const inserted = await client.query<VariantRow>(
          `insert into app.plate_variants (project_id, scene_index, aspect, signature, keyword, frames, width, height, fps)
           values ($1,$2,$3,$4,$5,$6,$7,$8,30) returning *`,
          [projectId, d.index, d.aspect, d.signature, d.keyword, d.frames, d.width, d.height]
        );
        await queue(client, inserted.rows[0]!, QUEUES.plateAuthor);
        queued++;
        continue;
      }
      if (row.signature !== d.signature) {
        await garbage(client, row, "1 hour");
        const next = await client.query<VariantRow>(
          `update app.plate_variants set signature = $2, keyword = $3, frames = $4, width = $5, height = $6, gen = gen + 1, rev = 0, state = 'queued', stage = null,
             frames_done = null, author_owner = null, author_until = null, authored = 0, repairs = 0, repair = null, revise = null, draft_source = null, render_attempt = 0,
             source_key = null, bundle_key = null, bundle_manifest = null, still_key = null, clip_key = null, clip_meta = null, error = null,
             timings = '{}'::jsonb, drawn_at = null, updated_at = now() where id = $1 returning *`,
          [row.id, d.signature, d.keyword, d.frames, d.width, d.height]
        );
        await queue(client, next.rows[0]!, QUEUES.plateAuthor);
        queued++;
        continue;
      }
      if (row.state === "failed") {
        // A retry of the same inputs: from the saved bundle when there is one (no model call), else from authoring.
        const fromBundle = Boolean(row.bundle_key);
        const next = await client.query<VariantRow>(
          `update app.plate_variants set gen = gen + 1, state = $2, stage = null, frames_done = null, author_owner = null, author_until = null,
             authored = case when $3 then authored else 0 end, repairs = case when $3 then repairs else 0 end, repair = null, render_attempt = 0, error = null, updated_at = now()
           where id = $1 returning *`,
          [row.id, fromBundle ? "bundled" : "queued", fromBundle]
        );
        await queue(client, next.rows[0]!, fromBundle ? QUEUES.plateRender : QUEUES.plateAuthor);
        queued++;
      }
      // queued / authoring / bundled / rendering / drawn with the current signature: nothing to do.
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  if (queued) void kickWorkers(true);
  return { queued };
}

/**
 * Sends scenes back for revision from comments. The signature stays (the inputs did not change); `rev` and `gen` rise, the
 * previous source travels with the notes, and the superseded artifacts are kept for a day before they are swept.
 */
export async function reviseScene(projectId: string, sceneIndex: number, notes: string): Promise<number> {
  const client = await pool.connect();
  let n = 0;
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`plate:${projectId}`]);
    const { rows } = await client.query<VariantRow>("select * from app.plate_variants where project_id = $1 and scene_index = $2 and state in ('drawn', 'failed') for update", [projectId, sceneIndex]);
    for (const row of rows) {
      await garbage(client, row, "24 hours");
      const next = await client.query<VariantRow>(
        `update app.plate_variants set gen = gen + 1, rev = rev + 1, state = 'queued', stage = null, frames_done = null, author_owner = null, author_until = null,
           authored = 0, repairs = 0, repair = null, revise = $2::jsonb, draft_source = null, render_attempt = 0, bundle_key = null, bundle_manifest = null, error = null, drawn_at = null, updated_at = now()
         where id = $1 returning *`,
        [row.id, JSON.stringify({ notes, codeKey: row.source_key })]
      );
      await queue(client, next.rows[0]!, QUEUES.plateAuthor);
      n++;
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  if (n) void kickWorkers(true);
  return n;
}

// ---------------------------------------------------------------- authoring (backend)
/**
 * Claims a variant for authoring. Atomic, fenced by `gen`, honours the per-project authoring cap, and takes over an expired lease.
 * Returns null for anything that is not claimable (superseded, already drawn, held by a live owner, cap reached).
 */
export async function claimAuthor(variantId: string, gen: number, owner: string, leaseSeconds: number, cap: number): Promise<VariantRow | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const found = await client.query<{ project_id: string }>("select project_id from app.plate_variants where id = $1", [variantId]);
    if (!found.rows.length) { await client.query("rollback"); return null; }
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`plate-author:${found.rows[0]!.project_id}`]);
    const res = await client.query<VariantRow>(
      `update app.plate_variants v set state = 'authoring', stage = 'authoring', author_owner = $3, author_until = now() + make_interval(secs => $4), error = null, updated_at = now()
        where v.id = $1 and v.gen = $2 and (v.state = 'queued' or (v.state = 'authoring' and v.author_until < now()))
          and (select count(*) from app.plate_variants o where o.project_id = v.project_id and o.state = 'authoring' and o.author_until >= now() and o.id <> v.id) < $5
        returning v.*`,
      [variantId, gen, owner, leaseSeconds, cap]
    );
    await client.query("commit");
    return res.rows[0] ?? null;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function renewAuthor(variantId: string, gen: number, owner: string, leaseSeconds: number): Promise<boolean> {
  const res = await pool.query(
    "update app.plate_variants set author_until = now() + make_interval(secs => $4), updated_at = now() where id = $1 and gen = $2 and author_owner = $3 and state = 'authoring'",
    [variantId, gen, owner, leaseSeconds]
  );
  return res.rowCount === 1;
}

export async function noteAuthorCall(variantId: string, gen: number, owner: string, timings: Record<string, number>): Promise<void> {
  await pool.query(
    "update app.plate_variants set authored = authored + 1, timings = timings || $4::jsonb, updated_at = now() where id = $1 and gen = $2 and author_owner = $3",
    [variantId, gen, owner, JSON.stringify(timings)]
  );
}

/** Publishes the authored source and its bundle and queues the worker, atomically. False when this authoring was superseded. */
export async function commitBundle(row: VariantRow, owner: string, artifacts: { sourceKey: string; bundleKey: string; manifest: Record<string, unknown>; timings: Record<string, number> }): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const res = await client.query<VariantRow>(
      `update app.plate_variants set state = 'bundled', stage = 'queued for rendering', source_key = $4, bundle_key = $5, bundle_manifest = $6::jsonb, author_owner = null, author_until = null,
         repair = null, revise = null, draft_source = null, timings = timings || $7::jsonb, updated_at = now()
       where id = $1 and gen = $2 and author_owner = $3 and state = 'authoring' returning *`,
      [row.id, row.gen, owner, artifacts.sourceKey, artifacts.bundleKey, JSON.stringify(artifacts.manifest), JSON.stringify(artifacts.timings)]
    );
    if (res.rowCount === 1) await queue(client, res.rows[0]!, QUEUES.plateRender);
    await client.query("commit");
    if (res.rowCount === 1) void kickWorkers(true);
    return res.rowCount === 1;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Marks an authoring that cannot succeed (or an exhausted model-failure retry). Fenced by gen + owner (owner null: by gen and state). */
export async function failVariant(variantId: string, gen: number, owner: string | null, error: { code: string; message: string; detail?: string }): Promise<boolean> {
  const res = await pool.query(
    `update app.plate_variants set state = 'failed', stage = null, error = $4::jsonb, author_owner = null, author_until = null, updated_at = now()
      where id = $1 and gen = $2 and state in ('authoring', 'queued', 'bundled', 'rendering') and ($3::text is null or author_owner = $3)`,
    [variantId, gen, owner, JSON.stringify(error)]
  );
  return res.rowCount === 1;
}

/** Keeps a bundled module so the retry after a storage or queue failure needs no new model call. Best effort, fenced. */
export async function saveDraft(variantId: string, gen: number, owner: string, source: string): Promise<void> {
  await pool.query("update app.plate_variants set draft_source = $4, updated_at = now() where id = $1 and gen = $2 and author_owner = $3 and state = 'authoring'", [variantId, gen, owner, source]);
}

/** Gives an interrupted authoring back to the queue (same gen, same repair context) so the retry takes it. */
export async function releaseAuthor(variantId: string, gen: number, owner: string, note: string): Promise<void> {
  await pool.query(
    "update app.plate_variants set state = 'queued', stage = $4, author_owner = null, author_until = null, updated_at = now() where id = $1 and gen = $2 and author_owner = $3 and state = 'authoring'",
    [variantId, gen, owner, note]
  );
}

/** True once the primary-ratio variant of the same scene has an authored source (or is hopeless), so other ratios can reference it. */
export async function primarySource(projectId: string, sceneIndex: number, primary: Aspect): Promise<{ ready: boolean; key: string | null }> {
  const { rows } = await pool.query<Pick<VariantRow, "state" | "source_key">>("select state, source_key from app.plate_variants where project_id = $1 and scene_index = $2 and aspect = $3", [projectId, sceneIndex, primary]);
  const row = rows[0];
  if (!row) return { ready: true, key: null };
  if (row.source_key) return { ready: true, key: row.source_key };
  return { ready: row.state === "failed", key: null };
}

// ---------------------------------------------------------------- project-level state
export async function readProjectState(projectId: string): Promise<{ comments: PlateComment[]; subtitles: PlateSubtitles | null }> {
  const { rows } = await pool.query<{ comments: PlateComment[]; subtitles: PlateSubtitles | null }>("select comments, subtitles from app.plate_state where project_id = $1", [projectId]);
  return rows[0] ?? { comments: [], subtitles: null };
}

async function ensureState(projectId: string) {
  await pool.query("insert into app.plate_state (project_id) values ($1) on conflict (project_id) do nothing", [projectId]);
}

export async function writeSubtitles(projectId: string, next: PlateSubtitles) {
  await ensureState(projectId);
  await pool.query("update app.plate_state set subtitles = $2::jsonb, updated_at = now() where project_id = $1", [projectId, JSON.stringify(next)]);
}

/** Atomic comment edits (row lock), so two requests cannot lose each other's comment. */
export async function editComments(projectId: string, change: (comments: PlateComment[]) => PlateComment[]): Promise<PlateComment[]> {
  await ensureState(projectId);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ comments: PlateComment[] }>("select comments from app.plate_state where project_id = $1 for update", [projectId]);
    const next = change(rows[0]?.comments ?? []);
    await client.query("update app.plate_state set comments = $2::jsonb, updated_at = now() where project_id = $1", [projectId, JSON.stringify(next)]);
    await client.query("commit");
    return next;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export const newOwner = () => randomUUID();
