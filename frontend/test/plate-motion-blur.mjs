import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { motionBlurCopy, motionBlurProblem } from "../../packages/contracts/src/motion-blur.ts";
import * as workspaceLogic from "../components/animation-workspace/logic.ts";
import { FIXTURE_HF_BEATS, FIXTURE_HF_FRAMES, FIXTURE_HF_PROJECT } from "./fixtures/hf/data.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(HERE, "..");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("(g) resolveVisibleOptions defaults motionBlur to true, plateOptionsConfig yields false, and hfOptionsConfig is unchanged", () => {
  const defaultVisible = workspaceLogic.resolveVisibleOptions();
  assert.equal(defaultVisible.motionBlur, true, "resolveVisibleOptions() defaults motionBlur to true");

  assert.equal(typeof workspaceLogic.plateOptionsConfig, "function", "plateOptionsConfig is exported from logic.ts");
  const plateCfg = workspaceLogic.plateOptionsConfig();
  assert.deepEqual(plateCfg, { motionBlur: false }, "plateOptionsConfig() returns { motionBlur: false }");
  const plateVisible = workspaceLogic.resolveVisibleOptions(plateCfg);
  assert.equal(plateVisible.motionBlur, false, "resolveVisibleOptions(plateOptionsConfig()) yields motionBlur: false");

  const hfCfg = workspaceLogic.hfOptionsConfig({ voice: true, music: true });
  assert.deepEqual(hfCfg, {
    audioTracks: ["voice", "music"],
    subtitleModes: ["none", "key-phrases", "full"],
    subtitleStyle: false,
    subtitleSize: false,
    subtitleColors: false,
    subtitleOpacity: false,
    subtitlePosition: false,
    previewQuality: false
  });
  const hfVisible = workspaceLogic.resolveVisibleOptions(hfCfg);
  assert.equal(hfVisible.motionBlur, true, "resolveVisibleOptions(hfOptionsConfig(...)).motionBlur is true");

  assert.equal(typeof workspaceLogic.motionBlurControl, "function", "motionBlurControl helper is exported from logic.ts");
  assert.deepEqual(workspaceLogic.motionBlurControl("illus-blueprint", 24), {
    shown: false,
    problem: null
  });
  assert.deepEqual(workspaceLogic.motionBlurControl("clean", 24), {
    shown: true,
    problem: motionBlurProblem(24)
  });
  assert.deepEqual(workspaceLogic.motionBlurControl("clean", 15), {
    shown: true,
    problem: null
  });
});

