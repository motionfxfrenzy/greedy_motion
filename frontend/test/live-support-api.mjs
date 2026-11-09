import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SLOW_DRAW_MEDIAN_MS,
  SLOW_DRAW_P90_MS,
  VERIFIED_ENVIRONMENTS,
  environmentStatus,
  isSlowScene,
  resolveCacheBudgetBytes,
  resolveCacheBudgetMB,
  supportsWorkerHost
} from "../lib/live/support.ts";
import {
  buildCheckSampleFrames,
  fetchBundle,
  reportCheck,
  requestClip,
  runCheck,
  sha256Hex
} from "../lib/live/api.ts";

test("VERIFIED_ENVIRONMENTS data and environmentStatus table classify desktop Chromium >= 120 as verified, others unverified/unsupported", () => {
  assert.equal(VERIFIED_ENVIRONMENTS.length, 3);
  assert.deepEqual(
    VERIFIED_ENVIRONMENTS.map((e) => `${e.browser}:${e.os}:${e.device}:>=${e.minVersion}`),
    [
      "chromium:macOS:desktop:>=120",
      "chromium:Windows:desktop:>=120",
      "chromium:Linux:desktop:>=120"
    ]
  );

  const table = [
    // Verified desktop Chrome / Chromium >= 120
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.79 Safari/537.36",
      "verified"
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "verified"
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chromium/134.0.6998.35 Safari/537.36",
      "verified"
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.8078.79 Safari/537.36",
      "verified"
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0",
      "verified"
    ],
    // Older Chrome (< 120) -> unverified
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
      "unverified"
    ],
    // Safari macOS -> unverified
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
      "unverified"
    ],
    // Firefox macOS / Windows / Linux -> unverified
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0",
      "unverified"
    ],
    [
      "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0",
      "unverified"
    ],
    // iOS Safari and iOS Chrome -> unverified
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "unverified"
    ],
    [
      "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
      "unverified"
    ],
    // Android Chrome -> unverified
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36",
      "unverified"
    ],
    [
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "unverified"
    ]
  ];

  for (const [ua, expected] of table) {
    assert.equal(environmentStatus(ua), expected, `UA: ${ua}`);
    assert.equal(supportsWorkerHost(ua), expected === "verified", `supportsWorkerHost for UA: ${ua}`);
  }

  // Missing required browser APIs -> unsupported and supportsWorkerHost() === false even on Chrome 156 macOS UA
  const chromeMacUa = table[0][0];
  for (const missingFlag of ["worker", "offscreenCanvas2d", "createImageBitmap", "sandboxedSrcdocIframe"]) {
    assert.equal(
      environmentStatus({ userAgent: chromeMacUa, [missingFlag]: false }),
      "unsupported",
      `missing ${missingFlag} must report unsupported`
    );
    assert.equal(
      supportsWorkerHost({ userAgent: chromeMacUa, [missingFlag]: false }),
      false,
      `missing ${missingFlag} must make supportsWorkerHost() return false`
    );
  }

  // In plain Node (no DOM / OffscreenCanvas), calling with no args detects missing features
  assert.equal(environmentStatus(), "unsupported");
  assert.equal(supportsWorkerHost(), false);
});

test("resolveCacheBudgetMB follows plan §6 rules: 160 default, 80 for deviceMemory <= 4, 60 on iOS", () => {
  const macUa = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/156.0.0.0 Safari/537.36";
  const iosUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Version/17.5 Mobile/15E148 Safari/604.1";

  assert.equal(resolveCacheBudgetMB({ userAgent: macUa, deviceMemory: 8 }), 160);
  assert.equal(resolveCacheBudgetMB({ userAgent: macUa, deviceMemory: null }), 160);
  assert.equal(resolveCacheBudgetMB({ userAgent: macUa, deviceMemory: 4 }), 80);
  assert.equal(resolveCacheBudgetMB({ userAgent: macUa, deviceMemory: 2 }), 80);
  assert.equal(resolveCacheBudgetMB({ userAgent: iosUa, deviceMemory: 8 }), 60);
  assert.equal(resolveCacheBudgetBytes({ userAgent: macUa, deviceMemory: 4 }), 80 * 1024 * 1024);
});

