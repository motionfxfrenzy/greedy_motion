// Revision-safe plate reconciliation & readiness regression test against real Postgres + pg-boss:
//  1. 7-scene rubber-hose project (all drawn) -> updated to 7-scene folk-tale script/style:
//     - plateStatus (GET /plates) never serves old titles ("A hen wants bread") or old clips/bundles as current;
//       marks all 7 new scenes ("Wren wants fish", etc.) as stale ("Needs update") with drawnAspects=[] and 0 jobs queued.
//     - /clip and /still return 404 for stale scenes; buildExport and waitForAuthoring refuse mixed/stale revisions.
//     - Repeated plateStatus readiness checks enqueue 0 jobs.
//  2. Text/visual-only edit on 1 of 7 scenes (including keyword change):
//     - Unchanged 6 scenes stay drawn/reusable (0 model calls); only the 1 edited scene is marked stale and queued on startPlates.
//  3. Style-only edit (look, styleFamily, non-default styleExample):
//     - Invalidates signatures and marks scenes stale; unrelated subtitle/display edits do not change revision or re-author scenes.
//  4. Reorder, remove, and insert scenes:
//     - Reorder via applyPlanEdits / PATCH /plan syncs scriptBeats and transfers drawn variants across indices with 0 author jobs.
//     - Remove shifts surviving drawn variants down with 0 author jobs.
//     - Insert shifts surviving drawn variants up and queues only the 1 newly inserted scene (1 author job).
//  5. Aspect addition keeps existing aspect drawn and queues only the newly added aspect.
//  6. Late handleAuthor job for a superseded project revision is fenced out before making any model call.
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_unit PLANNER=deterministic node --experimental-strip-types backend/test/plate-revision-reconcile.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { assertThrowawayDb } from "./support/throwaway-db.mjs";

process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
assertThrowawayDb();

const { config } = await import("../src/config.ts");
const { migrate, pool } = await import("../src/db/database.ts");
const { boss, startQueues } = await import("../src/jobs/queues.ts");
const { registerAuth } = await import("../src/auth.ts");
const { registerPlanRoutes, reconcileProjectAfterSceneInsert, reconcileProjectAfterSceneRemove } = await import("../src/plan/routes.ts");
const { registerPlateRoutes } = await import("../src/plates/routes.ts");
const { desiredVariants } = await import("../src/plates/inputs.ts");
const { plateStatus, setPlateSubtitles, startPlates } = await import("../src/plates/service.ts");
const { buildExport, NotDrawn, waitForAuthoring } = await import("../src/plates/exports.ts");
const { handleAuthor } = await import("../src/plates/author.ts");
const { sweepGarbage } = await import("../src/plates/reconcile.ts");
const { getProject, updateProjectPlan } = await import("../src/projects/store.ts");
const store = await import("../src/plates/store.ts");

await migrate();
await startQueues();

const USER = "00000000-0000-4000-8000-000000000000";
const createdProjects = [];

const OLD_RUBBER_HOSE_BEATS = [
  { id: "rh-1", keyword: "A hen wants bread", visual: "A rubber-hose hen eyes a warm loaf of bread.", onScreen: "Bread for eggs?", line: "A little hen wants a loaf of bread." },
  { id: "rh-2", keyword: "Eggs, no thanks", visual: "The baker shakes his head at the basket of eggs.", onScreen: "No eggs today", line: "The baker already has plenty of eggs." },
  { id: "rh-3", keyword: "The long swap", visual: "The hen trades across three market stalls in a row.", onScreen: "Three swaps later", line: "She has to swap with three neighbours first." },
  { id: "rh-4", keyword: "A pretty shell", visual: "Everyone agrees to trade cowrie shells.", onScreen: "Cowrie shells", line: "Then the town picks a shiny shell everyone takes." },
  { id: "rh-5", keyword: "Shell to coin", visual: "Shells give way to stamped brass coins.", onScreen: "Stamped coins", line: "Heavy metal coins last longer than brittle shells." },
  { id: "rh-6", keyword: "Coin to paper", visual: "A vault receipt replaces the heavy sack of coins.", onScreen: "Paper receipts", line: "Paper notes promise the coins are safe in the vault." },
  { id: "rh-7", keyword: "Still warm", visual: "The hen finally enjoys her warm loaf of bread.", onScreen: "Shared trust", line: "And the hen gets her bread while it is still warm." }
];

