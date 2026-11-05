// Backend integration test for HyperFrames element-level and scene-level comment edits (Two-Step Browser Measurement Protocol):
// - 0 differing pixels across engine scene kinds when no override is present (vs pre-4a baseline fixture 88d4efa)
// - 13+1 isolated comment scenarios on the two-step protocol:
//   1. Test harness measures `before` snapshots in headless Chrome (as the user's browser does) across `resolveBeatWindowTimes`
//   2. Server receives JSON at `POST /v1/projects/:id/plan/edit/propose` and returns candidate `EditPatch` + `planVersion`
//   3. Test harness applies candidate in isolation via `applyCandidatePatchToPreviewHtml` (`hf-variables`) and measures `after` snapshots
//   4. Server receives JSON at `POST /v1/projects/:id/plan/edit/commit`, runs pure `classifyEditPatch` / `checkSceneHintLayout`, and saves
// - Also tests `DELETE /v1/projects/:id/plan/overrides/:el` and engine-side `#bp-overrides` CSS injection hardening.
// Run: DATABASE_URL=postgres://videosaas:videosaas@127.0.0.1:55432/plates_unit PLANNER=deterministic node --experimental-strip-types test/plan-element-edits.mjs

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { assertThrowawayDb } from "./support/throwaway-db.mjs";

// A7: Unconditional environment gates so inherited variables cannot send the test to a model or moderation
process.env.APP_ENV = "local";
process.env.PLANNER = "deterministic";
process.env.CREEM_API_KEY = "";
assertThrowawayDb();

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASELINE_TEMPLATE_HTML = readFileSync(
  join(HERE, "fixtures/plan-template-baseline-88d4efa.html"),
  "utf8"
);
const CURRENT_TEMPLATE_HTML = readFileSync(
  join(REPO_ROOT, "worker/templates/beat-plan/index.html"),
  "utf8"
);
const RUNTIME_JS = readFileSync(join(REPO_ROOT, "node_modules/hyperframes/dist/hyperframe-runtime.js"), "utf8");
const GSAP_JS = readFileSync(join(REPO_ROOT, "node_modules/gsap/dist/gsap.min.js"), "utf8");
const FONTS_CSS = readFileSync(join(REPO_ROOT, "worker/fonts/fonts.css"), "utf8");
const THEME_NEUTRAL_CSS = readFileSync(join(REPO_ROOT, "worker/themes/neutral.css"), "utf8");

// Preload font files into memory once so headless Chrome requests never block on disk I/O or CDP route IPC
const FONTS_DIR = join(REPO_ROOT, "worker/fonts");
const FONT_BUFFERS = new Map();
for (const entry of readdirSync(FONTS_DIR)) {
  if (entry.endsWith(".woff2")) {
    FONT_BUFFERS.set(entry, readFileSync(join(FONTS_DIR, entry)));
  }
}

const { migrate, pool } = await import("../src/db/database.ts");
const { createProject, getProject } = await import("../src/projects/store.ts");
const { registerPlanRoutes } = await import("../src/plan/routes.ts");
const { buildStandaloneCompositionHtml } = await import("../src/plan/element-edits.ts");
const { projectTiming } = await import("../src/plan/preview.ts");
const {
  applyCandidatePatchToPreviewHtml,
  boxesOverlapArea,
  isBackgroundRole,
  isBoxInsideSafeArea,
  isTextRole,
  mergeWindowElements,
  resolveBeatWindowTimes
} = await import("../../packages/contracts/src/edit-patch.ts");

await migrate();

const app = Fastify();
await registerPlanRoutes(app);
await app.ready();

// A6: Per-run owner UUID and cleanup before and after
const TEST_OWNER = randomUUID();
const createdProjects = [];
await pool.query("delete from app.projects where owner_id = $1", [TEST_OWNER]);

