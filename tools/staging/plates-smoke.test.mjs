// Runs tools/staging/plates-smoke.mjs against the in-process mock (mock-api.mjs) on a random free port. No Docker, no database.
//   node --test tools/staging/plates-smoke.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startMock } from "./mock-api.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SMOKE = join(HERE, "plates-smoke.mjs");
const SENTINEL = "sentinel-token-DO-NOT-LEAK-7f3a9c1e5b";
const RESERVED = new Set([4100, 4000, 3000, 8766, 55432, 58787, 59000]);
const hasFfprobe = spawnSync("ffprobe", ["-version"]).status === 0;

async function mockOn(options) {
  for (;;) {
    const mock = await startMock({ token: SENTINEL, ...options });
    if (!RESERVED.has(mock.port)) return mock;
    await mock.close();
  }
}

/** Runs the smoke script as a child process and returns what a person would see. */
function smoke(mock, extra = {}) {
  const out = mkdtempSync(join(tmpdir(), "plates-smoke-"));
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME,
    SMOKE_API: mock.url, SMOKE_TOKEN: SENTINEL, SMOKE_OUT: out, SMOKE_POLL_MS: "15", SMOKE_KEEP: "",
    ...(hasFfprobe ? {} : { SMOKE_FFPROBE: "off" }), ...extra
  };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SMOKE], { env });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => resolve({ code, stdout, stderr, out }));
  });
}
const lastLine = (r) => r.stdout.trim().split("\n").at(-1);
const filesIn = (dir) => readdirSync(dir).map((f) => join(dir, f));
const assertNoLeak = (r) => {
  assert.ok(!r.stdout.includes(SENTINEL), "token in stdout");
  assert.ok(!r.stderr.includes(SENTINEL), "token in stderr");
  for (const file of filesIn(r.out)) if (statSync(file).size < 5_000_000 && !file.endsWith(".mp4")) assert.ok(!readFileSync(file, "utf8").includes(SENTINEL), `token in ${file}`);
};

test("happy path passes, every step logs ok, the token never leaks, a double render spends once", async () => {
  const mock = await mockOn();
  try {
    const r = await smoke(mock);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    for (const name of ["health", "create", "script", "plan", "animate", "preview-assets", "comment", "quote", "render", "download", "report"]) assert.match(r.stdout, new RegExp(`^step ${name} ok \\d+$`, "m"), `step ${name}`);
    assert.match(lastLine(r), /^SMOKE PASS .*report\.json$/);
    const report = JSON.parse(readFileSync(join(r.out, "report.json"), "utf8"));
    assert.equal(report.result, "pass");
    assert.equal(report.idempotency.jobIds, 1);
    assert.equal(report.idempotency.spent, report.idempotency.quoted);
    assert.equal(mock.state.spendCount, 1, "four render requests with one key must spend once");
    assert.equal(mock.state.jobs.size, 1);
    assert.equal(mock.state.balance, 40 - 6);
    assert.equal(report.scenes.length, 3);
    assert.equal(report.bundleSizes.length, 3);
    assert.ok(report.clip.bytes > 1000);
    assert.ok(report.mp4.bytes > 100 * 1024);
    assert.ok(report.comment.digestChanged);
    const mp4 = readFileSync(join(r.out, "film.mp4"));
    assert.equal(mp4.subarray(4, 8).toString("latin1"), "ftyp");
    if (hasFfprobe) { assert.equal(report.mp4.width, 1920); assert.equal(report.mp4.height, 1080); assert.ok(report.mp4.frames > 0); }
    assert.ok(mock.state.requests.some((q) => q.auth === "yes"), "the bearer was sent to the API");
    assert.ok(mock.state.requests.filter((q) => q.path.startsWith("/obj/")).every((q) => q.auth === "no"), "the bearer must not be sent to the object store");
    assert.equal(mock.state.projects.values().next().value.project.archived, true, "the project is archived at the end");
    assertNoLeak(r);
  } finally { await mock.close(); }
});

test("live mode (scenes stop at bundled) still passes through the clip fallback", async () => {
  const mock = await mockOn({ mode: "live" });
  try {
    const r = await smoke(mock);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(lastLine(r), /^SMOKE PASS/);
    assertNoLeak(r);
  } finally { await mock.close(); }
});

test("a base URL with /v1 on the end does not double the prefix", async () => {
  const mock = await mockOn();
  try {
    const r = await smoke(mock, { SMOKE_API: `${mock.url}/v1/` });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.ok(!mock.state.requests.some((q) => q.path.startsWith("/v1/v1/")));
  } finally { await mock.close(); }
});