test("fetchBundle verifies SHA-256 against manifest.bundleSha prefix and refuses tampered HTML", async () => {
  const validHtml = "<!doctype html><html><body><script>window.FILM={};</script></body></html>";
  const fullSha = await sha256Hex(validHtml);
  const bundleSha = fullSha.slice(0, 24);

  let servedHtml = validHtml;
  const fakeFetch = async (url) => {
    if (String(url).endsWith("/bundle")) {
      return new Response(
        JSON.stringify({
          url: "https://r2.test/bundle.html",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          bundleDigest: "d".repeat(64),
          manifest: { width: 1920, height: 1080, fps: 30, frames: 90, bundleSha },
          params: { sky: "#3b2c55" }
        }),
        { status: 200 }
      );
    }
    return new Response(servedHtml, { status: 200 });
  };

  const ok = await fetchBundle("p1", "v1", { fetch: fakeFetch });
  assert.equal(ok.html, validHtml);
  assert.equal(ok.bundleDigest, "d".repeat(64));
  assert.deepEqual(ok.params, { sky: "#3b2c55" });

  // Tamper with the HTML served from the presigned URL
  servedHtml = validHtml.replace("window.FILM={}", "fetch('https://evil.example')");
  await assert.rejects(
    () => fetchBundle("p1", "v1", { fetch: fakeFetch }),
    /SHA-256 verification failed/
  );
});

test("fetchBundle refreshes an expired presigned link once (both expired timestamp and 403 presigned response)", async () => {
  const html = "<!doctype html><html><body><script>window.FILM={};</script></body></html>";
  const bundleSha = (await sha256Hex(html)).slice(0, 24);

  // Case A: first /bundle response has an already-expired timestamp; second has a fresh timestamp
  let metaCallsA = 0;
  const fetchA = async (url) => {
    if (String(url).endsWith("/bundle")) {
      metaCallsA++;
      const expiresAt =
        metaCallsA === 1
          ? new Date(1_000).toISOString()
          : new Date(20_000).toISOString();
      return new Response(
        JSON.stringify({
          url: `https://r2.test/b-${metaCallsA}.html`,
          expiresAt,
          bundleDigest: "a".repeat(64),
          manifest: { bundleSha },
          params: {}
        }),
        { status: 200 }
      );
    }
    assert.equal(url, "https://r2.test/b-2.html", "must fetch the refreshed URL");
    return new Response(html, { status: 200 });
  };

  const resA = await fetchBundle("p1", "v1", { fetch: fetchA, now: () => 10_000 });
  assert.equal(metaCallsA, 2);
  assert.equal(resA.html, html);

  // Case B: presigned URL returns 403 on first attempt, then 200 after refreshing /bundle once
  let metaCallsB = 0;
  let htmlCallsB = 0;
  const fetchB = async (url) => {
    if (String(url).endsWith("/bundle")) {
      metaCallsB++;
      return new Response(
        JSON.stringify({
          url: `https://r2.test/b-${metaCallsB}.html`,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          bundleDigest: "b".repeat(64),
          manifest: { bundleSha },
          params: {}
        }),
        { status: 200 }
      );
    }
    htmlCallsB++;
    if (htmlCallsB === 1) return new Response("ExpiredToken", { status: 403 });
    return new Response(html, { status: 200 });
  };

  const resB = await fetchBundle("p1", "v1", { fetch: fetchB });
  assert.equal(metaCallsB, 2);
  assert.equal(htmlCallsB, 2);
  assert.equal(resB.html, html);
});

