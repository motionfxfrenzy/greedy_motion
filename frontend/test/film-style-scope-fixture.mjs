import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "../../node_modules/playwright-core/index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(FRONTEND_DIR, "..");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const COMBINED_CSS = [
  readFileSync(join(FRONTEND_DIR, "app/theme.css"), "utf8"),
  readFileSync(join(FRONTEND_DIR, "app/styles.css"), "utf8")
].join("\n");

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

async function startFixtureServer() {
  const entrySource = `
    import React, { useEffect, useState } from "react";
    import { createRoot } from "react-dom/client";
    import { DEFAULT_LOOK, filmKind, isFilmBrief } from "@videosaas/contracts";
    import { FilmBrief } from "./components/film-brief.tsx";
    import { StylePicker } from "./components/style-picker.tsx";

    const INITIAL_BEATS = [
      { keyword: "Barter cows", line: "Long before coins or cards, you traded what you had: a cow for a sack of grain.", onScreen: "Cow for grain", visual: "A rubber hose farmer holding a cow beside a baker with grain sacks", speaker: "Merchant" },
      { keyword: "First coins", line: "In Lydia, kings stamped lions onto electrum lumps, promising every coin weighed the same.", onScreen: "Stamped weight", visual: "An anvil stamping a grinning lion onto a round coin", speaker: "King" },
      { keyword: "Paper IOUs", line: "Carrying chests of metal grew heavy, so merchants left their gold in vaults and traded paper receipts.", onScreen: "Paper receipts", visual: "A merchant trading a tall stack of coins for a single fluttering paper note", speaker: "Banker" }
    ];

    const INITIAL_BRIEF = {
      scriptMode: "problem",
      text: "Explain how money evolves from barter and shells to coins, paper notes, and digital ledgers.",
      look: "illus-rubber-hose",
      styleExample: "story-illus-rubber-hose",
      durationMode: "custom",
      durationSeconds: 45,
      aspect: "16:9",
      aspects: ["16:9", "9:16"],
      keepOverLength: true,
      motionProfile: "smooth",
      pace: "balanced",
      captions: "key-phrases",
      audio: {
        mode: "both",
        voice: "Kore",
        cast: "characters",
        voices: { Merchant: "Puck", King: "Fenrir", Banker: "Aoede" },
        language: "es",
        musicMood: "Playful, vintage swing, warm"
      }
    };

    function loadSavedBrief() {
      try {
        const raw = window.sessionStorage.getItem("fixture-film-brief");
        return raw ? JSON.parse(raw) : INITIAL_BRIEF;
      } catch {
        return INITIAL_BRIEF;
      }
    }

    function FixtureApp() {
      const [mode, setMode] = useState("film"); // "film" | "general"
      const [brief, setBrief] = useState(loadSavedBrief);
      const [generalBrief, setGeneralBrief] = useState({ look: "sketch", styleFamily: undefined, styleExample: "sketch-explainer" });
      const [draft, setDraft] = useState({
        beats: INITIAL_BEATS,
        streaming: false,
        writing: null,
        flags: [],
        error: null
      });
      const [calls, setCalls] = useState({ writeDraft: [], updateCount: 0 });

      useEffect(() => {
        try {
          window.sessionStorage.setItem("fixture-film-brief", JSON.stringify(brief));
        } catch {}
      }, [brief]);

      window.__fixture = {
        getState: () => ({
          mode,
          brief,
          isFilm: isFilmBrief(brief),
          filmKind: filmKind(brief),
          generalBrief,
          draft,
          calls
        }),
        setMode,
        setBrief,
        resetBrief: () => setBrief(INITIAL_BRIEF)
      };

      if (mode === "general") {
        return (
          <main className="relay-shell">
            <div className="flow-page script-style">
              <section className="ss-card">
                <h2>General Product StylePicker</h2>
                <StylePicker
                  value={generalBrief.look ?? DEFAULT_LOOK}
                  family={generalBrief.styleFamily}
                  example={generalBrief.styleExample}
                  onChange={(look, styleFamily, styleExample) => setGeneralBrief({ look, styleFamily, styleExample })}
                />
              </section>
            </div>
          </main>
        );
      }

      const isFilm = isFilmBrief(brief);

      return (
        <main className={isFilm ? "relay-shell relay-shell--film-brief" : "relay-shell"}>
          <div className="ambient ambient-blue" /><div className="ambient ambient-peach" />
          <header className="creation-header">
            <div className="creation-project">
              <button type="button">← Projects</button><i />
              <strong>how money evolves</strong>
              <span>Drafting script</span>
            </div>
            <ol className="flow-steps">
              <li><button type="button" className="current"><b>1</b>Brief</button><i /></li>
              <li><button type="button"><b>2</b>Storyboard</button><i /></li>
              <li><button type="button" disabled><b>3</b>Animation</button><i /></li>
              <li><button type="button" disabled><b>4</b>Render</button></li>
            </ol>
          </header>
          {isFilm ? (
            <FilmBrief
              brief={brief}
              update={(patch) => {
                setCalls((c) => ({ ...c, updateCount: c.updateCount + 1 }));
                setBrief((current) => ({ ...current, ...patch }));
              }}
              draft={draft}
              writeDraft={(instruction) => {
                setCalls((c) => ({ ...c, writeDraft: [...c.writeDraft, instruction ?? null] }));
              }}
              editDraft={(index, patch) => {
                setDraft((d) => ({
                  ...d,
                  beats: d.beats.map((b, i) => (i === index ? { ...b, ...patch } : b))
                }));
              }}
              stopDraft={() => {}}
              continueDraft={() => {}}
              continueToStoryboard={() => {}}
              hasStoryboard={true}
              error={null}
            />
          ) : (
            <div className="flow-page" data-testid="wrong-product-form">
              <h1>Product Script &amp; Style Form (Wrong Route!)</h1>
            </div>
          )}
        </main>
      );
    }

    createRoot(document.getElementById("root")).render(<FixtureApp />);
  `;

  const bundled = await build({
    stdin: {
      contents: entrySource,
      resolveDir: FRONTEND_DIR,
      sourcefile: "film-style-scope-fixture-entry.tsx",
      loader: "tsx"
    },
    bundle: true,
    format: "esm",
    target: "es2022",
    write: false,
    define: {
      "process.env.NODE_ENV": '"development"',
      "process.env.NEXT_PUBLIC_API_URL": '""',
      "process.env": "{}"
    }
  });
  const bundleJs = bundled.outputFiles[0].text;
  const contracts = await import("@videosaas/contracts");

  let failTemplates = false;
  let simulateUnrestartedBackend = false;

  const srv = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/bundle.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(bundleJs);
      return;
    }
    if (url.pathname === "/v1/gallery/styles") {
      if (simulateUnrestartedBackend) {
        // Simulate old un-restarted backend that omitted illus-* styles and ignored scope=film
        const legacyItems = contracts.galleryStyles({ plates: false });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ items: legacyItems }));
        return;
      }
      const scopeParam = url.searchParams.get("scope") ?? undefined;
      if (scopeParam !== undefined && !contracts.isGalleryScope(scopeParam)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "invalid_request", message: "Unknown scope." } }));
        return;
      }
      const items = contracts.galleryStyles({ plates: true, scope: scopeParam });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ items }));
      return;
    }
    if (url.pathname === "/v1/gallery/templates") {
      if (failTemplates) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Simulated failure" } }));
        return;
      }
      const scopeParam = simulateUnrestartedBackend ? undefined : (url.searchParams.get("scope") ?? undefined);
      const look = url.searchParams.get("look") ?? undefined;
      const useCase = url.searchParams.get("use_case") ?? undefined;
      const q = url.searchParams.get("q") ?? undefined;
      const cursor = url.searchParams.get("cursor") ?? undefined;
      const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
      const page = contracts.queryGallery({ plates: true, scope: scopeParam, look, useCase, q, cursor, limit });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(page));
      return;
    }
    if (url.pathname.startsWith("/previews/") || url.pathname.startsWith("/templates/")) {
      const diskPath = join(FRONTEND_DIR, "public", url.pathname);
      try {
        const bytes = readFileSync(diskPath);
        const ct = diskPath.endsWith(".jpg") ? "image/jpeg" : diskPath.endsWith(".webp") ? "image/webp" : "image/png";
        res.writeHead(200, { "content-type": ct });
        res.end(bytes);
        return;
      } catch {}
    }
    if (url.pathname.startsWith("/gallery/") || url.pathname.startsWith("/v1/gallery/")) {
      const file = url.pathname.split("/").pop() ?? "";
      const templateId = file.split(".")[0] ?? "";
      const tpl = contracts.findGalleryTemplate(templateId);
      const lookSrc = tpl ? contracts.getLook(tpl.look).preview.src : "/previews/looks/clean.png";
      try {
        const diskPath = join(FRONTEND_DIR, "public", lookSrc);
        const bytes = readFileSync(diskPath);
        const ct = diskPath.endsWith(".jpg") ? "image/jpeg" : "image/png";
        res.writeHead(200, { "content-type": ct });
        res.end(bytes);
        return;
      } catch {}
      res.writeHead(200, { "content-type": "image/png" });
      res.end(TINY_PNG);
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Film Style Scope Fixture</title>
  <style>${COMBINED_CSS}</style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/bundle.js"></script>
</body>
</html>`);
  });

  await new Promise((resolveListen) => srv.listen(0, "127.0.0.1", resolveListen));
  const address = srv.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    srv,
    baseUrl,
    setFailTemplates: (val) => {
      failTemplates = val;
    },
    setSimulateUnrestartedBackend: (val) => {
      simulateUnrestartedBackend = val;
    }
  };
}

test("FilmBrief style picker: compatible educational and story/visual choices, pagination, search, round-trip persistence, mobile, and general picker preservation", async () => {
  const { srv, baseUrl, setFailTemplates, setSimulateUnrestartedBackend } = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1135, height: 775 } });
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    // 1. Initial compact row shows "Rubber hose story"
    const rowLabel = await page.locator(".sp-row-name b").textContent();
    assert.equal(rowLabel?.trim(), "Rubber hose story", "Initial compact row shows Rubber hose story");

    // 2. Click Change at 1135x775 -> opens film style library overview
    await page.locator(".sp-browse").click();
    const dialog = page.locator("dialog.theme-dialog");
    await dialog.waitFor({ state: "visible" });

    const overviewAudit = await page.evaluate(() => {
      const dlg = document.querySelector("dialog.theme-dialog");
      const eyebrow = dlg.querySelector(".theme-dialog-header .eyebrow")?.textContent?.trim();
      const title = dlg.querySelector("#style-dialog-title")?.textContent?.trim();
      const blurb = dlg.querySelector(".theme-dialog-header p")?.textContent?.trim();
      const filterButtons = Array.from(dlg.querySelectorAll(".style-filters button")).map((b) => b.textContent?.trim());
      const cards = Array.from(dlg.querySelectorAll(".sp-grid .sp-card")).map((c) => {
        const r = c.getBoundingClientRect();
        return {
          name: c.querySelector("b")?.textContent?.trim(),
          sub: c.querySelector("small")?.textContent?.trim(),
          isCurrent: c.classList.contains("is-current"),
          hasCheck: Boolean(c.querySelector(".sp-check")),
          top: Math.round(r.top),
          bottom: Math.round(r.bottom)
        };
      });
      return { eyebrow, title, blurb, filterButtons, cards, innerHeight: window.innerHeight };
    });

    assert.equal(overviewAudit.eyebrow, "36 styles", "Overview header reports 36 compatible styles");
    assert.equal(overviewAudit.title, "Choose a visual style");
    assert.match(overviewAudit.blurb ?? "", /educational explainer or illustrated story style/i, "Dialog copy explains educational and story/visual choices");
    assert.doesNotMatch(overviewAudit.blurb ?? "", /brand still sets/i, "Dialog copy avoids irrelevant product-brand copy");
    assert.deepEqual(overviewAudit.filterButtons, ["All", "Essentials", "Drawn", "Illustration"], "Group filters show only compatible groups");

    // Current Rubber hose style is first, marked selected, and visible without scrolling
    assert.equal(overviewAudit.cards.length, 36);
    assert.equal(overviewAudit.cards[0].name, "Illustration · Rubber hose", "Selected Rubber hose style is placed first in overview");
    assert.equal(overviewAudit.cards[0].isCurrent, true, "Rubber hose card has .is-current");
    assert.equal(overviewAudit.cards[0].hasCheck, true, "Rubber hose card has checkmark");
    assert.ok(overviewAudit.cards[0].top >= 0 && overviewAudit.cards[0].bottom <= overviewAudit.innerHeight, "Selected Rubber hose card is visible inside 1135x775 viewport");

    // Verify educational & story styles are present and product/brand-only styles are absent
    const cardNames = new Set(overviewAudit.cards.map((c) => c.name));
    assert.ok(cardNames.has("Clean · Data & diagrams"));
    assert.ok(cardNames.has("Sketch"));
    assert.ok(cardNames.has("Doodle"));
    assert.ok(cardNames.has("Illustration · Crayon"));
    assert.ok(cardNames.has("Illustration · Cyanotype blueprint"));
    assert.equal(cardNames.has("Line art · Hairline"), false, "Hairline (product/brand only) is excluded");
    assert.equal(cardNames.has("Crosshatch"), false, "Crosshatch (product only) is excluded");
    assert.equal(cardNames.has("Zigzag"), false, "Zigzag (product only) is excluded");
    assert.equal(cardNames.has("Vox · Editorial collage"), false, "Vox Editorial collage (product only) is excluded");
    assert.equal(cardNames.has("Clean · 3D & cinematic"), false, "3D & cinematic (hidden/non-film) is excluded");

    await page.screenshot({ path: join(REPO_ROOT, "docs/handoff/film-style-picker-overview-1135x775.png") });

    // 3. Test group filter buttons and search in overview
    await dialog.locator('.style-filters button', { hasText: "Drawn" }).click();
    const drawnCards = await dialog.locator(".sp-grid .sp-card b").allTextContents();
    assert.deepEqual(drawnCards, ["Sketch", "Doodle"], "Drawn filter shows only compatible Drawn styles (Sketch, Doodle)");

    await dialog.locator('.style-filters button', { hasText: "Illustration" }).click();
    const illusCount = await dialog.locator(".sp-grid .sp-card").count();
    assert.equal(illusCount, 31, "Illustration filter shows all 31 code-drawn illustration styles");

    await dialog.locator('.style-filters button', { hasText: "All" }).click();
    const searchInput = page.locator('input[aria-label="Search styles"]');
    await searchInput.fill("whiteboard");
    const whiteboardMatches = await page.locator(".sp-grid .sp-card b").allTextContents();
    assert.deepEqual(whiteboardMatches, ["Sketch"], "Searching 'whiteboard' finds Sketch via its compatible whiteboard examples");

    await searchInput.fill("feature spotlight");
    const emptyMsg = await page.locator(".sp-empty").textContent();
    assert.match(emptyMsg ?? "", /No style matches "feature spotlight"/, "Searching excluded SaaS template shows empty state");
    await searchInput.fill("");

    // 4. Open "Clean · Data & diagrams" -> verify counts, tabs, pagination, search, and example selection
    await page.locator(".sp-grid .sp-card", { hasText: "Clean · Data & diagrams" }).click();
    await page.locator(".sp-back").waitFor({ state: "visible" });

    // Wait for page 1 of examples to finish loading
    await page.waitForFunction(() => !document.querySelector(".sp-examples")?.getAttribute("aria-busy"));

    const detailAudit = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll(".sp-detail-bar .filter-tabs button")).map((b) => b.textContent?.replace(/\s+/g, " ").trim());
      const cards = Array.from(document.querySelectorAll(".sp-examples .gallery-card h3")).map((h) => h.textContent?.trim());
      const moreBtn = document.querySelector(".sp-sentinel button")?.textContent?.trim();
      return { tabs, cards, moreBtn };
    });

    assert.deepEqual(detailAudit.tabs, ["All 28", "Explainers & learning 28"], "StyleDetail shows accurate film-scoped tabs/counts without SaaS tab");
    assert.equal(detailAudit.cards.length, 12, "Page 1 shows 12 items");
    assert.equal(detailAudit.moreBtn, "Show more (16 left)", "Pagination button shows 16 left");

    await page.screenshot({ path: join(REPO_ROOT, "docs/handoff/film-style-picker-detail-educational-1135x775.png") });

    // Load page 2 and page 3 (via Show more button and/or scroll sentinel)
    await page.evaluate(() => {
      document.querySelector(".sp-sentinel button")?.click();
    });
    await page.waitForFunction(() => document.querySelectorAll(".sp-examples .gallery-card h3").length >= 24);
    await page.evaluate(() => {
      document.querySelector(".sp-sentinel button")?.click();
    });
    await page.waitForFunction(() => document.querySelectorAll(".sp-examples .gallery-card h3").length === 28);
    assert.equal(await page.locator(".sp-sentinel").count(), 0, "Show more button disappears when all 28 items are loaded");

    const all28Titles = await page.locator(".sp-examples .gallery-card h3").allTextContents();
    assert.equal(new Set(all28Titles).size, 28, "All 28 paginated example cards are unique");

    // Search within StyleDetail examples
    const detailSearch = page.locator('input[aria-label="Search examples"]');
    await detailSearch.fill("Bayes");
    await page.waitForFunction(() => document.querySelectorAll(".sp-examples .gallery-card h3").length === 1);
    const bayesTitle = await page.locator(".sp-examples .gallery-card h3").textContent();
    assert.equal(bayesTitle?.trim(), "Bayes Theorem Boxes");

    // Select "Bayes Theorem Boxes"
    await page.locator(".sp-examples .gallery-card .gallery-action").click();
    await page.waitForFunction(() => !document.querySelector("dialog.theme-dialog")?.open);

    const afterEducational = await page.evaluate(() => window.__fixture.getState());
    assert.equal(afterEducational.isFilm, true, "Selecting educational example keeps isFilmBrief(brief) === true");
    assert.equal(afterEducational.filmKind, "explainer");
    assert.equal(afterEducational.brief.look, "clean");
    assert.equal(afterEducational.brief.styleFamily, "clean-data");
    assert.equal(afterEducational.brief.styleExample, "bayes-boxes");
    // Verify all other brief fields and script were preserved and no regeneration was triggered
    assert.equal(afterEducational.brief.text.startsWith("Explain how money evolves"), true);
    assert.equal(afterEducational.brief.durationMode, "custom");
    assert.equal(afterEducational.brief.durationSeconds, 45);
    assert.deepEqual(afterEducational.brief.aspects, ["16:9", "9:16"]);
    assert.equal(afterEducational.brief.keepOverLength, true);
    assert.deepEqual(afterEducational.brief.audio.voices, { Merchant: "Puck", King: "Fenrir", Banker: "Aoede" });
    assert.equal(afterEducational.brief.audio.language, "es");
    assert.equal(afterEducational.draft.beats.length, 3);
    assert.equal(afterEducational.calls.writeDraft.length, 0, "Browsing and selecting style does not trigger paid script generation");
    assert.equal((await page.locator(".sp-row-name b").textContent())?.trim(), "Bayes Theorem Boxes", "Compact row updates to Bayes Theorem Boxes");

    // 5. Reopen Change, open Doodle (mixed style: 1 explain, 10 saas), and click top "Use this style" without picking a card
    await page.locator(".sp-browse").click();
    await page.locator(".sp-grid .sp-card", { hasText: "Doodle" }).click();
    await page.waitForFunction(() => !document.querySelector(".sp-examples")?.getAttribute("aria-busy"));
    const doodleTabs = await page.locator(".sp-detail-bar .filter-tabs button").allTextContents();
    assert.deepEqual(doodleTabs.map((t) => t.replace(/\s+/g, " ").trim()), ["All 1", "Explainers & learning 1"]);

    // Click header "Use this style" button directly
    await page.locator(".sp-detail-bar > .primary-button").click();
    await page.waitForFunction(() => !document.querySelector("dialog.theme-dialog")?.open);

    const afterDoodle = await page.evaluate(() => window.__fixture.getState());
    assert.equal(afterDoodle.isFilm, true, "Clicking header 'Use this style' on Doodle preserves its film-compatible example and stays on FilmBrief");
    assert.equal(afterDoodle.brief.look, "doodle");
    assert.equal(afterDoodle.brief.styleExample, "storybook-raindrop-journey");
    assert.equal((await page.locator(".sp-row-name b").textContent())?.trim(), "Storybook science explainer");
    assert.equal(await page.locator('[data-testid="wrong-product-form"]').count(), 0, "Never navigated to wrong product form");

    // 6. Switch to another visual/story style ("Illustration · Crayon" -> "Crayon story") and verify reload survival
    await page.locator(".sp-browse").click();
    await page.locator(".sp-grid .sp-card", { hasText: "Illustration · Crayon" }).click();
    await page.waitForFunction(() => !document.querySelector(".sp-examples")?.getAttribute("aria-busy"));
    const crayonTabs = await page.locator(".sp-detail-bar .filter-tabs button").allTextContents();
    assert.deepEqual(crayonTabs.map((t) => t.replace(/\s+/g, " ").trim()), ["All 1", "Story & film 1"]);

    await page.locator(".sp-examples .gallery-card .gallery-action").click();
    await page.waitForFunction(() => !document.querySelector("dialog.theme-dialog")?.open);

    const afterCrayon = await page.evaluate(() => window.__fixture.getState());
    assert.equal(afterCrayon.isFilm, true);
    assert.equal(afterCrayon.filmKind, "story");
    assert.equal(afterCrayon.brief.look, "illus-balloon");
    assert.equal(afterCrayon.brief.styleExample, "story-illus-balloon");
    assert.equal((await page.locator(".sp-row-name b").textContent())?.trim(), "Crayon story");

    await page.screenshot({ path: join(REPO_ROOT, "docs/handoff/film-style-picker-selected-crayon-1135x775.png") });

    // Reload the page and verify selected preview and film brief state survive reload
    await page.reload({ waitUntil: "networkidle" });
    assert.equal((await page.locator(".sp-row-name b").textContent())?.trim(), "Crayon story", "Selected Crayon story preview survives page reload");
    const afterReload = await page.evaluate(() => window.__fixture.getState());
    assert.equal(afterReload.isFilm, true);
    assert.equal(afterReload.brief.look, "illus-balloon");
    assert.equal(afterReload.brief.styleExample, "story-illus-balloon");

    // 7. Test error/retry path in StyleDetail
    setFailTemplates(true);
    await page.locator(".sp-browse").click();
    await page.locator(".sp-grid .sp-card").filter({ has: page.locator("b", { hasText: /^Sketch$/ }) }).click();
    await page.locator('.sp-empty[role="alert"]').waitFor({ state: "visible" });
    setFailTemplates(false);
    await page.locator('.sp-empty[role="alert"] button', { hasText: "Try again" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".sp-examples .gallery-card h3").length === 4);
    await page.locator("button.theme-close").click();

    // 8. Mobile viewport (390x844): Change opens expected library without horizontal overflow
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".sp-browse").click();
    await dialog.waitFor({ state: "visible" });
    const mobileAudit = await page.evaluate(() => {
      const doc = document.scrollingElement || document.documentElement;
      const dlg = document.querySelector("dialog.theme-dialog");
      const r = dlg.getBoundingClientRect();
      return {
        docScrollWidth: doc.scrollWidth,
        docClientWidth: doc.clientWidth,
        dlgLeft: Math.round(r.left),
        dlgRight: Math.round(r.right),
        innerWidth: window.innerWidth,
        cardCount: dlg.querySelectorAll(".sp-grid .sp-card").length
      };
    });
    assert.ok(mobileAudit.docScrollWidth <= mobileAudit.docClientWidth, "390x844: no horizontal overflow on mobile");
    assert.ok(mobileAudit.dlgLeft >= 0 && mobileAudit.dlgRight <= mobileAudit.innerWidth, "390x844: dialog fits inside mobile viewport");
    assert.equal(mobileAudit.cardCount, 36, "390x844: all 36 compatible styles reachable on mobile");
    await page.screenshot({ path: join(REPO_ROOT, "docs/handoff/film-style-picker-mobile-390x844.png") });
    await page.locator("button.theme-close").click();

    // 9. Verify general non-film StylePicker remains unchanged
    await page.setViewportSize({ width: 1135, height: 775 });
    await page.evaluate(() => window.__fixture.setMode("general"));
    await page.locator(".sp-browse").waitFor({ state: "visible" });
    await page.locator(".sp-browse").click();
    await page.waitForFunction(() => !document.querySelector(".sp-examples")?.getAttribute("aria-busy"));

    // General picker opened on Sketch shows all 12 templates across SaaS, Explainers, and Brand
    const generalSketchTabs = await page.locator(".sp-detail-bar .filter-tabs button").allTextContents();
    assert.deepEqual(
      generalSketchTabs.map((t) => t.replace(/\s+/g, " ").trim()),
      ["All 12", "SaaS & product 6", "Explainers & learning 4", "Brand & social 2"],
      "General StylePicker preserves all SaaS, Explainer, and Brand tabs/counts"
    );
    await page.screenshot({ path: join(REPO_ROOT, "docs/handoff/general-style-picker-sketch-1135x775.png") });

    await page.locator(".sp-back").click();
    const generalOverviewCount = await page.locator(".sp-grid .sp-card").count();
    assert.equal(generalOverviewCount, 41, "General StylePicker overview shows all 41 styles including product/brand styles");
    await page.locator("button.theme-close").click();

    // 10. Verify fallback when talking to an un-restarted backend that ignores scope=film
    setSimulateUnrestartedBackend(true);
    await page.evaluate(() => {
      window.__fixture.resetBrief();
      window.__fixture.setMode("film");
    });
    await page.locator(".sp-browse").waitFor({ state: "visible" });
    await page.locator(".sp-browse").click();
    assert.equal(await page.locator(".sp-grid .sp-card").count(), 36, "Still shows all 36 film styles against an un-restarted backend");
    await page.locator(".sp-grid .sp-card").filter({ has: page.locator("b", { hasText: /^Sketch$/ }) }).click();
    await page.waitForFunction(() => !document.querySelector(".sp-examples")?.getAttribute("aria-busy"));
    const fallbackSketchTabs = await page.locator(".sp-detail-bar .filter-tabs button").allTextContents();
    assert.deepEqual(
      fallbackSketchTabs.map((t) => t.replace(/\s+/g, " ").trim()),
      ["All 4", "Explainers & learning 4"],
      "Still filters Sketch to its 4 explain examples against an un-restarted backend"
    );
    setSimulateUnrestartedBackend(false);
  } finally {
    await browser.close();
    srv.close();
  }
});
