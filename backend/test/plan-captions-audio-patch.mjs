// Route and composition tests for PATCH /v1/projects/:id/plan with captions and audioMode patches.
// Run: DATABASE_URL=postgres://videosaas:videosaas@127.0.0.1:55432/plates_unit PLANNER=deterministic node test/plan-captions-audio-patch.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { assertThrowawayDb } from "./support/throwaway-db.mjs";

process.env.APP_ENV = "local";
process.env.PLANNER = "deterministic";
process.env.CREEM_API_KEY = "";
assertThrowawayDb();

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const RUNTIME_JS = readFileSync(join(REPO_ROOT, "node_modules/hyperframes/dist/hyperframe-runtime.js"), "utf8");
const GSAP_JS = readFileSync(join(REPO_ROOT, "node_modules/gsap/dist/gsap.min.js"), "utf8");

const { migrate, pool } = await import("../src/db/database.ts");
const { createProject, getProject } = await import("../src/projects/store.ts");
const { registerPlanRoutes, applyPlanEdits } = await import("../src/plan/routes.ts");

await migrate();

const app = Fastify();
await registerPlanRoutes(app);
await app.ready();

const TEST_OWNER = randomUUID();
const createdProjects = [];
await pool.query("delete from app.projects where owner_id = $1", [TEST_OWNER]);

function makeSeedData() {
  const beats = [
    {
      id: "b1",
      role: "setup",
      kind: "kinetic",
      producer: "hyperframes",
      line: "Every product update deserves a clear story that customers watch.",
      verb: null,
      keyword: "Ship updates faster",
      on_screen: "Turn release notes into motion",
      success: false,
      energy: "calm",
      motion: {
        camera: "slow push",
        entry: { axis: "x", dir: -1 },
        exit: { axis: "x", dir: -1 },
        text_effect: "waterfall"
      },
      sfx: "impact-bass-1",
      scene: null,
      transition_out: { type: "j-cut", carrier: null }
    },
    {
      id: "b2",
      role: "turn",
      kind: "kinetic",
      producer: "hyperframes",
      line: "Start from a short brief and get a timed storyboard.",
      verb: null,
      keyword: "Paste your brief",
      on_screen: "One prompt builds the plan",
      success: false,
      energy: "calm",
      motion: {
        camera: "slow pan",
        entry: { axis: "x", dir: -1 },
        exit: { axis: "x", dir: -1 },
        text_effect: "waterfall"
      },
      sfx: "pop",
      scene: null,
      transition_out: { type: "j-cut", carrier: null }
    },
    {
      id: "b3",
      role: "resolution",
      kind: "kinetic",
      producer: "hyperframes",
      line: "Approve the animation and render the finished film.",
      verb: null,
      keyword: "Render when ready",
      on_screen: "Export MP4",
      success: true,
      energy: "calm",
      motion: {
        camera: "slow pull-back",
        entry: { axis: "x", dir: -1 },
        exit: { axis: "x", dir: -1 },
        text_effect: "waterfall"
      },
      sfx: "chime",
      scene: null,
      transition_out: { type: "end", carrier: null }
    }
  ];

  const brief = {
    scriptMode: "own",
    text: beats.map((b) => b.line).join(" "),
    durationSeconds: 12,
    aspect: "16:9",
    motionProfile: "smooth",
    pace: "calm",
    audio: { mode: "both", voice: "Kore", musicMood: "warm modern instrumental" },
    captions: "key-phrases",
    template: null,
    theme: "neutral",
    videoType: "promo",
    productName: "Relay"
  };

  const beatPlan = {
    version: "1.0",
    mode: "own-script",
    template: null,
    format: "social",
    canvas: "16:9",
    target_duration_s: 12,
    clock: "voiceover",
    brand: { name: "Relay", motion_profile: "smooth", style_frame: null },
    characters: [],
    beats,
    audio: {
      voice: { engine: "gemini-tts", voice: "Kore", speed: 1, direction: "clear narration" },
      music: { source: "lyria", prompt: "warm modern instrumental", bpm: 96 },
      captions: "key-phrases"
    },
    approvals: ["script", "storyboard", "motion-preview"],
    suggestions: [],
    estimate: { generated_shots: 0, api_usd: 0.05, render_s: 12 }
  };

  const planAudio = {
    voice: {
      engine: "gemini-tts",
      model: "gemini-2.5-flash-preview-tts",
      voice: "Kore",
      direction: "clear narration",
      pace: "calm",
      lines: beats.map((b, i) => ({
        beat: b.id,
        text: b.line,
        file: `vo/${ "a".repeat(20) }${i}.wav`,
        seconds: 2.3,
        words: b.line.split(/\s+/).map((w, idx, arr) => ({
          text: w,
          start: Number(((idx / arr.length) * 2.2).toFixed(2)),
          end: Number((((idx + 1) / arr.length) * 2.2).toFixed(2))
        })),
        aligned: "whisper"
      }))
    },
    music: {
      source: "lyria",
      model: "lyria-002",
      prompt: "warm modern instrumental",
      file: `music/${ "b".repeat(21) }.wav`,
      seconds: 15
    },
    cost_usd: 0.02,
    updatedAt: new Date().toISOString()
  };

  return { brief, beatPlan, planAudio };
}

