// Step 2: Chaos tests for job control + live scenes on the real local compose stack.
//   node tools/phase2/job-control/chaos.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  API,
  OWNER,
  api,
  download,
  ffprobe,
  log,
  now,
  pool,
  redirectOf,
  resetStub,
  seedProject,
  sleep,
  variants,
  waitFor
} from "../../../scripts/plates-e2e/lib.mjs";
import { createControl } from "../../../worker/src/control.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const CONTROL_TOKEN = "plates-e2e-control-token-0123456789";

function composeLive(...args) {
  return execFileSync(
    "docker",
    ["compose", "-f", "compose.yaml", "-f", "tools/phase2/e2e/compose.live.yaml", "--profile", "plates-e2e", ...args],
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
}

const results = [];
const assertions = [];

function check(scenario, condition, description, detail = "") {
  const status = condition ? "PASS" : "FAIL";
  console.log(`[${status}] (${scenario}) ${description}${detail ? ` — ${detail}` : ""}`);
  assertions.push({ scenario, description, ok: Boolean(condition), detail });
  if (!condition) {
    throw new Error(`Assertion failed in ${scenario}: ${description}${detail ? ` (${detail})` : ""}`);
  }
}

async function waitForApiReady(label = "plate-api ready") {
  return waitFor(
    label,
    async () => {
      try {
        const r = await api("/readyz");
        return r.status === 200 && r.json?.ready === true;
      } catch {
        return false;
      }
    },
    { timeout: 60_000, every: 400 }
  );
}

async function cleanStackState() {
  await waitForApiReady();
  await pool.query(`
    TRUNCATE TABLE
      app.plate_clips,
      app.plate_check_reports,
      app.plate_revisions,
      app.plate_garbage,
      app.plate_exports,
      app.plate_variants,
      app.plate_state,
      app.render_jobs
    CASCADE
  `);
  await pool.query("DELETE FROM app.token_ledger WHERE kind IN ('spend', 'refund')");
  await pool.query(
    `INSERT INTO app.token_ledger (user_id, amount, kind, reason, ref, actor, pool)
     VALUES ($1, 1000000, 'grant', 'chaos test allowance', 'chaos-pack-grant', 'system', 'pack')
     ON CONFLICT (user_id, ref) WHERE ref IS NOT NULL DO UPDATE SET amount = EXCLUDED.amount`,
    [OWNER]
  );
  await pool.query(`
    DELETE FROM pgboss.job
    WHERE name IN ('plate-author', 'plate-render', 'plate-export', 'render-plan', 'render-video', 'render-finished', '__pgboss__send-it')
  `);
  await resetStub();
}

async function tokenBalance(userId = OWNER) {
  const { rows } = await pool.query(
    "SELECT COALESCE(SUM(CASE WHEN kind = 'spend' THEN -amount ELSE amount END), 0)::int AS rem FROM app.token_ledger WHERE user_id = $1",
    [userId]
  );
  return Number(rows[0]?.rem ?? 0);
}

function workerContainerNames() {
  const out = execFileSync("docker", ["ps", "--filter", "name=videosaas-local-plate-worker", "--format", "{{.Names}}"], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
  return out
    .trim()
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function workerContainerIps(names) {
  const ips = [];
  for (const name of names) {
    const ip = execFileSync(
      "docker",
      ["inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", name],
      { cwd: REPO_ROOT, encoding: "utf8" }
    ).trim();
    if (ip) ips.push({ name, ip });
  }
  return ips;
}

function workerPort5432SocketCount(name) {
  const out = execFileSync(
    "docker",
    [
      "exec",
      name,
      "node",
      "-e",
      `const fs = require("node:fs");
       const t4 = fs.readFileSync("/proc/1/net/tcp", "utf8").trim().split("\\n").slice(1);
       const t6 = fs.readFileSync("/proc/1/net/tcp6", "utf8").trim().split("\\n").slice(1);
       console.log([...t4, ...t6].filter((l) => l.includes(":1538 ")).length);`
    ],
    { cwd: REPO_ROOT, encoding: "utf8" }
  ).trim();
  return Number(out);
}

async function main() {
  const tempDir = mkdtempSync(join(tmpdir(), "job-control-chaos-"));
  try {
    composeLive("up", "-d", "--scale", "plate-worker=1", "plate-api", "plate-worker");
    await cleanStackState();

    // =========================================================================
    // Scenario 1: Kill the worker mid-render (billed final render + scene draw)
    // =========================================================================
    log("== Scenario 1: Kill the worker mid-render");
    {
      const scen = "1-kill-worker";
      const t0 = now();
      const { id } = await seedProject({ look: "illus-blueprint", aspect: "16:9", beats: 1, audio: true });
      const balBefore = await tokenBalance();

      const drawRes = await api(`/v1/projects/${id}/plates/draw`, { method: "POST" });
      check(scen, drawRes.status === 202, "POST /plates/draw returns 202");

      const renderRes = await api(`/v1/projects/${id}/render`, { method: "POST", body: {} });
      check(scen, renderRes.status === 202 && Boolean(renderRes.json?.id), "POST /render returns 202", `jobId=${renderRes.json?.id}`);
      const renderJobId = renderRes.json.id;

      // Wait until render_jobs is claimed and actively drawing frames (stage='frames')
      const activeWait = await waitFor(
        "render job claimed and drawing frames",
        async () => {
          const [v] = await variants(id);
          const jr = (await pool.query("SELECT state, stage, attempt FROM app.render_jobs WHERE id = $1", [renderJobId])).rows[0];
          return v?.bundle_digest && jr?.state === "rendering" && jr?.stage === "frames" && jr?.attempt >= 1 ? { v, jr } : false;
        },
        { timeout: 120_000, every: 300 }
      );
      const initialAttempt = activeWait.value.jr.attempt;
      const expectedAttemptAfterKill = initialAttempt + 1;
      const timeToMidRenderMs = activeWait.ms;

      log("Killing plate-worker mid-render...");
      composeLive("kill", "plate-worker");
      await sleep(2000);
      composeLive("up", "-d", "plate-worker");

      // Wait for pg-boss lease expiry + retry and completion of the billed render job
      const doneWait = await waitFor(
        "restarted worker completes billed render job on next attempt",
        async () => {
          const r = await api(`/v1/render-jobs/${renderJobId}`);
          if (r.json?.state === "failed") {
            throw new Error(`Render job failed after worker kill: ${JSON.stringify(r.json?.error)}`);
          }
          return r.json?.state === "ready" ? r.json : false;
        },
        { timeout: 300_000, every: 1000 }
      );
      const totalRecoveryMs = now() - t0;

      const [finalVar] = await variants(id);
      const cachedClipRow = (
        await pool.query("SELECT * FROM app.plate_clips WHERE bundle_digest = $1 AND size = '1920x1080'", [finalVar.bundle_digest])
      ).rows[0];
      const finalJobRow = (await pool.query("SELECT * FROM app.render_jobs WHERE id = $1", [renderJobId])).rows[0];
      const spendRows = (
        await pool.query(
          "SELECT * FROM app.token_ledger WHERE user_id = $1 AND kind = 'spend' AND ref LIKE $2",
          [OWNER, `render:${renderJobId}|%`]
        )
      ).rows;
      const projectSpendRows = (
        await pool.query(
          "SELECT * FROM app.token_ledger WHERE user_id = $1 AND kind = 'spend' AND project_id = $2",
          [OWNER, id]
        )
      ).rows;
      const finishedMsgCount = (
        await pool.query("SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'render-finished' AND data->>'jobId' = $1", [renderJobId])
      ).rows[0].n;

      check(
        scen,
        Boolean(cachedClipRow?.clip_key) && cachedClipRow.frames === finalVar.frames,
        "scene clip drawn and recorded in app.plate_clips by restarted worker",
        `bundle_digest=${finalVar.bundle_digest?.slice(0, 12)}, clip_key=${cachedClipRow?.clip_key}`
      );
      check(
        scen,
        finalJobRow.state === "ready" &&
          finalJobRow.attempt === expectedAttemptAfterKill &&
          finalJobRow.output?.key === `renders/${renderJobId}/a${expectedAttemptAfterKill}.mp4`,
        "billed render job completed on next attempt with renders/<id>/a<attempt>.mp4",
        `state=${finalJobRow.state}, attempt=${finalJobRow.attempt}, key=${finalJobRow.output?.key}`
      );
      check(
        scen,
        finishedMsgCount === 1,
        "render-finished message queued once (no duplicate publication)",
        `finishedMsgCount=${finishedMsgCount}`
      );
      check(
        scen,
        spendRows.length === 1 && projectSpendRows.length === 1 && Number(spendRows[0].amount) < 0,
        "no double charge for billed final render (1 spend entry in token_ledger)",
        `spendRows=${spendRows.length}, projectSpendRows=${projectSpendRows.length}, amount=${spendRows[0]?.amount}, ref=${spendRows[0]?.ref}`
      );

      const redir = await redirectOf(`/v1/renders/${renderJobId}`);
      const mp4File = await download(redir.location, join(tempDir, "chaos-1.mp4"));
      const probe = ffprobe(mp4File);
      const vStream = probe.streams.find((s) => s.codec_type === "video");
      check(
        scen,
        redir.status === 302 && vStream?.width === 1920 && vStream?.height === 1080 && Number(vStream?.nb_read_packets) === finalVar.frames,
        "downloaded MP4 after worker kill/retry is valid 1920x1080",
        `frames=${vStream?.nb_read_packets}`
      );

      results.push({
        scenario: "1. Kill the worker mid-render",
        pass: true,
        timeToMidRenderMs,
        totalRecoveryMs,
        sceneAttempt: finalVar.render_attempt,
        renderJobAttempt: finalJobRow.attempt,
        spendEvents: spendRows.length
      });
    }

    // =========================================================================
    // Scenario 2: Cut the control link (docker pause plate-api for 20 s)
    // =========================================================================
    log("== Scenario 2: Cut the control link (pause plate-api for 20 s)");
    {
      const scen = "2-cut-control-link";
      await cleanStackState();
      const t0 = now();
      const { id } = await seedProject({ look: "illus-blueprint", aspect: "16:9", beats: 1, audio: false });
      await api(`/v1/projects/${id}/plates/draw`, { method: "POST" });

      const bundledWait = await waitFor(
        "variant bundled",
        async () => {
          const [v] = await variants(id);
          return v?.state === "bundled" ? v : false;
        },
        { timeout: 60_000, every: 300 }
      );
      const v0 = bundledWait.value;

      // Request clip so worker claims the lease and begins rendering
      const reqRes = await api(`/v1/projects/${id}/plates/${v0.id}/clip-request`, { method: "POST" });
      check(scen, reqRes.status === 202, "POST /clip-request returns 202");

      await waitFor(
        "worker holds lease and is rendering scene",
        async () => {
          const [v] = await variants(id);
          return v?.state === "rendering" && v?.render_attempt === 1 ? v : false;
        },
        { timeout: 60_000, every: 250 }
      );

      const tPauseStart = now();
      log("Pausing plate-api for 20 seconds while worker holds lease...");
      execFileSync("docker", ["pause", "videosaas-local-plate-api-1"], { cwd: REPO_ROOT });
      try {
        await sleep(20_000);
      } finally {
        execFileSync("docker", ["unpause", "videosaas-local-plate-api-1"], { cwd: REPO_ROOT });
      }
      const pauseDurationMs = now() - tPauseStart;
      log(`Resumed plate-api after ${pauseDurationMs} ms`);

      const drawnWait = await waitFor(
        "scene finishes drawing after control link resumes",
        async () => {
          const [v] = await variants(id);
          return v?.state === "drawn" && v?.clip_key ? v : false;
        },
        { timeout: 180_000, every: 1000 }
      );
      const totalMs = now() - t0;
      const finalVar = drawnWait.value;

      const jobRows = (
        await pool.query(
          "SELECT state, retry_count FROM pgboss.job WHERE name = 'plate-render' AND data->>'variantId' = $1 ORDER BY created_on DESC",
          [v0.id]
        )
      ).rows;

      check(
        scen,
        pauseDurationMs >= 19_500 && pauseDurationMs < 23_000,
        "control link was cut for 20 seconds",
        `pauseDurationMs=${pauseDurationMs}`
      );
      check(
        scen,
        finalVar.state === "drawn" && Boolean(finalVar.clip_key) && finalVar.render_attempt === 1,
        "lease was kept across 20 s outage, nothing published twice (render_attempt=1)",
        `render_attempt=${finalVar.render_attempt}, clip_key=${finalVar.clip_key}`
      );
      await waitFor(
        "plate-render job marked completed in pgboss",
        async () => {
          const r = (
            await pool.query("SELECT state FROM pgboss.job WHERE name = 'plate-render' AND data->>'variantId' = $1", [v0.id])
          ).rows[0];
          return r?.state === "completed";
        },
        { timeout: 15_000, every: 300 }
      );
      check(scen, true, "pg-boss job state is 'completed'", `jobs=${JSON.stringify(jobRows)}`);

      results.push({
        scenario: "2. Cut the control link (20 s pause)",
        pass: true,
        pauseDurationMs,
        totalMs,
        renderAttempt: finalVar.render_attempt
      });
    }

    // =========================================================================
    // Scenario 3: Restart the API during a long poll and during a finish call
    // =========================================================================
    log("== Scenario 3: Restart the API during a long poll and during a finish call");
    {
      const scen = "3-restart-api";
      await cleanStackState();

      // 3a: Restart plate-api while plate-worker is holding an idle long poll
      await sleep(1500); // ensure plate-worker is parked in /internal/worker/poll
      const tRestart0 = now();
      composeLive("restart", "plate-api");
      await waitForApiReady("plate-api ready after restart during long poll");
      const apiRestartMs = now() - tRestart0;

      // Seed a project and verify the existing worker (without restarting plate-worker) reconnects its poll and claims work
      const { id } = await seedProject({ look: "illus-fox", aspect: "16:9", beats: 1, audio: false });
      await api(`/v1/projects/${id}/plates/draw`, { method: "POST" });
      const bWait = await waitFor(
        "variant bundled after API restart",
        async () => {
          const [v] = await variants(id);
          return v?.state === "bundled" ? v : false;
        },
        { timeout: 60_000, every: 300 }
      );
      const tClaim0 = now();
      await api(`/v1/projects/${id}/plates/${bWait.value.id}/clip-request`, { method: "POST" });
      const reconnectClaimWait = await waitFor(
        "worker reconnected after broken long poll and claimed job",
        async () => {
          const [v] = await variants(id);
          return v?.state === "rendering" || v?.state === "drawn" ? v : false;
        },
        { timeout: 30_000, every: 250 }
      );
      const workerReconnectClaimMs = now() - tClaim0;
      check(
        scen,
        Boolean(reconnectClaimWait.value),
        "worker reconnected after API restart broke its long poll and claimed new job",
        `apiRestartMs=${apiRestartMs}ms, workerReconnectClaimMs=${workerReconnectClaimMs}ms`
      );

      // Clean up the scene job so we can test 3b deterministically
      await pool.query("DELETE FROM pgboss.job WHERE name = 'plate-render'");
      await pool.query("DELETE FROM app.plate_variants WHERE project_id = $1", [id]);

      // 3b: Lost answer + API restart during a finish call (`render.finish` and `plate.drawn`)
      const rJobId = randomUUID();
      await pool.query(
        `INSERT INTO app.render_jobs (id, project_id, state, stage, progress, attempt, request, revision, render_input, render_queued_at)
         VALUES ($1, $2, 'rendering', 'encoding', 95, 1, '{}', '{}', '{"template":"x"}', now())`,
        [rJobId, id]
      );

      let droppedFirstAnswer = false;
      const lossyControl = createControl({
        url: API,
        token: CONTROL_TOKEN,
        fetchImpl: async (url, init) => {
          const res = await fetch(url, init);
          if (!droppedFirstAnswer && String(url).endsWith("/op/render.finish")) {
            droppedFirstAnswer = true;
            // Drain body so server committed, then simulate API restart / dropped connection before worker gets the reply
            await res.text();
            throw new TypeError("terminated: simulated API restart during finish response");
          }
          return res;
        }
      });

      const tFinishRetry0 = now();
      const finishOut = await lossyControl.op("render.finish", {
        jobId: rJobId,
        attempt: 1,
        outcome: { output: { key: `renders/${rJobId}/a1.mp4`, format: "mp4" } }
      });
      const finishRetryMs = now() - tFinishRetry0;

      // Also restart plate-api and send render.finish once more after restart
      composeLive("restart", "plate-api");
      await waitForApiReady("plate-api ready after second restart");
      const postRestartFinish = await lossyControl.op("render.finish", {
        jobId: rJobId,
        attempt: 1,
        outcome: { output: { key: `renders/${rJobId}/a1.mp4`, format: "mp4" } }
      });

      const storedJob = (await pool.query("SELECT state, attempt, output FROM app.render_jobs WHERE id = $1", [rJobId])).rows[0];
      const finishedJobs = (
        await pool.query("SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'render-finished' AND data->>'jobId' = $1", [rJobId])
      ).rows[0].n;

      check(
        scen,
        droppedFirstAnswer && finishOut.committed === true && finishOut.duplicate === true,
        "finish whose first answer was lost retries and returns {committed:true, duplicate:true}",
        `finishRetryMs=${finishRetryMs}ms, response=${JSON.stringify(finishOut)}`
      );
      check(
        scen,
        postRestartFinish.committed === true &&
          postRestartFinish.duplicate === true &&
          storedJob.state === "ready" &&
          storedJob.output?.key === `renders/${rJobId}/a1.mp4` &&
          finishedJobs === 1,
        "after API restart, retry still returns duplicate:true, output stays the worker's, and render-finished is queued once",
        `output=${JSON.stringify(storedJob.output)}, finishedJobs=${finishedJobs}`
      );

      results.push({
        scenario: "3. Restart API during long poll & finish call",
        pass: true,
        apiRestartMs,
        workerReconnectClaimMs,
        finishRetryMs
      });
    }

    // =========================================================================
    // Scenario 4: Duplicate completion (finish twice, and finish from stale attempt)
    // =========================================================================
    log("== Scenario 4: Duplicate completion and stale attempt fencing");
    {
      const scen = "4-duplicate-completion";
      const t0 = now();
      const ctrl = createControl({ url: API, token: CONTROL_TOKEN });

      // Test on both render_jobs (render.finish) and plate_variants (plate.drawn)
      const rJobId = randomUUID();
      const projId = randomUUID();
      await pool.query(
        `INSERT INTO app.render_jobs (id, project_id, state, stage, progress, attempt, request, revision, render_input, render_queued_at)
         VALUES ($1, $2, 'rendering', 'frames', 50, 0, '{}', '{}', '{"template":"x"}', now())`,
        [rJobId, projId]
      );

      const claim1 = await ctrl.op("render.claim", { jobId: rJobId, attempt: 1 }, { retry: false });
      const claim2 = await ctrl.op("render.claim", { jobId: rJobId, attempt: 2 }, { retry: false });
      check(scen, Boolean(claim1.input) && Boolean(claim2.input), "attempt 1 claimed then superseded by attempt 2");

      // Stale attempt 1 sends finish before attempt 2 finishes
      const staleBefore = await ctrl.op("render.finish", {
        jobId: rJobId,
        attempt: 1,
        outcome: { output: { key: `renders/${rJobId}/a1-stale.mp4`, format: "mp4" } }
      });
      check(
        scen,
        staleBefore.committed === false && !staleBefore.duplicate,
        "finish from stale attempt 1 before commit is rejected ({committed:false})",
        JSON.stringify(staleBefore)
      );

      // Current attempt 2 sends finish twice
      const commit2First = await ctrl.op("render.finish", {
        jobId: rJobId,
        attempt: 2,
        outcome: { output: { key: `renders/${rJobId}/a2-winner.mp4`, format: "mp4" } }
      });
      const commit2Second = await ctrl.op("render.finish", {
        jobId: rJobId,
        attempt: 2,
        outcome: { output: { key: `renders/${rJobId}/a2-winner.mp4`, format: "mp4" } }
      });
      // Stale attempt 1 sends finish again after attempt 2 committed
      const staleAfter = await ctrl.op("render.finish", {
        jobId: rJobId,
        attempt: 1,
        outcome: { output: { key: `renders/${rJobId}/a1-stale.mp4`, format: "mp4" } }
      });

      const rowAfter = (await pool.query("SELECT state, attempt, output FROM app.render_jobs WHERE id = $1", [rJobId])).rows[0];
      const finishedCount = (
        await pool.query("SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'render-finished' AND data->>'jobId' = $1", [rJobId])
      ).rows[0].n;

      check(
        scen,
        commit2First.committed === true && !commit2First.duplicate,
        "first finish from current attempt 2 commits ({committed:true})",
        JSON.stringify(commit2First)
      );
      check(
        scen,
        commit2Second.committed === true && commit2Second.duplicate === true,
        "second finish from current attempt 2 is idempotent ({committed:true, duplicate:true})",
        JSON.stringify(commit2Second)
      );
      check(
        scen,
        staleAfter.committed === false &&
          rowAfter.state === "ready" &&
          rowAfter.attempt === 2 &&
          rowAfter.output?.key === `renders/${rJobId}/a2-winner.mp4` &&
          finishedCount === 1,
        "only current attempt 2 committed; output is a2-winner.mp4 and render-finished count is 1",
        `output=${JSON.stringify(rowAfter.output)}, finishedCount=${finishedCount}`
      );

      // Also verify plate.drawn duplicate + stale attempt fencing
      const varId = randomUUID();
      await pool.query(
        `INSERT INTO app.plate_variants (id, project_id, scene_index, aspect, signature, gen, keyword, frames, fps, width, height, state, render_attempt)
         VALUES ($1, $2, 0, '16:9', 'v3:dup', 1, 'k0', 90, 30, 1920, 1080, 'rendering', 2)`,
        [varId, projId]
      );
      const stalePlate = await ctrl.op("plate.drawn", {
        id: varId,
        gen: 1,
        renderAttempt: 1,
        clipKey: "stale-a1.mp4",
        stillKey: "stale-a1.png",
        clipMeta: {},
        timings: {}
      });
      const winPlate1 = await ctrl.op("plate.drawn", {
        id: varId,
        gen: 1,
        renderAttempt: 2,
        clipKey: "winner-a2.mp4",
        stillKey: "winner-a2.png",
        clipMeta: { attempt: 2 },
        timings: {}
      });
      const winPlate2 = await ctrl.op("plate.drawn", {
        id: varId,
        gen: 1,
        renderAttempt: 2,
        clipKey: "winner-a2.mp4",
        stillKey: "winner-a2.png",
        clipMeta: { attempt: 2 },
        timings: {}
      });
      const varRow = (await pool.query("SELECT state, render_attempt, clip_key FROM app.plate_variants WHERE id = $1", [varId])).rows[0];
      check(
        scen,
        stalePlate.ok === false &&
          winPlate1.ok === true &&
          !winPlate1.duplicate &&
          winPlate2.ok === true &&
          winPlate2.duplicate === true &&
          varRow.clip_key === "winner-a2.mp4",
        "plate.drawn rejects stale attempt 1, commits attempt 2 once, and answers duplicate:true on repeat",
        `clip_key=${varRow.clip_key}`
      );

      const elapsedMs = now() - t0;
      results.push({
        scenario: "4. Duplicate completion & stale attempt",
        pass: true,
        elapsedMs
      });
    }

    // =========================================================================
    // Scenario 5: Many waiting workers (6 worker containers, 10 scenes from 2 projects)
    // =========================================================================
    log("== Scenario 5: Many waiting workers (6 containers, 10 scenes from 2 projects)");
    {
      const scen = "5-six-workers";
      await cleanStackState();

      const tScale0 = now();
      composeLive("up", "-d", "--scale", "plate-worker=6", "plate-worker");
      await sleep(4000);

      const containers = workerContainerNames();
      const workerIps = workerContainerIps(containers);
      check(
        scen,
        containers.length === 6 && workerIps.length === 6,
        "6 plate-worker containers are running",
        containers.join(", ")
      );

      // Seed 2 projects with 5 beats each (10 scenes total) in clip mode so all 10 scenes queue plate-render jobs across the 6 workers
      const pA = await seedProject({ look: "illus-fox", aspect: "16:9", beats: 5, audio: false, name: "chaos-6w-A" });
      const pB = await seedProject({ look: "illus-balloon", aspect: "16:9", beats: 5, audio: false, name: "chaos-6w-B" });
      await pool.query(
        "INSERT INTO app.plate_state (project_id, live_mode, live_mode_set_at) VALUES ($1, 'clip', now()), ($2, 'clip', now()) ON CONFLICT (project_id) DO UPDATE SET live_mode = 'clip'",
        [pA.id, pB.id]
      );

      const tRun0 = now();
      await Promise.all([
        api(`/v1/projects/${pA.id}/plates/draw`, { method: "POST" }),
        api(`/v1/projects/${pB.id}/plates/draw`, { method: "POST" })
      ]);

      await waitFor(
        "10 variants created across 2 projects",
        async () => {
          const vA = await variants(pA.id);
          const vB = await variants(pB.id);
          return vA.length === 5 && vB.length === 5;
        },
        { timeout: 30_000, every: 300 }
      );

      const ipList = workerIps.map((w) => w.ip);
      let maxWorkerDbConns = 0;
      let maxApiDbConns = 0;
      let maxWorkerContainerSockets5432 = 0;
      let samples = 0;

      const allTenDrawn = await waitFor(
        "all 10 scenes across 2 projects drawn by 6 workers",
        async () => {
          samples++;
          const statRes = await pool.query(
            `SELECT client_addr::text AS ip, application_name, state
               FROM pg_stat_activity
              WHERE datname = 'plates_e2e' AND pid <> pg_backend_pid()`
          );
          const workerConns = statRes.rows.filter((r) => r.ip && ipList.some((wip) => r.ip.startsWith(wip))).length;
          // Exclude host-side test runner connections (which come from the Docker bridge gateway 172.x.0.1)
          const apiConns = statRes.rows.filter((r) => r.ip && !r.ip.endsWith(".0.1")).length;
          if (workerConns > maxWorkerDbConns) maxWorkerDbConns = workerConns;
          if (apiConns > maxApiDbConns) maxApiDbConns = apiConns;

          if (samples === 1 || samples % 8 === 0) {
            for (const cName of containers) {
              const sc = workerPort5432SocketCount(cName);
              if (sc > maxWorkerContainerSockets5432) maxWorkerContainerSockets5432 = sc;
            }
          }

          const [vA, vB] = await Promise.all([variants(pA.id), variants(pB.id)]);
          const all = [...vA, ...vB];
          const drawnCount = all.filter((r) => r.state === "drawn" && r.clip_key).length;
          if (samples % 5 === 0) {
            log(`progress: ${drawnCount}/10 drawn, workerDbConns=${workerConns}, apiDbConns=${apiConns}`);
          }
          return drawnCount === 10 ? all : false;
        },
        { timeout: 600_000, every: 2000 }
      );
      const totalDrawMs = now() - tRun0;
      const rows = allTenDrawn.value;
      const distinctWorkers = [...new Set(rows.map((r) => r.clip_meta?.worker).filter(Boolean))];

      check(
        scen,
        rows.length === 10 && rows.every((r) => r.state === "drawn" && Boolean(r.clip_key)),
        "all 10 scenes across 2 projects completed to 'drawn'",
        `in ${totalDrawMs}ms across ${distinctWorkers.length} worker containers (${distinctWorkers.join(", ")})`
      );
      check(
        scen,
        rows.every((r) => r.render_attempt === 1),
        "every scene completed exactly once (render_attempt === 1 on all 10 scenes)",
        `attempts=${rows.map((r) => r.render_attempt).join(",")}`
      );
      check(
        scen,
        maxWorkerDbConns === 0 && maxWorkerContainerSockets5432 === 0,
        "total Postgres client connections from the 6 workers stayed at ZERO",
        `maxWorkerDbConns=${maxWorkerDbConns}, maxWorkerContainerSockets5432=${maxWorkerContainerSockets5432}, samples=${samples}`
      );
      check(
        scen,
        maxApiDbConns <= 14,
        "API's own Postgres connections stayed within its pool budget (pool 10 + pg-boss 4 = 14)",
        `maxApiDbConns=${maxApiDbConns}`
      );

      // Scale back to 1 worker container
      composeLive("up", "-d", "--scale", "plate-worker=1", "plate-worker");

      results.push({
        scenario: "5. Many waiting workers (6 containers, 10 scenes)",
        pass: true,
        totalDrawMs,
        distinctWorkersCount: distinctWorkers.length,
        maxWorkerDbConns,
        maxWorkerContainerSockets5432,
        maxApiDbConns,
        samples
      });
    }

    // =========================================================================
    // Scenario 6: HyperFrames render through job control
    // =========================================================================
    log("== Scenario 6: HyperFrames render through job control");
    {
      const scen = "6-hyperframes-render";
      await cleanStackState();

      // Seed a non-plate HyperFrames project (look='clean', 3 kinetic beats) from developer's DB template
      const local = new (await import("pg")).default.Pool({
        connectionString: "postgres://videosaas:videosaas@localhost:55432/videosaas"
      });
      const { rows } = await local.query("SELECT data FROM app.projects WHERE id = $1", [
        "58059549-16ed-4c21-93f9-4739976c8e4a"
      ]);
      await local.end();

      const data = rows[0].data;
      const hfId = randomUUID();
      data.id = hfId;
      data.ownerId = OWNER;
      data.name = "Chaos 6 HyperFrames Render";
      data.state = "Draft";
      delete data.renderJobId;
      delete data.planAudio;
      delete data.brief.brandId;
      if (data.request) delete data.request.brandId;
      data.brief.look = "clean";
      data.brief.audio = { mode: "none" };
      data.brief.durationSeconds = 9;
      data.beatPlan.beats = data.beatPlan.beats.slice(0, 3).map((b, i) => ({
        ...b,
        id: `b${i + 1}`,
        role: i === 0 ? "hook" : i === 1 ? "problem" : "cta",
        kind: "kinetic",
        producer: "hyperframes"
      }));
      data.beatPlan.target_duration_s = 9;
      data.beatPlan.audio = { captions: "full" };

      await pool.query("INSERT INTO app.projects (id, owner_id, name, state, data) VALUES ($1, $2, $3, $4, $5)", [
        hfId,
        OWNER,
        data.name,
        data.state,
        data
      ]);

      const tHf0 = now();
      const renderRes = await api(`/v1/projects/${hfId}/render`, { method: "POST", body: {} });
      check(
        scen,
        renderRes.status === 202 && Boolean(renderRes.json?.id),
        "POST /v1/projects/:id/render for non-plate HyperFrames project returns 202",
        `jobId=${renderRes.json?.id}`
      );
      const jobId = renderRes.json.id;

      let sawFramesProgress = false;
      const readyWait = await waitFor(
        "HyperFrames render job ready through job control",
        async () => {
          const r = await api(`/v1/render-jobs/${jobId}`);
          if (r.json?.stage === "frames" && r.json?.progress > 50) {
            sawFramesProgress = true;
          }
          if (r.json?.state === "failed") {
            throw new Error(`HyperFrames render failed: ${JSON.stringify(r.json?.error)}`);
          }
          return r.json?.state === "ready" ? r.json : false;
        },
        { timeout: 180_000, every: 1000 }
      );
      const hfRenderMs = now() - tHf0;

      const workerSockets = workerPort5432SocketCount("videosaas-local-plate-worker-1");
      const redir = await redirectOf(`/v1/renders/${jobId}`);
      check(scen, redir.status === 302 && Boolean(redir.location), "GET /v1/renders/:id redirects (302) to finished MP4");

      const mp4File = await download(redir.location, join(tempDir, "chaos-6-hyperframes.mp4"));
      const probe = ffprobe(mp4File);
      const vStream = probe.streams.find((s) => s.codec_type === "video");

      const expectedFrames = Math.round(Number(readyWait.value.output?.durationSeconds ?? 0) * 30);
      check(
        scen,
        readyWait.value.state === "ready" &&
          sawFramesProgress &&
          vStream?.width === 1920 &&
          vStream?.height === 1080 &&
          expectedFrames > 0 &&
          Number(vStream?.nb_read_packets) === expectedFrames &&
          workerSockets === 0,
        "HyperFrames project rendered to valid 1920x1080 MP4 with worker holding 0 DB connections",
        `in ${hfRenderMs}ms, size=${vStream?.width}x${vStream?.height}, frames=${vStream?.nb_read_packets}/${expectedFrames}, workerSockets5432=${workerSockets}`
      );

      results.push({
        scenario: "6. HyperFrames render through job control",
        pass: true,
        hfRenderMs,
        frames: Number(vStream?.nb_read_packets),
        width: vStream?.width,
        height: vStream?.height,
        workerSockets5432: workerSockets
      });
    }

    console.log(`\nCHAOS SUMMARY: ${assertions.length}/${assertions.length} assertions passed across 6 scenarios.`);
    console.log("CHAOS_RESULTS_JSON:" + JSON.stringify(results));
  } finally {
    composeLive("up", "-d", "--scale", "plate-worker=1", "plate-worker");
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    await pool.end().catch(() => {});
  }
}

await main();
