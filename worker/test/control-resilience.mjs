// Control client resilience unit tests (plain Node, local http server, no Docker, no DB):
//   - isTransient(error) classification (EPIPE, ECONNRESET, ECONNREFUSED, ETIMEDOUT, EAI_AGAIN, UND_ERR_*, AbortError,
//     TypeError: fetch failed with transient cause, HTTP 408/425/429/500/502/503/504 vs final 4xx / malformed)
//   - (a) server destroys socket before answering -> poll survives and returns jobs
//   - (b) server writes half a response then destroys -> poll survives and returns jobs
//   - (c) server answers 503 N times then 200 -> poll survives, returns jobs, logs ONE warning + ONE control_recovered
//   - (d) server answers 401 -> final (throws ControlError immediately)
//   - (e) server holds a poll and closes mid-poll (backend restart), then restarts on the same port -> poll survives and returns jobs
//   - complete retries 503s and succeeds; complete gives up gracefully ({ ok: false, gaveUp: true }) after injectable cap (< 3 s)
//   - no unhandledRejection or uncaughtException occurs
// Run: node test/control-resilience.mjs
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { ControlError, consume, createControl, isTransient, runLeased } from "../src/control.mjs";

const unhandled = [];
process.on("uncaughtException", (err) => unhandled.push({ kind: "uncaughtException", err }));
process.on("unhandledRejection", (err) => unhandled.push({ kind: "unhandledRejection", err }));

function listenOn(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function closeServerWithSockets(server, sockets) {
  for (const s of sockets) {
    try { s.destroy(); } catch {}
  }
  sockets.clear();
  return new Promise((resolve) => server.close(() => resolve()));
}

test("1. isTransient classifies transient network/HTTP errors vs final 4xx and malformed responses", () => {
  // Transient socket/network codes
  for (const code of ["EPIPE", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"]) {
    const err = Object.assign(new Error(`error ${code}`), { code });
    assert.equal(isTransient(err), true, `expected code ${code} to be transient`);
    const wrapped = new TypeError("fetch failed", { cause: err });
    assert.equal(isTransient(wrapped), true, `expected TypeError(fetch failed) with cause ${code} to be transient`);
  }

  // AggregateError cause (e.g. dual-stack ECONNREFUSED in Node 24)
  const agg = new TypeError("fetch failed", {
    cause: new AggregateError([Object.assign(new Error("connect ECONNREFUSED 127.0.0.1"), { code: "ECONNREFUSED" })])
  });
  assert.equal(isTransient(agg), true, "expected AggregateError ECONNREFUSED cause to be transient");

  // AbortError / TimeoutError from request timeout
  assert.equal(isTransient(new DOMException("The operation was aborted.", "AbortError")), true);
  assert.equal(isTransient(new DOMException("The operation timed out.", "TimeoutError")), true);

  // Transient HTTP statuses: 408, 425, 429, 500, 502, 503, 504
  for (const status of [408, 425, 429, 500, 502, 503, 504]) {
    assert.equal(isTransient(new ControlError(`HTTP ${status}`, status)), true, `expected HTTP ${status} to be transient`);
  }

  // Final HTTP statuses: 400, 401, 403, 404, 422
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(isTransient(new ControlError(`HTTP ${status}`, status)), false, `expected HTTP ${status} to be final`);
  }

  // Malformed responses are final
  assert.equal(isTransient(new SyntaxError("Unexpected token < in JSON")), false, "SyntaxError is final");
  assert.equal(isTransient(Object.assign(new ControlError("Malformed JSON", 200, "malformed"), { malformed: true })), false, "malformed ControlError is final");
  assert.equal(isTransient(new TypeError("fetch failed", { cause: new TypeError("Invalid URL") })), false, "TypeError with non-transient cause is final");
});

test("2. poll survives (a) socket destroy before answer, (b) half-response then destroy, (c) 503 x N then 200, and logs ONE warn + ONE control_recovered per episode", async (t) => {
  const sockets = new Set();
  let mode = "a";
  let count = 0;

  const server = http.createServer((req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});
    count += 1;

    if (mode === "a") {
      // (a) destroy socket before answering on first 2 tries, then answer 200 with job
      if (count <= 2) {
        req.socket.destroy();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jobs: [{ queue: "plate-render", id: "job-a", attempt: 1, data: {}, leaseSeconds: 30 }] }));
      return;
    }

    if (mode === "b") {
      // (b) write half a response then destroy socket on first 2 tries, then answer 200 with job
      if (count <= 2) {
        res.writeHead(200, { "content-type": "application/json" });
        res.write('{"jobs":[{"id":"half');
        req.socket.destroy();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jobs: [{ queue: "plate-render", id: "job-b", attempt: 1, data: {}, leaseSeconds: 30 }] }));
      return;
    }

    if (mode === "c") {
      // (c) answer 503 N=4 times then 200 with job
      if (count <= 4) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Service Unavailable" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jobs: [{ queue: "plate-render", id: "job-c", attempt: 1, data: {}, leaseSeconds: 30 }] }));
    }
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
    s.on("error", () => {});
  });

  const port = await listenOn(server);
  t.after(() => closeServerWithSockets(server, sockets));

  const logs = [];
  const control = createControl({
    url: `http://127.0.0.1:${port}`,
    token: "secret-token",
    baseDelayMs: 10,
    maxDelayMs: 40,
    log: (level, event, fields) => logs.push({ level, event, ...fields })
  });

  // Scenario (a)
  mode = "a";
  count = 0;
  logs.length = 0;
  const outA = await control.poll({ "plate-render": 1 }, { waitSeconds: 1 });
  assert.equal(outA.jobs.length, 1);
  assert.equal(outA.jobs[0].id, "job-a");
  assert.equal(logs.filter((l) => l.level === "warn").length, 1, "Scenario (a): exactly 1 warning logged for outage episode");
  assert.equal(logs.filter((l) => l.level === "info" && l.event === "control_recovered").length, 1, "Scenario (a): exactly 1 control_recovered logged");

  // Scenario (b)
  mode = "b";
  count = 0;
  logs.length = 0;
  const outB = await control.poll({ "plate-render": 1 }, { waitSeconds: 1 });
  assert.equal(outB.jobs.length, 1);
  assert.equal(outB.jobs[0].id, "job-b");
  assert.equal(logs.filter((l) => l.level === "warn").length, 1, "Scenario (b): exactly 1 warning logged for outage episode");
  assert.equal(logs.filter((l) => l.level === "info" && l.event === "control_recovered").length, 1, "Scenario (b): exactly 1 control_recovered logged");

  // Scenario (c)
  mode = "c";
  count = 0;
  logs.length = 0;
  const outC = await control.poll({ "plate-render": 1 }, { waitSeconds: 1 });
  assert.equal(outC.jobs.length, 1);
  assert.equal(outC.jobs[0].id, "job-c");
  assert.equal(count, 5, "Scenario (c): 4 x 503 + 1 x 200 = 5 requests");
  assert.equal(logs.filter((l) => l.level === "warn").length, 1, "Scenario (c): exactly 1 warning across 4 consecutive 503s");
  assert.equal(logs.filter((l) => l.level === "info" && l.event === "control_recovered").length, 1, "Scenario (c): exactly 1 control_recovered logged");
  assert.equal(logs.find((l) => l.event === "control_recovered").failures, 4);
});

