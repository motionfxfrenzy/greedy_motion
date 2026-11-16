// Fast export (lib/live/browser-clips.ts) in plain Node: the scheduler (idle gating, pause while busy, one attempt per digest,
// a comment fix re-encodes only its scene, fallback when unsupported), and the encoder pipeline with a fake WebCodecs.
// The real encode runs in headless Chrome: test/live-browser-clips-chrome.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BrowserClipScheduler, encodeClip, pickEncoderConfig, frameTimestampUs, uploadOutcomeFor, browserClipNote, browserClipsSupported, H264_CODECS
} from "../lib/live/browser-clips.ts";

const target = (index, digest, frames = 3) => ({ index, variantId: `v${index}`, bundleDigest: digest, bundleFrames: frames, width: 8, height: 4, fps: 30, params: {}, bundleUrl: `https://x/${digest}` });

function harness({ targets, busy = () => false, canEncode = async () => true, upload, encodeFails = new Set() }) {
  let clock = 0;
  const events = [];
  const statuses = [];
  let list = targets;
  const cachedDigests = new Set();
  const s = new BrowserClipScheduler({
    now: () => clock,
    sleep: async (ms) => { clock += ms; await new Promise((r) => setImmediate(r)); },
    idleMs: 1000,
    pollMs: 5000,
    isBusy: () => busy(clock),
    canEncode,
    fetchTargets: async () => {
      events.push("list");
      const all = list();
      return { aspect: "16:9", enabled: true, total: all.length, cached: all.filter((t) => cachedDigests.has(t.bundleDigest)).length, targets: all.filter((t) => !cachedDigests.has(t.bundleDigest)) };
    },
    loadBundle: async (t) => `<html>${t.bundleDigest}</html>`,
    encode: async (t, _html, ctx) => {
      events.push(`encode:${t.bundleDigest}:start@${clock}`);
      for (let i = 0; i < t.bundleFrames; i++) { await ctx.gate(); clock += 10; }
      if (encodeFails.has(t.bundleDigest)) throw new Error("boom");
      events.push(`encode:${t.bundleDigest}:end@${clock}`);
      return new Uint8Array([1, 2, 3]);
    },
    upload: upload ?? (async (t) => { cachedDigests.add(t.bundleDigest); events.push(`upload:${t.bundleDigest}`); return "stored"; }),
    onStatus: (st) => statuses.push(st)
  });
  return { s, events, statuses, setList: (fn) => { list = fn; }, advance: (ms) => { clock += ms; }, get clock() { return clock; } };
}

const until = async (cond, n = 5000) => { for (let i = 0; i < n && !cond(); i++) await new Promise((r) => setImmediate(r)); assert.ok(cond(), "condition reached"); };

test("waits for idle, encodes each missing scene once, reports ready", async () => {
  const h = harness({ targets: () => [target(0, "A"), target(1, "B")], busy: (t) => t < 3000 });
  h.s.start();
  await until(() => h.statuses.some((st) => st.state === "ready"));
  h.s.stop();
  await h.s.done;
  const firstList = h.events.indexOf("list");
  assert.ok(firstList >= 0);
  assert.deepEqual(h.events.filter((e) => e.startsWith("upload")), ["upload:A", "upload:B"]);
  const start = Number(h.events.find((e) => e.startsWith("encode:A:start")).split("@")[1]);
  assert.ok(start >= 3900, `starts only after 1 s idle past the last busy sample (2900) (${start})`);
  const ready = h.statuses.find((st) => st.state === "ready");
  assert.deepEqual(ready, { state: "ready", done: 2, total: 2 });
  assert.equal(browserClipNote(ready), "Export ready");
  assert.equal(browserClipNote({ state: "preparing", done: 1, total: 3, scene: 1 }), "Preparing export… 1/3 scenes");
  assert.equal(browserClipNote({ state: "off" }), undefined);
});

test("a running encode pauses between frames while the user plays", async () => {
  // busy from t=5000 to 8000 while scene A (100 frames of 10 ms, starting ~1000) is being encoded
  const h = harness({ targets: () => [target(0, "A", 100)], busy: (t) => t >= 1500 && t < 3000 });
  h.s.start();
  await until(() => h.events.some((e) => e.startsWith("upload:A")));
  h.s.stop();
  await h.s.done;
  const start = Number(h.events.find((e) => e.startsWith("encode:A:start")).split("@")[1]);
  const end = Number(h.events.find((e) => e.startsWith("encode:A:end")).split("@")[1]);
  assert.ok(end - start >= 100 * 10 + 1000, `the encode held through the busy period (${start} -> ${end})`);
});

test("a comment fix re-encodes only the changed scene; a failed scene is not retried", async () => {
  const h = harness({ targets: () => [target(0, "A"), target(1, "B"), target(2, "C")], encodeFails: new Set(["C"]) });
  h.s.start();
  await until(() => h.events.includes("upload:B") && h.events.filter((e) => e === "list").length >= 2);
  h.setList(() => [target(0, "A"), target(1, "B2"), target(2, "C")]); // the fix changed scene 1's digest
  h.s.poke();
  await until(() => h.events.includes("upload:B2"));
  h.s.stop();
  await h.s.done;
  const encodes = h.events.filter((e) => e.includes(":start@")).map((e) => e.split(":")[1]);
  assert.deepEqual(encodes, ["A", "B", "C", "B2"], "A and B are not redrawn, the failed C is not retried, B2 is drawn");
});

