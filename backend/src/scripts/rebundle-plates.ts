/**
 * CLI for re-bundling existing plate variants onto the current plate engine (`packages/plate-engine`)
 * without any LLM / model calls, checking batch status, or rolling back `engine-rebundle` revisions.
 *
 * Safety guards (mandatory):
 *   1. Local (`APP_ENV=local`): `enforceLocalSafetyGuard` refuses unless `DATABASE_URL` points to
 *      `localhost` or `127.0.0.1` (and if `R2_ENDPOINT` is set, its host is also `localhost` or `127.0.0.1`).
 *   2. Staging (`APP_ENV=staging`): `enforceStagingOptIn` requires explicit opt-in for every write path
 *      (`--apply`, `--rollback`, `--rollback-last`):
 *        - `REBUNDLE_STAGING_OPT_IN="I-understand-this-is-staging"`
 *        - `REBUNDLE_EXPECT_DB_HOST` equal to the hostname of `DATABASE_URL`
 *        - `REBUNDLE_EXPECT_R2_BUCKET` equal to `R2_UPLOADS_BUCKET`
 *        - `REBUNDLE_FORBID_DB_HOST` and `REBUNDLE_FORBID_R2_BUCKET` set and not matching target
 *        - `--mode worker` (in-process is refused for non-local)
 *      Read-only modes (`--dry-run` default and `--status`) may skip the opt-in variables on staging
 *      while still refusing production hosts/buckets and non-staging/non-local environments.
 *   3. Production (`APP_ENV=production`) and any other `APP_ENV` value are unconditionally refused.
 *   4. Never prints database URLs, passwords, access keys, or tokens; prints host and bucket names only.
 */

export function enforceLocalSafetyGuard(env: NodeJS.ProcessEnv = process.env): void {
  if (env.APP_ENV !== "local") {
    throw new Error(`Refusing to run rebundle-plates: APP_ENV must be "local" (got ${JSON.stringify(env.APP_ENV ?? "")}).`);
  }
  const rawDbUrl = env.DATABASE_URL ?? "";
  if (!rawDbUrl) {
    throw new Error("Refusing to run rebundle-plates: DATABASE_URL is required.");
  }
  let dbHost = "";
  try {
    dbHost = new URL(rawDbUrl).hostname;
  } catch {
    throw new Error("Refusing to run rebundle-plates: DATABASE_URL is not a valid URL.");
  }
  if (dbHost !== "localhost" && dbHost !== "127.0.0.1") {
    throw new Error(
      `Refusing to run rebundle-plates: DATABASE_URL host must be "localhost" or "127.0.0.1" (got ${JSON.stringify(dbHost)}).`
    );
  }
  if (env.R2_ENDPOINT) {
    let r2Host = "";
    try {
      r2Host = new URL(env.R2_ENDPOINT).hostname;
    } catch {
      throw new Error("Refusing to run rebundle-plates: R2_ENDPOINT is not a valid URL.");
    }
    if (r2Host !== "localhost" && r2Host !== "127.0.0.1") {
      throw new Error(
        `Refusing to run rebundle-plates: R2_ENDPOINT host must be "localhost" or "127.0.0.1" when APP_ENV=local (got ${JSON.stringify(r2Host)}).`
      );
    }
  }
}

/**
 * Checked-in non-secret forbid-list of known production database hosts, Supabase project refs, and R2 bucket names.
 * Belt-and-braces protection against copy-paste mistakes when running against staging.
 */
export const PRODUCTION_FORBID_LIST = {
  dbHosts: [
    "db.bwwquxhexwyodsavsjar.supabase.co",
    "bwwquxhexwyodsavsjar.supabase.co"
  ],
  supabaseProjectRefs: [
    "bwwquxhexwyodsavsjar"
  ],
  r2Buckets: [
    "greedymotion-production-uploads",
    "greedymotion-production-outputs",
    "greedymotion-production-media",
    "videosaas-production-uploads",
    "videosaas-production-outputs",
    "videosaas-production-media"
  ]
} as const;

