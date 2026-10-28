// Render-events fault scenarios against two extra local replicas: B (:4001, LISTEN through the fault proxy) and
// C (:4002, direct). Both run AUTH_MODE=none, so the test jobs belong to the local user and need no token.
// Checks: push latency on both replicas, the queue position of a job behind, a listener whose notifications are dropped
// (silent pooler), a refused listener, recovery, killed LISTEN connections, and streams closing on ready.
//   node test/events-faults/proxy.mjs 55433 55432 55434
//   node test/events-faults/replica.mjs 4001 55433
//   node test/events-faults/replica.mjs 4002
//   node test/events-faults/scenarios.mjs        (from backend/; about 40 s; cleans up its own rows)
process.loadEnvFile((await import("node:url")).fileURLToPath(new URL("../../.env", import.meta.url)));
const { default: pg } = await import("pg");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const LOCAL = "00000000-0000-4000-8000-000000000000";
const J1 = "00000000-0000-4000-8000-0000000e0e11", J2 = "00000000-0000-4000-8000-0000000e0e12";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proxy = (mode) => fetch(`http://127.0.0.1:55434/${mode}`).then((r) => r.json());
const results = [];
let failed = false;

async function clean() { await db.query("delete from app.render_jobs where id = any($1)", [[J1, J2]]); }
await clean();
const insert = (id, offsetS) => db.query(
  `insert into app.render_jobs (id, owner_id, state, stage, progress, request, revision, render_queued_at) values ($1, $2, 'rendering', 'waiting', 45, '{}', '{"id":"t","title":"t","scenes":[]}', now() + make_interval(secs => $3))`,
  [id, LOCAL, offsetS]);
await insert(J1, 0);
await insert(J2, 1);

/** Opens a stream and records every job view with its arrival time. */
function stream(port, id) {
  const seen = [];
  const done = (async () => {
    const r = await fetch(`http://127.0.0.1:${port}/v1/renders/${id}/events`);
    const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return "closed";
      buf += value;
      let end;
      while ((end = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, end); buf = buf.slice(end + 2);
        if (block.startsWith("data:")) seen.push({ at: Date.now(), job: JSON.parse(block.slice(5)) });
      }
    }
  })();
  return { seen, done };
}

/** Writes a progress value, then waits for each stream to show it; returns per-stream latency in ms. */
async function step(label, progress, streams, timeoutMs = 8000) {
  const t0 = Date.now();
  await db.query("update app.render_jobs set stage = 'frames', progress = $2 where id = $1", [J1, progress]);
  const out = {};
  for (const [name, s] of Object.entries(streams)) {
    let hit;
    while (!(hit = s.seen.find((e) => e.at >= t0 && e.job.progress === progress)) && Date.now() - t0 < timeoutMs) await sleep(50);
    out[name] = hit ? hit.at - t0 : `none in ${timeoutMs} ms`;
  }
  results.push({ label, ...out });
  console.log(label.padEnd(58), JSON.stringify(out));
  return out;
}

try {
  await proxy("pass");
  const B = stream(4001, J1), C = stream(4002, J1);
  const Q = stream(4002, J2);
  await sleep(500);
  console.log("snapshots:", B.seen.length, C.seen.length, "J2 queuePosition:", Q.seen[0]?.job.queuePosition);

  await step("1 both replicas live", 52, { B, C });

  // Queue position: J1 left 'waiting' in step 1, so J2 (behind it) moved up without a write of its own.
  const moved = Q.seen.find((e) => e.job.queuePosition === 0);
  results.push({ label: "queue position pushed to the job behind", ok: Boolean(moved) });
  console.log("queue position pushed to the job behind:", moved ? `yes (${Q.seen.map((e) => e.job.queuePosition).join(" → ")})` : "NO");

  // A pooler that accepts LISTEN and delivers nothing: B's heartbeat goes missing within ping (3 s) + wait (5 s).
  console.log("proxy:", await proxy("silent"));
  await sleep(10_000);
  await step("2 B silent (notifications dropped) → 3 s fallback", 60, { B, C });
  await step("2b B silent, second write", 61, { B, C });

  // A pooler or database that refuses the LISTEN connection outright.
  console.log("proxy:", await proxy("refuse"));
  await sleep(1500);
  await step("3 B refused → 3 s fallback", 70, { B, C });

  // Back to normal: B reconnects (backoff) and pushes resume.
  console.log("proxy:", await proxy("pass"));
  const t0 = Date.now();
  let back = null;
  for (let p = 71; p < 89 && !back; p++) {
    const out = await step(`4 B recovering (t+${Math.round((Date.now() - t0) / 1000)} s)`, p, { B, C }, 4000);
    if (typeof out.B === "number" && out.B < 1000) back = Math.round((Date.now() - t0) / 1000);
    else await sleep(2000);
  }
  console.log("B pushes again after", back, "s");

  // A dropped connection (database restart, network blip): kill every LISTEN connection on the server.
  const killed = await db.query("select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'render-events'");
  console.log("terminated LISTEN connections:", killed.rowCount);
  await step("5 right after LISTEN connections were killed", 90, { B, C });
  await sleep(4000);
  await step("5b a few seconds later", 91, { B, C });

  // Finishing closes every stream on every replica.
  await db.query("update app.render_jobs set state = 'ready', stage = 'done', progress = 100 where id = $1", [J1]);
  const closed = await Promise.race([Promise.all([B.done, C.done]), sleep(8000).then(() => "timeout")]);
  console.log("ready closes both streams:", closed);
  if (closed === "timeout") throw new Error("streams did not close when the job finished");
} catch (error) {
  failed = true;
  console.error("FAILED:", error);
} finally {
  await proxy("pass").catch(() => undefined);
  await clean();
  await db.end();
  process.exit(failed ? 1 : 0);
}
