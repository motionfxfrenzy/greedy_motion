// Scale-to-zero launcher (jobs/worker-launcher.ts): how many Fargate tasks a queue needs, the Spot fallback,
// and that an empty queue never calls AWS. No AWS, no database: ECS and the queue stats are stubbed.
import assert from "node:assert/strict";

process.env.PLANNER ??= "deterministic";
process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/unused";
Object.assign(process.env, {
  WORKER_LAUNCH: "ecs", ECS_REGION: "ap-southeast-1", ECS_CLUSTER: "greedymotion-staging",
  ECS_WORKER_TASK_DEFINITION: "greedymotion-staging-worker", ECS_SUBNETS: "subnet-a, subnet-b", ECS_SECURITY_GROUPS: "sg-1",
  ECS_WORKER_CONCURRENCY: "2", ECS_WORKER_MAX_TASKS: "3", AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test"
});

const { ECSClient } = await import("@aws-sdk/client-ecs");
const calls = [];
let running = 0;
let spotCapacity = Infinity;
ECSClient.prototype.send = async function (command) {
  const name = command.constructor.name;
  calls.push({ name, input: command.input });
  if (name === "ListTasksCommand") return { taskArns: Array.from({ length: running }, (_, i) => `arn:task/${i}`) };
  if (name === "RunTaskCommand") {
    const spot = Boolean(command.input.capacityProviderStrategy);
    const started = spot ? Math.min(command.input.count, spotCapacity) : command.input.count;
    return { tasks: Array.from({ length: started }, (_, i) => ({ taskArn: `arn:new/${i}` })), failures: started < command.input.count ? [{ reason: "Capacity is unavailable" }] : [] };
  }
  throw new Error(`unexpected ${name}`);
};

const { boss } = await import("../src/jobs/queues.ts");
const { kickWorkers, tasksToStart } = await import("../src/jobs/worker-launcher.ts");
let stats = { queuedCount: 0, activeCount: 0 };
boss.getQueueStats = async () => [stats];
const runs = () => calls.filter((call) => call.name === "RunTaskCommand");

// Arithmetic: two renders per task, capped at three tasks, minus what is already up.
assert.equal(tasksToStart(0, 0, 2, 3), 0);
assert.equal(tasksToStart(1, 0, 2, 3), 1);
assert.equal(tasksToStart(3, 0, 2, 3), 2);
assert.equal(tasksToStart(3, 1, 2, 3), 1);
assert.equal(tasksToStart(50, 0, 2, 3), 3);
assert.equal(tasksToStart(2, 5, 2, 3), 0);

// Empty queue: no AWS call at all (this is the path the 30 s sweep takes almost always).
await kickWorkers();
assert.equal(calls.length, 0, "an empty queue must not call ECS");

// One render queued, nothing running: one Spot task in the public subnets.
stats = { queuedCount: 1, activeCount: 0 };
await kickWorkers();
assert.equal(runs().length, 1);
const input = runs()[0].input;
assert.equal(input.count, 1);
assert.deepEqual(input.capacityProviderStrategy, [{ capacityProvider: "FARGATE_SPOT", weight: 1 }]);
assert.deepEqual(input.networkConfiguration.awsvpcConfiguration, { subnets: ["subnet-a", "subnet-b"], securityGroups: ["sg-1"], assignPublicIp: "ENABLED" });
assert.equal(calls.find((call) => call.name === "ListTasksCommand").input.family, "greedymotion-staging-worker");

// A worker is already up for that render: nothing more starts.
calls.length = 0; running = 1;
await kickWorkers();
assert.equal(runs().length, 0);

// No Spot capacity: the shortfall starts on-demand instead of waiting.
calls.length = 0; running = 0; spotCapacity = 0; stats = { queuedCount: 4, activeCount: 1 };
await kickWorkers();
assert.equal(runs().length, 2);
assert.equal(runs()[1].input.launchType, "FARGATE");
assert.equal(runs()[1].input.count, 3);

// AWS errors are logged, never thrown into the request that queued the render.
ECSClient.prototype.send = async () => { throw new Error("AccessDenied"); };
await kickWorkers();

console.log("worker launcher: ok");
