import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import {
  FIXTURE_PROJECT,
  OLD_RUBBER_HOSE_7_BEATS,
  UPDATED_FOLK_TALE_7_BEATS,
  UPDATED_FOLK_TALE_7_PROJECT,
  fixturePlateStatus,
  makeOldRubberHose7Status
} from "./fixtures/workspace/data.ts";
import {
  buildStagePrepProps,
  computeProjectPlateRevision,
  reconcilePlateStatusWithProject,
  sceneProgress
} from "../components/animation-workspace/progress.ts";
import {
  decideSceneMode,
  resolveSceneVariant
} from "../lib/live/live-stage-logic.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(FRONTEND_DIR, "..");
const WS_FIXTURES_DIR = join(FRONTEND_DIR, "test/fixtures/workspace");
const WORKER_FONTS_DIR = join(REPO_ROOT, "worker/fonts");
const SCREENSHOTS_DIR = join(REPO_ROOT, "docs/handoff/screenshots");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const CLIP_16X9 = readFileSync(join(WS_FIXTURES_DIR, "clip-16x9.mp4"));
const CLIP_9X16 = readFileSync(join(WS_FIXTURES_DIR, "clip-9x16.mp4"));
const VOICE_WAV = readFileSync(join(WS_FIXTURES_DIR, "voice.wav"));

const COMBINED_CSS = [
  readFileSync(join(FRONTEND_DIR, "app/theme.css"), "utf8"),
  readFileSync(join(FRONTEND_DIR, "app/styles.css"), "utf8"),
  readFileSync(join(FRONTEND_DIR, "app/animation-workspace.css"), "utf8"),
  readFileSync(join(FRONTEND_DIR, "app/plate-preview.css"), "utf8")
].join("\n");

const FONT_CSS = `
@font-face {
  font-family: 'Plus Jakarta Sans';
  font-style: normal;
  font-weight: 400 600;
  src: url('/fonts/inter-400.woff2') format('woff2');
}
@font-face {
  font-family: 'Plus Jakarta Sans';
  font-style: normal;
  font-weight: 700 800;
  src: url('/fonts/inter-700.woff2') format('woff2');
}
`;

test("Pure revision logic: old 7-scene rubber-hose status reconciled against updated 7-scene Folk-tale project", () => {
  const oldStatus = makeOldRubberHose7Status();
  const knownBySig = new Map();
  const reconciled = reconcilePlateStatusWithProject(oldStatus, UPDATED_FOLK_TALE_7_PROJECT, knownBySig);
  assert.ok(reconciled);
  assert.equal(reconciled.look, "illus-folk-tale");
  assert.equal(reconciled.stale, true);
  assert.equal(reconciled.needsReconcile, true);
  assert.deepEqual(reconciled.drawnAspects, []);
  assert.equal(reconciled.scenes.length, 7);
  assert.deepEqual(
    reconciled.scenes.map((s) => s.keyword),
    UPDATED_FOLK_TALE_7_BEATS.map((b) => b.keyword),
    "reconciled scenes carry the updated Folk-tale titles, never old Rubber-hose titles"
  );
  for (const s of reconciled.scenes) {
    assert.equal(s.stale, true);
    assert.equal(s.state, "queued");
    assert.equal(s.stage, "stale");
    assert.equal(s.variantId, undefined);
    assert.equal(s.bundleDigest, null);
    const rv = resolveSceneVariant(s, "9:16", "9:16");
    assert.equal(rv.stale, true);
    assert.equal(rv.hasBundle, false);
    assert.equal(rv.hasClip, false);
    assert.equal(rv.clipVersion, null);
    const mode = decideSceneMode({ flagEnabled: true, projectMode: "live", variant: rv });
    assert.equal(mode.isReady, false);
    assert.equal(mode.isPlayable, false);
    assert.equal(mode.tabState, "stale");
    assert.equal(mode.tabLabel, "Needs update");
    assert.equal(mode.tabClassName, "needs-update");
    const sp = sceneProgress(s, s.variants?.["9:16"] ?? null, { viewAspect: "9:16", isLiveMode: true, scenes: reconciled.scenes });
    assert.equal(sp.stale, true);
    assert.equal(sp.chipLabel, "Needs update");
    const prep = buildStagePrepProps({
      sceneIndex: s.index,
      sceneCount: 7,
      sceneState: s.state,
      sceneStale: s.stale,
      viewAspect: "9:16",
      primaryAspect: "9:16",
      isViewAspectDrawn: false,
      isViewAspectDrawing: false,
      isPlayable: false,
      sceneProgress: sp
    });
    assert.ok(prep);
    assert.equal(prep.stale, true);
    assert.equal(prep.actionLabel, "Update animation");
    assert.match(prep.title, /Storyboard updated/i);
  }
});