async function seedProject() {
  const created = await createProject(
    {
      name: `plan-patch-test-${randomUUID().slice(0, 8)}`,
      request: {
        prompt: "Test project for captions and audioMode plan patches",
        format: "landscape",
        style: "clean",
        theme: "neutral",
        template: "product-launch",
        audio: { music: true, voiceover: true, voice: "Kore" }
      }
    },
    TEST_OWNER
  );
  createdProjects.push(created.id);
  const seed = makeSeedData();
  await pool.query(
    "update app.projects set data = data || $2::jsonb where id = $1",
    [created.id, JSON.stringify(seed)]
  );
  return await getProject(created.id);
}

async function countCaptionElementsInBrowser(browser, html) {
  const context = await browser.newContext();
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/preview.html") {
      await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
      return;
    }
    if (url.pathname.endsWith("/runtime.js")) {
      await route.fulfill({ status: 200, contentType: "application/javascript", body: RUNTIME_JS });
      return;
    }
    if (url.pathname.endsWith("/gsap.js")) {
      await route.fulfill({ status: 200, contentType: "application/javascript", body: GSAP_JS });
      return;
    }
    await route.fulfill({ status: 204, body: "" });
  });
  const page = await context.newPage();
  try {
    await page.goto("http://127.0.0.1:18080/preview.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.__bp && Array.isArray(window.__bp.beats)), { timeout: 10_000 });
    return await page.evaluate(() => {
      const caps = Array.from(document.querySelectorAll("#captions .cap"));
      return {
        count: caps.length,
        texts: caps.map((el) => el.textContent?.trim() ?? "")
      };
    });
  } finally {
    await context.close();
  }
}

