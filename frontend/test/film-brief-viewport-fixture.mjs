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

// 1x1 dark PNG placeholder for preview assets
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

async function startFilmBriefFixtureServer() {
  const entrySource = `
    import React, { useState } from "react";
    import { createRoot } from "react-dom/client";
    import { findGalleryTemplate, galleryStyles, galleryTemplates, isFilmBrief } from "@videosaas/contracts";
    import { FilmBrief } from "./components/film-brief.tsx";

    const LONG_BEATS = [
      { keyword: "Barter cows", line: "Long before coins or cards, you traded what you had: a cow for a sack of grain, if the baker happened to want a cow.", onScreen: "Cow for grain", visual: "A rubber hose farmer holding a cow beside a baker with grain sacks", speaker: "Merchant" },
      { keyword: "Shells & salt", line: "Soon people agreed on lighter tokens—cowrie shells, salt bars, and shiny bits of bronze that fit inside a pocket.", onScreen: "Shells and bronze", visual: "Cartoon hands swapping cowrie shells and stamped bronze tokens" },
      { keyword: "First coins", line: "In Lydia, kings stamped lions onto electrum lumps, promising every coin weighed the same without a scale.", onScreen: "Stamped weight", visual: "An anvil stamping a grinning lion onto a round coin", speaker: "King" },
      { keyword: "Paper IOUs", line: "Carrying chests of metal grew heavy, so merchants left their gold in vaults and traded paper receipts instead.", onScreen: "Paper receipts", visual: "A merchant trading a tall stack of coins for a single fluttering paper note", speaker: "Banker" },
      { keyword: "Central banks", line: "Governments backed those notes by law, turning paper promises into national currencies trusted across borders.", onScreen: "Backed by law", visual: "A grand cartoon vault door stamping official seals onto paper notes" },
      { keyword: "Goldsmith vaults", line: "Goldsmiths realized not everyone withdrew their gold at once, giving birth to fractional reserve banking.", onScreen: "Vault reserves", visual: "A goldsmith counting ledger notes beside a gleaming safe", speaker: "Goldsmith" },
      { keyword: "Telegraph wire", line: "By the nineteenth century, telegraph cables flashed balances across oceans without a single coin leaving port.", onScreen: "Wire transfer", visual: "Sparks of numbers racing along an undersea cable", speaker: "Clerk" },
      { keyword: "Plastic cards", line: "Then money lost its body altogether—plastic cards and glowing bank ledgers moved numbers at the speed of light.", onScreen: "Invisible numbers", visual: "A magnetic stripe card zipping through a telegraph wire as glowing digits" },
      { keyword: "ATMs & terminals", line: "Corner machines and checkout scanners turned every neighborhood shop into an instant branch of the global ledger.", onScreen: "Instant clearing", visual: "A cheerful cartoon ATM dispensing crisp notes", speaker: "Miner" },
      { keyword: "Mobile wallets", line: "A tap of a glass screen replaced leather wallets, settling coffee and rent in milliseconds.", onScreen: "Tap to pay", visual: "Two phones clinking together with a chime of light" },
      { keyword: "Code & trust", line: "From cows to code, money has always been the same invention: a shared story about who owes what to whom.", onScreen: "A shared story", visual: "A cow, a coin, a banknote, and a digital spark dancing in a circle" },
      { keyword: "Future ledger", line: "And tomorrow, whatever new form money takes, it will still run on the oldest currency of all: human trust.", onScreen: "Human trust", visual: "Two rubber-hose characters shaking hands across a glowing globe" }
    ];

    function FixtureApp() {
      const [view, setView] = useState("create");
      const [step, setStep] = useState(0);
      const [hasStoryboard, setHasStoryboard] = useState(true);
      const [error, setError] = useState(null);
      const [brief, setBrief] = useState({
        scriptMode: "problem",
        text: "Explain how money evolves from barter and shells to coins, paper notes, and digital ledgers.",
        look: "illus-rubber-hose",
        styleExample: "story-illus-rubber-hose",
        durationSeconds: 45,
        aspect: "16:9",
        motionProfile: "smooth",
        pace: "balanced",
        captions: "key-phrases",
        audio: { mode: "both", voice: "Kore", musicMood: "Playful, vintage swing, warm" }
      });
      const [draft, setDraft] = useState({
        beats: LONG_BEATS,
        streaming: false,
        writing: null,
        flags: [],
        error: null
      });
      const [calls, setCalls] = useState({
        writeDraft: [],
        stopDraft: 0,
        continueDraft: 0,
        continueToStoryboard: 0
      });

      window.__fixture = {
        getState: () => ({ view, step, brief, draft, hasStoryboard, error, calls }),
        setView,
        setStep,
        setBrief,
        setDraft,
        setHasStoryboard,
        setError,
        LONG_BEATS
      };

      const isFilmBriefView = view === "create" && step === 0 && isFilmBrief(brief);

      return (
        <main
          className={isFilmBriefView ? "relay-shell relay-shell--film-brief" : "relay-shell"}
        >
          <div className="ambient ambient-blue" /><div className="ambient ambient-peach" />
          {view === "create" ? (
            <>
              <header className="creation-header">
                <div className="creation-project">
                  <button type="button" onClick={() => setView("projects")}>← Projects</button><i />
                  <strong>how money evolves</strong>
                  <span>Drafting script</span>
                </div>
                <ol className="flow-steps">
                  <li><button type="button" className={step === 0 ? "current" : "complete"} onClick={() => setStep(0)}><b>1</b>Brief</button><i /></li>
                  <li><button type="button" className={step === 1 ? "current" : ""} onClick={() => setStep(1)}><b>2</b>Storyboard</button><i /></li>
                  <li><button type="button" disabled><b>3</b>Animation</button><i /></li>
                  <li><button type="button" disabled><b>4</b>Render</button></li>
                </ol>
              </header>
              {step === 0 && isFilmBrief(brief) && (
                <FilmBrief
                  brief={brief}
                  update={(patch) => setBrief((current) => ({ ...current, ...patch }))}
                  draft={draft}
                  writeDraft={(instruction) => {
                    setCalls((c) => ({ ...c, writeDraft: [...c.writeDraft, instruction ?? null] }));
                  }}
                  editDraft={(index, patch) => {
                    setDraft((d) => d ? {
                      ...d,
                      beats: d.beats.map((b, i) => i === index ? { ...b, ...patch } : b)
                    } : d);
                  }}
                  stopDraft={() => {
                    setCalls((c) => ({ ...c, stopDraft: c.stopDraft + 1 }));
                    setDraft((d) => d ? { ...d, streaming: false } : d);
                  }}
                  continueDraft={() => {
                    setCalls((c) => ({ ...c, continueDraft: c.continueDraft + 1 }));
                  }}
                  continueToStoryboard={() => {
                    setCalls((c) => ({ ...c, continueToStoryboard: c.continueToStoryboard + 1 }));
                    setStep(1);
                  }}
                  hasStoryboard={hasStoryboard}
                  error={error}
                />
              )}
              {step === 1 && (
                <div className="flow-page" style={{ minHeight: "1400px" }}>
                  <h1>Storyboard step</h1>
                </div>
              )}
            </>
          ) : (
            <section className="page-container" style={{ minHeight: "1400px" }}>
              <h1>Projects</h1>
            </section>
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
      sourcefile: "film-brief-fixture-entry.tsx",
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

  const { findGalleryTemplate, galleryStyles } = await import("@videosaas/contracts");
  const rubberHoseTemplate = findGalleryTemplate("story-illus-rubber-hose");
  const allStyles = galleryStyles();

  const srv = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/bundle.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(bundleJs);
      return;
    }
    if (url.pathname === "/v1/gallery/styles") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(allStyles));
      return;
    }
    if (url.pathname === "/v1/gallery/templates") {
      const items = rubberHoseTemplate ? [rubberHoseTemplate] : [];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ items, total: items.length, nextCursor: null, counts: { all: items.length } }));
      return;
    }
    if (url.pathname.startsWith("/previews/") || url.pathname.startsWith("/gallery/")) {
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
  <title>Film Brief Viewport Fixture</title>
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
  return { srv, baseUrl };
}

async function measureDesktopViewport(page, label) {
  const m = await page.evaluate(() => {
    const doc = document.scrollingElement || document.documentElement;
    const header = document.querySelector(".creation-header");
    const flowTitle = document.querySelector(".film-brief .flow-title");
    const scriptCard = document.querySelector(".fb-script");
    const fbDoc = document.querySelector(".fb-doc");
    const composer = document.querySelector(".fb-composer");
    const panel = document.querySelector(".fb-panel");
    const cta = document.querySelector(".fb-cta");

    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x * 100) / 100,
        y: Math.round(r.y * 100) / 100,
        right: Math.round(r.right * 100) / 100,
        bottom: Math.round(r.bottom * 100) / 100,
        width: Math.round(r.width * 100) / 100,
        height: Math.round(r.height * 100) / 100
      };
    };

    const panelControls = Array.from(
      panel.querySelectorAll("button, select, input")
    ).filter((el) => !el.closest("dialog:not([open])")).map((el) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return {
        label: (el.textContent || "").trim() || el.getAttribute("aria-label") || el.tagName,
        ...rect(el),
        hitSelf: Boolean(hit && (el === hit || el.contains(hit) || hit.contains(el)))
      };
    });

    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      docScrollHeight: doc.scrollHeight,
      docClientHeight: doc.clientHeight,
      docScrollWidth: doc.scrollWidth,
      docClientWidth: doc.clientWidth,
      hasFlowTitle: Boolean(flowTitle),
      headerRect: rect(header),
      scriptCardRect: rect(scriptCard),
      fbDocRect: rect(fbDoc),
      fbDocScrollHeight: fbDoc.scrollHeight,
      fbDocClientHeight: fbDoc.clientHeight,
      composerRect: rect(composer),
      panelRect: rect(panel),
      panelScrollHeight: panel.scrollHeight,
      panelClientHeight: panel.clientHeight,
      ctaRect: rect(cta),
      panelControls
    };
  });

  assert.equal(m.hasFlowTitle, false, `${label}: redundant .flow-title intro block is removed`);
  assert.equal(
    m.docScrollHeight,
    m.docClientHeight,
    `${label}: vertical page scroll is locked (scrollHeight=${m.docScrollHeight} === clientHeight=${m.docClientHeight})`
  );
  assert.ok(
    m.docScrollWidth <= m.docClientWidth,
    `${label}: no horizontal overflow (scrollWidth=${m.docScrollWidth} <= clientWidth=${m.docClientWidth})`
  );
  assert.equal(
    m.panelScrollHeight,
    m.panelClientHeight,
    `${label}: right Film settings panel does not scroll (scrollHeight=${m.panelScrollHeight} === clientHeight=${m.panelClientHeight})`
  );
  assert.ok(
    m.fbDocRect.bottom <= m.composerRect.y + 2,
    `${label}: script area sits above bottom composer (fbDoc.bottom=${m.fbDocRect.bottom} <= composer.y=${m.composerRect.y})`
  );
  assert.ok(
    m.composerRect.bottom <= m.innerHeight && m.composerRect.y >= 0,
    `${label}: bottom composer is fully visible inside viewport (${m.composerRect.y}..${m.composerRect.bottom} <= ${m.innerHeight})`
  );
  assert.ok(
    m.ctaRect.bottom <= m.innerHeight && m.ctaRect.y >= 0,
    `${label}: storyboard CTA footer is fully visible inside viewport (${m.ctaRect.y}..${m.ctaRect.bottom} <= ${m.innerHeight})`
  );

  for (const ctrl of m.panelControls) {
    assert.ok(
      ctrl.x >= 0 && ctrl.right <= m.innerWidth && ctrl.y >= 0 && ctrl.bottom <= m.innerHeight,
      `${label}: panel control "${ctrl.label}" is inside viewport (${ctrl.x},${ctrl.y}..${ctrl.right},${ctrl.bottom})`
    );
    assert.ok(ctrl.hitSelf, `${label}: panel control "${ctrl.label}" is clickable and not clipped/covered`);
  }

  return m;
}

test("FilmBrief viewport layout, internal script scroll, composer states, compact settings, and responsive fallback", async () => {
  const { srv, baseUrl } = await startFilmBriefFixtureServer();
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1135, height: 775 } });
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    // 1. Desktop reference viewport 1135x775 with long script
    const m1135 = await measureDesktopViewport(page, "1135x775-default");
    assert.ok(
      m1135.fbDocScrollHeight > m1135.fbDocClientHeight,
      `1135x775: long script scrolls inside .fb-doc (scrollHeight=${m1135.fbDocScrollHeight} > clientHeight=${m1135.fbDocClientHeight})`
    );
    await page.screenshot({ path: join(REPO_ROOT, "docs/handoff/film-brief-after-1135x775.png") });

    // Scroll .fb-doc to the bottom and verify composer and settings panel remain stationary
    const scrolled = await page.evaluate(() => {
      const fbDoc = document.querySelector(".fb-doc");
      fbDoc.scrollTop = fbDoc.scrollHeight;
      const r = (el) => {
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.x * 100) / 100, y: Math.round(b.y * 100) / 100, right: Math.round(b.right * 100) / 100, bottom: Math.round(b.bottom * 100) / 100 };
      };
      return {
        scrollTop: fbDoc.scrollTop,
        composerRect: r(document.querySelector(".fb-composer")),
        panelRect: r(document.querySelector(".fb-panel"))
      };
    });
    assert.ok(scrolled.scrollTop > 0, "1135x775: .fb-doc scrolled down");
    assert.equal(scrolled.composerRect.y, m1135.composerRect.y, "1135x775: composer y stays stationary while scrolling script");
    assert.equal(scrolled.composerRect.bottom, m1135.composerRect.bottom, "1135x775: composer bottom stays stationary while scrolling script");
    assert.equal(scrolled.panelRect.y, m1135.panelRect.y, "1135x775: settings panel stays stationary while scrolling script");

    // 2. Edit a multiline beat while scrolled mid-way: verify no jump, focus preserved, composer stationary
    await page.evaluate(() => {
      document.querySelector(".fb-doc").scrollTop = 60;
    });
    const line3 = page.locator('textarea[aria-label="Line 3"]');
    await line3.focus();
    const scrollBeforeEdit = await page.evaluate(() => document.querySelector(".fb-doc").scrollTop);
    await line3.fill("In Lydia, kings stamped lions onto electrum lumps.\nEvery merchant could trust the weight at a glance.\nCommerce sped up across the Mediterranean.");
    const afterEdit = await page.evaluate(() => {
      const fbDoc = document.querySelector(".fb-doc");
      const active = document.activeElement;
      return {
        scrollTop: fbDoc.scrollTop,
        activeLabel: active?.getAttribute("aria-label"),
        beatLine: window.__fixture.getState().draft.beats[2].line
      };
    });
    assert.equal(afterEdit.activeLabel, "Line 3", "editing multiline beat preserves keyboard focus");
    assert.equal(afterEdit.scrollTop, scrollBeforeEdit, "editing multiline beat does not auto-scroll away");
    assert.match(afterEdit.beatLine, /Commerce sped up/, "editDraft updated beat line");
    await measureDesktopViewport(page, "1135x775-multiline-edit");

    // 3. Revision request via bottom composer ("Ask for a change") and Regenerate ("Write it again")
    const askInput = page.locator('[aria-label="Ask for a change to the script"]');
    const askInitialMetrics = await askInput.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        tagName: el.tagName,
        height: Math.round(r.height),
        width: Math.round(r.width)
      };
    });
    assert.equal(askInitialMetrics.tagName, "TEXTAREA", "Ask for a change prompt uses a multiline textarea");
    assert.ok(
      askInitialMetrics.height >= 72 && askInitialMetrics.height <= 88,
      `1135x775: Ask for a change textarea has comfortable 72-88px minimum desktop height (got ${askInitialMetrics.height}px)`
    );

    // Enter inserts newline without submitting; Ctrl/Meta+Enter submits
    await askInput.focus();
    await page.keyboard.type("Make the teapot grumpier");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Add a twist at the end");
    const callsBeforeSubmit = await page.evaluate(() => window.__fixture.getState().calls.writeDraft.length);
    assert.equal(callsBeforeSubmit, 0, "Plain Enter inside Ask textarea inserts newline without submitting");
    const valWithNewline = await askInput.inputValue();
    assert.equal(valWithNewline, "Make the teapot grumpier\nAdd a twist at the end");

    await page.keyboard.press("Control+Enter");
    const afterCtrlEnter = await page.evaluate(() => window.__fixture.getState());
    assert.equal(
      afterCtrlEnter.calls.writeDraft.at(-1),
      "Make the teapot grumpier\nAdd a twist at the end",
      "Control+Enter submits multiline revision instruction"
    );
    assert.equal(await askInput.inputValue(), "", "Ask textarea clears after Control+Enter submit");

    // Also verify button submit and bounded growth/internal scroll on a 6-line revision prompt
    await askInput.fill("Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6");
    const askGrownMetrics = await askInput.evaluate((el) => ({
      height: Math.round(el.getBoundingClientRect().height),
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight
    }));
    assert.ok(askGrownMetrics.height <= 126, `Ask textarea growth is bounded (height=${askGrownMetrics.height}px)`);
    assert.ok(askGrownMetrics.scrollHeight > askGrownMetrics.clientHeight, "6-line revision prompt scrolls internally inside bounded Ask textarea");
    await measureDesktopViewport(page, "1135x775-ask-grown");

    await askInput.fill("Add a witty joke about heavy copper ingots");
    await page.locator('.fb-ask button[type="submit"]').click();
    const afterAsk = await page.evaluate(() => window.__fixture.getState());
    assert.equal(afterAsk.calls.writeDraft.at(-1), "Add a witty joke about heavy copper ingots", "Ask for a change button submits revision instruction");
    assert.match(afterAsk.brief.text, /Explain how money evolves/, "original brief.text is preserved on revision");

    await page.locator("button.fb-regen-btn").click();
    const afterRegen = await page.evaluate(() => window.__fixture.getState());
    assert.equal(afterRegen.calls.writeDraft.at(-1), null, "Write it again calls writeDraft() with no instruction");

    // 4. Streaming & Stop state
    await page.evaluate(async () => {
      window.__fixture.setDraft((d) => ({ ...d, streaming: true, writing: 2 }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    await measureDesktopViewport(page, "1135x775-streaming");
    const stopBtn = page.getByRole("button", { name: "Stop" });
    await stopBtn.waitFor({ state: "visible" });
    await stopBtn.click();
    const afterStop = await page.evaluate(() => window.__fixture.getState());
    assert.equal(afterStop.calls.stopDraft, 1, "Clicking Stop invokes stopDraft");
    assert.equal(afterStop.draft.streaming, false, "Streaming stops after clicking Stop");

    // 5. Generation / revision error state
    await page.evaluate(async () => {
      window.__fixture.setDraft((d) => ({ ...d, error: "Script writer timed out. Please try again." }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    await measureDesktopViewport(page, "1135x775-draft-error");
    await page.locator(".fb-error").waitFor({ state: "visible" });
    await page.evaluate(async () => {
      window.__fixture.setDraft((d) => ({ ...d, error: null }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });

    // 6. Own-script mode ("Paste my script") with long 25-line input
    await page.getByRole("button", { name: "Paste my script" }).click();
    const ownArea = page.locator('textarea[aria-label="Your script"]');
    const longPastedScript = Array.from({ length: 25 }, (_, i) => `Line ${i + 1}: A sentence about the history of money and exchange.`).join("\n");
    await ownArea.fill(longPastedScript);
    await measureDesktopViewport(page, "1135x775-own-script-long");
    const promptScroll = await page.evaluate(() => {
      const el = document.querySelector(".script-prompt");
      return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
    });
    assert.ok(promptScroll.scrollHeight > promptScroll.clientHeight, "Long pasted script scrolls inside bounded .script-prompt textarea");

    // Switch back to "Ask for a change"
    await page.getByRole("button", { name: "Ask for a change" }).click();

    // 7. Character voices with 6 characters + missing-speaker state + audio mode toggles
    await page.getByRole("radio", { name: "Narrator + characters" }).click();
    await new Promise((r) => setTimeout(r, 220));
    await measureDesktopViewport(page, "1135x775-character-voices-6");
    await page.screenshot({ path: join(REPO_ROOT, "docs/handoff/film-brief-characters-1135x775.png") });

    const charCombo = page.getByRole("combobox", { name: "Character" });
    await charCombo.click();
    const charOptions = await page.locator('[role="listbox"] .gm-select-option-label').allTextContents();
    assert.deepEqual(
      charOptions,
      ["Merchant", "King", "Banker", "Goldsmith", "Clerk", "Miner"],
      "All 6 characters are reachable in the compact character selector"
    );
    await page.locator('[role="listbox"] [role="option"]', { hasText: "Banker" }).click();
    const bankerVoiceBtn = page.getByRole("button", { name: "Banker's voice" });
    await bankerVoiceBtn.click();
    await page.locator('dialog.voice-dialog[open] [data-voice-card="Fenrir"] [data-voice-choose="Fenrir"]').click();
    const savedVoices = await page.evaluate(() => window.__fixture.getState().brief.audio.voices);
    assert.equal(savedVoices?.Banker, "Fenrir", "Selecting character voice updates brief.audio.voices[character]");

    // Test missing-speaker hint in character mode when beats have no speakers
    await page.evaluate(async () => {
      window.__fixture.setDraft((d) => ({
        ...d,
        beats: d.beats.map((b) => ({ ...b, speaker: null }))
      }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    await measureDesktopViewport(page, "1135x775-characters-missing-hint");
    await page.getByRole("button", { name: "Give the characters lines" }).waitFor({ state: "visible" });
    await page.evaluate(async () => {
      window.__fixture.setDraft((d) => ({
        ...d,
        beats: window.__fixture.LONG_BEATS
      }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });

    // Test No voice + no music, No voice + music, Narrator + music
    await page.getByRole("radio", { name: "No voice" }).click();
    await measureDesktopViewport(page, "1135x775-no-voice-with-music");
    await page.getByRole("checkbox", { name: "Music" }).uncheck();
    await measureDesktopViewport(page, "1135x775-no-voice-no-music");
    await page.getByRole("checkbox", { name: "Music" }).check();
    await page.getByRole("radio", { name: "Narrator", exact: true }).click();
    await measureDesktopViewport(page, "1135x775-narrator-with-music");

    // 8. Empty brief state before generation
    await page.evaluate(async () => {
      window.__fixture.setDraft({ beats: [], streaming: false, writing: null, flags: [], error: null });
      window.__fixture.setHasStoryboard(false);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    await measureDesktopViewport(page, "1135x775-empty-brief");
    await page.locator(".fb-empty").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Write script" }).waitFor({ state: "visible" });
    await page.screenshot({ path: join(REPO_ROOT, "docs/handoff/film-brief-empty-1135x775.png") });

    // Restore populated script and storyboard
    await page.evaluate(async () => {
      window.__fixture.setDraft({ beats: window.__fixture.LONG_BEATS, streaming: false, writing: null, flags: [], error: null });
      window.__fixture.setHasStoryboard(true);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    await page.getByRole("button", { name: "Ask for a change" }).click();

    // 9. Verify 1280x900 and 1366x768 desktop viewports
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("radio", { name: "Narrator + characters" }).click();
    await new Promise((r) => setTimeout(r, 220));
    await measureDesktopViewport(page, "1280x900-characters");
    await page.screenshot({ path: join(REPO_ROOT, "docs/handoff/film-brief-after-1280x900.png") });

    await page.setViewportSize({ width: 1366, height: 768 });
    await new Promise((r) => setTimeout(r, 80));
    await measureDesktopViewport(page, "1366x768-characters");
    await page.screenshot({ path: join(REPO_ROOT, "docs/handoff/film-brief-after-1366x768.png") });

    // 10. Style chooser modal opens without clipping + keyboard Tab focus visibility
    await page.setViewportSize({ width: 1135, height: 775 });
    await page.locator(".sp-browse").focus();
    await page.keyboard.press("Tab");
    const focusInfo = await page.evaluate(() => {
      const el = document.activeElement;
      const r = el?.getBoundingClientRect();
      return {
        tag: el?.tagName,
        text: (el?.textContent || "").trim() || el?.getAttribute("aria-label"),
        inViewport: Boolean(r && r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth)
      };
    });
    assert.equal(focusInfo.inViewport, true, `Keyboard Tab focus target "${focusInfo.text}" is visible inside viewport`);

    await page.locator(".sp-browse").click();
    const dialogState = await page.evaluate(() => {
      const dlg = document.querySelector("dialog.theme-dialog");
      const r = dlg?.getBoundingClientRect();
      return {
        open: Boolean(dlg?.open),
        x: r?.x ?? -1,
        y: r?.y ?? -1,
        right: r?.right ?? -1,
        bottom: r?.bottom ?? -1,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight
      };
    });
    assert.equal(dialogState.open, true, "Style chooser dialog opens");
    assert.ok(
      dialogState.x >= 0 && dialogState.y >= 0 && dialogState.right <= dialogState.innerWidth && dialogState.bottom <= dialogState.innerHeight,
      "Style chooser dialog fits inside viewport without clipping"
    );
    await page.locator("button.theme-close").click();

    // 11. Mobile width (390x844) responsive fallback
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileAudit = await page.evaluate(() => {
      const doc = document.scrollingElement || document.documentElement;
      const shell = document.querySelector(".relay-shell");
      const shellOverflow = getComputedStyle(shell).overflowY;
      const ctaPos = getComputedStyle(document.querySelector(".fb-cta")).position;
      return {
        docScrollWidth: doc.scrollWidth,
        docClientWidth: doc.clientWidth,
        docScrollHeight: doc.scrollHeight,
        docClientHeight: doc.clientHeight,
        shellOverflow,
        ctaPos
      };
    });
    assert.ok(
      mobileAudit.docScrollWidth <= mobileAudit.docClientWidth,
      `390x844: no horizontal overflow on mobile (${mobileAudit.docScrollWidth} <= ${mobileAudit.docClientWidth})`
    );
    assert.notEqual(mobileAudit.shellOverflow, "hidden", "390x844: mobile allows vertical page scrolling to reach stacked settings");
    assert.equal(mobileAudit.ctaPos, "static", "390x844: CTA is static in flow and does not float over inputs");
    await page.screenshot({ path: join(REPO_ROOT, "docs/handoff/film-brief-mobile-390x844.png") });

    // 12. Leaving FilmBrief step (e.g. Open storyboard or Projects) restores ordinary page scrolling on desktop
    await page.setViewportSize({ width: 1135, height: 775 });
    await page.getByRole("button", { name: "Open storyboard" }).click();
    const storyboardScroll = await page.evaluate(() => {
      const shell = document.querySelector(".relay-shell");
      const doc = document.scrollingElement || document.documentElement;
      return {
        hasFilmBriefClass: shell.classList.contains("relay-shell--film-brief"),
        overflowY: getComputedStyle(shell).overflowY,
        docScrollHeight: doc.scrollHeight,
        docClientHeight: doc.clientHeight
      };
    });
    assert.equal(storyboardScroll.hasFilmBriefClass, false, "Leaving FilmBrief removes relay-shell--film-brief class");
    assert.notEqual(storyboardScroll.overflowY, "hidden", "Storyboard step allows normal vertical scrolling");
    assert.ok(storyboardScroll.docScrollHeight > storyboardScroll.docClientHeight, "Storyboard step scrolls normally");
  } finally {
    await browser.close();
    srv.close();
  }
});
