import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import {
  checkSceneHintLayout,
  classifyEditPatch,
  deterministicCommentTranslator,
  hasEditPatchOperations,
  mergeWindowElements,
  validateFrameElementsSnapshots
} from "../../packages/contracts/src/edit-patch.ts";
import { FIXTURE_HF_PROJECT } from "./fixtures/hf/data.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(FRONTEND_DIR, "..");
const HF_FIXTURES_DIR = join(FRONTEND_DIR, "test/fixtures/hf");
const WORKER_FONTS_DIR = join(REPO_ROOT, "worker/fonts");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const COMPOSITION_HTML = readFileSync(join(HF_FIXTURES_DIR, "composition.html"), "utf8");
const TEMPLATE_HTML = readFileSync(join(REPO_ROOT, "worker/templates/beat-plan/index.html"), "utf8");
const engineScriptMatch = /<script id="bp-engine">[\s\S]*?<\/script>/.exec(TEMPLATE_HTML);
const LIVE_COMPOSITION_HTML = engineScriptMatch
  ? COMPOSITION_HTML.replace(/<script id="bp-engine">[\s\S]*?<\/script>/, () => engineScriptMatch[0])
  : COMPOSITION_HTML;

const COMPOSITION_JSON = JSON.parse(readFileSync(join(HF_FIXTURES_DIR, "composition.json"), "utf8"));
const SILENT_WAV = readFileSync(join(HF_FIXTURES_DIR, "silent.wav"));
const RUNTIME_JS = readFileSync(join(REPO_ROOT, "node_modules/hyperframes/dist/hyperframe-runtime.js"), "utf8");
const GSAP_JS = readFileSync(join(REPO_ROOT, "node_modules/gsap/dist/gsap.min.js"), "utf8");

function findFreePort() {
  return new Promise((resolvePort, rejectPort) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close((err) => (err ? rejectPort(err) : resolvePort(port)));
    });
    srv.on("error", rejectPort);
  });
}

async function waitForServer(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
    } catch {
      // still booting
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  throw new Error(`Timed out waiting for Next dev server at ${url}`);
}

