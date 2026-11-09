import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
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
const SCREENSHOT_DIR = join(REPO_ROOT, "docs/handoff/screenshots/voice-picker-branded-selects");

mkdirSync(SCREENSHOT_DIR, { recursive: true });

const COMBINED_CSS = [
  readFileSync(join(FRONTEND_DIR, "app/theme.css"), "utf8"),
  readFileSync(join(FRONTEND_DIR, "app/styles.css"), "utf8")
].join("\n");

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

// Real pre-generated WAV files from var/audio/_voice_previews
const PREVIEW_DIR = join(REPO_ROOT, "var/audio/_voice_previews");
const REAL_KORE_WAV = existsSync(join(PREVIEW_DIR, "Kore.wav"))
  ? readFileSync(join(PREVIEW_DIR, "Kore.wav"))
  : null;
const REAL_PUCK_WAV = existsSync(join(PREVIEW_DIR, "Puck.wav"))
  ? readFileSync(join(PREVIEW_DIR, "Puck.wav"))
  : null;

async function startFixtureServer() {
  const entrySource = `
    import React, { useState } from "react";
    import { createRoot } from "react-dom/client";
    import { isFilmBrief, parseScriptBrief, voices } from "@videosaas/contracts";
    import { FilmBrief } from "./components/film-brief.tsx";

    const INITIAL_BEATS = [
      { keyword: "Barter cows", line: "Long before coins or cards, you traded what you had: a cow for a sack of grain.", onScreen: "Cow for grain", visual: "A rubber hose farmer holding a cow beside a baker", speaker: "Merchant" },
      { keyword: "Shells & salt", line: "Soon people agreed on lighter tokens—cowrie shells, salt bars, and bronze bits.", onScreen: "Shells and bronze", visual: "Cartoon hands swapping cowrie shells" },
      { keyword: "First coins", line: "In Lydia, kings stamped lions onto electrum lumps, promising every coin weighed the same.", onScreen: "Stamped weight", visual: "An anvil stamping a grinning lion onto a round coin", speaker: "King" },
      { keyword: "Paper IOUs", line: "Carrying chests of metal grew heavy, so merchants left their gold in vaults and traded paper receipts.", onScreen: "Paper receipts", visual: "A merchant trading coins for a fluttering paper note", speaker: "Banker" },
      { keyword: "Central banks", line: "Governments backed those notes by law, turning paper promises into national currencies.", onScreen: "Backed by law", visual: "A grand cartoon vault door stamping official seals" },
      { keyword: "Goldsmith vaults", line: "Goldsmiths realized not everyone withdrew their gold at once, giving birth to reserve banking.", onScreen: "Vault reserves", visual: "A goldsmith counting ledger notes beside a safe", speaker: "Goldsmith" },
      { keyword: "Telegraph wire", line: "By the nineteenth century, telegraph cables flashed balances across oceans without a coin leaving port.", onScreen: "Wire transfer", visual: "Sparks of numbers racing along an undersea cable", speaker: "Clerk" },
      { keyword: "ATMs & terminals", line: "Corner machines and checkout scanners turned every neighborhood shop into an instant branch.", onScreen: "Instant clearing", visual: "A cheerful cartoon ATM dispensing crisp notes", speaker: "Miner" }
    ];

    function App() {
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
        beats: INITIAL_BEATS,
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
        voices,
        parseScriptBrief,
        getState: () => ({ brief, draft, calls }),
        setBrief,
        setDraft
      };

      return (
        <main className="relay-shell relay-shell--film-brief">
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
          <FilmBrief
            brief={brief}
            update={(patch) => setBrief((curr) => ({ ...curr, ...patch }))}
            draft={draft}
            writeDraft={(instruction) => setCalls((c) => ({ ...c, writeDraft: [...c.writeDraft, instruction ?? null] }))}
            editDraft={(index, patch) => setDraft((d) => d ? { ...d, beats: d.beats.map((b, i) => i === index ? { ...b, ...patch } : b) } : d)}
            stopDraft={() => setCalls((c) => ({ ...c, stopDraft: c.stopDraft + 1 }))}
            continueDraft={() => setCalls((c) => ({ ...c, continueDraft: c.continueDraft + 1 }))}
            continueToStoryboard={() => setCalls((c) => ({ ...c, continueToStoryboard: c.continueToStoryboard + 1 }))}
            hasStoryboard={true}
            error={null}
          />
        </main>
      );
    }

    createRoot(document.getElementById("root")).render(<App />);
  `;

  const bundled = await build({
    stdin: {
      contents: entrySource,
      resolveDir: FRONTEND_DIR,
      sourcefile: "voice-picker-fixture-entry.tsx",
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

  let zephyrShouldFail = true;
  const voicePreviewRequests = [];

  const srv = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/bundle.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(bundleJs);
      return;
    }
    if (url.pathname.startsWith("/v1/voices/") && url.pathname.endsWith("/preview")) {
      const voiceId = decodeURIComponent(url.pathname.split("/")[3] || "");
      voicePreviewRequests.push(voiceId);
      if (voiceId === "Zephyr" && zephyrShouldFail) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "audio_unavailable", message: "Sample not cached." } }));
        return;
      }
      const wav = voiceId === "Puck" ? (REAL_PUCK_WAV ?? REAL_KORE_WAV) : REAL_KORE_WAV;
      if (wav) {
        res.writeHead(200, {
          "content-type": "audio/wav",
          "content-length": wav.length,
          "accept-ranges": "bytes"
        });
        res.end(wav);
        return;
      }
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "audio_unavailable", message: "Sample unavailable" } }));
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
  <title>Voice Picker & Branded Selects Fixture</title>
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
    voicePreviewRequests,
    setZephyrShouldFail: (val) => {
      zephyrShouldFail = val;
    }
  };
}