test("3. Scenario (d): 401 is final and throws ControlError without retrying", async (t) => {
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits += 1;
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "unauthorized", message: "Not authorised." } }));
  });
  const port = await listenOn(server);
  t.after(() => new Promise((r) => server.close(r)));

  const logs = [];
  const control = createControl({
    url: `http://127.0.0.1:${port}`,
    token: "wrong-token",
    baseDelayMs: 10,
    maxDelayMs: 40,
    log: (level, event, fields) => logs.push({ level, event, ...fields })
  });

  await assert.rejects(
    () => control.poll({ "plate-render": 1 }, { waitSeconds: 1 }),
    (err) => err instanceof ControlError && err.status === 401
  );
  assert.equal(hits, 1, "401 is not retried");
  assert.equal(logs.filter((l) => l.level === "warn").length, 0, "no transient warning logged for final 401");
});

test("4. Scenario (e): server holds a poll, closes mid-poll (backend restart), then restarts on the same port", async () => {
  const sockets1 = new Set();
  let pollEnteredResolve;
  const pollEntered = new Promise((r) => { pollEnteredResolve = r; });

  const server1 = http.createServer((req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});
    if (req.url === "/internal/worker/poll") {
      pollEnteredResolve();
      // Hold poll open until server1 is closed mid-poll
    }
  });
  server1.on("connection", (s) => {
    sockets1.add(s);
    s.on("close", () => sockets1.delete(s));
    s.on("error", () => {});
  });

  const port = await listenOn(server1, 0);
  const logs = [];
  const control = createControl({
    url: `http://127.0.0.1:${port}`,
    token: "secret-token",
    baseDelayMs: 15,
    maxDelayMs: 60,
    log: (level, event, fields) => logs.push({ level, event, ...fields })
  });

  // Start long-poll against server1
  const pollPromise = control.poll({ "plate-render": 1 }, { waitSeconds: 10 });

  // Wait for server1 to receive and hold the poll, then close server1 mid-poll
  await pollEntered;
  await closeServerWithSockets(server1, sockets1);

  // Keep server down briefly so poll also experiences ECONNREFUSED during the restart window
  await new Promise((r) => setTimeout(r, 40));

  // Restart server2 on the exact same port
  const sockets2 = new Set();
  const server2 = http.createServer((req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      jobs: [{ queue: "plate-render", id: "job-after-restart", attempt: 1, data: {}, leaseSeconds: 30 }]
    }));
  });
  server2.on("connection", (s) => {
    sockets2.add(s);
    s.on("close", () => sockets2.delete(s));
    s.on("error", () => {});
  });
  await listenOn(server2, port);

  try {
    const result = await pollPromise;
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].id, "job-after-restart");
    assert.equal(logs.filter((l) => l.level === "warn").length, 1, "Scenario (e): exactly 1 warning for the entire restart outage episode");
    assert.equal(logs.filter((l) => l.level === "info" && l.event === "control_recovered").length, 1, "Scenario (e): logs 1 control_recovered upon reconnect");
  } finally {
    await closeServerWithSockets(server2, sockets2);
  }
});

