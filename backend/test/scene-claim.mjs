// Scene claim: a silent drawing is reclaimed on redelivery (attempt raised), a live one is not, and concurrent claims respect the project cap.
// Run: node --env-file=.env test/scene-claim.mjs   (needs DATABASE_URL)
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.env.APP_ENV ??= "local";
const { migrate, pool } = await import("../src/db/database.ts");
const { createProject } = await import("../src/projects/store.ts");
const { claim } = await import("../../worker/src/scenes.mjs");
await migrate();
const owner = randomUUID();
const project = await createProject({ name: "scene claim test", request: { prompt: "A scene claim test film", format: "landscape", style: "kinetic" } }, owner);
const add = async (state, idx, ageSeconds = 0) => {
  const id = randomUUID();
  await pool.query("insert into app.scene_clips(id, project_id, signature, scene_index, state, attempt, frames_total, render_input, updated_at) values ($1, $2, $3, $4, $5, 1, 30, '{}', now() - make_interval(secs => $6))", [id, project.id, `claim-test-${id}`, idx, state, ageSeconds]);
  return id;
};
try {
  const dead = await add("drawing", 0, 600);
  assert.equal(await claim(pool, dead, false), null, "a plain delivery does not take a drawing clip");
  const taken = await claim(pool, dead, true);
  assert.equal(taken?.attempt, 2, "a redelivery reclaims a silent drawing clip with a higher attempt");
  const live = await add("drawing", 1, 0);
  assert.equal(await claim(pool, live, true), null, "a clip with recent progress is left to its worker");

  await pool.query("delete from app.scene_clips where project_id = $1", [project.id]);
  const queued = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => add("queued", i)));
  const results = await Promise.all(queued.map((id) => claim(pool, id)));
  assert.equal(results.filter(Boolean).length, 3, "six concurrent claims admit exactly the cap of three");
  console.log("scene claim: ok");
} finally {
  await pool.query("delete from app.scene_clips where project_id = $1", [project.id]);
  await pool.query("delete from app.projects where id = $1", [project.id]);
  await pool.end();
}
