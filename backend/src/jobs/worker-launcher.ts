// Scale-to-zero render workers (WORKER_LAUNCH=ecs). Nothing runs on AWS while nobody renders: when a
// render-video job is queued the backend starts Fargate tasks for it, and each worker exits on its own
// after IDLE_EXIT_SECONDS without work (worker/src/worker.mjs). The queue in Postgres stays the only
// hand-off, so a task that starts late, twice, or is interrupted on Spot is harmless: pg-boss retries.
//
//   enqueue ─▶ kickWorkers() ─▶ demand = queued + active render-video jobs
//                               running = ECS tasks of the worker family (pending or running)
//                               start min(maxTasks, ceil(demand / perTask)) - running more
//
// A 30 s sweep repeats the check, which covers the one race this has: a worker deciding to exit at the
// moment a job arrives (the enqueue saw it running, the sweep sees it gone and starts another).
import { ECSClient, ListTasksCommand, RunTaskCommand, type RunTaskCommandInput } from "@aws-sdk/client-ecs";
import { config } from "../config.ts";
import { pool } from "../db/database.ts";
import { QUEUES, boss } from "./queues.ts";
import { createDemand } from "./demand.ts";
import { startSweep } from "./sweep.ts";

const launch = config.workerLaunch.mode === "ecs" ? config.workerLaunch : null;
const client = launch ? new ECSClient({ region: launch.region }) : null;
const family = launch?.taskDefinition.split("/").pop()!.split(":")[0];

const log = (level: string, event: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({ level, event, ...fields }));

/** Tasks still to start for this demand; exported for tests. */
export function tasksToStart(demand: number, running: number, perTask: number, maxTasks: number) {
  if (demand <= 0) return 0;
  return Math.max(0, Math.min(maxTasks, Math.ceil(demand / perTask)) - running);
}

async function runTasks(count: number) {
  const base: RunTaskCommandInput = {
    cluster: launch!.cluster,
    taskDefinition: launch!.taskDefinition,
    count,
    // Public subnet + public IP: no NAT gateway. The security group has no inbound rules.
    networkConfiguration: { awsvpcConfiguration: { subnets: launch!.subnets, securityGroups: launch!.securityGroups, assignPublicIp: "ENABLED" } },
    startedBy: "backend-launcher"
  };
  if (launch!.spot) {
    const spot = await client!.send(new RunTaskCommand({ ...base, capacityProviderStrategy: [{ capacityProvider: "FARGATE_SPOT", weight: 1 }] }));
    const started = spot.tasks?.length ?? 0;
    if (started >= count) return started;
    // No Spot capacity right now: fall back to on-demand rather than leave the job waiting.
    log("warn", "worker_spot_unavailable", { wanted: count, started, failures: spot.failures?.map((failure) => failure.reason) });
    const onDemand = await client!.send(new RunTaskCommand({ ...base, count: count - started, launchType: "FARGATE" }));
    return started + (onDemand.tasks?.length ?? 0);
  }
  const result = await client!.send(new RunTaskCommand({ ...base, launchType: "FARGATE" }));
  if (result.failures?.length) log("warn", "worker_launch_failures", { failures: result.failures.map((failure) => failure.reason) });
  return result.tasks?.length ?? 0;
}

/** Render jobs waiting or running at the last check; the sweep slows down while this is 0. */
let lastDemand = 0;
const recent = createDemand();

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
  const listed = await client!.send(new ListTasksCommand({ cluster: launch!.cluster, family, desiredStatus: "RUNNING" }));
  const running = listed.taskArns?.length ?? 0;
  const needed = Math.ceil(finals / launch!.perTask) + Math.ceil(plateWork / PLATE_SLOTS);
  const wanted = Math.max(0, Math.min(launch!.maxTasks, needed) - running);
  if (wanted === 0) return;
  const started = await runTasks(wanted);
  log("info", "worker_launched", { demand, running, wanted, started });
}

// Plate scenes and exports (plates/): PLATE_CONCURRENCY plate renders per task (worker.mjs), counted as their own kind of work.
const PLATE_SLOTS = Math.max(1, Number.parseInt(process.env.PLATE_CONCURRENCY ?? "1", 10) || 1);

/** Plate variants waiting for or in the worker, plus exports not finished: what needs worker capacity right now. */
async function plateDemand(): Promise<number> {
  if (!config.plates.enabled) return 0;
  // Work just queued but not yet authored still needs ONE worker soon: its cold start then overlaps the model call. The ping is a
  // single worker's worth however many scenes were queued (it must not look like that many render jobs).
  const pinged = Date.now() - platePingAt < 120_000 ? 1 : 0;
  try {
    const { rows } = await pool.query<{ n: string }>(
      "select (select count(*) from app.plate_variants where state in ('bundled', 'rendering')) + (select count(*) from app.plate_exports where state in ('queued', 'assembling')) as n"
    );
    return Math.max(Number(rows[0]?.n ?? 0), pinged);
  } catch { return pinged; }
}

let platePingAt = 0;
/** Plate work was queued: make sure a worker is on its way (counted as one worker, not one per scene). Never throws. */
export function kickPlateWorkers(): Promise<void> {
  platePingAt = Date.now();
  return kickWorkers(false);
}

let inFlight: Promise<void> | null = null;
let again = false;

/** Makes sure enough workers exist for the render queue. Safe to call often; never throws. Pass true right after queueing a job. */
export function kickWorkers(queuedJob = false): Promise<void> {
  if (!launch) return Promise.resolve();
  if (queuedJob) recent.kick();
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
  log("info", "worker_launcher_on", { cluster: launch.cluster, family, perTask: launch.perTask, maxTasks: launch.maxTasks, spot: launch.spot });
  return startSweep(async () => { await kickWorkers(); return lastDemand; }, busyMs, idleMs);
}