test("reportCheck handles 200, treats 204 as dropped, and never throws on network error", async () => {
  const sentBodies = [];
  const res200 = await reportCheck(
    "p1",
    "v1",
    { gen: 2, bundleDigest: "abc", results: { ok: true }, device: { ua: "Chrome" } },
    {
      fetch: async (_url, init) => {
        sentBodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ state: "checked" }), { status: 200 });
      }
    }
  );
  assert.equal(sentBodies[0].host, "worker");
  assert.equal(res200.status, "ok");
  assert.equal(res200.state, "checked");

  const res204 = await reportCheck(
    "p1",
    "v1",
    { gen: 1, bundleDigest: "stale", results: { ok: true } },
    { fetch: async () => new Response(null, { status: 204 }) }
  );
  assert.equal(res204.status, "dropped");
  assert.equal(res204.dropped, true);
  assert.equal(res204.ok, true);

  const resNetErr = await reportCheck(
    "p1",
    "v1",
    { gen: 2, bundleDigest: "abc", results: { ok: true } },
    {
      fetch: async () => {
        throw new Error("ECONNRESET");
      }
    }
  );
  assert.equal(resNetErr.status, "network_error");
  assert.equal(resNetErr.ok, false);
  assert.match(resNetErr.error, /ECONNRESET/);
});

test("requestClip surfaces 429 clip_cap as a value and not an exception", async () => {
  const okClip = await requestClip("p1", "v1", {
    fetch: async () => new Response(JSON.stringify({ state: "rendering" }), { status: 202 })
  });
  assert.equal(okClip.status, "rendering");
  assert.equal(okClip.capped, false);

  const cappedClip = await requestClip("p1", "v5", {
    fetch: async () =>
      new Response(
        JSON.stringify({ code: "clip_cap", error: { code: "clip_cap", message: "Too many clips." } }),
        { status: 429 }
      )
  });
  assert.equal(cappedClip.status, "clip_cap");
  assert.equal(cappedClip.code, "clip_cap");
  assert.equal(cappedClip.capped, true);
  assert.equal(cappedClip.ok, false);
});

test("runCheck verifies meta, determinism across frames 0/mid/last, and distinguishes code vs env failures", async () => {
  const manifest = { width: 1920, height: 1080, fps: 30, frames: 90 };
  const closedFrames = [];

  // 1. Passing deterministic host
  const goodHost = {
    async init() {
      return { w: 1920, h: 1080, meta: { W: 1920, H: 1080, fps: 30, durationFrames: 90 } };
    },
    async frame(n) {
      return {
        n,
        drawMs: 12,
        hash: `hash-frame-${n}`,
        bitmap: { width: 1920, height: 1080, close: () => closedFrames.push(n) }
      };
    }
  };
  const pass = await runCheck(goodHost, manifest);
  assert.deepEqual(pass, { ok: true });
  assert.deepEqual(closedFrames, [0, 45, 89, 0, 45, 89], "all 6 check bitmaps are closed");

  // 2. Meta mismatch -> kind: "code"
  const mismatchHost = {
    ...goodHost,
    async init() {
      return { w: 1920, h: 1080, meta: { W: 1920, H: 1080, fps: 30, durationFrames: 60 } };
    }
  };
  const metaFail = await runCheck(mismatchHost, manifest);
  assert.equal(metaFail.ok, false);
  assert.equal(metaFail.kind, "code");

  // 3. Non-deterministic draw -> kind: "code"
  let calls45 = 0;
  const nonDetHost = {
    ...goodHost,
    async frame(n) {
      if (n === 45) calls45++;
      return {
        n,
        drawMs: 10,
        hash: n === 45 ? `rand-${calls45}` : `det-${n}`,
        bitmap: { width: 1920, height: 1080, close() {} }
      };
    }
  };
  const detFail = await runCheck(nonDetHost, manifest);
  assert.equal(detFail.ok, false);
  assert.equal(detFail.kind, "code");
  assert.match(detFail.error, /Non-deterministic/);

  // 4. Device / watchdog failure on first frame -> kind: "env"
  const watchdogFirstFrameHost = {
    async init() {
      return { w: 1920, h: 1080, meta: { W: 1920, H: 1080, fps: 30, durationFrames: 90 } };
    },
    async frame() {
      throw new Error("Watchdog timeout (frame-timeout) after 2000ms");
    }
  };
  const envFail = await runCheck(watchdogFirstFrameHost, manifest);
  assert.equal(envFail.ok, false);
  assert.equal(envFail.kind, "env");

  // 5. Null / unsupported host -> kind: "env"
  const nullFail = await runCheck(null, manifest);
  assert.deepEqual(nullFail.ok, false);
  assert.equal(nullFail.kind, "env");
});

