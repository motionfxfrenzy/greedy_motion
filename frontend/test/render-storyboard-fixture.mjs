import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { FIXTURE_HF_FRAMES, FIXTURE_HF_PROJECT } from "./fixtures/hf/data.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(HERE, "..");
const REPO_DIR = resolve(FRONTEND_DIR, "..");
const SCREENSHOTS_DIR = join(REPO_DIR, "docs/handoff/screenshots");
const WS_FIXTURES_DIR = join(HERE, "fixtures/workspace");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const CLIP_16X9 = readFileSync(join(WS_FIXTURES_DIR, "clip-16x9.mp4"));
const CLIP_9X16 = readFileSync(join(WS_FIXTURES_DIR, "clip-9x16.mp4"));

const COMBINED_CSS = [
  readFileSync(join(FRONTEND_DIR, "app/theme.css"), "utf8"),
  readFileSync(join(FRONTEND_DIR, "app/styles.css"), "utf8"),
  readFileSync(join(FRONTEND_DIR, "app/animation-workspace.css"), "utf8"),
  readFileSync(join(FRONTEND_DIR, "app/plate-preview.css"), "utf8")
].join("\n");

const HOW_MONEY_EVOLVES_ID = "316f1cbd-b5b9-49af-ae3b-2add10a18ed5";
const HOW_MONEY_EVOLVES_SCENES = [
  {
    index: 0,
    keyword: "A hen wants bread",
    visual: "hen in big shoes hops up to market-stall where loaf waves from the counter, a curl of steam rising off loaf's hat.",
    onScreen: "",
    state: "drawn"
  },
  {
    index: 1,
    keyword: "Eggs, no thanks",
    visual: "hen lifts egg-basket high; loaf shakes its head, pie-cut eyes squeezed shut, pushing egg-basket back with one gloved hand.",
    onScreen: "",
    state: "checked"
  },
  {
    index: 2,
    keyword: "The long swap",
    visual: "hen trudges a looping dotted path away from market-stall, egg-basket wobbling, feathers drooping lower with each step on twos.",
    onScreen: "Trading thing for thing",
    state: "drawn"
  },
  {
    index: 3,
    keyword: "A pretty shell",
    visual: "hen and loaf both point at one shell on the counter, nodding together on the beat, shell glinting with a tiny wink.",
    onScreen: "Something everyone agrees on",
    state: "checked"
  },
  {
    index: 4,
    keyword: "Shell to coin",
    visual: "shell on the counter squashes and pops into a round coin with a face, which tips its tiny hat at hen.",
    onScreen: "",
    state: "checked"
  },
  {
    index: 5,
    keyword: "Coin to paper",
    visual: "a tall stack of coin teeters in hen's arms, then flattens into one paper-note that floats down into her glove.",
    onScreen: "",
    state: "checked"
  },
  {
    index: 6,
    keyword: "Still warm",
    visual: "hen hands paper-note to loaf; loaf hands back a slice of itself, steam curling up as hen dances off on twos.",
    onScreen: "",
    state: "checked"
  }
];

function makePortraitSvg(sceneIndex, keyword, subtitle, bg = "#f6efe2") {
  const num = String(sceneIndex + 1).padStart(2, "0");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280">` +
    `<rect width="720" height="1280" fill="${bg}"/>` +
    `<rect x="44" y="44" width="632" height="1192" rx="32" fill="none" stroke="#1c1917" stroke-width="6"/>` +
    `<circle cx="360" cy="${440 + sceneIndex * 24}" r="140" fill="#f59e0b" stroke="#1c1917" stroke-width="6"/>` +
    `<text x="90" y="150" fill="#1c1917" font-family="sans-serif" font-size="36" font-weight="800">SCENE ${num}</text>` +
    `<text x="90" y="960" fill="#1c1917" font-family="sans-serif" font-size="44" font-weight="800">${keyword}</text>` +
    (subtitle
      ? `<text x="90" y="1025" fill="#57534e" font-family="sans-serif" font-size="28" font-weight="600">${subtitle}</text>`
      : "") +
    `</svg>`
  );
}

const HOW_MONEY_SCRIPT_FRAMES = [...HOW_MONEY_EVOLVES_SCENES]
  .reverse()
  .map((s) => ({
    key: [
      "v2",
      "story-illus-rubber-hose",
      "illus-rubber-hose",
      "9:16",
      s.keyword,
      s.visual,
      s.onScreen
    ].join("\u0001"),
    svg: makePortraitSvg(s.index, s.keyword, s.onScreen)
  }));

