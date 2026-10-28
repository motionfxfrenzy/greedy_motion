// Storyboard prep inside the render job, against a real Postgres and the real queues: a film whose preparation fails gets
// its tokens back exactly once, whether it fails at once (project gone, storyboard no longer ready) or after its retry
// (dead letter); a film that already reached the renderer is not refunded when it fails later.
//   DATABASE_URL=postgres://… node test/render-prep.mjs   (cleans up its own rows; takes about 15 s for the retry case)
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (a local Postgres; this test writes to it).");
const { migrate, pool } = await import("../src/db/database.ts");
const { boss, startQueues } = await import("../src/jobs/queues.ts");
const { renderService } = await import("../src/render/service.ts");
const { renderJobRepository } = await import("../src/render/repository.ts");
const { filmInputsHash } = await import("../src/render/revision.ts");
const { createProject, getProject } = await import("../src/projects/store.ts");
const { grantTokens, spendTokens, tokenSummary } = await import("../src/tokens/store.ts");
await migrate();
await startQueues();
await renderService.startConsumers();

const U = "00000000-0000-4000-8000-0000000f0101";
const COST = 2500; // 10 s of film
const projects = [];
const jobs = [];
const balance = async () => (await tokenSummary(U)).remaining;
const clean = async () => {
  await pool.query("delete from app.token_ledger where user_id = $1", [U]);
  await pool.query("delete from app.render_jobs where id = any($1)", [jobs]);
  await pool.query("delete from app.projects where id = any($1)", [projects]);
};

/** A project with a storyboard as stored, written straight to the row so a broken plan can be stored too. */
async function project(beatPlan) {
  const created = await createProject({ name: "render-prep test", request: { prompt: "A render prep test project", format: "landscape", style: "kinetic" } }, U);
  await pool.query("update app.projects set data = data || $2::jsonb where id = $1", [created.id, JSON.stringify({ beatPlan, brief: { audio: { mode: "none" } } })]);
  projects.push(created.id);
  return created.id;
}

/** What POST /render does for a storyboard film: take the tokens, then queue the job with its prep. */
async function render(projectId, revisionHash) {
  const id = randomUUID();
  jobs.push(id);
  const spend = await spendTokens(U, COST, "render", id, projectId);
  await renderJobRepository.createAndEnqueue(
    { id, state: "queued", progress: 0, createdAt: new Date().toISOString(), revision: { id: randomUUID(), title: "test", scenes: [] } },
    { request: { prompt: "A render prep test project", format: "landscape", style: "kinetic" }, projectId, prep: { kind: "beat-plan", watermark: false, motionBlur: false, ownerId: U, spendEvent: spend.event, ...(revisionHash ? { revisionHash } : {}) } }
  );
  return id;
}

async function finished(id, ms = 45_000) {
  const until = Date.now() + ms;
  for (;;) {
    const row = await renderJobRepository.row(id);
    if (row && ["ready", "failed"].includes(row.state)) return row;
    if (Date.now() > until) throw new Error(`job ${id} still ${row?.state}/${row?.stage} after ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

await clean();
try {
  await grantTokens(U, 20, "test pack", "cli:test", "order:render-prep", "pack");
  const start = await balance();

  // The project was deleted after Render: fails at once, tokens back.
  const gone = await render(randomUUID());
  assert.equal(await balance(), start - 2.5, "Render takes the tokens");
  let row = await finished(gone);
  assert.equal(row.state, "failed");
  assert.match(row.error.message, /no longer has a storyboard/);
  assert.equal(await balance(), start, "a film that could not be prepared gets its tokens back");

  // The storyboard stopped passing its checks after Render: fails at once with the reason, tokens back.
  const notReady = await render(await project({ beats: [], target_duration_s: 30, canvas: "1920x1080", audio: {} }));
  row = await finished(notReady);
  assert.deepEqual([row.state, row.error.code], ["failed", "not_ready"]);
  assert.match(row.error.message, /at least three beats/);
  assert.equal(await balance(), start, "not ready: tokens back");

  // The storyboard was edited after Render (the charged revision no longer matches): stops before any work, tokens back.
  const editedId = await project({ beats: [], target_duration_s: 30, canvas: "1920x1080", audio: {} });
  const chargedHash = filmInputsHash(await getProject(editedId));
  await pool.query("update app.projects set data = jsonb_set(data, '{beatPlan,target_duration_s}', '45') where id = $1", [editedId]);
  const edited = await render(editedId, chargedHash);
  row = await finished(edited);
  assert.deepEqual([row.state, row.error.code], ["failed", "revision_changed"]);
  assert.equal(await balance(), start, "an edit after Render returns the tokens");
  // Bookkeeping that is not film input (state, render pointer) does not change the revision.
  const before = filmInputsHash(await getProject(editedId));
  await pool.query("update app.projects set data = data || '{\"state\":\"Rendering draft\",\"renderJobId\":\"00000000-0000-4000-8000-000000000001\"}'::jsonb where id = $1", [editedId]);
  assert.equal(filmInputsHash(await getProject(editedId)), before, "state and render pointer are not film inputs");

  // An unexpected error: one retry, then the dead letter fails the job and returns the tokens.
  const broken = await render(await project({ target_duration_s: 30 }));
  row = await finished(broken);
  assert.equal(row.state, "failed");
  assert.match(row.error.message, /Your tokens were returned/);
  const attempts = await pool.query("select retry_count from pgboss.job where name = 'render-plan' and data->>'jobId' = $1", [broken]);
  assert.equal(attempts.rows[0]?.retry_count, 1, "the planning queue retried once before giving up");
  assert.equal(await balance(), start, "dead letter: tokens back");

  // A second dead-letter delivery changes nothing and refunds nothing.
  await renderService["failForGood"](broken, { code: "planning_failed", message: "again" }, true);
  assert.equal(await balance(), start, "refunded once, not twice");

  // A film that reached the render queue and then failed in the worker keeps its charge (the existing render rule).
  // (Written straight to the row: no queue message, so no consumer or worker touches it.)
  const rendered = randomUUID();
  jobs.push(rendered);
  const spend = await spendTokens(U, COST, "render", rendered);
  await pool.query(
    `insert into app.render_jobs (id, state, stage, progress, request, revision, prep, render_queued_at) values ($1, 'rendering', 'frames', 60, '{}', '{"id":"t","title":"t","scenes":[]}', $2, now())`,
    [rendered, { kind: "beat-plan", watermark: false, motionBlur: false, ownerId: U, spendEvent: spend.event }]
  );
  await renderService["failForGood"](rendered, { code: "render_failed", message: "worker failed" }, false);
  assert.equal((await renderJobRepository.row(rendered)).state, "failed");
  assert.equal(await balance(), start - 2.5, "no refund once the film reached the renderer");

  console.log("render prep: ok (failed prep refunds once: project gone, not ready, dead letter; rendered films keep their charge)");
} finally {
  await clean();
  await boss.stop({ graceful: false }).catch(() => undefined);
  await pool.end();
}