test("fetchBundle, reportCheck, and requestClip work in browser environments where globalThis.process is undefined", async () => {
  const savedProcess = Object.getOwnPropertyDescriptor(globalThis, "process");
  const html = "<!doctype html><html><body><script>window.FILM={};</script></body></html>";
  const bundleSha = (await sha256Hex(html)).slice(0, 24);
  try {
    Object.defineProperty(globalThis, "process", { value: undefined, configurable: true, writable: true });
    const fakeFetch = async (url) => {
      const s = String(url);
      if (s.endsWith("/bundle")) {
        return new Response(
          JSON.stringify({
            url: "https://r2.test/bundle.html",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            bundleDigest: "c".repeat(64),
            manifest: { bundleSha },
            params: {}
          }),
          { status: 200 }
        );
      }
      if (s.endsWith("/check")) {
        return new Response(JSON.stringify({ state: "checked" }), { status: 200 });
      }
      if (s.endsWith("/clip-request")) {
        return new Response(JSON.stringify({ state: "rendering" }), { status: 202 });
      }
      return new Response(html, { status: 200 });
    };

    const bundle = await fetchBundle("p1", "v1", { fetch: fakeFetch });
    assert.equal(bundle.html, html);

    const check = await reportCheck(
      "p1",
      "v1",
      { gen: 1, bundleDigest: bundle.bundleDigest, results: { ok: true } },
      { fetch: fakeFetch }
    );
    assert.equal(check.status, "ok");

    const clip = await requestClip("p1", "v1", { fetch: fakeFetch });
    assert.equal(clip.status, "rendering");

    // Verify Next.js `/api/backend` proxy baseUrl does not duplicate `/v1`
    const seenUrls = [];
    await fetchBundle("p1", "v1", {
      baseUrl: "/api/backend",
      fetch: async (url) => {
        seenUrls.push(String(url));
        return fakeFetch(url);
      }
    });
    assert.equal(seenUrls[0], "/api/backend/projects/p1/plates/v1/bundle");
    assert.equal(seenUrls[1], "https://r2.test/bundle.html");
  } finally {
    if (savedProcess) {
      Object.defineProperty(globalThis, "process", savedProcess);
    }
  }
});

test("runCheck does not report a scene as non-deterministic when only the first draw differed (transient raster change under load)", async () => {
  const manifest = { width: 1920, height: 1080, fps: 30, frames: 90 };
  const host = (hashFor) => ({
    async init() { return { w: 1920, h: 1080, meta: { W: 1920, H: 1080, fps: 30, durationFrames: 90 } }; },
    async frame(n) { return { n, drawMs: 10, hash: hashFor(n), bitmap: { width: 1920, height: 1080, close() {} } }; }
  });
  // frame 45 is drawn a first time as GPU (gpu-45), then, once the browser has fallen back to software, always as soft-45
  let draws45 = 0;
  const transient = await runCheck(host((n) => { if (n !== 45) return `det-${n}`; draws45++; return draws45 === 1 ? "gpu-45" : "soft-45"; }), manifest);
  assert.deepEqual(transient, { ok: true }, "a one-off change that then settles is not the scene's fault");
  // a scene that really disagrees with itself every time is still a code failure
  let rand = 0;
  const real = await runCheck(host((n) => (n === 45 ? `rand-${++rand}` : `det-${n}`)), manifest);
  assert.equal(real.ok, false);
  assert.equal(real.kind, "code");
  assert.match(real.error, /Non-deterministic draw on frame 45/);
});

