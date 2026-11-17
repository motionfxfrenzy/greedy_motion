// The preview film stops at its end, in a real Chrome (no paid calls, no network): fixture clips and voices, the real PlatePreview.
// Cause this guards: the last scene waited for its voice to end, and a voice that never ends (stalled mid-file, or stopped just short of its end) held
// the film for ever: the button kept reading Pause, the music kept playing and the last frames of the clip looped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { fixturePlateStatus } from "./fixtures/workspace/data.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(HERE, "..");
const REPO_ROOT = resolve(FRONTEND_DIR, "..");
const WS = join(FRONTEND_DIR, "test/fixtures/workspace");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CLIP = readFileSync(join(WS, "clip-16x9.mp4"));
const VOICE = readFileSync(join(WS, "voice.wav"));
const CSS = ["theme.css", "styles.css", "animation-workspace.css", "plate-preview.css"].map((f) => readFileSync(join(FRONTEND_DIR, "app", f), "utf8")).join("\n");

async function serve() {
  const shim = {
    name: "next-navigation-shim",
    setup(b) {
      b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "shim", namespace: "shim" }));
      b.onLoad({ filter: /.*/, namespace: "shim" }, () => ({ contents: `export function useSearchParams(){return new URLSearchParams(window.location.search)}\nexport function notFound(){}`, loader: "ts" }));
    }
  };
  const bundled = await build({
    stdin: {
      contents: `import React from "react"; import { createRoot } from "react-dom/client"; import Page from "./app/dev/plate-preview-fixture/page.tsx"; createRoot(document.getElementById("root")).render(<Page />);`,
      resolveDir: FRONTEND_DIR, sourcefile: "film-end-entry.tsx", loader: "tsx"
    },
    bundle: true, format: "esm", target: "es2022", write: false, plugins: [shim],
    define: {
      "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_LIVE_DEV": '"0"', "process.env.NEXT_PUBLIC_APP_ENV": '"local"',
      "process.env.NEXT_PUBLIC_API_URL": '"http://127.0.0.1:4000"', "process.env.NEXT_PUBLIC_SUPABASE_URL": '"http://127.0.0.1:54321"',
      "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": '"local-dev-anon-key"', "process.env": '{"NEXT_PUBLIC_LIVE_DEV":"0","NEXT_PUBLIC_APP_ENV":"local"}'
    }
  });
  const js = bundled.outputFiles[0].text;
  const srv = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/bundle.js") { res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }); res.end(js); return; }
    if (url.pathname === "/styles.css") { res.writeHead(200, { "content-type": "text/css; charset=utf-8" }); res.end(CSS); return; }
    if (url.pathname.startsWith("/dev/")) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end('<!doctype html><html data-theme="light"><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>'); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { srv, origin: `http://127.0.0.1:${srv.address().port}` };
}

async function openFilm(browser, origin, { stallLastVoice }) {
  const context = await browser.newContext({ viewport: { width: 1135, height: 775 } });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/media-token")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "t", expiresAt: "2099-01-01T00:00:00.000Z" }) });
    if (/\/projects\/[^/]+\/plates$/.test(url.pathname) && route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixturePlateStatus("c-ready")) });
    if (/\/projects\/[^/]+\/plates\/\d+\/clip/.test(url.pathname)) return route.fulfill({ status: 200, contentType: "video/mp4", body: CLIP });
    if (/\/preview\/plan-voice\/|\/preview\/plan-sfx\//.test(url.pathname)) return route.fulfill({ status: 200, contentType: "audio/wav", body: VOICE });
    return route.continue();
  });
  const page = await context.newPage();
  await page.goto(`${origin}/dev/plate-preview-fixture?state=c-ready&theme=light`, { waitUntil: "networkidle" });
  await page.waitForSelector("button.aw-play");
  if (stallLastVoice) {
    // the last scene's voice "plays" for ever without advancing: not paused, not ended, stuck mid-file
    await page.evaluate(() => {
      const voices = [...document.querySelectorAll("audio")].filter((a) => /audio\/vo\//.test(a.currentSrc || a.src || ""));
      const last = voices[voices.length - 1];
      if (!last) throw new Error("no voice element found among " + JSON.stringify([...document.querySelectorAll("audio")].map((a) => (a.currentSrc || a.src || "").slice(-60))));
      Object.defineProperty(last, "paused", { get: () => false });
      Object.defineProperty(last, "ended", { get: () => false });
      Object.defineProperty(last, "currentTime", { get: () => 0.2, set: () => {} });
      Object.defineProperty(last, "duration", { get: () => 3 });
    });
  }
  return { context, page };
}

