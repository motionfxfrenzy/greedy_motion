// "Recreate animation": the backend discards the generated animation and bills every scene again, exactly once.
// Covers:
//   1. quoteAnimationStep({ recreate }) prices every scene as new work even when all scene motion is cached,
//      and a normal quote of the same project still reuses it (0 scenes to author).
//   2. Charging: one Recreate debits once and a client retry with the same recreateId does not double-charge, while a
//      later Recreate (new recreateId, identical scenes) is charged again instead of matching the settled reservation.
//   3. discardProjectAnimation drops the directed scene motion (HyperFrames) and the Pro Editor copy, keeps the storyboard,
//      its reference frames and the voiceover/music.
//   4. discardPlateVariants drops every drawn plate scene of every ratio and the review comments, so the next reconcile
//      authors each scene from scratch (new rows at generation 1); other projects are untouched.
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_recreate_test node --experimental-strip-types backend/test/animation-recreate.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertThrowawayDb } from "./support/throwaway-db.mjs";
process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
assertThrowawayDb();
const prevEnv = process.env.BILLING_POLICY_VERSION;
process.env.BILLING_POLICY_VERSION = "v2_step_tier";
const { migrate, pool, query } = await import("../src/db/database.ts");
const { scriptFrameKey } = await import("@videosaas/contracts");
const { grantTokens, tokenSummary } = await import("../src/tokens/store.ts");
const { quoteAnimationStep, reserveStepTokens, settleStepReservation } = await import("../src/billing/step-billing.ts");
const { createProject, deleteProject, getProject, saveFilmMotion, saveScriptFrame, updateProjectPro, discardProjectAnimation } = await import("../src/projects/store.ts");
const plates = await import("../src/plates/store.ts");
const { startQueues } = await import("../src/jobs/queues.ts");

await migrate();
await startQueues();

const owner = randomUUID();
const brief = {
  scriptMode: "problem",
  text: "How does an HTTP request travel across the network and come back with data",
  durationSeconds: 30,
  durationMode: "script",
  aspect: "16:9",
  motionProfile: "smooth",
  pace: "balanced",
  audio: { mode: "music" },
  captions: "full",
  template: null,
  theme: "blue-professional",
  look: "clean"
};
const beats = Array.from({ length: 5 }, (_, i) => ({ id: `b${i + 1}`, keyword: `Hop ${i + 1}`, visual: `Diagram ${i + 1}`, onScreen: `Hop ${i + 1}`, line: `Hop ${i + 1} across the network.` }));
const frames = beats.map((beat) => ({ key: scriptFrameKey(beat, brief), svg: `<svg viewBox="0 0 1920 1080"><rect width="1920" height="1080"/></svg>` }));
const motion = beats.map((_, i) => ({ signature: `sig-${i}`, svg: "<svg/>", motion: [] }));