test("isSlowScene pure classifier: thresholds (60ms median / 80ms p90), >=5 alone samples, contended samples (>2x threshold), single outlier, and first-frame strip", () => {
  assert.equal(SLOW_DRAW_MEDIAN_MS, 60);
  assert.equal(SLOW_DRAW_P90_MS, 80);

  // 1. Boundary cases (at least 5 alone samples)
  assert.deepEqual(isSlowScene([20, 22, 24, 21, 23, 22, 25, 21]), {
    slow: false,
    median: 22,
    p90: 25,
    n: 8
  });
  // Exactly on threshold (60 median, 80 p90) -> not slow
  assert.deepEqual(isSlowScene([55, 60, 60, 60, 60, 60, 60, 80]), {
    slow: false,
    median: 60,
    p90: 80,
    n: 8
  });
  // Just above median threshold (61 median, 70 p90) -> slow
  assert.deepEqual(isSlowScene([58, 60, 61, 61, 61, 62, 65, 70]), {
    slow: true,
    median: 61,
    p90: 70,
    n: 8
  });
  // Fast median (25ms) but p90 > 80ms (e.g. 2 spikes at 95ms out of 10 samples -> p90 index 8 is 95ms) -> slow
  assert.deepEqual(isSlowScene([20, 22, 24, 25, 25, 26, 28, 30, 95, 110]), {
    slow: true,
    median: 25.5,
    p90: 95,
    n: 10
  });

  // 2. Single outlier out of 10 samples: 9 fast samples (~20ms) and 1 single spike (150ms):
  // ceil(10 * 0.9) - 1 = index 8 -> 9th sorted sample is 24ms (<= 80ms), median is 22ms (<= 60ms) -> NOT slow!
  const oneOutlier = isSlowScene([20, 21, 22, 22, 22, 23, 23, 24, 24, 150]);
  assert.equal(oneOutlier.slow, false, "single outlier in 10 samples does not exceed p90 or median");
  assert.equal(oneOutlier.median, 22.5);
  assert.equal(oneOutlier.p90, 24);
  assert.equal(oneOutlier.n, 10);

  // 3. Few samples (< 5 alone samples and no contended samples) -> never marked slow
  assert.deepEqual(isSlowScene([]), { slow: false, median: 0, p90: 0, n: 0 });
  assert.deepEqual(isSlowScene([200]), { slow: false, median: 200, p90: 200, n: 1 });
  assert.deepEqual(isSlowScene([180, 190, 210, 220]), {
    slow: false,
    median: 200,
    p90: 220,
    n: 4
  });

  // 4. Contended samples only: does NOT mark slow unless median > 2x threshold (> 120ms)
  const contendedBusyFast = isSlowScene([], {
    contendedSamplesMs: [85, 90, 95, 100, 110, 115, 120, 120]
  });
  assert.equal(contendedBusyFast.slow, false, "contended median <= 120ms is not marked slow");
  assert.equal(contendedBusyFast.n, 8);

  const contendedVerySlow = isSlowScene([], {
    contendedSamplesMs: [130, 140, 150, 160, 170, 180, 190, 200]
  });
  assert.equal(contendedVerySlow.slow, true, "contended median > 2x threshold (165ms > 120ms) is marked slow");

  // When >= 5 alone samples exist, alone samples are authoritative over contended samples
  const aloneWins = isSlowScene([20, 22, 24, 25, 26], {
    contendedSamplesMs: [180, 190, 200, 210, 220, 230]
  });
  assert.equal(aloneWins.slow, false);
  assert.equal(aloneWins.median, 24);

  // 5. stripFirst option ignores a slow first shader-compile sample
  const withSlowFirst = isSlowScene([350, 20, 22, 21, 23, 24, 22, 25, 21], { stripFirst: true });
  assert.equal(withSlowFirst.slow, false, "slow first sample is ignored when stripFirst is true");
  assert.equal(withSlowFirst.n, 8);
});

