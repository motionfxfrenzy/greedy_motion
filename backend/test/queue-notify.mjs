// Proves two things about the queue. (1) the wake-up path: with LISTEN/NOTIFY a worker on a notify queue is woken the moment a job is sent and otherwise polls only
// every 30 s, while a queue without notify polls every interval. Counts the real fetch statements pg-boss sends.
//   node --env-file-if-exists=.env test/queue-notify.mjs        (needs DATABASE_URL: a direct URL or the Supabase SESSION pooler, never the transaction pooler)
import assert from "node:assert/strict";
import pg from "pg";

const fetches = [], original = pg.Pool.prototype.query;
pg.Pool.prototype.query = function (text, values, callback) {
  const sql = (typeof text === "string" ? text : text?.text ?? "").replace(/\s+/g, " "), params = typeof text === "string" ? values : text?.values;
  if (/WITH next AS/.test(sql)) fetches.push(JSON.stringify(params ?? []) + sql);
  return original.call(this, text, values, callback);
};
const polls = (queue) => fetches.filter((entry) => entry.includes(queue)).length;
// (2) the housekeeping an idle pg-boss does on timers (see quietBoss in queues.ts): counted by kind over a window.
const kinds = { flow: /flow_on/, cron: /cron_on|pgboss\.schedule/, instance: /INSERT INTO pgboss\.instance/, queueList: /SELECT q\.name, q\.policy/, bam: /bam_on/ };
const housekeeping = new Map();
const original2 = pg.Pool.prototype.query;
pg.Pool.prototype.query = function (text, values, callback) {
  const sql = (typeof text === "string" ? text : text?.text ?? "").replace(/\s+/g, " ");
  for (const [kind, pattern] of Object.entries(kinds)) if (pattern.test(sql)) housekeeping.set(kind, (housekeeping.get(kind) ?? 0) + 1);
  return original2.call(this, text, values, callback);
};
const snapshot = () => Object.fromEntries(Object.keys(kinds).map((kind) => [kind, housekeeping.get(kind) ?? 0]));

const { boss, startQueues, QUEUES, quietBoss } = await import("../src/jobs/queues.ts");
const { PgBoss } = await import("pg-boss");
const warnings = [];
boss.on("warning", (w) => warnings.push(w.message));
await startQueues();

// every real queue is opted in
for (const name of Object.values(QUEUES)) assert.equal((await boss.getQueue(name))?.notify, true, `queue ${name} must have notify enabled`);

const stamp = Date.now(), withNotify = `t-notify-${stamp}`, without = `t-poll-${stamp}`;
await boss.createQueue(withNotify, { notify: true }); await boss.createQueue(without, { notify: false });
let wake;
const woke = new Promise((resolve) => { wake = resolve; });
await boss.work(withNotify, { pollingIntervalSeconds: 1 }, async () => { wake(Date.now()); });
await boss.work(without, { pollingIntervalSeconds: 1 }, async () => {});
housekeeping.clear();      // count only what pg-boss does by itself from here
await new Promise((resolve) => setTimeout(resolve, 8000));
const notifyPolls = polls(withNotify), plainPolls = polls(without), quiet = snapshot();
const sentAt = Date.now(); await boss.send(withNotify, { hello: "world" });
const wokeAt = await Promise.race([woke, new Promise((resolve) => setTimeout(() => resolve(null), 5000))]);
console.log(JSON.stringify({ notifyPollsIn8s: notifyPolls, plainPollsIn8s: plainPolls, wakeMs: wokeAt ? wokeAt - sentAt : null, warnings }));
// the same housekeeping with pg-boss defaults, on a second instance, for contrast
housekeeping.clear();
const defaults = new PgBoss({ connectionString: process.env.DATABASE_URL, max: 2, migrate: false });
defaults.on("error", () => {});
await defaults.start();
await new Promise((resolve) => setTimeout(resolve, 12000));
const withDefaults = snapshot();
await defaults.stop({ graceful: false, timeout: 2000 });
console.log(JSON.stringify({ housekeepingIn8s_quiet: quiet, housekeepingIn12s_defaults: withDefaults, quietBoss }));
await boss.deleteQueue(withNotify).catch(() => {}); await boss.deleteQueue(without).catch(() => {});
await boss.stop({ graceful: false, timeout: 2000 });
assert.deepEqual(warnings, [], "pg-boss could not establish LISTEN: it would silently poll every 2 s");
assert.ok(plainPolls >= 5, `the control queue should poll about every second (saw ${plainPolls})`);
assert.ok(notifyPolls <= 2, `a notify queue should poll only on its 30 s backstop (saw ${notifyPolls})`);
assert.deepEqual([quiet.flow, quiet.cron, quiet.instance, quiet.bam, quiet.queueList], [0, 0, 0, 0, 0], `an idle quiet pg-boss should do no flow, cron, instance, bam or queue-list work (saw ${JSON.stringify(quiet)})`);
assert.ok(withDefaults.flow >= 2 && withDefaults.instance >= 1, `control: a default pg-boss should show its flow poll and instance heartbeat, or this test measures nothing (saw ${JSON.stringify(withDefaults)})`);
assert.ok(wokeAt !== null && wokeAt - sentAt < 1500, `a job sent to a notify queue must wake its worker within 1.5 s (took ${wokeAt ? wokeAt - sentAt : "never"} ms)`);
console.log("queue-notify: ok");
process.exit(0);
