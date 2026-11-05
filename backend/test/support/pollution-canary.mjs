import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { assertThrowawayDb } from "./throwaway-db.mjs";

let lastCanaries = null;

export async function plantCanaries(pool) {
  const projectId = randomUUID();
  const variantId = randomUUID();
  const jobId = randomUUID();
  const plateRenderId = randomUUID();
  const renderVideoId = randomUUID();
  const clipDigest = createHash("sha256").update(`canary-clip-${randomUUID()}`).digest("hex");

  await pool.query(
    `insert into pgboss.job (id, name, data, start_after)
     values ($1, 'plate-render', $2::jsonb, now() + interval '1 day'),
            ($3, 'render-video', $4::jsonb, now() + interval '1 day')`,
    [
      plateRenderId,
      JSON.stringify({ projectId, variantId, gen: 1 }),
      renderVideoId,
      JSON.stringify({ projectId, jobId })
    ]
  );

  await pool.query(
    `insert into app.plate_clips (bundle_digest, engine_digest, font_set_digest, size, width, height, fps, frames, clip_key)
     values ($1, 'canary-engine', 'canary-fonts', '1920x1080', 1920, 1080, 30, 90, $2)`,
    [clipDigest, `plates/${projectId}/canary/clip.mp4`]
  );

  lastCanaries = { projectId, variantId, jobId, plateRenderId, renderVideoId, clipDigest };
  return lastCanaries;
}

export async function checkCanaries(pool, canaries = lastCanaries) {
  assert.ok(canaries, "No canaries planted");
  const jobsRes = await pool.query(
    "select id, name, data from pgboss.job where id = any($1)",
    [[canaries.plateRenderId, canaries.renderVideoId]]
  );
  const byName = new Map(jobsRes.rows.map((r) => [r.name, r]));
  assert.ok(byName.has("plate-render"), `canary pgboss.job 'plate-render' (${canaries.plateRenderId}) must still exist`);
  assert.equal(byName.get("plate-render").data?.projectId, canaries.projectId);
  assert.ok(byName.has("render-video"), `canary pgboss.job 'render-video' (${canaries.renderVideoId}) must still exist`);
  assert.equal(byName.get("render-video").data?.projectId, canaries.projectId);

  const clipRes = await pool.query(
    "select bundle_digest, clip_key from app.plate_clips where bundle_digest = $1",
    [canaries.clipDigest]
  );
  assert.equal(clipRes.rows.length, 1, `canary app.plate_clips row (${canaries.clipDigest}) must still exist`);
  return { ok: true, canaries };
}

export async function removeCanaries(pool, canaries = lastCanaries) {
  if (!canaries) return;
  await pool.query("delete from pgboss.job where id = any($1)", [[canaries.plateRenderId, canaries.renderVideoId]]);
  await pool.query("delete from app.plate_clips where bundle_digest = $1", [canaries.clipDigest]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertThrowawayDb();
  const action = process.argv[2];
  const stateFile = process.argv[3];
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    if (action === "plant") {
      const planted = await plantCanaries(pool);
      if (stateFile) writeFileSync(stateFile, JSON.stringify(planted));
      console.log(`CANARIES_PLANTED projectId=${planted.projectId} clipDigest=${planted.clipDigest.slice(0, 16)}`);
    } else if (action === "check") {
      const planted = stateFile ? JSON.parse(readFileSync(stateFile, "utf8")) : lastCanaries;
      await checkCanaries(pool, planted);
      console.log(`CANARIES_OK projectId=${planted.projectId} clipDigest=${planted.clipDigest.slice(0, 16)}`);
    } else if (action === "clean") {
      const planted = stateFile ? JSON.parse(readFileSync(stateFile, "utf8")) : lastCanaries;
      await removeCanaries(pool, planted);
      console.log("CANARIES_CLEANED");
    } else {
      throw new Error(`Unknown action "${action}" (expected plant | check | clean)`);
    }
  } finally {
    await pool.end();
  }
}
