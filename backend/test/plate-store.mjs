// Plate pipeline state machine against a real Postgres + pg-boss: atomic claims, generation fencing, supersession,
// transactional enqueue, retry-from-bundle, recovery of lost messages, competing workers.
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node backend/test/plate-store.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertThrowawayDb } from "./support/throwaway-db.mjs";
process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
assertThrowawayDb();
const { migrate, pool } = await import("../src/db/database.ts");
const { boss, startQueues } = await import("../src/jobs/queues.ts");
const store = await import("../src/plates/store.ts");
const { reconcilePlates } = await import("../src/plates/reconcile.ts");
const { operations } = await import("../src/jobs/control.ts");
// The worker claims through job control; here the same operation runs in-process.
const claimVariant = async (_pool, variantId, gen) => (await operations["plate.claim"]({ variantId, gen })).row;
await migrate();
await startQueues();

const project = randomUUID();
const seenVariants = new Set();
const msgs = async (name, id) => Number((await pool.query("select count(*) n from pgboss.job where name = $1 and data->>'variantId' = $2", [name, id])).rows[0].n);
const desired = (sigOf = (i) => `v3:s${i}`) => [0, 1, 2].flatMap((index) => ["16:9", "9:16"].map((aspect) => ({ index, aspect, signature: `${sigOf(index)}-${aspect}`, frames: 90, width: aspect === "16:9" ? 1920 : 1080, height: aspect === "16:9" ? 1080 : 1920, keyword: `k${index}` })));
const rows = async () => { const list = await store.listVariants(project); for (const r of list) seenVariants.add(r.id); return list; };
const find = async (index, aspect) => (await rows()).find((r) => r.scene_index === index && r.aspect === aspect);
try {
  // --- create once, never twice
  await store.reconcileVariants(project, desired(), { scenes: 3 });
  assert.equal((await rows()).length, 6);
  for (const r of await rows()) assert.equal(await msgs("plate-author", r.id), 1, "row and message committed together");
  await store.reconcileVariants(project, desired(), { scenes: 3 });
  for (const r of await rows()) assert.equal(await msgs("plate-author", r.id), 1, "an unchanged storyboard queues nothing");

  // --- one scene changes: only its variants are superseded
  const before = await rows();
  await store.reconcileVariants(project, desired((i) => (i === 1 ? "v3:changed" : `v3:s${i}`)), { scenes: 3 });
  const after = await rows();
  for (const r of after) {
    const was = before.find((b) => b.id === r.id);
    assert.equal(r.gen, r.scene_index === 1 ? was.gen + 1 : was.gen, `scene ${r.scene_index} ${r.aspect} generation`);
  }
  assert.equal(Number((await pool.query("select count(*) n from app.plate_garbage where project_id = $1", [project])).rows[0].n), 2, "the superseded generations are scheduled for cleanup");
  const v = await find(0, "16:9");

  // --- atomic authoring claim: four racers, one winner
  const owners = [1, 2, 3, 4].map(() => store.newOwner());
  const got = await Promise.all(owners.map((o) => store.claimAuthor(v.id, v.gen, o, 60, 10)));
  assert.equal(got.filter(Boolean).length, 1, "exactly one authoring owner");
  const winner = owners[got.findIndex(Boolean)];
  assert.equal(await store.claimAuthor(v.id, v.gen + 1, store.newOwner(), 60, 10), null, "a wrong generation claims nothing");
  // the owner dies: its lease lapses and another takes over; the dead one can no longer publish
  await pool.query("update app.plate_variants set author_until = now() - interval '1 minute' where id = $1", [v.id]);
  const second = store.newOwner();
  assert.ok(await store.claimAuthor(v.id, v.gen, second, 60, 10), "an expired lease is taken over");
  const art = { sourceKey: `plates/${project}/x/source.ts`, bundleKey: `plates/${project}/x/bundle.html`, manifest: { a: 1 }, timings: {} };
  assert.equal(await store.commitBundle(v, winner, art), false, "the stale owner cannot publish");
  assert.equal(await msgs("plate-render", v.id), 0);
  assert.equal(await store.commitBundle(v, second, art), true);
  assert.equal(await msgs("plate-render", v.id), 1, "publishing the bundle queues the worker in the same transaction");
  assert.equal((await find(0, "16:9")).state, "bundled");

  // --- per-project authoring cap
  const queued = (await rows()).filter((r) => r.state === "queued").slice(0, 4);
  const capped = await Promise.all(queued.map((r) => store.claimAuthor(r.id, r.gen, store.newOwner(), 60, 2)));
  assert.equal(capped.filter(Boolean).length, 2, "four concurrent claims admit exactly the cap of two");

  // --- competing workers; stale takeover; fenced publication
  const a = await Promise.all([claimVariant(pool, v.id, v.gen), claimVariant(pool, v.id, v.gen)]);
  assert.equal(a.filter(Boolean).length, 1, "two workers, one scene: one wins");
  const first = a.find(Boolean);
  assert.equal(first.render_attempt, 1);
  await pool.query("update app.plate_variants set updated_at = now() - interval '10 minutes' where id = $1", [v.id]);
  const taken = await claimVariant(pool, v.id, v.gen);
  assert.equal(taken.render_attempt, 2, "a silent attempt is taken over with a higher attempt");
  const publish = (attempt) => pool.query("update app.plate_variants set state = 'drawn', clip_key = $3, updated_at = now() where id = $1 and gen = $2 and render_attempt = $4 and state = 'rendering'", [v.id, v.gen, `plates/${project}/clip-a${attempt}.mp4`, attempt]);
  assert.equal((await publish(1)).rowCount, 0, "the stale worker cannot publish over the newer attempt");
  // a rewrite of the same scene (inputs changed) while attempt 2 is still running
  await store.reconcileVariants(project, desired((i) => (i === 0 ? "v3:new0" : i === 1 ? "v3:changed" : `v3:s${i}`)), { scenes: 3 });
  assert.equal((await publish(2)).rowCount, 0, "an older revision's render cannot publish over the new inputs");
  const reset = await find(0, "16:9");
  assert.equal(reset.state, "queued"); assert.equal(reset.clip_key, null);

  // --- a failed scene is retried from its saved bundle: no second model call
  await pool.query("update app.plate_variants set state = 'failed', bundle_key = $2, authored = 1, error = '{\"message\":\"x\"}' where id = $1", [reset.id, `plates/${project}/b.html`]);
  await store.reconcileVariants(project, desired((i) => (i === 0 ? "v3:new0" : i === 1 ? "v3:changed" : `v3:s${i}`)), { scenes: 3 });
  const retried = await find(0, "16:9");
  assert.equal(retried.state, "bundled"); assert.equal(retried.authored, 1, "authoring is not repeated");
  assert.equal(await msgs("plate-render", retried.id) >= 1, true);

  // --- comments revise in place: same inputs, new generation and revision
  await pool.query("update app.plate_variants set state = 'drawn', source_key = 's', clip_key = 'c' where id = $1", [retried.id]);
  assert.equal(await store.reviseScene(project, 0, "- at 1.0 s: bigger lantern"), 1);
  const revised = await find(0, "16:9");
  assert.equal(revised.rev, 1); assert.equal(revised.gen, retried.gen + 1); assert.equal(revised.signature, retried.signature);
  assert.equal(revised.revise.notes.includes("bigger lantern"), true); assert.equal(revised.revise.codeKey, "s");

  // --- a lost message is recovered by the reconciler
  const lostRow = await find(2, "9:16");
  await pool.query("delete from pgboss.job where name = 'plate-author' and data->>'variantId' = $1", [lostRow.id]);
  await pool.query("update app.plate_variants set enqueued_at = now() - interval '10 minutes' where id = $1", [lostRow.id]);
  assert.equal(await msgs("plate-author", lostRow.id), 0);
  await reconcilePlates();
  assert.equal(await msgs("plate-author", lostRow.id), 1, "the reconciler re-sends what the queue lost");
  await reconcilePlates();
  assert.equal(await msgs("plate-author", lostRow.id), 1, "and only once");

  // --- storyboard shrinks: rows beyond it go
  await store.reconcileVariants(project, desired().filter((d) => d.index < 2), { scenes: 2 });
  assert.equal((await rows()).filter((r) => r.scene_index >= 2).length, 0);
  console.log("plate store: ok");
} finally {
  await pool.query("delete from pgboss.job where name like 'plate-%' and data->>'variantId' = any($1)", [[...seenVariants]]);
  await pool.query("delete from app.plate_variants where project_id = $1", [project]);
  await pool.query("delete from app.plate_garbage where project_id = $1", [project]);
  await pool.query("delete from app.plate_state where project_id = $1", [project]);
  await boss.stop({ graceful: false }).catch(() => undefined);
  await pool.end();
}