const NEW_FOLK_TALE_BEATS = [
  { id: "ft-1", keyword: "Wren wants fish", visual: "In the cobbled market square by the well, wren holds out her bread-basket toward tobin's fish-crate.", onScreen: null, line: "Wren wants Tobin's fish." },
  { id: "ft-2", keyword: "Bread for fish", visual: "Wren hands a round loaf across the fish-crate; tobin passes her a silver fish.", onScreen: "The old swap", line: "So she does what everyone in the square does. She swaps a loaf of bread for a fish." },
  { id: "ft-3", keyword: "No more bread", visual: "Tobin sits beside a tall pile of loaves and shakes his head.", onScreen: null, line: "But one morning Tobin's had bread all week. He wants boots, not loaves." },
  { id: "ft-4", keyword: "A string of shells", visual: "Wren lifts a shell-string from her apron; tobin weighs it and smiles.", onScreen: "Shells", line: "So the square picks one thing everyone accepts: shells." },
  { id: "ft-5", keyword: "Little coins", visual: "Small round metal coins clink into tobin's open hand beside the fish-crate.", onScreen: "Metal coins", line: "So they need something rare that lasts. They melt metal into little coins." },
  { id: "ft-6", keyword: "A paper promise", visual: "Wren drops the heavy coin-purse into the strongbox by the well and hands tobin a paper note.", onScreen: "Paper notes", line: "So Wren locks her coins in the square's strongbox and carries a paper note instead." },
  { id: "ft-7", keyword: "Still bread and fish", visual: "Wren and tobin sit on the well's edge sharing a loaf and a fish, the tally-book closed between them.", onScreen: "Crypto & trust", line: "And Wren still gets her fish. Money keeps changing shape." }
];

function makePlanBeats(beats) {
  return beats.map((b, i) => ({
    id: `b${i + 1}`,
    role: i === 0 ? "hook" : i === beats.length - 1 ? "resolution" : "step",
    kind: "kinetic",
    producer: "hyperframes",
    line: b.line,
    verb: null,
    keyword: b.keyword,
    on_screen: b.onScreen,
    success: i === beats.length - 1,
    energy: "calm",
    motion: {
      camera: "slow drift",
      entry: { axis: "x", dir: 1 },
      exit: { axis: "x", dir: -1 },
      text_effect: "waterfall"
    },
    sfx: "pop",
    scene: null,
    transition_out: { type: i === beats.length - 1 ? "end" : "j-cut" }
  }));
}

async function createSeededProject({ look = "illus-rubber-hose", styleExample = `story-${look}`, aspect = "9:16", aspects = ["9:16"], beats = OLD_RUBBER_HOSE_BEATS, text = "how money evolves" } = {}) {
  const id = randomUUID();
  createdProjects.push(id);
  const now = new Date().toISOString();
  const data = {
    id,
    ownerId: USER,
    name: "how money evolves",
    state: "Ready for review",
    createdAt: now,
    updatedAt: now,
    request: { prompt: text, template: "product-launch", style: "clean", theme: "neutral", format: aspect === "9:16" ? "portrait" : "landscape" },
    screenshots: [],
    comments: [],
    brief: {
      scriptMode: "problem",
      text,
      look,
      styleExample,
      aspect,
      aspects,
      motionProfile: "smooth",
      pace: "calm",
      captions: "key-phrases",
      audio: { mode: "both", voice: "Kore" },
      durationSeconds: 30,
      durationMode: "script",
      keepOverLength: true,
      template: null,
      theme: "neutral",
      scriptBeats: structuredClone(beats)
    },
    beatPlan: {
      version: "1.0",
      mode: "problem-only",
      template: null,
      format: "explainer",
      canvas: aspect,
      target_duration_s: 30,
      duration_mode: "script",
      clock: "voiceover",
      brand: { name: "", motion_profile: "smooth", style_frame: null },
      characters: [],
      beats: makePlanBeats(beats),
      audio: {
        voice: { engine: "gemini-tts", voice: "Kore", speed: 1, direction: "warm" },
        music: { source: "lyria", prompt: "warm score", bpm: 100 },
        captions: "key-phrases"
      },
      approvals: ["script", "storyboard", "motion-preview"],
      suggestions: [],
      estimate: { generated_shots: 0, api_usd: 0 }
    }
  };
  await pool.query(
    "insert into app.projects (id, owner_id, name, state, data, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7)",
    [id, USER, data.name, data.state, data, now, now]
  );
  return id;
}

