// Per-user limit on films queued or running at once (render/admission.ts), counting jobs owned directly and via the user's projects.
// Run: node --env-file=.env test/admission.mjs   (needs DATABASE_URL)
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.env.APP_ENV ??= "local";
process.env.RENDER_MAX_ACTIVE_PER_USER = "3";
const { migrate, pool } = await import("../src/db/database.ts");
const { createProject } = await import("../src/projects/store.ts");
const { busyRefusal, activeRenders } = await import("../src/render/admission.ts");
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
  console.log("admission: ok");
} finally {
  await pool.query("delete from app.render_jobs where id = any($1)", [ids]);
  await pool.query("delete from app.projects where id = $1", [project.id]);
  await pool.end();
}