const HOW_MONEY_PLATE_STATUS = {
  available: true,
  look: "illus-rubber-hose",
  mode: "live",
  running: false,
  drawnAspects: ["9:16"],
  drawingAspects: [],
  comments: [],
  scenes: HOW_MONEY_EVOLVES_SCENES.map((s) => ({
    index: s.index,
    keyword: s.keyword,
    state: s.state,
    seconds: 5,
    frames: 150,
    sig: `sig-money-${s.index}`,
    rev: s.index === 2 ? 1 : 0,
    bundleDigest: `digest-money-${s.index}-abcdef123456`,
    variants: {
      "9:16": {
        state: s.state,
        sig: `sig-money-${s.index}-9x16`,
        v: s.state === "drawn" ? `vstill${s.index}` : null,
        bundleDigest: `digest-money-${s.index}-abcdef123456`,
        live: s.state === "checked"
      }
    }
  }))
};

async function startFixtureServer() {
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
    import HfFinalFixturePage from "./app/dev/hf-final-fixture/page.tsx";
    import { resolveRenderStoryboardScenes } from "./components/final-render-step.tsx";
    import { isImageAssetUrl, svgSrc } from "./components/script-canvas.tsx";
    import { plateStillUrl } from "./lib/api.ts";

    window.__renderStoryboardHelpers = {
      resolveRenderStoryboardScenes,
      isImageAssetUrl,
      svgSrc,
      plateStillUrl
    };

    const el = document.getElementById("root");
    if (el) {
      const root = createRoot(el);
      root.render(<HfFinalFixturePage />);
    }
  `;

  const bundled = await build({
    stdin: {
      contents: entrySource,
      resolveDir: FRONTEND_DIR,
      sourcefile: "render-storyboard-fixture-entry.tsx",
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
  const addr = srv.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { srv, origin: `http://127.0.0.1:${port}`, port };
}