const PROD_NAME_TOKEN_RE = /(^|[._-])prod(uction)?([._-]|$)/i;

function splitCsvLower(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isProductionLookingDb(dbHost: string, dbUser: string): boolean {
  const lowerHost = dbHost.toLowerCase();
  const lowerUser = dbUser.toLowerCase();
  if (PRODUCTION_FORBID_LIST.dbHosts.some((h) => h.toLowerCase() === lowerHost)) return true;
  if (PRODUCTION_FORBID_LIST.supabaseProjectRefs.some((ref) => lowerHost.includes(ref) || lowerUser.includes(ref))) {
    return true;
  }
  if (PROD_NAME_TOKEN_RE.test(lowerHost) || PROD_NAME_TOKEN_RE.test(lowerUser)) return true;
  return false;
}

function isProductionLookingBucket(bucket: string): boolean {
  const lower = bucket.trim().toLowerCase();
  if (!lower) return false;
  if (PRODUCTION_FORBID_LIST.r2Buckets.some((b) => b.toLowerCase() === lower)) return true;
  if (PROD_NAME_TOKEN_RE.test(lower)) return true;
  return false;
}

export type StagingGuardOptions = {
  mode?: "in-process" | "worker";
  readOnly?: boolean;
  skipBrowserVerify?: boolean;
};

export type SafeEnvironmentSummary = {
  appEnv: "local" | "staging";
  dbHost: string;
  r2Host: string | null;
  r2Bucket: string | null;
};

/**
 * Enforces the narrow staging opt-in guard (`APP_ENV=staging` only) and production forbid-list.
 * Returns sanitized host/bucket names only (never URLs, passwords, keys, or tokens).
 */
export function enforceStagingOptIn(
  env: NodeJS.ProcessEnv = process.env,
  options?: StagingGuardOptions | "in-process" | "worker"
): SafeEnvironmentSummary {
  const opts: StagingGuardOptions =
    typeof options === "string" ? { mode: options } : (options ?? {});
  const readOnly = opts.readOnly ?? false;
  const mode = opts.mode ?? ((env.REBUNDLE_MODE as "in-process" | "worker" | undefined) ?? "worker");

  if (env.APP_ENV !== "staging") {
    throw new Error(
      `Refusing to run rebundle-plates: APP_ENV must be "staging" for staging opt-in (got ${JSON.stringify(env.APP_ENV ?? "")}).`
    );
  }

  const rawDbUrl = env.DATABASE_URL ?? "";
  if (!rawDbUrl) {
    throw new Error("Refusing to run rebundle-plates: DATABASE_URL is required.");
  }
  let dbHost = "";
  let dbUser = "";
  try {
    const parsedDb = new URL(rawDbUrl);
    dbHost = parsedDb.hostname;
    dbUser = decodeURIComponent(parsedDb.username || "");
  } catch {
    throw new Error("Refusing to run rebundle-plates: DATABASE_URL is not a valid URL.");
  }
  if (!dbHost) {
    throw new Error("Refusing to run rebundle-plates: DATABASE_URL must include a hostname.");
  }

  let r2Host: string | null = null;
  if (env.R2_ENDPOINT) {
    try {
      r2Host = new URL(env.R2_ENDPOINT).hostname;
    } catch {
      throw new Error("Refusing to run rebundle-plates: R2_ENDPOINT is not a valid URL.");
    }
  }

  const r2Bucket = (env.R2_UPLOADS_BUCKET ?? "").trim();
  if (!r2Bucket) {
    throw new Error("Refusing to run rebundle-plates: R2_UPLOADS_BUCKET is required when APP_ENV=staging.");
  }
  const extraBuckets = [env.R2_OUTPUTS_BUCKET, env.R2_MEDIA_BUCKET]
    .map((b) => (b ?? "").trim())
    .filter(Boolean);

  // 1. Checked-in production forbid-list (applies to both read-only and write paths)
  if (isProductionLookingDb(dbHost, dbUser)) {
    throw new Error(
      `Refusing to run rebundle-plates: database target (host ${JSON.stringify(dbHost)}) matches the production forbid-list.`
    );
  }
  for (const b of [r2Bucket, ...extraBuckets]) {
    if (isProductionLookingBucket(b)) {
      throw new Error(
        `Refusing to run rebundle-plates: R2 bucket ${JSON.stringify(b)} matches the production forbid-list.`
      );
    }
  }

  // 2. Operator-supplied forbid variables (required on write paths; honoured on read-only paths if present)
  const forbidDbRaw = (env.REBUNDLE_FORBID_DB_HOST ?? "").trim();
  const forbidBucketRaw = (env.REBUNDLE_FORBID_R2_BUCKET ?? "").trim();
  if (!readOnly) {
    if (!forbidDbRaw) {
      throw new Error("Refusing to run rebundle-plates: REBUNDLE_FORBID_DB_HOST is required for staging writes.");
    }
    if (!forbidBucketRaw) {
      throw new Error("Refusing to run rebundle-plates: REBUNDLE_FORBID_R2_BUCKET is required for staging writes.");
    }
  }
  const forbidDbHosts = splitCsvLower(forbidDbRaw);
  if (forbidDbHosts.length > 0) {
    const lowerHost = dbHost.toLowerCase();
    const lowerUser = dbUser.toLowerCase();
    if (forbidDbHosts.some((f) => f === lowerHost || (f.length >= 6 && lowerUser.includes(f)))) {
      throw new Error(
        `Refusing to run rebundle-plates: DATABASE_URL host ${JSON.stringify(dbHost)} matches forbidden host REBUNDLE_FORBID_DB_HOST.`
      );
    }
  }
  const forbidBuckets = splitCsvLower(forbidBucketRaw);
  if (forbidBuckets.length > 0) {
    for (const b of [r2Bucket, ...extraBuckets]) {
      if (forbidBuckets.includes(b.toLowerCase())) {
        throw new Error(
          `Refusing to run rebundle-plates: R2 bucket ${JSON.stringify(b)} matches forbidden bucket REBUNDLE_FORBID_R2_BUCKET.`
        );
      }
    }
  }

  if (readOnly) {
    if (env.REBUNDLE_EXPECT_DB_HOST && env.REBUNDLE_EXPECT_DB_HOST !== dbHost) {
      throw new Error(
        `Refusing to run rebundle-plates: REBUNDLE_EXPECT_DB_HOST (${JSON.stringify(env.REBUNDLE_EXPECT_DB_HOST)}) does not match DATABASE_URL host (${JSON.stringify(dbHost)}).`
      );
    }
    if (env.REBUNDLE_EXPECT_R2_BUCKET && env.REBUNDLE_EXPECT_R2_BUCKET !== r2Bucket) {
      throw new Error(
        `Refusing to run rebundle-plates: REBUNDLE_EXPECT_R2_BUCKET (${JSON.stringify(env.REBUNDLE_EXPECT_R2_BUCKET)}) does not match configured R2_UPLOADS_BUCKET (${JSON.stringify(r2Bucket)}).`
      );
    }
    return { appEnv: "staging", dbHost, r2Host, r2Bucket };
  }

  // 3. Full write opt-in checks (--apply, --rollback, --rollback-last)
  if (env.REBUNDLE_STAGING_OPT_IN !== "I-understand-this-is-staging") {
    throw new Error(
      'Refusing to run rebundle-plates: REBUNDLE_STAGING_OPT_IN must be "I-understand-this-is-staging" for staging writes.'
    );
  }
  if (!env.REBUNDLE_EXPECT_DB_HOST || env.REBUNDLE_EXPECT_DB_HOST !== dbHost) {
    throw new Error(
      `Refusing to run rebundle-plates: REBUNDLE_EXPECT_DB_HOST (${JSON.stringify(env.REBUNDLE_EXPECT_DB_HOST ?? "")}) does not match DATABASE_URL host (${JSON.stringify(dbHost)}).`
    );
  }
  if (!env.REBUNDLE_EXPECT_R2_BUCKET || env.REBUNDLE_EXPECT_R2_BUCKET !== r2Bucket) {
    throw new Error(
      `Refusing to run rebundle-plates: REBUNDLE_EXPECT_R2_BUCKET (${JSON.stringify(env.REBUNDLE_EXPECT_R2_BUCKET ?? "")}) does not match configured R2_UPLOADS_BUCKET (${JSON.stringify(r2Bucket)}).`
    );
  }
  if (mode !== "worker") {
    throw new Error(
      `Refusing to run rebundle-plates: non-local runs require --mode worker (got ${JSON.stringify(mode)}).`
    );
  }
  if (opts.skipBrowserVerify) {
    throw new Error("Refusing to run rebundle-plates: --skip-browser-verify is forbidden when APP_ENV=staging.");
  }

  return { appEnv: "staging", dbHost, r2Host, r2Bucket };
}

export type CliArgs = {
  apply: boolean;
  limit?: number;
  after?: string;
  maxInFlight: number;
  sample: number;
  projectId?: string;
  rollback?: string;
  rollbackLast?: number;
  status: boolean;
  statusMinutes: number;
  mode: "in-process" | "worker";
  skipBrowserVerify: boolean;
};

export function parseCliArgs(argv: string[]): CliArgs {
  let apply = false;
  let limit: number | undefined;
  let after: string | undefined;
  let maxInFlight = 5;
  let sample = 5;
  let projectId: string | undefined;
  let rollback: string | undefined;
  let rollbackLast: number | undefined;
  let status = false;
  let statusMinutes = 60;
  let mode: "in-process" | "worker" = "in-process";
  let skipBrowserVerify = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--dry-run") {
      apply = false;
    } else if (arg === "--limit") {
      const next = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isInteger(next) || next < 1) {
        throw new Error("--limit requires a positive integer.");
      }
      limit = next;
    } else if (arg.startsWith("--limit=")) {
      const next = Number.parseInt(arg.slice("--limit=".length), 10);
      if (!Number.isInteger(next) || next < 1) {
        throw new Error("--limit requires a positive integer.");
      }
      limit = next;
    } else if (arg === "--after") {
      after = argv[++i];
      if (!after) throw new Error("--after requires a variant UUID.");
    } else if (arg.startsWith("--after=")) {
      after = arg.slice("--after=".length);
      if (!after) throw new Error("--after requires a variant UUID.");
    } else if (arg === "--max-in-flight") {
      const next = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isInteger(next) || next < 1) {
        throw new Error("--max-in-flight requires a positive integer.");
      }
      maxInFlight = next;
    } else if (arg.startsWith("--max-in-flight=")) {
      const next = Number.parseInt(arg.slice("--max-in-flight=".length), 10);
      if (!Number.isInteger(next) || next < 1) {
        throw new Error("--max-in-flight requires a positive integer.");
      }
      maxInFlight = next;
    } else if (arg === "--sample") {
      const next = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isInteger(next) || next < 1) {
        throw new Error("--sample requires a positive integer.");
      }
      sample = next;
    } else if (arg.startsWith("--sample=")) {
      const next = Number.parseInt(arg.slice("--sample=".length), 10);
      if (!Number.isInteger(next) || next < 1) {
        throw new Error("--sample requires a positive integer.");
      }
      sample = next;
    } else if (arg === "--project") {
      projectId = argv[++i];
      if (!projectId) throw new Error("--project requires a project UUID.");
    } else if (arg.startsWith("--project=")) {
      projectId = arg.slice("--project=".length);
      if (!projectId) throw new Error("--project requires a project UUID.");
    } else if (arg === "--rollback") {
      rollback = argv[++i];
      if (!rollback) throw new Error("--rollback requires a variantId or 'all-engine-rebundle'.");
    } else if (arg.startsWith("--rollback=")) {
      rollback = arg.slice("--rollback=".length);
      if (!rollback) throw new Error("--rollback requires a variantId or 'all-engine-rebundle'.");
    } else if (arg === "--rollback-last") {
      const next = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isInteger(next) || next < 1) {
        throw new Error("--rollback-last requires a positive integer.");
      }
      rollbackLast = next;
    } else if (arg.startsWith("--rollback-last=")) {
      const next = Number.parseInt(arg.slice("--rollback-last=".length), 10);
      if (!Number.isInteger(next) || next < 1) {
        throw new Error("--rollback-last requires a positive integer.");
      }
      rollbackLast = next;
    } else if (arg === "--status") {
      status = true;
      const peek = argv[i + 1];
      if (peek !== undefined && !peek.startsWith("--")) {
        const parsed = Number.parseInt(peek, 10);
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error("--status optional minutes argument must be a positive integer.");
        }
        statusMinutes = parsed;
        i += 1;
      }
    } else if (arg.startsWith("--status=")) {
      status = true;
      const parsed = Number.parseInt(arg.slice("--status=".length), 10);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error("--status requires a positive integer minutes value.");
      }
      statusMinutes = parsed;
    } else if (arg === "--minutes" || arg === "--since-minutes") {
      const next = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isInteger(next) || next < 1) {
        throw new Error(`${arg} requires a positive integer.`);
      }
      statusMinutes = next;
    } else if (arg.startsWith("--minutes=") || arg.startsWith("--since-minutes=")) {
      const val = arg.slice(arg.indexOf("=") + 1);
      const next = Number.parseInt(val, 10);
      if (!Number.isInteger(next) || next < 1) {
        throw new Error("--minutes requires a positive integer.");
      }
      statusMinutes = next;
    } else if (arg === "--mode") {
      const m = argv[++i];
      if (m !== "in-process" && m !== "worker") {
        throw new Error('--mode must be "in-process" or "worker".');
      }
      mode = m;
    } else if (arg.startsWith("--mode=")) {
      const m = arg.slice("--mode=".length);
      if (m !== "in-process" && m !== "worker") {
        throw new Error('--mode must be "in-process" or "worker".');
      }
      mode = m;
    } else if (arg === "--skip-browser-verify") {
      skipBrowserVerify = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    apply,
    limit,
    after,
    maxInFlight,
    sample,
    projectId,
    rollback,
    rollbackLast,
    status,
    statusMinutes,
    mode,
    skipBrowserVerify
  };
}

