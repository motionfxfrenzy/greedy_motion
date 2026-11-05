import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleScene, engineDigest, engineVersion, isSupportedStyle } from "@videosaas/plate-engine";
import { pool } from "../db/database.ts";
import { boss, QUEUES } from "../jobs/queues.ts";
import { kickPlateWorkers } from "../jobs/worker-launcher.ts";
import { getProject } from "../projects/store.ts";
import { getObject, objectSize, putObject, type Bucket } from "../storage.ts";
import { putContentAddressedObject, type ContentAddressedStorage } from "./author.ts";
import { bundleDigest, canonicalJson } from "./digest.ts";
import type { Aspect, VariantState } from "./model.ts";
import {
  bundleKeyFor,
  commitRebundleRevision,
  getRevision,
  getVariant,
  manifestKeyFor,
  rollbackRebundleRevision,
  type RevisionRow,
  type RollbackRebundleOutcome,
  type VariantRow
} from "./store.ts";

/**
 * Non-LLM re-bundling of existing plate variants onto the current engine (`packages/plate-engine`).
 *
 * Rules:
 *  - Zero model calls (`anthropicMessage` is never imported or invoked here).
 *  - Every output bundle and manifest is written under a content-addressed key:
 *      `${prefixOf(row)}bundles/${bundleSha}/bundle.html`
 *      `${prefixOf(row)}bundles/${bundleSha}/manifest.json`
 *    Existing keys (`.../g<gen>/bundle.html` or earlier `.../bundles/<sha>/bundle.html`) are never overwritten.
 *  - Two-phase verification before cutover:
 *      Phase 1 (backend): snapshot candidate -> fetch & verify `source.ts` (`sourceSha`) -> `bundleScene` -> upload to
 *      content-addressed keys -> verify storage size.
 *      Phase 2 (verification + atomic pointer swap): because `backend/Dockerfile` does not ship Chromium while
 *      `worker/Dockerfile` does, verification either runs via the `plate-rebundle` worker job (`handlePlateRebundle` ->
 *      `verifyScene` -> `rebundle.commit` control op) or in-process via a provided `verifier` (e.g. local CLI with
 *      `verifyScene` or test harness).
 *  - A variant's active bundle never switches to an unverified bundle; on any verification or fence failure, the variant
 *    stays on its working old bundle.
 */

const log = (level: string, event: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level, event, ...fields }));

const sha256Nul24 = (text: string): string =>
  createHash("sha256").update(text).update("\0").digest("hex").slice(0, 24);

export type RebundleStorage = ContentAddressedStorage & {
  objectSize: (bucket: Bucket, key: string) => Promise<number | null>;
};

const defaultStorage: RebundleStorage = {
  getObject,
  putObject,
  objectSize
};

export type RebundleVerifyInput = {
  variantId: string;
  projectId: string;
  aspect: Aspect;
  frames: number;
  html: string;
  bakedHtml: string;
  bundleKey: string;
  bundleDigest: string;
  manifest: Record<string, unknown>;
  params: Record<string, unknown>;
};

export type RebundleVerifier = (input: RebundleVerifyInput) => Promise<{ ok: boolean; reason?: string }>;

function bakeParamsIntoHtml(html: string, params: Record<string, unknown>): string {
  if (!params || typeof params !== "object" || Object.keys(params).length === 0) return html;
  const script = `window.__PARAMS__=${canonicalJson(params)};`;
  if (html.includes("window.__BAKE_SRC__={};")) {
    return html.replace("window.__BAKE_SRC__={};", `window.__BAKE_SRC__={};${script}`);
  }
  return html.replace("<script>", `<script>${script}`);
}

/**
 * Default local Chromium verifier using `@videosaas/plate-engine/capture` (`verifyScene`).
 * Writes the baked bundle HTML to a temporary file, runs the 2-page double-draw determinism check, and cleans up.
 */
