import { randomUUID } from "node:crypto";
import type pg from "pg";
import { config } from "../config.ts";
import { pool } from "../db/database.ts";
import { boss, inTransaction, QUEUES } from "../jobs/queues.ts";
import { kickPlateWorkers } from "../jobs/worker-launcher.ts";
import { bundleDigest, paramsDigest } from "./digest.ts";
import { aspectSlug, type Aspect, type LiveMode, type PlateComment, type PlateSubtitles, type VariantState } from "./model.ts";

/**
 * Postgres access for plate scenes. Postgres is the only authority: an empty result means "nothing drawn", never "look on
 * disk". Every state change that must be followed by a message (author / render) commits with that message in ONE
 * transaction (pg-boss `db` option), so work can never be recorded without being queued, or queued without being recorded.
 * The reconciler (reconcile.ts) re-queues anything whose message was lost after all.
 */

const log = (level: string, event: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({ level, event, ...fields }));

export type VariantRow = {
  id: string; project_id: string; scene_index: number; aspect: Aspect; signature: string; gen: number; rev: number; keyword: string;
  frames: number; fps: number; width: number; height: number; state: VariantState; stage: string | null; frames_done: number | null;
  author_owner: string | null; author_until: Date | null; authored: number; repairs: number;
  repair: { error: string; previousKey: string | null } | null; revise: { notes: string; codeKey: string | null } | null; draft_source: string | null;
  render_attempt: number; source_key: string | null; bundle_key: string | null; bundle_manifest: Record<string, unknown> | null;
  bundle_digest: string | null; checked_at: Date | null; check_report: Record<string, unknown> | null; host: string | null;
  still_key: string | null; clip_key: string | null; clip_meta: Record<string, unknown> | null; error: { code?: string; message: string } | null;
  timings: Record<string, number>; enqueued_at: Date | null; updated_at: Date; drawn_at: Date | null;
};

