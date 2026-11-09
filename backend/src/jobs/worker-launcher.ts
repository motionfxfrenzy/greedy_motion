// Scale-to-zero render workers (WORKER_LAUNCH=ecs). Nothing runs on AWS while nobody renders: when a
// render-video or ready plate job is queued the backend starts Fargate tasks for it, and each worker exits
// on its own after IDLE_EXIT_SECONDS without work (worker/src/worker.mjs). The queue in Postgres stays the only
// hand-off, so a task that starts late, twice, or is interrupted on Spot is harmless: pg-boss retries.
//
//   enqueue ─▶ kickWorkers() ─▶ demand = ready final renders + ready plate worker jobs
//                               active = ECS tasks of the worker family (pending or running, paginated + pending memory)
//                               target = ceil(finals / perTask) + ceil(plateWork / platePerTask)
//                               start min(maxTasks, target) - active more (in RunTask batches <= 10)
//
// A 30 s sweep repeats the check, which covers the one race this has: a worker deciding to exit at the
// moment a job arrives (the enqueue saw it running, the sweep sees it gone and starts another).
import { ECSClient, ListTasksCommand, RunTaskCommand, type RunTaskCommandInput, type RunTaskCommandOutput } from "@aws-sdk/client-ecs";
import { config } from "../config.ts";
import { pool } from "../db/database.ts";
import { QUEUES, boss, quietBoss } from "./queues.ts";
import { createDemand } from "./demand.ts";
import { startSweep } from "./sweep.ts";

const launch = config.workerLaunch.mode === "ecs" ? config.workerLaunch : null;
const client = launch ? new ECSClient({ region: launch.region }) : null;
const family = launch?.taskDefinition.split("/").pop()!.split(":")[0];

/** AWS ECS RunTask hard API limit per call (`RunTaskRequest.count`: max 10 tasks per call). */
export const RUN_TASK_BATCH_LIMIT = 10;
/** AWS ECS ListTasks page size (max 100 task ARNs per page). */
export const LIST_TASKS_PAGE_SIZE = 100;
/** How long recently-launched task ARNs are remembered so overlapping reconciliations before ListTasks eventual consistency never double-launch. */
export const PENDING_TASK_MEMORY_MS = 45_000;
/** Cooldown after a total capacity/quota exhaustion before retrying a zero-progress launch when no new job arrived. */
export const CAPACITY_COOLDOWN_MS = 15_000;

const log = (level: string, event: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({ level, event, ...fields }));

export type LaunchPlan = {
  finals: number;
  plateWork: number;
  demand: number;
  perTask: number;
  platePerTask: number;
  maxTasks: number;
  running: number;
  /** Uncapped tasks needed so every ready job gets its own worker slot (`ceil(finals/perTask) + ceil(plateWork/platePerTask)`). */
  rawTargetTasks: number;
  /** Degraded minimum target (`ceil(rawTargetTasks / 2)`) when full AWS capacity is unavailable. */
  minDegradedTasks: number;
  /** Target tasks after applying the operator's configurable `maxTasks` ceiling. */
  cappedTargetTasks: number;
  /** Additional tasks to start now (`max(0, cappedTargetTasks - running)`). */
  wanted: number;
  /** True when the operator's configured `maxTasks` ceiling is lower than `rawTargetTasks`. */
  ceilingLimited: boolean;
  /** True when `maxTasks` prevents even reaching the half-target `minDegradedTasks`. */
  ceilingBelowHalf: boolean;
};

/**
 * Pure scaling formula for ready demand across final renders and plate scene/export/rebundle jobs.
 * Given N ready jobs (with 1 slot/task on Fargate), aims for N simultaneous tasks when capacity permits,
 * and surfaces `minDegradedTasks = ceil(N / 2)` for partial-capacity evaluation.
 */
