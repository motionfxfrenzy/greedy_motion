// Plate revisions and garbage sweep protection: revision 0 is written atomically when a variant becomes bundled;
// object prefixes referenced by any row in app.plate_revisions survive sweepGarbage, while unreferenced superseded
// prefixes are swept as before.
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit node --experimental-strip-types test/plate-revisions.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
if (!/plates_unit|test/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Point DATABASE_URL at a throwaway database (name containing plates_unit or test).");
}

const { config } = await import("../src/config.ts");
const { migrate, pool } = await import("../src/db/database.ts");
const { boss, startQueues } = await import("../src/jobs/queues.ts");
const { bundleDigest, paramsDigest } = await import("../src/plates/digest.ts");
const store = await import("../src/plates/store.ts");
const { sweepGarbage } = await import("../src/plates/reconcile.ts");

await migrate();
await startQueues();

const project = randomUUID();
const desired = (sigOf = (i) => `v3:rev-${i}`) =>
  [0, 1].map((index) => ({
    index,
    aspect: "16:9",
    signature: sigOf(index),
    frames: 90,
    width: 1920,
    height: 1080,
    keyword: `k${index}`
  }));

try {
  config.plates.live = true;
  await store.reconcileVariants(project, desired(), { scenes: 2 });
  const [v0, v1] = await store.listVariants(project);

  // --- 1. Revision 0 is written in the same transaction when v0 becomes bundled
  const owner0 = store.newOwner();
  await store.claimAuthor(v0.id, v0.gen, owner0, 60, 10);
  const g1Prefix = store.prefixOf(v0);
  const g1Source = `${g1Prefix}source.ts`;
  const g1Bundle = `${g1Prefix}bundle.html`;
  const manifest0 = { bundleSha: "rev0sha00000000000000000", engineDigest: "eng-rev" };

  assert.equal(
    await store.commitBundle(v0, owner0, {
      sourceKey: g1Source,
      bundleKey: g1Bundle,
      manifest: manifest0,
      timings: { bundleMs: 12 }
    }),
    true
  );

  const bundled0 = await store.getVariant(v0.id);
  const expectedDigest0 = bundleDigest({ manifest: manifest0, params: {} });
  assert.equal(bundled0.bundle_digest, expectedDigest0);

  const revsAfterBundle0 = await store.listRevisions(v0.id);
  assert.equal(revsAfterBundle0.length, 1, "revision 0 written on commitBundle");
  assert.equal(revsAfterBundle0[0].rev, 0);
  assert.equal(revsAfterBundle0[0].bundle_digest, expectedDigest0);
  assert.equal(revsAfterBundle0[0].source_key, g1Source);
  assert.equal(revsAfterBundle0[0].bundle_key, g1Bundle);
  assert.deepEqual(revsAfterBundle0[0].params, {});
  assert.equal(revsAfterBundle0[0].params_digest, paramsDigest({}));

  // --- 2. Revise v0 (puts g1Prefix into plate_garbage, bumps to gen 2 / rev 1) and bundle rev 1
  await store.submitCheckReport(bundled0.id, {
    gen: bundled0.gen,
    bundleDigest: bundled0.bundle_digest,
    host: "worker",
    results: { ok: true }
  });
  assert.equal(await store.reviseScene(project, 0, "- at 1.0 s: warmer lantern"), 1);

  const v0Gen2 = await store.getVariant(v0.id);
  assert.equal(v0Gen2.gen, 2);
  assert.equal(v0Gen2.rev, 1);
  const owner0b = store.newOwner();
  await store.claimAuthor(v0Gen2.id, v0Gen2.gen, owner0b, 60, 10);
  const g2Prefix = store.prefixOf(v0Gen2);
  await store.commitBundle(v0Gen2, owner0b, {
    sourceKey: `${g2Prefix}source.ts`,
    bundleKey: `${g2Prefix}bundle.html`,
    manifest: { bundleSha: "rev1sha00000000000000000", engineDigest: "eng-rev" },
    timings: {}
  });
  const allRevs = await store.listRevisions(v0.id);
  assert.equal(allRevs.length, 2, "both rev 0 and rev 1 are retained in plate_revisions");
  assert.deepEqual(allRevs.map((r) => r.rev), [0, 1]);

  // --- 3. Supersede v1 (never bundled, so no revision in plate_revisions references its g1 prefix)
  const unreferencedPrefix = store.prefixOf(v1);
  await store.reconcileVariants(project, desired((i) => (i === 1 ? "v3:rev-1-changed" : `v3:rev-${i}`)), { scenes: 2 });

  // Make both garbage entries due for sweeping now
  await pool.query("update app.plate_garbage set next_sweep_at = now() - interval '1 minute' where project_id = $1", [project]);
  const garbageBefore = (await pool.query("select prefix, sweeps from app.plate_garbage where project_id = $1 order by prefix", [project])).rows;
  assert.equal(garbageBefore.length, 2, "both g1 prefixes are in plate_garbage");

  // --- 4. Run sweepGarbage: referenced g1Prefix survives, unreferencedPrefix is swept
  const deleted = [];
  const sweptPass1 = await sweepGarbage(20, async (bucket, prefix) => {
    deleted.push(`${bucket}:${prefix}`);
  });
  assert.deepEqual(sweptPass1, [unreferencedPrefix], "only the unreferenced prefix is swept");
  assert.equal(deleted.some((d) => d.includes(g1Prefix)), false, "revision-referenced prefix is never deleted");
  assert.equal(deleted.includes(`uploads:${unreferencedPrefix}`), true);
  assert.equal(deleted.includes(`outputs:${unreferencedPrefix}`), true);

  // Second pass on the unreferenced prefix removes its plate_garbage row while referenced prefix stays untouched
  await pool.query("update app.plate_garbage set next_sweep_at = now() - interval '1 minute' where project_id = $1", [project]);
  const sweptPass2 = await sweepGarbage(20, async (bucket, prefix) => {
    deleted.push(`${bucket}:${prefix}`);
  });
  assert.deepEqual(sweptPass2, [unreferencedPrefix]);

  const remainingGarbage = (await pool.query("select prefix, sweeps from app.plate_garbage where project_id = $1", [project])).rows;
  assert.equal(remainingGarbage.length, 1);
  assert.equal(remainingGarbage[0].prefix, g1Prefix, "referenced prefix remains untouched in plate_garbage with 0 sweeps");
  assert.equal(remainingGarbage[0].sweeps, 0);

  console.log("plate revisions: ok");
} finally {
  config.plates.live = false;
  await pool.query("delete from app.plate_variants where project_id = $1", [project]);
  await pool.query("delete from app.plate_garbage where project_id = $1", [project]);
  await pool.query("delete from app.plate_state where project_id = $1", [project]);
  await pool.query("delete from pgboss.job where name like 'plate-%'");
  await boss.stop({ graceful: false }).catch(() => undefined);
  await pool.end();
}
