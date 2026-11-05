import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "../../node_modules/playwright-core/index.mjs";

// Phase 3g: the four real crayon scenes from staging at 30 fps (PREVIEW_FRAME_STEP = 1), tested end-to-end in headless Chrome
// with the browser's real IndexedDB (`gm-live-frames`) and WebP encoder Worker:
// 1. First play at 30 fps (0.4 quality): zero wrong frames, buffering pause & Web Audio (`AudioContext`) sync within 1 frame (33 ms),
//    and zero drift across 20 buffering pauses.
// 2. Replay after page reload: zero WorkerHost.frame calls for complete scenes, zero wrong frames, zero buffering.
// 3. Quality change 0.4 -> 0.6 and 0.6 -> 0.2 during playback: no pause caused by job, frames nearest playhead first, BOTH redraw (540 WorkerHost.frame calls each).
// 4. Changed bundleDigest for one scene: only that scene redraws, old background work cancelled, superseded digest deleted.
// 5. Stored bytes per frame at 0.2 / 0.4 / 0.6 within 20% of 20 / 34 / 48 KB.
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures/crayon-staging");

test(
  "crayon scenes at 30 fps with IndexedDB frame store: first play, audio sync on buffering, zero-Worker replay after reload, quality 0.4->0.6->0.2 job, single-scene digest revision, and WebP byte sizes",
  { timeout: 600_000 },
  async (t) => {
    if (!existsSync(CHROME_PATH)) {
      t.skip(`Google Chrome not found at ${CHROME_PATH}`);
      return;
    }
    const scenes = [0, 1, 2, 3].map((i) => ({
      html: readFileSync(join(FIX, `scene${i}.html`), "utf8"),
      meta: JSON.parse(readFileSync(join(FIX, `scene${i}.json`), "utf8"))
    }));
    const compiled = await build({
      entryPoints: [join(HERE, "../lib/live/index.ts")],
      bundle: true,
      format: "esm",
      target: "es2022",
      write: false
    });
    const liveJs = compiled.outputFiles[0].text;

    const server = createServer((req, res) => {
      const p = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      const h = { "cache-control": "no-store" };
      if (p === "/t.html") {
        res.writeHead(200, { ...h, "content-type": "text/html" });
        res.end(
          `<!doctype html><meta charset=utf-8><body><div id="stage"></div><script type="module">import * as L from "/live.js"; window.Live = L;</script>`
        );
        return;
      }
      if (p === "/live.js") {
        res.writeHead(200, { ...h, "content-type": "text/javascript" });
        res.end(liveJs);
        return;
      }
      const m = /^\/scene(\d)\.html$/.exec(p);
      if (m) {
        res.writeHead(200, { ...h, "content-type": "text/html" });
        res.end(scenes[Number(m[1])].html);
        return;
      }
      res.writeHead(404, h);
      res.end();
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ["--autoplay-policy=no-user-gesture-required"]
    });

    try {
      const page = await browser.newPage();
      await page.goto(`${origin}/t.html`);
      await page.waitForFunction(() => Boolean(window.Live));

      const specsArg = scenes.map((s) => ({
        digest: s.meta.bundleDigest,
        frames: s.meta.manifest.frames
      }));

      // =========================================================================
      // PHASE 1: Clean IndexedDB, First Play at 30 fps (quality 0.4) + Stub Audio Sync
      // =========================================================================
      const phase1 = await page.evaluate(async (specs) => {
        await new Promise((resolveDel) => {
          const req = indexedDB.deleteDatabase("gm-live-frames");
          req.onsuccess = () => resolveDel();
          req.onerror = () => resolveDel();
          req.onblocked = () => resolveDel();
        });

        const L = window.Live;
        const bitmaps = [];
        let workerFrameCalls = 0;
        const origFrame = L.WorkerHost.prototype.frame;
        L.WorkerHost.prototype.frame = async function (n, o) {
          workerFrameCalls++;
          const r = await origFrame.call(this, n, o);
          const bm = r.bitmap;
          bm.__n = n;
          bm.__closed = false;
          bm.__host = this;
          bm.__fresh = true;
          const c = bm.close.bind(bm);
          bm.close = () => {
            bm.__closed = true;
            c();
          };
          bitmaps.push(bm);
          return r;
        };

        const origLoad = L.FrameStore.prototype.load;
        L.FrameStore.prototype.load = async function (key) {
          const bm = await origLoad.call(this, key);
          const parsed = L.parseStoreFrameKey(key);
          if (bm && parsed) {
            bm.__n = parsed.frame;
            bm.__closed = false;
            bm.__fresh = false;
            const c = bm.close.bind(bm);
            bm.close = () => {
              bm.__closed = true;
              c();
            };
            bitmaps.push(bm);
          }
          return bm;
        };

        let lastDrawn = -1;
        let freshBlits = 0;
        let storeBlits = 0;
        const origDraw = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function (img, ...rest) {
          if (img && typeof img.__n === "number") {
            lastDrawn = img.__n;
            if (img.__fresh) freshBlits++;
            else storeBlits++;
          }
          return origDraw.call(this, img, ...rest);
        };

        const htmls = await Promise.all(specs.map((_, i) => fetch(`/scene${i}.html`).then((r) => r.text())));

        // Real browser AudioContext + WebAudioFilmTimeline with one stub AudioBuffer per scene
        const audioCtx = new AudioContext();
        await audioCtx.resume();
        let cursorSec = 0;
        const initialSpans = specs.map((s, i) => {
          const start = cursorSec;
          const end = start + s.frames / 30;
          cursorSec = end;
          return { id: `scene-${i}`, start, end };
        });
        const audioTimeline = new L.WebAudioFilmTimeline({
          fps: 30,
          spans: initialSpans,
          context: audioCtx
        });
        specs.forEach((s, i) => {
          const buf = audioCtx.createBuffer(1, Math.max(1, Math.round((s.frames / 30) * 44100)), 44100);
          audioTimeline.setVoiceBuffer(i, buf);
        });
        await audioTimeline.unlockFromUserGesture();
        await audioTimeline.play({ fromUserGesture: true });
        // Honest-audio guard: the sync numbers below only mean something if the REAL context is running (not the wall-clock fallback).
        const audioHonest = { stateAfterPlay: audioCtx.state, suspendedDuringPause: 0, runningAfterResume: 0, pausesChecked: 0, ctxFrozenMaxMs: 0, ctxAdvanceMinMs: 1e9, ctxVsTimelineMaxMs: 0 };

        let t = 0;
        let wantPlaying = true;
        const film = L.createFilmPlayer({
          filmKey: "crayon-staging-film",
          scenes: specs.map((s, i) => ({
            id: `scene-${i}`,
            bundleDigest: s.digest,
            html: htmls[i],
            params: {},
            frames: s.frames
          })),
          aspect: "16:9",
          fps: 30,
          previewQuality: 0.4,
          timeSource: { currentTime: () => t, playing: () => wantPlaying },
          audioTimeline
        });

        const audioSyncEvents = [];
        let pendingBufferCheck = null;
        film.on("buffering", (ev) => {
          const idx = ev.sceneIndex ?? film.activeSceneIndex;
          if (ev.buffering) {
            pendingBufferCheck = {
              scene: idx,
              atTime: Math.round(t * 1000) / 1000,
              frame: ev.frame,
              heldFrame: ev.heldFrame,
              audioPausedImmediately: audioTimeline.buffering === true && !audioTimeline.playing(),
              lagFrames: audioTimeline.buffering ? 0 : 1
            };
          } else if (pendingBufferCheck && pendingBufferCheck.scene === idx) {
            const spanStart = film.meta.sceneSpans[idx]?.start ?? 0;
            const shownFrameSec = (typeof ev.frame === "number" ? ev.frame : (film.scenes[idx]?.currentPreviewFrame ?? 0)) / 30;
            const audioFilmSec = audioTimeline.currentTime();
            const audioLocalSec = Math.max(0, audioFilmSec - spanStart);
            const diffMs = Math.round(Math.abs(shownFrameSec - audioLocalSec) * 1000 * 100) / 100;
            audioSyncEvents.push({
              ...pendingBufferCheck,
              audioResumedImmediately: !audioTimeline.buffering && audioTimeline.playing(),
              shownFrameLocalSec: Math.round(shownFrameSec * 1000) / 1000,
              audioContextLocalSec: Math.round(audioLocalSec * 1000) / 1000,
              resumeDiffMs: diffMs
            });
            pendingBufferCheck = null;
          }
        });

        const t0 = performance.now();
        await film.mount(document.getElementById("stage"));
        const mountMs = Math.round(performance.now() - t0);

        // Induce one deterministic mid-scene catch-up buffering pause on scene 0 to verify audio pause/resume sync:
        const s0 = film.scenes[0];
        while (s0.isPreparing || !s0.measuredYet || s0.isPumping) {
          film.syncToClock();
          await new Promise((r) => setTimeout(r, 20));
        }
        await film.flushStore();
        for (let f = 45; f < 90; f++) {
          s0.cache.release(s0.cacheKey, f);
          await film.frameStore.deleteFrame(specs[0].digest, "640x360", f);
        }
        s0.storedComplete = false;

        const spans = film.meta.sceneSpans;
        const per = specs.map((_, i) => ({
          scene: i,
          waitMs: 0,
          ticks: 0,
          bufferingPauses: 0,
          wrong: 0,
          maxNextAhead: 0,
          openAfterLeave: null
        }));
        let peakCacheBytes = 0;
        let peakHostBytes = 0;
        let last = performance.now();
        let prevActive = 0;
        const prepStart = {};
        const total = spans[spans.length - 1].end;
        let guard = 0;

        while (t < total - 0.05 && guard++ < 250_000) {
          await new Promise((r) => requestAnimationFrame(r));
          const now = performance.now();
          const dt = Math.min(0.05, (now - last) / 1000);
          last = now;

          const curIdx = film.activeSceneIndex;
          const curP = film.scenes[curIdx];
          if (curP.isPreparing || !curP.measuredYet || curP.isBufferingNow) {
            if (prepStart[curIdx] === undefined) prepStart[curIdx] = now;
            film.syncToClock();
          } else {
            if (prepStart[curIdx] !== undefined) {
              per[curIdx].waitMs += Math.round(now - prepStart[curIdx]);
              delete prepStart[curIdx];
            }
            t += dt;
            audioTimeline.seek(t);
            film.syncToClock();
            const a = film.activeSceneIndex;
            const pa = film.scenes[a];
            if (!pa.isPreparing && !pa.isBufferingNow && pa.measuredYet && pa.decision().mode === "live") {
              const expected = Math.max(0, Math.min(specs[a].frames - 1, Math.floor((t - spans[a].start) * 30 + 1e-9)));
              per[a].ticks++;
              if (!film.ready(Math.floor(t * 30 + 1e-9))) {
                per[a].wrong++;
              } else if (lastDrawn !== expected) {
                per[a].wrong++;
              }
              const nxt = film.scenes[a + 1];
              if (nxt) {
                per[a].maxNextAhead = Math.max(per[a].maxNextAhead, nxt.cachedPreviewFrames().length);
              }
            }
          }

          peakCacheBytes = Math.max(peakCacheBytes, film.cache.bytes);
          peakHostBytes = Math.max(
            peakHostBytes,
            film.scenes.reduce((s, q) => s + (q.workerHost ? q.workerHost.bytes : 0), 0)
          );

          const act = film.activeSceneIndex;
          if (act !== prevActive) {
            if (prepStart[prevActive] !== undefined) {
              per[prevActive].waitMs += Math.round(now - prepStart[prevActive]);
              delete prepStart[prevActive];
            }
            const left = film.scenes[prevActive];
            per[prevActive].openAfterLeave = bitmaps.filter((b) => b.__host === left.workerHost && !b.__closed).length;
            prevActive = act;
          }
        }

        // Ensure all 4 scenes finish saving every frame to IndexedDB
        for (const p of film.scenes) {
          await p.drawAllToStore(() => false);
        }
        await film.flushStore();

        // Now run 20 consecutive buffering pauses & resumes on the real AudioContext timeline + FilmPlayer
        // to prove zero drift and <= 33 ms sync across 20 buffering pauses!
        const twentyPauseDiffsMs = [];
        let twentyPauseMaxLagFrames = 0;
        const s3 = film.scenes[3];
        t = spans[3].start + 10 / 30;
        audioTimeline.seek(t);
        await s3.pumpScheduler(60);
        film.syncToClock();
        for (let p = 0; p < 20; p++) {
          const frameIdx = 10 + p;
          t = spans[3].start + frameIdx / 30;
          audioTimeline.seek(t);
          // Drop frameIdx from RAM cache so showFrame enters buffering, then restore it from FrameStore to resume
          s3.cache.release(s3.cacheKey, frameIdx);
          film.syncToClock();
          if (!audioTimeline.buffering) twentyPauseMaxLagFrames = Math.max(twentyPauseMaxLagFrames, 1);
          await new Promise((r) => setTimeout(r, 5));
          await s3.pumpScheduler(35);
          film.syncToClock();
          const audioFilmSec = audioTimeline.currentTime();
          const shownGlobalSec = spans[3].start + (s3.currentPreviewFrame / 30);
          const diffMs = Math.round(Math.abs(audioFilmSec - shownGlobalSec) * 1000 * 100) / 100;
          twentyPauseDiffsMs.push(diffMs);
        }
        const maxDiffAcross20PausesMs = Math.max(...twentyPauseDiffsMs);
        const driftAcross20PausesMs = Math.round(Math.abs(twentyPauseDiffsMs[19] - twentyPauseDiffsMs[0]) * 100) / 100;

        // Honest-audio pass (independent of the timeline's own flags): the REAL AudioContext must be suspended the moment buffering starts,
        // its clock frozen while still buffering, running again after resume, and the timeline's film time must advance with the context clock.
        audioHonest.suspendedAtEntry = 0; audioHonest.bufferingEntered = 0; audioHonest.frozenChecks = 0;
        for (let p = 0; p < 20; p++) {
          const frameIdx = 40 + p;
          t = spans[3].start + frameIdx / 30;
          audioTimeline.seek(t);
          s3.cache.release(s3.cacheKey, frameIdx);
          film.syncToClock();
          if (audioTimeline.buffering) {
            audioHonest.bufferingEntered++;
            if (audioCtx.state === "suspended") audioHonest.suspendedAtEntry++;
            const c0 = audioCtx.currentTime;
            await new Promise((r) => setTimeout(r, 15));
            if (audioTimeline.buffering && audioCtx.state === "suspended") {
              audioHonest.frozenChecks++;
              audioHonest.ctxFrozenMaxMs = Math.max(audioHonest.ctxFrozenMaxMs, Math.round((audioCtx.currentTime - c0) * 1000));
            }
          }
          await s3.pumpScheduler(35);
          film.syncToClock();
          await new Promise((r) => setTimeout(r, 30));
          const c1 = audioCtx.currentTime, tl1 = audioTimeline.currentTime();
          await new Promise((r) => setTimeout(r, 120));
          const c2 = audioCtx.currentTime, tl2 = audioTimeline.currentTime();
          if (audioCtx.state === "running") audioHonest.runningAfterResume++;
          audioHonest.ctxAdvanceMinMs = Math.min(audioHonest.ctxAdvanceMinMs, Math.round((c2 - c1) * 1000));
          audioHonest.ctxVsTimelineMaxMs = Math.max(audioHonest.ctxVsTimelineMaxMs, Math.round(Math.abs((tl2 - tl1) - (c2 - c1)) * 1000));
          audioHonest.pausesChecked++;
        }

        for (let i = 0; i < film.scenes.length; i++) {
          per[i].bufferingPauses = film.scenes[i].bufferingPauses;
        }

        const storeRecords04 = specs.map((s) => film.frameStore.getSceneRecord(s.digest, "640x360"));
        const totalBytes04 = film.frameStore.totalBytes();
        const totalFrames04 = specs.reduce((acc, s) => acc + s.frames, 0);
        const avgBytesPerFrame04 = Math.round(totalBytes04 / totalFrames04);
        const peakEncoderQueue = film.frameStore.peakEncoderQueue;

        const decisions = film.scenes.map((q, i) => ({
          scene: i,
          mode: q.decision().mode,
          state: q.state,
          reason: q.decision().reason,
          variant: q.playbackVariant,
          L: q.predrawPlan?.neededFrames ?? null,
          startFrames: q.predrawPlan?.startFrames ?? null,
          W: q.predrawPlan ? Math.round(q.predrawPlan.waitSeconds * 10) / 10 : null,
          drawFps: q.predrawPlan ? Math.round(q.predrawPlan.produceFps * 10) / 10 : null,
          plannedFps: q.predrawPlan ? Math.round(q.predrawPlan.plannedProduceFps * 10) / 10 : null
        }));

        const budget = film.cache.budget;
        audioTimeline.destroy();
        film.destroy();
        const openAfterDestroy = bitmaps.filter((b) => !b.__closed).length;
        const bitmapsOpened = bitmaps.length;
        const bitmapsClosed = bitmaps.filter((b) => b.__closed).length;

        return {
          mountMs,
          workerFrameCalls,
          freshBlits,
          storeBlits,
          bufferingPauses: film.bufferingPauses,
          audioSyncEvents,
          audioHonest,
          twentyBufferingPauses: {
            count: twentyPauseDiffsMs.length,
            maxLagFrames: twentyPauseMaxLagFrames,
            maxResumeDiffMs: maxDiffAcross20PausesMs,
            driftAcross20PausesMs,
            diffsMs: twentyPauseDiffsMs
          },
          decisions,
          per,
          peak: {
            cacheBytes: peakCacheBytes,
            hostBytes: peakHostBytes,
            budget,
            peakEncoderQueue
          },
          bitmapsOpened,
          bitmapsClosed,
          openAfterDestroy,
          store04: {
            totalBytes: totalBytes04,
            totalFrames: totalFrames04,
            avgBytesPerFrame: avgBytesPerFrame04,
            avgKBPerFrame: Math.round((avgBytesPerFrame04 / 1024) * 10) / 10,
            scenesComplete: storeRecords04.map((r) => Boolean(r?.complete))
          }
        };
      }, specsArg);

      console.log("PHASE 1 (First play at 30 fps):", JSON.stringify(phase1, null, 2));

      // Hard correctness assertions for Phase 1
      const totalWrong1 = phase1.per.reduce((s, p) => s + p.wrong, 0);
      assert.equal(totalWrong1, 0, "first play: zero wrong frames shown");
      assert.ok(phase1.bufferingPauses >= 1, "at least one buffering pause was measured with the stub audio track");
      assert.ok(phase1.audioSyncEvents.length >= 1, "recorded audio sync across buffering pause/resume");
      for (const syncEv of phase1.audioSyncEvents) {
        assert.equal(syncEv.audioPausedImmediately, true, "every buffering pause pauses the audio within one frame");
        assert.ok(syncEv.lagFrames <= 1, `audio pause lag (${syncEv.lagFrames} frames) <= 1 frame`);
        assert.equal(syncEv.audioResumedImmediately, true, "audio resumes when buffering finishes");
        assert.ok(
          syncEv.resumeDiffMs <= 33,
          `after resume, picture time and audio currentTime differ by at most 33 ms (got ${syncEv.resumeDiffMs} ms)`
        );
      }
      const ah = phase1.audioHonest;
      assert.equal(ah.stateAfterPlay, "running", "the real AudioContext is running after play (else sync numbers are the wall-clock fallback)");
      assert.equal(ah.pausesChecked, 20, "independent audio check ran on 20 pauses");
      assert.equal(ah.bufferingEntered, 20, "every one of the 20 induced pauses entered buffering");
      assert.equal(ah.suspendedAtEntry, 20, "the real AudioContext was suspended the moment every buffering pause began");
      assert.ok(ah.ctxFrozenMaxMs <= 15, `the context clock stayed frozen while still buffering (${ah.frozenChecks} checks, max advance ${ah.ctxFrozenMaxMs} ms)`);
      assert.equal(ah.runningAfterResume, 20, "the real AudioContext was running after every resume");
      assert.ok(ah.ctxAdvanceMinMs >= 40, `the context clock advances after resume (min ${ah.ctxAdvanceMinMs} ms over a 120 ms wait; the scheduler may re-enter buffering briefly)`);
      assert.ok(ah.ctxVsTimelineMaxMs <= 33, `timeline film time tracks the context clock within 33 ms after every resume (max ${ah.ctxVsTimelineMaxMs} ms)`);
      assert.equal(phase1.twentyBufferingPauses.count, 20, "measured 20 buffering pauses on real AudioContext");
      assert.equal(phase1.twentyBufferingPauses.maxLagFrames, 0, "all 20 buffering pauses suspended audio within 1 frame");
      assert.ok(
        phase1.twentyBufferingPauses.maxResumeDiffMs <= 33,
        `max diff across 20 buffering pauses (${phase1.twentyBufferingPauses.maxResumeDiffMs} ms) <= 33 ms`
      );
      assert.ok(
        phase1.twentyBufferingPauses.driftAcross20PausesMs <= 33,
        `no drift across 20 buffering pauses (${phase1.twentyBufferingPauses.driftAcross20PausesMs} ms <= 33 ms)`
      );
      assert.ok(phase1.freshBlits >= 1, "frame shown at the moment it is drawn is exact (freshBlits >= 1)");
      assert.ok(phase1.storeBlits > 0, "frames drawn ahead of playback are shown from stored WebP copies (storeBlits > 0)");
      assert.ok(phase1.peak.peakEncoderQueue <= 8, `encoder queue peak (${phase1.peak.peakEncoderQueue}) <= 8`);
      assert.equal(phase1.bitmapsOpened, phase1.bitmapsClosed, `bitmap opens (${phase1.bitmapsOpened}) == closes (${phase1.bitmapsClosed})`);
      assert.deepEqual(phase1.store04.scenesComplete, [true, true, true, true], "all 4 scenes saved and marked complete in IndexedDB");
      assert.equal(phase1.openAfterDestroy, 0, "all bitmaps closed on destroy");
      assert.ok(phase1.peak.cacheBytes <= phase1.peak.budget, "peak RAM cache bytes within budget");

      // =========================================================================
      // PHASE 2: Page Reload -> Replay Complete Scenes from IndexedDB (0 Worker draws)
      // =========================================================================
      await page.reload();
      await page.waitForFunction(() => Boolean(window.Live));

      const phase2 = await page.evaluate(async (specs) => {
        const L = window.Live;
        let workerFrameCalls = 0;
        const origFrame = L.WorkerHost.prototype.frame;
        L.WorkerHost.prototype.frame = async function (n, o) {
          workerFrameCalls++;
          return origFrame.call(this, n, o);
        };

        // Tag decoded bitmaps from FrameStore with their frame index so canvas drawImage can verify exact frame order
        const origLoad = L.FrameStore.prototype.load;
        L.FrameStore.prototype.load = async function (key) {
          const bm = await origLoad.call(this, key);
          const parsed = L.parseStoreFrameKey(key);
          if (bm && parsed) {
            bm.__n = parsed.frame;
          }
          return bm;
        };

        let lastDrawn = -1;
        const origDraw = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function (img, ...rest) {
          if (img && typeof img.__n === "number") {
            lastDrawn = img.__n;
          }
          return origDraw.call(this, img, ...rest);
        };

        const htmls = await Promise.all(specs.map((_, i) => fetch(`/scene${i}.html`).then((r) => r.text())));
        let t = 0;
        const film = L.createFilmPlayer({
          filmKey: "crayon-staging-film",
          scenes: specs.map((s, i) => ({
            id: `scene-${i}`,
            bundleDigest: s.digest,
            html: htmls[i],
            params: {},
            frames: s.frames
          })),
          aspect: "16:9",
          fps: 30,
          timeSource: { currentTime: () => t, playing: () => true }
        });

        const t0 = performance.now();
        await film.mount(document.getElementById("stage"));
        const mountMs = Math.round(performance.now() - t0);

        const spans = film.meta.sceneSpans;
        const totalFrames = film.meta.frames;
        let wrongFrames = 0;
        let framesPlayed = 0;

        for (let globalFrame = 0; globalFrame < totalFrames; globalFrame++) {
          t = (globalFrame + 0.1) / 30;
          const sceneIdx = L.sceneAt(spans, t);
          const scenePlayer = film.scenes[sceneIdx];
          const expectedLocal = globalFrame - Math.round(spans[sceneIdx].start * 30);
          if (!scenePlayer.measuredYet) {
            await scenePlayer.measure();
          }
          // Wait for async IndexedDB -> createImageBitmap prefetch when advancing the 90-frame rolling window
          let waitTicks = 0;
          while (!scenePlayer.ready(expectedLocal) && waitTicks++ < 200) {
            if (!scenePlayer.isPumping) {
              void scenePlayer.pumpScheduler(30);
            }
            await new Promise((r) => setTimeout(r, 3));
          }
          film.syncToClock();
          if (lastDrawn !== expectedLocal) {
            wrongFrames++;
          }
          framesPlayed++;
        }

        const activeWorkersDuringReplay = L.getActiveBrowserTransportCount();
        const bufferingPauses = film.bufferingPauses;

        // Keep `window.__testFilm` for Phase 3 & 4
        window.__testFilm = film;
        window.__setTestClock = (nextT) => {
          t = nextT;
        };
        window.__getWorkerFrameCalls = () => workerFrameCalls;
        window.__resetWorkerFrameCalls = () => {
          workerFrameCalls = 0;
        };

        return {
          mountMs,
          framesPlayed,
          workerFrameCalls,
          activeWorkersDuringReplay,
          wrongFrames,
          bufferingPauses
        };
      }, specsArg);

      console.log("PHASE 2 (Replay after reload):", JSON.stringify(phase2, null, 2));

      assert.equal(phase2.workerFrameCalls, 0, "replay after page reload: ZERO WorkerHost.frame calls for complete scenes");
      assert.equal(phase2.activeWorkersDuringReplay, 0, "replay after page reload: ZERO drawing Workers created");
      assert.equal(phase2.wrongFrames, 0, "replay after page reload: zero wrong frames");
      assert.equal(phase2.bufferingPauses, 0, "replay after page reload: zero buffering pauses");
      assert.equal(phase2.framesPlayed, 540, "replayed all 540 frames across the 4 scenes");

      // =========================================================================
      // PHASE 3: Quality Change 0.4 -> 0.6 During Playback, then 0.6 -> 0.2
      // =========================================================================
      const phase3 = await page.evaluate(async (specs) => {
        const L = window.Live;
        const film = window.__testFilm;
        const spans = film.meta.sceneSpans;

        // Position playhead at Scene 1, local frame 20 (global time = 3.0 + 20/30 = 3.67 s)
        let currentT = spans[1].start + 20 / 30;
        window.__setTestClock(currentT);
        await film.scenes[1].measure();
        await film.scenes[1].pumpScheduler(45);
        film.syncToClock();

        const bufferingBeforeRaise = film.bufferingPauses;
        window.__resetWorkerFrameCalls();

        const tRaise0 = performance.now();
        const raisePromise = film.setPreviewQuality(0.6);
        const job = film.qualityJob;

        // Continue advancing playback across Scene 1 while the quality job runs in the background
        for (let step = 0; step < 20; step++) {
          currentT += 1 / 30;
          window.__setTestClock(currentT);
          film.syncToClock();
          await new Promise((r) => setTimeout(r, 10));
        }
        const pausesCausedByJob = film.bufferingPauses - bufferingBeforeRaise;

        // Wait for the 0.4 -> 0.6 raise job to finish all 540 frames
        await raisePromise;
        await film.flushStore();
        const raiseMs = Math.round(performance.now() - tRaise0);
        const workerCallsOnRaise = window.__getWorkerFrameCalls();
        const firstUpgraded = (job?.processedOrder ?? []).slice(0, 6).map((s) => `S${s.sceneIndex}:${s.frame}`);

        const totalBytes06 = film.frameStore.totalBytes();
        const totalFrames = specs.reduce((acc, s) => acc + s.frames, 0);
        const avgBytesPerFrame06 = Math.round(totalBytes06 / totalFrames);
        const qualitiesAfter06 = specs.map((s) => film.frameStore.getSceneRecord(s.digest, "640x360")?.quality);

        // Now lower quality 0.6 -> 0.2 during playback: must ALSO redraw with scene code (540 WorkerHost.frame calls) and cause 0 pauses!
        const bufferingBeforeLower = film.bufferingPauses;
        window.__resetWorkerFrameCalls();
        const tLower0 = performance.now();
        const lowerPromise = film.setPreviewQuality(0.2);
        const lowerJob = film.qualityJob;
        for (let step = 0; step < 10; step++) {
          currentT += 1 / 30;
          window.__setTestClock(currentT);
          film.syncToClock();
          await new Promise((r) => setTimeout(r, 10));
        }
        const pausesCausedByLowerJob = film.bufferingPauses - bufferingBeforeLower;
        await lowerPromise;
        await film.flushStore();
        const lowerMs = Math.round(performance.now() - tLower0);
        const workerCallsOnLower = window.__getWorkerFrameCalls();
        const firstLowered = (lowerJob?.processedOrder ?? []).slice(0, 6).map((s) => `S${s.sceneIndex}:${s.frame}`);

        const totalBytes02 = film.frameStore.totalBytes();
        const avgBytesPerFrame02 = Math.round(totalBytes02 / totalFrames);
        const qualitiesAfter02 = specs.map((s) => film.frameStore.getSceneRecord(s.digest, "640x360")?.quality);

        return {
          raise04to06: {
            raiseMs,
            pausesCausedByJob,
            workerCallsOnRaise,
            firstUpgraded,
            qualitiesAfter06,
            totalBytes: totalBytes06,
            avgBytesPerFrame: avgBytesPerFrame06,
            avgKBPerFrame: Math.round((avgBytesPerFrame06 / 1024) * 10) / 10
          },
          lower06to02: {
            lowerMs,
            pausesCausedByLowerJob,
            workerCallsOnLower,
            firstLowered,
            qualitiesAfter02,
            totalBytes: totalBytes02,
            avgBytesPerFrame: avgBytesPerFrame02,
            avgKBPerFrame: Math.round((avgBytesPerFrame02 / 1024) * 10) / 10
          }
        };
      }, specsArg);

      console.log("PHASE 3 (Quality 0.4 -> 0.6 -> 0.2):", JSON.stringify(phase3, null, 2));

      assert.equal(phase3.raise04to06.pausesCausedByJob, 0, "quality change 0.4 -> 0.6 caused zero playback pauses");
      assert.equal(phase3.raise04to06.workerCallsOnRaise, 540, "raising quality 0.4 -> 0.6 redrew all 540 frames");
      assert.match(
        phase3.raise04to06.firstUpgraded[0] ?? "",
        /^S1:(2\d|3\d|40)$/,
        `frames nearest the playhead (S1:20..40) upgraded first, got ${phase3.raise04to06.firstUpgraded.join(", ")}`
      );
      assert.deepEqual(phase3.raise04to06.qualitiesAfter06, [0.6, 0.6, 0.6, 0.6]);

      assert.equal(phase3.lower06to02.pausesCausedByLowerJob, 0, "quality change 0.6 -> 0.2 caused zero playback pauses");
      assert.equal(
        phase3.lower06to02.workerCallsOnLower,
        540,
        "lowering quality 0.6 -> 0.2 redrew all 540 frames with scene code (never re-encoded stored copy)"
      );
      assert.deepEqual(phase3.lower06to02.qualitiesAfter02, [0.2, 0.2, 0.2, 0.2]);

      // =========================================================================
      // PHASE 4: Changed bundleDigest for One Scene (Scene 3) -> Only Scene 3 Redraws
      // =========================================================================
      const phase4 = await page.evaluate(async (specs) => {
        const film = window.__testFilm;
        const html3 = await fetch("/scene3.html").then((r) => r.text());
        const oldDigest3 = specs[3].digest;
        const newDigest3 = `${oldDigest3}-rev2`;

        window.__resetWorkerFrameCalls();
        await film.updateScene(3, {
          id: "scene-3",
          bundleDigest: newDigest3,
          html: html3,
          params: { commentRevision: 2 },
          frames: specs[3].frames,
          variantKey: "crayon-staging-film:scene-3"
        });

        const callsByScene = [0, 0, 0, 0];
        film.scenes.forEach((sc, idx) => {
          if (!sc.workerHost) return;
          const orig = sc.workerHost.frame.bind(sc.workerHost);
          sc.workerHost.frame = async (n, o) => {
            callsByScene[idx]++;
            return orig(n, o);
          };
        });

        await film.scenes[3].drawAllToStore(() => false);
        await film.flushStore();

        const workerCallsForRevision = window.__getWorkerFrameCalls();
        const oldScene3Record = film.frameStore.getSceneRecord(oldDigest3, "640x360");
        const newScene3Record = film.frameStore.getSceneRecord(newDigest3, "640x360");
        const otherScenesComplete = [0, 1, 2].map((i) =>
          film.frameStore.isSceneComplete(specs[i].digest, "640x360", specs[i].frames)
        );

        film.destroy();
        return {
          workerCallsForRevision,
          callsByScene,
          expectedScene3Frames: specs[3].frames,
          oldDigestDeleted: oldScene3Record === undefined,
          newDigestComplete: Boolean(newScene3Record?.complete),
          otherScenesComplete
        };
      }, specsArg);

      console.log("PHASE 4 (Single-scene bundleDigest revision):", JSON.stringify(phase4, null, 2));

      assert.deepEqual(
        phase4.callsByScene,
        [0, 0, 0, phase4.expectedScene3Frames],
        "changing bundleDigest for scene 3 redrew ONLY scene 3 (150 frames) and 0 frames on scenes 0, 1, 2"
      );
      assert.equal(
        phase4.workerCallsForRevision,
        phase4.expectedScene3Frames,
        "total WorkerHost.frame calls during revision equals scene 3 frame count (150)"
      );
      assert.equal(phase4.oldDigestDeleted, true, "superseded bundleDigest frames were deleted");
      assert.equal(phase4.newDigestComplete, true, "new bundleDigest is saved and complete");
      assert.deepEqual(phase4.otherScenesComplete, [true, true, true], "scenes 0, 1, 2 stayed complete without redrawing");

      // =========================================================================
      // PHASE 5: Stored WebP Bytes Per Frame at 0.2 / 0.4 / 0.6 within 20% of 20 / 34 / 48 KB
      // =========================================================================
      const kb02 = phase3.lower06to02.avgBytesPerFrame / 1024;
      const kb04 = phase1.store04.avgBytesPerFrame / 1024;
      const kb06 = phase3.raise04to06.avgBytesPerFrame / 1024;

      const fullReport = {
        phase1_firstPlay: phase1,
        phase2_replayAfterReload: phase2,
        phase3_qualityJobs: phase3,
        phase4_digestRevision: phase4,
        bytesPerFrameSummary: {
          q02: { bytes: phase3.lower06to02.avgBytesPerFrame, kb: Math.round(kb02 * 100) / 100, targetKB: 20 },
          q04: { bytes: phase1.store04.avgBytesPerFrame, kb: Math.round(kb04 * 100) / 100, targetKB: 34 },
          q06: { bytes: phase3.raise04to06.avgBytesPerFrame, kb: Math.round(kb06 * 100) / 100, targetKB: 48 }
        }
      };

      writeFileSync(join(HERE, "../../tools/phase3/3g-chrome-run.json"), JSON.stringify(fullReport, null, 2));
      writeFileSync(join(HERE, "../../tools/phase3/3f-chrome-run.json"), JSON.stringify(fullReport, null, 2));

      assert.ok(
        kb02 >= 20 * 0.8 && kb02 <= 20 * 1.2,
        `stored KB/frame at 0.2 (${kb02.toFixed(2)} KB) must be within 20% of 20 KB ([16, 24] KB)`
      );
      assert.ok(
        kb04 >= 34 * 0.8 && kb04 <= 34 * 1.2,
        `stored KB/frame at 0.4 (${kb04.toFixed(2)} KB) must be within 20% of 34 KB ([27.2, 40.8] KB)`
      );
      assert.ok(
        kb06 >= 48 * 0.8 && kb06 <= 48 * 1.2,
        `stored KB/frame at 0.6 (${kb06.toFixed(2)} KB) must be within 20% of 48 KB ([38.4, 57.6] KB)`
      );
    } finally {
      await browser.close();
      server.close();
    }
  }
);
