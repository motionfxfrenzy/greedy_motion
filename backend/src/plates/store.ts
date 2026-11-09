import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { config } from "../config.ts";
import { pool } from "../db/database.ts";
import { boss, inTransaction, QUEUES, sendOnce } from "../jobs/queues.ts";
import { kickPlateWorkers } from "../jobs/worker-launcher.ts";
import { bundleDigest, paramsDigest } from "./digest.ts";
import { median } from "./eta.ts";
import { aspectSlug, isComputedVariantSignature, isCurrentSignature, type Aspect, type LiveMode, type PlateComment, type PlateSubtitles, type VariantState } from "./model.ts";

/**
 * Postgres access for plate scenes. Postgres is the only authority: an empty result means "nothing drawn", never "look on
 * disk". Every state change that must be followed by a message (author / render) commits with that message in ONE
 * transaction (pg-boss `db` option), so work can never be recorded without being queued, or queued without being recorded.
 * The reconciler (reconcile.ts) re-queues anything whose message was lost after all.
 */

const log = (level: string, event: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({ level, event, ...fields }));

export const PLATE_MAX_WRITE_RESTARTS = Math.max(1, Number.parseInt(process.env.PLATE_MAX_WRITE_RESTARTS ?? "3", 10) || 3);
export const MAX_MODEL_STARTS_PER_GEN = config.plates.maxModelStartsPerGen;
export const REVISE_COALESCE_SECONDS = config.plates.reviseCoalesceSeconds;
const maxWriteRestarts = () => Math.max(1, Number.parseInt(process.env.PLATE_MAX_WRITE_RESTARTS ?? String(config.plates.maxModelStartsPerGen), 10) || config.plates.maxModelStartsPerGen);

export type VariantRetrying = { attempt: number; reason: string; at?: number };
export type VariantRevise = {
  notes: string;
  codeKey: string | null;
  baseBundleDigest?: string | null;
  dedupeHash?: string;
  coalescedCount?: number;
};

export type VariantRow = {
  id: string; project_id: string; scene_index: number; aspect: Aspect; signature: string; gen: number; rev: number; keyword: string;
  frames: number; fps: number; width: number; height: number; state: VariantState; stage: string | null; frames_done: number | null;
  author_owner: string | null; author_until: Date | null; authored: number; repairs: number;
  repair: { error: string; previousKey: string | null } | null; revise: VariantRevise | null; draft_source: string | null;
  render_attempt: number; source_key: string | null; bundle_key: string | null; bundle_manifest: Record<string, unknown> | null;
  bundle_digest: string | null; checked_at: Date | null; check_report: Record<string, unknown> | null; host: string | null;
  still_key: string | null; clip_key: string | null; clip_meta: Record<string, unknown> | null; error: { code?: string; message: string } | null;
  timings: Record<string, number> & { retrying?: VariantRetrying; restartsDuringWrite?: number; modelStarts?: number; authorInFlight?: number }; enqueued_at: Date | null; created_at: Date; updated_at: Date; drawn_at: Date | null;
};

export type RevisionRow = {
  id: string;
  variant_id: string;
  rev: number;
  bundle_digest: string;
  source_key: string | null;
  bundle_key: string | null;
  bundle_manifest: Record<string, unknown> | null;
  params: Record<string, unknown>;
  params_digest: string;
  author: string | null;
  created_at: Date;
};

export const prefixOf = (v: Pick<VariantRow, "project_id" | "aspect" | "scene_index" | "gen">) => `plates/${v.project_id}/${aspectSlug(v.aspect)}/${v.scene_index}/g${v.gen}/`;
export const sourceKeyFor = (v: Pick<VariantRow, "project_id" | "aspect" | "scene_index" | "gen">, sourceSha: string) => `${prefixOf(v)}sources/${sourceSha}/source.ts`;
export const bundleKeyFor = (v: Pick<VariantRow, "project_id" | "aspect" | "scene_index" | "gen">, bundleSha: string) => `${prefixOf(v)}bundles/${bundleSha}/bundle.html`;
export const manifestKeyFor = (v: Pick<VariantRow, "project_id" | "aspect" | "scene_index" | "gen">, bundleSha: string) => `${prefixOf(v)}bundles/${bundleSha}/manifest.json`;

export type Desired = {
  index: number;
  aspect: Aspect;
  signature: string;
  contentSignature?: string;
  legacySignatures?: string[];
  frames: number;
  width: number;
  height: number;
  keyword: string;
};

/**
 * Checks whether a stored `VariantRow` is compatible with a desired scene variant `d`:
 *  - Exact `signature` match (`row.signature === d.signature`)
 *  - Per-scene `contentSignature` match (`row.timings?.contentSig === d.contentSignature` or `row.signature === d.contentSignature`),
 *    which preserves an unchanged scene's drawn/checked artwork when another scene is inserted, removed, reordered, or has its keyword edited
 *  - `legacySignatures` match (computed with the previous scene list's `castKeywords` for rows written before `contentSig` existed)
 *  - Synthetic short test signatures (`!isComputedVariantSignature(row.signature)`) when `options.allowSyntheticSignature` is enabled
 */
export function isVariantCompatibleWithDesired(
  row: Pick<VariantRow, "aspect" | "signature" | "timings" | "keyword" | "scene_index">,
  d: Desired,
  options?: { allowSyntheticSignature?: boolean }
): boolean {
  if (row.aspect !== d.aspect) return false;
  if (row.signature === d.signature) return true;
  const storedContentSig = (row.timings as Record<string, unknown> | undefined)?.contentSig;
  if (d.contentSignature && typeof storedContentSig === "string" && storedContentSig === d.contentSignature) return true;
  if (d.contentSignature && row.signature === d.contentSignature) return true;
  if (d.legacySignatures && d.legacySignatures.includes(row.signature)) return true;
  if (
    options?.allowSyntheticSignature &&
    !isComputedVariantSignature(row.signature) &&
    isCurrentSignature(row.signature) &&
    row.scene_index === d.index
  ) {
    return true;
  }
  return false;
}

export type MatchedDesiredVariant = {
  row: VariantRow;
  inPlace: boolean;
};

/**
 * Matches desired `(index, aspect)` variants against stored `VariantRow`s:
 *  - Pass 1 matches any `d` with the row at the same `(scene_index, aspect)` if compatible.
 *  - Pass 2 matches any remaining `d` with an unclaimed compatible reusable donor row of the same `aspect` at another `scene_index`
 *    (handling scene reorder, insertion, and removal without regenerating unchanged scenes).
 */