test("Voice Library Modal (24 canonical voices, sample exclusivity/race/error/retry, speaker clarity) and BrandedSelects", async () => {
  const { srv, baseUrl, voicePreviewRequests, setZephyrShouldFail } = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1135, height: 775 } });
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    // 1. Verify NO native <select> elements remain in FilmBrief
    const nativeSelectCount = await page.locator(".film-brief select").count();
    assert.equal(nativeSelectCount, 0, "All native <select> controls in FilmBrief are replaced with BrandedSelect or VoicePickerModal triggers");

    // 2. Verify no eager sample audio requests were made on page load
    assert.equal(voicePreviewRequests.length, 0, "No voice preview audio is eagerly fetched on load");

    // 3. Narrator-only mode: verify script clarity (mode pill, cast pill, per-line Narrator pill)
    const modeText = await page.locator(".fb-mode-pill").textContent();
    assert.equal(modeText?.trim(), "Narrator-only voiceover", "Script area clearly indicates Narrator-only voiceover mode");
    const line1NarratorBtn = page.getByRole("button", { name: "Line 1 speaker: Narrator (Kore)" });
    await line1NarratorBtn.waitFor({ state: "visible" });

    // 4. Open Voice Library Modal from Line 1's Narrator pill and verify all 24 canonical voices + focus trap + Escape restore
    await line1NarratorBtn.focus();
    await line1NarratorBtn.click();

    const modal = page.locator("dialog.voice-dialog[open]");
    await modal.waitFor({ state: "visible" });
    assert.equal(voicePreviewRequests.length, 0, "Opening Voice Library Modal does not autoplay or eagerly fetch all 24 samples");

    const modalTitle = await modal.locator("h2").textContent();
    assert.equal(modalTitle?.trim(), "Choose a voice for Narrator", "Modal title clearly names Narrator");

    const renderedCards = await modal.locator("[data-voice-card]").evaluateAll((els) =>
      els.map((el) => ({
        id: el.getAttribute("data-voice-card"),
        name: el.querySelector(".voice-card-name")?.textContent?.trim(),
        character: el.querySelector(".voice-card-character")?.textContent?.trim(),
        nestedButtons: el.querySelectorAll("button button").length
      }))
    );
    const canonicalVoices = await page.evaluate(() => window.__fixture.voices);
    assert.equal(renderedCards.length, 24, "All 24 canonical voices from @videosaas/contracts are rendered");
    assert.deepEqual(
      renderedCards.map((c) => c.id),
      canonicalVoices.map((v) => v.id),
      "Rendered card IDs match canonical voiceIds in order"
    );
    assert.ok(renderedCards.every((c) => c.nestedButtons === 0), "No voice card has nested buttons");

    // Test search & tone filter, then reset so all 24 remain reachable
    const searchInput = modal.getByRole("searchbox", { name: "Search voices" });
    await searchInput.fill("storytelling");
    assert.equal(await modal.locator("[data-voice-card]").count(), 1, "Search narrows to Sulafat ('Warm, storytelling')");
    await searchInput.fill("zzzz-no-match");
    await modal.getByRole("button", { name: /Show all 24 voices/ }).click();
    assert.equal(await modal.locator("[data-voice-card]").count(), 24, "Resetting filter restores all 24 voices");

    // Test Focus Trap inside open modal: Tab from last focusable wraps to first, Shift+Tab from first wraps to last
    const trapCheck = await page.evaluate(() => {
      const dlg = document.querySelector("dialog.voice-dialog[open]");
      const focusable = Array.from(
        dlg.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')
      ).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
      return {
        count: focusable.length,
        firstLabel: focusable[0]?.getAttribute("aria-label") || focusable[0]?.textContent?.trim(),
        lastLabel: focusable.at(-1)?.getAttribute("aria-label") || focusable.at(-1)?.textContent?.trim()
      };
    });
    assert.ok(trapCheck.count > 40, "Modal has focusable controls for search, filters, and all 24 cards");
    await page.evaluate(() => {
      const dlg = document.querySelector("dialog.voice-dialog[open]");
      const focusable = Array.from(
        dlg.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')
      ).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
      focusable.at(-1).focus();
    });
    await page.keyboard.press("Tab");
    const focusedAfterWrapForward = await page.evaluate(() => {
      const dlg = document.querySelector("dialog.voice-dialog[open]");
      return dlg.contains(document.activeElement);
    });
    assert.equal(focusedAfterWrapForward, true, "Tab at end of modal stays trapped inside modal");

    // Press Escape to close modal and verify focus returns to line1NarratorBtn
    await page.keyboard.press("Escape");
    await assert.doesNotReject(() => modal.waitFor({ state: "hidden" }));
    const restoredFocusLabel = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    assert.equal(
      restoredFocusLabel,
      "Line 1 speaker: Narrator (Kore)",
      "Closing modal with Escape restores focus to the trigger button that opened it"
    );

    // 5. Instrument Audio in page to test sample exclusivity, race safety, error & retry, and real WAV playback
    await page.evaluate(() => {
      const NativeAudio = window.Audio;
      window.__audioLog = {
        instances: [],
        useControllableMock: false
      };
      window.Audio = function InstrumentedAudio(src) {
        if (!window.__audioLog.useControllableMock) {
          const real = new NativeAudio(src);
          const rec = { src, el: real, real: true };
          window.__audioLog.instances.push(rec);
          return real;
        }
        const inst = {
          src,
          preload: "auto",
          paused: true,
          removedSrc: false,
          loadedAfterClear: false,
          onplaying: null,
          onended: null,
          onerror: null,
          onpause: null,
          play() {
            this.paused = false;
            return new Promise((resolve, reject) => {
              this._resolvePlay = resolve;
              this._rejectPlay = reject;
            });
          },
          pause() {
            this.paused = true;
            if (this.onpause) this.onpause();
          },
          removeAttribute(attr) {
            if (attr === "src") this.removedSrc = true;
          },
          load() {
            if (this.removedSrc) this.loadedAfterClear = true;
          }
        };
        window.__audioLog.instances.push(inst);
        return inst;
      };
    });

    // Open Voice modal from right settings panel "Voice" button
    const panelVoiceBtn = page.getByRole("button", { name: "Voice", exact: true });
    await panelVoiceBtn.click();
    await modal.waitFor({ state: "visible" });

    // 5a. Play real WAV sample for Kore (served from var/audio/_voice_previews/Kore.wav)
    const korePlayBtn = modal.locator('[data-voice-play="Kore"]');
    await korePlayBtn.click();
    await page.waitForFunction(() => {
      const btn = document.querySelector('[data-voice-play="Kore"]');
      return btn && btn.textContent?.includes("Stop");
    });
    assert.ok(voicePreviewRequests.includes("Kore"), "Clicking Play sample for Kore requested /v1/voices/Kore/preview");
    assert.equal(await modal.isVisible(), true, "Playing a sample does not select the voice or close the modal");

    // 5b. Switch to controllable mock to deterministically verify exclusivity, stale callback race guard, error & retry
    await page.evaluate(() => {
      window.__audioLog.useControllableMock = true;
    });

    const puckPlayBtn = modal.locator('[data-voice-play="Puck"]');
    await puckPlayBtn.click();
    // Verify Kore's real audio was paused and Puck is now loading
    const afterSwitchToPuck = await page.evaluate(() => {
      const koreInst = window.__audioLog.instances[0];
      const puckInst = window.__audioLog.instances.at(-1);
      return {
        korePaused: koreInst.el ? koreInst.el.paused : koreInst.paused,
        puckSrc: puckInst.src,
        puckBtnText: document.querySelector('[data-voice-play="Puck"]')?.textContent?.trim(),
        koreBtnText: document.querySelector('[data-voice-play="Kore"]')?.textContent?.trim()
      };
    });
    assert.equal(afterSwitchToPuck.korePaused, true, "Switching sample to Puck immediately pauses Kore");
    assert.equal(afterSwitchToPuck.puckBtnText, "Loading…", "Puck shows Loading… while awaiting playback start");
    assert.equal(afterSwitchToPuck.koreBtnText, "▶Play sample", "Kore resets to Play sample");

    // Now click Aoede before Puck's play resolves, then fire Puck's stale onplaying callback -> verify race guard ignores Puck!
    await modal.locator('[data-voice-play="Aoede"]').click();
    const raceResult = await page.evaluate(async () => {
      const puckInst = window.__audioLog.instances.at(-2);
      const aoedeInst = window.__audioLog.instances.at(-1);
      // Attempt to fire stale callback if it wasn't nulled, and resolve Aoede
      if (puckInst.onplaying) puckInst.onplaying();
      aoedeInst._resolvePlay?.();
      aoedeInst.onplaying?.();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return {
        puckCleanedUp: puckInst.paused && puckInst.removedSrc && puckInst.loadedAfterClear,
        puckHandlerCleared: puckInst.onplaying === null
      };
    });
    assert.equal(raceResult.puckCleanedUp, true, "Previous audio instance is paused and released on switch");
    assert.equal(raceResult.puckHandlerCleared, true, "Stale audio callbacks are nulled out on switch");
    assert.equal(
      await modal.locator('[data-voice-play="Aoede"]').textContent(),
      "■Stop",
      "Aoede is now playing"
    );
    assert.equal(
      await modal.locator('[data-voice-play="Puck"]').textContent(),
      "▶Play sample",
      "Stale Puck callback did not mark Puck as playing"
    );

    // 5c. Test unavailable sample error and retry on Zephyr
    await page.evaluate(() => {
      window.__audioLog.useControllableMock = false;
    });
    setZephyrShouldFail(true);
    await modal.locator('[data-voice-play="Zephyr"]').click();
    await page.waitForFunction(() => {
      const card = document.querySelector('[data-voice-card="Zephyr"]');
      return card?.querySelector(".voice-card-error")?.textContent?.includes("unavailable");
    });
    const zephyrBtnAfterFail = await modal.locator('[data-voice-play="Zephyr"]').textContent();
    assert.equal(zephyrBtnAfterFail, "↻Retry", "Failed sample shows honest error and Retry button");

    // Now allow Zephyr to succeed on retry
    setZephyrShouldFail(false);
    await modal.locator('[data-voice-play="Zephyr"]').click();
    await page.waitForFunction(() => {
      const btn = document.querySelector('[data-voice-play="Zephyr"]');
      return btn && btn.textContent?.includes("Stop");
    });
    assert.equal(
      await modal.locator('[data-voice-card="Zephyr"] .voice-card-error').count(),
      0,
      "Error message clears when retry succeeds"
    );

    // Choose Aoede for Narrator
    await modal.locator('[data-voice-choose="Aoede"]').click();
    await modal.waitFor({ state: "hidden" });
    const stateAfterNarratorPick = await page.evaluate(() => window.__fixture.getState());
    assert.equal(stateAfterNarratorPick.brief.audio.voice, "Aoede", "Choosing Aoede updates Narrator voice");
    assert.equal(stateAfterNarratorPick.calls.writeDraft.length, 0, "Selecting a voice does not regenerate the script");
    assert.equal(stateAfterNarratorPick.calls.continueDraft, 0, "Selecting a voice does not rebuild the storyboard");

    // 6. Switch to Narrator + characters mode and verify multi-character assignment, speaker switching, and renaming
    await page.getByRole("radio", { name: "Narrator + characters" }).click();
    assert.equal(
      await page.locator(".fb-mode-pill").textContent(),
      "Character dialogue",
      "Script header switches to Character dialogue mode"
    );

    // Verify cast bar pills show Narrator (Aoede) + all 6 characters
    const castPillTexts = await page.locator(".fb-cast-pill").allTextContents();
    assert.equal(castPillTexts.length, 7, "Cast bar shows Narrator + 6 speaking characters");
    assert.match(castPillTexts[0], /Narrator.*Aoede/, "Narrator pill shows Aoede");

    // Click Line 1's inline voice button (Merchant) to open modal directly for Merchant
    const line1VoiceBtn = page.locator(".fb-para").first().locator(".fb-line-voice");
    await line1VoiceBtn.click();
    await modal.waitFor({ state: "visible" });
    assert.equal(
      await modal.locator("h2").textContent(),
      "Choose a voice for Merchant",
      "Clicking Line 1 voice button opens modal targeted at Merchant"
    );

    // Play a sample for Charon and capture dark-mode character modal screenshot
    await modal.locator('[data-voice-play="Kore"]').click();
    await page.waitForFunction(() => document.querySelector('[data-voice-play="Kore"]')?.textContent?.includes("Stop"));
    await page.screenshot({ path: join(SCREENSHOT_DIR, "voice-modal-1135x775-dark-character.png") });

    // Switch speaker inside the modal using the speaker tab bar (Merchant -> King) and verify audio stops
    await modal.getByRole("tab", { name: /King/ }).click();
    assert.equal(
      await modal.locator("h2").textContent(),
      "Choose a voice for King",
      "Clicking King tab inside modal switches target speaker to King"
    );
    const koreStoppedOnSpeakerSwitch = await modal.locator('[data-voice-play="Kore"]').textContent();
    assert.equal(koreStoppedOnSpeakerSwitch, "▶Play sample", "Switching speaker inside modal stops playing sample");

    // Assign Fenrir to King
    await modal.locator('[data-voice-choose="Fenrir"]').click();
    await modal.waitFor({ state: "hidden" });

    // Assign Sadaltager to Merchant via the cast bar pill
    await page.locator(".fb-cast-pill", { hasText: "Merchant" }).click();
    await modal.waitFor({ state: "visible" });
    await modal.locator('[data-voice-choose="Sadaltager"]').click();
    await modal.waitFor({ state: "hidden" });

    // Verify Narrator is still Aoede, King is Fenrir, Merchant is Sadaltager, and parseScriptBrief preserves them
    const voiceStateCheck = await page.evaluate(() => {
      const s = window.__fixture.getState();
      const parsed = window.__fixture.parseScriptBrief(s.brief);
      return {
        narrator: s.brief.audio.voice,
        voices: s.brief.audio.voices,
        parsedVoices: "brief" in parsed ? parsed.brief.audio.voices : null
      };
    });
    assert.equal(voiceStateCheck.narrator, "Aoede", "Character assignments never overwrite Narrator voice");
    assert.equal(voiceStateCheck.voices.King, "Fenrir", "King voice saved as Fenrir");
    assert.equal(voiceStateCheck.voices.Merchant, "Sadaltager", "Merchant voice saved as Sadaltager");
    assert.equal(voiceStateCheck.parsedVoices?.King, "Fenrir", "parseScriptBrief preserves King voice");
    assert.equal(voiceStateCheck.parsedVoices?.Merchant, "Sadaltager", "parseScriptBrief preserves Merchant voice");

    // Test renaming a speaker on Line 1 ("Merchant" -> "Captain") and clearing Line 3 speaker ("King" -> "")
    const line1SpeakerInput = page.locator('input[aria-label="Who says line 1"]');
    await line1SpeakerInput.fill("Captain");
    const captainVoiceText = await page.locator(".fb-para").first().locator(".fb-line-voice span").textContent();
    assert.notEqual(captainVoiceText, "Sadaltager", "Renamed speaker Captain gets its own default voice instead of stealing Merchant's custom pick");
    assert.notEqual(captainVoiceText, "Aoede", "Captain's default voice is never the Narrator's voice");

    // Restore Line 1 back to "Merchant" -> verify Merchant's persisted custom voice ("Sadaltager") is still intact!
    await line1SpeakerInput.fill("Merchant");
    assert.equal(
      await page.locator(".fb-para").first().locator(".fb-line-voice span").textContent(),
      "Sadaltager",
      "Restoring Merchant speaker name restores Merchant's persisted Sadaltager voice"
    );

    // 7. Test BrandedSelect keyboard navigation, typeahead, portal positioning, and viewport lock at 1135x775
    const paceCombo = page.getByRole("combobox", { name: "Pace" });
    await paceCombo.focus();
    // Typeahead "f" when closed -> opens and highlights "Fast", press Enter to commit
    await page.keyboard.press("f");
    const listbox = page.locator('[role="listbox"]');
    await listbox.waitFor({ state: "visible" });
    await page.screenshot({ path: join(SCREENSHOT_DIR, "branded-select-open-1135x775-dark.png") });

    // Verify popover is inside viewport and does not cause page or panel scroll
    const popoverMetrics = await page.evaluate(() => {
      const pop = document.querySelector(".gm-select-popover");
      const panel = document.querySelector(".fb-panel");
      const doc = document.scrollingElement || document.documentElement;
      const r = pop.getBoundingClientRect();
      return {
        inBodyPortal: pop.parentElement === document.body,
        inViewport: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
        panelNoScroll: panel.scrollHeight === panel.clientHeight,
        docNoScroll: doc.scrollHeight === doc.clientHeight
      };
    });
    assert.equal(popoverMetrics.inBodyPortal, true, "BrandedSelect renders listbox in document.body portal to avoid container clipping");
    assert.equal(popoverMetrics.inViewport, true, "BrandedSelect popover near bottom-right edge stays fully inside 1135x775 viewport");
    assert.equal(popoverMetrics.panelNoScroll, true, "Opening BrandedSelect does not make .fb-panel scroll");
    assert.equal(popoverMetrics.docNoScroll, true, "Opening BrandedSelect does not make page scroll");

    await page.keyboard.press("Enter");
    await listbox.waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(() => window.__fixture.getState().brief.pace),
      "fast",
      "Typeahead 'f' + Enter selects Fast pace"
    );

    // Test ArrowUp / Home / End on Captions BrandedSelect
    const captionsCombo = page.getByRole("combobox", { name: "Captions" });
    await captionsCombo.focus();
    await page.keyboard.press("ArrowDown");
    await listbox.waitFor({ state: "visible" });
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    assert.equal(
      await page.evaluate(() => window.__fixture.getState().brief.captions),
      "none",
      "End + Enter selects 'No captions'"
    );

    // Switch Language to Hindi via BrandedSelect
    const langCombo = page.getByRole("combobox", { name: "Language" });
    await langCombo.click();
    await page.locator('[role="listbox"] [role="option"]', { hasText: "Hindi" }).click();
    assert.equal(
      await page.evaluate(() => window.__fixture.getState().brief.audio.language),
      "hi",
      "Selecting Hindi updates brief.audio.language to 'hi'"
    );

    // Capture 1135x775 dark mode screenshot with Character dialogue, cast bar, per-line voice chips, and branded selects
    await page.screenshot({ path: join(SCREENSHOT_DIR, "brief-1135x775-dark-characters-cast.png") });

    // 8. Switch to Light theme and open Voice modal to verify Hindi sample language notice + light theme styling
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "light");
    });
    await page.getByRole("button", { name: "Narrator voice", exact: true }).click();
    await modal.waitFor({ state: "visible" });
    const langNotice = await modal.locator(".voice-lang-notice").textContent();
    assert.match(
      langNotice ?? "",
      /English.*sample.*Hindi/i,
      "Modal clearly states that sample previews are in English while film lines will be spoken in Hindi"
    );
    await page.screenshot({ path: join(SCREENSHOT_DIR, "voice-modal-1135x775-light-narrator-hindi.png") });
    await modal.locator("button.voice-close").click();
    await modal.waitFor({ state: "hidden" });

    // 9. Mobile viewport (390x844) in dark mode with Voice modal open
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Narrator voice", exact: true }).click();
    await modal.waitFor({ state: "visible" });
    const mobileModalFit = await page.evaluate(() => {
      const dlg = document.querySelector("dialog.voice-dialog[open]");
      const r = dlg.getBoundingClientRect();
      return {
        fitsWidth: r.left >= 0 && r.right <= window.innerWidth,
        fitsHeight: r.top >= 0 && r.bottom <= window.innerHeight
      };
    });
    assert.equal(mobileModalFit.fitsWidth, true, "Voice modal fits mobile 390px width without horizontal overflow");
    assert.equal(mobileModalFit.fitsHeight, true, "Voice modal fits mobile 844px height with internal card scrolling");
    await page.screenshot({ path: join(SCREENSHOT_DIR, "brief-mobile-390x844-dark-voice-modal.png") });
    await modal.locator("button.voice-close").click();
  } finally {
    await browser.close();
    srv.close();
  }
});
