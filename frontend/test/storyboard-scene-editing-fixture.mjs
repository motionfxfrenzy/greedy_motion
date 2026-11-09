import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import {
  SCRIPT_BEATS_MAX,
  SCRIPT_BEATS_MIN,
  ensureScriptBeatIds,
  parseScriptBeats,
  parseScriptBrief,
  remapFlagsOnInsert,
  remapFlagsOnRemove,
  remapIndicesOnInsert,
  remapIndicesOnRemove,
  remapRecordOnInsert,
  remapRecordOnRemove,
  scriptFrameKey,
  scriptSeconds,
  voiceText
} from "@videosaas/contracts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(FRONTEND_DIR, "..");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SCREENSHOT_DIR = join(REPO_ROOT, "docs/handoff/screenshots/storyboard-scene-editing");

const COMBINED_CSS = [
  readFileSync(join(FRONTEND_DIR, "app/theme.css"), "utf8"),
  readFileSync(join(FRONTEND_DIR, "app/styles.css"), "utf8")
].join("\n");

// The 7 scenes from target project 316f1cbd-b5b9-49af-ae3b-2add10a18ed5
const SEVEN_STORY_SCENES = [
  {
    id: "sb-scene-1",
    keyword: "A hen wants bread",
    visual: "A cheerful speckled hen holding a basket of eggs outside a warm village bakery.",
    onScreen: "Eggs for bread",
    line: "One morning, a little hen wanted a warm loaf of bread, but all she had were eggs."
  },
  {
    id: "sb-scene-2",
    keyword: "Eggs, no thanks",
    visual: "The baker shaking his head kindly while pointing toward an empty firewood bin.",
    onScreen: "Baker needs wood",
    line: "The baker already had plenty of eggs; what he really needed was dry firewood for his oven."
  },
  {
    id: "sb-scene-3",
    keyword: "The long swap",
    visual: "The hen trotting from woodcutter to potter to miller in a dizzying chain of trades.",
    onScreen: "Three swaps later",
    line: "So the hen traded eggs for clay bowls, bowls for kindling, and kindling for a single loaf."
  },
  {
    id: "sb-scene-4",
    keyword: "A pretty shell",
    visual: "Villagers gathering around a stall holding gleaming cowrie shells that everyone accepts.",
    onScreen: "One token for all",
    line: "Soon the village agreed that rare, smooth shells could be traded for anything at any stall."
  },
  {
    id: "sb-scene-5",
    keyword: "Shell to coin",
    visual: "A blacksmith stamping a golden sun emblem onto small round metal coins.",
    onScreen: "Stamped metal",
    line: "Shells cracked in pockets, so smiths stamped durable metal coins with a trusted mark."
  },
  {
    id: "sb-scene-6",
    keyword: "Coin to paper",
    visual: "A merchant handing over a light paper note while heavy coin chests stay locked in a vault.",
    onScreen: "Lighter to carry",
    line: "When sacks of coin grew too heavy for long roads, vault receipts became paper money."
  },
  {
    id: "sb-scene-7",
    keyword: "Still warm",
    visual: "The hen tapping a glowing card at the bakery counter and walking out with steaming bread.",
    onScreen: "Trust in every tap",
    line: "Today numbers flash across screens, yet every tap is still that same promise for warm bread."
  }
];