test("Pure revision logic: same-keyword visual/line edit, style-only edit, reorder/remove/insert, and unrelated caption edits", () => {
  const knownBySig = new Map();
  const baseStatus = fixturePlateStatus("c-ready");
  const initialReconciled = reconcilePlateStatusWithProject(baseStatus, FIXTURE_PROJECT, knownBySig);
  assert.equal(initialReconciled.stale, undefined);
  assert.deepEqual(initialReconciled.drawnAspects, ["16:9"]);

  // 1. Unrelated caption / audio mode edits do NOT change computeProjectPlateRevision
  const revBase = computeProjectPlateRevision(FIXTURE_PROJECT);
  const captionEditedProject = {
    ...FIXTURE_PROJECT,
    brief: {
      ...FIXTURE_PROJECT.brief,
      captions: "none",
      audio: { ...FIXTURE_PROJECT.brief.audio, mode: "music" }
    }
  };
  assert.equal(computeProjectPlateRevision(captionEditedProject), revBase, "caption/audio mode changes do not alter plate artwork revision");

  // 2. Same-count, same-keyword visual/line edit on Scene 1 is detected via knownBySig
  const visualEditedBeats = FIXTURE_PROJECT.brief.scriptBeats.map((b, i) =>
    i === 1 ? { ...b, visual: "A completely different visual: a stone tower in summer rain." } : b
  );
  const visualEditedProject = {
    ...FIXTURE_PROJECT,
    brief: { ...FIXTURE_PROJECT.brief, scriptBeats: visualEditedBeats }
  };
  assert.notEqual(computeProjectPlateRevision(visualEditedProject), revBase, "visual edit changes plate revision");
  const afterVisualEdit = reconcilePlateStatusWithProject(baseStatus, visualEditedProject, knownBySig);
  assert.equal(afterVisualEdit.stale, true);
  assert.equal(afterVisualEdit.scenes[1].stale, true, "scene 1 with changed visual is marked stale");
  for (const idx of [0, 2, 3, 4]) {
    assert.equal(afterVisualEdit.scenes[idx].stale, false, `unchanged scene ${idx} remains non-stale`);
    assert.equal(afterVisualEdit.scenes[idx].state, "drawn");
  }

  // 3. Reorder scenes [0, 1, 2, 3, 4] -> [1, 0, 2, 3, 4]: all 5 match with 0 stale scenes
  const reorderedBeats = [
    FIXTURE_PROJECT.brief.scriptBeats[1],
    FIXTURE_PROJECT.brief.scriptBeats[0],
    ...FIXTURE_PROJECT.brief.scriptBeats.slice(2)
  ];
  const reorderedProject = {
    ...FIXTURE_PROJECT,
    brief: { ...FIXTURE_PROJECT.brief, scriptBeats: reorderedBeats }
  };
  const afterReorder = reconcilePlateStatusWithProject(baseStatus, reorderedProject, new Map());
  assert.equal(afterReorder.stale, false, "reorder preserves all 5 drawn scenes with 0 stale scenes");
  assert.equal(afterReorder.needsReconcile, true);
  assert.deepEqual(
    afterReorder.scenes.map((s) => s.keyword),
    reorderedBeats.map((b) => b.keyword)
  );
  assert.ok(afterReorder.scenes.every((s) => s.state === "drawn"));

  // 4. Style-only edit (look: illus-fox -> illus-folk-tale) marks all 5 scenes stale
  const restyledProject = {
    ...FIXTURE_PROJECT,
    brief: { ...FIXTURE_PROJECT.brief, look: "illus-folk-tale" }
  };
  const afterRestyle = reconcilePlateStatusWithProject(baseStatus, restyledProject, new Map());
  assert.equal(afterRestyle.stale, true);
  assert.deepEqual(afterRestyle.drawnAspects, []);
  assert.ok(afterRestyle.scenes.every((s) => s.stale === true && s.state === "queued"));
});

