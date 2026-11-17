// The storyboard header of a cast-preview film in a real Chrome: the right-column heading is ONE short line ("Preview" with the long explanation as a tooltip), the sets cost
// sits subtly in the header status line (only while the sets are unpainted), and the token-short notice stays visible. Run: node --test frontend/test/storyboard-heading-chrome.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "../../node_modules/playwright-core/index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(HERE, "..");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CSS = ["theme.css", "styles.css"].map((f) => readFileSync(join(FRONTEND_DIR, "app", f), "utf8")).join("\n");

test("the heading is one line, the cost is in the status line, the notice is visible", { timeout: 120_000, skip: !existsSync(CHROME_PATH) && "Google Chrome not found" }, async () => {
  const entry = `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { ScriptCanvas } from "./components/script-canvas.tsx";
    const beats = Array.from({ length: 13 }, (_, i) => ({ keyword: "Beat " + (i + 1), visual: "[gorge] wide: Blondin walks the rope", onScreen: null, line: "Line number " + (i + 1) + " of the film." }));
    const SVG = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280"><rect width="720" height="1280" fill="#10121a"/></svg>');
    function App() {
      const state = window.__state;
      const common = {
        projectId: "p", beats, open: null, writing: null, scoped: false, versions: beats.map(() => null), onReimagine() {}, onVersion() {}, streaming: false, startedAt: Date.now() - 12000,
        flags: [], error: null, voiced: true, length: { seconds: 38, pace: "fast", locked: false, keepOverLength: false }, onFit() {}, onEdit() {}, onAsk() {}, onCancel() {},
        frames: beats.map((_, i) => ({ state: "ready", svg: SVG, ...(state === "cards" ? (i < 2 ? { phase: "painting" } : i === 3 ? { phase: "plain" } : i === 4 ? { phase: "failed" } : {}) : {}) })), aspect: "9:16", styleName: "Cartoon history", onRedraw() {}, voice: { state: "ready", takes: [] }, onConfirm() {}, onRetryVoice() {},
        music: true, onRender() {}, rendering: false, storyboard: { state: "ready" }, onContinue() {}, continuing: false
      };
      const extra = state === "cards" ? { previewTokens: 3.258 } : state === "notice" ? { previewTokens: 3.258, setsNotice: { message: "Sets need 3.258 tokens and you have 0.35. Add tokens to paint the real sets; until then the cards show their key phrase.", onAddTokens() {} } }
        : state === "painting" ? { previewTokens: 3.258, paintingSets: true } : state === "painted" ? { previewTokens: 0 } : { previewTokens: 3.258 };
      return <main className="relay-shell relay-shell--storyboard"><ScriptCanvas {...common} {...extra} /></main>;
    }
    createRoot(document.getElementById("root")).render(<App />);
  `;
  const bundled = await build({ stdin: { contents: entry, resolveDir: FRONTEND_DIR, sourcefile: "heading-entry.tsx", loader: "tsx" }, bundle: true, format: "esm", target: "es2022", write: false, define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_API_URL": '""', "process.env": "{}" } });
  const js = bundled.outputFiles[0].text;
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1135, height: 775 } })).newPage();
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    const open = async (state) => {
      await page.setContent(`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>${CSS}</style></head><body><div id="root"></div></body></html>`);
      await page.evaluate((s) => { window.__state = s; }, state);
      await page.addScriptTag({ type: "module", content: js });
      await page.waitForSelector(".sc-doc-head");
    };
    const head = () => page.evaluate(() => {
      const h = document.querySelector(".sc-doc-head"), right = h.children[1];
      const style = getComputedStyle(right), line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3;
      return { text: right.textContent.trim(), lines: Math.round(right.getBoundingClientRect().height / line), width: Math.round(right.getBoundingClientRect().width), title: right.querySelector("[title]")?.getAttribute("title") ?? null, status: document.querySelector(".sc-head")?.textContent ?? "", notice: document.querySelector(".sc-sets-notice")?.textContent ?? null };
    });

    await open("unpainted");
    const a = await head();
    assert.equal(a.text, "Preview ⓘ", "one short word");
    assert.equal(a.lines, 1, `one line in the ${a.width}px column`);
    assert.match(a.title, /Real set and cast\. The action and camera are written in Animation\./, "the long explanation is the tooltip");
    assert.match(a.status, /13 beats .* · sets 3\.3t/, `the sets cost sits in the header status line: ${a.status.slice(0, 140)}`);
    assert.equal(a.notice, null);
    await open("painting"); const b = await head(); assert.match(b.status, /painting the sets…/); assert.ok(!/sets 3\.3t/.test(b.status), "while painting, the cost gives way to the progress");
    await open("painted"); const c = await head(); assert.ok(!/sets \d/.test(c.status) && !/painting/.test(c.status), "once the sets are painted the status line is back to the beat count"); assert.equal(c.lines, 1);
    await open("notice"); const d = await head();
    assert.match(d.notice, /Sets need 3\.258 tokens and you have 0\.35\. Add tokens to paint the real sets/); assert.match(d.notice, /Add tokens/, "the notice stays visible, with its action");
    assert.equal(d.lines, 1);
    // card states: painting (shimmer + "Painting the set…", several cards may share one set), drawn (just the still), plain (no overlay: the notice explains), failed (a small Retry)
    await open("cards");
    const cards = await page.evaluate(() => [...document.querySelectorAll(".sc-frame")].slice(0, 6).map((f) => ({ painting: f.querySelector(".sc-frame-painting")?.textContent ?? null, failed: f.querySelector(".sc-frame-failed")?.textContent ?? null, retry: Boolean(f.querySelector(".sc-frame-failed button")), shimmer: getComputedStyle(f.querySelector(".sc-frame-painting") ?? f).animationName })));
    assert.deepEqual(cards.map((c) => c.painting), ["Painting the set…", "Painting the set…", null, null, null, null], "the two cards of one set both show it");
    assert.match(cards[0].shimmer, /gallery-shimmer/, "a subtle moving shimmer");
    assert.deepEqual(cards.map((c) => c.retry), [false, false, false, false, true, false], "only the failed card has a Retry");
    assert.match(cards[4].failed, /The set could not be painted/); assert.equal(cards[3].painting, null); assert.equal(cards[3].failed, null, "a plain key-phrase card has no overlay");
    assert.equal(cards[2].painting ?? cards[2].failed, null, "a drawn card is just the still");
    const out = process.env.HEADING_SHOT; if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, await page.screenshot({ clip: { x: 0, y: 0, width: 1135, height: 420 } })); }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