async function drawAllCurrentVariants(projectId, aspect = "9:16", tag = "rh") {
  await startPlates(projectId);
  const vars = await store.listVariants(projectId);
  await pool.query(
    "delete from pgboss.job where name in ('plate-author', 'plate-render') and data->>'variantId' = any($1::text[])",
    [vars.map((v) => v.id)]
  );
  for (const v of vars) {
    if (v.aspect !== aspect) continue;
    const owner = store.newOwner();
    const claimed = await store.claimAuthor(v.id, v.gen, owner, 60, 10);
    assert.ok(claimed, `claimed variant ${v.id}`);
    const prefix = store.prefixOf(v);
    const bundleSha = `${tag}sha${String(v.scene_index).padStart(20, "0")}`.slice(0, 24);
    await store.commitBundle(v, owner, {
      sourceKey: `${prefix}sources/src-${v.scene_index}/source.ts`,
      bundleKey: `${prefix}bundles/${bundleSha}/bundle.html`,
      manifest: {
        bundleSha,
        engineDigest: "eng-rev-test",
        frames: v.frames
      },
      timings: { authorTotalMs: 1200, bundleMs: 15 }
    });
    await pool.query(
      "update app.plate_variants set state = 'drawn', stage = null, clip_key = $2, still_key = $3, drawn_at = now(), updated_at = now() where id = $1",
      [
        v.id,
        `${prefix}bundles/${bundleSha}/clip-a1.mp4`,
        `${prefix}bundles/${bundleSha}/still-a1.png`
      ]
    );
  }
  await pool.query(
    "delete from pgboss.job where name in ('plate-author', 'plate-render') and data->>'variantId' = any($1::text[])",
    [vars.map((v) => v.id)]
  );
}

async function countAuthorJobsForProject(projectId) {
  const vars = await store.listVariants(projectId);
  if (!vars.length) return 0;
  const res = await pool.query(
    "select count(*)::int as n from pgboss.job where name = 'plate-author' and data->>'variantId' = any($1::text[]) and state in ('created', 'retry', 'active')",
    [vars.map((v) => v.id)]
  );
  return res.rows[0].n;
}

const app = Fastify();
registerAuth(app);
await registerPlanRoutes(app);
await registerPlateRoutes(app, {
  presign: async (bucket, key) => `https://storage.test/${bucket}/${key}`
});