function resolveSafeEnvSummary(env: NodeJS.ProcessEnv, args: CliArgs): SafeEnvironmentSummary {
  const isWriteAction = Boolean(args.apply || args.rollback || args.rollbackLast !== undefined);
  if (env.APP_ENV === "staging") {
    return enforceStagingOptIn(env, {
      mode: args.mode,
      readOnly: !isWriteAction,
      skipBrowserVerify: args.skipBrowserVerify
    });
  }
  enforceLocalSafetyGuard(env);
  const dbHost = new URL(env.DATABASE_URL!).hostname;
  const r2Host = env.R2_ENDPOINT ? new URL(env.R2_ENDPOINT).hostname : null;
  const r2Bucket = env.R2_UPLOADS_BUCKET ?? null;
  return { appEnv: "local", dbHost, r2Host, r2Bucket };
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const envSummary = resolveSafeEnvSummary(process.env, args);

  const { migrate, pool } = await import("../db/database.ts");
  const { boss, startQueues } = await import("../jobs/queues.ts");
  const {
    getRebundleStatus,
    rebundleStaleVariants,
    rollbackLastRebundleCommits,
    rollbackRebundleTarget
  } = await import("../plates/rebundle.ts");

  const needsWriteSetup = !args.status;
  if (needsWriteSetup) {
    await migrate();
  }
  const startedQueues = Boolean(needsWriteSetup && args.mode === "worker" && !args.rollback && args.rollbackLast === undefined);
  if (startedQueues) {
    await startQueues();
  }

  try {
    if (args.status) {
      const report = await getRebundleStatus({
        minutes: args.statusMinutes,
        ...(args.projectId ? { projectId: args.projectId } : {})
      });
      console.log(
        JSON.stringify(
          {
            action: "status",
            environment: envSummary,
            ...report
          },
          null,
          2
        )
      );
      return;
    }

    if (args.rollback) {
      const res = await rollbackRebundleTarget(args.rollback, {
        ...(args.projectId ? { projectId: args.projectId } : {})
      });
      console.log(
        JSON.stringify(
          {
            action: "rollback",
            environment: envSummary,
            target: args.rollback,
            ...res
          },
          null,
          2
        )
      );
      return;
    }

    if (args.rollbackLast !== undefined) {
      const res = await rollbackLastRebundleCommits(args.rollbackLast, {
        ...(args.projectId ? { projectId: args.projectId } : {})
      });
      console.log(
        JSON.stringify(
          {
            action: "rollback-last",
            environment: envSummary,
            count: args.rollbackLast,
            ...res
          },
          null,
          2
        )
      );
      return;
    }

    const summary = await rebundleStaleVariants({
      dryRun: !args.apply,
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
      ...(args.after !== undefined ? { after: args.after } : {}),
      maxInFlight: args.maxInFlight,
      sample: args.sample,
      ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
      mode: args.mode,
      ...(args.skipBrowserVerify
        ? {
            verifier: async (input) => ({
              ok: input.html.includes("window.FILM") && Boolean(input.manifest.engineDigest)
            })
          }
        : {})
    });

    console.log(
      JSON.stringify(
        {
          action: args.apply ? "apply" : "dry-run",
          environment: envSummary,
          currentEngineVersion: summary.scan.currentEngineVersion,
          currentEngineDigest: summary.scan.currentEngineDigest,
          countsByState: summary.scan.countsByState,
          staleCountsByState: summary.scan.staleCountsByState,
          countsByEngineDigest: summary.scan.countsByEngineDigest,
          staleCountsByEngineDigest: summary.scan.staleCountsByEngineDigest,
          upToDateCount: summary.scan.upToDateCount,
          legacySkippedProjects: summary.scan.legacySkippedProjects,
          legacyprojectIds: summary.scan.legacyprojectIds,
          frozenManifestVariantCount: summary.scan.frozenManifestVariantCount,
          exportInFlightVariantCount: summary.scan.exportInFlightVariantCount,
          frozenOrInFlightVariantCount: summary.scan.frozenOrInFlightVariantCount,
          frozenOrInFlightVariantIds: summary.scan.frozenOrInFlightVariantIds,
          totalBytesToStage: summary.scan.totalBytesToStage,
          sampleCandidateIds: summary.scan.sampleCandidateIds,
          after: summary.after,
          nextCursor: summary.nextCursor,
          candidateCount: summary.scan.candidates.length,
          candidates: summary.scan.candidates,
          committed: summary.committed,
          queuedWorker: summary.queuedWorker,
          fenced: summary.fenced,
          failed: summary.failed,
          skipped: summary.skipped,
          inFlight: summary.inFlight,
          maxInFlight: summary.maxInFlight,
          stoppedByMaxInFlight: summary.stoppedByMaxInFlight,
          outcomes: summary.outcomes
        },
        null,
        2
      )
    );
  } finally {
    if (startedQueues) {
      await boss.stop({ graceful: false }).catch(() => undefined);
    }
    await pool.end();
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
