// Process safety net tests (spawns child Node processes importing worker/src/safety.mjs & worker/src/control.mjs):
//   1. uncaughtException exits with code 1 within FATAL_DRAIN_SECONDS+2 and logs `worker_fatal` to stderr via fs.writeSync(2, ...)
//   2. unhandledRejection exits with code 1 within FATAL_DRAIN_SECONDS+2 and logs `worker_fatal`
//   3. EPIPE on stdout (parent closes read end of pipe while child writes via console.log) does NOT kill the worker
//   4. SIGTERM with a stuck in-flight job calls `fail(queue, id, attempt, "worker shutting down")` once and exits 0 at the deadline (DRAIN_SECONDS=1)
// Run: node test/process-safety.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { run } from "../src/compose.mjs";

const safetyUrl = new URL("../src/safety.mjs", import.meta.url).href;
const controlUrl = new URL("../src/control.mjs", import.meta.url).href;

function runChildHarness(code, { env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", reject);
    child.on("close", (exitCode, signal) => {
      resolve({ exitCode, signal, stdout, stderr, elapsedMs: Date.now() - startedAt });
    });
  });
}

test("1. uncaughtException logs structured worker_fatal line via fs.writeSync(2, ...) and exits with code 1 within FATAL_DRAIN_SECONDS+2", async () => {
  const fatalDrainSeconds = 1;
  const script = `
    import { installProcessSafety } from ${JSON.stringify(safetyUrl)};
    const inFlight = new Set([{ queue: "render-video", id: "job-1", attempt: 1 }]);
    installProcessSafety({
      inFlight,
      fatalDrainSeconds: ${fatalDrainSeconds}
    });
    setTimeout(() => {
      throw new Error("boom_uncaught_exception");
    }, 20);
    setInterval(() => {}, 1000);
  `;
  const res = await runChildHarness(script, { env: { FATAL_DRAIN_SECONDS: String(fatalDrainSeconds) } });
  assert.equal(res.exitCode, 1, "must exit with code 1 on uncaughtException");
  assert.ok(res.elapsedMs < (fatalDrainSeconds + 2) * 1000, `exited in ${res.elapsedMs}ms, expected < ${(fatalDrainSeconds + 2) * 1000}ms`);
  assert.match(res.stderr, /"event":"worker_fatal"/);
  assert.match(res.stderr, /"kind":"uncaughtException"/);
  assert.match(res.stderr, /boom_uncaught_exception/);
});

test("2. unhandledRejection logs structured worker_fatal line and exits with code 1 within FATAL_DRAIN_SECONDS+2", async () => {
  const fatalDrainSeconds = 1;
  const script = `
    import { installProcessSafety } from ${JSON.stringify(safetyUrl)};
    const inFlight = new Set([{ queue: "plate-render", id: "job-2", attempt: 1 }]);
    installProcessSafety({
      inFlight,
      fatalDrainSeconds: ${fatalDrainSeconds}
    });
    setTimeout(() => {
      Promise.reject(new Error("boom_unhandled_rejection"));
    }, 20);
    setInterval(() => {}, 1000);
  `;
  const res = await runChildHarness(script, { env: { FATAL_DRAIN_SECONDS: String(fatalDrainSeconds) } });
  assert.equal(res.exitCode, 1, "must exit with code 1 on unhandledRejection");
  assert.ok(res.elapsedMs < (fatalDrainSeconds + 2) * 1000, `exited in ${res.elapsedMs}ms, expected < ${(fatalDrainSeconds + 2) * 1000}ms`);
  assert.match(res.stderr, /"event":"worker_fatal"/);
  assert.match(res.stderr, /"kind":"unhandledRejection"/);
  assert.match(res.stderr, /boom_unhandled_rejection/);
});