export function computeLaunchPlan(input: {
  finals: number;
  plateWork: number;
  running: number;
  perTask: number;
  platePerTask?: number;
  maxTasks: number;
}): LaunchPlan {
  const finals = Math.max(0, Math.floor(input.finals || 0));
  const plateWork = Math.max(0, Math.floor(input.plateWork || 0));
  const demand = finals + plateWork;
  const running = Math.max(0, Math.floor(input.running || 0));
  const perTask = Math.max(1, Math.floor(input.perTask || 1));
  const platePerTask = Math.max(1, Math.floor(input.platePerTask ?? perTask));
  const maxTasks = Math.max(1, Math.floor(input.maxTasks || 1));

  if (demand <= 0) {
    return {
      finals,
      plateWork,
      demand: 0,
      perTask,
      platePerTask,
      maxTasks,
      running,
      rawTargetTasks: 0,
      minDegradedTasks: 0,
      cappedTargetTasks: 0,
      wanted: 0,
      ceilingLimited: false,
      ceilingBelowHalf: false
    };
  }

  const finalTasks = finals > 0 ? Math.ceil(finals / perTask) : 0;
  const plateTasks = plateWork > 0 ? Math.ceil(plateWork / platePerTask) : 0;
  const rawTargetTasks = finalTasks + plateTasks;
  const minDegradedTasks = Math.ceil(rawTargetTasks / 2);
  const cappedTargetTasks = Math.min(maxTasks, rawTargetTasks);
  const wanted = Math.max(0, cappedTargetTasks - running);

  return {
    finals,
    plateWork,
    demand,
    perTask,
    platePerTask,
    maxTasks,
    running,
    rawTargetTasks,
    minDegradedTasks,
    cappedTargetTasks,
    wanted,
    ceilingLimited: rawTargetTasks > maxTasks,
    ceilingBelowHalf: minDegradedTasks > maxTasks
  };
}

/** Tasks still to start for this demand; exported for tests. */
export function tasksToStart(demand: number, running: number, perTask: number, maxTasks: number) {
  if (demand <= 0) return 0;
  return Math.max(0, Math.min(maxTasks, Math.ceil(demand / Math.max(1, perTask))) - Math.max(0, running));
}

/** Splits a desired task count into bounded AWS `RunTask` batch sizes (`<= 10` per call). */
export function batchTaskCounts(wanted: number, batchLimit = RUN_TASK_BATCH_LIMIT): number[] {
  const cleanWanted = Math.max(0, Math.floor(wanted || 0));
  const cap = Math.max(1, Math.min(RUN_TASK_BATCH_LIMIT, Math.floor(batchLimit || RUN_TASK_BATCH_LIMIT)));
  const batches: number[] = [];
  let rem = cleanWanted;
  while (rem > 0) {
    const n = Math.min(rem, cap);
    batches.push(n);
    rem -= n;
  }
  return batches;
}

const TRANSIENT_ECS_ERROR_RE = /\b(Throttling|ThrottlingException|TooManyRequestsException|RequestLimitExceeded|RateExceeded|ServiceUnavailable|InternalFailure|ServerException|RequestTimeout|ECONNRESET|ETIMEDOUT)\b/i;
const CAPACITY_OR_QUOTA_ERROR_RE = /\b(Capacity|RESOURCE|vCPU|quota|LimitExceeded|InsufficientCapacity|CpuLimitExceeded|MemoryLimitExceeded|TasksLimitExceeded)\b/i;

export function isTransientEcsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: string; code?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const status = e.$metadata?.httpStatusCode;
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  const text = `${e.name ?? ""} ${e.code ?? ""} ${e.message ?? ""}`;
  return TRANSIENT_ECS_ERROR_RE.test(text);
}

export function isCapacityOrQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: string; code?: string; message?: string };
  const text = `${e.name ?? ""} ${e.code ?? ""} ${e.message ?? ""}`;
  return CAPACITY_OR_QUOTA_ERROR_RE.test(text);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
let sleepImpl: (ms: number) => Promise<void> = defaultSleep;
let nowImpl: () => number = Date.now;

