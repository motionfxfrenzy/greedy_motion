// Real-route test for motion-blur handling on plate vs HyperFrames films (POST /v1/projects/:id/render in src/server.ts):
//   (a) plate film over 20 s (7 scenes at 3 s floor = 21 s) with { motionBlur: true } -> 202, charged renderCostMillitokens(21), one spend
//   (b) the same 21 s plate film with { motionBlur: false } and with the field absent -> 202 (unchanged)
//   (c)/(n) HyperFrames/non-plate film over 20 s with { motionBlur: true } -> 400 motion_blur_too_long (0 spend)
//   (d) non-plate and plate film under 20 s with { motionBlur: true } -> 202
//   (e) malformed motionBlur value ("yes") on a plate film -> 400 invalid_request; no beatPlan -> 400 motion_blur_unavailable
//   (f) plate project whose saved state already carries motionBlur=true submits fine (202) and plate-film render_input does not carry motionBlur
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit_blur_test PLANNER=deterministic node --experimental-strip-types test/plate-motion-blur.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
process.env.PLATE_PIPELINE = "worker";
if (!/plates_unit|plates_rebundle|test/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Point DATABASE_URL at a throwaway database (name containing plates_unit or test).");
}

const backendDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function findFreePort() {
  return new Promise((resolvePort, rejectPort) => {
    const srv = createNetServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close((err) => (err ? rejectPort(err) : resolvePort(port)));
    });
    srv.on("error", rejectPort);
  });
}

