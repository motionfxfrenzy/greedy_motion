/**
 * CLI for re-bundling existing plate variants onto the current plate engine (`packages/plate-engine`)
 * without any LLM / model calls, or rolling back `engine-rebundle` revisions.
 *
 * Safety guard (mandatory):
 *   Refuses to run unless `APP_ENV=local` and `DATABASE_URL` points to `localhost` or `127.0.0.1`
 *   (and if `R2_ENDPOINT` is set, its host is also `localhost` or `127.0.0.1`).
 *
 * Usage:
 *   Dry-run (default, writes nothing):
 *     APP_ENV=local DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle PLANNER=deterministic \
 *       node --experimental-strip-types src/scripts/rebundle-plates.ts
 *
 *   Apply re-bundle (with optional --limit N and --project <uuid>):
 *     APP_ENV=local DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle PLANNER=deterministic \
 *       node --experimental-strip-types src/scripts/rebundle-plates.ts --apply [--limit N] [--project <uuid>] [--mode in-process|worker]
 *
 *   Rollback a variant or all engine-rebundle revisions:
 *     APP_ENV=local DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_rebundle PLANNER=deterministic \
 *       node --experimental-strip-types src/scripts/rebundle-plates.ts --rollback <variantId|all-engine-rebundle> [--project <uuid>]
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

export type CliArgs = {
  apply: boolean;
  limit?: number;
  projectId?: string;
  rollback?: string;
  mode: "in-process" | "worker";
  skipBrowserVerify: boolean;
};

export function parseCliArgs(argv: string[]): CliArgs {
  let apply = false;
  let limit: number | undefined;
  let projectId: string | undefined;
  let rollback: string | undefined;
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
    } else if (arg === "--project") {
      projectId = argv[++i];
      if (!projectId) throw new Error("--project requires a project UUID.");
    } else if (arg.startsWith("--project=")) {
      projectId = arg.slice("--project=".length);
    } else if (arg === "--rollback") {
      rollback = argv[++i];
      if (!rollback) throw new Error("--rollback requires a variantId or 'all-engine-rebundle'.");
    } else if (arg.startsWith("--rollback=")) {
      rollback = arg.slice("--rollback=".length);
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

  return { apply, limit, projectId, rollback, mode, skipBrowserVerify };
}

async function main() {
  enforceLocalSafetyGuard(process.env);
  const args = parseCliArgs(process.argv.slice(2));

  const { migrate, pool } = await import("../db/database.ts");
  const { boss, startQueues } = await import("../jobs/queues.ts");
  const { rebundleStaleVariants, rollbackRebundleTarget } = await import("../plates/rebundle.ts");

  await migrate();
  if (args.mode === "worker") {
    await startQueues();
  }

  try {
    if (args.rollback) {
      const res = await rollbackRebundleTarget(args.rollback, {
        ...(args.projectId ? { projectId: args.projectId } : {})
      });
      console.log(JSON.stringify({ action: "rollback", target: args.rollback, ...res }, null, 2));
      return;
    }

    const summary = await rebundleStaleVariants({
      dryRun: !args.apply,
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
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
          currentEngineVersion: summary.scan.currentEngineVersion,
          currentEngineDigest: summary.scan.currentEngineDigest,
          countsByState: summary.scan.countsByState,
          staleCountsByState: summary.scan.staleCountsByState,
          upToDateCount: summary.scan.upToDateCount,
          legacySkippedProjects: summary.scan.legacySkippedProjects,
          legacyprojectIds: summary.scan.legacyprojectIds,
          candidateCount: summary.scan.candidates.length,
          candidates: summary.scan.candidates,
          committed: summary.committed,
          queuedWorker: summary.queuedWorker,
          fenced: summary.fenced,
          failed: summary.failed,
          skipped: summary.skipped,
          outcomes: summary.outcomes
        },
        null,
        2
      )
    );
  } finally {
    if (args.mode === "worker") {
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