const cases = [
  ["auth", "health"], ["script", "script"], ["plan", "plan"], ["voice", "plan"], ["animate", "animate"], ["scene-failed", "animate"],
  ["no-bundle", "preview-assets"], ["bundle-not-html", "preview-assets"], ["fix-same", "comment"], ["fix-spill", "comment"],
  ["render", "render"], ["double-spend", "render"], ["not-mp4", "download"]
];
for (const [fail, step] of cases) {
  test(`switch ${fail} ends in SMOKE FAIL ${step}`, async () => {
    const mock = await mockOn({ fail });
    try {
      const r = await smoke(mock);
      assert.equal(r.code, 1, r.stdout + r.stderr);
      assert.match(r.stdout, new RegExp(`^step ${step} FAIL .+$`, "m"));
      assert.match(lastLine(r), new RegExp(`^SMOKE FAIL ${step} .*report\\.json$`));
      const report = JSON.parse(readFileSync(join(r.out, "report.json"), "utf8"));
      assert.equal(report.result, "fail");
      assert.equal(report.failedStep, step);
      // stopped at the first failure: nothing after it ran
      const order = ["health", "create", "script", "plan", "animate", "preview-assets", "comment", "quote", "render", "download"];
      for (const later of order.slice(order.indexOf(step) + 1)) assert.ok(!new RegExp(`^step ${later} (ok|FAIL)`, "m").test(r.stdout), `${later} ran after ${step} failed`);
      assertNoLeak(r);
    } finally { await mock.close(); }
  });
}

test("a failed render reports whether the tokens came back", async () => {
  const mock = await mockOn({ fail: "render" });
  try {
    const r = await smoke(mock);
    assert.match(r.stdout, /tokens refunded/);
    assert.equal(mock.state.balance, 40);
  } finally { await mock.close(); }
});

test("double-spend is caught by the balance check", async () => {
  const mock = await mockOn({ fail: "double-spend" });
  try {
    const r = await smoke(mock);
    assert.match(r.stdout, /step render FAIL .*(different jobs|spent)/);
    assert.ok(mock.state.spendCount > 1);
  } finally { await mock.close(); }
});

test("a quote above SMOKE_MAX_TOKENS aborts before Render and spends nothing", async () => {
  const mock = await mockOn({ fail: "quote-high" });
  try {
    const r = await smoke(mock);
    assert.equal(r.code, 3, r.stdout + r.stderr);
    assert.match(r.stdout, /^step quote ABORT /m);
    assert.match(lastLine(r), /^SMOKE ABORT quote /);
    assert.equal(mock.state.spendCount, 0);
    assert.ok(!/^step render/m.test(r.stdout));
  } finally { await mock.close(); }
});

test("a wrong token is refused at health and never printed", async () => {
  const mock = await mockOn();
  try {
    const wrong = "wrong-token-ZZZ-0987654321";
    const r = await smoke(mock, { SMOKE_TOKEN: wrong });
    assert.match(lastLine(r), /^SMOKE FAIL health /);
    assert.ok(!r.stdout.includes(wrong) && !r.stderr.includes(wrong));
  } finally { await mock.close(); }
});

test("SMOKE_STEPS=refund checks that a refused render charges nothing", async () => {
  const mock = await mockOn();
  try {
    const r = await smoke(mock, { SMOKE_STEPS: "health,refund" });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^step refund ok \d+$/m);
    assert.equal(mock.state.spendCount, 0);
    assert.ok(!/^step create/m.test(r.stdout));
  } finally { await mock.close(); }
});

test("refund is not run by default", async () => {
  const mock = await mockOn();
  try {
    const r = await smoke(mock);
    assert.ok(!/step refund/.test(r.stdout));
  } finally { await mock.close(); }
});

test("--continue keeps going after a failure", async () => {
  const mock = await mockOn({ fail: "scene-failed" });
  try {
    const out = await new Promise((resolve) => {
      const env = { PATH: process.env.PATH, SMOKE_API: mock.url, SMOKE_TOKEN: SENTINEL, SMOKE_OUT: mkdtempSync(join(tmpdir(), "plates-smoke-")), SMOKE_POLL_MS: "15", ...(hasFfprobe ? {} : { SMOKE_FFPROBE: "off" }) };
      const child = spawn(process.execPath, [SMOKE, "--continue"], { env });
      let stdout = ""; child.stdout.on("data", (d) => { stdout += d; }); child.on("close", (code) => resolve({ code, stdout }));
    });
    assert.equal(out.code, 1);
    assert.match(out.stdout, /^step animate FAIL /m);
    assert.match(out.stdout, /^step preview-assets FAIL skipped: needs scenes/m);
    assert.match(out.stdout, /^SMOKE FAIL animate /m);
  } finally { await mock.close(); }
});

test("SMOKE_PROJECT resumes an existing project for a subset of steps", async () => {
  const mock = await mockOn();
  try {
    const first = await smoke(mock, { SMOKE_STEPS: "health,create,script,plan,animate,report", SMOKE_KEEP: "1" });
    assert.equal(first.code, 0, first.stdout + first.stderr);
    const id = JSON.parse(readFileSync(join(first.out, "report.json"), "utf8")).projectId;
    const second = await smoke(mock, { SMOKE_PROJECT: id, SMOKE_STEPS: "health,quote,render,download,report" });
    assert.equal(second.code, 0, second.stdout + second.stderr);
    assert.match(second.stdout, /^step render ok \d+$/m);
    assert.ok(!/^step create/m.test(second.stdout));
    assert.equal(mock.state.spendCount, 1);
    assert.ok(!mock.state.projects.get(id).project.archived, "a reused project is not archived");
    assertNoLeak(second);
  } finally { await mock.close(); }
});

test("the reserved ports are never used by the mock", async () => {
  const mock = await mockOn();
  try { assert.ok(!RESERVED.has(mock.port)); assert.ok(existsSync(join(HERE, "fixtures", "film.mp4"))); } finally { await mock.close(); }
});