test(
  "Browser fixture at 1135x775: demonstrates stale, partial-stale, preparing, and current states without paid calls",
  { timeout: 90_000 },
  async () => {
    mkdirSync(SCREENSHOTS_DIR, { recursive: true });

    const navShimPlugin = {
      name: "next-navigation-shim",
      setup(b) {
        b.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: "next-navigation-shim",
          namespace: "shim"
        }));
        b.onLoad({ filter: /.*/, namespace: "shim" }, () => ({
          contents: `
            export function useSearchParams() {
              return new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
            }
            export function notFound() {}
          `,
          loader: "ts"
        }));
      }
    };

    const entrySource = `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import PlatePreviewFixturePage from "./app/dev/plate-preview-fixture/page.tsx";

      const el = document.getElementById("root");
      if (el) {
        createRoot(el).render(<PlatePreviewFixturePage />);
      }
    `;

    const bundled = await build({
      stdin: {
        contents: entrySource,
        resolveDir: FRONTEND_DIR,
        sourcefile: "plate-revision-fixture-entry.tsx",
        loader: "tsx"
      },
      bundle: true,
      format: "esm",
      target: "es2022",
      write: false,
      plugins: [navShimPlugin],
      define: {
        "process.env.NODE_ENV": '"development"',
        "process.env.NEXT_PUBLIC_LIVE_DEV": '"1"',
        "process.env.NEXT_PUBLIC_APP_ENV": '"local"',
        "process.env.NEXT_PUBLIC_API_URL": '"http://127.0.0.1:4000"',
        "process.env.NEXT_PUBLIC_SUPABASE_URL": '"http://127.0.0.1:54321"',
        "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": '"local-dev-anon-key"',
        "process.env": '{"NEXT_PUBLIC_LIVE_DEV":"1","NEXT_PUBLIC_APP_ENV":"local"}'
      }
    });
    const bundleJs = bundled.outputFiles[0].text;

    const srv = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/bundle.js") {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
        res.end(bundleJs);
        return;
      }
      if (url.pathname === "/styles.css") {
        res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
        res.end(COMBINED_CSS);
        return;
      }
      if (url.pathname.startsWith("/fonts/")) {
        try {
          const fontBytes = readFileSync(join(WORKER_FONTS_DIR, url.pathname.replace("/fonts/", "")));
          res.writeHead(200, { "content-type": "font/woff2" });
          res.end(fontBytes);
          return;
        } catch {}
      }
      if (url.pathname.startsWith("/dev/")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          '<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>'
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const port = srv.address().port;
    const origin = `http://127.0.0.1:${port}`;

    let browser = null;
    let activeState = "u-stale-revision";
    let drawCalls = 0;

    try {
      browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
      const context = await browser.newContext({ viewport: { width: 1135, height: 775 }, deviceScaleFactor: 1 });

      await context.route("**/*", async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.hostname === "fonts.googleapis.com") {
          await route.fulfill({ status: 200, contentType: "text/css; charset=utf-8", body: FONT_CSS });
          return;
        }
        if (url.pathname.endsWith("/media-token")) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ token: "fixture-token", expiresAt: "2099-01-01T00:00:00.000Z" })
          });
          return;
        }
        if (/\/projects\/[^/]+\/plates\/draw$/.test(url.pathname) && req.method() === "POST") {
          drawCalls += 1;
          activeState = "w-preparing-revision";
          await route.fulfill({
            status: 202,
            contentType: "application/json",
            body: JSON.stringify(fixturePlateStatus(activeState))
          });
          return;
        }
        if (/\/projects\/[^/]+\/plates$/.test(url.pathname) && req.method() === "GET") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(fixturePlateStatus(activeState))
          });
          return;
        }
        if (/\/projects\/[^/]+\/plates\/\d+\/clip/.test(url.pathname)) {
          const isPortrait = url.searchParams.get("aspect") === "9:16";
          await route.fulfill({ status: 200, contentType: "video/mp4", body: isPortrait ? CLIP_9X16 : CLIP_16X9 });
          return;
        }
        if (/\/preview\/plan-voice\/|\/preview\/plan-sfx\//.test(url.pathname)) {
          await route.fulfill({ status: 200, contentType: "audio/wav", body: VOICE_WAV });
          return;
        }
        await route.continue();
      });

      const page = await context.newPage();

      // 1. Open u-stale-revision (old 7-scene rubber-hose status + new 7-scene Folk-tale project at 1135x775)
      activeState = "u-stale-revision";
      drawCalls = 0;
      await page.goto(`${origin}/dev/plate-preview-fixture?state=u-stale-revision&theme=light`, {
        waitUntil: "networkidle"
      });
      await page.waitForSelector(".aw-segments li");

      const staleDom = await page.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll(".aw-segments li")).map((li) => ({
          text: (li.querySelector("span")?.textContent ?? "").trim(),
          chip: (li.querySelector(".aw-seg-state")?.textContent ?? "").trim(),
          cls: li.className
        }));
        const waitTitle = (document.querySelector(".aw-wait-body b")?.textContent ?? "").trim();
        const waitAction = (document.querySelector(".aw-wait-action")?.textContent ?? "").trim();
        const miniStatus = (document.querySelector(".aw-mini-status")?.textContent ?? "").trim();
        const subtitleOverlay = document.querySelector(".aw-subtitle");
        const videoElements = document.querySelectorAll(".aw-canvas video").length;
        const renderBtn = document.querySelector(".aw-render-top");
        const sceneLabel = (document.querySelector(".aw-scene")?.textContent ?? "").trim();
        return {
          tabs,
          waitTitle,
          waitAction,
          miniStatus,
          hasSubtitleOverlay: Boolean(subtitleOverlay),
          videoElements,
          renderDisabled: renderBtn ? renderBtn.hasAttribute("disabled") : false,
          sceneLabel
        };
      });

      // Verify zero old rubber-hose titles appear and all 7 new Folk-tale titles are shown as "Needs update"
      assert.equal(staleDom.tabs.length, 7);
      assert.deepEqual(
        staleDom.tabs.map((t) => t.text),
        UPDATED_FOLK_TALE_7_BEATS.map((b) => b.keyword),
        "DOM shows updated Folk-tale scene titles, never old Rubber-hose titles"
      );
      for (const oldBeat of OLD_RUBBER_HOSE_7_BEATS) {
        assert.equal(
          staleDom.tabs.some((t) => t.text === oldBeat.keyword),
          false,
          `old title "${oldBeat.keyword}" is not shown`
        );
      }
      assert.ok(staleDom.tabs.every((t) => t.chip === "Needs update"), "all 7 stale tabs show 'Needs update'");
      assert.match(staleDom.waitTitle, /Storyboard updated · scene needs redraw/);
      assert.equal(staleDom.waitAction, "Update animation");
      assert.match(staleDom.miniStatus, /Storyboard changed · update needed/);
      assert.equal(staleDom.hasSubtitleOverlay, false, "new subtitle is never overlaid on stale/unbuilt scene");
      assert.equal(staleDom.videoElements, 0, "no old rubber-hose video element is rendered");
      assert.equal(staleDom.renderDisabled, true, "Render button is disabled while stale scenes exist");
      assert.equal(staleDom.sceneLabel, "Scene 1 · Wren wants fish");
      assert.equal(drawCalls, 0, "opening/polling stale project without autoStart makes 0 paid draw calls");

      await page.screenshot({
        path: join(SCREENSHOTS_DIR, "stale-revision-1135x775-needs-update.png")
      });

      // 2. Click "Update animation" -> invokes POST /plates/draw once and transitions to preparing state
      await page.click(".aw-wait-action");
      await page.waitForFunction(
        () => (document.querySelector(".aw-wait-body b")?.textContent ?? "").includes("Writing the scene")
      );
      assert.equal(drawCalls, 1, "clicking Update animation invokes POST /plates/draw exactly once");

      const prepDom = await page.evaluate(() => ({
        waitTitle: (document.querySelector(".aw-wait-body b")?.textContent ?? "").trim(),
        toastPrimary: (document.querySelector(".aw-film-toast-primary")?.textContent ?? "").trim(),
        tab0Chip: (document.querySelector(".aw-segments li .aw-seg-state")?.textContent ?? "").trim()
      }));
      assert.match(prepDom.waitTitle, /Writing the scene/);
      assert.match(prepDom.toastPrimary, /Scene 1 is being written/);
      assert.match(prepDom.tab0Chip, /Writing/);

      await page.screenshot({
        path: join(SCREENSHOTS_DIR, "stale-revision-1135x775-preparing.png")
      });

      // 2b. Preparing state with storyboard sketches (withSketches=1) -> Play button is enabled, plays storyboard sketch while keeping top toast visible
      await page.goto(`${origin}/dev/plate-preview-fixture?state=w-preparing-revision&withSketches=1&theme=light`, {
        waitUntil: "networkidle"
      });
      await page.waitForSelector(".aw-wait-sketch");
      const sketchPrepDom = await page.evaluate(() => ({
        playDisabled: Boolean(document.querySelector("button.aw-play")?.hasAttribute("disabled")),
        toastPrimary: (document.querySelector(".aw-film-toast-primary")?.textContent ?? "").trim()
      }));
      assert.equal(sketchPrepDom.playDisabled, false, "Play button is enabled while scene is still being processed so storyboard sketch can play");
      assert.match(sketchPrepDom.toastPrimary, /Scene 1 is being written/);
      await page.click("button.aw-play");
      await page.waitForTimeout(350);
      const playingSketchDom = await page.evaluate(() => ({
        playLabel: document.querySelector("button.aw-play")?.getAttribute("aria-label") ?? "",
        toastPrimary: (document.querySelector(".aw-film-toast-primary")?.textContent ?? "").trim(),
        sketchVisible: Boolean(document.querySelector(".aw-wait-sketch"))
      }));
      assert.equal(playingSketchDom.playLabel, "Pause", "storyboard sketch is playing while scene is still being written");
      assert.match(playingSketchDom.toastPrimary, /Scene 1 is being written/, "top drawing toast stays visible during storyboard playback");
      assert.equal(playingSketchDom.sketchVisible, true, "storyboard sketch remains visible on stage");
      await page.click("button.aw-play");

      // 3. Partial stale state (v-partial-stale: 5 scenes drawn/reused, 2 scenes edited & marked Needs update)
      activeState = "v-partial-stale";
      await page.goto(`${origin}/dev/plate-preview-fixture?state=v-partial-stale&theme=light`, {
        waitUntil: "networkidle"
      });
      await page.waitForSelector(".aw-segments li");
      const partialDom = await page.evaluate(() => ({
        miniStatus: (document.querySelector(".aw-mini-status")?.textContent ?? "").trim(),
        chips: Array.from(document.querySelectorAll(".aw-segments li")).map((li) => ({
          keyword: (li.querySelector("span")?.textContent ?? "").trim(),
          chip: (li.querySelector(".aw-seg-state")?.textContent ?? "").trim(),
          cls: li.className
        }))
      }));
      assert.equal(partialDom.miniStatus, "2 scenes need update");
      assert.equal(partialDom.chips[1].chip, "Needs update");
      assert.equal(partialDom.chips[4].chip, "Needs update");
      assert.ok(partialDom.chips[0].cls.includes("drawn"), "unchanged scene 1 remains drawn");

      await page.screenshot({
        path: join(SCREENSHOTS_DIR, "stale-revision-1135x775-partial-stale.png")
      });
    } finally {
      if (browser) await browser.close();
      await new Promise((r) => srv.close(r));
    }
  }
);