const project = await createProject(
  { name: "Recreate test", request: { prompt: "A launch video for the new dashboard", format: "landscape", style: "kinetic", theme: "neutral", template: "product-launch" } },
  owner
);
const other = await createProject(
  { name: "Recreate bystander", request: { prompt: "A launch video for the new dashboard", format: "landscape", style: "kinetic", theme: "neutral", template: "product-launch" } },
  owner
);
try {
  await grantTokens(owner, 500, "top-up pack", "test", `pack:${owner}`, "pack");

  // The project as it is once an animation exists: frames sketched, scene motion cached, music made.
  const withAnimation = {
    ...project,
    billingPolicyVersion: "v2_step_tier",
    brief: { ...brief, scriptBeats: beats },
    scriptFrames: frames,
    beatPlan: undefined,
    planAudio: { voice: null, music: { source: "lyria", model: "m", prompt: "p", file: "music.wav", seconds: 30 }, cost_usd: 0, updatedAt: new Date().toISOString() },
    filmMotion: motion
  };
  const quoteOf = (extra = {}) => quoteAnimationStep({ userId: owner, project: withAnimation, brief, beats, tier: "standard", persist: false, ...extra });

  // 1. Quotes
  const normal = await quoteOf();
  assert.equal(normal.scenesToAuthor, 0, "a normal Create reuses the cached scene motion");
  assert.equal(normal.animationCodeQuote.milli, 0, "…and charges nothing for it");
  const recreate = await quoteOf({ recreate: true, recreateId: "recreate-aaaa-1111" });
  assert.equal(recreate.scenesToAuthor, 5, "Recreate authors every scene again");
  assert.equal(recreate.scenesReused, 0);
  assert.equal(recreate.animationCodeQuote.milli, 1000, "5 frame-motion scenes * 200 milli, standard tier");
  assert.equal(recreate.framesQuote.milli, 0, "the storyboard's reference frames are kept, not charged again");
  assert.notEqual(recreate.workFingerprint, normal.workFingerprint);
  const recreateAgain = await quoteOf({ recreate: true, recreateId: "recreate-bbbb-2222" });
  assert.notEqual(recreateAgain.animationCodeQuote.workFingerprint, recreate.animationCodeQuote.workFingerprint, "each Recreate has its own fingerprint");
  const sameRetry = await quoteOf({ recreate: true, recreateId: "recreate-aaaa-1111" });
  assert.equal(sameRetry.animationCodeQuote.workFingerprint, recreate.animationCodeQuote.workFingerprint, "a retry of the same Recreate has the same fingerprint");

  // 2. Charging: once per Recreate
  const reserve = (q) => reserveStepTokens({ userId: owner, projectId: project.id, quote: q.animationCodeQuote, ledgerReason: "animation" });
  const before = (await tokenSummary(owner)).remaining;
  const first = await reserve(recreate);
  assert.equal(first.reusedExisting, false);
  const afterFirst = (await tokenSummary(owner)).remaining;
  assert.equal(Math.round((before - afterFirst) * 100) / 100, 1, "Recreate debits 1.0 token (5 scenes) once");
  const retry = await reserve(sameRetry);
  assert.equal(retry.id, first.id, "a retry with the same recreateId resolves to the same reservation");
  assert.equal((await tokenSummary(owner)).remaining, afterFirst, "…and is not charged twice");
  await settleStepReservation(first.id);
  const second = await reserve(recreateAgain);
  assert.notEqual(second.id, first.id, "a later Recreate with identical scenes does not match the settled reservation");
  assert.equal(Math.round((afterFirst - (await tokenSummary(owner)).remaining) * 100) / 100, 1, "…and is charged again");

  // 3. Project discard
  for (const frame of frames) await saveScriptFrame(project.id, frame);
  await saveFilmMotion(project.id, motion);
  await updateProjectPro(project.id, async () => ({ rev: 3, files: {} }));
  const stored = await getProject(project.id);
  assert.equal(stored.filmMotion.length, 5);
  assert.ok(stored.pro, "Pro copy exists before the discard");
  const discarded = await discardProjectAnimation(project.id);
  assert.deepEqual(discarded.filmMotion, [], "directed scene motion is gone");
  assert.equal(discarded.pro, undefined, "the Pro Editor copy of the old animation is gone");
  assert.equal(discarded.scriptFrames.length, 5, "reference frames stay");
  assert.equal((await getProject(project.id)).filmMotion.length, 0, "the discard is persisted");

  // 4. Plate discard
  const desired = (id) => [0, 1, 2].flatMap((index) => ["16:9", "9:16"].map((aspect) => ({ index, aspect, signature: `${id}:s${index}-${aspect}`, frames: 90, width: aspect === "16:9" ? 1920 : 1080, height: aspect === "16:9" ? 1080 : 1920, keyword: `k${index}` })));
  await plates.reconcileVariants(project.id, desired("a"), { scenes: 3 });
  await plates.reconcileVariants(other.id, desired("b"), { scenes: 3 });
  await pool.query("update app.plate_variants set gen = 4, rev = 2, state = 'checked', bundle_key = 'k', draft_source = 'old' where project_id = $1", [project.id]);
  await plates.editComments(project.id, () => [{ id: "c1", at: 1, scene: 0, sceneAt: 1, body: "make it faster", fixing: 2 }]);
  assert.equal((await plates.listVariants(project.id)).length, 6);
  assert.equal(await plates.discardPlateVariants(project.id), 6);
  assert.equal((await plates.listVariants(project.id)).length, 0, "every drawn scene of every ratio is dropped");
  assert.equal((await plates.readProjectState(project.id)).comments.length, 0, "review comments are cleared with the code they were about");
  assert.equal((await plates.listVariants(other.id)).length, 6, "other projects are untouched");
  assert.equal(Number((await pool.query("select count(*) n from app.plate_garbage where project_id = $1", [project.id])).rows[0].n), 6, "stored artifacts are scheduled for cleanup");
  await plates.reconcileVariants(project.id, desired("a"), { scenes: 3 });
  const redrawn = await plates.listVariants(project.id);
  assert.equal(redrawn.length, 6, "the next reconcile queues every scene again");
  for (const row of redrawn) {
    assert.equal(row.gen, 1, "from scratch: generation 1");
    assert.equal(row.bundle_key, null, "no bundle reused");
    assert.equal(row.draft_source, null, "no saved draft reused");
  }
  assert.equal(await plates.discardPlateVariants(randomUUID()), 0, "nothing to discard is fine");
} finally {
  if (prevEnv === undefined) delete process.env.BILLING_POLICY_VERSION;
  else process.env.BILLING_POLICY_VERSION = prevEnv;
  await deleteProject(project.id).catch(() => undefined);
  await deleteProject(other.id).catch(() => undefined);
  await query("delete from app.plate_variants where project_id = any($1)", [[project.id, other.id]]).catch(() => undefined);
  await query("delete from app.generation_reservations where user_id = $1", [owner]);
  await query("delete from app.generation_quotes where user_id = $1", [owner]);
  await query("delete from app.token_ledger where user_id = $1", [owner]);
}

const { boss } = await import("../src/jobs/queues.ts");
await boss.stop({ graceful: false }).catch(() => undefined);
await pool.end();
console.log("animation-recreate: ok");