test("3. EPIPE on stdout (parent closes read end of pipe) does NOT kill the worker", async () => {
  const script = `
    import { writeSync } from "node:fs";
    import { installProcessSafety } from ${JSON.stringify(safetyUrl)};
    installProcessSafety({ drainSeconds: 1, fatalDrainSeconds: 1 });
    writeSync(2, "READY\\n");
    let writes = 0;
    const iv = setInterval(() => {
      writes += 1;
      console.log(JSON.stringify({ event: "tick", writes, pad: "x".repeat(512) }));
      if (writes >= 6) {
        clearInterval(iv);
        writeSync(2, "SURVIVED_EPIPE\\n");
        process.exit(0);
      }
    }, 25);
  `;

  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  let pipeClosed = false;
  child.stdout.on("error", () => {});
  child.stderr.on("data", (d) => {
    stderr += d;
    if (!pipeClosed && stderr.includes("READY")) {
      pipeClosed = true;
      // Destroy parent's read end of child's stdout so child's next console.log triggers write EPIPE on process.stdout
      child.stdout.destroy();
    }
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  assert.equal(exitCode, 0, `expected exit code 0 after stdout EPIPE, got ${exitCode} (stderr: ${stderr})`);
  assert.match(stderr, /SURVIVED_EPIPE/);
  assert.doesNotMatch(stderr, /worker_fatal/);
});

test("4. SIGTERM with a stuck in-flight job calls fail(queue, id, attempt, 'worker shutting down') once and exits 0 at the deadline (DRAIN_SECONDS=1)", async () => {
  const script = `
    import { writeSync } from "node:fs";
    import { installProcessSafety } from ${JSON.stringify(safetyUrl)};
    import { runLeased } from ${JSON.stringify(controlUrl)};

    const inFlight = new Set();
    const jobShutdown = new AbortController();
    const failCalls = [];

    const control = {
      heartbeat: async () => ({ ok: true }),
      complete: async () => ({ ok: true }),
      fail: async (queue, id, attempt, reason) => {
        failCalls.push({ queue, id, attempt, reason });
        writeSync(2, "FAIL_CALLED:" + JSON.stringify({ queue, id, attempt, reason }) + "\\n");
        return { ok: true };
      }
    };

    installProcessSafety({
      control,
      inFlight,
      abortJobs: () => jobShutdown.abort(new Error("worker shutting down")),
      drainSeconds: 1, postAbortGraceMs: 300,
      fatalDrainSeconds: 1
    });

    // Start a stuck job that ignores job.signal and never resolves on its own
    void runLeased(
      control,
      { queue: "plate-render", id: "stuck-job-42", attempt: 3, data: {}, leaseSeconds: 30 },
      () => new Promise(() => {}),
      { shutdown: jobShutdown.signal, inFlight }
    );

    writeSync(2, "JOB_STARTED\\n");
    setInterval(() => {}, 1000);
  `;

  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, DRAIN_SECONDS: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  let sigtermSentAt = 0;
  child.stderr.on("data", (d) => {
    stderr += d;
    if (!sigtermSentAt && stderr.includes("JOB_STARTED")) {
      sigtermSentAt = Date.now();
      child.kill("SIGTERM");
    }
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  const drainElapsedMs = Date.now() - sigtermSentAt;

  assert.equal(exitCode, 0, `expected exit code 0 on SIGTERM drain, got ${exitCode}`);
  assert.ok(drainElapsedMs >= 900 && drainElapsedMs < 3000, `expected drain ~1000ms, got ${drainElapsedMs}ms`);

  const failLines = stderr
    .split("\n")
    .filter((l) => l.startsWith("FAIL_CALLED:"))
    .map((l) => JSON.parse(l.slice("FAIL_CALLED:".length)));
  assert.equal(failLines.length, 1, `expected fail() to be called exactly once, got ${failLines.length}`);
  assert.deepEqual(failLines[0], {
    queue: "plate-render",
    id: "stuck-job-42",
    attempt: 3,
    reason: "worker shutting down"
  });
});

test("5. compose.mjs run() handles child stdio stream errors (ignores EPIPE, rejects on non-EPIPE)", async () => {
  const out = await run(process.execPath, ["-e", "process.stdout.write('hello\\n')"]);
  assert.equal(out.trim(), "hello");
});