test("runCheck with previewScale draws >= 8 sample frames across first/middle/last thirds, ignores first sample, and always reports ok:true with drawMs { medianMs, p90Ms } for server decision", async () => {
  const manifest = { width: 1920, height: 1080, fps: 30, frames: 120 };
  const samples = buildCheckSampleFrames(120, 8);
  assert.ok(samples.length >= 8);
  assert.ok(samples[0] < 40, "includes first third");
  assert.ok(samples.some((f) => f >= 40 && f < 80), "includes middle third");
  assert.equal(samples.at(-1), 119, "includes last third end");

  // 1. Fast scene with a slow first preview draw (300ms shader compile on first preview sample, then 22ms/frame) -> ok: true with drawMs
  let previewDrawsFast = 0;
  let lastInitScale = 1;
  const fastHost = {
    async init(opts) {
      lastInitScale = opts?.scale ?? 1;
      return { w: Math.round(1920 * lastInitScale), h: Math.round(1080 * lastInitScale), meta: { W: 1920, H: 1080, fps: 30, durationFrames: 120 } };
    },
    async frame(n) {
      const isPreview = lastInitScale < 1;
      if (isPreview) previewDrawsFast++;
      const drawMs = isPreview ? (previewDrawsFast === 1 ? 300 : 22) : 12;
      return {
        n,
        drawMs,
        hash: `fast-${n}`,
        bitmap: { width: 640, height: 360, close() {} }
      };
    }
  };

  const fastOut = await runCheck(fastHost, manifest, { previewScale: 640 / 1920 });
  assert.equal(fastOut.ok, true, "slow first draw is ignored; fast scene passes check");
  assert.equal(fastOut.results?.drawMsMedian, 22);
  assert.deepEqual(fastOut.drawMs, { medianMs: 22, p90Ms: 22 });

  // 2. Slow scene (Crayon scene 2: ~180ms median, 240ms p90) -> ok: true with drawMs: { medianMs: 180, p90Ms: 240 } (server decides slow)
  const slowTimings = [280, 145, 160, 175, 180, 185, 210, 240, 250];
  let previewDrawsSlow = 0;
  let scaleSlow = 1;
  let evalCallbackInfo = null;
  const slowHost = {
    async init(opts) {
      scaleSlow = opts?.scale ?? 1;
      return { w: Math.round(1920 * scaleSlow), h: Math.round(1080 * scaleSlow), meta: { W: 1920, H: 1080, fps: 30, durationFrames: 120 } };
    },
    async frame(n) {
      const isPreview = scaleSlow < 1;
      const drawMs = isPreview ? (slowTimings[previewDrawsSlow++] ?? 180) : 15;
      return {
        n,
        drawMs,
        hash: `slow-${n}`,
        bitmap: { width: 640, height: 360, close() {} }
      };
    }
  };

  const slowOut = await runCheck(slowHost, manifest, {
    previewScale: 640 / 1920,
    onSlowSceneEvaluated: (info) => {
      evalCallbackInfo = info;
    }
  });
  assert.equal(slowOut.ok, true, "slow scene reports ok: true with drawMs so the server makes the single slow decision");
  assert.equal(slowOut.results?.drawMsMedian, 180);
  assert.equal(slowOut.results?.drawMsP90, 240);
  assert.deepEqual(slowOut.drawMs, { medianMs: 180, p90Ms: 240 });
  assert.deepEqual(slowOut.results?.drawMs, { medianMs: 180, p90Ms: 240 });
  assert.equal(evalCallbackInfo?.slow, true);

  // 3. reportCheck sends { gen, bundleDigest, host: "worker", results: { ok: true, drawMs: { medianMs, p90Ms } } }
  //    and parses { state: "bundled", playback: "clip" } from the server response
  let sentBody = null;
  const checkRes = await reportCheck(
    "proj-slow",
    "var-slow",
    { gen: 1, bundleDigest: "dig-slow", results: slowOut },
    {
      fetch: async (_url, init) => {
        sentBody = JSON.parse(String(init?.body ?? "{}"));
        return new Response(JSON.stringify({ state: "bundled", playback: "clip" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
  );
  assert.equal(sentBody.host, "worker");
  assert.equal(sentBody.results.ok, true);
  assert.deepEqual(sentBody.results.drawMs, { medianMs: 180, p90Ms: 240 });
  assert.equal(checkRes.status, "ok");
  assert.equal(checkRes.state, "bundled");
  assert.equal(checkRes.playback, "clip");
});

test("runCheck relative watchdog, init timeout retry once, and hidden-tab inconclusive outcome", async (t) => {
  const manifest = { width: 1920, height: 1080, fps: 30, frames: 90 };
  const savedDoc = Object.getOwnPropertyDescriptor(globalThis, "document");
  t.after(() => {
    if (savedDoc) Object.defineProperty(globalThis, "document", savedDoc);
    else delete globalThis.document;
  });

  // 1. One or two over-budget (2.4 s) frames do NOT fail the check; N = 3 consecutive over-budget frames DO fail
  let frameCallA = 0;
  const twoSlowFramesHost = {
    async init() {
      return { w: 1920, h: 1080, meta: { W: 1920, H: 1080, fps: 30, durationFrames: 90 } };
    },
    async frame(n) {
      frameCallA++;
      // First 2 frames are 2400 ms (> 2000 ms budget), then 15 ms
      const drawMs = frameCallA <= 2 ? 2400 : 15;
      return {
        n,
        drawMs,
        hash: `h-${n}`,
        bitmap: { width: 1920, height: 1080, close() {} }
      };
    }
  };
  const twoSlowRes = await runCheck(twoSlowFramesHost, manifest, { frameWatchdogMs: 2000, watchdogMs: 10000 });
  assert.equal(twoSlowRes.ok, true, "2 consecutive over-budget frames (< N=3) do not fail runCheck");

  let frameCallB = 0;
  const threeConsecutiveSlowHost = {
    async init() {
      return { w: 1920, h: 1080, meta: { W: 1920, H: 1080, fps: 30, durationFrames: 90 } };
    },
    async frame(n) {
      frameCallB++;
      return {
        n,
        drawMs: 2200,
        hash: `h-${n}`,
        bitmap: { width: 1920, height: 1080, close() {} }
      };
    }
  };
  const threeSlowRes = await runCheck(threeConsecutiveSlowHost, manifest, { frameWatchdogMs: 2000, watchdogMs: 10000 });
  assert.equal(threeSlowRes.ok, false);
  assert.equal(threeSlowRes.kind, "env");
  assert.equal(frameCallB, 3, "fails after N = 3 consecutive over-budget frames");

  // 2. Init timeout gets ONE retry when visible the whole time
  let initCallsRecover = 0;
  const initRetryRecoverHost = {
    async init() {
      initCallsRecover++;
      if (initCallsRecover === 1) {
        throw new Error("Watchdog timeout (init-timeout) after 2000ms");
      }
      return { w: 1920, h: 1080, meta: { W: 1920, H: 1080, fps: 30, durationFrames: 90 } };
    },
    async frame(n) {
      return {
        n,
        drawMs: 14,
        hash: `h-${n}`,
        bitmap: { width: 1920, height: 1080, close() {} }
      };
    }
  };
  const initRecovered = await runCheck(initRetryRecoverHost, manifest);
  assert.equal(initRecovered.ok, true, "init timeout succeeds on its 1 retry while visible");
  assert.equal(initCallsRecover, 2, "init was called twice (1 initial + 1 retry)");

  let initCallsFail = 0;
  const initRetryExhaustedHost = {
    async init() {
      initCallsFail++;
      throw new Error("Watchdog timeout (init-timeout) after 2000ms");
    },
    async frame(n) {
      return { n, drawMs: 10, hash: `h-${n}`, bitmap: { width: 1920, height: 1080, close() {} } };
    }
  };
  const initExhausted = await runCheck(initRetryExhaustedHost, manifest);
  assert.equal(initExhausted.ok, false);
  assert.equal(initExhausted.kind, "env");
  assert.equal(initCallsFail, 2, "init timeout retried once (2 total calls) before reporting env failure");

  // 3. Hidden tab during check -> result is inconclusive (not env)
  Object.defineProperty(globalThis, "document", {
    value: { hidden: true, visibilityState: "hidden", addEventListener() {}, removeEventListener() {} },
    configurable: true,
    writable: true
  });
  const hiddenTimeoutRes = await runCheck(initRetryExhaustedHost, manifest);
  assert.equal(hiddenTimeoutRes.ok, false);
  assert.equal(hiddenTimeoutRes.kind, "inconclusive");
  assert.equal(hiddenTimeoutRes.inconclusive, true);

  // 4. Genuine env failure (no WebGL) still reports kind: "env" even when hidden
  const noWebglHost = {
    async init() {
      throw new Error("WebGL context creation failed: unsupported GPU");
    },
    async frame() {
      throw new Error("unreachable");
    }
  };
  const genuineEnvRes = await runCheck(noWebglHost, manifest);
  assert.equal(genuineEnvRes.ok, false);
  assert.equal(genuineEnvRes.kind, "env");
});