/** Test hook for overriding clock and sleep in unit tests without waiting on real timers. */
export function setLauncherTestHooks(hooks: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {}) {
  sleepImpl = hooks.sleep ?? defaultSleep;
  nowImpl = hooks.now ?? Date.now;
}

/** Recently started task ARNs (`arn -> launchedAtMs`) so overlapping checks before ListTasks eventual consistency do not launch duplicate fleets. */
const recentlyStartedTasks = new Map<string, number>();
let lastCapacityExhaustedAt = 0;

export function clearLauncherStateForTests() {
  recentlyStartedTasks.clear();
  lastCapacityExhaustedAt = 0;
  platePingAt = 0;
  lastDemand = 0;
}

function pruneRecentTasks(now: number, listedArns?: ReadonlySet<string>) {
  for (const [arn, at] of recentlyStartedTasks.entries()) {
    if (now - at >= PENDING_TASK_MEMORY_MS || listedArns?.has(arn)) {
      recentlyStartedTasks.delete(arn);
    }
  }
}

function recordStartedTasks(tasks: { taskArn?: string }[] | undefined, now: number) {
  let syntheticIdx = 0;
  for (const t of tasks ?? []) {
    const arn = t?.taskArn || `arn:pending:${now}:${syntheticIdx++}`;
    recentlyStartedTasks.set(arn, now);
  }
}

/**
 * Lists all active worker tasks in the cluster for `family`, paginating through `nextToken`
 * and unioning with any recently started tasks from the last `PENDING_TASK_MEMORY_MS` that have
 * not yet appeared in `ListTasks` (preventing duplicate fleet launches across rapid reconciliations).
 */
export async function listActiveTasks(): Promise<{ count: number; listedCount: number; pendingMemoryCount: number; arns: string[] }> {
  const arns = new Set<string>();
  let nextToken: string | undefined;
  let pages = 0;
  do {
    const listed = await sendWithTransientRetry(() =>
      client!.send(
        new ListTasksCommand({
          cluster: launch!.cluster,
          family,
          desiredStatus: "RUNNING",
          ...(nextToken ? { nextToken } : {})
        })
      )
    );
    for (const arn of listed.taskArns ?? []) {
      if (arn) arns.add(arn);
    }
    nextToken = listed.nextToken;
    pages += 1;
  } while (nextToken && pages < 50);

  const listedCount = arns.size;
  const now = nowImpl();
  pruneRecentTasks(now, arns);
  let pendingMemoryCount = 0;
  for (const arn of recentlyStartedTasks.keys()) {
    if (!arns.has(arn)) {
      arns.add(arn);
      pendingMemoryCount += 1;
    }
  }
  return { count: arns.size, listedCount, pendingMemoryCount, arns: [...arns] };
}

async function sendWithTransientRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxRetries || !isTransientEcsError(error)) throw error;
      const delayMs = Math.min(2000, 150 * 2 ** attempt);
      log("warn", "worker_ecs_transient_retry", {
        attempt: attempt + 1,
        delayMs,
        message: error instanceof Error ? error.message : String(error)
      });
      await sleepImpl(delayMs);
    }
  }
}

/**
 * Runs a single bounded batch (`1 <= count <= 10`) with a specific launch strategy (`spot` or `onDemand`).
 * If the batch fails or returns 0 tasks due to capacity/vCPU quota and `count > 1`, steps down to smaller
 * achievable sub-batches (`ceil(count / 2)`, then `1`) so a failed large batch never prevents smaller
 * achievable capacity from starting.
 */