export function matchVariantsToDesired(
  rows: readonly VariantRow[],
  desired: readonly Desired[],
  options?: { allowSyntheticSignature?: boolean }
): {
  matched: Map<string, MatchedDesiredVariant>;
  claimedRowIds: Set<string>;
  matchedInPlaceIds: Set<string>;
  claimedDonorIds: Set<string>;
} {
  const byKey = new Map(rows.map((r) => [`${r.scene_index}:${r.aspect}`, r]));
  const matched = new Map<string, MatchedDesiredVariant>();
  const claimedRowIds = new Set<string>();
  const matchedInPlaceIds = new Set<string>();
  const claimedDonorIds = new Set<string>();

  // Pass 1: In-place matches at the same (scene_index, aspect)
  for (const d of desired) {
    const key = `${d.index}:${d.aspect}`;
    const row = byKey.get(key);
    if (row && isVariantCompatibleWithDesired(row, d, options)) {
      matched.set(key, { row, inPlace: true });
      claimedRowIds.add(row.id);
      matchedInPlaceIds.add(row.id);
    }
  }

  // Pass 2: Shifted / reordered donor matches from another scene_index of the same aspect
  const hasReusableWork = (r: VariantRow) =>
    Boolean(
      r.bundle_key ||
        r.clip_key ||
        r.source_key ||
        r.state === "bundled" ||
        r.state === "checked" ||
        r.state === "rendering" ||
        r.state === "drawn"
    );

  for (const d of desired) {
    const key = `${d.index}:${d.aspect}`;
    if (matched.has(key)) continue;
    const donor = rows.find(
      (r) =>
        !claimedRowIds.has(r.id) &&
        r.aspect === d.aspect &&
        hasReusableWork(r) &&
        isVariantCompatibleWithDesired(r, d, options)
    );
    if (donor) {
      matched.set(key, { row: donor, inPlace: false });
      claimedRowIds.add(donor.id);
      claimedDonorIds.add(donor.id);
    }
  }

  return { matched, claimedRowIds, matchedInPlaceIds, claimedDonorIds };
}

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
async function queue(client: SendClient, row: Pick<VariantRow, "id" | "gen">, name: typeof QUEUES.plateAuthor | typeof QUEUES.plateRender, singletonKey: string = `${row.id}:${row.gen}`) {
  await client.query("update app.plate_variants set enqueued_at = now() where id = $1", [row.id]);
  await sendOnce(client, name, { variantId: row.id, gen: row.gen }, singletonKey);
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
 *  - one with a compatible signature (in-place or shifted/reordered from another scene index) is kept (a drawn or checked one
 *    is never redrawn; a failed one is retried: from its saved bundle when it has one, so an infrastructure failure never costs
 *    another model call);
 *  - one whose signature changed with no reusable donor is superseded: `gen` is raised (every in-flight write of the old gen is
 *    fenced out), its artifacts are scheduled for deletion, and it is queued again from scratch;
 *  - rows beyond the storyboard are removed.
 * Returns how many messages were queued.
 */
export async function reconcileVariants(projectId: string, desired: Desired[], options: { scenes: number }): Promise<{ queued: number }> {
  const client = await pool.connect();
  let queued = 0;
  let queuedWorker = 0;
  let isLive = false;
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`plate:${projectId}`]);
    const liveMode = await decideLiveModeWithClient(client, projectId, config.plates.live);
    isLive = liveMode === "live";
    const { rows } = await client.query<VariantRow>("select * from app.plate_variants where project_id = $1 for update", [projectId]);
    const byKey = new Map(rows.map((r) => [`${r.scene_index}:${r.aspect}`, r]));
    const wanted = new Set(desired.map((d) => `${d.index}:${d.aspect}`));
    const { matched, matchedInPlaceIds, claimedDonorIds } = matchVariantsToDesired(rows, desired);

    // Snapshot donor rows and their revisions before any row at a target index is overwritten
    const donorSnapshots = new Map<
      string,
      {
        donor: VariantRow;
        prefix: string;
        revisions: RevisionRow[];
      }
    >();
    if (claimedDonorIds.size > 0) {
      const donorIdList = [...claimedDonorIds];
      const revRes = await client.query<RevisionRow>(
        "select * from app.plate_revisions where variant_id = any($1::uuid[]) order by rev asc",
        [donorIdList]
      );
      const revsByVariant = new Map<string, RevisionRow[]>();
      for (const r of revRes.rows) {
        if (!revsByVariant.has(r.variant_id)) revsByVariant.set(r.variant_id, []);
        revsByVariant.get(r.variant_id)!.push(r);
      }
      for (const row of rows) {
        if (claimedDonorIds.has(row.id)) {
          donorSnapshots.set(row.id, {
            donor: { ...row, timings: row.timings ? { ...row.timings } : ({} as VariantRow["timings"]) },
            prefix: prefixOf(row),
            revisions: revsByVariant.get(row.id) ?? []
          });
        }
      }
    }

    for (const row of rows) {
      // Scenes the storyboard no longer has go; a ratio that is merely not selected keeps its drawn clips for when it is again.
      if (!wanted.has(`${row.scene_index}:${row.aspect}`) && row.scene_index >= options.scenes) {
        if (!claimedDonorIds.has(row.id)) {
          await garbage(client, row, "1 hour");
        }
        await client.query("delete from app.plate_variants where id = $1", [row.id]);
      }
    }
    for (const d of desired) {
      const key = `${d.index}:${d.aspect}`;
      const row = byKey.get(key);
      const match = matched.get(key);
      const contentSigPatch = d.contentSignature ? { contentSig: d.contentSignature } : {};

      if (match && !match.inPlace) {
        // Transfer reusable variant from another scene_index (reorder, insert shift, or remove shift) with zero model calls
        const snap = donorSnapshots.get(match.row.id)!;
        const donor = snap.donor;
        if (row && !matchedInPlaceIds.has(row.id) && !claimedDonorIds.has(row.id)) {
          await garbage(client, row, "1 hour");
        }
        const newGen = row ? row.gen + 1 : Math.max(1, donor.gen);
        const baseTimings: Record<string, unknown> = { ...(donor.timings ?? {}), ...contentSigPatch };
        delete baseTimings.retrying;
        delete baseTimings.restartsDuringWrite;
        delete baseTimings.authorInFlight;
        if (baseTimings.playback && typeof baseTimings.playback === "object") {
          baseTimings.playback = { ...(baseTimings.playback as Record<string, unknown>), gen: newGen };
        }
        const targetRes = row
          ? await client.query<VariantRow>(
              `update app.plate_variants
                  set signature = $2, keyword = $3, frames = $4, width = $5, height = $6,
                      gen = $7, rev = $8, state = $9, stage = $10, frames_done = $11,
                      author_owner = null, author_until = null, authored = $12, repairs = $13,
                      repair = null, revise = null, draft_source = null, render_attempt = 0,
                      source_key = $14, bundle_key = $15, bundle_manifest = $16::jsonb, bundle_digest = $17,
                      checked_at = $18, check_report = $19::jsonb, host = $20,
                      still_key = $21, clip_key = $22, clip_meta = $23::jsonb, error = $24::jsonb,
                      timings = $25::jsonb, drawn_at = $26, updated_at = now()
                where id = $1
                returning *`,
              [
                row.id,
                d.signature,
                d.keyword,
                d.frames,
                d.width,
                d.height,
                newGen,
                donor.rev,
                donor.state,
                donor.stage,
                donor.frames_done,
                donor.authored,
                donor.repairs,
                donor.source_key,
                donor.bundle_key,
                donor.bundle_manifest ? JSON.stringify(donor.bundle_manifest) : null,
                donor.bundle_digest,
                donor.checked_at,
                donor.check_report ? JSON.stringify(donor.check_report) : null,
                donor.host,
                donor.still_key,
                donor.clip_key,
                donor.clip_meta ? JSON.stringify(donor.clip_meta) : null,
                donor.error ? JSON.stringify(donor.error) : null,
                JSON.stringify(baseTimings),
                donor.drawn_at
              ]
            )
          : await client.query<VariantRow>(
              `insert into app.plate_variants (
                 project_id, scene_index, aspect, signature, keyword, frames, width, height, fps,
                 gen, rev, state, stage, frames_done, authored, repairs,
                 source_key, bundle_key, bundle_manifest, bundle_digest,
                 checked_at, check_report, host, still_key, clip_key, clip_meta, error, timings, drawn_at
               ) values (
                 $1,$2,$3,$4,$5,$6,$7,$8,30,
                 $9,$10,$11,$12,$13,$14,$15,
                 $16,$17,$18::jsonb,$19,
                 $20,$21::jsonb,$22,$23,$24,$25::jsonb,$26::jsonb,$27::jsonb,$28
               ) returning *`,
              [
                projectId,
                d.index,
                d.aspect,
                d.signature,
                d.keyword,
                d.frames,
                d.width,
                d.height,
                newGen,
                donor.rev,
                donor.state,
                donor.stage,
                donor.frames_done,
                donor.authored,
                donor.repairs,
                donor.source_key,
                donor.bundle_key,
                donor.bundle_manifest ? JSON.stringify(donor.bundle_manifest) : null,
                donor.bundle_digest,
                donor.checked_at,
                donor.check_report ? JSON.stringify(donor.check_report) : null,
                donor.host,
                donor.still_key,
                donor.clip_key,
                donor.clip_meta ? JSON.stringify(donor.clip_meta) : null,
                donor.error ? JSON.stringify(donor.error) : null,
                JSON.stringify(baseTimings),
                donor.drawn_at
              ]
            );
        const targetRow = targetRes.rows[0]!;
        await client.query("delete from app.plate_garbage where project_id = $1 and prefix = $2", [projectId, snap.prefix]);
        for (const rev of snap.revisions) {
          await client.query(
            `insert into app.plate_revisions (variant_id, rev, bundle_digest, source_key, bundle_key, bundle_manifest, params, params_digest, author)
             values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
             on conflict (variant_id, rev) do update
               set bundle_digest = excluded.bundle_digest,
                   source_key = excluded.source_key,
                   bundle_key = excluded.bundle_key,
                   bundle_manifest = excluded.bundle_manifest,
                   params = excluded.params,
                   params_digest = excluded.params_digest,
                   author = excluded.author`,
            [
              targetRow.id,
              rev.rev,
              rev.bundle_digest,
              rev.source_key,
              rev.bundle_key,
              rev.bundle_manifest ? JSON.stringify(rev.bundle_manifest) : null,
              JSON.stringify(rev.params ?? {}),
              rev.params_digest,
              rev.author
            ]
          );
        }
        if (donor.check_report && donor.bundle_digest) {
          await client.query(
            `insert into app.plate_check_reports (variant_id, gen, bundle_digest, host, report)
             values ($1, $2, $3, $4, $5::jsonb)
             on conflict (variant_id, gen, bundle_digest, host) do nothing`,
            [targetRow.id, targetRow.gen, donor.bundle_digest, donor.host ?? "worker", JSON.stringify(donor.check_report)]
          );
        }
        if (targetRow.state === "bundled" && (!isLive || targetRow.stage === "queued for rendering")) {
          await queue(client, targetRow, QUEUES.plateRender, `${targetRow.id}:${targetRow.gen}`);
          queued++;
          queuedWorker++;
        }
        continue;
      }

      if (!row) {
        const inserted = await client.query<VariantRow>(
          `insert into app.plate_variants (project_id, scene_index, aspect, signature, keyword, frames, width, height, fps, timings)
           values ($1,$2,$3,$4,$5,$6,$7,$8,30,$9::jsonb) returning *`,
          [projectId, d.index, d.aspect, d.signature, d.keyword, d.frames, d.width, d.height, JSON.stringify(contentSigPatch)]
        );
        await queue(client, inserted.rows[0]!, QUEUES.plateAuthor);
        queued++;
        continue;
      }

      if (!match) {
        if (!claimedDonorIds.has(row.id)) {
          await garbage(client, row, "1 hour");
        }
        const next = await client.query<VariantRow>(
          `update app.plate_variants set signature = $2, keyword = $3, frames = $4, width = $5, height = $6, gen = gen + 1, rev = 0, state = 'queued', stage = null,
             frames_done = null, author_owner = null, author_until = null, authored = 0, repairs = 0, repair = null, revise = null, draft_source = null, render_attempt = 0,
             source_key = null, bundle_key = null, bundle_manifest = null, bundle_digest = null, checked_at = null, check_report = null, host = null,
             still_key = null, clip_key = null, clip_meta = null, error = null,
             timings = $7::jsonb, drawn_at = null, updated_at = now() where id = $1 returning *`,
          [row.id, d.signature, d.keyword, d.frames, d.width, d.height, JSON.stringify(contentSigPatch)]
        );
        await queue(client, next.rows[0]!, QUEUES.plateAuthor);
        queued++;
        continue;
      }

      // Matched in-place: update signature/keyword/contentSig in place if castKeywords changed while this scene's own content did not
      const storedContentSig = (row.timings as Record<string, unknown> | undefined)?.contentSig;
      if (
        row.signature !== d.signature ||
        row.keyword !== d.keyword ||
        (d.contentSignature && storedContentSig !== d.contentSignature)
      ) {
        await client.query(
          `update app.plate_variants
              set signature = $2,
                  keyword = $3,
                  frames = $4,
                  width = $5,
                  height = $6,
                  timings = coalesce(timings, '{}'::jsonb) || $7::jsonb
            where id = $1`,
          [row.id, d.signature, d.keyword, d.frames, d.width, d.height, JSON.stringify(contentSigPatch)]
        );
      }

      if (row.state === "failed") {
        // A retry of the same inputs: from the saved bundle when there is one (no model call), else from authoring.
        const fromBundle = Boolean(row.bundle_key);
        const shouldRender = !isLive;
        const next = await client.query<VariantRow>(
          `update app.plate_variants set gen = gen + 1, state = $2, stage = $4, frames_done = null, author_owner = null, author_until = null,
             authored = case when $3 then authored else 0 end, repairs = case when $3 then repairs else 0 end, repair = null, render_attempt = 0,
             checked_at = null, check_report = null, host = null, error = null,
             timings = coalesce(timings, '{}'::jsonb) - 'retrying' - 'restartsDuringWrite',
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
          queuedWorker++;
        }
      }
      // queued / authoring / bundled / checked / rendering / drawn with a compatible signature: nothing to do.
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  if (queued) void kickPlateWorkers(!isLive || queuedWorker > 0);
  return { queued };
}

/**
 * Computes a deterministic SHA-256 hash of `(baseBundleDigest, normalizedNotes)` for deduplicating repeated comment-revision applies.
 */
export function revisionDedupeHash(notes: string, baseBundleDigest: string | null | undefined): string {
  const cleanNotes = String(notes ?? "").trim().replace(/\r\n/g, "\n");
  const base = String(baseBundleDigest ?? "");
  return createHash("sha256").update(`${base}\0${cleanNotes}`).digest("hex");
}

/**
 * Merges two revision note blocks in order, deduplicating identical lines so coalesced applies do not repeat instructions.
 */
export function mergeRevisionNotes(existingNotes: string | null | undefined, incomingNotes: string): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const block of [existingNotes ?? "", incomingNotes ?? ""]) {
    for (const raw of block.split(/\r?\n/)) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        lines.push(trimmed);
      }
    }
  }
  return lines.join("\n");
}

export type RevisionApplyDecision =
  | {
      action: "deduplicate";
      gen: number;
      rev: number;
      notes: string;
      codeKey: string | null;
      baseBundleDigest: string | null;
      dedupeHash: string;
    }
  | {
      action: "coalesce";
      gen: number;
      rev: number;
      notes: string;
      codeKey: string | null;
      baseBundleDigest: string | null;
      dedupeHash: string;
      coalescedCount: number;
    }
  | {
      action: "new_generation";
      gen: number;
      rev: number;
      notes: string;
      codeKey: string | null;
      baseBundleDigest: string | null;
      dedupeHash: string;
    };

/**
 * Pure decision function for `reviseScene`:
 *  1. If the variant is already `queued` or `authoring` a revision and the incoming notes produce the same `dedupeHash`
 *     (`sha256(baseBundleDigest + "\0" + notes)`), deduplicates (`action: "deduplicate"`, 0 new model calls).
 *  2. If the variant is `queued` (not yet claimed) or `authoring` a write that started less than `coalesceSeconds` ago
 *     (default 90 s), coalesces the notes in place (`action: "coalesce"`, keeping the same `gen` rather than superseding mid-write).
 *  3. Otherwise starts a new generation (`action: "new_generation"`, `gen + 1`, `rev + 1`).
 */
export function decideRevisionApply(
  row: {
    state: VariantState;
    gen: number;
    rev: number;
    bundle_digest?: string | null;
    source_key?: string | null;
    revise?: VariantRevise | null;
    timings?: Record<string, unknown> | null;
    updated_at?: Date | string | number | null;
  },
  incomingNotes: string,
  options: { now?: number; coalesceSeconds?: number } = {}
): RevisionApplyDecision {
  const now = options.now ?? Date.now();
  const coalesceSeconds = options.coalesceSeconds ?? REVISE_COALESCE_SECONDS;
  const isInFlightRevision = (row.state === "queued" || row.state === "authoring") && Boolean(row.revise);
  const baseBundleDigest = isInFlightRevision
    ? (row.revise?.baseBundleDigest ?? row.bundle_digest ?? row.revise?.codeKey ?? row.source_key ?? null)
    : (row.bundle_digest ?? row.source_key ?? null);
  const codeKey = isInFlightRevision ? (row.revise?.codeKey ?? row.source_key ?? null) : (row.source_key ?? null);

  const incomingHash = revisionDedupeHash(incomingNotes, baseBundleDigest);
  const existingHash =
    row.revise?.dedupeHash ??
    (row.revise?.notes ? revisionDedupeHash(row.revise.notes, baseBundleDigest) : undefined);

  if (isInFlightRevision && existingHash === incomingHash) {
    return {
      action: "deduplicate",
      gen: row.gen,
      rev: row.rev,
      notes: row.revise!.notes,
      codeKey,
      baseBundleDigest,
      dedupeHash: incomingHash
    };
  }

  if (isInFlightRevision) {
    const mergedNotes = mergeRevisionNotes(row.revise?.notes, incomingNotes);
    const mergedHash = revisionDedupeHash(mergedNotes, baseBundleDigest);
    if (mergedHash === existingHash) {
      return {
        action: "deduplicate",
        gen: row.gen,
        rev: row.rev,
        notes: row.revise!.notes,
        codeKey,
        baseBundleDigest,
        dedupeHash: existingHash
      };
    }
    const rawStart = Number(row.timings?.authorStartedAt);
    const updatedMs =
      row.updated_at instanceof Date
        ? row.updated_at.getTime()
        : typeof row.updated_at === "number"
          ? row.updated_at
          : typeof row.updated_at === "string"
            ? Date.parse(row.updated_at)
            : NaN;
    const writeStartedAt = Number.isFinite(rawStart) && rawStart > 0 ? rawStart : Number.isFinite(updatedMs) ? updatedMs : now;
    const elapsedSeconds = Math.max(0, (now - writeStartedAt) / 1000);
    if (row.state === "queued" || elapsedSeconds < coalesceSeconds) {
      return {
        action: "coalesce",
        gen: row.gen,
        rev: row.rev,
        notes: mergedNotes,
        codeKey,
        baseBundleDigest,
        dedupeHash: mergedHash,
        coalescedCount: (row.revise?.coalescedCount ?? 0) + 1
      };
    }
    return {
      action: "new_generation",
      gen: row.gen + 1,
      rev: row.rev + 1,
      notes: mergedNotes,
      codeKey,
      baseBundleDigest,
      dedupeHash: mergedHash
    };
  }

  return {
    action: "new_generation",
    gen: row.gen + 1,
    rev: row.rev + 1,
    notes: incomingNotes.trim(),
    codeKey,
    baseBundleDigest,
    dedupeHash: incomingHash
  };
}

/**
 * Sends scenes back for revision from comments. The signature stays (the inputs did not change); `rev` and `gen` rise, the
 * previous source travels with the notes, and the superseded artifacts are kept for a day before they are swept (unless
 * protected by `plate_revisions`). Deduplicates identical applies while queued/authoring and coalesces newer notes when a
 * write started less than `REVISE_COALESCE_SECONDS` ago.
 */
export async function reviseScene(
  projectId: string,
  sceneIndex: number,
  notes: string,
  options: { now?: number; coalesceSeconds?: number } = {}
): Promise<number> {
  const client = await pool.connect();
  let n = 0;
  let queuedNew = 0;
  let isLive = false;
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`plate:${projectId}`]);
    const modeRes = await client.query<{ live_mode: LiveMode | null }>("select live_mode from app.plate_state where project_id = $1", [projectId]);
    isLive = (modeRes.rows[0]?.live_mode ?? (config.plates.live ? "live" : "clip")) === "live";
    const { rows } = await client.query<VariantRow>(
      "select * from app.plate_variants where project_id = $1 and scene_index = $2 and state in ('drawn', 'checked', 'failed', 'bundled', 'queued', 'authoring') for update",
      [projectId, sceneIndex]
    );
    for (const row of rows) {
      if ((row.state === "queued" || row.state === "authoring") && !row.revise && !row.source_key) {
        // Initial scene authoring has not produced a base module yet; skip until it finishes.
        continue;
      }
      const decision = decideRevisionApply(row, notes, options);
      if (decision.action === "deduplicate") {
        if (row.state === "queued") {
          await sendOnce(client, QUEUES.plateAuthor, { variantId: row.id, gen: row.gen }, `${row.id}:${row.gen}`);
        }
        n++;
        continue;
      }
      if (decision.action === "coalesce") {
        const revisePayload: VariantRevise = {
          notes: decision.notes,
          codeKey: decision.codeKey,
          baseBundleDigest: decision.baseBundleDigest,
          dedupeHash: decision.dedupeHash,
          coalescedCount: decision.coalescedCount
        };
        await client.query(
          "update app.plate_variants set revise = $2::jsonb, updated_at = now() where id = $1",
          [row.id, JSON.stringify(revisePayload)]
        );
        if (row.state === "queued") {
          await sendOnce(client, QUEUES.plateAuthor, { variantId: row.id, gen: row.gen }, `${row.id}:${row.gen}`);
        }
        n++;
        continue;
      }
      await garbage(client, row, "24 hours");
      const revisePayload: VariantRevise = {
        notes: decision.notes,
        codeKey: decision.codeKey,
        baseBundleDigest: decision.baseBundleDigest,
        dedupeHash: decision.dedupeHash
      };
      const next = await client.query<VariantRow>(
        `update app.plate_variants set gen = gen + 1, rev = rev + 1, state = 'queued', stage = null, frames_done = null, author_owner = null, author_until = null,
           authored = 0, repairs = 0, repair = null, revise = $2::jsonb, draft_source = null, render_attempt = 0,
           bundle_key = null, bundle_manifest = null, bundle_digest = null, checked_at = null, check_report = null, host = null,
           timings = coalesce(timings, '{}'::jsonb) - 'retrying' - 'restartsDuringWrite' - 'modelStarts' - 'authorInFlight',
           error = null, drawn_at = null, updated_at = now()
         where id = $1 returning *`,
        [row.id, JSON.stringify(revisePayload)]
      );
      await queue(client, next.rows[0]!, QUEUES.plateAuthor, `${next.rows[0]!.id}:${next.rows[0]!.gen}`);
      n++;
      queuedNew++;
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  if (queuedNew) void kickPlateWorkers(!isLive);
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
    const maxRestarts = maxWriteRestarts();
    const exhausted = await client.query(
      `update app.plate_variants
          set state = 'failed', stage = null,
              error = $3::jsonb,
              author_owner = null, author_until = null,
              timings = coalesce(timings, '{}'::jsonb) - 'retrying',
              updated_at = now()
        where id = $1 and gen = $2 and state = 'authoring' and author_until < now()
          and coalesce((timings->>'restartsDuringWrite')::int, 0) >= $4`,
      [
        variantId,
        gen,
        JSON.stringify({
          code: "author_restarts",
          message: "This scene's drawing was interrupted several times. Press Draw to try again."
        }),
        maxRestarts
      ]
    );
    if (exhausted.rowCount === 1) {
      await client.query("commit");
      return null;
    }
    const res = await client.query<VariantRow>(
      `update app.plate_variants v
          set state = 'authoring', stage = 'authoring', author_owner = $3,
              author_until = now() + make_interval(secs => $4), error = null,
              timings = case
                when v.state = 'authoring' then (coalesce(v.timings, '{}'::jsonb) - 'retrying') || jsonb_build_object('restartsDuringWrite', coalesce((v.timings->>'restartsDuringWrite')::int, 0) + 1)
                else coalesce(v.timings, '{}'::jsonb) - 'retrying'
              end,
              updated_at = now()
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
 * Records the start of a model call on `(variantId, gen)`.
 * If an earlier process started a model write on this `(variantId, gen)` and restarted mid-stream (`authorInFlight === 1`),
 * increments `restartsDuringWrite` in `timings`. Returns `{ modelStarts, restartsDuringWrite }`.
 */
export async function noteModelStart(
  variantId: string,
  gen: number,
  owner: string
): Promise<{ modelStarts: number; restartsDuringWrite: number }> {
  const { rows } = await pool.query<{ model_starts: number; restarts: number }>(
    `update app.plate_variants
        set timings = coalesce(timings, '{}'::jsonb)
          || jsonb_build_object(
               'modelStarts', coalesce((timings->>'modelStarts')::int, 0) + 1,
               'restartsDuringWrite', coalesce((timings->>'restartsDuringWrite')::int, 0) + (case when coalesce((timings->>'authorInFlight')::int, 0) = 1 then 1 else 0 end),
               'authorInFlight', 1
             ),
            updated_at = now()
      where id = $1 and gen = $2 and author_owner = $3 and state = 'authoring'
      returning (timings->>'modelStarts')::int as model_starts,
                (timings->>'restartsDuringWrite')::int as restarts`,
    [variantId, gen, owner]
  );
  return {
    modelStarts: Number(rows[0]?.model_starts ?? 1),
    restartsDuringWrite: Number(rows[0]?.restarts ?? 0)
  };
}

export type AuthorProgressPatch = { chars: number; lines: number; tokens: number; authorStartedAt?: number; progressAt?: number };

/** Best-effort progress write into `timings` (no `updated_at` change, never throws into caller). */
export async function noteAuthorProgress(variantId: string, gen: number, owner: string, p: AuthorProgressPatch): Promise<void> {
  const patch: Record<string, number> = {
    writtenChars: p.chars,
    writtenLines: p.lines,
    writtenTokens: p.tokens,
    progressAt: p.progressAt ?? Date.now(),
    ...(p.authorStartedAt !== undefined ? { authorStartedAt: p.authorStartedAt } : {})
  };
  await pool
    .query(
      "update app.plate_variants set timings = timings || $4::jsonb where id = $1 and gen = $2 and author_owner = $3",
      [variantId, gen, owner, JSON.stringify(patch)]
    )
    .catch(() => undefined);
}

/** Median `authorTotalMs` and `writtenTokens` across the 20 most recently finished variants in the DB. */
export async function recentAuthorMedians(): Promise<{ authorMs?: number; tokens?: number }> {
  try {
    const { rows } = await pool.query<{ author_ms: number | null; written_tokens: number | null }>(
      `select (timings->>'authorTotalMs')::double precision as author_ms,
              (timings->>'writtenTokens')::double precision as written_tokens
         from app.plate_variants
        where state in ('checked', 'drawn', 'bundled')
          and (timings->>'authorTotalMs') is not null
        order by updated_at desc
        limit 20`
    );
    const authorMs = median(rows.map((r) => Number(r.author_ms)));
    const tokens = median(rows.map((r) => Number(r.written_tokens)));
    return {
      ...(authorMs !== undefined ? { authorMs } : {}),
      ...(tokens !== undefined ? { tokens } : {})
    };
  } catch {
    return {};
  }
}

export async function recentMedianAuthorMs(): Promise<number | undefined> {
  return (await recentAuthorMedians()).authorMs;
}

/**
 * Publishes the authored source and its bundle, writes the revision row, and (in clip mode, or when a preview clip
 * render is actively repairing) queues `plate-render`, atomically in one transaction.
 * Returns false when this authoring was superseded.
 */
export async function commitBundle(
  row: VariantRow,
  owner: string,
  artifacts: { sourceKey: string; bundleKey: string; manifest: Record<string, unknown>; timings: Record<string, number>; bundleDigest?: string; params?: Record<string, unknown> }
): Promise<boolean> {
  const revParams = artifacts.params ?? (row.repairs > 0 ? { __repair: row.repairs } : {});
  const digest = artifacts.bundleDigest ?? bundleDigest({ manifest: artifacts.manifest, params: revParams });
  const pDigest = paramsDigest(revParams);
  const client = await pool.connect();
  let shouldKick = false;
  try {
    await client.query("begin");
    const modeRes = await client.query<{ live_mode: LiveMode | null }>(
      "select live_mode from app.plate_state where project_id = $1",
      [row.project_id]
    );
    const isLive = modeRes.rows[0]?.live_mode === "live";
    const shouldRender = !isLive || row.render_attempt > 0;
    const stage = shouldRender ? "queued for rendering" : "checking";
    const res = await client.query<VariantRow>(
      `update app.plate_variants set state = 'bundled', stage = $8, source_key = $4, bundle_key = $5, bundle_manifest = $6::jsonb, bundle_digest = $9,
         checked_at = null, check_report = null, host = null, author_owner = null, author_until = null,
         repair = null, revise = null, draft_source = null, enqueued_at = case when $10 then null else enqueued_at end,
         timings = (coalesce(timings, '{}'::jsonb) - 'retrying' - 'authorInFlight') || $7::jsonb, updated_at = now()
       where id = $1 and gen = $2 and author_owner = $3 and state = 'authoring' returning *`,
      [row.id, row.gen, owner, artifacts.sourceKey, artifacts.bundleKey, JSON.stringify(artifacts.manifest), JSON.stringify(artifacts.timings), stage, digest, !shouldRender]
    );
    if (res.rowCount === 1) {
      const updated = res.rows[0]!;
      if (row.repairs > 0) {
        await client.query("delete from app.plate_check_reports where variant_id = $1 and gen = $2", [updated.id, updated.gen]);
      }
      await client.query(
        `insert into app.plate_revisions (variant_id, rev, bundle_digest, source_key, bundle_key, bundle_manifest, params, params_digest, author)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, null)
         on conflict (variant_id, rev) do update
           set bundle_digest = excluded.bundle_digest,
               source_key = excluded.source_key,
               bundle_key = excluded.bundle_key,
               bundle_manifest = excluded.bundle_manifest,
               params = excluded.params,
               params_digest = excluded.params_digest,
               author = excluded.author,
               created_at = now()`,
        [updated.id, updated.rev, digest, artifacts.sourceKey, artifacts.bundleKey, JSON.stringify(artifacts.manifest), JSON.stringify(revParams), pDigest]
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
    : await client.query<{ rev: number }>(
        `update app.plate_variants
            set state = 'queued', stage = 'repairing', rev = rev + 1, repair = $3::jsonb, repairs = repairs + 1,
                check_report = coalesce($4::jsonb, check_report), host = coalesce($5, host),
                author_owner = null, author_until = null, enqueued_at = now(), updated_at = now()
          where id = $1 and gen = $2 and state in ('bundled', 'rendering')
          returning rev`,
        [
          row.id,
          row.gen,
          JSON.stringify({ error: detail.slice(-2500), previousKey: row.source_key }),
          checkReportJson,
          hostVal
        ]
      );
  if (result.rowCount === 1 && !exhausted) {
    const rev = (result.rows[0] as { rev?: number } | undefined)?.rev ?? row.rev + 1;
    await sendOnce(client, QUEUES.plateAuthor, { variantId: row.id, gen: row.gen }, `${row.id}:${row.gen}:r${rev}`);
  }
  return { applied: result.rowCount === 1, exhausted };
}

export async function sendBackForRepair(row: VariantRow, detail: string): Promise<{ applied: boolean; exhausted: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const outcome = await sendBackForRepairWithClient(client, row, detail);
    await client.query("commit");
    if (outcome.applied && !outcome.exhausted) void kickPlateWorkers(!config.plates.live || row.render_attempt > 0);
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
  | { status: "ok"; duplicate: boolean; body: { state: "checked" } | { state: "bundled"; fallback: true } | { state: "bundled"; playback: "clip" } | { state: "queued" | "failed"; repair: boolean } };

/**
 * A scene whose measured draw time is over either threshold plays from a worker clip instead of drawing live. 30 fps leaves 33 ms per
 * frame; 60 ms median means the browser can draw only about half real time even alone, and 80 ms p90 catches scenes with slow spikes.
 * Scenes below both keep drawing live (the traced slow scenes drew at 140-250 ms; healthy ones at 5-25 ms).
 */
export const SLOW_DRAW_MEDIAN_MS = Number(process.env.PLATE_SLOW_DRAW_MEDIAN_MS ?? "60") || 60;
export const SLOW_DRAW_P90_MS = Number(process.env.PLATE_SLOW_DRAW_P90_MS ?? "80") || 80;
/** A playback measurement needs at least this many samples to be trusted (the first, cold sample is ignored by the client). */
export const MIN_PLAYBACK_SAMPLES = 8;
export function slowDraw(drawMs: unknown): { medianMs: number; p90Ms: number } | null {
  if (!drawMs || typeof drawMs !== "object") return null;
  const m = Number((drawMs as Record<string, unknown>).medianMs);
  const p = Number((drawMs as Record<string, unknown>).p90Ms);
  const medianMs = Number.isFinite(m) && m > 0 ? m : 0;
  const p90Ms = Number.isFinite(p) && p > 0 ? p : 0;
  if (!medianMs && !p90Ms) return null;
  return medianMs > SLOW_DRAW_MEDIAN_MS || p90Ms > SLOW_DRAW_P90_MS ? { medianMs, p90Ms } : null;
}

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

    // A MEASUREMENT report (the player's own draw timings while a `checked` scene plays): the same slow-scene decision as at check time, for
    // scenes checked before it existed or measured under real playback. Stored as its own report row (host "worker:playback") so it never
    // clobbers the original check; idempotent per (gen, digest); fenced like every report.
    if (input.results.ok === true && input.results.source === "playback") {
      const PLAYBACK_HOST = "worker:playback";
      if (!row.bundle_digest || row.bundle_digest !== input.bundleDigest) {
        await client.query("rollback");
        log("info", "plate_check_dropped", { variantId, gen: input.gen, reason: "digest" });
        return { status: "dropped", reason: "digest" };
      }
      const seen = await client.query<{ report: { response?: { state: "checked" } | { state: "bundled"; playback: "clip" } } }>(
        "select report from app.plate_check_reports where variant_id = $1 and gen = $2 and bundle_digest = $3 and host = $4",
        [variantId, input.gen, input.bundleDigest, PLAYBACK_HOST]
      );
      if (seen.rows[0]?.report?.response) {
        await client.query("commit");
        return { status: "ok", duplicate: true, body: seen.rows[0].report.response };
      }
      if (row.state !== "checked") {
        await client.query("rollback");
        log("info", "plate_check_dropped", { variantId, gen: input.gen, state: row.state, stage: row.stage, reason: "state" });
        return { status: "dropped", reason: "state" };
      }
      const samples = Number(input.results.samples);
      const explicitReason = typeof input.results.reason === "string" ? input.results.reason : "";
      const isExplicitFallback = explicitReason === "jitter" || explicitReason === "playable-timeout";
      const slowNow = isExplicitFallback
        ? (slowDraw(input.results.drawMs) ?? { medianMs: Number((input.results.drawMs as any)?.medianMs) || 65, p90Ms: Number((input.results.drawMs as any)?.p90Ms) || 95 })
        : (Number.isFinite(samples) && samples >= MIN_PLAYBACK_SAMPLES ? slowDraw(input.results.drawMs) : null);
      if (!slowNow) {
        // Too few samples to judge, or fast: no row change. Only a judged report is remembered (a thin one may be followed by a better one).
        if (Number.isFinite(samples) && samples >= MIN_PLAYBACK_SAMPLES) {
          await client.query(
            "insert into app.plate_check_reports (variant_id, gen, bundle_digest, host, report) values ($1, $2, $3, $4, $5::jsonb) on conflict (variant_id, gen, bundle_digest, host) do nothing",
            [row.id, row.gen, input.bundleDigest, PLAYBACK_HOST, JSON.stringify({ results: input.results, response: { state: "checked" } })]
          );
        }
        await client.query("commit");
        return { status: "ok", duplicate: false, body: { state: "checked" } };
      }
      const playbackReason = isExplicitFallback ? explicitReason : "slow";
      const body = { state: "bundled", playback: "clip" } as const;
      await client.query(
        `update app.plate_variants
            set state = 'bundled', stage = 'queued for rendering', enqueued_at = now(), error = null,
                timings = (coalesce(timings, '{}'::jsonb) - 'retrying') || jsonb_build_object('playback', $3::jsonb), updated_at = now()
          where id = $1 and gen = $2 and state = 'checked'`,
        [row.id, row.gen, JSON.stringify({ mode: "clip", reason: playbackReason, medianMs: slowNow.medianMs, p90Ms: slowNow.p90Ms, gen: row.gen, digest: input.bundleDigest })]
      );
      await sendOnce(client, QUEUES.plateRender, { variantId: row.id, gen: row.gen }, `${row.id}:${row.gen}`);
      await client.query(
        "insert into app.plate_check_reports (variant_id, gen, bundle_digest, host, report) values ($1, $2, $3, $4, $5::jsonb) on conflict (variant_id, gen, bundle_digest, host) do nothing",
        [row.id, row.gen, input.bundleDigest, PLAYBACK_HOST, JSON.stringify({ results: input.results, response: body })]
      );
      await client.query("commit");
      log("info", "plate_slow_scene_clip", { variantId, gen: row.gen, reason: playbackReason, medianMs: slowNow.medianMs, p90Ms: slowNow.p90Ms, source: "playback" });
      void kickPlateWorkers();
      return { status: "ok", duplicate: false, body };
    }

    // Check idempotency for the current generation before rejecting a state that our own earlier report transitioned.
    const existing = await client.query<{ report: { response?: { state: "checked" } | { state: "bundled"; fallback: true } | { state: "bundled"; playback: "clip" } | { state: "queued" | "failed"; repair: boolean } } }>(
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

    let responseBody: { state: "checked" } | { state: "bundled"; fallback: true } | { state: "bundled"; playback: "clip" } | { state: "queued" | "failed"; repair: boolean };
    const storedReportPayload: Record<string, unknown> = {
      ...(input.device ? { device: input.device } : {}),
      results: input.results
    };

    const slow = input.results.ok === true ? slowDraw(input.results.drawMs) : null;
    if (slow) {
      // Too slow to draw live in the browser: play this scene from a worker clip instead (same path as the env fallback, no model call).
      // The marker carries gen + digest so a later revision of the scene never inherits it.
      responseBody = { state: "bundled", playback: "clip" };
      storedReportPayload.response = responseBody;
      await client.query(
        `update app.plate_variants
            set state = 'bundled', stage = 'queued for rendering', enqueued_at = now(), checked_at = now(), check_report = $3::jsonb, host = $4, error = null,
                timings = (coalesce(timings, '{}'::jsonb) - 'retrying') || jsonb_build_object('playback', $5::jsonb), updated_at = now()
          where id = $1 and gen = $2 and state = 'bundled'`,
        [row.id, row.gen, JSON.stringify(storedReportPayload), input.host, JSON.stringify({ mode: "clip", reason: "slow", medianMs: slow.medianMs, p90Ms: slow.p90Ms, gen: row.gen, digest: input.bundleDigest })]
      );
      await sendOnce(client, QUEUES.plateRender, { variantId: row.id, gen: row.gen }, `${row.id}:${row.gen}`);
      shouldKick = true;
      log("info", "plate_slow_scene_clip", { variantId, gen: row.gen, medianMs: slow.medianMs, p90Ms: slow.p90Ms });
    } else if (input.results.ok === true) {
      responseBody = { state: "checked" };
      storedReportPayload.response = responseBody;
      await client.query(
        `update app.plate_variants
            set state = 'checked', stage = null, checked_at = now(), check_report = $3::jsonb, host = $4, error = null,
                timings = coalesce(timings, '{}'::jsonb) - 'retrying', updated_at = now()
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
      if (outcome.applied && !outcome.exhausted && row.render_attempt > 0) shouldKick = true;
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
  await sendOnce(client, QUEUES.plateRender, { variantId: row.id, gen: row.gen }, `${row.id}:${row.gen}`);
  return { status: "ok", duplicate: false, body: { state: "rendering" } };
}

/**
 * Moves a live-mode variant stuck in `bundled / checking` past `CHECK_GRACE_SECONDS` with no check report to the clip path,
 * respecting the per-project clip cap (`config.plates.projectClipCap`), fenced by `(id, gen, bundle_digest)` and state inside
 * the caller's transaction, and recording `timings.retrying`.
 */
export async function fallbackCheckVariantClipWithClient(
  client: SendClient,
  row: Pick<VariantRow, "id" | "project_id" | "scene_index" | "aspect" | "gen" | "bundle_digest" | "timings">,
  cap: number | null = config.plates.projectClipCap
): Promise<{ status: "ok"; attempt: number } | { status: "clip_cap" } | { status: "fenced" }> {
  if (!row.bundle_digest) return { status: "fenced" };
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
  const prevAttempt = Number(row.timings?.retrying?.attempt ?? 0);
  const attempt = (Number.isFinite(prevAttempt) && prevAttempt > 0 ? prevAttempt : 0) + 1;
  const retrying: VariantRetrying = {
    attempt,
    reason: "the preview check did not report; drawing it on the server",
    at: Date.now()
  };
  const updated = await client.query(
    `update app.plate_variants v
        set state = 'bundled',
            stage = 'queued for rendering',
            enqueued_at = now(),
            timings = coalesce(v.timings, '{}'::jsonb) || jsonb_build_object('retrying', $4::jsonb),
            updated_at = now()
      where v.id = $1
        and v.gen = $2
        and v.bundle_digest = $3
        and v.state = 'bundled'
        and v.stage = 'checking'
        and v.clip_key is null
        and not exists (
          select 1 from app.plate_check_reports r
           where r.variant_id = v.id
             and r.gen = v.gen
             and r.bundle_digest = v.bundle_digest
        )`,
    [row.id, row.gen, row.bundle_digest, JSON.stringify(retrying)]
  );
  if (updated.rowCount !== 1) return { status: "fenced" };
  await sendOnce(client, QUEUES.plateRender, { variantId: row.id, gen: row.gen }, `${row.id}:${row.gen}`);
  return { status: "ok", attempt };
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

export type PlateClipRow = {
  bundle_digest: string;
  engine_digest: string;
  font_set_digest: string;
  size: string;
  width: number;
  height: number;
  fps: number;
  frames: number;
  clip_key: string;
  still_key: string | null;
  clip_meta: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

export async function getCachedClip(bundleDigestVal: string, width: number, height: number): Promise<PlateClipRow | null> {
  const size = `${width}x${height}`;
  const { rows } = await pool.query<PlateClipRow>(
    "select * from app.plate_clips where bundle_digest = $1 and size = $2 order by updated_at desc limit 1",
    [bundleDigestVal, size]
  );
  return rows[0] ?? null;
}

/**
 * Deprecated in Phase 5: final renders and companion exports now draw missing clips directly from the frozen manifest
 * in the worker, without reading or writing `draw_aspects` or enqueuing `plate-render` jobs.
 */
export async function requestDraws(_projectId: string, _aspects: Aspect[]): Promise<{ enqueued: number }> {
  return { enqueued: 0 };
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

/** Keeps an authored module so the retry after a restart, bundling interruption, storage or queue failure needs no new model call. Best effort, fenced. */
export async function saveDraft(variantId: string, gen: number, owner: string, source: string | null): Promise<void> {
  await pool.query(
    `update app.plate_variants
        set draft_source = $4,
            timings = case when $4::text is not null then coalesce(timings, '{}'::jsonb) || '{"authorInFlight":0}'::jsonb else timings end,
            updated_at = now()
      where id = $1 and gen = $2 and author_owner = $3 and state = 'authoring'`,
    [variantId, gen, owner, source]
  );
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
  const { rows } = await pool.query<{ comments: PlateComment[]; subtitles: PlateSubtitles | null; live_mode: LiveMode | null }>(
    "select comments, subtitles, live_mode from app.plate_state where project_id = $1",
    [projectId]
  );
  if (!rows[0]) return { comments: [], subtitles: null, liveMode: null, drawAspects: [] };
  return { comments: rows[0].comments ?? [], subtitles: rows[0].subtitles ?? null, liveMode: rows[0].live_mode ?? null, drawAspects: [] };
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
export type CommitRebundleInput = {
  variantId: string;
  gen: number;
  rev: number;
  expectedBundleDigest: string | null;
  bundleKey: string;
  bundleDigest: string;
  bundleManifest: Record<string, unknown>;
  sourceKey: string;
  params: Record<string, unknown>;
  author?: string;
  host?: string;
};

export type CommitRebundleOutcome =
  | { committed: true; rev: number; state: VariantState }
  | { committed: false; reason: "not_found" | "fenced" };

/**
 * Atomically switches a variant to a verified re-bundled revision in one short fenced transaction (`FOR UPDATE`).
 * Fenced by `(gen, rev, bundle_digest, state IN ('checked', 'drawn', 'bundled'))`.
 * Preserves `checked` and `drawn` states (retaining `clip_key` / `still_key`) so live previews switch seamlessly.
 */
export async function commitRebundleRevision(input: CommitRebundleInput): Promise<CommitRebundleOutcome> {
  const pDigest = paramsDigest(input.params);
  const author = input.author ?? "engine-rebundle";
  const client = await pool.connect();
  try {
    await client.query("begin");
    const locked = await client.query<VariantRow>("select * from app.plate_variants where id = $1 for update", [input.variantId]);
    const row = locked.rows[0];
    if (!row) {
      await client.query("rollback");
      return { committed: false, reason: "not_found" };
    }
    const allowedStates = new Set<VariantState>(["checked", "drawn", "bundled"]);
    if (
      row.gen !== input.gen ||
      row.rev !== input.rev ||
      row.bundle_digest !== input.expectedBundleDigest ||
      !allowedStates.has(row.state)
    ) {
      await client.query("rollback");
      return { committed: false, reason: "fenced" };
    }

    const newRev = row.rev + 1;
    await client.query(
      `insert into app.plate_revisions (variant_id, rev, bundle_digest, source_key, bundle_key, bundle_manifest, params, params_digest, author)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
       on conflict (variant_id, rev) do update
         set bundle_digest = excluded.bundle_digest,
             source_key = excluded.source_key,
             bundle_key = excluded.bundle_key,
             bundle_manifest = excluded.bundle_manifest,
             params = excluded.params,
             params_digest = excluded.params_digest,
             author = excluded.author,
             created_at = now()`,
      [row.id, newRev, input.bundleDigest, input.sourceKey, input.bundleKey, JSON.stringify(input.bundleManifest), JSON.stringify(input.params), pDigest, author]
    );

    const isChecked = row.state === "checked";
    const hostVal = input.host ?? row.host ?? "worker";
    await client.query(
      `update app.plate_variants
          set rev = $2,
              bundle_key = $3,
              bundle_manifest = $4::jsonb,
              bundle_digest = $5,
              checked_at = case when $6 then now() else checked_at end,
              host = case when $6 then $7 else host end,
              updated_at = now()
        where id = $1`,
      [row.id, newRev, input.bundleKey, JSON.stringify(input.bundleManifest), input.bundleDigest, isChecked, hostVal]
    );

    await client.query("commit");
    return { committed: true, rev: newRev, state: row.state };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export type RollbackRebundleOutcome =
  | { rolledBack: true; variantId: string; fromRev: number; toRev: number; bundleKey: string; bundleDigest: string }
  | { rolledBack: false; variantId: string; reason: "not_found" | "not_engine_rebundle" | "no_previous_revision" };

/**
 * Rolls back one variant whose active revision was created by `engine-rebundle` to `rev - 1` in a single fenced transaction.
 */
export async function rollbackRebundleRevision(
  variantId: string,
  fallbackManifestResolver?: (prevRev: RevisionRow) => Promise<Record<string, unknown> | null>
): Promise<RollbackRebundleOutcome> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const locked = await client.query<VariantRow>("select * from app.plate_variants where id = $1 for update", [variantId]);
    const row = locked.rows[0];
    if (!row) {
      await client.query("rollback");
      return { rolledBack: false, variantId, reason: "not_found" };
    }
    const curRes = await client.query<RevisionRow>(
      "select * from app.plate_revisions where variant_id = $1 and rev = $2",
      [row.id, row.rev]
    );
    const cur = curRes.rows[0];
    if (!cur || cur.author !== "engine-rebundle") {
      await client.query("rollback");
      return { rolledBack: false, variantId, reason: "not_engine_rebundle" };
    }
    const prevRes = await client.query<RevisionRow>(
      "select * from app.plate_revisions where variant_id = $1 and rev = $2",
      [row.id, row.rev - 1]
    );
    const prev = prevRes.rows[0];
    if (!prev || !prev.bundle_key) {
      await client.query("rollback");
      return { rolledBack: false, variantId, reason: "no_previous_revision" };
    }
    let prevManifest = prev.bundle_manifest;
    if (!prevManifest && fallbackManifestResolver) {
      prevManifest = await fallbackManifestResolver(prev);
    }
    const updated = await client.query<VariantRow>(
      `update app.plate_variants v
          set rev = prev.rev,
              bundle_key = prev.bundle_key,
              bundle_digest = prev.bundle_digest,
              bundle_manifest = coalesce($3::jsonb, prev.bundle_manifest, v.bundle_manifest),
              source_key = coalesce(prev.source_key, v.source_key),
              updated_at = now()
         from app.plate_revisions cur
         join app.plate_revisions prev
           on prev.variant_id = cur.variant_id and prev.rev = cur.rev - 1
        where v.id = $1
          and cur.variant_id = v.id
          and cur.rev = $2
          and cur.author = 'engine-rebundle'
        returning v.*`,
      [row.id, row.rev, prevManifest ? JSON.stringify(prevManifest) : null]
    );
    if (updated.rowCount !== 1) {
      await client.query("rollback");
      return { rolledBack: false, variantId, reason: "not_engine_rebundle" };
    }
    await client.query("commit");
    return {
      rolledBack: true,
      variantId: row.id,
      fromRev: row.rev,
      toRev: prev.rev,
      bundleKey: prev.bundle_key,
      bundleDigest: prev.bundle_digest
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
