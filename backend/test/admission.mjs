// Per-user limit on films queued or running at once (render/admission.ts), counting jobs owned directly and via the user's projects.
// Run: node --env-file=.env test/admission.mjs   (needs DATABASE_URL)
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.env.APP_ENV ??= "local";
process.env.RENDER_MAX_ACTIVE_PER_USER = "3";
const { migrate, pool } = await import("../src/db/database.ts");
const { createProject } = await import("../src/projects/store.ts");
const { busyRefusal, activeRenders, chargeRender, returnCharge } = await import("../src/render/admission.ts");
const { grantTokens, tokenSummary } = await import("../src/tokens/store.ts");
const { InsufficientTokens } = await import("../src/tokens/store.ts");
await migrate();
const USER = "00000000-0000-4000-8000-0000000a0401", OTHER = "00000000-0000-4000-8000-0000000a0402";
const ids = [];
const project = await createProject({ name: "admission test", request: { prompt: "An admission limit test film", format: "landscape", style: "kinetic" } }, USER);
const job = async (state, { owner = null, projectId = null } = {}) => {
  const id = randomUUID();
  ids.push(id);
  await pool.query(`insert into app.render_jobs (id, project_id, owner_id, state, stage, progress, request, revision) values ($1, $2, $3, $4, 'waiting', 0, '{}', '{"id":"t","title":"t","scenes":[]}')`, [id, projectId, owner, state]);
};
try {
  assert.equal(await busyRefusal(USER), null, "no jobs: allowed");
  await job("rendering", { projectId: project.id });
  await job("queued", { owner: USER });
  await job("ready", { owner: USER });
  await job("failed", { projectId: project.id });
  assert.equal(await activeRenders(USER), 2, "finished jobs do not count; project jobs and owned jobs do");
  assert.equal(await busyRefusal(USER), null, "two of three: allowed");
  await job("planning", { projectId: project.id });
  const refusal = await busyRefusal(USER);
  assert.equal(refusal?.error.code, "too_many_renders");
  assert.deepEqual([refusal.error.active, refusal.error.limit], [3, 3]);
  assert.equal(await busyRefusal(OTHER), null, "another person is not affected");

  // Pro and format films are charged at the storyboard rate (10 s = 9 tokens), returned when they cannot be queued, and refused when unaffordable.
  const PAYER = "00000000-0000-4000-8000-0000000a0403";
  await pool.query("delete from app.token_ledger where user_id = $1", [PAYER]);
  await grantTokens(PAYER, 10, "admission test", "cli:test", "order:admission-test", "pack");
  const start = (await tokenSummary(PAYER)).remaining;
  const film = randomUUID();
  const spend = await chargeRender(PAYER, 10, film);
  assert.equal(spend.charged, true);
  assert.equal((await tokenSummary(PAYER)).remaining, start - 9, "10 s costs 6 + 3 = 9 tokens");
  assert.equal((await chargeRender(PAYER, 10, film)).charged, false, "the same film is charged once");
  await returnCharge(PAYER, spend);
  assert.equal((await tokenSummary(PAYER)).remaining, start, "a film that could not be queued gets its tokens back");
  await assert.rejects(() => chargeRender(PAYER, 60, randomUUID()), InsufficientTokens);
  await pool.query("delete from app.token_ledger where user_id = $1", [PAYER]);
  console.log("admission: ok");
} finally {
  await pool.query("delete from app.render_jobs where id = any($1)", [ids]);
  await pool.query("delete from app.projects where id = $1", [project.id]);
  await pool.end();
}