async function runStrategyBatch(
  base: Omit<RunTaskCommandInput, "count">,
  count: number,
  strategy: "spot" | "onDemand",
  reasons: Set<string>
): Promise<number> {
  let remaining = Math.max(0, Math.min(RUN_TASK_BATCH_LIMIT, Math.floor(count)));
  let totalStarted = 0;
  let tryCount = remaining;

  while (remaining > 0 && tryCount > 0) {
    const reqCount = Math.min(remaining, tryCount);
    const cmdInput: RunTaskCommandInput =
      strategy === "spot"
        ? { ...base, count: reqCount, capacityProviderStrategy: [{ capacityProvider: "FARGATE_SPOT", weight: 1 }] }
        : { ...base, count: reqCount, launchType: "FARGATE" };

    let res: RunTaskCommandOutput | null = null;
    let threwCapacity = false;
    try {
      res = await sendWithTransientRetry(() => client!.send(new RunTaskCommand(cmdInput)));
    } catch (error) {
      if (isCapacityOrQuotaError(error)) {
        threwCapacity = true;
        const msg = error instanceof Error ? error.message : String(error);
        reasons.add(msg);
        log("warn", strategy === "spot" ? "worker_spot_exception" : "worker_ondemand_capacity_exception", {
          requested: reqCount,
          message: msg
        });
      } else {
        throw error;
      }
    }

    if (res) {
      const startedTasks = res.tasks ?? [];
      const started = startedTasks.length;
      recordStartedTasks(startedTasks, nowImpl());
      for (const f of res.failures ?? []) {
        if (f?.reason) reasons.add(f.reason);
      }
      if (started > 0) {
        totalStarted += started;
        remaining -= started;
        // If AWS returned a partial batch alongside failures (e.g. asked for 6, got 4, 2 failed for quota/capacity),
        // that provider gave us all the capacity it currently has for this batch.
        if (started < reqCount) {
          if (strategy === "spot") {
            log("warn", "worker_spot_unavailable", {
              wanted: reqCount,
              started,
              failures: (res.failures ?? []).map((f) => f.reason)
            });
          } else if (res.failures?.length) {
            log("warn", "worker_launch_failures", {
              wanted: reqCount,
              started,
              failures: res.failures.map((f) => f.reason)
            });
          }
          break;
        }
        tryCount = remaining;
        continue;
      }

      // 0 tasks started in this call
      if (strategy === "spot") {
        log("warn", "worker_spot_unavailable", {
          wanted: reqCount,
          started: 0,
          failures: (res.failures ?? []).map((f) => f.reason)
        });
        // For Spot returning 0, break immediately so runTasks falls back to On-Demand for the remaining count
        break;
      }
      if (res.failures?.length) {
        log("warn", "worker_launch_failures", {
          wanted: reqCount,
          started: 0,
          failures: res.failures.map((f) => f.reason)
        });
      }
    } else if (threwCapacity && strategy === "spot") {
      // Spot threw a capacity/quota exception: fall back to On-Demand immediately
      break;
    }

    // Step down batch size if `reqCount > 1` (e.g., 8 -> 4 -> 2 -> 1) to salvage partial capacity when a larger request was rejected
    if (reqCount > 1) {
      tryCount = Math.floor(reqCount / 2);
    } else {
      break;
    }
  }

  return totalStarted;
}

async function runTasks(count: number): Promise<{ started: number; reasons: string[] }> {
  const base: Omit<RunTaskCommandInput, "count"> = {
    cluster: launch!.cluster,
    taskDefinition: launch!.taskDefinition,
    // Public subnet + public IP: no NAT gateway. The security group has no inbound rules.
    networkConfiguration: { awsvpcConfiguration: { subnets: launch!.subnets, securityGroups: launch!.securityGroups, assignPublicIp: "ENABLED" } },
    startedBy: "backend-launcher"
  };

  const batches = batchTaskCounts(count, RUN_TASK_BATCH_LIMIT);
  let totalStarted = 0;
  const reasons = new Set<string>();

  for (const batchSize of batches) {
    let batchStarted = 0;
    if (launch!.spot) {
      batchStarted = await runStrategyBatch(base, batchSize, "spot", reasons);
    }
    const shortfall = batchSize - batchStarted;
    if (shortfall > 0) {
      const onDemandStarted = await runStrategyBatch(base, shortfall, "onDemand", reasons);
      batchStarted += onDemandStarted;
    }
    totalStarted += batchStarted;
    // If this batch could not start all requested tasks even after Spot + On-Demand + step-down,
    // further batches in the same sweep will also hit the capacity/quota wall; stop issuing redundant calls.
    if (batchStarted < batchSize) {
      break;
    }
  }

  return { started: totalStarted, reasons: [...reasons] };
}