const makeDistinctSvg = (label, color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#121824"/><circle cx="320" cy="180" r="92" fill="${color}" opacity="0.35"/><text x="320" y="190" text-anchor="middle" fill="#eef2f8" font-family="sans-serif" font-size="26" font-weight="700">${label}</text></svg>`;

const SCENE_COLORS = ["#168bff", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4", "#eab308", "#ef4444"];

test("pure contract helpers: identity assignment, index/record/flag remapping on insert and remove", () => {
  const beats = ensureScriptBeatIds(SEVEN_STORY_SCENES.map(({ id: _id, ...rest }) => rest));
  assert.equal(beats.length, 7);
  assert.equal(new Set(beats.map((b) => b.id)).size, 7, "every beat gets a distinct stable id");

  const parsedWithIds = parseScriptBeats(beats);
  assert.ok(parsedWithIds);
  assert.deepEqual(
    parsedWithIds.map((b) => b.id),
    beats.map((b) => b.id),
    "parseScriptBeats preserves valid beat ids"
  );

  // Record remapping (used for versions, frameAt, voiceErrors)
  const record = { 0: "v0", 1: "v1", 2: "v2", 5: "v5" };
  const afterInsertAt2 = remapRecordOnInsert(record, 2);
  assert.deepEqual(afterInsertAt2, { 0: "v0", 1: "v1", 3: "v2", 6: "v5" }, "keys >= 2 shift +1; key 2 is unoccupied for new scene");

  const { next: afterRemove2, removed } = remapRecordOnRemove(record, 1);
  assert.equal(removed, "v1");
  assert.deepEqual(afterRemove2, { 0: "v0", 1: "v2", 4: "v5" }, "key 1 removed and keys > 1 shift -1");

  // Picked indices remapping
  assert.deepEqual(remapIndicesOnInsert([0, 1, 2, 4], 2), [0, 1, 3, 5]);
  assert.deepEqual(remapIndicesOnRemove([0, 1, 2, 4], 1), [0, 1, 3]);

  // Flag remapping
  const flags = [
    { beat: 1, message: "flag on beat 2" },
    { beat: 2, message: "flag on beat 3" }
  ];
  const flagsInserted = remapFlagsOnInsert(flags, 2, [{ beat: 2, message: "flag on new beat" }]);
  assert.deepEqual(flagsInserted, [
    { beat: 1, message: "flag on beat 2" },
    { beat: 3, message: "flag on beat 3" },
    { beat: 2, message: "flag on new beat" }
  ]);
  const flagsRemoved = remapFlagsOnRemove(flags, 1);
  assert.deepEqual(flagsRemoved.removed, [{ beat: 1, message: "flag on beat 2" }]);
  assert.deepEqual(flagsRemoved.next, [{ beat: 1, message: "flag on beat 3" }]);
});

test("backend routes & reconciliation: insert before/between/after, validation, ownership, idempotency, metering, downstream identity & undo restore", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const script = `
    import assert from "node:assert/strict";
    import { randomUUID } from "node:crypto";
    process.env.APP_ENV = "local";
    process.env.PLANNER = "deterministic";
    process.env.DATABASE_URL = "postgres://videosaas:videosaas@127.0.0.1:55432/plates_unit";

    const Fastify = (await import("fastify")).default;
    const { defaultTemplateId, defaultThemeId, SCRIPT_BEATS_MAX, scriptFrameKey, voiceText } = await import("@videosaas/contracts");
    const { registerAuth } = await import("./backend/src/auth.ts");
    const { registerOwnership } = await import("./backend/src/access.ts");
    const { registerPreviewMeter } = await import("./backend/src/plan/preview-meter.ts");
    const { registerRenderQuote } = await import("./backend/src/render/quote.ts");
    const { registerPlanRoutes, setSceneInsertWriterForTest } = await import("./backend/src/plan/routes.ts");
    const { takeFor } = await import("./backend/src/plates/model.ts");
    const { migrate, pool } = await import("./backend/src/db/database.ts");
    const {
      createProject,
      deleteProject,
      getProject,
      saveScriptFrame,
      updateProject,
      updateProjectAudio,
      updateProjectPlan
    } = await import("./backend/src/projects/store.ts");

    await migrate();

    const ownerA = randomUUID();
    const ownerB = randomUUID();
    let currentCaller = ownerA;

    const app = Fastify();
    app.addHook("onRequest", async (req) => {
      req.user = { id: currentCaller };
    });
    registerOwnership(app);
    registerPreviewMeter(app);
    registerRenderQuote(app);
    await registerPlanRoutes(app);

    const baseBeats = ${JSON.stringify(SEVEN_STORY_SCENES)};
    const brief = {
      scriptMode: "problem",
      text: "Tell the story of how money evolved from a hen bartering eggs for bread to shells, coins, paper notes, and digital taps.",
      durationSeconds: 30,
      pace: "calm",
      aspect: "16:9",
      look: "illus-storybook",
      motionProfile: "smooth",
      captions: "key-phrases",
      audio: { mode: "both", voice: "Kore" },
      keepOverLength: true,
      scriptBeats: baseBeats
    };
    const request = {
      prompt: brief.text,
      format: "landscape",
      style: "clean",
      theme: defaultThemeId,
      template: defaultTemplateId,
      audio: { music: true, voiceover: true, voice: "Kore" }
    };

    try {
      const p = await createProject({ name: "Hen Money Story", request }, ownerA);

      // Seed distinct reference frames, voiceover takes, beatPlan motion/overrides, and Approved state
      for (let i = 0; i < baseBeats.length; i++) {
        await saveScriptFrame(p.id, {
          key: scriptFrameKey(baseBeats[i], brief),
          svg: \`<svg xmlns="http://www.w3.org/2000/svg"><text>Frame-\${baseBeats[i].id}</text></svg>\`
        });
      }
      await updateProjectAudio(p.id, () => ({
        voice: {
          engine: "gemini-tts",
          model: "gemini-2.5-flash-preview-tts",
          voice: "Kore",
          direction: "warm storyteller",
          pace: "calm",
          lines: baseBeats.map((b, i) => ({
            beat: \`b\${i + 1}\`,
            text: voiceText(b.line),
            file: \`vo/\${ String(i + 1).repeat(20) }.wav\`,
            seconds: 4 + i * 0.25,
            words: [{ text: "word", start: 0, end: 0.5 }],
            aligned: "whisper"
          }))
        },
        music: {
          source: "lyria",
          model: "lyria-1",
          prompt: "warm acoustic",
          file: \`music/\${ "m".repeat(20) }.mp3\`,
          seconds: 45
        },
        cost_usd: 0.12,
        updatedAt: new Date().toISOString()
      }));

      await updateProjectPlan(p.id, () => ({
        brief,
        beatPlan: {
          version: "1.0",
          mode: "problem-only",
          template: null,
          format: "explainer",
          canvas: "16:9",
          target_duration_s: 30,
          clock: "voiceover",
          brand: { name: "", motion_profile: "smooth", style_frame: null },
          characters: [],
          beats: baseBeats.map((b, i) => ({
            id: \`b\${i + 1}\`,
            role: i === 0 ? "hook" : i === baseBeats.length - 1 ? "cta" : "step",
            kind: "kinetic",
            producer: "hyperframes",
            line: b.line,
            verb: null,
            keyword: b.keyword,
            on_screen: b.onScreen,
            success: false,
            energy: "medium",
            motion: {
              camera: \`cam-orig-\${i + 1}\`,
              entry: { axis: "x", dir: -1 },
              exit: { axis: i % 2 === 0 ? "x" : "y", dir: i % 2 === 0 ? -1 : 1 },
              text_effect: "waterfall"
            },
            sfx: \`sfx-orig-\${i + 1}\`,
            scene: null,
            transition_out: { type: i === baseBeats.length - 1 ? "end" : "j-cut" }
          })),
          audio: {
            voice: { engine: "gemini-tts", voice: "Kore", speed: 1, direction: "warm" },
            music: { source: "lyria", prompt: "warm" },
            captions: "key-phrases"
          },
          approvals: ["script", "storyboard", "motion-preview"],
          suggestions: [{ beat: "b3", problem: "test problem", proposal: "test proposal", accepted: true }],
          overrides: {
            "b1:keyword": { scale: 1.1 },
            "b3:keyword": { scale: 1.25 }
          },
          estimate: { generated_shots: 0, api_usd: 0.25 }
        },
        state: "Approved",
        filmSeconds: 38,
        keepOverLength: true
      }));

      const quoteBefore = (await app.inject({ method: "GET", url: \`/v1/projects/\${p.id}/render/quote\` })).json();
      assert.equal(quoteBefore.ready, true, "initially ready when all 7 scenes are voiced");

      // 1. Ownership enforcement: ownerB gets 404 on insert, remove, and restore
      currentCaller = ownerB;
      const unauthInsert = await app.inject({
        method: "POST",
        url: \`/v1/projects/\${p.id}/script/scenes/insert\`,
        payload: { brief, previous: baseBeats, position: 2, prompt: "A miller weighs grain" }
      });
      assert.equal(unauthInsert.statusCode, 404, "non-owner cannot insert scene");

      const unauthRemove = await app.inject({
        method: "POST",
        url: \`/v1/projects/\${p.id}/script/scenes/remove\`,
        payload: { index: 2 }
      });
      assert.equal(unauthRemove.statusCode, 404, "non-owner cannot remove scene");
      currentCaller = ownerA;

      // 2. Validation checks: empty/short prompt, >400 char prompt, out-of-range position
      const shortPromptRes = await app.inject({
        method: "POST",
        url: \`/v1/projects/\${p.id}/script/scenes/insert\`,
        payload: { brief, previous: baseBeats, position: 2, prompt: "  ab " }
      });
      assert.equal(shortPromptRes.statusCode, 400);
      assert.equal(shortPromptRes.json().error.code, "invalid_prompt");

      const longPromptRes = await app.inject({
        method: "POST",
        url: \`/v1/projects/\${p.id}/script/scenes/insert\`,
        payload: { brief, previous: baseBeats, position: 2, prompt: "x".repeat(405) }
      });
      assert.equal(longPromptRes.statusCode, 400);
      assert.equal(longPromptRes.json().error.code, "invalid_prompt");

      for (const badPos of [-1, 8, 1.5, "two"]) {
        const badPosRes = await app.inject({
          method: "POST",
          url: \`/v1/projects/\${p.id}/script/scenes/insert\`,
          payload: { brief, previous: baseBeats, position: badPos, prompt: "Valid description here" }
        });
        assert.equal(badPosRes.statusCode, 400, \`position \${badPos} rejected\`);
        assert.equal(badPosRes.json().error.code, "invalid_position");
      }

      // 3. Max-scene limit (SCRIPT_BEATS_MAX)
      const maxBeats = Array.from({ length: SCRIPT_BEATS_MAX }, (_, i) => ({
        ...baseBeats[i % baseBeats.length],
        id: \`sb-max-\${i + 1}\`,
        keyword: \`Scene \${i + 1}\`
      }));
      const maxRes = await app.inject({
        method: "POST",
        url: \`/v1/projects/\${p.id}/script/scenes/insert\`,
        payload: { brief, previous: maxBeats, position: 2, prompt: "One scene beyond max" }
      });
      assert.equal(maxRes.statusCode, 422);
      assert.equal(maxRes.json().error.code, "max_scenes");

      // 4. Model failure / invalid multi-beat output preserves existing scenes; retry with same idempotencyKey succeeds & charges once
      process.env.PREVIEW_LIMITS = "on";
      let writerCalls = 0;
      let shouldFailModel = true;
      setSceneInsertWriterForTest(async (req) => {
        writerCalls += 1;
        if (shouldFailModel) {
          throw new Error("Simulated upstream LLM timeout");
        }
        return [
          "BEAT: Carrying heavy grain",
          "VISUAL: The hen struggling to haul a heavy sack of grain between the mill and the bakery.",
          "SCREEN: Heavy to haul",
          "VOICE: Hauling heavy grain sacks across the village square wore the little hen out before noon."
        ].join("\\n");
      });

      const retryIdemKey = \`idem-insert-\${randomUUID()}\`;
      const failRes = await app.inject({
        method: "POST",
        url: \`/v1/projects/\${p.id}/script/scenes/insert\`,
        payload: { brief, previous: baseBeats, position: 2, prompt: "Show the hen struggling to carry a heavy grain sack between Scene 2 and Scene 3", idempotencyKey: retryIdemKey }
      });
      assert.equal(failRes.statusCode, 502, "failed writer returns 502");
      const unchangedAfterFail = await getProject(p.id);
      assert.equal(unchangedAfterFail.brief.scriptBeats.length, 7, "failed insert leaves all 7 scenes intact");

      // Now allow writer to succeed and send two concurrent requests with the same idempotencyKey
      shouldFailModel = false;
      const [insertRes1, insertRes2] = await Promise.all([
        app.inject({
          method: "POST",
          url: \`/v1/projects/\${p.id}/script/scenes/insert\`,
          payload: { brief, previous: baseBeats, position: 2, prompt: "Show the hen struggling to carry a heavy grain sack between Scene 2 and Scene 3", idempotencyKey: retryIdemKey }
        }),
        app.inject({
          method: "POST",
          url: \`/v1/projects/\${p.id}/script/scenes/insert\`,
          payload: { brief, previous: baseBeats, position: 2, prompt: "Show the hen struggling to carry a heavy grain sack between Scene 2 and Scene 3", idempotencyKey: retryIdemKey }
        })
      ]);
      assert.equal(insertRes1.statusCode, 200);
      assert.equal(insertRes2.statusCode, 200);
      assert.equal(writerCalls, 2, "1 failed attempt + 1 deduplicated success call = 2 total writer invocations");

      const usageRows = await pool.query(
        "select calls from app.preview_usage where user_id = $1 and project_id = $2",
        [ownerA, p.id]
      );
      assert.equal(Number(usageRows.rows[0]?.calls ?? 0), 1, "retry + duplicate submit with same idempotencyKey metered only once");
      delete process.env.PREVIEW_LIMITS;

      const body1 = insertRes1.json();
      assert.equal(body1.position, 2);
      assert.equal(body1.insertedBeat.keyword, "Carrying heavy grain");
      assert.equal(body1.beats.length, 8);
      assert.equal(body1.beats[0].keyword, "A hen wants bread");
      assert.equal(body1.beats[1].keyword, "Eggs, no thanks");
      assert.equal(body1.beats[2].keyword, "Carrying heavy grain");
      assert.equal(body1.beats[3].keyword, "The long swap", "original Scene 3 shifted to index 3 (Scene 4)");
      assert.equal(body1.beats[7].keyword, "Still warm", "original Scene 7 shifted to index 7 (Scene 8)");

      // Verify every original scene's text, frame, voice take, beatPlan camera/sfx, and overrides survived untouched!
      const afterInsertProj = await getProject(p.id);
      assert.equal(afterInsertProj.keepOverLength, true, "keepOverLength preserved across scene insertion");
      assert.equal(afterInsertProj.brief.keepOverLength, true, "brief.keepOverLength preserved across scene insertion");
      assert.equal(afterInsertProj.state, "Draft storyboard", "Approved state invalidated to Draft storyboard on structural edit");
      assert.equal(afterInsertProj.filmSeconds, undefined, "stale filmSeconds cleared on structural edit");

      // Original Scene 3 ("The long swap") is now at index 3 (b4):
      assert.equal(afterInsertProj.beatPlan.beats[3].id, "b4");
      assert.equal(afterInsertProj.beatPlan.beats[3].keyword, "The long swap");
      assert.equal(afterInsertProj.beatPlan.beats[3].motion.camera, "cam-orig-3", "shifted scene keeps its beatPlan camera");
      assert.equal(afterInsertProj.beatPlan.beats[3].sfx, "sfx-orig-3", "shifted scene keeps its beatPlan sfx");
      assert.deepEqual(afterInsertProj.beatPlan.overrides["b4:keyword"], { scale: 1.25 }, "override b3:keyword shifted to b4:keyword");
      assert.deepEqual(afterInsertProj.beatPlan.overrides["b1:keyword"], { scale: 1.1 }, "override b1:keyword stayed on b1:keyword");
      assert.equal(afterInsertProj.beatPlan.suggestions[0].beat, "b4", "suggestion on b3 shifted to b4");

      // Voiceover take matching after insert:
      // Index 0..1 keep their takes; index 2 (newly inserted scene) has NO take (undefined); indices 3..7 keep their original takes!
      assert.ok(takeFor(afterInsertProj, 0)?.file.includes("11111"), "Scene 1 keeps take 1");
      assert.ok(takeFor(afterInsertProj, 1)?.file.includes("22222"), "Scene 2 keeps take 2");
      assert.equal(takeFor(afterInsertProj, 2), undefined, "Newly inserted Scene 3 is honestly unvoiced (no leaked take)");
      assert.ok(takeFor(afterInsertProj, 3)?.file.includes("33333"), "Shifted Scene 4 (was Scene 3) keeps take 3");
      assert.ok(takeFor(afterInsertProj, 7)?.file.includes("77777"), "Shifted Scene 8 (was Scene 7) keeps take 7");

      // Quote and readiness after inserting an unvoiced scene into a voiced film:
      const quoteAfterInsert = (await app.inject({ method: "GET", url: \`/v1/projects/\${p.id}/render/quote\` })).json();
      assert.equal(quoteAfterInsert.ready, false, "readiness is false until the new scene's voiceover is recorded");
      assert.ok(quoteAfterInsert.seconds > quoteBefore.seconds, "film duration quote increases after adding a scene");

      // 5. Insert before Scene 1 (position = 0) and after last scene (position = 8)
      setSceneInsertWriterForTest(async (req) => [
        \`BEAT: Boundary \${req.position}\`,
        \`VISUAL: Visual at boundary \${req.position}.\`,
        \`SCREEN: Label \${req.position}\`,
        \`VOICE: Spoken line at boundary \${req.position}.\`
      ].join("\\n"));

      const beforeFirstRes = await app.inject({
        method: "POST",
        url: \`/v1/projects/\${p.id}/script/scenes/insert\`,
        payload: { brief: afterInsertProj.brief, previous: afterInsertProj.brief.scriptBeats, position: 0, prompt: "Open on sunrise over the village" }
      });
      assert.equal(beforeFirstRes.statusCode, 200);
      assert.equal(beforeFirstRes.json().beats[0].keyword, "Boundary 0");
      assert.equal(beforeFirstRes.json().beats.length, 9);

      const afterLastRes = await app.inject({
        method: "POST",
        url: \`/v1/projects/\${p.id}/script/scenes/insert\`,
        payload: { brief: beforeFirstRes.json().project.brief, previous: beforeFirstRes.json().beats, position: 9, prompt: "Close on starry night over the bakery" }
      });
      assert.equal(afterLastRes.statusCode, 200);
      assert.equal(afterLastRes.json().beats.length, 10);
      assert.equal(afterLastRes.json().beats[9].keyword, "Boundary 9");
      assert.equal(afterLastRes.json().project.beatPlan.beats[8].transition_out.type, "j-cut", "previous last beat transition changed from end to j-cut");
      assert.equal(afterLastRes.json().project.beatPlan.beats[9].transition_out.type, "end", "new last beat has transition end");

      // 6. Scene removal & Undo restoration (first, middle, last, and minimum-1-scene guard)
      const badRemoveRes = await app.inject({
        method: "POST",
        url: \`/v1/projects/\${p.id}/script/scenes/remove\`,
        payload: { index: 99 }
      });
      assert.equal(badRemoveRes.statusCode, 400);

      // Remove the scene we inserted at index 0 ("Boundary 0") and the one at the end ("Boundary 9") and the one at index 2 ("Carrying heavy grain")
      const remFirst = await app.inject({
        method: "POST",
        url: \`/v1/projects/\${p.id}/script/scenes/remove\`,
        payload: { index: 0 }
      });
      assert.equal(remFirst.statusCode, 200);
      assert.equal(remFirst.json().removedBeat.keyword, "Boundary 0");
      assert.equal(remFirst.json().beats.length, 9);

      const remLast = await app.inject({
        method: "POST",
        url: \`/v1/projects/\${p.id}/script/scenes/remove\`,
        payload: { index: 8 }
      });
      assert.equal(remLast.statusCode, 200);
      assert.equal(remLast.json().removedBeat.keyword, "Boundary 9");
      assert.equal(remLast.json().beats.length, 8);

      const remMiddle = await app.inject({
        method: "POST",
        url: \`/v1/projects/\${p.id}/script/scenes/remove\`,
        payload: { index: 2 }
      });
      assert.equal(remMiddle.statusCode, 200);
      assert.equal(remMiddle.json().removedBeat.keyword, "Carrying heavy grain");
      assert.equal(remMiddle.json().beats.length, 7);

      // Now remove Scene 3 ("The long swap", at index 2) which has a voiceover take, frame, and override b3:keyword, then UNDO it!
      const remScene3 = await app.inject({
        method: "POST",
        url: \`/v1/projects/\${p.id}/script/scenes/remove\`,
        payload: { index: 2 }
      });
      assert.equal(remScene3.statusCode, 200);
      const remScene3Body = remScene3.json();
      assert.equal(remScene3Body.removedBeat.keyword, "The long swap");
      assert.equal(remScene3Body.beats.length, 6);
      assert.deepEqual(remScene3Body.removedOverrides, { ":keyword": { scale: 1.25 } }, "removed scene's overrides returned for undo");

      // While Scene 3 is removed, the new Scene 3 (was Scene 4 "A pretty shell") has its own take (44444), NOT Scene 3's take (33333)!
      const projAfterRem3 = await getProject(p.id);
      assert.ok(takeFor(projAfterRem3, 2)?.file.includes("44444"), "new Scene 3 has take 4, no leak from removed Scene 3");

      // Undo removing Scene 3:
      const restoreScene3 = await app.inject({
        method: "POST",
        url: \`/v1/projects/\${p.id}/script/scenes/restore\`,
        payload: {
          index: 2,
          beat: remScene3Body.removedBeat,
          planBeat: remScene3Body.removedPlanBeat,
          overrides: remScene3Body.removedOverrides
        }
      });
      assert.equal(restoreScene3.statusCode, 200);
      const projRestored = await getProject(p.id);
      assert.equal(projRestored.brief.scriptBeats.length, 7);
      assert.equal(projRestored.brief.scriptBeats[2].keyword, "The long swap");
      assert.ok(takeFor(projRestored, 2)?.file.includes("33333"), "restored Scene 3 recovers its original voice take");
      assert.ok(takeFor(projRestored, 3)?.file.includes("44444"), "Scene 4 has its own take 4");
      assert.deepEqual(projRestored.beatPlan.overrides["b3:keyword"], { scale: 1.25 }, "restored Scene 3 recovers its override");
      assert.equal(projRestored.keepOverLength, true, "keepOverLength remains true after remove + undo");

      // Test minimum 1-scene guard: remove down to 1 scene, then verify removing the last remaining scene is refused with 422
      for (let len = 7; len > 1; len--) {
        const r = await app.inject({
          method: "POST",
          url: \`/v1/projects/\${p.id}/script/scenes/remove\`,
          payload: { index: len - 1 }
        });
        assert.equal(r.statusCode, 200);
      }
      const remOnlyScene = await app.inject({
        method: "POST",
        url: \`/v1/projects/\${p.id}/script/scenes/remove\`,
        payload: { index: 0 }
      });
      assert.equal(remOnlyScene.statusCode, 422, "cannot remove the last remaining scene");
      assert.equal(remOnlyScene.json().error.code, "min_scenes");

      setSceneInsertWriterForTest(null);
      await deleteProject(p.id);
    } finally {
      await pool.query("delete from app.preview_usage where user_id in ($1, $2)", [ownerA, ownerB]);
      await pool.query("delete from app.projects where owner_id in ($1, $2)", [ownerA, ownerB]);
      await pool.end();
    }
  `;
  const res = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
  if (res.status !== 0 && /ECONNREFUSED/.test(res.stderr)) {
    t.skip("Local throwaway Postgres not running on 55432");
    return;
  }
  assert.equal(res.status, 0, `backend scene editing test failed:\n${res.stderr}\n${res.stdout}`);
});

async function startStoryboardSceneEditingServer() {
  const entrySource = `
    import React, { useCallback, useEffect, useRef, useState } from "react";
    import { createRoot } from "react-dom/client";
    import {
      SCRIPT_BEATS_MAX,
      SCRIPT_BEATS_MIN,
      ensureScriptBeatIds,
      remapFlagsOnInsert,
      remapFlagsOnRemove,
      remapIndicesOnInsert,
      remapIndicesOnRemove,
      remapRecordOnInsert,
      remapRecordOnRemove,
      scriptFrameKey,
      scriptSeconds,
      voiceText
    } from "@videosaas/contracts";
    import { ScriptCanvas } from "./components/script-canvas.tsx";

    const INITIAL_BEATS = ${JSON.stringify(SEVEN_STORY_SCENES)};
    const COLORS = ${JSON.stringify(SCENE_COLORS)};
    const makeSvg = (label, color) =>
      \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#121824"/><circle cx="320" cy="180" r="92" fill="\${color}" opacity="0.35"/><text x="320" y="190" text-anchor="middle" fill="#eef2f8" font-family="sans-serif" font-size="26" font-weight="700">\${label}</text></svg>\`;

    const STORAGE_KEY = "gm-scene-editing-fixture-v1";

    function loadPersisted() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
      } catch {}
      const beats = ensureScriptBeatIds(INITIAL_BEATS.map((b) => ({ ...b })));
      const framesByKey = {};
      const takesByText = {};
      beats.forEach((b, i) => {
        const key = scriptFrameKey(b, { aspect: "16:9", look: "illus-storybook" });
        framesByKey[key] = makeSvg(\`Frame \${b.id}: \${b.keyword}\`, COLORS[i % COLORS.length]);
        takesByText[voiceText(b.line)] = \`data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=#take-\${b.id}\`;
      });
      return {
        beats,
        keepOverLength: true,
        framesByKey,
        takesByText,
        versions: {
          2: {
            list: [
              { ...beats[2], visual: "Earlier version of Scene 3 visual" },
              { ...beats[2] }
            ],
            at: 1
          }
        }
      };
    }

    function savePersisted(state) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {}
    }

    function FixtureApp() {
      const initial = useRef(loadPersisted()).current;
      const [beats, setBeats] = useState(initial.beats);
      const beatsRef = useRef(beats);
      beatsRef.current = beats;

      const [keepOverLength, setKeepOverLength] = useState(initial.keepOverLength);
      const [framesByKey, setFramesByKey] = useState(initial.framesByKey);
      const [drawingKeys, setDrawingKeys] = useState({});
      const [frameAt, setFrameAt] = useState(() => {
        const map = {};
        initial.beats.forEach((b, i) => {
          const k = scriptFrameKey(b, { aspect: "16:9", look: "illus-storybook" });
          if (initial.framesByKey[k]) map[i] = initial.framesByKey[k];
        });
        return map;
      });
      const [takesByText, setTakesByText] = useState(initial.takesByText);
      const [versions, setVersions] = useState(initial.versions);
      const [voiceErrors, setVoiceErrors] = useState({});
      const [voicingIndices, setVoicingIndices] = useState([]);
      const [flags, setFlags] = useState([]);
      const [undoScene, setUndoScene] = useState(null);
      const [lastAsked, setLastAsked] = useState(null);

      useEffect(() => {
        savePersisted({ beats, keepOverLength, framesByKey, takesByText, versions });
      }, [beats, keepOverLength, framesByKey, takesByText, versions]);

      // Expose a helper on window to simulate a late/stale async frame or voice response for an old index/beatId
      useEffect(() => {
        window.__fixtureSimulateLateFrame = ({ beatId, requestedIndex, svg }) => {
          const liveIdx = beatsRef.current.findIndex((b) => b.id === beatId);
          if (liveIdx >= 0) {
            setFrameAt((curr) => ({ ...curr, [liveIdx]: svg }));
          }
          return liveIdx;
        };
        window.__fixtureSimulateLateVoiceError = ({ beatId, requestedIndex, error }) => {
          const liveIdx = beatsRef.current.findIndex((b) => b.id === beatId);
          if (liveIdx >= 0) {
            setVoiceErrors((curr) => ({ ...curr, [liveIdx]: error }));
          }
          return liveIdx;
        };
      }, []);

      const onInsertScene = async (position, prompt, signal) => {
        const delayMs = window.__fixtureInsertDelayMs ?? 120;
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, delayMs);
          signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
        if (window.__fixtureFailNextInsert) {
          const msg = window.__fixtureFailNextInsert;
          window.__fixtureFailNextInsert = null;
          throw new Error(msg);
        }
        const newId = \`sb-inserted-\${Date.now()}\`;
        const words = prompt.trim().split(/\\s+/).slice(0, 3).join(" ");
        const insertedBeat = {
          id: newId,
          keyword: "Heavy grain sack",
          visual: \`\${prompt.trim()} (bridging Scene \${position} and Scene \${position + 1})\`,
          onScreen: "Too heavy to carry",
          line: "Carrying heavy grain sacks between stalls wore the little hen out before noon."
        };
        const currentBeats = beatsRef.current;
        const nextBeats = [
          ...currentBeats.slice(0, position),
          insertedBeat,
          ...currentBeats.slice(position)
        ];
        setVersions((curr) => remapRecordOnInsert(curr, position));
        setFrameAt((curr) => remapRecordOnInsert(curr, position));
        setVoiceErrors((curr) => remapRecordOnInsert(curr, position));
        setVoicingIndices((curr) => remapIndicesOnInsert(curr, position));
        setFlags((curr) => remapFlagsOnInsert(curr, position));
        setUndoScene(null);
        setBeats(nextBeats);

        // Simulate drawing the new scene's frame asynchronously after insertion
        const newKey = scriptFrameKey(insertedBeat, { aspect: "16:9", look: "illus-storybook" });
        setDrawingKeys((curr) => ({ ...curr, [newKey]: true }));
        setTimeout(() => {
          const drawnSvg = makeSvg(\`Frame \${newId}: \${insertedBeat.keyword}\`, "#e11d48");
          setDrawingKeys((curr) => {
            const next = { ...curr };
            delete next[newKey];
            return next;
          });
          setFramesByKey((curr) => ({ ...curr, [newKey]: drawnSvg }));
          const liveIdx = beatsRef.current.findIndex((b) => b.id === newId);
          if (liveIdx >= 0) {
            setFrameAt((curr) => ({ ...curr, [liveIdx]: drawnSvg }));
          }
        }, window.__fixtureFrameDrawDelayMs ?? 80);
      };

      const onRemoveScene = async (index) => {
        const currentBeats = beatsRef.current;
        if (currentBeats.length <= SCRIPT_BEATS_MIN) {
          throw new Error("A storyboard needs at least one scene.");
        }
        const removedBeat = currentBeats[index];
        const vSnap = remapRecordOnRemove(versions, index);
        const fSnap = remapRecordOnRemove(frameAt, index);
        const eSnap = remapRecordOnRemove(voiceErrors, index);
        const flSnap = remapFlagsOnRemove(flags, index);
        const nextBeats = [...currentBeats.slice(0, index), ...currentBeats.slice(index + 1)];

        setVersions(vSnap.next);
        setFrameAt(fSnap.next);
        setVoiceErrors(eSnap.next);
        setVoicingIndices((curr) => remapIndicesOnRemove(curr, index));
        setFlags(flSnap.next);
        setBeats(nextBeats);
        setUndoScene({
          index,
          keyword: removedBeat.keyword,
          beat: removedBeat,
          versionEntry: vSnap.removed,
          frameSvg: fSnap.removed,
          voiceError: eSnap.removed,
          flags: flSnap.removed
        });
      };

      const onUndoRemoveScene = async () => {
        if (!undoScene) return;
        const snap = undoScene;
        const currentBeats = beatsRef.current;
        const nextBeats = [
          ...currentBeats.slice(0, snap.index),
          snap.beat,
          ...currentBeats.slice(snap.index)
        ];
        setVersions((curr) => {
          const shifted = remapRecordOnInsert(curr, snap.index);
          if (snap.versionEntry) shifted[snap.index] = snap.versionEntry;
          return shifted;
        });
        setFrameAt((curr) => {
          const shifted = remapRecordOnInsert(curr, snap.index);
          if (snap.frameSvg) shifted[snap.index] = snap.frameSvg;
          return shifted;
        });
        setVoiceErrors((curr) => {
          const shifted = remapRecordOnInsert(curr, snap.index);
          if (snap.voiceError) shifted[snap.index] = snap.voiceError;
          return shifted;
        });
        setFlags((curr) => remapFlagsOnInsert(curr, snap.index, snap.flags));
        setBeats(nextBeats);
        setUndoScene(null);
      };

      const frameSlots = beats.map((beat, i) => {
        const key = scriptFrameKey(beat, { aspect: "16:9", look: "illus-storybook" });
        if (drawingKeys[key]) return { state: "drawing" };
        if (framesByKey[key]) return { state: "ready", svg: framesByKey[key] };
        if (frameAt[i]) return { state: "stale", svg: frameAt[i] };
        return undefined;
      });

      const voiceTakes = beats.map((beat) => {
        const t = voiceText(beat.line);
        return t && takesByText[t] ? takesByText[t] : null;
      });
      const allVoiced = beats.length > 0 && beats.every((b, i) => !voiceText(b.line) || Boolean(voiceTakes[i]));

      return (
        <main className="relay-shell relay-shell--storyboard">
          <header className="creation-header">
            <div className="creation-project">
              <button type="button">← Projects</button>
              <i />
              <strong>How Money Evolves</strong>
              <span>Draft storyboard</span>
            </div>
            <ol className="flow-steps">
              <li><button type="button" className="complete"><b>✓</b>Brief</button><i /></li>
              <li><button type="button" className="current"><b>2</b>Storyboard</button><i /></li>
              <li><button type="button"><b>3</b>Animation</button><i /></li>
              <li><button type="button" disabled><b>4</b>Render</button></li>
            </ol>
          </header>
          {lastAsked && <div id="test-last-asked" hidden>{JSON.stringify(lastAsked)}</div>}
          <ScriptCanvas
            projectId="316f1cbd-b5b9-49af-ae3b-2add10a18ed5"
            keepOverLength={keepOverLength}
            onKeepOverLength={() => setKeepOverLength(true)}
            beats={beats}
            open={null}
            writing={null}
            scoped={false}
            versions={beats.map((_, i) => (versions[i] ? { count: versions[i].list.length, at: versions[i].at } : null))}
            onReimagine={(idx) => {
              const currBeat = beats[idx];
              const nextBeat = { ...currBeat, visual: \`Reimagined visual for \${currBeat.keyword}\` };
              setVersions((curr) => {
                const entry = curr[idx] ?? { list: [currBeat], at: 0 };
                return { ...curr, [idx]: { list: [...entry.list, nextBeat], at: entry.list.length } };
              });
              setBeats((curr) => curr.map((b, i) => (i === idx ? nextBeat : b)));
            }}
            onVersion={(idx, at) => {
              const entry = versions[idx];
              if (!entry || !entry.list[at]) return;
              const list = [...entry.list];
              list[entry.at] = beats[idx];
              setVersions((curr) => ({ ...curr, [idx]: { list, at } }));
              setBeats((curr) => curr.map((b, i) => (i === idx ? list[at] : b)));
            }}
            streaming={false}
            startedAt={Date.now()}
            flags={flags}
            error={null}
            voiced={true}
            length={{ seconds: 30, pace: "calm", locked: false, keepOverLength }}
            onFit={() => {}}
            onEdit={(idx, patch) => {
              setBeats((curr) => curr.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
            }}
            onAsk={(instruction, only) => {
              setLastAsked({ instruction, only: only ?? null });
            }}
            onCancel={() => {}}
            frames={frameSlots}
            aspect="16:9"
            styleName="Storybook"
            onRedraw={(idx) => {
              const b = beats[idx];
              const k = scriptFrameKey(b, { aspect: "16:9", look: "illus-storybook" });
              const svg = makeSvg(\`Frame \${b.id}: \${b.keyword}\`, COLORS[idx % COLORS.length]);
              setFramesByKey((curr) => ({ ...curr, [k]: svg }));
              setFrameAt((curr) => ({ ...curr, [idx]: svg }));
            }}
            voice={{
              state: voicingIndices.length > 0 ? "voicing" : allVoiced ? "ready" : "idle",
              takes: voiceTakes,
              progress: allVoiced ? 100 : 85,
              busyIndices: voicingIndices,
              errors: voiceErrors
            }}
            onConfirm={() => {
              const nextTakes = { ...takesByText };
              beats.forEach((b) => {
                const t = voiceText(b.line);
                if (t && !nextTakes[t]) {
                  nextTakes[t] = \`data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=#take-\${b.id}\`;
                }
              });
              setTakesByText(nextTakes);
            }}
            onRetryVoice={(idx) => {
              if (typeof idx === "number") {
                const b = beats[idx];
                const t = voiceText(b.line);
                setTakesByText((curr) => ({
                  ...curr,
                  [t]: \`data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=#retried-\${b.id}\`
                }));
              }
            }}
            music={true}
            onRender={() => {}}
            rendering={false}
            storyboard={{ state: "ready" }}
            onContinue={() => {}}
            continuing={false}
            onInsertScene={onInsertScene}
            onRemoveScene={onRemoveScene}
            undoScene={undoScene ? { index: undoScene.index, keyword: undoScene.keyword } : null}
            onUndoRemoveScene={onUndoRemoveScene}
            onDismissUndoScene={() => setUndoScene(null)}
          />
        </main>
      );
    }

    createRoot(document.getElementById("root")).render(<FixtureApp />);
  `;

  const bundled = await build({
    stdin: {
      contents: entrySource,
      resolveDir: FRONTEND_DIR,
      sourcefile: "storyboard-scene-editing-entry.tsx",
      loader: "tsx"
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    define: {
      "process.env.NODE_ENV": '"development"',
      "process.env.NEXT_PUBLIC_API_URL": '""',
      "process.env": "{}"
    }
  });
  const jsCode = bundled.outputFiles[0].text;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Storyboard Scene Editing Fixture</title>
  <style>${COMBINED_CSS}</style>
</head>
<body>
  <div id="root"></div>
  <script type="module">${jsCode}</script>
</body>
</html>`;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/" || url.pathname === "/studio") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });

  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/studio?p=316f1cbd-b5b9-49af-ae3b-2add10a18ed5&step=1`,
    close: () => new Promise((resolveClose) => server.close(resolveClose))
  };
}

test("browser verification at 1135x775 and mobile: insert between Scene 2 and Scene 3, pending/cancel/retry/result, remove/undo, reload persistence, and downstream asset integrity", async () => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const server = await startStoryboardSceneEditingServer();
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });

  try {
    const context = await browser.newContext({ viewport: { width: 1135, height: 775 } });
    const page = await context.newPage();
    await page.goto(server.url, { waitUntil: "networkidle" });

    // 1. Verify initial 7 scenes, boundary affordances (before 1, between 1..7, after 7 = 8 boundaries), and compact pinned layout
    const initialSceneCount = await page.locator("li.sc-beat").count();
    assert.equal(initialSceneCount, 7, "initial storyboard has 7 scenes");
    const boundaryCount = await page.locator("li.sc-boundary").count();
    assert.equal(boundaryCount, 8, "8 boundary slots (before Scene 1, between each pair, and after Scene 7)");

    const layoutCheck = await page.evaluate(() => ({
      docScrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      overLengthVisible: Boolean(document.querySelector(".sc-length")),
      statusText: document.querySelector(".sc-head p[role='status']")?.textContent ?? ""
    }));
    assert.equal(layoutCheck.docScrollHeight, layoutCheck.innerHeight, "no unintended page overflow at 1135x775");
    assert.equal(layoutCheck.overLengthVisible, false, "accepted keepOverLength suppresses over-length warning");
    assert.match(layoutCheck.statusText, /7 beats.*7\/7 voiced/);

    // 2. Open boundary composer between Scene 2 and Scene 3 (data-boundary="2")
    const between2And3Btn = page.locator('li.sc-boundary[data-boundary="2"] button.sc-add-scene-btn');
    assert.equal(
      await between2And3Btn.getAttribute("aria-label"),
      "Add a scene between Scene 2 and Scene 3",
      "boundary 2 button has accessible label 'Add a scene between Scene 2 and Scene 3'"
    );
    await between2And3Btn.click();

    const composer = page.locator('li.sc-boundary[data-boundary="2"] .sc-insert-composer');
    await composer.waitFor({ state: "visible" });

    const composerState = await page.evaluate(() => {
      const comp = document.querySelector('li.sc-boundary[data-boundary="2"] .sc-insert-composer');
      const textarea = comp?.querySelector("textarea.sc-insert-textarea");
      return {
        heading: comp?.querySelector(".sc-insert-title")?.textContent ?? "",
        neighbors: comp?.querySelector(".sc-insert-neighbors")?.textContent ?? "",
        runtimeNote: comp?.querySelector(".sc-insert-runtime-note")?.textContent ?? "",
        placeholder: textarea?.getAttribute("placeholder") ?? "",
        isFocused: document.activeElement === textarea
      };
    });
    assert.equal(composerState.heading, "Add a scene between Scene 2 and Scene 3");
    assert.match(composerState.neighbors, /After Scene 2: “Eggs, no thanks”/);
    assert.match(composerState.neighbors, /Before Scene 3: “The long swap”/);
    assert.match(composerState.runtimeNote, /Adding a scene may extend runtime/);
    assert.match(composerState.placeholder, /Describe what happens between Scene 2.*and Scene 3/);
    assert.equal(composerState.isFocused, true, "opening the boundary composer focuses the description textarea");

    await page.screenshot({ path: join(SCREENSHOT_DIR, "01-composer-between-2-and-3.png") });

    // 3. Test failure handling & input retention for retry, then pending state & successful insertion
    const textarea = composer.locator("textarea.sc-insert-textarea");
    const promptText = "The hen struggles to haul a heavy sack of grain between the mill and the bakery.";
    await textarea.fill(promptText);

    await page.evaluate(() => {
      window.__fixtureFailNextInsert = "Temporary network hiccup while generating the scene. Please try again.";
      window.__fixtureInsertDelayMs = 40;
    });
    await composer.locator("button.sc-insert-submit").click();

    const errorAlert = composer.locator(".sc-insert-error[role='alert']");
    await errorAlert.waitFor({ state: "visible" });
    assert.match((await errorAlert.textContent()) ?? "", /Temporary network hiccup/);
    assert.equal(await textarea.inputValue(), promptText, "failed submission retains user prompt for retry");
    assert.equal(await page.locator("li.sc-beat").count(), 7, "failed submission preserves all 7 existing scenes");

    // Now test slow pending state + successful retry
    await page.evaluate(() => {
      window.__fixtureInsertDelayMs = 260;
      window.__fixtureFrameDrawDelayMs = 220;
    });
    const submitClickPromise = composer.locator("button.sc-insert-submit").click();
    await composer.locator(".sc-insert-progress").waitFor({ state: "visible" });
    assert.equal(await composer.locator("button.sc-insert-submit").isDisabled(), true, "submit button disabled while in flight to prevent duplicate submit");
    await page.screenshot({ path: join(SCREENSHOT_DIR, "02-insert-pending-between-2-and-3.png") });
    await submitClickPromise;

    // Wait for insertion to complete (8 scenes)
    await page.waitForFunction(() => document.querySelectorAll("li.sc-beat").length === 8);

    // Check that the newly inserted Scene 3 is focused and begins with Drawing… while existing scenes keep their frames/takes/versions
    const postInsertImmediate = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("li.sc-beat")];
      const activeEl = document.activeElement;
      const decodeSvgText = (img) => {
        if (!img?.src?.startsWith("data:image/svg+xml")) return null;
        return decodeURIComponent(img.src.split(",")[1] ?? "");
      };
      return {
        count: rows.length,
        focusedKeywordAttr: activeEl?.getAttribute("data-scene-keyword"),
        overLengthVisible: Boolean(document.querySelector(".sc-length")),
        scenes: rows.map((row, i) => ({
          num: row.querySelector(".sc-num")?.textContent,
          id: row.getAttribute("data-scene-id"),
          keyword: row.querySelector("textarea.sc-keyword")?.value,
          frameWaitText: row.querySelector(".sc-frame-wait")?.textContent ?? null,
          frameSvgText: decodeSvgText(row.querySelector(".sc-frame img")),
          audioSrc: row.querySelector("audio.sc-take")?.getAttribute("src") ?? null,
          versionBadge: row.querySelector(".sc-versions span")?.textContent ?? null
        }))
      };
    });

    assert.equal(postInsertImmediate.count, 8, "now 8 scenes after insertion");
    assert.equal(postInsertImmediate.focusedKeywordAttr, "2", "newly inserted Scene 3 (index 2) is focused");
    assert.equal(postInsertImmediate.overLengthVisible, false, "duration acceptance is preserved after adding a scene");
    assert.equal(postInsertImmediate.scenes[0].keyword, "A hen wants bread");
    assert.equal(postInsertImmediate.scenes[1].keyword, "Eggs, no thanks");
    assert.equal(postInsertImmediate.scenes[2].keyword, "Heavy grain sack", "inserted scene is at Scene 3 (index 2)");
    assert.equal(postInsertImmediate.scenes[2].audioSrc, null, "inserted Scene 3 starts honestly unvoiced");
    assert.equal(postInsertImmediate.scenes[3].keyword, "The long swap", "original Scene 3 shifted to Scene 4 (index 3)");
    assert.match(postInsertImmediate.scenes[3].frameSvgText ?? "", /Frame sb-scene-3: The long swap/, "shifted Scene 4 retains Scene 3's exact SVG frame");
    assert.match(postInsertImmediate.scenes[3].audioSrc ?? "", /#take-sb-scene-3$/, "shifted Scene 4 retains Scene 3's exact voice take");
    assert.equal(postInsertImmediate.scenes[3].versionBadge, "2/2", "shifted Scene 4 retains Scene 3's version history (2/2)");

    // Wait for the new scene's reference frame to finish drawing
    await page.waitForFunction(() => {
      const thirdRow = document.querySelectorAll("li.sc-beat")[2];
      return Boolean(thirdRow?.querySelector(".sc-frame img"));
    });
    await page.screenshot({ path: join(SCREENSHOT_DIR, "03-inserted-scene-3-result.png") });

    // 4. Remove Scene 2 ("Eggs, no thanks", index 1), verify stale async responses for removed Scene 2 do NOT attach to new Scene 2, and verify Undo!
    const removeScene2Btn = page.locator('li.sc-beat[data-scene-index="1"] button.sc-remove');
    assert.equal(await removeScene2Btn.getAttribute("aria-label"), "Remove Scene 2: Eggs, no thanks");
    await removeScene2Btn.click();

    await page.waitForFunction(() => document.querySelectorAll("li.sc-beat").length === 7);
    const undoBanner = page.locator(".sc-undo-banner");
    await undoBanner.waitFor({ state: "visible" });
    assert.match((await undoBanner.textContent()) ?? "", /Removed Scene 2 \(“Eggs, no thanks”\)/);

    // Simulate a late frame and voice error arriving for the removed Scene 2 (id "sb-scene-2", old index 1)
    const lateResult = await page.evaluate(() => {
      const fIdx = window.__fixtureSimulateLateFrame({
        beatId: "sb-scene-2",
        requestedIndex: 1,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>LEAKED_STALE_FRAME</text></svg>'
      });
      const vIdx = window.__fixtureSimulateLateVoiceError({
        beatId: "sb-scene-2",
        requestedIndex: 1,
        error: "LEAKED_STALE_VOICE_ERROR"
      });
      const newScene2 = document.querySelectorAll("li.sc-beat")[1];
      return {
        fIdx,
        vIdx,
        newScene2Keyword: newScene2?.querySelector("textarea.sc-keyword")?.value,
        newScene2Flags: newScene2?.querySelector(".sc-flag")?.textContent ?? null
      };
    });
    assert.equal(lateResult.fIdx, -1, "late frame for removed Scene 2 is ignored");
    assert.equal(lateResult.vIdx, -1, "late voice error for removed Scene 2 is ignored");
    assert.equal(lateResult.newScene2Keyword, "Heavy grain sack");
    assert.equal(lateResult.newScene2Flags, null, "no error leaked onto new Scene 2");

    await page.screenshot({ path: join(SCREENSHOT_DIR, "04-removed-scene-2-with-undo.png") });

    // Click Undo and verify Scene 2 ("Eggs, no thanks") is restored at index 1 with its original frame and audio take intact
    await undoBanner.locator("button.sc-undo-btn").click();
    await page.waitForFunction(() => document.querySelectorAll("li.sc-beat").length === 8);

    const afterUndo = await page.evaluate(() => {
      const row2 = document.querySelectorAll("li.sc-beat")[1];
      const img = row2?.querySelector(".sc-frame img");
      const svgText = img?.src ? decodeURIComponent(img.src.split(",")[1] ?? "") : "";
      return {
        keyword: row2?.querySelector("textarea.sc-keyword")?.value,
        svgText,
        audioSrc: row2?.querySelector("audio.sc-take")?.getAttribute("src") ?? null
      };
    });
    assert.equal(afterUndo.keyword, "Eggs, no thanks", "Undo restored Scene 2 at index 1");
    assert.match(afterUndo.svgText, /Frame sb-scene-2: Eggs, no thanks/, "Undo restored Scene 2's original SVG frame");
    assert.match(afterUndo.audioSrc ?? "", /#take-sb-scene-2$/, "Undo restored Scene 2's original voice take");

    // 5. Reload page and verify all 8 scenes (including inserted Scene 3 and restored Scene 2) persist across reload
    await page.reload({ waitUntil: "networkidle" });
    const afterReload = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("li.sc-beat")];
      return {
        count: rows.length,
        keywords: rows.map((r) => r.querySelector("textarea.sc-keyword")?.value),
        overLengthVisible: Boolean(document.querySelector(".sc-length"))
      };
    });
    assert.equal(afterReload.count, 8, "8 scenes persist after page reload");
    assert.equal(afterReload.keywords[1], "Eggs, no thanks");
    assert.equal(afterReload.keywords[2], "Heavy grain sack");
    assert.equal(afterReload.keywords[3], "The long swap");
    assert.equal(afterReload.overLengthVisible, false, "keepOverLength persists after page reload");

    await page.screenshot({ path: join(SCREENSHOT_DIR, "05-reloaded-persisted-8-scenes.png") });

    // 6. Verify existing flows still work: version switching on Scene 4 ("The long swap", index 3), selection & bottom global prompt
    const prevVersionBtn = page.locator('li.sc-beat[data-scene-index="3"] .sc-versions button').first();
    await prevVersionBtn.click();
    const switchedVisual = await page.locator('li.sc-beat[data-scene-index="3"] textarea.sc-visual').inputValue();
    assert.equal(switchedVisual, "Earlier version of Scene 3 visual", "version switching works on shifted scene");

    await page.locator('li.sc-beat[data-scene-index="2"] button.sc-num').click();
    assert.equal(await page.locator(".sc-chip").count(), 1, "clicking scene number selects scene for bottom prompt");
    await page.locator(".sc-ask-row input").fill("Make this scene funnier");
    await page.locator(".sc-ask-row button.sc-send").click();
    const askedJson = await page.locator("#test-last-asked").textContent();
    assert.deepEqual(JSON.parse(askedJson ?? "{}"), { instruction: "Make this scene funnier", only: [2] }, "global bottom prompt sends selected scene index");

    // 7. Test cancelling an in-flight insertion: preserves all 8 scenes and retains prompt text for retry
    await page.evaluate(() => {
      window.__fixtureInsertDelayMs = 2000;
    });
    await page.locator('li.sc-boundary[data-boundary="0"] button.sc-add-scene-btn').click();
    const firstComposer = page.locator('li.sc-boundary[data-boundary="0"] .sc-insert-composer');
    await firstComposer.waitFor({ state: "visible" });
    await firstComposer.locator("textarea.sc-insert-textarea").fill("Sunrise over the sleepy village square");
    await firstComposer.locator("button.sc-insert-submit").click();
    await firstComposer.locator(".sc-insert-progress").waitFor({ state: "visible" });
    await firstComposer.locator("button.sc-insert-cancel").click();
    assert.equal(await page.locator("li.sc-beat").count(), 8, "cancelling in-flight insert preserves all 8 scenes");
    assert.equal(
      await firstComposer.locator("textarea.sc-insert-textarea").inputValue(),
      "Sunrise over the sleepy village square",
      "cancelling in-flight insert retains user prompt in composer"
    );
    await firstComposer.locator("button.sc-insert-cancel").click();

    // 8. Mobile viewport (390x844) usability check
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('li.sc-boundary[data-boundary="2"] button.sc-add-scene-btn').click();
    await page.locator('li.sc-boundary[data-boundary="2"] .sc-insert-composer').waitFor({ state: "visible" });
    const mobileFits = await page.evaluate(() => {
      const comp = document.querySelector('li.sc-boundary[data-boundary="2"] .sc-insert-composer');
      const rect = comp?.getBoundingClientRect();
      return Boolean(rect && rect.left >= 0 && rect.right <= window.innerWidth + 1);
    });
    assert.equal(mobileFits, true, "inline composer fits cleanly inside 390px mobile viewport without horizontal overflow");
    await page.screenshot({ path: join(SCREENSHOT_DIR, "06-mobile-390x844-composer.png") });
    await page.locator('li.sc-boundary[data-boundary="2"] button.sc-insert-cancel').click();

    // 9. Verify removing down to 1 scene disables the last remaining scene's Remove button
    for (let remaining = 8; remaining > 1; remaining--) {
      await page.locator('li.sc-beat button.sc-remove').last().click();
      await page.waitForFunction((expected) => document.querySelectorAll("li.sc-beat").length === expected, remaining - 1);
    }
    const lastRemoveBtn = page.locator('li.sc-beat[data-scene-index="0"] button.sc-remove');
    assert.equal(await lastRemoveBtn.isDisabled(), true, "Remove button is disabled when only 1 scene remains");
    assert.equal(await lastRemoveBtn.getAttribute("title"), "A storyboard needs at least one scene");
    // Undo restores the 2nd scene immediately
    await page.locator(".sc-undo-banner button.sc-undo-btn").click();
    await page.waitForFunction(() => document.querySelectorAll("li.sc-beat").length === 2);
    assert.equal(await lastRemoveBtn.isDisabled(), false, "Remove button re-enables once 2 scenes exist");

    await context.close();
  } finally {
    await browser.close();
    await server.close();
  }
});