test("BrowserAnimationStep headless Chrome interaction: two-step propose/commit protocol, element edit saved & labelled, refused edit reason without label, server error alert without label, undo, subtitle & audio patches, and token modal", async () => {
  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const nextProc = spawn(
    "npx",
    ["next", "dev", "--webpack", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: FRONTEND_DIR,
      env: {
        ...process.env,
        NEXT_PUBLIC_LIVE_DEV: "1",
        NEXT_PUBLIC_APP_ENV: "local",
        NEXT_PUBLIC_API_URL: "http://127.0.0.1:4000",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-dev-anon-key"
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true
    }
  );

  let browser = null;
  try {
    await waitForServer(`${origin}/dev/hf-step-fixture`);
    browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    const planPatches = [];
    const previewFetches = [];
    const proposeCalls = [];
    const commitCalls = [];
    let currentPlanVersion = "plan-v1";
    let forceNextProposeServerError = false;
    let forceNextPropose409 = false;
    let forceNextCommit409 = false;
    let forceNextDeleteError = false;
    let dropFirstCandidateNextPropose = false;
    const validBeatIds = new Set(["b1", "b2", "b3", "b4", "b5"]);

    await context.route("**/*", async (route) => {
      const req = route.request();
      const url = new URL(req.url());

      if (url.pathname.endsWith("/media-token")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ token: "fixture-token", expiresAt: "2099-01-01T00:00:00.000Z" })
        });
        return;
      }

      if (url.pathname.endsWith("/me/tokens")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            remaining: 5,
            plan: null,
            free: { granted: 33, used: 28, remaining: 5 },
            packs: { remaining: 0 },
            recent: []
          })
        });
        return;
      }

      if (/\/projects\/[^/]+\/composition$/.test(url.pathname)) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(COMPOSITION_JSON)
        });
        return;
      }

      if (/\/projects\/[^/]+\/plan\/edit\/propose$/.test(url.pathname) && req.method() === "POST") {
        const body = JSON.parse(req.postData() ?? "{}");
        proposeCalls.push(body);

        if (forceNextPropose409) {
          forceNextPropose409 = false;
          await route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ error: { code: "stale_plan_version", message: "The storyboard changed." } })
          });
          return;
        }

        if (forceNextProposeServerError) {
          forceNextProposeServerError = false;
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: { code: "server_error", message: "Server failed while proposing edit." } })
          });
          return;
        }

        const comments = Array.isArray(body.comments) ? body.comments : [];
        const snapshotsMap = body.measured?.snapshots ?? {};
        const candidates = [];

        for (const c of comments) {
          const snaps = snapshotsMap[c.id];
          const checked = validateFrameElementsSnapshots(snaps, validBeatIds);
          if ("error" in checked) {
            await route.fulfill({
              status: 400,
              contentType: "application/json",
              body: JSON.stringify({ error: { code: "invalid_snapshots", message: checked.error } })
            });
            return;
          }
          const activeElements = mergeWindowElements(checked.snapshots);
          const beatId = typeof c.scene === "string" ? c.scene : `b${Number(c.scene ?? 0) + 1}`;
          const detPatch = await deterministicCommentTranslator.translate({
            comment: c.body ?? "",
            atSeconds: c.at ?? 0,
            scene: beatId,
            activeElements,
            canvas: body.measured?.canvas
          });
          const hasOps = hasEditPatchOperations(detPatch);
          if (!hasOps) {
            candidates.push({
              id: c.id,
              patch: { scope: "scene", scene: beatId, atSeconds: c.at ?? 0, set: {} },
              fallbackRewrite: true
            });
          } else {
            candidates.push({
              id: c.id,
              patch: { ...detPatch, scene: beatId, atSeconds: c.at ?? 0 }
            });
          }
        }

        const returnedCandidates = dropFirstCandidateNextPropose ? candidates.slice(1) : candidates;
        dropFirstCandidateNextPropose = false;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ planVersion: currentPlanVersion, candidates: returnedCandidates })
        });
        return;
      }

      if (/\/projects\/[^/]+\/plan\/edit\/commit$/.test(url.pathname) && req.method() === "POST") {
        const body = JSON.parse(req.postData() ?? "{}");
        commitCalls.push(body);

        if (forceNextCommit409 || body.planVersion !== currentPlanVersion) {
          forceNextCommit409 = false;
          await route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              error: { code: "stale_plan_version", message: "The storyboard changed since this edit was proposed." },
              planVersion: currentPlanVersion
            })
          });
          return;
        }

        const canvas = body.canvas ?? { width: 1920, height: 1080 };
        const items = Array.isArray(body.items) ? body.items : [];
        const results = [];

        for (const item of items) {
          const decision = classifyEditPatch({
            patch: item.patch,
            canvas,
            beforeWindow: item.before,
            afterWindow: item.after
          });

          if (decision.reason === "overlap-detected") {
            const msg = `That move would overlap with another element on screen (${decision.measurements.collidingElements.join(", ")}).`;
            await route.fulfill({
              status: 422,
              contentType: "application/json",
              body: JSON.stringify({
                error: { code: "edit_refused", message: msg, commentId: item.id },
                problems: [msg],
                commentId: item.id,
                details: decision
              })
            });
            return;
          }

          if (decision.reason === "left-safe-area") {
            const v = decision.measurements.safeAreaViolations[0];
            const msg = `That position leaves the ${v?.kind ?? "safe"} area of the frame. Keep elements inside the safe margins so nothing is clipped.`;
            await route.fulfill({
              status: 422,
              contentType: "application/json",
              body: JSON.stringify({
                error: { code: "edit_refused", message: msg, commentId: item.id },
                problems: [msg],
                commentId: item.id,
                details: decision
              })
            });
            return;
          }

          if (!item.fallbackRewrite && decision.scope === "scene") {
            const beatId = String(item.patch.scene || "b1");
            const layoutCheck = checkSceneHintLayout(item.after, canvas, beatId, item.before);
            if (!layoutCheck.ok) {
              const msg = "Cannot satisfy that layout change inside the safe area.";
              await route.fulfill({
                status: 422,
                contentType: "application/json",
                body: JSON.stringify({
                  error: { code: "edit_refused", message: msg, commentId: item.id },
                  problems: [msg],
                  commentId: item.id
                })
              });
              return;
            }
          }

          const finalScope = item.fallbackRewrite ? "scene" : decision.scope;
          const finalLabel = item.fallbackRewrite ? "re-laid out the scene" : decision.uiLabel;
          results.push({
            id: item.id,
            scope: finalScope,
            uiLabel: finalLabel,
            ...(item.patch.el ? { el: item.patch.el } : {}),
            ...(item.fallbackRewrite ? { fallbackRewrite: true } : {}),
            patch: { ...item.patch, scope: finalScope },
            decision: { ...decision, scope: finalScope, uiLabel: finalLabel },
            elementsBefore: mergeWindowElements(item.before),
            elementsAfter: mergeWindowElements(item.after)
          });
        }

        currentPlanVersion = `plan-v${commitCalls.length + 1}`;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            project: FIXTURE_HF_PROJECT,
            plan: FIXTURE_HF_PROJECT.beatPlan,
            planVersion: currentPlanVersion,
            results
          })
        });
        return;
      }

      if (/\/projects\/[^/]+\/plan\/overrides\/[^/]+$/.test(url.pathname) && req.method() === "DELETE") {
        if (forceNextDeleteError) {
          forceNextDeleteError = false;
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: { code: "server_error", message: "Database busy while undoing override." } })
          });
          return;
        }
        planPatches.push({ undoOverride: decodeURIComponent(url.pathname.split("/").pop() ?? "") });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(FIXTURE_HF_PROJECT)
        });
        return;
      }

      if (/\/projects\/[^/]+\/plan$/.test(url.pathname) && req.method() === "PATCH") {
        const body = JSON.parse(req.postData() ?? "{}");
        planPatches.push(body);
        const updatedProject = structuredClone(FIXTURE_HF_PROJECT);
        if (body.captions && updatedProject.beatPlan && updatedProject.brief) {
          updatedProject.beatPlan.audio.captions = body.captions;
          updatedProject.brief.captions = body.captions;
        }
        if (body.audioMode && updatedProject.brief) {
          updatedProject.brief.audio.mode = body.audioMode;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(updatedProject)
        });
        return;
      }

      if (/^\/api\/preview\/plans\/[^/]+$/.test(url.pathname)) {
        previewFetches.push(url.search);
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: LIVE_COMPOSITION_HTML
        });
        return;
      }

      if (url.pathname === "/api/preview/runtime.js") {
        await route.fulfill({ status: 200, contentType: "application/javascript", body: RUNTIME_JS });
        return;
      }

      if (url.pathname === "/api/preview/gsap.js") {
        await route.fulfill({ status: 200, contentType: "application/javascript", body: GSAP_JS });
        return;
      }

      if (url.pathname.startsWith("/api/preview/fonts/")) {
        const fontFile = url.pathname.slice("/api/preview/fonts/".length);
        try {
          await route.fulfill({ status: 200, contentType: "font/woff2", body: readFileSync(join(WORKER_FONTS_DIR, fontFile)) });
        } catch {
          await route.fulfill({ status: 404, body: "" });
        }
        return;
      }

      if (url.pathname.includes("/audio/") || url.pathname.includes("/plan-sfx/")) {
        await route.fulfill({ status: 200, contentType: "audio/wav", body: SILENT_WAV });
        return;
      }

      if (/\/projects\/[^/]+\/plates(?:\/subtitles)?$/.test(url.pathname)) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ available: false, look: "clean", scenes: [], comments: [], running: false })
        });
        return;
      }

      if (url.pathname.startsWith("/api/backend/")) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "not_found", message: "Not found." } })
        });
        return;
      }

      if (url.hostname === "127.0.0.1" && url.port === String(port)) {
        await route.continue();
        return;
      }

      await route.fulfill({ status: 204, body: "" });
    });

    const page = await context.newPage();
    await page.goto(`${origin}/dev/hf-step-fixture?state=c-ready&theme=dark`, { waitUntil: "networkidle" });
    await page.waitForSelector("hyperframes-player");
    await page.waitForFunction(() => {
      const player = document.querySelector("hyperframes-player");
      return Boolean(player?.ready && player?.iframeElement?.contentWindow?.__bp?.elementsAt);
    });

    assert.equal(previewFetches.length, 1, "initial preview HTML fetched once");
    assert.match(previewFetches[0], /v=0/, "initial preview fetch uses v=0");

    // 1. Play and Pause
    const playBtn = page.locator("button.aw-play");
    assert.equal(await playBtn.getAttribute("aria-label"), "Play");
    await playBtn.click();
    assert.equal(await playBtn.getAttribute("aria-label"), "Pause", "clicking Play enters playing state");
    await playBtn.click();
    assert.equal(await playBtn.getAttribute("aria-label"), "Play", "clicking Pause pauses playback");

    // 2. Seek by clicking a scene tab (Scene 3: 8s..12s, center is 10s -> 0:10)
    const scene3Tab = page.locator(".aw-segments li").nth(2);
    await scene3Tab.click();
    assert.ok(await scene3Tab.evaluate((el) => el.classList.contains("on")), "Scene 3 tab is active after click");
    const sceneLabel = await page.locator(".aw-scene").textContent();
    assert.equal(sceneLabel?.trim(), "Scene 3 · Voice and music");
    const clockText = await page.locator(".aw-clock b").textContent();
    assert.equal(clockText?.trim(), "0:10");

    // 3. Add a timed comment, verify persistent role="status" container and accessible button name, and remove it
    const textarea = page.locator(".aw-compose textarea");
    const addBtn = page.locator(".aw-compose button.primary-button");
    await textarea.fill("Temporary note on scene 3");
    await addBtn.click();
    assert.equal(await page.locator(".aw-comments li:not(.empty)").count(), 1);
    assert.equal(await page.locator('.aw-comments li:not(.empty) small[role="status"]').count(), 1);
    assert.equal(await page.locator(".aw-pin").count(), 1);
    const removeBtn = page.locator("button.aw-x").first();
    const removeAriaLabel = await removeBtn.getAttribute("aria-label");
    assert.match(removeAriaLabel ?? "", /^Remove comment \(0:10: Temporary note on scene 3\)$/);
    await removeBtn.click();
    assert.equal(await page.locator(".aw-comments li:not(.empty)").count(), 0);
    assert.equal(await page.locator(".aw-pin").count(), 0);

    // 4. Add scene-level comments on Scene 3 and Scene 1 -> propose + commit -> callback fires and labels appear
    await textarea.fill("Highlight the ducked music waveform");
    await addBtn.click();
    const scene1Tab = page.locator(".aw-segments li").nth(0);
    await scene1Tab.click();
    await textarea.fill("Make the launch title bolder");
    await addBtn.click();

    const applyBtn = page.locator("button.aw-apply");
    assert.equal((await applyBtn.textContent())?.trim(), "Redraw scenes 1, 3");
    const fetchesBeforeApply = previewFetches.length;
    await applyBtn.click();
    await page.waitForFunction(() => Array.isArray(window.__hfAppliedComments) && window.__hfAppliedComments.length > 0);
    const appliedPayloads = await page.evaluate(() => window.__hfAppliedComments);
    assert.deepEqual(appliedPayloads, [
      [
        { line: 0, text: "Make the launch title bolder" },
        { line: 2, text: "Highlight the ducked music waveform" }
      ]
    ]);
    await page.waitForTimeout(200);
    assert.equal(proposeCalls.length, 1, "propose was called with browser-measured snapshots");
    assert.equal(commitCalls.length, 1, "commit was called after propose");
    assert.ok(previewFetches.length > fetchesBeforeApply, "applying comments reloads the composition");

    const commentLabels = await page.locator(".aw-comments li:not(.empty) small").allTextContents();
    assert.deepEqual(
      commentLabels.map((t) => t.trim()),
      ["Scene 1 · re-laid out the scene", "Scene 3 · re-laid out the scene"]
    );
    // Scene/fallback comments without appliedEl must say "Remove comment", NOT claim to undo
    const sceneRemoveAria = await page.locator('.aw-comments li:has-text("Make the launch title bolder") button.aw-x').getAttribute("aria-label");
    assert.match(sceneRemoveAria ?? "", /^Remove comment/);
    const sceneRemoveTitle = await page.locator('.aw-comments li:has-text("Make the launch title bolder") button.aw-x').getAttribute("title");
    assert.equal(sceneRemoveTitle, "Remove comment");

    // 5. Element edit saved and labelled via real propose -> local srcdoc apply + measure -> commit
    await page.waitForFunction(() => {
      const player = document.querySelector("hyperframes-player");
      return Boolean(player?.ready && player?.iframeElement?.contentWindow?.__bp?.elementsAt);
    });
    await textarea.fill('Make "minutes" pink');
    await addBtn.click();
    await applyBtn.click();
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll(".aw-comments li:not(.empty) small")).some((el) =>
        (el.textContent || "").includes("changed colour")
      )
    );
    assert.equal(proposeCalls.length, 2);
    assert.equal(commitCalls.length, 2);
    assert.equal(commitCalls[1].items[0].patch.el, "b1:w:2");
    assert.equal(commitCalls[1].items[0].patch.set.color, "#ff3b6b");
    assert.ok(commitCalls[1].items[0].before.length >= 2, "browser sampled before-window snapshots");
    assert.ok(commitCalls[1].items[0].after.length >= 2, "browser sampled after-window snapshots after local srcdoc apply");
    const undoAria = await page.locator('.aw-comments li:has-text("changed colour") button.aw-x').getAttribute("aria-label");
    assert.match(undoAria ?? "", /^Undo comment edit \(0:02: Make "minutes" pink\)$/);

    // 6a. Undo failure keeps the comment, shows the error, and reloads preview
    forceNextDeleteError = true;
    const undoBtn = page.locator('.aw-comments li:has-text("changed colour") button.aw-x');
    const fetchesBeforeFailedUndo = previewFetches.length;
    await undoBtn.click();
    await page.waitForSelector("p.aw-error[role='alert']");
    assert.match((await page.locator("p.aw-error[role='alert']").textContent()) ?? "", /Database busy while undoing override/i);
    assert.equal(await page.locator('.aw-comments li:has-text("changed colour")').count(), 1, "failed undo must keep the comment");
    assert.ok(previewFetches.length > fetchesBeforeFailedUndo, "failed undo still reloads preview");

    // 6b. Undo element override succeeds -> calls DELETE /plan/overrides/b1:w:2, removes comment only after success, and reloads preview
    await page.waitForFunction(() => {
      const player = document.querySelector("hyperframes-player");
      return Boolean(player?.ready && player?.iframeElement?.contentWindow?.__bp?.elementsAt);
    });
    await undoBtn.click();
    await page.waitForFunction((n) => n > 0, planPatches.length);
    await page.waitForTimeout(100);
    assert.deepEqual(planPatches[planPatches.length - 1], { undoOverride: "b1:w:2" });
    assert.equal(await page.locator('.aw-comments li:has-text("changed colour")').count(), 0, "successful undo removes the comment");

    // 7. 409 on propose or commit shows "The plan changed; apply again" and leaves comments pending
    await page.waitForFunction(() => {
      const player = document.querySelector("hyperframes-player");
      return Boolean(player?.ready && player?.iframeElement?.contentWindow?.__bp?.elementsAt);
    });
    forceNextCommit409 = true;
    await textarea.fill('Make "minutes" orange');
    await addBtn.click();
    await applyBtn.click();
    await page.waitForFunction(() => {
      const el = document.querySelector("p.aw-error[role='alert']");
      return Boolean(el && (el.textContent || "").includes("The plan changed; apply again"));
    });
    const staleCommentText = await page.locator('.aw-comments li:has-text("Make \\"minutes\\" orange")').textContent();
    assert.ok(!staleCommentText?.includes("changed colour"), "409 commit must leave comment pending without appliedLabel");

    // Also verify 409 on propose
    forceNextPropose409 = true;
    await applyBtn.click();
    await page.waitForFunction(() => {
      const el = document.querySelector("p.aw-error[role='alert']");
      return Boolean(el && (el.textContent || "").includes("The plan changed; apply again"));
    });
    await page.locator('.aw-comments li:has-text("Make \\"minutes\\" orange") button.aw-x').click();

    // 8. Partial 422 in a multi-comment batch: refused comment gets reason + all-or-nothing note, and other comment in batch says it was not saved
    await page.waitForFunction(() => {
      const player = document.querySelector("hyperframes-player");
      return Boolean(player?.ready && player?.iframeElement?.contentWindow?.__bp?.elementsAt);
    });
    await textarea.fill('Make "minutes" orange');
    await addBtn.click();
    await textarea.fill('Push "minutes" right 900px off screen');
    await addBtn.click();
    await applyBtn.click();
    await page.waitForFunction(() => document.querySelectorAll(".aw-comment-refused").length >= 2);
    const refusedBatchItem = await page.locator('.aw-comments li:has-text("Push \\"minutes\\" right 900px") small[role="status"]').textContent();
    const siblingBatchItem = await page.locator('.aw-comments li:has-text("Make \\"minutes\\" orange") small[role="status"]').textContent();
    assert.match(refusedBatchItem ?? "", /title-safe|safe/i, "offending comment shows safe-area refusal");
    assert.match(refusedBatchItem ?? "", /all-or-nothing/i, "offending comment states batch commit is all-or-nothing");
    assert.match(siblingBatchItem ?? "", /Not saved.*all-or-nothing/i, "other comment in batch states it was not saved because commit is all-or-nothing");
    await page.locator('.aw-comments li:has-text("Push \\"minutes\\" right 900px") button.aw-x').click();
    await page.locator('.aw-comments li:has-text("Make \\"minutes\\" orange") button.aw-x').click();

    // 8b. Comment missing from propose candidates gets a visible reason
    dropFirstCandidateNextPropose = true;
    await textarea.fill('Make "minutes" yellow');
    await addBtn.click();
    await applyBtn.click();
    await page.waitForSelector('.aw-comments li:has-text("Make \\"minutes\\" yellow") .aw-comment-refused');
    const missingCandReason = await page.locator('.aw-comments li:has-text("Make \\"minutes\\" yellow") .aw-comment-refused').textContent();
    assert.match(missingCandReason ?? "", /No edit candidate was returned/i);
    await page.locator('.aw-comments li:has-text("Make \\"minutes\\" yellow") button.aw-x').click();

    // 9. Fallback failure after a committed element item: keeps element item's saved label, shows error for failed part, and reloads preview
    await page.waitForFunction(() => {
      const player = document.querySelector("hyperframes-player");
      return Boolean(player?.ready && player?.iframeElement?.contentWindow?.__bp?.elementsAt);
    });
    await textarea.fill('Make "minutes" green');
    await addBtn.click();
    await textarea.fill("Add a customer testimonial quote");
    await addBtn.click();
    await page.evaluate(() => {
      let thrown = false;
      Object.defineProperty(window, "__hfAppliedComments", {
        configurable: true,
        get() {
          return [];
        },
        set(val) {
          if (!thrown) {
            thrown = true;
            throw new Error("Scene storyboard rewrite failed.");
          }
          Object.defineProperty(window, "__hfAppliedComments", {
            configurable: true,
            writable: true,
            value: val
          });
        }
      });
    });
    const fetchesBeforeFallbackFail = previewFetches.length;
    await applyBtn.click();
    await page.waitForFunction(() => {
      const errEl = document.querySelector("p.aw-error[role='alert']");
      return Boolean(errEl && (errEl.textContent || "").includes("Scene storyboard rewrite failed."));
    });
    const greenLabel = await page.locator('.aw-comments li:has-text("Make \\"minutes\\" green") small').textContent();
    assert.match(greenLabel ?? "", /changed colour/, "committed element item keeps its saved label when scene fallback throws");
    const failedFallbackLabel = await page.locator('.aw-comments li:has-text("Add a customer testimonial quote") small').textContent();
    assert.ok(!failedFallbackLabel?.includes("re-laid out the scene"), "failed scene fallback comment must not be marked applied");
    assert.ok(previewFetches.length > fetchesBeforeFallbackFail, "preview reloads to match saved plan after partial fallback failure");
    await page.locator('.aw-comments li:has-text("Add a customer testimonial quote") button.aw-x').click();
    await page.waitForFunction(() => {
      const player = document.querySelector("hyperframes-player");
      return Boolean(player?.ready && player?.iframeElement?.contentWindow?.__bp?.elementsAt);
    });
    await page.locator('.aw-comments li:has-text("Make \\"minutes\\" green") button.aw-x').click();
    await page.waitForFunction(() => {
      const player = document.querySelector("hyperframes-player");
      return Boolean(player?.ready && player?.iframeElement?.contentWindow?.__bp?.elementsAt);
    });

    // 10. Server error shows an error alert, NOT an applied label, and leaves the comment unapplied
    forceNextProposeServerError = true;
    await textarea.fill('Make "minutes" cyan');
    await addBtn.click();
    await applyBtn.click();
    await page.waitForFunction(() => {
      const errEl = document.querySelector("p.aw-error[role='alert']");
      return Boolean(errEl && (errEl.textContent || "").includes("Server failed while proposing edit"));
    });
    const unappliedItemText = await page.locator('.aw-comments li:has-text("Make \\"minutes\\" cyan")').textContent();
    assert.ok(!unappliedItemText?.includes("changed colour"), "failed request must never claim 'changed colour'");
    await page.locator('.aw-comments li:has-text("Make \\"minutes\\" cyan") button.aw-x').click();

    // 9. Change subtitle mode -> sends PATCH /plan { captions: "none" } and reloads player
    const fetchesBeforeSub = previewFetches.length;
    await page.locator('button.aw-pill-item:has-text("Subtitles")').click();
    await page.waitForSelector('[role="dialog"][aria-label="Subtitle mode"]');
    assert.equal(await page.locator('[aria-label="Subtitle font size"]').count(), 1);
    assert.equal(await page.locator('[aria-label="Subtitle colors"]').count(), 1);
    assert.equal(await page.locator('[aria-label="Transparency"]').count(), 1);

    await page.locator('button.aw-option-row:has-text("Off")').click();
    await page.waitForTimeout(200);
    assert.deepEqual(planPatches[planPatches.length - 1], { captions: "none" });
    assert.ok(previewFetches.length > fetchesBeforeSub, "changing subtitle mode reloads the composition HTML");

    // 10. Toggle Voice off -> sends PATCH /plan { audioMode: "music" } and reloads player
    const fetchesBeforeAudio = previewFetches.length;
    await page.locator('button[role="tab"]:has-text("Audio")').click();
    const audioGroup = page.locator('[role="group"][aria-label="Audio tracks"]');
    await audioGroup.waitFor();
    const chipTexts = await audioGroup.locator("button.aw-track-chip").allTextContents();
    assert.deepEqual(chipTexts.map((t) => t.trim()), ["Voice", "Music"]);

    const voiceChip = audioGroup.locator('button.aw-track-chip:has-text("Voice")');
    assert.equal(await voiceChip.getAttribute("aria-pressed"), "true");
    await voiceChip.click();
    await page.waitForTimeout(200);
    assert.equal(await voiceChip.getAttribute("aria-pressed"), "false");
    assert.deepEqual(planPatches[planPatches.length - 1], { audioMode: "music" });
    assert.ok(previewFetches.length > fetchesBeforeAudio, "toggling Voice off reloads the composition HTML");

    // 11. Render opens the token modal when balance (5) < cost (12)
    await page.locator("button.aw-render-top").click();
    const modal = page.locator('[role="dialog"][aria-labelledby="sc-modal-title"]');
    await modal.waitFor();
    const modalText = await modal.textContent();
    assert.ok(modalText?.includes("12 tokens"), "token modal displays 12 tokens cost");
    assert.ok(modalText?.includes("7 more"), "token modal displays 7 more needed");
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (nextProc && nextProc.pid) {
      const exitPromise = new Promise((r) => nextProc.once("exit", r));
      try {
        process.kill(-nextProc.pid, "SIGTERM");
      } catch {
        try {
          nextProc.kill("SIGTERM");
        } catch {
          // ignore
        }
      }
      await Promise.race([exitPromise, new Promise((r) => setTimeout(r, 1500))]);
      try {
        process.kill(-nextProc.pid, "SIGKILL");
      } catch {
        // already exited
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
});