let browser = null;
try {
  browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const initial = await seedProject();

  // 1. Valid caption patch ("full") applies, persists, and nothing else in beatPlan changes
  const resFull = await app.inject({
    method: "PATCH",
    url: `/v1/projects/${initial.id}/plan`,
    payload: { captions: "full" }
  });
  assert.equal(resFull.statusCode, 200, `PATCH captions=full failed: ${resFull.body}`);
  const afterFull = resFull.json();
  assert.equal(afterFull.beatPlan.audio.captions, "full");
  assert.equal(afterFull.brief.captions, "full");

  const persistedFull = await getProject(initial.id);
  assert.equal(persistedFull.beatPlan.audio.captions, "full");
  assert.equal(persistedFull.brief.captions, "full");
  assert.deepEqual(
    {
      ...persistedFull.beatPlan,
      audio: { ...persistedFull.beatPlan.audio, captions: initial.beatPlan.audio.captions }
    },
    initial.beatPlan,
    "nothing else in beatPlan changed after captions patch"
  );

  // Composition HTML with captions="full" produces .cap elements in #captions when lines exist
  const htmlFullRes = await app.inject({
    method: "GET",
    url: `/v1/preview/plans/${initial.id}`
  });
  assert.equal(htmlFullRes.statusCode, 200);
  const fullCaps = await countCaptionElementsInBrowser(browser, htmlFullRes.body);
  assert.ok(fullCaps.count > 0, `expected caption elements for captions="full", got ${fullCaps.count}`);
  assert.ok(
    fullCaps.texts.some((t) => t.includes("product update")),
    "caption elements include the beat's spoken line"
  );

  // 2. Valid caption patch ("none") applies, persists, and produces 0 .cap elements in composition HTML
  const resNone = await app.inject({
    method: "PATCH",
    url: `/v1/projects/${initial.id}/plan`,
    payload: { captions: "none" }
  });
  assert.equal(resNone.statusCode, 200);
  const afterNone = await getProject(initial.id);
  assert.equal(afterNone.beatPlan.audio.captions, "none");
  assert.equal(afterNone.brief.captions, "none");

  const htmlNoneRes = await app.inject({
    method: "GET",
    url: `/v1/preview/plans/${initial.id}`
  });
  assert.equal(htmlNoneRes.statusCode, 200);
  const noneCaps = await countCaptionElementsInBrowser(browser, htmlNoneRes.body);
  assert.equal(noneCaps.count, 0, "captions='none' produces 0 .cap elements");

  // 3. Valid audioMode patch ("music") applies, persists, produces no voice tracks in composition HTML, and leaves beatPlan unchanged
  const beforeMusicPlan = structuredClone(afterNone.beatPlan);
  const resMusic = await app.inject({
    method: "PATCH",
    url: `/v1/projects/${initial.id}/plan`,
    payload: { audioMode: "music" }
  });
  assert.equal(resMusic.statusCode, 200);
  const afterMusic = await getProject(initial.id);
  assert.equal(afterMusic.brief.audio.mode, "music");
  assert.deepEqual(afterMusic.beatPlan, beforeMusicPlan, "audioMode patch leaves beatPlan unchanged");

  const htmlMusicRes = await app.inject({
    method: "GET",
    url: `/v1/preview/plans/${initial.id}`
  });
  assert.equal(htmlMusicRes.statusCode, 200);
  assert.ok(!/<audio[^>]+id="vo-/.test(htmlMusicRes.body), "audioMode='music' produces no voice <audio> tracks");
  assert.ok(/<audio[^>]+id="music-bed"/.test(htmlMusicRes.body), "audioMode='music' keeps the music-bed <audio> track");

  // And audioMode="both" restores the voice tracks
  const resBoth = await app.inject({
    method: "PATCH",
    url: `/v1/projects/${initial.id}/plan`,
    payload: { audioMode: "both" }
  });
  assert.equal(resBoth.statusCode, 200);
  const htmlBothRes = await app.inject({
    method: "GET",
    url: `/v1/preview/plans/${initial.id}`
  });
  assert.ok(/<audio[^>]+id="vo-b1"/.test(htmlBothRes.body), "audioMode='both' includes voice <audio> tracks");
  assert.ok(/<audio[^>]+id="music-bed"/.test(htmlBothRes.body), "audioMode='both' includes music-bed <audio> track");

  // 4. Invalid values are rejected with 4xx and existing error shape without changing the plan
  const snapshotBeforeInvalid = await getProject(initial.id);
  for (const invalidPayload of [
    { captions: "karaoke" },
    { captions: 42 },
    { captions: null },
    { audioMode: "sfx-only" },
    { audioMode: 123 },
    { audioMode: null }
  ]) {
    const unitResult = applyPlanEdits(snapshotBeforeInvalid, invalidPayload);
    assert.ok("problems" in unitResult && unitResult.problems.length > 0, `applyPlanEdits rejects ${JSON.stringify(invalidPayload)}`);

    const badRes = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${initial.id}/plan`,
      payload: invalidPayload
    });
    assert.ok(badRes.statusCode >= 400 && badRes.statusCode < 500, `expected 4xx for ${JSON.stringify(invalidPayload)}, got ${badRes.statusCode}`);
    const body = badRes.json();
    assert.equal(body.error?.code, "plan_problems");
    assert.equal(typeof body.error?.message, "string");
    assert.ok(Array.isArray(body.problems) && body.problems.length > 0);
  }

  const snapshotAfterInvalid = await getProject(initial.id);
  assert.deepEqual(snapshotAfterInvalid.beatPlan, snapshotBeforeInvalid.beatPlan, "invalid patches did not mutate beatPlan");
  assert.deepEqual(snapshotAfterInvalid.brief, snapshotBeforeInvalid.brief, "invalid patches did not mutate brief");

  console.log("plan-captions-audio-patch: ok");
} finally {
  if (browser) await browser.close().catch(() => {});
  await app.close();
  await pool.query("delete from app.projects where owner_id = $1 or id = any($2)", [TEST_OWNER, createdProjects]);
  await pool.end();
}