test("falls back silently when this browser cannot encode H.264", async () => {
  const h = harness({ targets: () => [target(0, "A")], canEncode: async () => false });
  h.s.start();
  await h.s.done;
  assert.equal(h.events.filter((e) => e.startsWith("encode")).length, 0);
  assert.deepEqual(h.statuses.at(-1), { state: "off" });
});

test("server says browser clips are off: the scheduler stops", async () => {
  const s = new BrowserClipScheduler({
    isBusy: () => false, idleMs: 0, sleep: async () => {}, canEncode: async () => true,
    fetchTargets: async () => ({ aspect: "16:9", enabled: false, total: 0, cached: 0, targets: [] }),
    loadBundle: async () => "", encode: async () => new Uint8Array(), upload: async () => "stored"
  });
  s.start();
  await s.done;
  assert.equal(s.attemptedDigests.size, 0);
});

test("upload outcomes", () => {
  assert.equal(uploadOutcomeFor(201, {}), "stored");
  assert.equal(uploadOutcomeFor(200, { duplicate: true }), "duplicate");
  assert.equal(uploadOutcomeFor(429, null), "limited");
  assert.equal(uploadOutcomeFor(409, { error: { code: "stale_scene" } }), "stale");
  assert.equal(uploadOutcomeFor(422, { error: { code: "invalid_clip" } }), "rejected");
  assert.equal(uploadOutcomeFor(502, null), "error");
});

test("encoder config: first supported H.264 profile, none in Node", async () => {
  assert.equal(await pickEncoderConfig(1080, 1920, 30, undefined), null);
  const seen = [];
  const cfg = await pickEncoderConfig(1080, 1920, 30, async (c) => { seen.push(c.codec); return { supported: c.codec === "avc1.42e028" }; });
  assert.equal(cfg.codec, "avc1.42e028");
  assert.deepEqual(seen, H264_CODECS.slice(0, 3));
  assert.equal(cfg.avc.format, "avc");
  assert.equal(cfg.framerate, 30);
  assert.equal(browserClipsSupported({}), false);
});

test("encodeClip: frame i at timestamp i/30 s, keyframe every second, bitmaps closed, chunks muxed", async () => {
  const encoded = [], muxed = [], closedBitmaps = [], closedFrames = [];
  class FakeEncoder {
    constructor(init) { this.init = init; this.state = "unconfigured"; this.encodeQueueSize = 0; }
    configure(c) { this.config = c; this.state = "configured"; }
    encode(frame, opts) { encoded.push({ ts: frame.timestamp, dur: frame.duration, key: opts.keyFrame }); this.init.output({ timestamp: frame.timestamp, type: opts.keyFrame ? "key" : "delta" }, {}); }
    async flush() {}
    close() { this.state = "closed"; }
  }
  class FakeFrame { constructor(src, init) { this.src = src; this.timestamp = init.timestamp; this.duration = init.duration; } close() { closedFrames.push(this.timestamp); } }
  const api = { VideoEncoder: FakeEncoder, VideoFrame: FakeFrame, createMuxer: () => ({ addVideoChunk: (c) => muxed.push(c.timestamp), finalize: () => new Uint8Array([9, 9]) }) };
  const drawn = [];
  const res = await encodeClip({
    frames: 61, width: 8, height: 4, config: { codec: "avc1.640028" }, api,
    drawFrame: async (i) => { drawn.push(i); return { width: 8, height: 4, close: () => closedBitmaps.push(i) }; }
  });
  assert.deepEqual(drawn, Array.from({ length: 61 }, (_, i) => i), "frames 0..n-1 in order");
  assert.equal(closedBitmaps.length, 61);
  assert.equal(closedFrames.length, 61);
  assert.deepEqual(encoded.filter((e) => e.key).map((e) => e.ts), [0, frameTimestampUs(30, 30), frameTimestampUs(60, 30)]);
  assert.equal(encoded[1].ts, 33333);
  assert.equal(encoded[2].ts, 66667);
  assert.ok(encoded.every((e) => e.dur === 33333 || e.dur === 33334));
  assert.equal(muxed.length, 61);
  assert.deepEqual([...res.bytes], [9, 9]);

  // wrong frame size: fails (the worker draws the scene) and closes the encoder
  await assert.rejects(() => encodeClip({ frames: 2, width: 8, height: 4, config: { codec: "x" }, api, drawFrame: async () => ({ width: 4, height: 4, close() {} }) }), /expected 8x4/);
  // abort mid-way
  const ac = new AbortController();
  await assert.rejects(() => encodeClip({ frames: 10, width: 8, height: 4, config: { codec: "x" }, api, signal: ac.signal, drawFrame: async (i) => { if (i === 3) ac.abort(new Error("tab closed")); return { width: 8, height: 4, close() {} }; } }), /tab closed/);
});
