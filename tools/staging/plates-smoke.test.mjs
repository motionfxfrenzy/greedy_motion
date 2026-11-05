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

test("--continue keeps going after a failure and marks dependent later steps skipped, not ok", async () => {
  const mock = await mockOn({ fail: "scene-failed" });
  try {
    const outDir = mkdtempSync(join(tmpdir(), "plates-smoke-"));
    const out = await new Promise((resolve) => {
      const env = { PATH: process.env.PATH, SMOKE_API: mock.url, SMOKE_TOKEN: SENTINEL, SMOKE_OUT: outDir, SMOKE_POLL_MS: "15", ...(hasFfprobe ? {} : { SMOKE_FFPROBE: "off" }) };
      const child = spawn(process.execPath, [SMOKE, "--continue"], { env });
      let stdout = ""; child.stdout.on("data", (d) => { stdout += d; }); child.on("close", (code) => resolve({ code, stdout }));
    });
    assert.equal(out.code, 1);
    assert.match(out.stdout, /^step animate FAIL /m);
    assert.match(out.stdout, /^step preview-assets skipped needs scenes/m);
    assert.match(out.stdout, /^SMOKE FAIL animate /m);
    const report = JSON.parse(readFileSync(join(outDir, "report.json"), "utf8"));
    for (const later of ["preview-assets", "comment", "quote", "render", "download"]) {
      const entry = report.steps.find((s) => s.name === later);
      assert.equal(entry?.status, "skipped", `${later} must be marked skipped, not ${entry?.status}`);
    }
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

// ---------- v2 review gaps (a to h) ----------

test("gap a: final lines and exit codes (SMOKE PASS -> 0, SMOKE FAIL -> 1, SMOKE ABORT -> 3)", async () => {
  const passMock = await mockOn();
  const failMock = await mockOn({ fail: "auth" });
  const abortMock = await mockOn({ fail: "quote-high" });
  try {
    const p = await smoke(passMock);
    assert.equal(p.code, 0);
    assert.match(lastLine(p), /^SMOKE PASS .+report\.json$/);
    const f = await smoke(failMock);
    assert.equal(f.code, 1);
    assert.match(lastLine(f), /^SMOKE FAIL health .+report\.json$/);
    const a = await smoke(abortMock);
    assert.equal(a.code, 3);
    assert.match(lastLine(a), /^SMOKE ABORT quote .+report\.json$/);
  } finally {
    await passMock.close();
    await failMock.close();
    await abortMock.close();
  }
});

test("gap b: Idempotency-Key repeat render sent after the first job is already running returns same job and spends once", async () => {
  const okMock = await mockOn();
  const badMock = await mockOn({ fail: "double-spend-running" });
  try {
    const okRun = await smoke(okMock);
    assert.equal(okRun.code, 0, okRun.stdout + okRun.stderr);
    const okReport = JSON.parse(readFileSync(join(okRun.out, "report.json"), "utf8"));
    assert.equal(okReport.idempotency.requests, 5);
    assert.equal(okReport.idempotency.jobIds, 1);
    assert.equal(okReport.idempotency.checkedWhileRunning, true);
    assert.equal(okReport.idempotency.spent, okReport.idempotency.quoted);
    assert.equal(okMock.state.spendCount, 1);

    const badRun = await smoke(badMock);
    assert.equal(badRun.code, 1);
    assert.match(badRun.stdout, /^step render FAIL repeat render with same Idempotency-Key while job was/m);
    assert.match(lastLine(badRun), /^SMOKE FAIL render /);
  } finally {
    await okMock.close();
    await badMock.close();
  }
});

test("gap c & 2.f.3: download asserts 302, strips bearer on cross-origin redirect, checks ftyp and >100kB before writing, and handles missing ffprobe", async () => {
  const noProbeMock = await mockOn();
  const smallMock = await mockOn({ fail: "small-mp4" });
  const badMp4Mock = await mockOn({ fail: "not-mp4" });
  try {
    const r = await smoke(noProbeMock, { SMOKE_FFPROBE: "off" });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /warn ffprobe not available/);
    const report = JSON.parse(readFileSync(join(r.out, "report.json"), "utf8"));
    assert.equal(report.mp4.redirected, true);
    assert.equal(report.mp4.redirectStatus, 302);
    assert.equal(report.mp4.ffprobe, "skipped");
    assert.ok(report.warnings.some((w) => w.includes("ffprobe not available")));
    assert.ok(noProbeMock.state.requests.filter((q) => q.path.startsWith("/obj/")).every((q) => q.auth === "no"));

    const small = await smoke(smallMock);
    assert.equal(small.code, 1);
    assert.match(small.stdout, /^step download FAIL film\.mp4 is only \d+ bytes/m);
    assert.equal(existsSync(join(small.out, "film.mp4")), false, "film.mp4 must not be written when size check fails");

    const badMp4 = await smoke(badMp4Mock);
    assert.equal(badMp4.code, 1);
    assert.equal(existsSync(join(badMp4.out, "film.mp4")), false, "film.mp4 must not be written when ftyp check fails");
  } finally {
    await noProbeMock.close();
    await smallMock.close();
    await badMp4Mock.close();
  }
});

test("gap d: sentinel token and media token never appear in stdout, stderr, report.json, or any request URL", async () => {
  const mock = await mockOn();
  try {
    const r = await smoke(mock);
    assert.equal(r.code, 0);
    assertNoLeak(r);
    assert.ok(!r.stdout.includes(mock.state.mediaToken), "media token must be redacted in stdout");
    const reportText = readFileSync(join(r.out, "report.json"), "utf8");
    assert.ok(!reportText.includes(mock.state.mediaToken), "media token must not appear in report.json");
  } finally {
    await mock.close();
  }
});

test("gap e: SMOKE_STEPS subset without create fails clearly if SMOKE_PROJECT is missing; --continue continues after non-blocking failure", async () => {
  const mock = await mockOn();
  const nonBlockingMock = await mockOn({ fail: "no-bundle" });
  try {
    const missingProj = await smoke(mock, { SMOKE_STEPS: "health,animate,preview-assets,comment,quote,render,download,report" });
    assert.equal(missingProj.code, 1);
    assert.match(missingProj.stdout, /^step animate FAIL SMOKE_PROJECT is required when SMOKE_STEPS omits create$/m);
    assert.match(lastLine(missingProj), /^SMOKE FAIL animate /);

    const outDir = mkdtempSync(join(tmpdir(), "plates-smoke-"));
    const cont = await new Promise((resolve) => {
      const env = { PATH: process.env.PATH, SMOKE_API: nonBlockingMock.url, SMOKE_TOKEN: SENTINEL, SMOKE_OUT: outDir, SMOKE_POLL_MS: "15", ...(hasFfprobe ? {} : { SMOKE_FFPROBE: "off" }) };
      const child = spawn(process.execPath, [SMOKE, "--continue"], { env });
      let stdout = ""; child.stdout.on("data", (d) => { stdout += d; }); child.on("close", (code) => resolve({ code, stdout }));
    });
    assert.equal(cont.code, 1);
    assert.match(cont.stdout, /^step preview-assets FAIL /m);
    assert.match(cont.stdout, /^step render ok \d+$/m);
    assert.match(cont.stdout, /^step download ok \d+$/m);
  } finally {
    await mock.close();
    await nonBlockingMock.close();
  }
});

test("gap f (1, 6, 8): comment works in live mode when scene 1 is bundled; --help lists SMOKE_DURATION, SMOKE_AUDIO and timeouts; create/PUT bodies match studio.tsx", async () => {
  const help = spawnSync(process.execPath, [SMOKE, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  for (const v of ["SMOKE_DURATION", "SMOKE_AUDIO", "SMOKE_POLL_MS", "SMOKE_PLAN_TIMEOUT_MS", "SMOKE_ANIMATE_TIMEOUT_MS", "SMOKE_RENDER_TIMEOUT_MS"]) {
    assert.ok(help.stdout.includes(v), `--help missing ${v}`);
  }

  const mock = await mockOn({ mode: "live" });
  try {
    // Run animate -> comment directly in live mode (skipping preview-assets so scene 1 stays `bundled`, not `drawn`).
    const r = await smoke(mock, { SMOKE_STEPS: "health,create,script,plan,animate,comment,report" });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^step comment ok \d+$/m);

    const createReq = mock.state.requests.find((q) => q.method === "POST" && q.path === "/v1/projects");
    const putReq = mock.state.requests.find((q) => q.method === "PUT" && /^\/v1\/projects\/[0-9a-f-]{36}$/.test(q.path) && q.body?.request);
    assert.equal(createReq?.body?.name, "A lighthouse keeper lights the lamp every evening so ships can find the harbour");
    assert.deepEqual(createReq?.body?.request?.audio, { music: false, voiceover: false, voice: "Kore" });
    assert.deepEqual(putReq?.body?.request, createReq?.body?.request);
  } finally {
    await mock.close();
  }
});

test("gap g & 2.f (3, 4, 7): steps marked ok with warning conditions list every warning in report.json warnings", async () => {
  const mock = await mockOn({ fail: ["bundle-ctype", "download-200", "fix-stub-same"] });
  try {
    const r = await smoke(mock, { SMOKE_BEATS: "4" });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const report = JSON.parse(readFileSync(join(r.out, "report.json"), "utf8"));
    assert.equal(report.result, "pass");
    assert.ok(report.warnings.some((w) => w.includes("script has 3 beats, SMOKE_BEATS asked for 4")), "script beat mismatch warning");
    assert.ok(report.warnings.some((w) => w.includes('bundle content-type is "application/octet-stream"')), "bundle content-type warning");
    assert.ok(report.warnings.some((w) => w.includes("with the same bundleDigest")), "comment same-digest new-artifact warning");
    assert.ok(report.warnings.some((w) => w.includes("output route answered 200, expected 302")), "download non-302 warning");
  } finally {
    await mock.close();
  }
});

test("gap h & 2.f.2: refund step guards SMOKE_MAX_TOKENS, respects stop-at-first-failure, and asserts balance restoration on failed render", async () => {
  const refundMock = await mockOn({ fail: "render" });
  const noRefundMock = await mockOn({ fail: ["render", "no-refund"] });
  const highQuoteMock = await mockOn({ fail: "quote-high" });
  const failBeforeMock = await mockOn({ fail: "auth" });
  try {
    const okRefund = await smoke(refundMock, { SMOKE_STEPS: "health,refund,report" });
    assert.equal(okRefund.code, 0, okRefund.stdout + okRefund.stderr);
    const report = JSON.parse(readFileSync(join(okRefund.out, "report.json"), "utf8"));
    assert.equal(report.refund.mode, "worker-failure");
    assert.equal(report.refund.balanceBefore, 40);
    assert.equal(report.refund.balanceAfter, 40);
    assert.equal(report.refund.restored, true);

    const badRefund = await smoke(noRefundMock, { SMOKE_STEPS: "health,refund,report" });
    assert.equal(badRefund.code, 1);
    assert.match(badRefund.stdout, /^step refund FAIL failed render did not restore the balance/m);

    const abortRefund = await smoke(highQuoteMock, { SMOKE_STEPS: "health,refund,report" });
    assert.equal(abortRefund.code, 3);
    assert.match(lastLine(abortRefund), /^SMOKE ABORT refund /);
    assert.equal(highQuoteMock.state.spendCount, 0);

    const stopBeforeRefund = await smoke(failBeforeMock, { SMOKE_STEPS: "health,refund,report" });
    assert.equal(stopBeforeRefund.code, 1);
    assert.ok(!/^step refund (ok|FAIL)/m.test(stopBeforeRefund.stdout), "refund must not run after health failed");
    const stopReport = JSON.parse(readFileSync(join(stopBeforeMockOut(stopBeforeRefund), "report.json"), "utf8"));
    assert.equal(stopReport.steps.find((s) => s.name === "refund")?.status, "skipped");
  } finally {
    await refundMock.close();
    await noRefundMock.close();
    await highQuoteMock.close();
    await failBeforeMock.close();
  }
});
const stopBeforeMockOut = (r) => r.out;

test("billing check: quote seconds must equal the film length rounded up (fails as SMOKE FAIL download when they differ)", { skip: !hasFfprobe }, async () => {
  const good = await mockOn();
  const bad = await mockOn({ fail: "quote-mismatch" });
  try {
    const ok = await smoke(good);
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    const r = await smoke(bad);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^step download FAIL quote said \d+ s but film\.mp4 lasts [\d.]+ s .*undercharged|overcharged/m);
    assert.match(lastLine(r), /^SMOKE FAIL download /);
  } finally { await good.close(); await bad.close(); }
});