// A4: Ephemeral local HTTP server (port 0 on 127.0.0.1) serving composition HTML, runtime, GSAP, and fonts from memory
let currentServedHtml = "";
const assetServer = createServer((req, res) => {
  const pathname = (req.url ?? "/").split("?")[0];
  if (pathname === "/composition.html" || pathname === "/doc.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(currentServedHtml);
    return;
  }
  if (pathname === "/runtime.js") {
    res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600" });
    res.end(RUNTIME_JS);
    return;
  }
  if (pathname === "/gsap.js") {
    res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600" });
    res.end(GSAP_JS);
    return;
  }
  if (pathname.startsWith("/fonts/")) {
    const fontName = pathname.slice("/fonts/".length);
    const buf = FONT_BUFFERS.get(fontName);
    if (buf) {
      res.writeHead(200, { "Content-Type": "font/woff2", "Cache-Control": "public, max-age=3600" });
      res.end(buf);
      return;
    }
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(204);
  res.end();
});
await new Promise((resolveListen) => assetServer.listen(0, "127.0.0.1", resolveListen));
const assetPort = assetServer.address().port;
const ASSET_ORIGIN = `http://127.0.0.1:${assetPort}`;

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

function makeFourBeatSeed(screenshotId, initialOverrides = undefined) {
  const beats = [
    {
      id: "b1",
      role: "hook",
      kind: "kinetic",
      producer: "hyperframes",
      line: "Every product update deserves a clear story that customers watch.",
      verb: null,
      keyword: "Your story, moving.",
      on_screen: "Every beat of the plan, on screen",
      success: false,
      energy: "high",
      motion: {
        camera: "steady",
        entry: { axis: "x", dir: -1 },
        exit: { axis: "y", dir: -1 },
        text_effect: "waterfall"
      },
      sfx: "impact-bass-1",
      scene: null,
      transition_out: { type: "j-cut", carrier: null }
    },
    {
      id: "b2",
      role: "success",
      kind: "kinetic",
      producer: "hyperframes",
      line: "Start from a short brief and get a timed storyboard.",
      verb: null,
      keyword: "Ready to share.",
      on_screen: "One prompt builds the plan",
      success: true,
      energy: "high",
      motion: {
        camera: "steady",
        entry: { axis: "y", dir: -1 },
        exit: { axis: "x", dir: -1 },
        text_effect: "waterfall"
      },
      sfx: "pop",
      scene: null,
      transition_out: { type: "j-cut", carrier: null }
    },
    {
      id: "b3",
      role: "feature",
      kind: "ui",
      producer: "hyperframes",
      line: "Click the publish button to launch the release.",
      verb: "click",
      keyword: "One click ships.",
      on_screen: "Live inside the dashboard",
      success: false,
      energy: "medium",
      ui: { screen: screenshotId, action: "click", target: "publish button" },
      motion: {
        camera: "steady",
        entry: { axis: "x", dir: -1 },
        exit: { axis: "x", dir: -1 },
        text_effect: "waterfall"
      },
      sfx: "click",
      scene: null,
      transition_out: { type: "j-cut", carrier: null }
    },
    {
      id: "b4",
      role: "cta",
      kind: "title",
      producer: "hyperframes",
      line: "Approve the animation and render the finished film.",
      verb: null,
      keyword: "Make it move.",
      on_screen: "Get started",
      success: false,
      energy: "medium",
      motion: {
        camera: "steady",
        entry: { axis: "x", dir: -1 },
        exit: { axis: "z", dir: 1 },
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
    audio: { mode: "none", voice: "Kore" },
    captions: "key-phrases",
    template: null,
    theme: "neutral",
    videoType: "promo",
    productName: "Relay",
    screenshotIds: [screenshotId]
  };

  const beatPlan = {
    version: "1.0",
    mode: "own-script",
    template: null,
    format: "social",
    canvas: "16:9",
    target_duration_s: 12,
    clock: "beats",
    brand: { name: "Relay", motion_profile: "smooth", style_frame: null },
    characters: [],
    beats,
    audio: {
      voice: null,
      music: null,
      captions: "key-phrases"
    },
    approvals: ["script", "storyboard", "motion-preview"],
    suggestions: [],
    ...(initialOverrides ? { overrides: initialOverrides } : {}),
    estimate: { generated_shots: 0, api_usd: 0.05, render_s: 12 }
  };

  return { brief, beatPlan };
}

async function seedTestProject(initialOverrides = undefined) {
  const created = await createProject(
    {
      name: `element-edits-test-${randomUUID().slice(0, 8)}`,
      request: {
        prompt: "Test project for HyperFrames element-level and scene-level comment edits",
        format: "landscape",
        style: "clean",
        theme: "neutral",
        template: "product-launch",
        audio: { music: false, voiceover: false, voice: "Kore" }
      }
    },
    TEST_OWNER
  );
  createdProjects.push(created.id);
  const shotId = randomUUID();
  const seed = makeFourBeatSeed(shotId, initialOverrides);
  const screenshots = [
    {
      id: shotId,
      name: "dashboard.png",
      purpose: "Dashboard",
      width: 1600,
      height: 1000,
      createdAt: new Date().toISOString()
    }
  ];
  await pool.query("update app.projects set data = data || $2::jsonb where id = $1", [
    created.id,
    JSON.stringify({ ...seed, screenshots })
  ]);
  const loaded = await getProject(created.id);
  assert.ok(loaded?.beatPlan, "seeded project has beatPlan");
  return loaded;
}

let navSeq = 0;

/**
 * A1 & A5: Samples `window.__bp.elementsAt(t)` on a reusable Page after explicit readiness:
 * `document.readyState === "complete"`, `window.__bp?.elementsAt`, `document.fonts.ready`,
 * and two settled `requestAnimationFrame` ticks, with a 10 s timeout.
 */
async function sampleHtmlInTestBrowser(page, html, times) {
  currentServedHtml = html;
  navSeq += 1;
  await page.goto(`${ASSET_ORIGIN}/composition.html?seq=${navSeq}`, { waitUntil: "load", timeout: 10_000 });
  await page.waitForFunction(
    () => document.readyState === "complete" && Boolean(window.__bp?.elementsAt),
    { timeout: 10_000 }
  );
  return await page.evaluate(async (sampleTimes) => {
    if (document.fonts) {
      await Promise.all(Array.from(document.fonts).map((f) => f.load().catch(() => {})));
      if (document.fonts.ready) await document.fonts.ready;
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return sampleTimes.map((t) => ({
      time: Math.round(t * 1000) / 1000,
      elements: window.__bp.elementsAt(t)
    }));
  }, times);
}

// Cache unedited base-project window snapshots by `scene|at` so identical seed projects don't re-measure unchanged HTML
const uneditedWindowCache = new Map();

/**
 * Runs the two-step edit protocol (`propose` -> isolated local apply in browser -> `commit`).
 */
async function runTwoStepEditInBrowser(page, projectId, inputComments, { canUseUneditedCache = false } = {}) {
  const project = await getProject(projectId);
  const { html: baseHtml, canvas } = await buildStandaloneCompositionHtml(project);
  const timingBeats = projectTiming(project)?.beats;

  const commentsPayload = inputComments.map((c, idx) => ({
    id: c.id ?? `c-${idx + 1}`,
    at: c.at ?? c.atSeconds ?? 0,
    ...(c.scene !== undefined ? { scene: c.scene } : {}),
    ...(c.body ?? c.comment ? { body: c.body ?? c.comment } : {}),
    ...(c.patch ? { patch: c.patch } : {})
  }));

  const sampleTimesById = new Map();
  const beforeSnapshotsById = {};
  const mergedBeforeById = new Map();

  for (const c of commentsPayload) {
    const { sampleTimes } = resolveBeatWindowTimes(project, c.scene, c.at, timingBeats);
    sampleTimesById.set(c.id, sampleTimes);
    const cacheKey = `${String(c.scene ?? "")}|${sampleTimes.join(",")}`;
    let snaps;
    if (canUseUneditedCache && uneditedWindowCache.has(cacheKey)) {
      snaps = structuredClone(uneditedWindowCache.get(cacheKey));
    } else {
      snaps = await sampleHtmlInTestBrowser(page, baseHtml, sampleTimes);
      if (canUseUneditedCache) {
        uneditedWindowCache.set(cacheKey, structuredClone(snaps));
      }
    }
    beforeSnapshotsById[c.id] = snaps;
    mergedBeforeById.set(c.id, mergeWindowElements(snaps));
  }

  // Step 1: Propose
  const proposeRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/plan/edit/propose`,
    payload: {
      comments: commentsPayload,
      measured: {
        canvas,
        snapshots: beforeSnapshotsById
      }
    }
  });
  assert.equal(proposeRes.statusCode, 200, `propose failed: ${proposeRes.body}`);
  const proposeBody = proposeRes.json();

  if (proposeBody.candidates.every((cand) => Boolean(cand.refused))) {
    const firstCand = proposeBody.candidates[0];
    return {
      statusCode: 422,
      proposeBody,
      json: () => ({
        error: { code: "edit_refused", message: firstCand.refused },
        problems: [firstCand.refused]
      })
    };
  }

  // Step 2: Apply each candidate patch in isolation against `baseHtml` (`hf-variables`) and re-sample `after`
  const commitItems = [];
  for (const cand of proposeBody.candidates) {
    if (cand.refused || !cand.patch) continue;
    const beforeSnaps = beforeSnapshotsById[cand.id];
    const candidateHtml = applyCandidatePatchToPreviewHtml(baseHtml, [cand.patch], {
      activeElements: mergedBeforeById.get(cand.id)
    });
    const sampleTimes = sampleTimesById.get(cand.id);
    const afterSnaps = await sampleHtmlInTestBrowser(page, candidateHtml, sampleTimes);
    commitItems.push({
      id: cand.id,
      patch: cand.patch,
      before: beforeSnaps,
      after: afterSnaps,
      ...(cand.fallbackRewrite ? { fallbackRewrite: true } : {})
    });
  }

  // Step 3: Commit
  const commitRes = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/plan/edit/commit`,
    payload: {
      planVersion: proposeBody.planVersion,
      items: commitItems
    }
  });
  return commitRes;
}

/**
 * A2 & A3: Compares the checked-in pre-4a baseline fixture (`88d4efa`) against the current rebuilt
 * `worker/templates/beat-plan/index.html` using explicit readiness signals (no fixed sleeps).
 */
async function compareTemplateZeroDiff(browserInstance, diffHelperPage) {
  const planObj = {
    canvas: "16:9",
    motion_profile: "smooth",
    captions: "full",
    beats: [
      {
        id: "b1",
        role: "hook",
        kind: "kinetic",
        keyword: "Your story, moving.",
        on_screen: "Every beat of the plan, on screen",
        line: "Every product update deserves a clear story.",
        verb: null,
        success: false,
        energy: "high",
        ui: null,
        motion: { entry: { axis: "x", dir: -1 }, exit: { axis: "y", dir: -1 } },
        transition_out: { type: "j-cut" },
        start: 0,
        end: 2.6
      },
      {
        id: "b2",
        role: "feature",
        kind: "ui",
        keyword: "One click ships.",
        on_screen: "Live inside the dashboard",
        line: "Click the publish button to launch.",
        verb: "click",
        success: true,
        energy: "medium",
        ui: { screen: "s1", action: "click", target: "button", aspect: 1.6 },
        motion: { entry: { axis: "y", dir: -1 }, exit: { axis: "x", dir: -1 } },
        transition_out: { type: "j-cut" },
        start: 2.6,
        end: 5.2,
        act_at: 3.6,
        success_at: 4.3
      },
      {
        id: "b3",
        role: "cta",
        kind: "title",
        keyword: "Make it move.",
        on_screen: "Get started",
        line: "Approve and render in a single click.",
        verb: null,
        success: false,
        energy: "medium",
        ui: null,
        motion: { entry: { axis: "x", dir: -1 }, exit: { axis: "z", dir: 1 } },
        transition_out: { type: "end" },
        start: 5.2,
        end: 7.8
      }
    ]
  };

  const varsScript = `<script>window.__hfVariables = ${JSON.stringify({
    plan: JSON.stringify(planObj),
    brandName: "Relay",
    "shot.s1": "data:image/png;base64," + TINY_PNG.toString("base64")
  })};</script>\n<script src="/runtime.js"></script>\n<script src="/gsap.js"></script>`;

  const prepareDoc = (raw) =>
    raw
      .replace('<script src="vendor/gsap.min.js"></script>', () => varsScript)
      .replace(
        "</head>",
        () => `<style id="fonts">${FONTS_CSS}</style><style id="theme">${THEME_NEUTRAL_CSS}</style></head>`
      );

  const oldDoc = prepareDoc(BASELINE_TEMPLATE_HTML);
  const newDoc = prepareDoc(CURRENT_TEMPLATE_HTML);

  const sampleTimes = [1.2, 3.8, 6.6];
  const captureDocInCleanContext = async (docText) => {
    const context = await browserInstance.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    try {
      const p = await context.newPage();
      currentServedHtml = docText;
      navSeq += 1;
      await p.goto(`${ASSET_ORIGIN}/doc.html?seq=${navSeq}`, { waitUntil: "load", timeout: 10_000 });
      await p.waitForFunction(
        () =>
          document.readyState === "complete" &&
          Boolean(window.__timelines?.main) &&
          Array.isArray(window.__bp?.beats) &&
          window.__bp.beats.length === 3,
        { timeout: 10_000 }
      );
      await p.evaluate(async () => {
        if (document.fonts) {
          await Promise.all(Array.from(document.fonts).map((f) => f.load().catch(() => {})));
          if (document.fonts.ready) await document.fonts.ready;
        }
        await Promise.all(
          Array.from(document.images).map((img) =>
            typeof img.decode === "function" ? img.decode().catch(() => {}) : Promise.resolve()
          )
        );
        window.__timelines.main.seek(6.6, false);
        window.__timelines.main.seek(0, false);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      });
      const shots = {};
      for (const t of sampleTimes) {
        await p.evaluate(async (sec) => {
          window.__timelines.main.seek(sec, false);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        }, t);
        shots[t] = (await p.screenshot()).toString("base64");
      }
      return shots;
    } finally {
      await context.close();
    }
  };

  const oldShots = await captureDocInCleanContext(oldDoc);
  const newShots = await captureDocInCleanContext(newDoc);

  const frameDiffs = {};
  for (const t of sampleTimes) {
    const diff = await diffHelperPage.evaluate(
      async ([a, b]) => {
        const load = async (b64) => {
          const img = new Image();
          img.src = "data:image/png;base64," + b64;
          await img.decode();
          const cv = new OffscreenCanvas(img.width, img.height);
          const ctx = cv.getContext("2d");
          ctx.drawImage(img, 0, 0);
          return ctx.getImageData(0, 0, img.width, img.height).data;
        };
        const [p, q] = [await load(a), await load(b)];
        let differing = 0;
        let maxDelta = 0;
        let minx = 1e9, maxx = -1, miny = 1e9, maxy = -1;
        for (let i = 0; i < p.length; i += 4) {
          const d = Math.max(
            Math.abs(p[i] - q[i]),
            Math.abs(p[i + 1] - q[i + 1]),
            Math.abs(p[i + 2] - q[i + 2])
          );
          // Raster noise: a lone pixel off by one level shows up between two renders of the SAME html (same convention as
          // tools/phase3/compare.mjs: only differences over 2 levels count).
          if (d > 2) {
            differing++;
            if (d > maxDelta) maxDelta = d;
            const px = (i / 4) % 1920, py = Math.floor(i / 4 / 1920);
            minx = Math.min(minx, px); maxx = Math.max(maxx, px);
            miny = Math.min(miny, py); maxy = Math.max(maxy, py);
          }
        }
        return { differing, maxDelta, bbox: [minx, miny, maxx, maxy] };
      },
      [oldShots[t], newShots[t]]
    );
    console.log(`diff at t=${t}:`, JSON.stringify(diff));
    frameDiffs[t] = diff;
    assert.equal(
      diff.differing,
      0,
      `Expected 0 differing pixels at t=${t}s when no override is present, got ${diff.differing}`
    );
  }
  return frameDiffs;
}

function verifyNoForegroundOverlapsAndSafeArea(elements, beatId, canvas = { width: 1920, height: 1080 }, elementsBefore = null) {
  const fg = elements.filter(
    (el) => (el.beat === beatId || el.id.startsWith(`${beatId}:`)) && !isBackgroundRole(el.role) && isTextRole(el.role)
  );
  const beforeMap = elementsBefore ? new Map(elementsBefore.map((e) => [e.id, e])) : null;
  let overlaps = 0;
  let safeViolations = 0;
  for (let i = 0; i < fg.length; i++) {
    const a = fg[i];
    const actionSafe = isBoxInsideSafeArea(a.box, canvas.width, canvas.height, "card");
    if (!actionSafe.ok) {
      safeViolations++;
    } else {
      const titleSafe = isBoxInsideSafeArea(a.box, canvas.width, canvas.height, a.role);
      if (!titleSafe.ok) {
        const prev = beforeMap?.get(a.id);
        const wasTitleSafe = prev ? isBoxInsideSafeArea(prev.box, canvas.width, canvas.height, prev.role).ok : false;
        if (wasTitleSafe) safeViolations++;
      }
    }
    for (let j = i + 1; j < fg.length; j++) {
      const b = fg[j];
      if (boxesOverlapArea(a.box, b.box, 2) > 4) {
        overlaps++;
      }
    }
  }
  return { fgCount: fg.length, overlaps, safeViolations };
}

let browser = null;
let sharedContext = null;
try {
  browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  sharedContext = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await sharedContext.newPage();

  // Warm all @font-face rules in sharedContext before any composition script runs `camTextBox()` at parse time
  currentServedHtml = `<!doctype html><html><head><style>${FONTS_CSS}</style><style>${THEME_NEUTRAL_CSS}</style></head><body>Warm</body></html>`;
  await page.goto(`${ASSET_ORIGIN}/doc.html?warm=0`, { waitUntil: "load", timeout: 10_000 });
  await page.evaluate(async () => {
    if (document.fonts) {
      await Promise.all(Array.from(document.fonts).map((f) => f.load().catch(() => {})));
      if (document.fonts.ready) await document.fonts.ready;
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });

  // 1. Verify 0 differing pixels across kinetic, ui, and title scenes when no override is present (vs 88d4efa fixture)
  const zeroDiffEvidence = await compareTemplateZeroDiff(browser, page);
  console.log("0-diff baseline parity across scene kinds:", JSON.stringify(zeroDiffEvidence));

  // 2. Seed a probe project to check composition timing and verify GET /plan/elements is 404
  const probeProject = await seedTestProject();
  const compRes = await app.inject({ method: "GET", url: `/v1/projects/${probeProject.id}/composition` });
  assert.equal(compRes.statusCode, 200);
  const compJson = compRes.json();
  const b1Slot = compJson.beatTimes.b1;
  const b2Slot = compJson.beatTimes.b2;
  const b3Slot = compJson.beatTimes.b3;
  const b4Slot = compJson.beatTimes.b4;

  const tB1 = Number(((b1Slot.start + b1Slot.end) / 2).toFixed(2));
  const tB2 = Number(((b2Slot.start + b2Slot.end) / 2).toFixed(2));
  const tB3 = Number(((b3Slot.start + b3Slot.end) / 2).toFixed(2));
  const tB4 = Number(((b4Slot.start + b4Slot.end) / 2).toFixed(2));
  const tSeam12 = Number(b1Slot.end.toFixed(2));

  const removedElRoute = await app.inject({ method: "GET", url: `/v1/projects/${probeProject.id}/plan/elements?t=${tB2}` });
  assert.equal(removedElRoute.statusCode, 404, "GET /plan/elements was removed from the server");

  // B5 engine check: verify in headless Chrome that CSS injection strings, prototype keys, invalid data-el ids, and out-of-range offsets are ignored by engine.js
  {
    const { html: baseProbeHtml } = await buildStandaloneCompositionHtml(probeProject);
    const maliciousOverrides = {
      "b2:w:2": { color: "red}*{display:none", opacity: 99, dx: 99999, dy: -99999, text: "x".repeat(500) },
      'bad"id]{display:none}': { color: "#ff3b6b" },
      constructor: { color: "toString" }
    };
    const injectedHtml = baseProbeHtml.replace(
      /<script id="hf-variables" type="application\/json">[\s\S]*?<\/script>/,
      () => `<script id="hf-variables" type="application/json">${JSON.stringify({ overrides: maliciousOverrides })}</script>`
    );
    await sampleHtmlInTestBrowser(page, injectedHtml, [tB2]);
    const sheetCheck = await page.evaluate(() => {
      const st = document.getElementById("bp-overrides");
      const w2 = document.querySelector('[data-el="b2:w:2"]');
      return {
        sheetText: st ? st.textContent : null,
        w2Text: w2 ? w2.textContent : null,
        w2Display: w2 ? getComputedStyle(w2).display : null
      };
    });
    assert.equal(sheetCheck.sheetText, null, "Malicious overrides must produce no #bp-overrides rules");
    assert.equal(sheetCheck.w2Text, "share.", "Overlong override text (>280 chars) must be ignored by engine.js");
    assert.notEqual(sheetCheck.w2Display, "none", "CSS injection string must never hide elements");
  }

  const tableRows = [];

  // A8: Each scenario seeds its own isolated project so scenarios never mutate shared state or depend on prior scenarios.

  // Scenario 1: Colour change on one word ("Make 'share.' pink") -> element scope
  {
    const p1 = await seedTestProject();
    const res = await runTwoStepEditInBrowser(page, p1.id, [
      { id: "s1", comment: 'Make "share." pink', atSeconds: tB2, scene: "b2" }
    ], { canUseUneditedCache: true });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.decision.scope, "element");
    assert.equal(body.patch.el, "b2:w:2");
    assert.equal(body.patch.set.color, "#ff3b6b");
    assert.equal(body.project.beatPlan.overrides["b2:w:2"].color, "#ff3b6b");
    const check = verifyNoForegroundOverlapsAndSafeArea(body.results[0].elementsAfter, "b2");
    assert.equal(check.overlaps, 0);
    assert.equal(check.safeViolations, 0);
    tableRows.push({
      n: 1,
      category: "Colour",
      comment: 'Make "share." pink',
      atSeconds: tB2,
      expectedScope: "element",
      measuredScope: body.decision.scope,
      targetEl: body.patch.el,
      outcome: "applied",
      uiLabel: body.decision.uiLabel,
      maxNeighbourDeltaPx: body.decision.measurements.maxNeighbourDeltaPx,
      overlaps: check.overlaps,
      safeViolations: check.safeViolations,
      boxBefore: body.decision.measurements.targetBoxBefore,
      boxAfter: body.decision.measurements.targetBoxAfter
    });
  }

  // Scenario 2: Equal-length-class text replacement ('Change "share." to "ship."') -> element scope
  {
    const p2 = await seedTestProject({ "b2:w:2": { color: "#ff3b6b" } });
    assert.equal(p2.beatPlan.overrides?.["b2:w:2"]?.color, "#ff3b6b");
    const res = await runTwoStepEditInBrowser(page, p2.id, [
      { id: "s2", comment: 'Change "share." to "ship."', atSeconds: tB2, scene: "b2" }
    ]);
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.decision.scope, "element");
    assert.equal(body.patch.el, "b2:w:2");
    assert.equal(body.project.beatPlan.overrides["b2:w:2"].text, "ship.");
    assert.equal(body.project.beatPlan.overrides["b2:w:2"].color, "#ff3b6b");
    const check = verifyNoForegroundOverlapsAndSafeArea(body.results[0].elementsAfter, "b2");
    assert.equal(check.overlaps, 0);
    assert.equal(check.safeViolations, 0);
    tableRows.push({
      n: 2,
      category: "Same-length text",
      comment: 'Change "share." to "ship."',
      atSeconds: tB2,
      expectedScope: "element",
      measuredScope: body.decision.scope,
      targetEl: body.patch.el,
      outcome: "applied",
      uiLabel: body.decision.uiLabel,
      maxNeighbourDeltaPx: body.decision.measurements.maxNeighbourDeltaPx,
      overlaps: check.overlaps,
      safeViolations: check.safeViolations,
      boxBefore: body.decision.measurements.targetBoxBefore,
      boxAfter: body.decision.measurements.targetBoxAfter
    });
  }

  // Scenario 3: Position nudge ('Nudge "ship." right 28px') -> element scope
  {
    const p3 = await seedTestProject({ "b2:w:2": { color: "#ff3b6b", text: "ship." } });
    assert.equal(p3.beatPlan.overrides?.["b2:w:2"]?.text, "ship.");
    const res = await runTwoStepEditInBrowser(page, p3.id, [
      { id: "s3", comment: 'Nudge "ship." right 28px', atSeconds: tB2, scene: "b2" }
    ]);
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.decision.scope, "element");
    assert.equal(body.patch.el, "b2:w:2");
    assert.equal(body.project.beatPlan.overrides["b2:w:2"].dx, 28);
    const check = verifyNoForegroundOverlapsAndSafeArea(body.results[0].elementsAfter, "b2");
    assert.equal(check.overlaps, 0);
    assert.equal(check.safeViolations, 0);
    tableRows.push({
      n: 3,
      category: "Clean position nudge",
      comment: 'Nudge "ship." right 28px',
      atSeconds: tB2,
      expectedScope: "element",
      measuredScope: body.decision.scope,
      targetEl: body.patch.el,
      outcome: "applied",
      uiLabel: body.decision.uiLabel,
      maxNeighbourDeltaPx: body.decision.measurements.maxNeighbourDeltaPx,
      overlaps: check.overlaps,
      safeViolations: check.safeViolations,
      boxBefore: body.decision.measurements.targetBoxBefore,
      boxAfter: body.decision.measurements.targetBoxAfter
    });
  }

  // Scenario 4: Undo element override (DELETE /v1/projects/:id/plan/overrides/b2:w:2) -> restores original element
  {
    const p4 = await seedTestProject({ "b2:w:2": { color: "#ff3b6b", text: "ship.", dx: 28 } });
    assert.equal(p4.beatPlan.overrides?.["b2:w:2"]?.text, "ship.");
    const delRes = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${p4.id}/plan/overrides/${encodeURIComponent("b2:w:2")}`
    });
    assert.equal(delRes.statusCode, 200);
    const afterUndo = delRes.json();
    assert.equal(afterUndo.beatPlan.overrides?.["b2:w:2"], undefined);

    const { html } = await buildStandaloneCompositionHtml(afterUndo);
    const snaps = await sampleHtmlInTestBrowser(page, html, [tB2]);
    const elAfterUndo = snaps[0].elements;
    const restoredWord = elAfterUndo.find((e) => e.id === "b2:w:2");
    assert.equal(restoredWord.text, "share.");
    const check = verifyNoForegroundOverlapsAndSafeArea(elAfterUndo, "b2");
    tableRows.push({
      n: 4,
      category: "Undo override",
      comment: "Undo override on b2:w:2 (DELETE /overrides/b2:w:2)",
      atSeconds: tB2,
      expectedScope: "element",
      measuredScope: "element",
      targetEl: "b2:w:2",
      outcome: "undone (restored 'share.')",
      uiLabel: "undone",
      maxNeighbourDeltaPx: 0,
      overlaps: check.overlaps,
      safeViolations: check.safeViolations,
      boxBefore: null,
      boxAfter: restoredWord.box
    });
  }

  // Scenario 5: Two comments on the same element in one batch ('Make "share." cyan' + 'Nudge "share." right 24px')
  {
    const p5 = await seedTestProject();
    const res = await runTwoStepEditInBrowser(page, p5.id, [
      { id: "c1", at: tB2, scene: "b2", body: 'Make "share." cyan' },
      { id: "c2", at: tB2, scene: "b2", body: 'Nudge "share." right 24px' }
    ], { canUseUneditedCache: true });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.results.length, 2);
    assert.equal(body.results[0].scope, "element");
    assert.equal(body.results[1].scope, "element");
    assert.deepEqual(body.project.beatPlan.overrides["b2:w:2"], {
      color: "#06b6d4",
      dx: 24
    });
    const check = verifyNoForegroundOverlapsAndSafeArea(body.results[1].elementsAfter, "b2");
    assert.equal(check.overlaps, 0);
    assert.equal(check.safeViolations, 0);
    tableRows.push({
      n: 5,
      category: "Two comments on same element",
      comment: 'Make "share." cyan + Nudge "share." right 24px',
      atSeconds: tB2,
      expectedScope: "element",
      measuredScope: "element",
      targetEl: "b2:w:2",
      outcome: "applied (color=#06b6d4, dx=24)",
      uiLabel: `${body.results[0].uiLabel} + ${body.results[1].uiLabel}`,
      maxNeighbourDeltaPx: body.results[1].decision.measurements.maxNeighbourDeltaPx,
      overlaps: check.overlaps,
      safeViolations: check.safeViolations,
      boxBefore: body.results[0].decision.measurements.targetBoxBefore,
      boxAfter: body.results[1].decision.measurements.targetBoxAfter
    });
  }

  // Scenario 6: Make element bigger ('Make "share." bigger') -> escalates to scene scope (`beat.hints`)
  {
    const p6 = await seedTestProject();
    const res = await runTwoStepEditInBrowser(page, p6.id, [
      { id: "s6", comment: 'Make "share." bigger', atSeconds: tB2, scene: "b2" }
    ], { canUseUneditedCache: true });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.decision.scope, "scene");
    assert.equal(body.decision.reason, "scale-requires-scene-layout");
    const b2Beat = body.project.beatPlan.beats.find((b) => b.id === "b2");
    assert.deepEqual(b2Beat.hints, { emphasize: "b2:w:2", factor: 1.3 });
    const beforeW2 = body.results[0].elementsBefore.find((e) => e.id === "b2:w:2");
    const afterW2 = body.results[0].elementsAfter.find((e) => e.id === "b2:w:2");
    assert.ok(afterW2.box[2] > beforeW2.box[2], "emphasized word width grew after scene layout hint");
    const check = verifyNoForegroundOverlapsAndSafeArea(body.results[0].elementsAfter, "b2");
    assert.equal(check.overlaps, 0, "scene hint produced 0 overlaps");
    assert.equal(check.safeViolations, 0, "scene hint stayed inside safe area");
    tableRows.push({
      n: 6,
      category: "Bigger (scale up)",
      comment: 'Make "share." bigger',
      atSeconds: tB2,
      expectedScope: "scene",
      measuredScope: body.decision.scope,
      targetEl: "b2:w:2",
      outcome: "applied via beat.hints (factor=1.3)",
      uiLabel: body.decision.uiLabel,
      maxNeighbourDeltaPx: 0,
      overlaps: check.overlaps,
      safeViolations: check.safeViolations,
      boxBefore: beforeW2.box,
      boxAfter: afterW2.box
    });
  }

  // Scenario 7: Make element smaller ('Make "moving." smaller' on b1) -> escalates to scene scope (`beat.hints`)
  {
    const p7 = await seedTestProject();
    const res = await runTwoStepEditInBrowser(page, p7.id, [
      { id: "s7", comment: 'Make "moving." smaller', atSeconds: tB1, scene: "b1" }
    ], { canUseUneditedCache: true });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.decision.scope, "scene");
    const b1Beat = body.project.beatPlan.beats.find((b) => b.id === "b1");
    assert.deepEqual(b1Beat.hints, { emphasize: "b1:w:2", factor: 0.78 });
    const beforeW2 = body.results[0].elementsBefore.find((e) => e.id === "b1:w:2");
    const afterW2 = body.results[0].elementsAfter.find((e) => e.id === "b1:w:2");
    assert.ok(afterW2.box[2] < beforeW2.box[2], "de-emphasized word width shrank after scene layout hint");
    const check = verifyNoForegroundOverlapsAndSafeArea(body.results[0].elementsAfter, "b1");
    assert.equal(check.overlaps, 0);
    assert.equal(check.safeViolations, 0);
    tableRows.push({
      n: 7,
      category: "Smaller (scale down)",
      comment: 'Make "moving." smaller',
      atSeconds: tB1,
      expectedScope: "scene",
      measuredScope: body.decision.scope,
      targetEl: "b1:w:2",
      outcome: "applied via beat.hints (factor=0.78)",
      uiLabel: body.decision.uiLabel,
      maxNeighbourDeltaPx: 0,
      overlaps: check.overlaps,
      safeViolations: check.safeViolations,
      boxBefore: beforeW2.box,
      boxAfter: afterW2.box
    });
  }

  // Scenario 8: Longer text replacement -> escalates to scene scope and re-fits font size
  {
    const p8 = await seedTestProject();
    const res = await runTwoStepEditInBrowser(page, p8.id, [
      {
        id: "s8",
        comment: 'Change subtitle to "Every single beat of your product launch plan, rendered live"',
        atSeconds: tB1,
        scene: "b1"
      }
    ], { canUseUneditedCache: true });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.decision.scope, "scene");
    assert.equal(body.decision.reason, "longer-or-different-length-text");
    const b1Beat = body.project.beatPlan.beats.find((b) => b.id === "b1");
    assert.equal(b1Beat.on_screen, "Every single beat of your product launch plan, rendered live");
    const beforeSub = body.results[0].elementsBefore.find((e) => e.id === "b1:sub:0");
    const afterSub = body.results[0].elementsAfter.find((e) => e.id === "b1:sub:0");
    const check = verifyNoForegroundOverlapsAndSafeArea(body.results[0].elementsAfter, "b1");
    assert.equal(check.overlaps, 0);
    assert.equal(check.safeViolations, 0);
    tableRows.push({
      n: 8,
      category: "Longer text",
      comment: 'Change subtitle to "Every single beat of your product launch plan, rendered live"',
      atSeconds: tB1,
      expectedScope: "scene",
      measuredScope: body.decision.scope,
      targetEl: "b1:sub:0",
      outcome: "applied (re-fitted beat.on_screen)",
      uiLabel: body.decision.uiLabel,
      maxNeighbourDeltaPx: 0,
      overlaps: check.overlaps,
      safeViolations: check.safeViolations,
      boxBefore: beforeSub?.box ?? null,
      boxAfter: afterSub?.box ?? null
    });
  }

  // Scenario 9: Move onto another element ('Move "share." onto "Ready"') -> escalates to scene scope for overlap, refused with 422
  {
    const p9 = await seedTestProject();
    const res = await runTwoStepEditInBrowser(page, p9.id, [
      { id: "s9", comment: 'Move "share." onto "Ready"', atSeconds: tB2, scene: "b2" }
    ], { canUseUneditedCache: true });
    assert.equal(res.statusCode, 422, "colliding move must be refused with 422");
    const body = res.json();
    assert.equal(body.error.code, "edit_refused");
    assert.match(body.error.message, /overlap/i);
    assert.equal(body.details.scope, "scene");
    assert.equal(body.details.reason, "overlap-detected");
    assert.ok(body.details.measurements.collidingElements.length > 0);
    tableRows.push({
      n: 9,
      category: "Move onto another element",
      comment: 'Move "share." onto "Ready"',
      atSeconds: tB2,
      expectedScope: "scene",
      measuredScope: body.details.scope,
      targetEl: "b2:w:2",
      outcome: `refused (${body.error.message})`,
      uiLabel: "refused (overlap)",
      maxNeighbourDeltaPx: body.details.measurements.maxNeighbourDeltaPx,
      overlaps: 0,
      safeViolations: 0,
      boxBefore: body.details.measurements.targetBoxBefore,
      boxAfter: body.details.measurements.targetBoxAfter
    });
  }

  // Scenario 10: Off-screen / outside safe area push ('Push "share." right 900px off screen') -> escalates to scene scope, refused with 422
  {
    const p10 = await seedTestProject();
    const res = await runTwoStepEditInBrowser(page, p10.id, [
      { id: "s10", comment: 'Push "share." right 900px off screen', atSeconds: tB2, scene: "b2" }
    ], { canUseUneditedCache: true });
    assert.equal(res.statusCode, 422, "off-screen push must be refused with 422");
    const body = res.json();
    assert.equal(body.error.code, "edit_refused");
    assert.match(body.error.message, /safe/i);
    assert.equal(body.details.scope, "scene");
    assert.equal(body.details.reason, "left-safe-area");
    assert.ok(body.details.measurements.safeAreaViolations.length > 0);
    tableRows.push({
      n: 10,
      category: "Off-screen push",
      comment: 'Push "share." right 900px off screen',
      atSeconds: tB2,
      expectedScope: "scene",
      measuredScope: body.details.scope,
      targetEl: "b2:w:2",
      outcome: `refused (${body.error.message})`,
      uiLabel: "refused (safe area)",
      maxNeighbourDeltaPx: body.details.measurements.maxNeighbourDeltaPx,
      overlaps: 0,
      safeViolations: 0,
      boxBefore: body.details.measurements.targetBoxBefore,
      boxAfter: body.details.measurements.targetBoxAfter
    });
  }

  // Scenario 11: Comment on UI scene kind (b3 is `kind: "ui"`, 'Make "ships." orange') -> element scope
  {
    const p11 = await seedTestProject();
    const res = await runTwoStepEditInBrowser(page, p11.id, [
      { id: "s11", comment: 'Make "ships." orange', atSeconds: tB3, scene: "b3" }
    ], { canUseUneditedCache: true });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.decision.scope, "element");
    assert.equal(body.patch.el, "b3:w:2");
    assert.equal(body.patch.set.color, "#f97316");
    assert.equal(body.project.beatPlan.overrides["b3:w:2"].color, "#f97316");
    assert.ok(body.results[0].elementsAfter.some((e) => e.role === "card"), "UI scene lists card element");
    const check = verifyNoForegroundOverlapsAndSafeArea(body.results[0].elementsAfter, "b3");
    assert.equal(check.overlaps, 0);
    assert.equal(check.safeViolations, 0);
    tableRows.push({
      n: 11,
      category: "UI scene kind (non-kinetic/non-title)",
      comment: 'Make "ships." orange (on UI scene b3)',
      atSeconds: tB3,
      expectedScope: "element",
      measuredScope: body.decision.scope,
      targetEl: body.patch.el,
      outcome: "applied",
      uiLabel: body.decision.uiLabel,
      maxNeighbourDeltaPx: body.decision.measurements.maxNeighbourDeltaPx,
      overlaps: check.overlaps,
      safeViolations: check.safeViolations,
      boxBefore: body.decision.measurements.targetBoxBefore,
      boxAfter: body.decision.measurements.targetBoxAfter
    });
  }

  // Scenario 12: Comment pinned right at a transition seam (`t = b1.end`, 'Make "Ready" green') -> anchors to incoming scene b2
  {
    const p12 = await seedTestProject();
    const res = await runTwoStepEditInBrowser(page, p12.id, [
      { id: "s12", comment: 'Make "Ready" green', atSeconds: tSeam12 }
    ], { canUseUneditedCache: true });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.decision.scope, "element");
    assert.equal(body.patch.el, "b2:w:0");
    assert.equal(body.patch.set.color, "#22c55e");
    const check = verifyNoForegroundOverlapsAndSafeArea(body.results[0].elementsAfter, "b2");
    assert.equal(check.overlaps, 0);
    assert.equal(check.safeViolations, 0);
    tableRows.push({
      n: 12,
      category: "Comment at a transition seam",
      comment: 'Make "Ready" green (pinned at seam b1->b2)',
      atSeconds: tSeam12,
      expectedScope: "element",
      measuredScope: body.decision.scope,
      targetEl: body.patch.el,
      outcome: "applied",
      uiLabel: body.decision.uiLabel,
      maxNeighbourDeltaPx: body.decision.measurements.maxNeighbourDeltaPx,
      overlaps: check.overlaps,
      safeViolations: check.safeViolations,
      boxBefore: body.decision.measurements.targetBoxBefore,
      boxAfter: body.decision.measurements.targetBoxAfter
    });
  }

  // Scenario 13: Title scene CTA pill bigger ('Make the pill bigger' on title scene b4) -> scene scope (`beat.hints` on `b4:pill:0`)
  {
    const p13 = await seedTestProject();
    const res = await runTwoStepEditInBrowser(page, p13.id, [
      { id: "s13", comment: "Make the pill bigger", atSeconds: tB4, scene: "b4" }
    ], { canUseUneditedCache: true });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.decision.scope, "scene");
    const b4Beat = body.project.beatPlan.beats.find((b) => b.id === "b4");
    assert.deepEqual(b4Beat.hints, { emphasize: "b4:pill:0", factor: 1.3 });
    const beforePill = body.results[0].elementsBefore.find((e) => e.id === "b4:pill:0");
    const afterPill = body.results[0].elementsAfter.find((e) => e.id === "b4:pill:0");
    assert.ok(afterPill.box[2] > beforePill.box[2] && afterPill.box[3] > beforePill.box[3]);
    const check = verifyNoForegroundOverlapsAndSafeArea(body.results[0].elementsAfter, "b4");
    assert.equal(check.overlaps, 0);
    assert.equal(check.safeViolations, 0);
    tableRows.push({
      n: 13,
      category: "Title scene CTA pill bigger",
      comment: "Make the pill bigger (on Title scene b4)",
      atSeconds: tB4,
      expectedScope: "scene",
      measuredScope: body.decision.scope,
      targetEl: "b4:pill:0",
      outcome: "applied via beat.hints (factor=1.3)",
      uiLabel: body.decision.uiLabel,
      maxNeighbourDeltaPx: 0,
      overlaps: check.overlaps,
      safeViolations: check.safeViolations,
      boxBefore: beforePill.box,
      boxAfter: afterPill.box
    });
  }

  // Scenario 14 (Impossible hint factor refusal): factor=3.5 is refused in propose and commit (422) and never applied
  {
    const p14 = await seedTestProject();
    const res = await runTwoStepEditInBrowser(page, p14.id, [
      {
        id: "s14",
        at: tB2,
        scene: "b2",
        patch: {
          scope: "scene",
          scene: "b2",
          atSeconds: tB2,
          el: "b2:w:2",
          set: { factor: 3.5 }
        }
      }
    ], { canUseUneditedCache: true });
    assert.equal(res.statusCode, 422);
    const body = res.json();
    assert.equal(body.error.code, "edit_refused");
  }

  console.log("ELEMENT_EDIT_TABLE_JSON:" + JSON.stringify(tableRows));
  console.log("plan-element-edits: ok");
} finally {
  if (sharedContext) await sharedContext.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  assetServer.close();
  await app.close();
  await pool.query("delete from app.projects where owner_id = $1 or id = any($2)", [
    TEST_OWNER,
    createdProjects
  ]);
  await pool.end();
}