export async function defaultChromiumVerifier(input: RebundleVerifyInput): Promise<{ ok: boolean; reason?: string }> {
  const scratch = join(tmpdir(), `rebundle-verify-${input.variantId}-${Date.now()}`);
  await mkdir(scratch, { recursive: true });
  try {
    const pagePath = join(scratch, "scene.html");
    await writeFile(pagePath, input.bakedHtml, "utf8");
    const captureSpecifier = "@videosaas/plate-engine/capture";
    const captureMod = (await import(captureSpecifier)) as {
      verifyScene: (path: string, opts: { frames: number }) => Promise<unknown>;
    };
    await captureMod.verifyScene(pagePath, { frames: input.frames });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

export type StaleCandidateInfo = {
  variantId: string;
  projectId: string;
  sceneIndex: number;
  aspect: Aspect;
  gen: number;
  rev: number;
  state: VariantState;
  frames: number;
  sourceKey: string;
  bundleKey: string | null;
  bundleDigest: string | null;
  foundEngineDigest: string | null;
  currentEngineDigest: string;
};

export type RebundleScanReport = {
  currentEngineVersion: string;
  currentEngineDigest: string;
  countsByState: Record<string, number>;
  staleCountsByState: Record<string, number>;
  countsByEngineDigest: Record<string, number>;
  staleCountsByEngineDigest: Record<string, number>;
  upToDateCount: number;
  legacySkippedProjects: number;
  legacyprojectIds: string[];
  frozenManifestVariantCount: number;
  exportInFlightVariantCount: number;
  frozenOrInFlightVariantCount: number;
  frozenOrInFlightVariantIds: string[];
  totalBytesToStage: number;
  sampleCandidateIds: string[];
  after: string | null;
  nextCursor: string | null;
  candidates: StaleCandidateInfo[];
};

function manifestBundleBytes(manifest: Record<string, unknown> | null | undefined): number {
  if (!manifest || typeof manifest !== "object") return 0;
  for (const key of ["bundleBytes", "bytes", "size", "htmlBytes", "byteLength"]) {
    const val = manifest[key];
    const num = typeof val === "number" ? val : typeof val === "string" ? Number(val) : NaN;
    if (Number.isFinite(num) && num >= 0) return Math.floor(num);
  }
  return 0;
}

/**
 * Read-only scan of all plate variants and legacy pre-018 projects.
 * Lists candidate variants in `state IN ('checked', 'drawn', 'bundled')` with `source_key IS NOT NULL` whose
 * `bundle_manifest->>'engineDigest'` differs from the current `engineDigest()`.
 */
export async function scanRebundleCandidates(options: {
  projectId?: string;
  limit?: number;
  after?: string;
  sample?: number;
  currentEngineDigest?: string;
} = {}): Promise<RebundleScanReport> {
  const targetEngineDigest = options.currentEngineDigest ?? engineDigest();
  const currentVer = engineVersion();

  const stateCountsRes = await pool.query<{ state: string; n: string }>(
    options.projectId
      ? "select state, count(*)::text as n from app.plate_variants where project_id = $1 group by state"
      : "select state, count(*)::text as n from app.plate_variants group by state",
    options.projectId ? [options.projectId] : []
  );
  const countsByState: Record<string, number> = {};
  for (const r of stateCountsRes.rows) {
    countsByState[r.state] = Number(r.n);
  }

  const digestCountsRes = await pool.query<{ engine_digest: string; n: string }>(
    `select coalesce(bundle_manifest->>'engineDigest', 'none') as engine_digest, count(*)::text as n
       from app.plate_variants
      where state in ('checked', 'drawn', 'bundled')
        and source_key is not null
        ${options.projectId ? "and project_id = $1" : ""}
      group by coalesce(bundle_manifest->>'engineDigest', 'none')`,
    options.projectId ? [options.projectId] : []
  );
  const countsByEngineDigest: Record<string, number> = {};
  for (const r of digestCountsRes.rows) {
    countsByEngineDigest[r.engine_digest] = Number(r.n);
  }

  // Informational counts: variants whose (project_id, aspect) has a frozen export manifest or an export / final render in flight.
  const frozenExportRes = await pool.query<{
    id: string;
    has_frozen_manifest: boolean;
    has_export_in_flight: boolean;
  }>(
    `select v.id,
            (
              exists (
                select 1 from app.plate_exports e
                 where e.project_id = v.project_id
                   and e.aspect = v.aspect
                   and e.manifest_key is not null
              )
              or exists (
                select 1 from app.render_jobs j
                 where j.project_id = v.project_id
                   and j.render_input->>'kind' = 'plate-film'
                   and j.render_input->>'manifestKey' is not null
                   and coalesce(j.render_input->>'aspect', v.aspect) = v.aspect
              )
            ) as has_frozen_manifest,
            (
              exists (
                select 1 from app.plate_exports e
                 where e.project_id = v.project_id
                   and e.aspect = v.aspect
                   and e.state in ('queued', 'assembling')
              )
              or exists (
                select 1 from app.render_jobs j
                 where j.project_id = v.project_id
                   and j.state in ('queued', 'planning', 'rendering')
                   and coalesce(j.render_input->>'aspect', v.aspect) = v.aspect
              )
            ) as has_export_in_flight
       from app.plate_variants v
      where v.state in ('checked', 'drawn', 'bundled')
        and v.source_key is not null
        ${options.projectId ? "and v.project_id = $1" : ""}
      order by v.created_at asc, v.project_id asc, v.scene_index asc, v.aspect asc, v.id asc`,
    options.projectId ? [options.projectId] : []
  );
  let frozenManifestVariantCount = 0;
  let exportInFlightVariantCount = 0;
  const frozenOrInFlightVariantIds: string[] = [];
  for (const r of frozenExportRes.rows) {
    if (r.has_frozen_manifest) frozenManifestVariantCount += 1;
    if (r.has_export_in_flight) exportInFlightVariantCount += 1;
    if (r.has_frozen_manifest || r.has_export_in_flight) {
      frozenOrInFlightVariantIds.push(r.id);
    }
  }

  // Legacy projects: rows in app.plate_state (with legacy_scenes or scenes) or plate-look projects in app.projects
  // that have zero rows in app.plate_variants.
  const legacyRes = await pool.query<{ project_id: string }>(
    `select s.project_id
       from app.plate_state s
      where not exists (select 1 from app.plate_variants v where v.project_id = s.project_id)
        and (
          (s.legacy_scenes is not null and s.legacy_scenes <> '[]'::jsonb)
          or (s.scenes is not null and s.scenes <> '[]'::jsonb)
        )
        ${options.projectId ? "and s.project_id = $1" : ""}
      union
     select p.id as project_id
       from app.projects p
      where p.data->'brief'->>'look' like 'illus-%'
        and not exists (select 1 from app.plate_variants v where v.project_id = p.id)
        ${options.projectId ? "and p.id = $1" : ""}`,
    options.projectId ? [options.projectId] : []
  );
  const legacyprojectIds = legacyRes.rows.map((r) => r.project_id).sort();

  const upToDateRes = await pool.query<{ n: string }>(
    `select count(*)::text as n
       from app.plate_variants
      where state in ('checked', 'drawn', 'bundled')
        and source_key is not null
        and bundle_manifest->>'engineDigest' = $1
        ${options.projectId ? "and project_id = $2" : ""}`,
    options.projectId ? [targetEngineDigest, options.projectId] : [targetEngineDigest]
  );
  const upToDateCount = Number(upToDateRes.rows[0]?.n ?? 0);

  const params: unknown[] = [targetEngineDigest];
  let whereProject = "";
  if (options.projectId) {
    params.push(options.projectId);
    whereProject = `and project_id = $${params.length}`;
  }
  let whereAfter = "";
  if (options.after) {
    const cursorRes = await pool.query<{
      id: string;
      created_at: Date;
      project_id: string;
      scene_index: number;
      aspect: Aspect;
    }>("select id, created_at, project_id, scene_index, aspect from app.plate_variants where id = $1", [options.after]);
    const cursorRow = cursorRes.rows[0];
    if (!cursorRow) {
      throw new Error(`Cursor variant not found: ${options.after}`);
    }
    params.push(cursorRow.created_at, cursorRow.project_id, cursorRow.scene_index, cursorRow.aspect, cursorRow.id);
    const base = params.length - 4;
    whereAfter = `and (created_at, project_id, scene_index, aspect, id) > ($${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
  }
  let limitClause = "";
  if (typeof options.limit === "number" && Number.isInteger(options.limit) && options.limit > 0) {
    params.push(options.limit);
    limitClause = `limit $${params.length}`;
  }

  const candRes = await pool.query<VariantRow>(
    `select *
       from app.plate_variants
      where state in ('checked', 'drawn', 'bundled')
        and source_key is not null
        and (bundle_manifest->>'engineDigest') is distinct from $1
        ${whereProject}
        ${whereAfter}
      order by created_at asc, project_id asc, scene_index asc, aspect asc, id asc
      ${limitClause}`,
    params
  );

  const staleCountsByState: Record<string, number> = {};
  const staleCountsByEngineDigest: Record<string, number> = {};
  let totalBytesToStage = 0;

  const candidates: StaleCandidateInfo[] = candRes.rows.map((row) => {
    staleCountsByState[row.state] = (staleCountsByState[row.state] ?? 0) + 1;
    const foundEngineDigest =
      typeof row.bundle_manifest?.engineDigest === "string" ? row.bundle_manifest.engineDigest : null;
    const digestKey = foundEngineDigest ?? "none";
    staleCountsByEngineDigest[digestKey] = (staleCountsByEngineDigest[digestKey] ?? 0) + 1;
    totalBytesToStage += manifestBundleBytes(row.bundle_manifest);
    return {
      variantId: row.id,
      projectId: row.project_id,
      sceneIndex: row.scene_index,
      aspect: row.aspect,
      gen: row.gen,
      rev: row.rev,
      state: row.state,
      frames: row.frames,
      sourceKey: row.source_key!,
      bundleKey: row.bundle_key,
      bundleDigest: row.bundle_digest,
      foundEngineDigest,
      currentEngineDigest: targetEngineDigest
    };
  });

  const sampleSize =
    typeof options.sample === "number" && Number.isInteger(options.sample) && options.sample >= 0 ? options.sample : 5;
  const sampleCandidateIds = candidates.slice(0, sampleSize).map((c) => c.variantId);
  const nextCursor = candidates.length > 0 ? candidates[candidates.length - 1]!.variantId : null;

  return {
    currentEngineVersion: currentVer,
    currentEngineDigest: targetEngineDigest,
    countsByState,
    staleCountsByState,
    countsByEngineDigest,
    staleCountsByEngineDigest,
    upToDateCount,
    legacySkippedProjects: legacyprojectIds.length,
    legacyprojectIds,
    frozenManifestVariantCount,
    exportInFlightVariantCount,
    frozenOrInFlightVariantCount: frozenOrInFlightVariantIds.length,
    frozenOrInFlightVariantIds,
    totalBytesToStage,
    sampleCandidateIds,
    after: options.after ?? null,
    nextCursor,
    candidates
  };
}

export type RebundleVariantOutcome =
  | {
      status: "committed";
      variantId: string;
      projectId: string;
      gen: number;
      oldRev: number;
      newRev: number;
      state: VariantState;
      oldBundleKey: string | null;
      newBundleKey: string;
      oldBundleDigest: string | null;
      newBundleDigest: string;
      oldEngineDigest: string | null;
      newEngineDigest: string;
      sourceSha: string;
      bundleSha: string;
      reusedStorage: boolean;
    }
  | {
      status: "queued_worker";
      variantId: string;
      projectId: string;
      gen: number;
      rev: number;
      newBundleKey: string;
      newBundleDigest: string;
      bundleSha: string;
    }
  | {
      status: "up_to_date" | "skipped" | "fenced" | "failed";
      variantId: string;
      projectId?: string;
      reason: string;
    };

export type RebundleOptions = {
  storage?: RebundleStorage;
  /**
   * How to verify the newly-bundled HTML before switching Postgres:
   *  - `"in-process"` (default): calls `verifier` (defaults to `defaultChromiumVerifier` which runs `verifyScene`)
   *    and then commits via `commitRebundleRevision`.
   *  - `"worker"`: stages & uploads the content-addressed bundle, then enqueues a `plate-rebundle` job for the worker
   *    to run `verifyScene` in its Chromium container and call the `rebundle.commit` control op.
   */
  mode?: "in-process" | "worker";
  verifier?: RebundleVerifier;
  lookOverride?: string;
};

/**
 * Re-bundles one plate variant from its saved `source_key` using `bundleScene` with zero model calls.
 */
export async function rebundleVariant(
  variantId: string,
  options: RebundleOptions = {}
): Promise<RebundleVariantOutcome> {
  const storage = options.storage ?? defaultStorage;
  const mode = options.mode ?? "in-process";
  const verifier = options.verifier ?? defaultChromiumVerifier;

  // Step 1: Snapshot candidate variant (no transaction held open)
  const snapshot = await getVariant(variantId);
  if (!snapshot) {
    return { status: "skipped", variantId, reason: "not_found" };
  }
  if (!["checked", "drawn", "bundled"].includes(snapshot.state)) {
    return { status: "skipped", variantId, projectId: snapshot.project_id, reason: `invalid_state:${snapshot.state}` };
  }
  if (!snapshot.source_key) {
    return { status: "skipped", variantId, projectId: snapshot.project_id, reason: "missing_source_key" };
  }

  const currentEngDigest = engineDigest();
  const snapshotEngDigest =
    typeof snapshot.bundle_manifest?.engineDigest === "string" ? snapshot.bundle_manifest.engineDigest : null;
  if (snapshotEngDigest === currentEngDigest) {
    return { status: "up_to_date", variantId, projectId: snapshot.project_id, reason: "already_current_engine" };
  }

  const project = await getProject(snapshot.project_id);
  const look = options.lookOverride ?? project?.brief?.look ?? null;
  if (!look || !isSupportedStyle(look)) {
    return { status: "skipped", variantId, projectId: snapshot.project_id, reason: "missing_or_unsupported_look" };
  }

  // Step 2: Fetch and verify saved source
  const sourceBytes = await storage.getObject("uploads", snapshot.source_key);
  if (!sourceBytes) {
    log("warn", "plate_rebundle_failed", { variantId, projectId: snapshot.project_id, reason: "source_not_found_in_storage" });
    return { status: "failed", variantId, projectId: snapshot.project_id, reason: "source_not_found_in_storage" };
  }
  const code = sourceBytes.toString("utf8");
  const computedSourceSha = sha256Nul24(code);
  const expectedSourceSha =
    typeof snapshot.bundle_manifest?.sourceSha === "string" ? snapshot.bundle_manifest.sourceSha : null;
  if (expectedSourceSha && computedSourceSha !== expectedSourceSha) {
    log("warn", "plate_rebundle_failed", {
      variantId,
      projectId: snapshot.project_id,
      reason: `sourceSha_mismatch:${computedSourceSha}!=${expectedSourceSha}`
    });
    return {
      status: "failed",
      variantId,
      projectId: snapshot.project_id,
      reason: `sourceSha mismatch (expected ${expectedSourceSha}, got ${computedSourceSha})`
    };
  }

  const curRevRow = await getRevision(snapshot.id, snapshot.rev);
  const currentParams = curRevRow?.params ?? (snapshot.repairs > 0 ? { __repair: snapshot.repairs } : {});

  // Step 3: Compile new bundle in memory (zero model calls)
  let bundle: Awaited<ReturnType<typeof bundleScene>>;
  try {
    bundle = await bundleScene({
      look,
      code,
      frames: snapshot.frames,
      aspect: snapshot.aspect
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("warn", "plate_rebundle_failed", { variantId, projectId: snapshot.project_id, reason: `bundle_failed:${msg.slice(0, 200)}` });
    return { status: "failed", variantId, projectId: snapshot.project_id, reason: `bundle_failed: ${msg}` };
  }

  const newBundleDigest = bundleDigest({
    manifest: bundle.manifest,
    params: currentParams
  });

  // Step 4: Upload to content-addressed keys and verify storage existence
  const newBundleKey = bundleKeyFor(snapshot, bundle.manifest.bundleSha);
  const newManifestKey = manifestKeyFor(snapshot, bundle.manifest.bundleSha);
  const manifestJson = JSON.stringify(bundle.manifest);
  const expectedHtmlBytes = Buffer.byteLength(bundle.html, "utf8");

  let reusedStorage = false;
  try {
    const putBundle = await putContentAddressedObject("uploads", newBundleKey, bundle.html, "text/html", storage);
    await putContentAddressedObject("uploads", newManifestKey, manifestJson, "application/json", storage);
    reusedStorage = putBundle.reused;
    const storedSize = await storage.objectSize("uploads", newBundleKey);
    if (storedSize !== expectedHtmlBytes) {
      throw new Error(`Uploaded bundle size (${storedSize}) does not match expected size (${expectedHtmlBytes}).`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("warn", "plate_rebundle_failed", { variantId, projectId: snapshot.project_id, reason: `storage_failed:${msg.slice(0, 200)}` });
    return { status: "failed", variantId, projectId: snapshot.project_id, reason: `storage_failed: ${msg}` };
  }

  // Step 5 (two-phase worker mode): enqueue worker verification job
  if (mode === "worker") {
    await boss.send(
      QUEUES.plateRebundle,
      {
        variantId: snapshot.id,
        projectId: snapshot.project_id,
        gen: snapshot.gen,
        rev: snapshot.rev,
        frames: snapshot.frames,
        expectedBundleDigest: snapshot.bundle_digest,
        bundleKey: newBundleKey,
        bundleDigest: newBundleDigest,
        bundleSha: bundle.manifest.bundleSha,
        bundleManifest: bundle.manifest,
        sourceKey: snapshot.source_key,
        params: currentParams
      },
      { singletonKey: `rebundle:${snapshot.id}:${snapshot.gen}:${snapshot.rev}` }
    );
    void kickPlateWorkers();
    return {
      status: "queued_worker",
      variantId: snapshot.id,
      projectId: snapshot.project_id,
      gen: snapshot.gen,
      rev: snapshot.rev,
      newBundleKey,
      newBundleDigest,
      bundleSha: bundle.manifest.bundleSha
    };
  }

  // Step 5 (in-process verification before cutover)
  const bakedHtml = bakeParamsIntoHtml(bundle.html, currentParams);
  const verifyRes = await verifier({
    variantId: snapshot.id,
    projectId: snapshot.project_id,
    aspect: snapshot.aspect,
    frames: snapshot.frames,
    html: bundle.html,
    bakedHtml,
    bundleKey: newBundleKey,
    bundleDigest: newBundleDigest,
    manifest: bundle.manifest,
    params: currentParams
  });
  if (!verifyRes.ok) {
    log("warn", "plate_rebundle_verify_failed", {
      variantId: snapshot.id,
      projectId: snapshot.project_id,
      gen: snapshot.gen,
      rev: snapshot.rev,
      reason: verifyRes.reason ?? "verification_failed"
    });
    return {
      status: "failed",
      variantId: snapshot.id,
      projectId: snapshot.project_id,
      reason: `verification_failed: ${verifyRes.reason ?? "unknown"}`
    };
  }

  // Step 6: Atomic Postgres pointer switch (single short fenced transaction)
  const commitRes = await commitRebundleRevision({
    variantId: snapshot.id,
    gen: snapshot.gen,
    rev: snapshot.rev,
    expectedBundleDigest: snapshot.bundle_digest,
    bundleKey: newBundleKey,
    bundleDigest: newBundleDigest,
    bundleManifest: bundle.manifest,
    sourceKey: snapshot.source_key,
    params: currentParams,
    author: "engine-rebundle",
    host: "worker"
  });

  if (!commitRes.committed) {
    log("info", "plate_rebundle_fenced", {
      variantId: snapshot.id,
      projectId: snapshot.project_id,
      gen: snapshot.gen,
      rev: snapshot.rev,
      reason: commitRes.reason
    });
    return {
      status: "fenced",
      variantId: snapshot.id,
      projectId: snapshot.project_id,
      reason: commitRes.reason
    };
  }

  log("info", "plate_rebundle_committed", {
    variantId: snapshot.id,
    projectId: snapshot.project_id,
    gen: snapshot.gen,
    oldRev: snapshot.rev,
    newRev: commitRes.rev,
    oldEngineDigest: snapshotEngDigest,
    newEngineDigest: bundle.manifest.engineDigest,
    newBundleKey,
    newBundleDigest
  });

  return {
    status: "committed",
    variantId: snapshot.id,
    projectId: snapshot.project_id,
    gen: snapshot.gen,
    oldRev: snapshot.rev,
    newRev: commitRes.rev,
    state: commitRes.state,
    oldBundleKey: snapshot.bundle_key,
    newBundleKey,
    oldBundleDigest: snapshot.bundle_digest,
    newBundleDigest,
    oldEngineDigest: snapshotEngDigest,
    newEngineDigest: String(bundle.manifest.engineDigest),
    sourceSha: bundle.manifest.sourceSha,
    bundleSha: bundle.manifest.bundleSha,
    reusedStorage
  };
}

export type RebundleBatchSummary = {
  dryRun: boolean;
  scan: RebundleScanReport;
  committed: number;
  queuedWorker: number;
  fenced: number;
  failed: number;
  skipped: number;
  inFlight: number;
  maxInFlight: number | null;
  stoppedByMaxInFlight: boolean;
  after: string | null;
  nextCursor: string | null;
  outcomes: RebundleVariantOutcome[];
};

/**
 * Counts how many `plate-rebundle` worker jobs are currently queued (`created` or `retry`) or `active` in `pgboss.job`.
 */
export async function countInFlightRebundleJobs(): Promise<number> {
  try {
    const { rows } = await pool.query<{ n: string }>(
      "select count(*)::text as n from pgboss.job where name = $1 and state in ('created', 'retry', 'active')",
      [QUEUES.plateRebundle]
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Scans and optionally re-bundles stale plate variants (`dryRun: true` by default).
 */
export async function rebundleStaleVariants(options: {
  dryRun?: boolean;
  limit?: number;
  after?: string;
  sample?: number;
  maxInFlight?: number;
  projectId?: string;
  storage?: RebundleStorage;
  mode?: "in-process" | "worker";
  verifier?: RebundleVerifier;
} = {}): Promise<RebundleBatchSummary> {
  const dryRun = options.dryRun ?? true;
  const effectiveMaxInFlight =
    options.maxInFlight !== undefined ? options.maxInFlight : options.mode === "worker" ? 5 : undefined;
  const scan = await scanRebundleCandidates({
    projectId: options.projectId,
    limit: options.limit,
    after: options.after,
    sample: options.sample
  });

  if (dryRun) {
    const inFlight = await countInFlightRebundleJobs();
    return {
      dryRun: true,
      scan,
      committed: 0,
      queuedWorker: 0,
      fenced: 0,
      failed: 0,
      skipped: 0,
      inFlight,
      maxInFlight: effectiveMaxInFlight ?? null,
      stoppedByMaxInFlight: false,
      after: options.after ?? null,
      nextCursor: scan.nextCursor,
      outcomes: []
    };
  }

  const outcomes: RebundleVariantOutcome[] = [];
  let committed = 0;
  let queuedWorker = 0;
  let fenced = 0;
  let failed = 0;
  let skipped = 0;
  let stoppedByMaxInFlight = false;
  let lastProcessedId: string | null = null;

  for (const cand of scan.candidates) {
    if (effectiveMaxInFlight !== undefined) {
      const currentInFlight = await countInFlightRebundleJobs();
      if (currentInFlight >= effectiveMaxInFlight) {
        stoppedByMaxInFlight = true;
        break;
      }
    }
    const out = await rebundleVariant(cand.variantId, {
      storage: options.storage,
      mode: options.mode,
      verifier: options.verifier
    });
    outcomes.push(out);
    lastProcessedId = cand.variantId;
    if (out.status === "committed") committed += 1;
    else if (out.status === "queued_worker") queuedWorker += 1;
    else if (out.status === "fenced") fenced += 1;
    else if (out.status === "failed") failed += 1;
    else skipped += 1;
  }

  const inFlight = await countInFlightRebundleJobs();

  return {
    dryRun: false,
    scan,
    committed,
    queuedWorker,
    fenced,
    failed,
    skipped,
    inFlight,
    maxInFlight: effectiveMaxInFlight ?? null,
    stoppedByMaxInFlight,
    after: options.after ?? null,
    nextCursor: lastProcessedId,
    outcomes
  };
}

export type RebundleVariantStatus = {
  variantId: string;
  projectId: string;
  sceneIndex: number;
  aspect: Aspect;
  state: VariantState;
  gen: number;
  rev: number;
  activeBundleKey: string | null;
  activeBundleDigest: string | null;
  activeEngineDigest: string | null;
  activeBundleIsNew: boolean;
  updatedAt: string;
  jobState: string | null;
  job: {
    id: string;
    state: string;
    stagedBundleKey: string | null;
    stagedBundleDigest: string | null;
    createdOn: string | null;
    completedOn: string | null;
  } | null;
  revision: {
    rev: number;
    author: string | null;
    bundleKey: string | null;
    bundleDigest: string | null;
    engineDigest: string | null;
    createdAt: string;
  } | null;
};

export type RebundleStatusReport = {
  minutes: number;
  currentEngineVersion: string;
  currentEngineDigest: string;
  inFlightJobs: number;
  jobCountsByState: Record<string, number>;
  committedCount: number;
  variants: RebundleVariantStatus[];
};

/**
 * Strictly read-only status inspection for variants touched in the last N minutes:
 * reports the job state from `pgboss.job`, the `engine-rebundle` revision row from `app.plate_revisions`,
 * and whether the active `bundle_key` on `app.plate_variants` is the newly re-bundled one.
 */
export async function getRebundleStatus(options: {
  minutes?: number;
  projectId?: string;
} = {}): Promise<RebundleStatusReport> {
  const minutes =
    typeof options.minutes === "number" && Number.isInteger(options.minutes) && options.minutes > 0
      ? options.minutes
      : 60;
  const targetEngineDigest = engineDigest();
  const currentVer = engineVersion();

  const client = await pool.connect();
  try {
    await client.query("begin read only");

    let jobCountsByState: Record<string, number> = {};
    let inFlightJobs = 0;
    try {
      const jobStatsRes = await client.query<{ state: string; n: string }>(
        "select state::text as state, count(*)::text as n from pgboss.job where name = $1 group by state",
        [QUEUES.plateRebundle]
      );
      for (const r of jobStatsRes.rows) {
        const count = Number(r.n);
        jobCountsByState[r.state] = count;
        if (r.state === "created" || r.state === "retry" || r.state === "active") {
          inFlightJobs += count;
        }
      }
    } catch {
      jobCountsByState = {};
      inFlightJobs = 0;
    }

    const params: unknown[] = [minutes, QUEUES.plateRebundle];
    let whereProject = "";
    if (options.projectId) {
      params.push(options.projectId);
      whereProject = `and v.project_id = $${params.length}`;
    }

    const touchedRes = await client.query<VariantRow>(
      `select v.*
         from app.plate_variants v
        where (
          v.updated_at >= now() - make_interval(mins => $1::int)
          or exists (
            select 1 from app.plate_revisions r
             where r.variant_id = v.id
               and r.author = 'engine-rebundle'
               and r.created_at >= now() - make_interval(mins => $1::int)
          )
          or exists (
            select 1 from pgboss.job j
             where j.name = $2
               and j.data->>'variantId' = v.id::text
               and coalesce(j.completed_on, j.started_on, j.created_on) >= now() - make_interval(mins => $1::int)
          )
        )
        ${whereProject}
        order by v.updated_at desc, v.created_at asc, v.id asc`,
      params
    );

    const variants: RebundleVariantStatus[] = [];
    let committedCount = 0;

    for (const v of touchedRes.rows) {
      const revRes = await client.query<RevisionRow & { created_at: Date }>(
        `select *
           from app.plate_revisions
          where variant_id = $1
            and author = 'engine-rebundle'
          order by rev desc
          limit 1`,
        [v.id]
      );
      const revRow = revRes.rows[0] ?? null;

      let jobInfo: RebundleVariantStatus["job"] = null;
      try {
        const jobRes = await client.query<{
          id: string;
          state: string;
          data: Record<string, unknown> | null;
          created_on: Date | null;
          completed_on: Date | null;
        }>(
          `select id::text as id, state::text as state, data, created_on, completed_on
             from pgboss.job
            where name = $1
              and data->>'variantId' = $2
            order by created_on desc
            limit 1`,
          [QUEUES.plateRebundle, v.id]
        );
        const j = jobRes.rows[0];
        if (j) {
          jobInfo = {
            id: j.id,
            state: j.state,
            stagedBundleKey: typeof j.data?.bundleKey === "string" ? j.data.bundleKey : null,
            stagedBundleDigest: typeof j.data?.bundleDigest === "string" ? j.data.bundleDigest : null,
            createdOn: j.created_on ? new Date(j.created_on).toISOString() : null,
            completedOn: j.completed_on ? new Date(j.completed_on).toISOString() : null
          };
        }
      } catch {
        jobInfo = null;
      }

      const activeEngineDigest =
        typeof v.bundle_manifest?.engineDigest === "string" ? v.bundle_manifest.engineDigest : null;
      const revEngineDigest =
        revRow && typeof revRow.bundle_manifest?.engineDigest === "string"
          ? revRow.bundle_manifest.engineDigest
          : null;

      const activeBundleIsNew = Boolean(
        revRow &&
          v.bundle_key &&
          v.bundle_key === revRow.bundle_key &&
          v.rev === revRow.rev &&
          activeEngineDigest === targetEngineDigest
      );
      if (activeBundleIsNew) committedCount += 1;

      variants.push({
        variantId: v.id,
        projectId: v.project_id,
        sceneIndex: v.scene_index,
        aspect: v.aspect,
        state: v.state,
        gen: v.gen,
        rev: v.rev,
        activeBundleKey: v.bundle_key,
        activeBundleDigest: v.bundle_digest,
        activeEngineDigest,
        activeBundleIsNew,
        updatedAt: new Date(v.updated_at).toISOString(),
        jobState: jobInfo?.state ?? null,
        job: jobInfo,
        revision: revRow
          ? {
              rev: revRow.rev,
              author: revRow.author,
              bundleKey: revRow.bundle_key,
              bundleDigest: revRow.bundle_digest,
              engineDigest: revEngineDigest,
              createdAt: new Date((revRow as { created_at: Date }).created_at).toISOString()
            }
          : null
      });
    }

    await client.query("commit");

    return {
      minutes,
      currentEngineVersion: currentVer,
      currentEngineDigest: targetEngineDigest,
      inFlightJobs,
      jobCountsByState,
      committedCount,
      variants
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Fallback manifest resolver for rolling back to a pre-030 revision row whose `bundle_manifest` column is null:
 * reads `${bundleDir}manifest.json` from `"uploads"` if available.
 */
async function resolveManifestFromStorage(
  prevRev: RevisionRow,
  storage: Pick<RebundleStorage, "getObject"> = defaultStorage
): Promise<Record<string, unknown> | null> {
  if (prevRev.bundle_manifest) return prevRev.bundle_manifest;
  if (!prevRev.bundle_key) return null;
  const slashIdx = prevRev.bundle_key.lastIndexOf("/");
  if (slashIdx < 0) return null;
  const manifestKey = `${prevRev.bundle_key.slice(0, slashIdx + 1)}manifest.json`;
  try {
    const bytes = await storage.getObject("uploads", manifestKey);
    if (!bytes) return null;
    const parsed = JSON.parse(bytes.toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Rolls back a single variant or all variants whose active revision has `author = 'engine-rebundle'`.
 */
export async function rollbackRebundleTarget(
  target: string,
  options: { projectId?: string; storage?: Pick<RebundleStorage, "getObject"> } = {}
): Promise<{ rolledBack: number; outcomes: RollbackRebundleOutcome[] }> {
  const storage = options.storage ?? defaultStorage;
  const resolver = (prev: RevisionRow) => resolveManifestFromStorage(prev, storage);

  if (target !== "all-engine-rebundle") {
    const single = await rollbackRebundleRevision(target, resolver);
    return {
      rolledBack: single.rolledBack ? 1 : 0,
      outcomes: [single]
    };
  }

  const { rows } = await pool.query<{ id: string }>(
    `select v.id
       from app.plate_variants v
       join app.plate_revisions r
         on r.variant_id = v.id and r.rev = v.rev
      where r.author = 'engine-rebundle'
        ${options.projectId ? "and v.project_id = $1" : ""}
      order by v.created_at asc, v.project_id asc, v.scene_index asc, v.aspect asc`,
    options.projectId ? [options.projectId] : []
  );

  const outcomes: RollbackRebundleOutcome[] = [];
  let rolledBack = 0;
  for (const row of rows) {
    const out = await rollbackRebundleRevision(row.id, resolver);
    outcomes.push(out);
    if (out.rolledBack) rolledBack += 1;
  }
  return { rolledBack, outcomes };
}

/**
 * Rolls back the `count` most recent active `engine-rebundle` commits (`--rollback-last <n>`).
 */
export async function rollbackLastRebundleCommits(
  count: number,
  options: { projectId?: string; storage?: Pick<RebundleStorage, "getObject"> } = {}
): Promise<{ requested: number; rolledBack: number; outcomes: RollbackRebundleOutcome[] }> {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("rollbackLastRebundleCommits requires a positive integer count.");
  }
  const storage = options.storage ?? defaultStorage;
  const resolver = (prev: RevisionRow) => resolveManifestFromStorage(prev, storage);

  const params: unknown[] = [count];
  let whereProject = "";
  if (options.projectId) {
    params.push(options.projectId);
    whereProject = `and v.project_id = $${params.length}`;
  }

  const { rows } = await pool.query<{ id: string }>(
    `select v.id
       from app.plate_variants v
       join app.plate_revisions r
         on r.variant_id = v.id and r.rev = v.rev
      where r.author = 'engine-rebundle'
        ${whereProject}
      order by r.created_at desc, v.updated_at desc, r.rev desc, v.id desc
      limit $1`,
    params
  );

  const outcomes: RollbackRebundleOutcome[] = [];
  let rolledBack = 0;
  for (const row of rows) {
    const out = await rollbackRebundleRevision(row.id, resolver);
    outcomes.push(out);
    if (out.rolledBack) rolledBack += 1;
  }
  return { requested: count, rolledBack, outcomes };
}