test("(h)-(m) DOM tests for BeatStoryboardStep, OptionsBar, and BrowserAnimationStep motion-blur control", async () => {
  const harnessEntry = `
    import React, { useState } from "react";
    import { createRoot } from "react-dom/client";
    import { BeatStoryboardStep } from "./components/beat-storyboard.tsx";
    import { OptionsBar } from "./components/animation-workspace/OptionsBar.tsx";
    import { hfOptionsConfig, plateOptionsConfig } from "./components/animation-workspace/logic.ts";
    import { BrowserAnimationStep } from "./components/browser-animation-step.tsx";

    window.React = React;
    window.mountHarness = (el, spec) => {
      const root = createRoot(el);
      if (spec.kind === "storyboard") {
        root.render(
          <BeatStoryboardStep
            project={spec.project}
            look={spec.look}
            warnings={[]}
            busy={false}
            onSaved={() => {}}
            back={() => {}}
            submit={() => { window.__submitted = (window.__submitted || 0) + 1; }}
            motionBlur={spec.motionBlur}
            setMotionBlur={(val) => { window.__lastMotionBlur = val; }}
          />
        );
      } else if (spec.kind === "options-bar") {
        const cfg = spec.isPlate ? plateOptionsConfig() : hfOptionsConfig({ voice: true, music: true });
        root.render(
          <OptionsBar
            optionsConfig={cfg}
            motionBlur={
              spec.omitState
                ? undefined
                : {
                    enabled: spec.motionBlur,
                    disabled: Boolean(spec.busy),
                    durationSeconds: spec.durationSeconds,
                    onToggle: (val) => { window.__barToggled = val; }
                  }
            }
          />
        );
      } else if (spec.kind === "hf-step") {
        function StudioHarness() {
          const [motionBlur, setMotionBlur] = useState(Boolean(spec.initialMotionBlur));
          window.__studioMotionBlur = motionBlur;
          return (
            <BrowserAnimationStep
              project={spec.project}
              beats={spec.beats}
              frames={spec.frames}
              aspect="16:9"
              animating={false}
              animProgress={100}
              animStage="motion"
              animScenesDone={[0, 1, 2, 3, 4]}
              animError={null}
              animVersion={0}
              busy={false}
              motionBlur={motionBlur}
              setMotionBlur={(next) => {
                window.__setMotionBlurCalls = [...(window.__setMotionBlurCalls || []), next];
                setMotionBlur(next);
              }}
              durationSeconds={spec.durationSeconds}
              notice={spec.notice}
              onRetryAnimate={() => {}}
              onBackToStoryboard={() => {}}
              onStartFinalRender={() => {
                window.__renderProjectCalls = [...(window.__renderProjectCalls || []), { projectId: spec.project.id, motionBlur }];
              }}
              onApplySceneComments={async () => {}}
            />
          );
        }
        root.render(<StudioHarness />);
      }
      return root;
    };
  `;

  const bundled = await build({
    stdin: {
      contents: harnessEntry,
      resolveDir: FRONTEND_DIR,
      sourcefile: "blur-harness.tsx",
      loader: "tsx"
    },
    bundle: true,
    format: "esm",
    target: "es2022",
    write: false,
    define: {
      "process.env.NODE_ENV": '"development"',
      "process.env.NEXT_PUBLIC_API_URL": '"http://127.0.0.1:4000"',
      "process.env.NEXT_PUBLIC_SUPABASE_URL": '"http://127.0.0.1:54321"',
      "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": '"local-dev-anon-key"',
      "process.env": "{}"
    }
  });
  const bundleJs = bundled.outputFiles[0].text;

  const workspaceCss = readFileSync(join(FRONTEND_DIR, "app/animation-workspace.css"), "utf8");
  let activeDurationSeconds = 18;
  const srv = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/animation-workspace.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');
      return;
    }
    if (url.pathname === "/animation-workspace.css") {
      res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
      res.end(workspaceCss);
      return;
    }
    if (url.pathname === "/bundle.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(bundleJs);
      return;
    }
    if (url.pathname.endsWith("/me/tokens")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ remaining: 100, plan: null, free: { granted: 33, used: 0, remaining: 33 }, packs: { remaining: 67 }, recent: [] }));
      return;
    }
    if (url.pathname.endsWith("/media-token")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ token: "tok", expiresAt: "2099-01-01T00:00:00.000Z" }));
      return;
    }
    if (url.pathname.endsWith("/composition")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ engine: "beat-plan", baseUrl: "/api/preview/plans/p1", durationSeconds: Number(url.searchParams.get("dur") || 18), audio: { mode: "both", ready: true, voice: { ready: 5, stale: [] }, music: { ready: true } } }));
      return;
    }
    if (url.pathname.startsWith("/api/preview/")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><html><body>preview</body></html>");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });

  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });

  try {
    const context = await browser.newContext();
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/" || url.pathname === "/bundle.js" || url.pathname === "/animation-workspace.css") {
        await route.continue();
        return;
      }
      if (url.pathname.endsWith("/me/tokens")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ remaining: 100, plan: null, free: { granted: 33, used: 0, remaining: 33 }, packs: { remaining: 67 }, recent: [] })
        });
        return;
      }
      if (url.pathname.endsWith("/media-token")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ token: "tok", expiresAt: "2099-01-01T00:00:00.000Z" })
        });
        return;
      }
      if (url.pathname.endsWith("/visuals")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            required: false,
            available: false,
            status: "not-started",
            total: 0,
            ready: 0,
            estimateUsd: 0,
            reservedUsd: 0,
            priceTokens: 0,
            maxBudgetUsd: 50
          })
        });
        return;
      }
      if (url.pathname.endsWith("/composition")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            engine: "beat-plan",
            baseUrl: "/api/preview/plans/p1",
            durationSeconds: activeDurationSeconds,
            audio: { mode: "both", ready: true, voice: { ready: 5, stale: [] }, music: { ready: true } }
          })
        });
        return;
      }
      if (url.pathname.startsWith("/api/preview/")) {
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: "<!doctype html><html><body>preview</body></html>"
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    const page = await context.newPage();
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountHarness === "function");

    const look = { bg: "#0d1320", fg: "#f8fafc", muted: "#94a3b8", brand: "#38bdf8", font: "Inter" };
    const makeStoryboardProject = (lookId, durationSec) => ({
      ...structuredClone(FIXTURE_HF_PROJECT),
      brief: {
        ...structuredClone(FIXTURE_HF_PROJECT.brief),
        look: lookId,
        durationSeconds: durationSec
      },
      beatPlan: {
        ...structuredClone(FIXTURE_HF_PROJECT.beatPlan),
        target_duration_s: durationSec
      }
    });

    // (h) & (i): BeatStoryboardStep for a plate project over 20 s (24 s) with motionBlur=true:
    //   - no .bs-blur control in DOM
    //   - no length block
    //   - submit button enabled and fires submit callback
    activeDurationSeconds = 24;
    await page.evaluate(
      ({ project, lookObj }) => {
        window.__submitted = 0;
        const container = document.getElementById("root");
        container.innerHTML = '<div id="mount"></div>';
        window.mountHarness(document.getElementById("mount"), {
          kind: "storyboard",
          project,
          look: lookObj,
          motionBlur: true
        });
      },
      { project: makeStoryboardProject("illus-blueprint", 24), lookObj: look }
    );
    await page.waitForSelector(".beat-storyboard");
    assert.equal(await page.locator("label.bs-blur").count(), 0, "(h) BeatStoryboardStep hides .bs-blur for plate project over 20 s");
    const submitBtnPlate = page.locator('.bs-submit button.primary-button:has-text("Submit video")');
    assert.equal(await submitBtnPlate.isDisabled(), false, "(i) Submit button is enabled for plate project over 20 s with motionBlur=true");
    await submitBtnPlate.click();
    assert.equal(await page.evaluate(() => window.__submitted), 1, "(i) Clicking Submit fires submit callback for plate project with motionBlur=true");

    // (h): BeatStoryboardStep for a HyperFrames project over 20 s (24 s): control present & disabled with motionBlurProblem(24)
    activeDurationSeconds = 24;
    await page.evaluate(
      ({ project, lookObj }) => {
        const container = document.getElementById("root");
        container.innerHTML = '<div id="mount"></div>';
        window.mountHarness(document.getElementById("mount"), {
          kind: "storyboard",
          project,
          look: lookObj,
          motionBlur: true
        });
      },
      { project: makeStoryboardProject("clean", 24), lookObj: look }
    );
    await page.waitForSelector("label.bs-blur");
    assert.equal(await page.locator("label.bs-blur input[type='checkbox']").isDisabled(), true, "(h) HF over 20 s disables .bs-blur checkbox");
    assert.equal(await page.locator("label.bs-blur input[type='checkbox']").isChecked(), false, "(h) HF over 20 s unchecks .bs-blur checkbox");
    assert.equal(await page.locator("label.bs-blur small").textContent(), motionBlurProblem(24), "(h) HF over 20 s shows motionBlurProblem message");

    // (h): BeatStoryboardStep for a HyperFrames project under 20 s (15 s): control present & enabled
    activeDurationSeconds = 15;
    await page.evaluate(
      ({ project, lookObj }) => {
        const container = document.getElementById("root");
        container.innerHTML = '<div id="mount"></div>';
        window.mountHarness(document.getElementById("mount"), {
          kind: "storyboard",
          project,
          look: lookObj,
          motionBlur: false
        });
      },
      { project: makeStoryboardProject("clean", 15), lookObj: look }
    );
    await page.waitForSelector("label.bs-blur");
    assert.equal(await page.locator("label.bs-blur input[type='checkbox']").isDisabled(), false, "(h) HF under 20 s enables .bs-blur checkbox");
    assert.equal(await page.locator("label.bs-blur small").textContent(), motionBlurCopy.help, "(h) HF under 20 s shows motionBlurCopy.help");

    // (j): OptionsBar rendered with plate config hides motion-blur control; with HF config shows it
    await page.evaluate(() => {
      const container = document.getElementById("root");
      container.innerHTML = '<div id="mount"></div>';
      window.mountHarness(document.getElementById("mount"), {
        kind: "options-bar",
        isPlate: true,
        motionBlur: true,
        durationSeconds: 15
      });
    });
    await page.waitForSelector(".aw-floating-bar");
    assert.equal(await page.locator(".aw-floating-bar label.aw-blur").count(), 0, "(j) OptionsBar with plateOptionsConfig hides motion-blur control");

    await page.evaluate(() => {
      const container = document.getElementById("root");
      container.innerHTML = '<div id="mount"></div>';
      window.mountHarness(document.getElementById("mount"), {
        kind: "options-bar",
        isPlate: false,
        omitState: true,
        motionBlur: false,
        durationSeconds: 15
      });
    });
    await page.waitForSelector(".aw-floating-bar");
    assert.equal(await page.locator(".aw-floating-bar label.aw-blur").count(), 0, "(j) OptionsBar without motionBlur state prop hides control");

    // (j), (k), (l), (m) on BrowserAnimationStep:
    // 1. Plate project on BrowserAnimationStep -> control absent, and when notice is provided, renders role="status" notice banner
    await page.evaluate(
      ({ project, beats, frames }) => {
        const container = document.getElementById("root");
        container.innerHTML = '<div id="mount"></div>';
        window.mountHarness(document.getElementById("mount"), {
          kind: "hf-step",
          project,
          beats,
          frames,
          initialMotionBlur: true,
          durationSeconds: 18,
          notice: "This is a quick preview. Your styled scenes aren't drawn in this setup."
        });
      },
      { project: makeStoryboardProject("illus-blueprint", 18), beats: FIXTURE_HF_BEATS, frames: FIXTURE_HF_FRAMES }
    );
    await page.waitForSelector(".aw-floating-bar");
    assert.equal(await page.locator(".aw-floating-bar label.aw-blur").count(), 0, "(j) Plate project hides motion-blur control in workspace bar");
    assert.equal(
      await page.locator("p.aw-error[role='status']").textContent(),
      "This is a quick preview. Your styled scenes aren't drawn in this setup.",
      "Plate fallback notice is rendered at the top of the workspace with role='status'"
    );

    // 2. (m) & (k): HF project under 20 s (18 s) with saved-draft initialMotionBlur=true -> shown checked; toggling updates studio state & next renderProject call
    activeDurationSeconds = 18;
    await page.evaluate(
      ({ project, beats, frames }) => {
        window.__setMotionBlurCalls = [];
        window.__renderProjectCalls = [];
        const container = document.getElementById("root");
        container.innerHTML = '<div id="mount"></div>';
        window.mountHarness(document.getElementById("mount"), {
          kind: "hf-step",
          project,
          beats,
          frames,
          initialMotionBlur: true,
          durationSeconds: 18
        });
      },
      { project: makeStoryboardProject("clean", 18), beats: FIXTURE_HF_BEATS, frames: FIXTURE_HF_FRAMES }
    );
    await page.waitForSelector(".aw-floating-bar label.aw-blur");
    const hfCheckbox = page.locator(".aw-floating-bar label.aw-blur input[type='checkbox']");
    assert.equal(await hfCheckbox.isDisabled(), false, "(l) HF under 20 s enables motion-blur checkbox");
    assert.equal(await hfCheckbox.isChecked(), true, "(m) Saved-draft motionBlur=true is shown checked for HF under 20 s");
    assert.equal(await page.locator(".aw-floating-bar label.aw-blur small").textContent(), motionBlurCopy.help);
    assert.deepEqual(await page.evaluate(() => window.__setMotionBlurCalls), [], "(m) Mount does not reset saved-draft motionBlur state");

    // Toggle off -> calls setMotionBlur(false); toggle back on -> calls setMotionBlur(true) and next render carries motionBlur: true
    await hfCheckbox.uncheck();
    assert.equal(await hfCheckbox.isChecked(), false);
    await hfCheckbox.check();
    assert.equal(await hfCheckbox.isChecked(), true);
    assert.deepEqual(await page.evaluate(() => window.__setMotionBlurCalls), [false, true], "(k) Toggling calls setMotionBlur");

    await page.locator("button.aw-render-top").click();
    assert.deepEqual(
      await page.evaluate(() => window.__renderProjectCalls),
      [{ projectId: FIXTURE_HF_PROJECT.id, motionBlur: true }],
      "(k) Next renderProject call carries the changed motionBlur flag"
    );

    // 3. (l): HF film over 20 s (25 s) -> control disabled & unchecked, shows motionBlurProblem(25) message, without resetting saved draft state
    activeDurationSeconds = 25;
    await page.evaluate(
      ({ project, beats, frames }) => {
        window.__setMotionBlurCalls = [];
        const container = document.getElementById("root");
        container.innerHTML = '<div id="mount"></div>';
        window.mountHarness(document.getElementById("mount"), {
          kind: "hf-step",
          project,
          beats,
          frames,
          initialMotionBlur: true,
          durationSeconds: 25
        });
      },
      { project: makeStoryboardProject("clean", 25), beats: FIXTURE_HF_BEATS, frames: FIXTURE_HF_FRAMES }
    );
    await page.waitForSelector(".aw-floating-bar label.aw-blur");
    const hfOverCheckbox = page.locator(".aw-floating-bar label.aw-blur input[type='checkbox']");
    assert.equal(await hfOverCheckbox.isDisabled(), true, "(l) HF film over 20 s disables motion-blur checkbox");
    assert.equal(await hfOverCheckbox.isChecked(), false, "(l) HF film over 20 s shows checkbox unchecked while too long");
    assert.equal(
      await page.locator(".aw-floating-bar label.aw-blur small").textContent(),
      motionBlurProblem(25),
      "(l) HF film over 20 s displays motionBlurProblem(25) message"
    );
    assert.equal(await page.evaluate(() => window.__studioMotionBlur), true, "(m) Saved draft state is not reset when film is over 20 s");
  } finally {
    await browser.close().catch(() => {});
    await new Promise((r) => srv.close(r));
  }
});
