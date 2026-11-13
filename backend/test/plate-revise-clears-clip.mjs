// A comment redraw (reviseScene) must drop the scene's old clip. If it kept `clip_key`, the new code would sit on
// `bundled / checking` with the old mp4 attached, and both fallbacks for a check that never reports would be off:
// the check-grace sweep requires `clip_key is null` and the browser's 3-minute timer skips scenes that have a clip.
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node backend/test/plate-revise-clears-clip.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertThrowawayDb } from "./support/throwaway-db.mjs";
process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
assertThrowawayDb();
const { migrate, pool } = await import("../src/db/database.ts");
const { boss, startQueues } = await import("../src/jobs/queues.ts");
const store = await import("../src/plates/store.ts");
await migrate();
await startQueues();

const project = randomUUID();
const seen = new Set();
const desired = [{ index: 0, aspect: "16:9", signature: "v1:s0-16:9", keyword: "lantern", frames: 90, width: 1920, height: 1080 }];
try {
  await store.reconcileVariants(project, desired, { scenes: 1 });
  const [row] = await store.listVariants(project);
  seen.add(row.id);
  // The scene was drawn once: it has source, bundle and an mp4 clip with its still and metadata.
  await pool.query(
    `update app.plate_variants
        set state = 'drawn', source_key = 's', bundle_key = 'b', bundle_digest = 'old-digest',
            clip_key = 'outputs/old.mp4', still_key = 'outputs/old.jpg', clip_meta = '{"fps":30}'::jsonb
      where id = $1`,
    [row.id]
  );

  assert.equal(await store.reviseScene(project, 0, "- at 1.0 s: make the sun bigger"), 1);
  const [revised] = await store.listVariants(project);
  assert.equal(revised.gen, row.gen + 1, "the redraw is a new generation");
  assert.equal(revised.state, "queued");
  assert.equal(revised.bundle_digest, null, "the old bundle is gone");
  assert.equal(revised.clip_key, null, "the old clip must not stay attached to the new code");
  assert.equal(revised.still_key, null);
  assert.equal(revised.clip_meta, null);
  console.log("plate revise clears clip: ok");
} finally {
  await pool.query("delete from pgboss.job where name like 'plate-%' and data->>'variantId' = any($1)", [[...seen]]);
  await pool.query("delete from app.plate_variants where project_id = $1", [project]);
  await pool.query("delete from app.plate_garbage where project_id = $1", [project]);
  await pool.query("delete from app.plate_state where project_id = $1", [project]);
  await boss.stop({ graceful: false }).catch(() => undefined);
  await pool.end();
}
