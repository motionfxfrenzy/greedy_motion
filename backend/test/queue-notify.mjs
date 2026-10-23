// Proves the queue wake-up path: with LISTEN/NOTIFY a worker on a notify queue is woken the moment a job is sent and otherwise polls only
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

const { boss, startQueues, QUEUES } = await import("../src/jobs/queues.ts");
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
await new Promise((resolve) => setTimeout(resolve, 8000));
const notifyPolls = polls(withNotify), plainPolls = polls(without);
const sentAt = Date.now(); await boss.send(withNotify, { hello: "world" });
const wokeAt = await Promise.race([woke, new Promise((resolve) => setTimeout(() => resolve(null), 5000))]);
console.log(JSON.stringify({ notifyPollsIn8s: notifyPolls, plainPollsIn8s: plainPolls, wakeMs: wokeAt ? wokeAt - sentAt : null, warnings }));
await boss.deleteQueue(withNotify).catch(() => {}); await boss.deleteQueue(without).catch(() => {});
await boss.stop({ graceful: false, timeout: 2000 });
assert.deepEqual(warnings, [], "pg-boss could not establish LISTEN: it would silently poll every 2 s");
assert.ok(plainPolls >= 5, `the control queue should poll about every second (saw ${plainPolls})`);
assert.ok(notifyPolls <= 2, `a notify queue should poll only on its 30 s backstop (saw ${notifyPolls})`);
assert.ok(wokeAt !== null && wokeAt - sentAt < 1500, `a job sent to a notify queue must wake its worker within 1.5 s (took ${wokeAt ? wokeAt - sentAt : "never"} ms)`);
console.log("queue-notify: ok");
process.exit(0);