try {
  config.plates.enabled = true;
  config.plates.live = true;
  config.plates.liveForceOff = false;

  // =========================================================================
  // 1. Reproduce 7-scene rubber-hose all drawn -> update to 7-scene folk-tale
  // =========================================================================
  const p1 = await createSeededProject({
    look: "illus-rubber-hose",
    styleExample: "story-illus-rubber-hose",
    aspect: "9:16",
    aspects: ["9:16"],
    beats: OLD_RUBBER_HOSE_BEATS
  });
  await drawAllCurrentVariants(p1, "9:16", "rh");

  const statusBeforeEdit = await plateStatus(p1);
  assert.equal(statusBeforeEdit.stale, false);
  assert.equal(statusBeforeEdit.needsReconcile, false);
  assert.deepEqual(statusBeforeEdit.drawnAspects, ["9:16"]);
  assert.equal(statusBeforeEdit.scenes.length, 7);
  assert.equal(statusBeforeEdit.scenes[0].keyword, "A hen wants bread");
  assert.equal(statusBeforeEdit.scenes[0].state, "drawn");

  // Update project to 7-scene folk-tale storybook ("Wren wants fish", etc.)
  await updateProjectPlan(p1, (curr) => ({
    brief: {
      ...curr.brief,
      look: "illus-folk-tale",
      styleExample: "story-illus-folk-tale",
      scriptBeats: structuredClone(NEW_FOLK_TALE_BEATS)
    },
    beatPlan: {
      ...curr.beatPlan,
      beats: makePlanBeats(NEW_FOLK_TALE_BEATS)
    }
  }));

  // Read-only plateStatus (GET /v1/projects/:id/plates) MUST NOT expose old titles/art as current
  const statusAfterRewrite = await plateStatus(p1);
  assert.equal(statusAfterRewrite.look, "illus-folk-tale");
  assert.equal(statusAfterRewrite.stale, true, "status marks rewritten scenes stale");
  assert.equal(statusAfterRewrite.needsReconcile, true);
  assert.equal(statusAfterRewrite.running, false);
  assert.deepEqual(statusAfterRewrite.drawnAspects, [], "no aspect is reported drawn when scenes are stale");
  assert.equal(statusAfterRewrite.scenes.length, 7);
  assert.deepEqual(
    statusAfterRewrite.scenes.map((s) => s.keyword),
    NEW_FOLK_TALE_BEATS.map((b) => b.keyword),
    "status exposes new Folk-tale scene titles, never old Rubber-hose titles"
  );
  for (const s of statusAfterRewrite.scenes) {
    assert.equal(s.stale, true, `scene ${s.index} marked stale`);
    assert.equal(s.state, "queued", `scene ${s.index} not reported drawn`);
    assert.equal(s.stage, "stale");
    assert.equal(s.variantId, undefined, `scene ${s.index} does not leak old variantId`);
    assert.equal(s.bundleDigest, null, `scene ${s.index} does not leak old bundleDigest`);
    assert.equal(s.variants?.["9:16"]?.v, null, `scene ${s.index} does not leak old clip version`);
    assert.equal(s.variants?.["9:16"]?.stale, true);
  }

  // Repeated GET /plates readiness checks enqueue 0 paid jobs
  await plateStatus(p1);
  await plateStatus(p1);
  assert.equal(await countAuthorJobsForProject(p1), 0, "read-only plateStatus polling enqueues 0 author jobs");

  // /clip and /still routes refuse to serve stale rubber-hose clips/stills (404)
  const clipRes = await app.inject({ method: "GET", url: `/v1/projects/${p1}/plates/0/clip?aspect=9:16` });
  assert.equal(clipRes.statusCode, 404, "stale scene clip returns 404 instead of old rubber-hose MP4");
  const stillRes = await app.inject({ method: "GET", url: `/v1/projects/${p1}/plates/0/still?aspect=9:16` });
  assert.equal(stillRes.statusCode, 404, "stale scene still returns 404 instead of old rubber-hose PNG");

  // buildExport and waitForAuthoring refuse to export a mixed/stale revision
  const p1Data = await getProject(p1);
  await assert.rejects(
    () => buildExport(p1Data, "9:16", false),
    (err) => err instanceof NotDrawn && err.state === "missing",
    "buildExport refuses when stored variants belong to an older revision"
  );
  await assert.rejects(
    () => waitForAuthoring(p1, "9:16", { expectedScenes: 7, timeoutMs: 100 }),
    (err) => err instanceof NotDrawn && err.state === "missing",
    "waitForAuthoring refuses when stored variants belong to an older revision"
  );

  // Now reconcile via startPlates (user-authorized Draw / Update animation):
  // Supersedes all 7 scenes, retains earlier plate_revisions history, and queues 7 author jobs once (idempotent on repeat)
  const startedStatus = await startPlates(p1);
  assert.equal(startedStatus.stale, false, "after startPlates, scenes are actively queued (not stale)");
  assert.equal(startedStatus.running, true);
  assert.equal(await countAuthorJobsForProject(p1), 7, "all 7 rewritten scenes queued for authoring");
  const varsAfterStart = await store.listVariants(p1);
  assert.ok(varsAfterStart.every((v) => v.gen === 2 && v.state === "queued"), "all 7 variants bumped to gen=2, state=queued");
  for (const v of varsAfterStart) {
    const revs = await store.listRevisions(v.id);
    assert.equal(revs.length, 1, "old revision 0 retained in plate_revisions as history");
  }
  const swept = await sweepGarbage(20, async () => {
    throw new Error("should not delete revision-protected prefix");
  });
  assert.equal(swept.length, 0, "revision-protected history prefixes are not deleted by sweepGarbage");

  // Calling startPlates a second time is idempotent (still 7 jobs, gen stays 2)
  await startPlates(p1);
  assert.equal(await countAuthorJobsForProject(p1), 7, "repeat startPlates does not duplicate author jobs");
  assert.ok((await store.listVariants(p1)).every((v) => v.gen === 2));

  // =========================================================================
  // 2. Single-scene edit (including keyword change), style-only edit, & subtitle-only edit
  // =========================================================================
  const p2 = await createSeededProject({
    look: "illus-folk-tale",
    styleExample: "story-illus-folk-tale",
    aspect: "9:16",
    aspects: ["9:16"],
    beats: NEW_FOLK_TALE_BEATS
  });
  await drawAllCurrentVariants(p2, "9:16", "ft");

  // 2a. Unrelated subtitle/audio/display customization does not alter revision or invalidate scenes
  const stBeforeSub = await plateStatus(p2);
  await setPlateSubtitles(p2, {
    mode: "key-phrases",
    style: "cinema",
    size: 125,
    opacity: 85,
    color: "#fef08a",
    bgColor: "#0c0f16",
    x: 45,
    y: 80,
    voice: false,
    music: true,
    sfx: false,
    transitions: true
  });
  const stAfterSub = await plateStatus(p2);
  assert.equal(stAfterSub.revision, stBeforeSub.revision, "subtitle/player settings do not change plate revision digest");
  assert.equal(stAfterSub.stale, false);
  assert.equal(stAfterSub.needsReconcile, false);
  assert.deepEqual(stAfterSub.drawnAspects, ["9:16"]);
  await startPlates(p2);
  assert.equal(await countAuthorJobsForProject(p2), 0, "subtitle changes trigger 0 author jobs");

  // 2b. Edit ONLY Scene 2 (index 2: keyword, visual, and line changed; other 6 scenes untouched)
  const editedOneBeats = structuredClone(NEW_FOLK_TALE_BEATS);
  editedOneBeats[2] = {
    ...editedOneBeats[2],
    keyword: "Boots, not bread",
    visual: "Tobin holds up worn leather boots and waves away the bread basket.",
    line: "Tobin needs sturdy boots for the fishing boat, not another loaf."
  };
  await updateProjectPlan(p2, (curr) => ({
    brief: { ...curr.brief, scriptBeats: editedOneBeats },
    beatPlan: { ...curr.beatPlan, beats: makePlanBeats(editedOneBeats) }
  }));

  const stPartial = await plateStatus(p2);
  assert.equal(stPartial.stale, true);
  assert.equal(stPartial.scenes[2].stale, true, "edited scene 2 is marked stale");
  assert.equal(stPartial.scenes[2].keyword, "Boots, not bread");
  for (const idx of [0, 1, 3, 4, 5, 6]) {
    assert.equal(stPartial.scenes[idx].stale, false, `unchanged scene ${idx} stays non-stale`);
    assert.equal(stPartial.scenes[idx].state, "drawn", `unchanged scene ${idx} stays drawn`);
  }

  await startPlates(p2);
  assert.equal(await countAuthorJobsForProject(p2), 1, "only the 1 edited scene is queued for authoring");
  const p2VarsAfter1Edit = await store.listVariants(p2);
  for (const v of p2VarsAfter1Edit) {
    if (v.scene_index === 2) {
      assert.equal(v.state, "queued");
      assert.equal(v.gen, 2);
    } else {
      assert.equal(v.state, "drawn", `scene ${v.scene_index} preserved drawn state`);
      assert.equal(v.gen, 1, `scene ${v.scene_index} preserved gen=1`);
      assert.ok(v.clip_key, `scene ${v.scene_index} preserved clip_key`);
    }
  }

  // =========================================================================
  // 3. Reorder, Remove, and Insert scenes preserve unchanged drawn assets
  // =========================================================================
  const p3 = await createSeededProject({
    look: "illus-folk-tale",
    styleExample: "story-illus-folk-tale",
    aspect: "9:16",
    aspects: ["9:16"],
    beats: NEW_FOLK_TALE_BEATS.slice(0, 4)
  });
  await drawAllCurrentVariants(p3, "9:16", "ro");
  const p3VarsInitial = await store.listVariants(p3);
  const initialClipsByKeyword = new Map(p3VarsInitial.map((v) => [v.keyword, v.clip_key]));

  // 3a. Reorder via PATCH /v1/projects/:id/plan (swap b1 and b2: ["b2", "b1", "b3", "b4"])
  const patchRes = await app.inject({
    method: "PATCH",
    url: `/v1/projects/${p3}/plan`,
    payload: { order: ["b2", "b1", "b3", "b4"] }
  });
  assert.equal(patchRes.statusCode, 200);
  const p3AfterReorder = await getProject(p3);
  assert.deepEqual(
    p3AfterReorder.brief.scriptBeats.map((b) => b.keyword),
    ["Bread for fish", "Wren wants fish", "No more bread", "A string of shells"],
    "PATCH /plan order syncs brief.scriptBeats with beatPlan.beats"
  );

  const stReordered = await plateStatus(p3);
  assert.equal(stReordered.stale, false, "pure reorder has 0 stale scenes (all scenes match existing drawn variants)");
  assert.equal(stReordered.needsReconcile, true, "pure reorder flags needsReconcile=true for index transfer");
  assert.deepEqual(
    stReordered.scenes.map((s) => s.keyword),
    ["Bread for fish", "Wren wants fish", "No more bread", "A string of shells"]
  );
  assert.ok(stReordered.scenes.every((s) => s.state === "drawn"));

  await startPlates(p3);
  assert.equal(await countAuthorJobsForProject(p3), 0, "reordering drawn scenes queues 0 author jobs");
  const p3VarsReordered = await store.listVariants(p3);
  for (const v of p3VarsReordered) {
    assert.equal(v.state, "drawn");
    assert.equal(v.clip_key, initialClipsByKeyword.get(v.keyword), `scene "${v.keyword}" kept its exact drawn clip_key after reorder`);
  }

  // 3b. Remove scene at index 1 ("Wren wants fish") -> 3 scenes remain
  await updateProjectPlan(p3, (curr) => reconcileProjectAfterSceneRemove(curr, { index: 1 }).patch);
  await startPlates(p3);
  assert.equal(await countAuthorJobsForProject(p3), 0, "removing a scene queues 0 author jobs for surviving scenes");
  const p3VarsAfterRemove = await store.listVariants(p3);
  assert.equal(p3VarsAfterRemove.length, 3);
  assert.deepEqual(
    p3VarsAfterRemove.map((v) => v.keyword),
    ["Bread for fish", "No more bread", "A string of shells"]
  );
  for (const v of p3VarsAfterRemove) {
    assert.equal(v.state, "drawn");
    assert.equal(v.clip_key, initialClipsByKeyword.get(v.keyword), `surviving scene "${v.keyword}" kept its clip_key after remove`);
  }

  // 3c. Insert a new scene at position 1 -> 4 scenes total; existing 3 stay drawn, only index 1 is queued
  await updateProjectPlan(p3, (curr) =>
    reconcileProjectAfterSceneInsert(curr, {
      brief: curr.brief,
      previousBeats: curr.brief.scriptBeats,
      position: 1,
      insertedBeat: {
        id: "ft-inserted",
        keyword: "The salt barrel",
        visual: "Tobin points to a barrel of coarse sea salt.",
        onScreen: "Salt",
        line: "First he asks for salt to cure his catch."
      }
    })
  );
  await startPlates(p3);
  assert.equal(await countAuthorJobsForProject(p3), 1, "inserting 1 scene queues exactly 1 author job");
  const p3VarsAfterInsert = await store.listVariants(p3);
  assert.equal(p3VarsAfterInsert.length, 4);
  assert.equal(p3VarsAfterInsert[0].state, "drawn");
  assert.equal(p3VarsAfterInsert[1].state, "queued");
  assert.equal(p3VarsAfterInsert[1].keyword, "The salt barrel");
  assert.equal(p3VarsAfterInsert[2].state, "drawn");
  assert.equal(p3VarsAfterInsert[2].clip_key, initialClipsByKeyword.get("No more bread"));
  assert.equal(p3VarsAfterInsert[3].state, "drawn");
  assert.equal(p3VarsAfterInsert[3].clip_key, initialClipsByKeyword.get("A string of shells"));

  // =========================================================================
  // 4. Aspect addition keeps existing aspect drawn and queues only new aspect
  // =========================================================================
  await pool.query(
    "update app.plate_variants set state = 'drawn', bundle_key = 'plates/x/b.html', clip_key = 'plates/x/c.mp4', drawn_at = now() where id = $1",
    [p3VarsAfterInsert[1].id]
  );
  await pool.query("delete from pgboss.job where name = 'plate-author' and data->>'variantId' = $1", [p3VarsAfterInsert[1].id]);

  await startPlates(p3, ["16:9"]);
  const p3VarsMultiAspect = await store.listVariants(p3);
  const nineSixteen = p3VarsMultiAspect.filter((v) => v.aspect === "9:16");
  const sixteenNine = p3VarsMultiAspect.filter((v) => v.aspect === "16:9");
  assert.equal(nineSixteen.length, 4);
  assert.ok(nineSixteen.every((v) => v.state === "drawn"), "existing 9:16 variants remain drawn");
  assert.equal(sixteenNine.length, 4);
  assert.ok(sixteenNine.every((v) => v.state === "queued"), "newly requested 16:9 variants are queued");
  assert.equal(await countAuthorJobsForProject(p3), 4, "only the 4 new 16:9 variants are queued for authoring");

  // =========================================================================
  // 5. Late handleAuthor job from a superseded project revision is fenced out
  // =========================================================================
  const staleTarget = sixteenNine[0];
  await updateProjectPlan(p3, (curr) => ({
    brief: { ...curr.brief, look: "illus-woodcut", styleExample: "story-illus-woodcut" }
  }));
  await handleAuthor({
    id: randomUUID(),
    name: "plate-author",
    data: { variantId: staleTarget.id, gen: staleTarget.gen },
    retryCount: 0,
    signal: new AbortController().signal
  });
  const afterStaleAuthor = await store.getVariant(staleTarget.id);
  assert.equal(afterStaleAuthor.state, "failed");
  assert.equal(afterStaleAuthor.error?.code, "project_changed", "handleAuthor fences out variant when project moved to another revision");
  assert.equal(afterStaleAuthor.authored, 0, "0 model calls made for superseded revision");

  console.log("plate revision reconcile: ok");
} finally {
  config.plates.live = false;
  config.plates.liveForceOff = false;
  await app.close();
  const vIds = (
    await pool.query("select id::text as id from app.plate_variants where project_id = any($1::uuid[])", [createdProjects])
  ).rows.map((r) => r.id);
  if (vIds.length) {
    await pool.query("delete from pgboss.job where name like 'plate-%' and data->>'variantId' = any($1::text[])", [vIds]);
  }
  await pool.query("delete from app.plate_exports where project_id = any($1::uuid[])", [createdProjects]);
  await pool.query("delete from app.plate_variants where project_id = any($1::uuid[])", [createdProjects]);
  await pool.query("delete from app.plate_garbage where project_id = any($1::uuid[])", [createdProjects]);
  await pool.query("delete from app.plate_state where project_id = any($1::uuid[])", [createdProjects]);
  await pool.query("delete from app.projects where id = any($1::uuid[])", [createdProjects]);
  await boss.stop({ graceful: false }).catch(() => undefined);
  await pool.end();
}