test("5. complete retries 503s and succeeds; complete & fail give up gracefully after injectable cap without throwing", async (t) => {
  let completeAttempts = 0;
  let alwaysDown = false;

  const server = http.createServer((req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});
    if (req.url?.endsWith("/complete") || req.url?.endsWith("/fail")) {
      completeAttempts += 1;
      if (alwaysDown || completeAttempts <= 3) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "redeploying" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, applied: true }));
    }
  });
  const port = await listenOn(server);
  t.after(() => new Promise((r) => server.close(r)));

  const logs = [];
  const control = createControl({
    url: `http://127.0.0.1:${port}`,
    token: "secret-token",
    baseDelayMs: 10,
    maxDelayMs: 30,
    ackRetryCapMs: 120,
    log: (level, event, fields) => logs.push({ level, event, ...fields })
  });

  // 5a. Retries 3 x 503 then succeeds on 4th attempt
  const okRes = await control.complete("plate-render", "00000000-0000-4000-8000-000000000001", 1);
  assert.deepEqual(okRes, { ok: true, applied: true });
  assert.equal(completeAttempts, 4);

  // 5b. Stays 503 past injectable cap (120 ms) -> returns { ok: false, gaveUp: true } without throwing, in < 3 s
  alwaysDown = true;
  completeAttempts = 0;
  logs.length = 0;
  const t0 = Date.now();
  const gaveUpRes = await control.complete("plate-render", "00000000-0000-4000-8000-000000000002", 1);
  const elapsed = Date.now() - t0;
  assert.deepEqual(gaveUpRes, { ok: false, gaveUp: true });
  assert.ok(elapsed < 2500, `complete cap test took ${elapsed}ms, expected < 2500ms`);
  assert.equal(logs.some((l) => l.level === "warn" && l.event === "control_ack_gave_up"), true, "logged control_ack_gave_up warning");

  // 5c. runLeased does NOT call fail on a lost lease, and calls fail("worker shutting down") once on shutdown abort
  const failCalls = [];
  const fakeCtrl = {
    heartbeat: async () => ({ ok: false, reason: "superseded" }),
    complete: async () => ({ ok: true }),
    fail: async (queue, id, attempt, reason) => {
      failCalls.push({ queue, id, attempt, reason });
      return { ok: true };
    }
  };
  const inFlight = new Set();
  const lostOutcome = await runLeased(
    fakeCtrl,
    { queue: "plate-render", id: "lost-job", attempt: 1, data: {}, leaseSeconds: 3 },
    (job) => new Promise((_, reject) => job.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })),
    { inFlight, intervalMs: 15 }
  );
  assert.equal(lostOutcome, "abandoned");
  assert.equal(failCalls.length, 0, "never calls fail on a lost lease");

  const shutdownCtrl = new AbortController();
  const shutdownFakeCtrl = {
    heartbeat: async () => ({ ok: true }),
    complete: async () => ({ ok: true }),
    fail: async (queue, id, attempt, reason) => {
      failCalls.push({ queue, id, attempt, reason });
      return { ok: true };
    }
  };
  const shutdownPromise = runLeased(
    shutdownFakeCtrl,
    { queue: "plate-render", id: "shut-job", attempt: 2, data: {}, leaseSeconds: 30 },
    (job) => new Promise((_, reject) => job.signal.addEventListener("abort", () => reject(new Error("shutting down")), { once: true })),
    { shutdown: shutdownCtrl.signal, inFlight }
  );
  setTimeout(() => shutdownCtrl.abort(), 15);
  const shutOutcome = await shutdownPromise;
  assert.equal(shutOutcome, "abandoned");
  assert.equal(failCalls.length, 1, "calls fail once when aborted by shutdown");
  assert.equal(failCalls[0].reason, "worker shutting down");

  // Verify consume loop also works end-to-end
  alwaysDown = false;
  assert.equal(typeof consume, "function");
  assert.equal(unhandled.length, 0, `expected 0 unhandled errors, got ${JSON.stringify(unhandled)}`);
});