// Hermetic local S3 server for manifest & project uploads
const s3Store = new Map();
const s3Server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const key = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (req.method === "HEAD") {
    const entry = s3Store.get(key);
    if (!entry) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-length": String(entry.bytes.length), "content-type": entry.contentType });
    res.end();
    return;
  }
  if (req.method === "PUT") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const bytes = Buffer.concat(chunks);
    s3Store.set(key, { bytes, contentType: req.headers["content-type"] ?? "application/octet-stream" });
    res.writeHead(200, { ETag: `"${createHash("md5").update(bytes).digest("hex")}"` });
    res.end();
    return;
  }
  if (req.method === "GET") {
    const entry = s3Store.get(key);
    if (!entry) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-length": String(entry.bytes.length), "content-type": entry.contentType });
    res.end(entry.bytes);
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((resolve) => s3Server.listen(0, "127.0.0.1", resolve));
const s3Port = s3Server.address().port;

process.env.STORAGE_DRIVER = "r2";
process.env.R2_ENDPOINT = `http://127.0.0.1:${s3Port}`;
process.env.R2_FORCE_PATH_STYLE = "1";
process.env.R2_ACCESS_KEY_ID = "test-key";
process.env.R2_SECRET_ACCESS_KEY = "test-secret";
process.env.R2_UPLOADS_BUCKET = "test-uploads";
process.env.R2_OUTPUTS_BUCKET = "test-outputs";

const { LOCAL_USER_ID } = await import("../src/config.ts");
const { migrate, pool } = await import("../src/db/database.ts");
const { boss, startQueues } = await import("../src/jobs/queues.ts");
const { planReadiness } = await import("../src/plan/readiness.ts");
const platesInputs = await import("../src/plates/inputs.ts");
const store = await import("../src/plates/store.ts");
const { renderCostMillitokens } = await import("../src/tokens/plan.ts");
const { grantTokens, tokenSummary } = await import("../src/tokens/store.ts");

await migrate();
await startQueues();

const apiPort = await findFreePort();
const tempDir = await mkdtemp(join(tmpdir(), "plate-motion-blur-"));
const serverProc = spawn(process.execPath, ["--experimental-strip-types", "src/server.ts"], {
  cwd: backendDir,
  env: {
    ...process.env,
    PORT: String(apiPort),
    HOST: "127.0.0.1",
    APP_ENV: "local",
    AUTH_MODE: "none",
    PLANNER: "deterministic",
    PLATE_PIPELINE: "worker",
    STORAGE_DRIVER: "r2",
    R2_ENDPOINT: `http://127.0.0.1:${s3Port}`,
    R2_FORCE_PATH_STYLE: "1",
    R2_ACCESS_KEY_ID: "test-key",
    R2_SECRET_ACCESS_KEY: "test-secret",
    R2_UPLOADS_BUCKET: "test-uploads",
    R2_OUTPUTS_BUCKET: "test-outputs",
    AUDIO_DIR: join(tempDir, "audio"),
    PROJECTS_DIR: join(tempDir, "projects"),
    BRANDS_DIR: join(tempDir, "brands"),
    RENDER_OUTPUT_DIR: join(tempDir, "renders"),
    LOG_LEVEL: "error"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

const apiBase = `http://127.0.0.1:${apiPort}`;
for (let i = 0; ; i++) {
  const ok = await fetch(`${apiBase}/healthz`).then((r) => r.ok, () => false);
  if (ok) break;
  if (i > 60) {
    serverProc.kill("SIGTERM");
    throw new Error("Real server.ts did not become healthy in time");
  }
  await new Promise((r) => setTimeout(r, 250));
}

const USER = LOCAL_USER_ID;
const createdProjects = [];

function buildProjectData(
  id,
  {
    look = "illus-blueprint",
    scriptBeatCount = 7,
    targetDuration = 15,
    includeBeatPlan = true,
    extraData = {}
  } = {}
) {
  const scriptBeats = Array.from({ length: scriptBeatCount }, (_, i) => ({
    id: `b${i + 1}`,
    keyword: `Scene ${i + 1} mark`,
    visual: `Visual description for scene ${i + 1}`,
    onScreen: `Scene ${i + 1}`,
    line: `Evening keeper lights harbour lamp ${i + 1}.`
  }));

  const beats = scriptBeats.map((b, i) => ({
    id: b.id,
    role: i === 0 ? "hook" : i === scriptBeatCount - 1 ? "cta" : "step",
    kind: "kinetic",
    producer: "hyperframes",
    line: null,
    verb: null,
    keyword: b.keyword,
    on_screen: b.onScreen,
    visual: b.visual,
    success: i === scriptBeatCount - 1,
    energy: "medium",
    motion: {
      camera: "steady push",
      entry: { axis: "x", dir: -1 },
      exit: { axis: "x", dir: -1 },
      text_effect: "fade-up"
    },
    sfx: null,
    scene: null,
    transition_out: { type: i === scriptBeatCount - 1 ? "end" : "cut-the-curve", carrier: null }
  }));

  return {
    id,
    ownerId: USER,
    name: `Motion Blur Test (${look}, ${scriptBeatCount} scenes)`,
    state: "Draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    request: {
      prompt: "Explain how coastal lighthouses guide ships safely into port at night.",
      template: "product-launch",
      style: "kinetic",
      theme: "neutral",
      format: "landscape"
    },
    screenshots: [],
    comments: [],
    brief: {
      scriptMode: "own",
      text: scriptBeats.map((b) => b.line).join(" "),
      look,
      aspect: "16:9",
      aspects: ["16:9"],
      motionProfile: "smooth",
      pace: "normal",
      captions: "none",
      audio: { mode: "none", voice: "Kore" },
      durationSeconds: targetDuration,
      template: null,
      theme: "neutral",
      videoType: "explainer",
      productName: "HarbourLight",
      scriptBeats
    },
    ...(includeBeatPlan
      ? {
          beatPlan: {
            version: "1.0",
            mode: "own-script",
            template: null,
            format: "explainer",
            canvas: "16:9",
            target_duration_s: targetDuration,
            clock: " beats ",
            brand: { name: "HarbourLight", motion_profile: "smooth", style_frame: null },
            characters: [],
            beats,
            audio: {
              voice: null,
              music: null,
              captions: "none"
            },
            approvals: ["script", "storyboard", "motion-preview"],
            suggestions: [],
            estimate: { generated_shots: 0, api_usd: 0.05, render_s: targetDuration }
          }
        }
      : {}),
    ...extraData
  };
}

async function seedBundledVariants(project) {
  const desired = await platesInputs.desiredVariants(project, ["16:9"]);
  await store.reconcileVariants(project.id, desired, { scenes: desired.length });
  for (const v of await store.listVariants(project.id)) {
    const ow = store.newOwner();
    await store.claimAuthor(v.id, v.gen, ow, 60, 10);
    const bundleHtml = `<!doctype html><html><body>scene ${v.scene_index}</body></html>`;
    const bundleBytes = Buffer.from(bundleHtml, "utf8");
    const bundleSha = createHash("sha256").update(bundleBytes).digest("hex");
    const bundleKey = `plates/${project.id}/16x9/${v.scene_index}/g1/bundle.html`;
    const sourceKey = `plates/${project.id}/16x9/${v.scene_index}/g1/source.ts`;
    s3Store.set(bundleKey, { bytes: bundleBytes, contentType: "text/html" });
    await store.commitBundle(v, ow, {
      sourceKey,
      bundleKey,
      manifest: { bundleSha, engineDigest: "eng-blur-test", frames: v.frames },
      timings: {}
    });
  }
}

async function seedProject(opts = {}) {
  const id = randomUUID();
  createdProjects.push(id);
  const data = buildProjectData(id, opts);
  await pool.query("insert into app.projects (id, owner_id, name, state, data) values ($1, $2, $3, $4, $5)", [
    id,
    USER,
    data.name,
    data.state,
    data
  ]);
  if (opts.includeBeatPlan !== false && platesInputs.isPlateLook(data.brief?.look)) {
    await seedBundledVariants(data);
  }
  return { id, data };
}

async function postRender(projectId, body) {
  const res = await fetch(`${apiBase}/v1/projects/${projectId}/render`, {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function spendForJob(jobId) {
  const res = await pool.query(
    "select coalesce(sum(-amount), 0)::int as milli, count(distinct split_part(ref, '|', 1))::int as events from app.token_ledger where user_id = $1 and kind = 'spend' and ref like $2",
    [USER, `render:${jobId}|%`]
  );
  return { milli: res.rows[0].milli, events: res.rows[0].events };
}

async function waitForRenderInput(jobId, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await pool.query("select state, render_input, error from app.render_jobs where id = $1", [jobId]);
    const row = res.rows[0];
    if (row?.render_input) return row;
    if (row?.state === "failed") throw new Error(`Job ${jobId} failed during planning: ${JSON.stringify(row.error)}`);
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error(`Timed out waiting for render_input on job ${jobId}`);
}

try {
  await pool.query("delete from app.token_ledger where user_id = $1", [USER]);
  await grantTokens(USER, 500, "test pack", "system", "plate-motion-blur-test-grant", "pack");

  // =========================================================================
  // (a) Plate film over 20 s (7 scenes at 3 s floor = 21 s) + { motionBlur: true } -> 202, charged renderCostMillitokens(21), 1 spend
  // =========================================================================
  const plateOver20 = await seedProject({ look: "illus-blueprint", scriptBeatCount: 7, targetDuration: 15 });
  assert.equal(planReadiness(plateOver20.data).durationSeconds, 21, "7-scene plate film is 21 s (> 20 s)");

  const resA = await postRender(plateOver20.id, { motionBlur: true });
  assert.equal(resA.status, 202, `(a) 21 s plate film with motionBlur: true must return 202 (got ${resA.status}: ${JSON.stringify(resA.body)})`);
  const spendA = await spendForJob(resA.body.id);
  assert.equal(spendA.events, 1, "(a) exactly one spend event recorded");
  assert.equal(spendA.milli, renderCostMillitokens(21), `(a) charged renderCostMillitokens(21) = ${renderCostMillitokens(21)} millitokens`);

  // =========================================================================
  // (b) Same 21 s plate film with { motionBlur: false } and with field absent -> 202 (unchanged)
  // =========================================================================
  const resBFalse = await postRender(plateOver20.id, { motionBlur: false });
  assert.equal(resBFalse.status, 202, "(b) 21 s plate film with motionBlur: false returns 202");
  const spendBFalse = await spendForJob(resBFalse.body.id);
  assert.equal(spendBFalse.events, 1);
  assert.equal(spendBFalse.milli, renderCostMillitokens(21));

  const resBAbsent = await postRender(plateOver20.id, {});
  assert.equal(resBAbsent.status, 202, "(b) 21 s plate film with motionBlur absent returns 202");
  const spendBAbsent = await spendForJob(resBAbsent.body.id);
  assert.equal(spendBAbsent.events, 1);
  assert.equal(spendBAbsent.milli, renderCostMillitokens(21));

  // =========================================================================
  // (c) & (n) HyperFrames/non-plate film over 20 s with { motionBlur: true } -> 400 motion_blur_too_long
  // =========================================================================
  const hfOver20 = await seedProject({ look: "clean", scriptBeatCount: 7, targetDuration: 21 });
  const hfOver20Sec = planReadiness(hfOver20.data).durationSeconds;
  assert.ok(hfOver20Sec !== null && hfOver20Sec > 20, `non-plate film is over 20 s (${hfOver20Sec} s)`);
  const balBeforeHfRefusal = (await tokenSummary(USER)).remaining;

  const resC = await postRender(hfOver20.id, { motionBlur: true });
  assert.equal(resC.status, 400, "(c)/(n) HyperFrames film over 20 s with motionBlur: true is refused with 400");
  assert.equal(resC.body?.error?.code, "motion_blur_too_long");
  assert.match(resC.body?.error?.message ?? "", /up to 20 seconds/);
  assert.equal((await tokenSummary(USER)).remaining, balBeforeHfRefusal, "refused HyperFrames render spends 0 tokens");

  // =========================================================================
  // (d) Non-plate and plate film under 20 s with { motionBlur: true } -> 202
  // =========================================================================
  const hfUnder20 = await seedProject({ look: "clean", scriptBeatCount: 5, targetDuration: 15 });
  assert.ok((planReadiness(hfUnder20.data).durationSeconds ?? 0) <= 20);
  const resDHf = await postRender(hfUnder20.id, { motionBlur: true });
  assert.equal(resDHf.status, 202, "(d) non-plate film under 20 s with motionBlur: true returns 202");
  const hfRow = await waitForRenderInput(resDHf.body.id);
  assert.equal(hfRow.render_input.kind, "beat-plan");
  assert.equal(hfRow.render_input.motionBlur, true, "non-plate job carries motionBlur: true in render_input");

  const plateUnder20 = await seedProject({ look: "illus-blueprint", scriptBeatCount: 6, targetDuration: 12 });
  assert.equal(planReadiness(plateUnder20.data).durationSeconds, 18);
  const resDPlate = await postRender(plateUnder20.id, { motionBlur: true });
  assert.equal(resDPlate.status, 202, "(d) plate film under 20 s with motionBlur: true returns 202");

  // =========================================================================
  // (e) Malformed motionBlur value ("yes") on a plate film -> still 400 invalid_request; no beatPlan -> 400 motion_blur_unavailable
  // =========================================================================
  const resEBad = await postRender(plateOver20.id, { motionBlur: "yes" });
  assert.equal(resEBad.status, 400, "(e) malformed motionBlur on a plate film returns 400");
  assert.equal(resEBad.body?.error?.code, "invalid_request");
  assert.equal(resEBad.body?.error?.message, "`motionBlur` must be true or false.");

  const plateNoPlan = await seedProject({ look: "illus-blueprint", scriptBeatCount: 7, targetDuration: 15, includeBeatPlan: false });
  const resENoPlan = await postRender(plateNoPlan.id, { motionBlur: true });
  assert.equal(resENoPlan.status, 400, "(e) plate project without beatPlan + motionBlur: true returns 400 motion_blur_unavailable");
  assert.equal(resENoPlan.body?.error?.code, "motion_blur_unavailable");

  // =========================================================================
  // (f) Plate project whose saved state already carries motionBlur=true submits fine; plate job input does not carry blur
  // =========================================================================
  const plateSavedBlur = await seedProject({
    look: "illus-blueprint",
    scriptBeatCount: 7,
    targetDuration: 15,
    extraData: { motionBlur: true }
  });
  const resF = await postRender(plateSavedBlur.id, { motionBlur: true });
  assert.equal(resF.status, 202, "(f) plate project with saved motionBlur=true over 20 s submits fine (202)");
  const plateRow = await waitForRenderInput(resF.body.id);
  assert.equal(plateRow.render_input.kind, "plate-film");
  assert.equal("motionBlur" in plateRow.render_input, false, "(f) plate-film render_input does not carry motionBlur");
  assert.equal(plateRow.render_input.durationSeconds, 21);

  console.log("plate motion blur: ok");
} finally {
  serverProc.kill("SIGTERM");
  await new Promise((resolve) => serverProc.once("exit", resolve));
  await pool.query("delete from app.token_ledger where user_id = $1", [USER]).catch(() => undefined);
  await pool.query("delete from app.render_jobs where project_id = any($1)", [createdProjects]).catch(() => undefined);
  await pool.query("delete from app.plate_exports where project_id = any($1)", [createdProjects]).catch(() => undefined);
  await pool.query("delete from app.plate_variants where project_id = any($1)", [createdProjects]).catch(() => undefined);
  await pool.query("delete from app.plate_garbage where project_id = any($1)", [createdProjects]).catch(() => undefined);
  await pool.query("delete from app.plate_state where project_id = any($1)", [createdProjects]).catch(() => undefined);
  await pool.query("delete from app.projects where id = any($1)", [createdProjects]).catch(() => undefined);
  await pool.query("delete from pgboss.job where name in ('plate-author', 'plate-render', 'plate-export', 'render-plan', 'render-video', 'render-finished')").catch(() => undefined);
  await boss.stop({ graceful: false }).catch(() => undefined);
  await pool.end().catch(() => undefined);
  await new Promise((resolve) => s3Server.close(resolve));
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
}