/** Render jobs waiting or running at the last check; the sweep slows down while this is 0. */
let lastDemand = 0;
const recent = createDemand();

// Plate scenes and exports (plates/): ECS_PLATE_CONCURRENCY plate renders per task on Fargate (default 1),
// independent of local PLATE_CONCURRENCY so local Docker settings never under-provision AWS worker tasks.
function plateSlotsPerTask(): number {
  if (launch && "platePerTask" in launch && typeof launch.platePerTask === "number") {
    return Math.max(1, launch.platePerTask);
  }
  return Math.max(1, Number.parseInt(process.env.ECS_PLATE_CONCURRENCY ?? "1", 10) || 1);
}

const PGBOSS_SCHEMA = (quietBoss as { schema?: string }).schema ?? "pgboss";

async function ensure() {
  // force: recount instead of reading the cache (which can be an hour old); kicks cover the last minute that a recount may reuse.
  const [stats] = await boss.getQueueStats(QUEUES.video, { force: true });
  const finals = recent.count((stats?.queuedCount ?? 0) + (stats?.activeCount ?? 0));
  // Plate work is counted from the tables, not the queue statistics: those can be minutes old, and a plate message that was
  // lost is still work (the reconciler re-sends it; this makes sure a worker exists for it).
  const plateWork = await plateDemand();
  const demand = finals + plateWork;
  lastDemand = demand;
  if (demand === 0) return;

  const active = await listActiveTasks();
  const running = active.count;
  const plan = computeLaunchPlan({
    finals,
    plateWork,
    running,
    perTask: launch!.perTask,
    platePerTask: plateSlotsPerTask(),
    maxTasks: launch!.maxTasks
  });

  if (plan.ceilingLimited) {
    log("warn", "worker_ceiling_limited", {
      demand: plan.demand,
      finals: plan.finals,
      plateWork: plan.plateWork,
      rawTargetTasks: plan.rawTargetTasks,
      minDegradedTasks: plan.minDegradedTasks,
      maxTasks: plan.maxTasks,
      running,
      ceilingBelowHalf: plan.ceilingBelowHalf
    });
  }

  if (plan.wanted === 0) return;

  const now = nowImpl();
  if (lastCapacityExhaustedAt > 0 && now - lastCapacityExhaustedAt < CAPACITY_COOLDOWN_MS) {
    log("info", "worker_launch_cooldown", {
      demand: plan.demand,
      running,
      wanted: plan.wanted,
      cooldownRemainingMs: CAPACITY_COOLDOWN_MS - (now - lastCapacityExhaustedAt)
    });
    return;
  }

  const { started, reasons } = await runTasks(plan.wanted);
  const totalActive = running + started;
  if (started === 0 && plan.wanted > 0) {
    lastCapacityExhaustedAt = nowImpl();
  } else if (started > 0) {
    lastCapacityExhaustedAt = 0;
  }

  if (totalActive < plan.rawTargetTasks) {
    const metHalfTarget = totalActive >= plan.minDegradedTasks;
    log("warn", "worker_capacity_degraded", {
      demand: plan.demand,
      finals: plan.finals,
      plateWork: plan.plateWork,
      rawTargetTasks: plan.rawTargetTasks,
      minDegradedTasks: plan.minDegradedTasks,
      cappedTargetTasks: plan.cappedTargetTasks,
      running,
      wanted: plan.wanted,
      started,
      totalActive,
      metHalfTarget,
      ceilingLimited: plan.ceilingLimited,
      reasons
    });
  }

  log("info", "worker_launched", {
    demand: plan.demand,
    finals: plan.finals,
    plateWork: plan.plateWork,
    running,
    wanted: plan.wanted,
    started,
    totalActive,
    rawTargetTasks: plan.rawTargetTasks,
    minDegradedTasks: plan.minDegradedTasks
  });
}