const state = (page) => page.evaluate(() => {
  const play = document.querySelector("button.aw-play");
  return { label: play?.getAttribute("aria-label"), clock: (document.body.innerText.match(/\d+:\d\d\s*\/\s*\d+:\d\d/) || [])[0], musicPlaying: [...document.querySelectorAll("audio")].some((a) => /audio\/music\//.test(a.currentSrc || a.src || "") && !a.paused) };
});

for (const stallLastVoice of [false, true]) {
  test(`the film stops at its end${stallLastVoice ? " even when the last voice never ends" : ""}`, { timeout: 120_000, skip: !existsSync(CHROME_PATH) && "Google Chrome not found" }, async () => {
    const { srv, origin } = await serve();
    let browser;
    try {
      browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
      const { page } = await openFilm(browser, origin, { stallLastVoice });
      // start two seconds before the end of the film by clicking the last scene, then play
      if (process.env.FILM_END_TRACE) await page.evaluate(() => {
        window.__ev = [];
        const v = document.querySelectorAll("video");
        const last = v[v.length - 1];
        for (const n of ["seeking", "emptied", "loadstart", "ended", "pause", "play", "abort"]) last.addEventListener(n, () => window.__ev.push(n + "@" + Math.round(performance.now() / 100) / 10 + " t=" + last.currentTime.toFixed(2)));
      });
      await page.click("button.aw-play");
      const t0 = Date.now();
      let at = await state(page);
      while (Date.now() - t0 < 70_000) {
        at = await state(page);
        if (process.env.FILM_END_TRACE) console.log(`   ${Math.round((Date.now() - t0) / 1000)}s ${at.label} ${at.clock} ${JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('video')].map((v) => [v.paused ? 'p' : 'P', v.ended ? 'E' : '-', Math.round(v.currentTime * 10) / 10, Math.round(v.duration * 10) / 10])))}`);
        if (at.label === "Play" && Date.now() - t0 > 2000) break;
        await page.waitForTimeout(500);
      }
      await page.screenshot({ path: `/private/tmp/claude-501/film-end-${stallLastVoice ? "stall" : "plain"}.png` });
      if (process.env.FILM_END_TRACE) console.log("  events", JSON.stringify(await page.evaluate(() => window.__ev)));
      console.log(`  ended after ${Math.round((Date.now() - t0) / 1000)} s at ${at.clock}`);
      assert.equal(at.label, "Play", `playback stopped by itself at the end (clock ${at.clock}, after ${Math.round((Date.now() - t0) / 1000)} s)`);
      assert.equal(at.musicPlaying, false, "the music stopped with the film");
      const [a, b] = [await state(page), await page.waitForTimeout(1500).then(() => state(page))];
      assert.deepEqual([a.label, a.clock], [b.label, b.clock], "and it stays stopped (the clock does not move, nothing restarts)");
      // Play from the end starts again from the beginning
      await page.click("button.aw-play");
      await page.waitForTimeout(1200);
      const again = await state(page);
      assert.equal(again.label, "Pause");
      assert.match(again.clock ?? "", /^0:0[0-3]\s*\//, `restarted near 0:00 (${again.clock})`);
    } finally {
      await browser?.close();
      srv.close();
    }
  });
}
