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
import { QUEUES, boss } from "./queues.ts";

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

async function ensure() {
  const [stats] = await boss.getQueueStats(QUEUES.video);
  const demand = (stats?.queuedCount ?? 0) + (stats?.activeCount ?? 0);
  if (demand === 0) return;
  const listed = await client!.send(new ListTasksCommand({ cluster: launch!.cluster, family, desiredStatus: "RUNNING" }));
  const running = listed.taskArns?.length ?? 0;
  const wanted = tasksToStart(demand, running, launch!.perTask, launch!.maxTasks);
  if (wanted === 0) return;
  const started = await runTasks(wanted);
  log("info", "worker_launched", { demand, running, wanted, started });
}

let inFlight: Promise<void> | null = null;
let again = false;

/** Makes sure enough workers exist for the render queue. Safe to call often; never throws. */
export function kickWorkers(): Promise<void> {
  if (!launch) return Promise.resolve();
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

/** Starts the periodic sweep; returns a stop function. A no-op unless WORKER_LAUNCH=ecs. */
export function startWorkerSweep(intervalMs = 30_000) {
  if (!launch) return () => undefined;
  log("info", "worker_launcher_on", { cluster: launch.cluster, family, perTask: launch.perTask, maxTasks: launch.maxTasks, spot: launch.spot });
  void kickWorkers();
  const timer = setInterval(() => void kickWorkers(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