/**
 * Plate variants waiting for or in the worker, exports not finished, plus runnable re-bundle jobs: what needs worker capacity right now.
 * Browser-first rule: in `live` mode, variants in `state = 'bundled'` with `stage = 'checking'` are checked and played in the user's
 * browser first and do NOT count as AWS worker demand unless they fell back to clip rendering (`stage in ('queued for rendering', 'retrying')`).
 */
async function plateDemand(): Promise<number> {
  if (!config.plates.enabled) return 0;
  // Work just queued for the worker (or clip-mode authoring cold-start prewarm) counts as at least 1 worker for 120 s.
  const pinged = nowImpl() - platePingAt < 120_000 ? 1 : 0;
  try {
    const { rows } = await pool.query<{ n: string }>(
      `select (
         select count(*)
           from app.plate_variants v
           left join app.plate_state s on s.project_id = v.project_id
          where v.state = 'rendering'
             or (
               v.state in ('bundled', 'checked')
               and v.clip_key is null
               and (
                 coalesce(s.live_mode, 'clip') <> 'live'
                 or v.stage in ('queued for rendering', 'retrying')
               )
             )
       ) + (
         select count(*) from app.plate_exports where state in ('queued', 'assembling')
       ) + (
         select count(*) from ${PGBOSS_SCHEMA}.job where name = $1 and ((state in ('created', 'retry') and start_after <= now()) or state = 'active')
       ) as n`,
      [QUEUES.plateRebundle]
    );
    return Math.max(Number(rows[0]?.n ?? 0), pinged);
  } catch {
    return pinged;
  }
}

let platePingAt = 0;
/**
 * Plate work was queued: make sure enough workers are on their way.
 * Pass `prewarm = false` when only checking current table demand without forcing a 1-worker prewarm ping
 * (e.g. when authoring starts in browser-first `live` mode with 0 scenes queued for worker rendering).
 * Never throws.
 */
export function kickPlateWorkers(prewarm = true): Promise<void> {
  if (prewarm) {
    platePingAt = nowImpl();
    lastCapacityExhaustedAt = 0;
  }
  return kickWorkers(false);
}

let inFlight: Promise<void> | null = null;
let again = false;

/** Makes sure enough workers exist for the render queue. Safe to call often; never throws. Pass true right after queueing a job. */
export function kickWorkers(queuedJob = false): Promise<void> {
  if (!launch) return Promise.resolve();
  if (queuedJob) {
    recent.kick();
    lastCapacityExhaustedAt = 0;
  }
  if (inFlight) {
    again = true;
    return inFlight;
  }
  inFlight = (async () => {
    do {
      again = false;
      await ensure().catch((error) => log("error", "worker_launch_failed", { message: error instanceof Error ? error.message : String(error) }));
    } while (again);
  })().finally(() => { inFlight = null; });
  return inFlight;
}

/**
 * Starts the periodic sweep; returns a stop function. A no-op unless WORKER_LAUNCH=ecs.
 * The sweep only repairs the race above, which needs a job in the queue: while the queue is empty it
 * checks every idleMs (a new job starts workers immediately through kickWorkers, not through the sweep),
 * so an idle backend does not query the database every 30 s all day.
 */
export function startWorkerSweep(busyMs = 30_000, idleMs = 300_000) {
  if (!launch) return () => undefined;
  log("info", "worker_launcher_on", {
    cluster: launch.cluster,
    family,
    perTask: launch.perTask,
    platePerTask: plateSlotsPerTask(),
    maxTasks: launch.maxTasks,
    spot: launch.spot
  });
  return startSweep(async () => { await kickWorkers(); return lastDemand; }, busyMs, idleMs);
}