test(
  "Render-in-progress storyboard & two-panel layout: plate and non-plate reload resolution, sparse frames without renumbering, 1135x775 desktop geometry, mobile fallback, keyboard/mouse navigation, and ready transition",
  { timeout: 120_000 },
  async () => {
    mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const { srv, origin } = await startFixtureServer();

    let browser = null;
    try {
      browser = await chromium.launch({
        executablePath: CHROME_PATH,
        headless: true
      });

      const context = await browser.newContext({
        viewport: { width: 1135, height: 775 }
      });

      let failStillForScene2 = true;
      let renderPostCalls = 0;

      await context.route("**/*", async (route) => {
        const req = route.request();
        const url = new URL(req.url());

        if (req.method() === "POST" && url.pathname.includes("/render")) {
          renderPostCalls += 1;
        }

        if (url.hostname === "fonts.googleapis.com") {
          await route.fulfill({ status: 200, contentType: "text/css", body: "" });
          return;
        }
        if (url.pathname.endsWith("/media-token")) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              token: "fixture-token",
              expiresAt: "2099-01-01T00:00:00.000Z"
            })
          });
          return;
        }
        if (new RegExp(`/projects/${HOW_MONEY_EVOLVES_ID}$`).test(url.pathname)) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              ...FIXTURE_HF_PROJECT,
              id: HOW_MONEY_EVOLVES_ID,
              name: "how money evolves",
              state: "Rendering draft",
              scriptFrames: HOW_MONEY_SCRIPT_FRAMES,
              coverFrame: HOW_MONEY_SCRIPT_FRAMES[HOW_MONEY_SCRIPT_FRAMES.length - 1].svg
            })
          });
          return;
        }
        if (new RegExp(`/projects/${FIXTURE_HF_PROJECT.id}$`).test(url.pathname)) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              ...FIXTURE_HF_PROJECT,
              scriptFrames: FIXTURE_HF_PROJECT.brief.scriptBeats.map((b, i) => ({
                key: ["v2", "", "", "16:9", b.keyword, b.visual ?? "", b.onScreen ?? ""].join("\u0001"),
                svg: FIXTURE_HF_FRAMES[i]
              }))
            })
          });
          return;
        }
        if (new RegExp(`/projects/${HOW_MONEY_EVOLVES_ID}/plates$`).test(url.pathname)) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(HOW_MONEY_PLATE_STATUS)
          });
          return;
        }
        const stillMatch = /\/projects\/([^/]+)\/plates\/(\d+)\/still$/.exec(url.pathname);
        if (stillMatch) {
          const idx = Number(stillMatch[2]);
          if (idx === 2 && failStillForScene2) {
            await route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"not_found"}' });
            return;
          }
          const scene = HOW_MONEY_EVOLVES_SCENES[idx];
          if (scene && (scene.state === "drawn" || scene.state === "checked")) {
            const svg = makePortraitSvg(idx, `${scene.keyword} (Plate Still)`, scene.onScreen, "#efe6d5");
            await route.fulfill({
              status: 200,
              contentType: "image/svg+xml",
              body: svg
            });
            return;
          }
          await route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"not_found"}' });
          return;
        }
        if (url.pathname.endsWith(".mp4")) {
          const isPortrait = url.pathname.includes("9x16");
          await route.fulfill({
            status: 200,
            contentType: "video/mp4",
            body: isPortrait ? CLIP_9X16 : CLIP_16X9
          });
          return;
        }
        await route.continue();
      });

      const page = await context.newPage();

      // 1. Reference viewport 1135x775: "how money evolves" portrait 9:16 plate project on direct reload (frames=[] initially)
      await page.goto(
        `${origin}/dev/hf-final-fixture?state=e2-rendering-frames&mode=plate-reload&header=1`,
        { waitUntil: "networkidle" }
      );
      await page.waitForSelector(".render-workspace .frame-reel-stage img.on", { timeout: 15_000 });

      // Unit-test pure helper functions exposed on window
      const unitCheck = await page.evaluate(() => {
        const { isImageAssetUrl, svgSrc, resolveRenderStoryboardScenes } = window.__renderStoryboardHelpers;
        const rawSvg = '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
        const httpUrl = "http://127.0.0.1:4000/v1/projects/p1/plates/0/still?t=tok&v=1&aspect=9%3A16";
        const pathUrl = "/api/backend/projects/p1/plates/0/still";
        const dataUrl = "data:image/png;base64,AAAA";

        return {
          rawIsUrl: isImageAssetUrl(rawSvg),
          httpIsUrl: isImageAssetUrl(httpUrl),
          pathIsUrl: isImageAssetUrl(pathUrl),
          dataIsUrl: isImageAssetUrl(dataUrl),
          rawEncoded: svgSrc(rawSvg).startsWith("data:image/svg+xml;charset=utf-8,"),
          httpPreserved: svgSrc(httpUrl) === httpUrl,
          pathPreserved: svgSrc(pathUrl) === pathUrl,
          dataPreserved: svgSrc(dataUrl) === dataUrl,
          hasResolveFn: typeof resolveRenderStoryboardScenes === "function"
        };
      });
      assert.equal(unitCheck.rawIsUrl, false, "raw SVG is not treated as an asset URL");
      assert.equal(unitCheck.httpIsUrl, true, "http:// still URL is recognized as an asset URL");
      assert.equal(unitCheck.pathIsUrl, true, "relative / path is recognized as an asset URL");
      assert.equal(unitCheck.dataIsUrl, true, "data:image/ URI is recognized as an asset URL");
      assert.equal(unitCheck.rawEncoded, true, "raw SVG is encoded as data:image/svg+xml");
      assert.equal(unitCheck.httpPreserved, true, "http:// asset URL is never re-encoded as SVG");
      assert.equal(unitCheck.pathPreserved, true, "relative path is preserved");
      assert.equal(unitCheck.dataPreserved, true, "data URI is preserved");

      // Check DOM layout and content at 1135x775
      const layout1135 = await page.evaluate(() => {
        const doc = document.documentElement;
        const ws = document.querySelector(".render-workspace").getBoundingClientRect();
        const player = document.querySelector(".render-workspace > .workspace-player").getBoundingClientRect();
        const card = document.querySelector(".render-workspace .render-card").getBoundingClientRect();
        const stage = document.querySelector(".frame-reel-stage").getBoundingClientRect();
        const activeImg = document.querySelector(".frame-reel-stage img.on");
        const strip = document.querySelector(".frame-reel-strip");
        const stripButtons = [...document.querySelectorAll(".frame-reel-strip button")];
        const steps = [...document.querySelectorAll(".render-card ol li")].map((li) => ({
          text: li.textContent.trim(),
          cls: li.className,
          rect: li.getBoundingClientRect()
        }));
        const backBtn = document.querySelector(".render-card .render-back-button").getBoundingClientRect();
        const bodyText = document.body.innerText;

        return {
          vw: window.innerWidth,
          vh: window.innerHeight,
          docScrollW: doc.scrollWidth,
          docScrollH: doc.scrollHeight,
          ws,
          player,
          card,
          stage,
          imgSrc: activeImg?.getAttribute("src") ?? null,
          imgNaturalW: activeImg?.naturalWidth ?? 0,
          imgNaturalH: activeImg?.naturalHeight ?? 0,
          imgObjectFit: activeImg ? getComputedStyle(activeImg).objectFit : null,
          sceneStepText: document.querySelector(".frame-reel-step")?.textContent?.trim(),
          sceneTitleText: document.querySelector(".frame-reel-title strong")?.textContent?.trim(),
          aspectBadge: document.querySelector(".frame-reel-aspect")?.textContent?.trim(),
          thumbCount: stripButtons.length,
          thumbLabels: stripButtons.map((b) => b.getAttribute("aria-label")),
          stripClientW: strip.clientWidth,
          stripScrollW: strip.scrollWidth,
          steps,
          backBtn,
          hasGenericMockup:
            bodyText.includes("No screenshot yet") ||
            bodyText.includes("Upload a real product screenshot in the Script step")
        };
      });

      assert.equal(layout1135.vw, 1135);
      assert.equal(layout1135.vh, 775);
      assert.ok(layout1135.docScrollW <= 1135, `no horizontal overflow at 1135x775 (scrollWidth=${layout1135.docScrollW})`);
      assert.ok(layout1135.docScrollH <= 775, `no vertical document overflow at 1135x775 (scrollHeight=${layout1135.docScrollH})`);
      assert.equal(layout1135.hasGenericMockup, false, "generic product upload mockup must never appear");

      // Side-by-side panels check
      assert.ok(
        layout1135.player.left < layout1135.card.left && layout1135.player.right <= layout1135.card.left + 1,
        `storyboard panel (${layout1135.player.right}) is to the left of render card (${layout1135.card.left})`
      );
      assert.ok(
        Math.abs(layout1135.player.top - layout1135.card.top) < 4,
        "left storyboard panel and right status card align at the top"
      );
      assert.ok(
        layout1135.card.width >= 300 && layout1135.card.width <= 360,
        `right status card width (${layout1135.card.width}px) is within 300–360px`
      );
      assert.ok(layout1135.player.width >= 650, `left storyboard panel is flexible (${layout1135.player.width}px)`);

      // Portrait 9:16 image check
      assert.equal(layout1135.aspectBadge, "9:16");
      assert.equal(layout1135.imgObjectFit, "contain");
      assert.equal(layout1135.imgNaturalW, 720, "portrait scene image naturalWidth is 720");
      assert.equal(layout1135.imgNaturalH, 1280, "portrait scene image naturalHeight is 1280 (9:16)");
      assert.ok(
        layout1135.imgSrc.includes(`/v1/projects/${HOW_MONEY_EVOLVES_ID}/plates/0/still`),
        `drawn scene 0 uses authenticated plate still URL (${layout1135.imgSrc})`
      );

      // 7 scenes in exact saved order
      assert.equal(layout1135.thumbCount, 7, "all 7 scenes of 'how money evolves' are shown");
      assert.equal(layout1135.sceneStepText, "Scene 1 of 7");
      assert.equal(layout1135.sceneTitleText, "A hen wants bread");
      assert.deepEqual(layout1135.thumbLabels, [
        "Show frame 1: A hen wants bread",
        "Show frame 2: Eggs, no thanks",
        "Show frame 3: The long swap",
        "Show frame 4: A pretty shell",
        "Show frame 5: Shell to coin",
        "Show frame 6: Coin to paper",
        "Show frame 7: Still warm"
      ]);

      // Vertical progress steps & visible Back button check
      assert.equal(layout1135.steps.length, 4);
      for (let i = 1; i < layout1135.steps.length; i++) {
        assert.ok(
          layout1135.steps[i].rect.top >= layout1135.steps[i - 1].rect.bottom - 1,
          `progress step ${i + 1} is stacked vertically below step ${i}`
        );
      }
      assert.ok(
        layout1135.steps[2].text.includes("360 / 600"),
        `frames progress step displays real frame counts (${layout1135.steps[2].text})`
      );
      assert.ok(
        layout1135.backBtn.bottom <= 775 && layout1135.backBtn.top >= layout1135.card.top,
        `Back to browser Animation button is visible inside the viewport (bottom=${layout1135.backBtn.bottom})`
      );

      await page.screenshot({
        path: join(SCREENSHOTS_DIR, "render-storyboard-1135x775-portrait.png")
      });

      // 2. Thumbnail selection by mouse click and keyboard arrows (read-only, no render restart)
      await page.click('.frame-reel-strip button[aria-label="Show frame 2: Eggs, no thanks"]');
      const afterClickScene2 = await page.evaluate(() => {
        const activeImg = document.querySelector(".frame-reel-stage img.on");
        return {
          step: document.querySelector(".frame-reel-step")?.textContent?.trim(),
          title: document.querySelector(".frame-reel-title strong")?.textContent?.trim(),
          src: activeImg?.getAttribute("src") ?? ""
        };
      });
      assert.equal(afterClickScene2.step, "Scene 2 of 7");
      assert.equal(afterClickScene2.title, "Eggs, no thanks");
      assert.ok(
        afterClickScene2.src.startsWith("data:image/svg+xml;charset=utf-8,"),
        "checked live-mode scene 2 resolves its persisted scriptFrames SVG immediately without 404"
      );

      // Keyboard navigation: ArrowRight -> Scene 3 ("The long swap"), whose /plates/2/still returned 404 and fell back to scriptFrames SVG
      await page.focus('.frame-reel-strip button[aria-label="Show frame 2: Eggs, no thanks"]');
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(
        () => document.querySelector(".frame-reel-title strong")?.textContent?.trim() === "The long swap"
      );
      // Wait for scene 3's 404 still to fall back to its saved scriptFrames SVG
      await page.waitForFunction(() => {
        const img = document.querySelector(".frame-reel-stage img.on");
        return img && img.getAttribute("src")?.startsWith("data:image/svg+xml") && img.naturalWidth === 720;
      });
      const afterKeyScene3 = await page.evaluate(() => ({
        step: document.querySelector(".frame-reel-step")?.textContent?.trim(),
        title: document.querySelector(".frame-reel-title strong")?.textContent?.trim(),
        subtitle: document.querySelector(".frame-reel-subtitle")?.textContent?.trim(),
        activeAria: document.activeElement?.getAttribute("aria-label")
      }));
      assert.equal(afterKeyScene3.step, "Scene 3 of 7");
      assert.equal(afterKeyScene3.title, "The long swap");
      assert.equal(afterKeyScene3.subtitle, "Trading thing for thing");
      assert.equal(afterKeyScene3.activeAria, "Show frame 3: The long swap");
      assert.equal(renderPostCalls, 0, "navigating storyboard scenes never triggers a render POST");

      // 3. Test waiting (queuePosition), retrying, and failed states at 1135x775
      await page.goto(
        `${origin}/dev/hf-final-fixture?state=e1-rendering-waiting&mode=plate-reload&header=1`,
        { waitUntil: "networkidle" }
      );
      await page.waitForSelector(".render-workspace .frame-reel-stage img.on");
      const waitingText = await page.locator(".render-card ol li.current").innerText();
      assert.ok(waitingText.includes("2 ahead"), `waiting state shows queue position (${waitingText})`);

      await page.goto(
        `${origin}/dev/hf-final-fixture?state=f-rendering-retry&mode=plate-reload&header=1`,
        { waitUntil: "networkidle" }
      );
      await page.waitForSelector(".render-workspace .render-retry");
      const retryNote = await page.locator(".render-card .render-retry").innerText();
      assert.ok(retryNote.includes("Attempt 2 hit a renderer error"), `retrying state shows attempt (${retryNote})`);

      await page.goto(
        `${origin}/dev/hf-final-fixture?state=g-failed&mode=plate-reload&header=1`,
        { waitUntil: "networkidle" }
      );
      await page.waitForSelector(".render-workspace .render-error");
      const failedCard = await page.evaluate(() => {
        const err = document.querySelector(".render-error");
        const buttons = [...err.querySelectorAll("button")].map((b) => ({
          text: b.textContent.trim(),
          rect: b.getBoundingClientRect()
        }));
        return {
          heading: document.querySelector(".render-card header b")?.textContent?.trim(),
          buttons,
          hasStoryboardImg: Boolean(document.querySelector(".frame-reel-stage img.on"))
        };
      });
      assert.equal(failedCard.heading, "Render needs attention");
      assert.equal(failedCard.hasStoryboardImg, true, "storyboard remains visible beside failed render card");
      assert.equal(failedCard.buttons.length, 2);
      assert.equal(failedCard.buttons[0].text, "Try again");
      assert.equal(failedCard.buttons[1].text, "Back to Animation");
      assert.ok(failedCard.buttons[0].rect.bottom <= 775 && failedCard.buttons[1].rect.bottom <= 775);

      await page.screenshot({
        path: join(SCREENSHOTS_DIR, "render-storyboard-1135x775-failed.png")
      });

      // 4. Sparse / partial frames (mode=partial): scenes 2 & 4 missing, scenes 1, 3, 5 present — no renumbering!
      await page.goto(
        `${origin}/dev/hf-final-fixture?state=e2-rendering-frames&mode=partial&header=1`,
        { waitUntil: "networkidle" }
      );
      await page.waitForSelector(".frame-reel-strip");
      const partialState = await page.evaluate(() => {
        const stripButtons = [...document.querySelectorAll(".frame-reel-strip button")];
        return {
          count: stripButtons.length,
          labels: stripButtons.map((b) => b.getAttribute("aria-label")),
          thumbsHaveImg: stripButtons.map((b) => Boolean(b.querySelector("img")))
        };
      });
      assert.equal(partialState.count, 5, "sparse 5-scene array keeps all 5 scene slots");
      assert.deepEqual(partialState.thumbsHaveImg, [true, false, true, false, true]);
      assert.equal(partialState.labels[2], "Show frame 3: Voice and music", "scene 3 is still scene 3, not renumbered to 2");

      // Click missing scene 2 -> shows honest per-scene unavailable message with scene 2's title
      await page.click('.frame-reel-strip button[aria-label="Show frame 2: Paste your brief"]');
      const missingScene2 = await page.evaluate(() => ({
        step: document.querySelector(".frame-reel-step")?.textContent?.trim(),
        emptyText: document.querySelector(".frame-reel-empty")?.innerText?.trim() ?? ""
      }));
      assert.equal(missingScene2.step, "Scene 2 of 5");
      assert.ok(missingScene2.emptyText.includes("Paste your brief"));
      assert.ok(missingScene2.emptyText.includes("Scene preview unavailable"));

      // 5. Empty / unavailable board (mode=empty): shows "Storyboard preview unavailable", never product screenshot mockup
      await page.goto(
        `${origin}/dev/hf-final-fixture?state=e3-rendering-encoding&mode=empty&header=1`,
        { waitUntil: "networkidle" }
      );
      await page.waitForSelector(".frame-reel-empty");
      const emptyState = await page.evaluate(() => ({
        emptyText: document.querySelector(".frame-reel-empty")?.innerText?.trim() ?? "",
        bodyText: document.body.innerText
      }));
      assert.ok(emptyState.emptyText.includes("Storyboard preview unavailable"));
      assert.equal(emptyState.bodyText.includes("No screenshot yet"), false);

      // 6. Larger desktop 1440x900 (dark theme, 16:9 non-plate reload & long copy)
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(
        `${origin}/dev/hf-final-fixture?state=e2-rendering-frames&mode=hf-reload&theme=dark&header=1`,
        { waitUntil: "networkidle" }
      );
      await page.waitForSelector(".render-workspace .frame-reel-stage img.on");
      const desktop1440 = await page.evaluate(() => {
        const player = document.querySelector(".render-workspace > .workspace-player").getBoundingClientRect();
        const card = document.querySelector(".render-workspace .render-card").getBoundingClientRect();
        const activeImg = document.querySelector(".frame-reel-stage img.on");
        return {
          docScrollW: document.documentElement.scrollWidth,
          docScrollH: document.documentElement.scrollHeight,
          player,
          card,
          imgW: activeImg?.naturalWidth ?? 0,
          imgH: activeImg?.naturalHeight ?? 0
        };
      });
      assert.ok(desktop1440.docScrollW <= 1440 && desktop1440.docScrollH <= 900);
      assert.ok(desktop1440.player.right <= desktop1440.card.left + 1);
      assert.equal(desktop1440.imgW, 640);
      assert.equal(desktop1440.imgH, 360);

      await page.screenshot({
        path: join(SCREENSHOTS_DIR, "render-storyboard-1440x900-dark-16x9.png")
      });

      // 6b. Square 1:1 aspect ratio & long titles/error messages at 1440x900
      await page.goto(
        `${origin}/dev/hf-final-fixture?state=g-failed&mode=long&aspect=1:1&header=1`,
        { waitUntil: "networkidle" }
      );
      await page.waitForSelector(".render-workspace .frame-reel-stage img.on");
      const longSquare = await page.evaluate(() => {
        const player = document.querySelector(".render-workspace > .workspace-player").getBoundingClientRect();
        const card = document.querySelector(".render-workspace .render-card").getBoundingClientRect();
        const strip = document.querySelector(".frame-reel-strip").getBoundingClientRect();
        const retryBtn = document.querySelector(".render-error-actions button").getBoundingClientRect();
        return {
          docScrollW: document.documentElement.scrollWidth,
          docScrollH: document.documentElement.scrollHeight,
          aspectBadge: document.querySelector(".frame-reel-aspect")?.textContent?.trim(),
          stripContained: strip.right <= player.right + 1 && strip.left >= player.left - 1,
          cardSideBySide: player.right <= card.left + 1,
          retryVisible: retryBtn.bottom <= 900 && retryBtn.top >= card.top
        };
      });
      assert.equal(longSquare.aspectBadge, "1:1");
      assert.ok(longSquare.docScrollW <= 1440 && longSquare.docScrollH <= 900);
      assert.equal(longSquare.stripContained, true, "thumbnail strip overflow is contained inside left panel");
      assert.equal(longSquare.cardSideBySide, true, "long titles and error copy keep two-panel layout intact");
      assert.equal(longSquare.retryVisible, true, "retry action remains visible with long error copy");

      // 7. Mobile / narrow viewport 390x844: stacked fallback with reachable controls
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(
        `${origin}/dev/hf-final-fixture?state=e2-rendering-frames&mode=plate-reload&header=1`,
        { waitUntil: "networkidle" }
      );
      await page.waitForSelector(".render-workspace .frame-reel-stage img.on");
      const mobile390 = await page.evaluate(() => {
        const ws = document.querySelector(".render-workspace");
        const player = document.querySelector(".render-workspace > .workspace-player").getBoundingClientRect();
        const card = document.querySelector(".render-workspace .render-card").getBoundingClientRect();
        ws.scrollTop = ws.scrollHeight;
        const backBtnAfterScroll = document.querySelector(".render-card .render-back-button").getBoundingClientRect();
        return {
          docScrollW: document.documentElement.scrollWidth,
          stacked: card.top >= player.bottom - 2,
          backVisibleAfterScroll: backBtnAfterScroll.bottom <= window.innerHeight && backBtnAfterScroll.top >= 0
        };
      });
      assert.ok(mobile390.docScrollW <= 390, `no horizontal overflow on 390px mobile (${mobile390.docScrollW})`);
      assert.equal(mobile390.stacked, true, "panels stack vertically on narrow 390px viewport");
      assert.equal(
        mobile390.backVisibleAfterScroll,
        true,
        "Back button is reachable by scrolling on narrow viewport (not trapped offscreen)"
      );

      await page.screenshot({
        path: join(SCREENSHOTS_DIR, "render-storyboard-390x844-mobile.png")
      });

      // 8. Transition to completed FinalView (b-ready-9x16)
      await page.setViewportSize({ width: 1135, height: 775 });
      await page.goto(
        `${origin}/dev/hf-final-fixture?state=b-ready-9x16&header=1`,
        { waitUntil: "networkidle" }
      );
      await page.waitForSelector(".pf-stage video.pf-video");
      const readyView = await page.evaluate(() => ({
        hasFinalStage: Boolean(document.querySelector(".pf-stage video.pf-video")),
        hasRenderCard: Boolean(document.querySelector(".render-card"))
      }));
      assert.equal(readyView.hasFinalStage, true, "completed job renders FinalView video player");
      assert.equal(readyView.hasRenderCard, false, "render progress card is replaced by FinalView when ready");
    } finally {
      if (browser) await browser.close();
      await new Promise((r) => srv.close(r));
    }
  }
);