export type RevisionRow = {
  id: string;
  variant_id: string;
  rev: number;
  bundle_digest: string;
  source_key: string | null;
  bundle_key: string | null;
  params: Record<string, unknown>;
  params_digest: string;
  author: string | null;
  created_at: Date;
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

export async function listRevisions(variantId: string): Promise<RevisionRow[]> {
  const { rows } = await pool.query<RevisionRow>("select * from app.plate_revisions where variant_id = $1 order by rev asc", [variantId]);
  return rows;
}

export async function getRevision(variantId: string, rev: number): Promise<RevisionRow | null> {
  const { rows } = await pool.query<RevisionRow>("select * from app.plate_revisions where variant_id = $1 and rev = $2", [variantId, rev]);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- messages
type SendClient = pg.PoolClient;
/** Records the send time on the row and queues the message inside the caller's transaction. */
async function queue(client: SendClient, row: Pick<VariantRow, "id" | "gen">, name: typeof QUEUES.plateAuthor | typeof QUEUES.plateRender, singletonKey?: string) {
  await client.query("update app.plate_variants set enqueued_at = now() where id = $1", [row.id]);
  await boss.send(name, { variantId: row.id, gen: row.gen }, { db: inTransaction(client), ...(singletonKey ? { singletonKey } : {}) });
}

async function garbage(client: SendClient, row: VariantRow, delay: string) {
  await client.query(
    `insert into app.plate_garbage (prefix, project_id, next_sweep_at) values ($1, $2, now() + $3::interval)
     on conflict (prefix) do nothing`,
    [prefixOf(row), row.project_id, delay]
  );
}

// ---------------------------------------------------------------- live mode decision
async function decideLiveModeWithClient(client: SendClient, projectId: string, live: boolean = config.plates.live): Promise<LiveMode> {
  const desired: LiveMode = live ? "live" : "clip";
  await client.query("insert into app.plate_state (project_id) values ($1) on conflict (project_id) do nothing", [projectId]);
  await client.query(
    "update app.plate_state set live_mode = $2, live_mode_set_at = now(), updated_at = now() where project_id = $1 and live_mode is null",
    [projectId, desired]
  );
  const { rows } = await client.query<{ live_mode: LiveMode }>("select live_mode from app.plate_state where project_id = $1", [projectId]);
  return rows[0]?.live_mode ?? desired;
}

/**
 * Decides `live_mode` once per project when it first enters step 3.
 * Uses an atomic `update ... where live_mode is null`; never changed by a subsequent flag flip.
 */
export async function decideLiveMode(projectId: string, live: boolean = config.plates.live): Promise<LiveMode> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const mode = await decideLiveModeWithClient(client, projectId, live);
    await client.query("commit");
    return mode;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getLiveMode(projectId: string): Promise<LiveMode | null> {
  const { rows } = await pool.query<{ live_mode: LiveMode | null }>("select live_mode from app.plate_state where project_id = $1", [projectId]);
  return rows[0]?.live_mode ?? null;
}

/**
 * Makes the stored variants match the desired ones, under a per-project lock:
 *  - a missing variant is created and queued for authoring;
 *  - one with the same signature is kept (a drawn or checked one is never redrawn; a failed one is retried: from its saved
 *    bundle when it has one, so an infrastructure failure never costs another model call);
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
    const liveMode = await decideLiveModeWithClient(client, projectId, config.plates.live);
    const isLive = liveMode === "live";
    const drawRes = await client.query<{ draw_aspects: string[] | null }>("select draw_aspects from app.plate_state where project_id = $1", [projectId]);
    const drawAspects = new Set(drawRes.rows[0]?.draw_aspects ?? []);
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
             source_key = null, bundle_key = null, bundle_manifest = null, bundle_digest = null, checked_at = null, check_report = null, host = null,
             still_key = null, clip_key = null, clip_meta = null, error = null,
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
        const shouldRender = !isLive || drawAspects.has(d.aspect);
        const next = await client.query<VariantRow>(
          `update app.plate_variants set gen = gen + 1, state = $2, stage = $4, frames_done = null, author_owner = null, author_until = null,
             authored = case when $3 then authored else 0 end, repairs = case when $3 then repairs else 0 end, repair = null, render_attempt = 0,
             checked_at = null, check_report = null, host = null, error = null,
             enqueued_at = case when $5 then null else enqueued_at end, updated_at = now()
           where id = $1 returning *`,
          [row.id, fromBundle ? "bundled" : "queued", fromBundle, fromBundle ? (shouldRender ? "queued for rendering" : "checking") : null, fromBundle && !shouldRender]
        );
        if (!fromBundle) {
          await queue(client, next.rows[0]!, QUEUES.plateAuthor);
          queued++;
        } else if (shouldRender) {
          await queue(client, next.rows[0]!, QUEUES.plateRender, `${next.rows[0]!.id}:${next.rows[0]!.gen}`);
          queued++;
        }
      }
      // queued / authoring / bundled / checked / rendering / drawn with the current signature: nothing to do.
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  if (queued) void kickPlateWorkers();
  return { queued };
}

/**
 * Sends scenes back for revision from comments. The signature stays (the inputs did not change); `rev` and `gen` rise, the
 * previous source travels with the notes, and the superseded artifacts are kept for a day before they are swept (unless
 * protected by `plate_revisions`). Resets `checked` variants as well as `drawn` and `failed` ones.
 */
export async function reviseScene(projectId: string, sceneIndex: number, notes: string): Promise<number> {
  const client = await pool.connect();
  let n = 0;
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`plate:${projectId}`]);
    const { rows } = await client.query<VariantRow>(
      "select * from app.plate_variants where project_id = $1 and scene_index = $2 and state in ('drawn', 'checked', 'failed') for update",
      [projectId, sceneIndex]
    );
    for (const row of rows) {
      await garbage(client, row, "24 hours");
      const next = await client.query<VariantRow>(
        `update app.plate_variants set gen = gen + 1, rev = rev + 1, state = 'queued', stage = null, frames_done = null, author_owner = null, author_until = null,
           authored = 0, repairs = 0, repair = null, revise = $2::jsonb, draft_source = null, render_attempt = 0,
           bundle_key = null, bundle_manifest = null, bundle_digest = null, checked_at = null, check_report = null, host = null,
           error = null, drawn_at = null, updated_at = now()
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
  if (n) void kickPlateWorkers();
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

/**
 * Publishes the authored source and its bundle, writes the revision row, and (in clip mode, or in live mode when the
 * variant's aspect is in `draw_aspects`) queues `plate-render`, atomically in one transaction.
 * Returns false when this authoring was superseded.
 */
export async function commitBundle(
  row: VariantRow,
  owner: string,
  artifacts: { sourceKey: string; bundleKey: string; manifest: Record<string, unknown>; timings: Record<string, number>; bundleDigest?: string }
): Promise<boolean> {
  const digest = artifacts.bundleDigest ?? bundleDigest({ manifest: artifacts.manifest, params: {} });
  const pDigest = paramsDigest({});
  const client = await pool.connect();
  let shouldKick = false;
  try {
    await client.query("begin");
    const modeRes = await client.query<{ live_mode: LiveMode | null; draw_aspects: string[] | null }>(
      "select live_mode, draw_aspects from app.plate_state where project_id = $1",
      [row.project_id]
    );
    const isLive = modeRes.rows[0]?.live_mode === "live";
    const drawOnDemand = isLive && (modeRes.rows[0]?.draw_aspects ?? []).includes(row.aspect);
    const shouldRender = !isLive || drawOnDemand;
    const stage = shouldRender ? "queued for rendering" : "checking";
    const res = await client.query<VariantRow>(
      `update app.plate_variants set state = 'bundled', stage = $8, source_key = $4, bundle_key = $5, bundle_manifest = $6::jsonb, bundle_digest = $9,
         checked_at = null, check_report = null, host = null, author_owner = null, author_until = null,
         repair = null, revise = null, draft_source = null, enqueued_at = case when $10 then null else enqueued_at end,
         timings = timings || $7::jsonb, updated_at = now()
       where id = $1 and gen = $2 and author_owner = $3 and state = 'authoring' returning *`,
      [row.id, row.gen, owner, artifacts.sourceKey, artifacts.bundleKey, JSON.stringify(artifacts.manifest), JSON.stringify(artifacts.timings), stage, digest, !shouldRender]
    );
    if (res.rowCount === 1) {
      const updated = res.rows[0]!;
      await client.query(
        `insert into app.plate_revisions (variant_id, rev, bundle_digest, source_key, bundle_key, params, params_digest, author)
         values ($1, $2, $3, $4, $5, '{}'::jsonb, $6, null)
         on conflict (variant_id, rev) do update
           set bundle_digest = excluded.bundle_digest,
               source_key = excluded.source_key,
               bundle_key = excluded.bundle_key,
               params = excluded.params,
               params_digest = excluded.params_digest,
               author = excluded.author,
               created_at = now()`,
        [updated.id, updated.rev, digest, artifacts.sourceKey, artifacts.bundleKey, pDigest]
      );
      if (shouldRender) {
        await queue(client, updated, QUEUES.plateRender, `${updated.id}:${updated.gen}`);
        shouldKick = true;
      }
    }
    await client.query("commit");
    if (shouldKick) void kickPlateWorkers();
    return res.rowCount === 1;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Bounded repair path for a deterministic scene-code failure (shared logic with worker verification failure).
 * Sends the variant back to `plate-author` with the error and previous source if within `maxAuthorCalls`;
 * otherwise marks the variant `failed`.
 */
async function sendBackForRepairWithClient(
  client: SendClient,
  row: VariantRow,
  detail: string,
  extra?: { checkReport?: Record<string, unknown>; host?: string }
): Promise<{ applied: boolean; exhausted: boolean }> {
  const exhausted = row.authored >= config.plates.maxAuthorCalls;
  const checkReportJson = extra?.checkReport ? JSON.stringify(extra.checkReport) : null;
  const hostVal = extra?.host ?? null;
  const result = exhausted
    ? await client.query(
        `update app.plate_variants
            set state = 'failed', stage = null, error = $3::jsonb,
                check_report = coalesce($4::jsonb, check_report), host = coalesce($5, host), updated_at = now()
          where id = $1 and gen = $2 and state in ('bundled', 'rendering')`,
        [
          row.id,
          row.gen,
          JSON.stringify({
            code: "scene_invalid",
            message: `This scene could not be drawn after ${row.authored} attempts. Press Draw to try again.`,
            detail: detail.slice(0, 800)
          }),
          checkReportJson,
          hostVal
        ]
      )
    : await client.query(
        `update app.plate_variants
            set state = 'queued', stage = 'repairing', repair = $3::jsonb, repairs = repairs + 1,
                check_report = coalesce($4::jsonb, check_report), host = coalesce($5, host),
                author_owner = null, author_until = null, enqueued_at = now(), updated_at = now()
          where id = $1 and gen = $2 and state in ('bundled', 'rendering')`,
        [
          row.id,
          row.gen,
          JSON.stringify({ error: detail.slice(-2500), previousKey: row.source_key }),
          checkReportJson,
          hostVal
        ]
      );
  if (result.rowCount === 1 && !exhausted) {
    await boss.send(QUEUES.plateAuthor, { variantId: row.id, gen: row.gen }, { db: inTransaction(client) });
  }
  return { applied: result.rowCount === 1, exhausted };
}

export async function sendBackForRepair(row: VariantRow, detail: string): Promise<{ applied: boolean; exhausted: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const outcome = await sendBackForRepairWithClient(client, row, detail);
    await client.query("commit");
    if (outcome.applied && !outcome.exhausted) void kickPlateWorkers();
    return outcome;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export type CheckReportInput = {
  gen: number;
  bundleDigest: string;
  host: string;
  device?: Record<string, unknown>;
  results: {
    ok: boolean;
    kind?: "code" | "env";
    error?: string;
    message?: string;
    [key: string]: unknown;
  };
};

export type CheckReportOutcome =
  | { status: "not_found" }
  | { status: "not_live" }
  | { status: "invalid_host" }
  | { status: "dropped"; reason: "gen" | "digest" | "state" }
  | { status: "ok"; duplicate: boolean; body: { state: "checked" } | { state: "bundled"; fallback: true } | { state: "queued" | "failed"; repair: boolean } };

/**
 * Records a fenced, idempotent browser check report for a live variant.
 *  - Fenced by `(gen, bundle_digest)` and `state = 'bundled'`; stale or mismatched reports are dropped (204) with an info log.
 *  - Deduplicated in `app.plate_check_reports` by `(variant_id, gen, bundle_digest, host)`.
 *  - `ok: true` moves `bundled -> checked`; `ok: false, kind: "code"` triggers the bounded repair loop;
 *    `ok: false, kind: "env"` changes nothing and returns `{ state: "bundled", fallback: true }`.
 *  - Never moves a variant to `drawn`, and never applies to a project in `clip` mode.
 */
export async function submitCheckReport(variantId: string, input: CheckReportInput, expectedProjectId?: string): Promise<CheckReportOutcome> {
  if (input.host !== "worker") {
    log("info", "plate_check_dropped", { variantId, gen: input.gen, host: input.host, reason: "invalid_host" });
    return { status: "invalid_host" };
  }
  const client = await pool.connect();
  let shouldKick = false;
  try {
    await client.query("begin");
    const vRes = await client.query<VariantRow>("select * from app.plate_variants where id = $1 for update", [variantId]);
    const row = vRes.rows[0];
    if (!row || (expectedProjectId && row.project_id !== expectedProjectId)) {
      await client.query("rollback");
      return { status: "not_found" };
    }
    const modeRes = await client.query<{ live_mode: LiveMode | null }>("select live_mode from app.plate_state where project_id = $1", [row.project_id]);
    const liveMode = modeRes.rows[0]?.live_mode ?? null;
    if (liveMode !== "live") {
      await client.query("rollback");
      return { status: "not_live" };
    }

    if (row.gen !== input.gen) {
      await client.query("rollback");
      log("info", "plate_check_dropped", { variantId, gen: input.gen, currentGen: row.gen, reason: "gen" });
      return { status: "dropped", reason: "gen" };
    }

    // Check idempotency for the current generation before rejecting a state that our own earlier report transitioned.
    const existing = await client.query<{ report: { response?: { state: "checked" } | { state: "bundled"; fallback: true } | { state: "queued" | "failed"; repair: boolean } } }>(
      "select report from app.plate_check_reports where variant_id = $1 and gen = $2 and bundle_digest = $3 and host = $4",
      [variantId, input.gen, input.bundleDigest, input.host]
    );
    if (existing.rows.length > 0 && existing.rows[0]!.report?.response) {
      await client.query("commit");
      return { status: "ok", duplicate: true, body: existing.rows[0]!.report.response };
    }

    if (!row.bundle_digest || row.bundle_digest !== input.bundleDigest) {
      await client.query("rollback");
      log("info", "plate_check_dropped", { variantId, gen: input.gen, reason: "digest" });
      return { status: "dropped", reason: "digest" };
    }

    if (row.state !== "bundled" || row.stage === "queued for rendering") {
      await client.query("rollback");
      log("info", "plate_check_dropped", { variantId, gen: input.gen, state: row.state, stage: row.stage, reason: "state" });
      return { status: "dropped", reason: "state" };
    }

    let responseBody: { state: "checked" } | { state: "bundled"; fallback: true } | { state: "queued" | "failed"; repair: boolean };
    const storedReportPayload: Record<string, unknown> = {
      ...(input.device ? { device: input.device } : {}),
      results: input.results
    };

    if (input.results.ok === true) {
      responseBody = { state: "checked" };
      storedReportPayload.response = responseBody;
      await client.query(
        `update app.plate_variants
            set state = 'checked', stage = null, checked_at = now(), check_report = $3::jsonb, host = $4, error = null, updated_at = now()
          where id = $1 and gen = $2 and state = 'bundled'`,
        [row.id, row.gen, JSON.stringify(storedReportPayload), input.host]
      );
    } else if (input.results.kind === "code") {
      const detail =
        typeof input.results.error === "string" && input.results.error
          ? input.results.error
          : typeof input.results.message === "string" && input.results.message
            ? input.results.message
            : JSON.stringify(input.results);
      const outcome = await sendBackForRepairWithClient(client, row, detail, { checkReport: storedReportPayload, host: input.host });
      responseBody = { state: outcome.exhausted ? "failed" : "queued", repair: !outcome.exhausted };
      storedReportPayload.response = responseBody;
      if (outcome.applied && !outcome.exhausted) shouldKick = true;
    } else {
      // kind === "env": device could not draw; change nothing on the variant and offer clip fallback.
      responseBody = { state: "bundled", fallback: true };
      storedReportPayload.response = responseBody;
    }

    await client.query(
      `insert into app.plate_check_reports (variant_id, gen, bundle_digest, host, report)
       values ($1, $2, $3, $4, $5::jsonb)
       on conflict (variant_id, gen, bundle_digest, host) do nothing`,
      [row.id, row.gen, input.bundleDigest, input.host, JSON.stringify(storedReportPayload)]
    );

    await client.query("commit");
    if (shouldKick) void kickPlateWorkers();
    return { status: "ok", duplicate: false, body: responseBody };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export const recordCheckReport = submitCheckReport;

export type ClipRequestOutcome =
  | { status: "not_found" }
  | { status: "invalid_state"; state: VariantState }
  | { status: "clip_cap" }
  | { status: "ok"; duplicate: boolean; body: { state: "rendering" } };

async function enqueueVariantClipWithClient(
  client: SendClient,
  row: VariantRow,
  cap: number | null
): Promise<ClipRequestOutcome> {
  const alreadyJob = await client.query<{ n: string }>(
    `select count(*) as n from pgboss.job
      where name = $1 and data->>'variantId' = $2 and (data->>'gen')::int = $3 and state in ('created', 'retry', 'active')`,
    [QUEUES.plateRender, row.id, row.gen]
  );
  const hasPendingRenderJob = Number(alreadyJob.rows[0]?.n ?? 0) > 0;

  if (row.state === "rendering" || (row.state === "bundled" && (row.stage === "queued for rendering" || hasPendingRenderJob))) {
    return { status: "ok", duplicate: true, body: { state: "rendering" } };
  }

  if (row.state !== "bundled" && row.state !== "checked") {
    return { status: "invalid_state", state: row.state };
  }

  if (cap !== null) {
    const activeCountRes = await client.query<{ n: string }>(
      `select count(*) as n
         from app.plate_variants o
        where o.project_id = $1
          and o.id <> $2
          and (
            o.state = 'rendering'
            or (
              o.state = 'bundled'
              and (
                o.stage = 'queued for rendering'
                or exists (
                  select 1 from pgboss.job j
                  where j.name = $3
                    and j.data->>'variantId' = o.id::text
                    and (j.data->>'gen')::int = o.gen
                    and j.state in ('created', 'retry', 'active')
                )
              )
            )
          )`,
      [row.project_id, row.id, QUEUES.plateRender]
    );
    if (Number(activeCountRes.rows[0]?.n ?? 0) >= cap) {
      return { status: "clip_cap" };
    }
  }

  await client.query(
    "update app.plate_variants set state = 'bundled', stage = 'queued for rendering', enqueued_at = now(), updated_at = now() where id = $1",
    [row.id]
  );
  await boss.send(QUEUES.plateRender, { variantId: row.id, gen: row.gen }, { db: inTransaction(client), singletonKey: `${row.id}:${row.gen}` });
  return { status: "ok", duplicate: false, body: { state: "rendering" } };
}

/**
 * Enqueues `plate-render` once (idempotently) for a `bundled` or `checked` variant, subject to the per-project cap
 * (`PLATE_PROJECT_CLIP_CAP`, default 4). Keeps DB `state = 'bundled'` with `stage = 'queued for rendering'` so the worker's
 * `claimVariant` can claim it immediately, while returning `{ state: "rendering" }` to the caller.
 */
export async function requestVariantClip(projectId: string, variantId: string, cap: number = config.plates.projectClipCap): Promise<ClipRequestOutcome> {
  const client = await pool.connect();
  let shouldKick = false;
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`plate:${projectId}`]);
    const vRes = await client.query<VariantRow>("select * from app.plate_variants where id = $1 for update", [variantId]);
    const row = vRes.rows[0];
    if (!row || row.project_id !== projectId) {
      await client.query("rollback");
      return { status: "not_found" };
    }

    const outcome = await enqueueVariantClipWithClient(client, row, cap);
    if (outcome.status !== "ok") {
      await client.query("rollback");
      return outcome;
    }

    shouldKick = !outcome.duplicate;
    await client.query("commit");
    if (shouldKick) void kickPlateWorkers();
    return outcome;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Requests on-demand worker clip rendering for every variant of a live project in `aspects`:
 *  - No-op for clip-mode projects.
 *  - Persists `aspects` in `app.plate_state.draw_aspects` so variants still `queued` or `authoring` enqueue `plate-render`
 *    when `commitBundle` runs, and the reconciler recovers lost `plate-render` messages for those aspects.
 *  - For every `checked` or `bundled` variant without a `clip_key` in `aspects`, reuses `enqueueVariantClipWithClient`
 *    with `cap = null` (no per-project clip cap) and `singletonKey = "${row.id}:${row.gen}"`.
 */
export async function requestDraws(projectId: string, aspects: Aspect[]): Promise<{ enqueued: number }> {
  const uniqueAspects = [...new Set(aspects)];
  if (!uniqueAspects.length) return { enqueued: 0 };
  const client = await pool.connect();
  let enqueued = 0;
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`plate:${projectId}`]);
    let stateRes = await client.query<{ live_mode: LiveMode | null; draw_aspects: string[] }>(
      "select live_mode, draw_aspects from app.plate_state where project_id = $1 for update",
      [projectId]
    );
    if ((!stateRes.rows.length || stateRes.rows[0]!.live_mode === null) && config.plates.live) {
      await decideLiveModeWithClient(client, projectId, true);
      stateRes = await client.query<{ live_mode: LiveMode | null; draw_aspects: string[] }>(
        "select live_mode, draw_aspects from app.plate_state where project_id = $1 for update",
        [projectId]
      );
    }
    if (stateRes.rows[0]?.live_mode !== "live") {
      await client.query("commit");
      return { enqueued: 0 };
    }
    await client.query(
      `update app.plate_state
          set draw_aspects = (
            select coalesce(array_agg(distinct a order by a), '{}'::text[])
              from unnest(coalesce(draw_aspects, '{}'::text[]) || $2::text[]) as a
          ),
          updated_at = now()
        where project_id = $1`,
      [projectId, uniqueAspects]
    );
    const { rows } = await client.query<VariantRow>(
      `select * from app.plate_variants
        where project_id = $1 and aspect = any($2::text[])
        order by scene_index, aspect
        for update`,
      [projectId, uniqueAspects]
    );
    for (const row of rows) {
      if ((row.state === "checked" || row.state === "bundled") && !row.clip_key) {
        const outcome = await enqueueVariantClipWithClient(client, row, null);
        if (outcome.status === "ok" && !outcome.duplicate) {
          enqueued++;
        }
      }
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  if (enqueued) void kickPlateWorkers();
  return { enqueued };
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
export async function readProjectState(projectId: string): Promise<{ comments: PlateComment[]; subtitles: PlateSubtitles | null; liveMode: LiveMode | null; drawAspects: Aspect[] }> {
  const { rows } = await pool.query<{ comments: PlateComment[]; subtitles: PlateSubtitles | null; live_mode: LiveMode | null; draw_aspects: Aspect[] | null }>(
    "select comments, subtitles, live_mode, draw_aspects from app.plate_state where project_id = $1",
    [projectId]
  );
  if (!rows[0]) return { comments: [], subtitles: null, liveMode: null, drawAspects: [] };
  return { comments: rows[0].comments ?? [], subtitles: rows[0].subtitles ?? null, liveMode: rows[0].live_mode ?? null, drawAspects: rows[0].draw_aspects ?? [] };
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
