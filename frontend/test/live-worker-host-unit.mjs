import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOOTSTRAP_CSP,
  WorkerHost,
  buildBootstrapSrcdoc,
  buildWorkerSource,
  canonicalJson
} from "../lib/live/worker-host.ts";

function createFakeClock() {
  let nowMs = 0;
  let nextId = 1;
  const timers = new Map();

  const advance = async (deltaMs) => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
    const target = nowMs + deltaMs;
    while (true) {
      let earliest = null;
      for (const t of timers.values()) {
        if (t.due <= target && (!earliest || t.due < earliest.due)) {
          earliest = t;
        }
      }
      if (!earliest) break;
      nowMs = earliest.due;
      if (earliest.interval !== null) {
        earliest.due = nowMs + earliest.interval;
      } else {
        timers.delete(earliest.id);
      }
      earliest.fn();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    }
    nowMs = target;
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };

  return {
    now: () => nowMs,
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { id, fn, due: nowMs + ms, interval: null });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval(fn, ms) {
      const id = nextId++;
      timers.set(id, { id, fn, due: nowMs + ms, interval: ms });
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
    },
    advance,
    activeTimerCount: () => timers.size
  };
}

function makeBitmap(w = 10, h = 10) {
  return {
    width: w,
    height: h,
    closed: false,
    close() {
      this.closed = true;
    }
  };
}

test("bootstrap srcdoc and worker source include CSP and canonical self.__PARAMS__", () => {
  const srcdoc = buildBootstrapSrcdoc();
  assert.ok(srcdoc.includes(BOOTSTRAP_CSP));
  assert.ok(srcdoc.includes("connect-src 'none'"));
  assert.ok(srcdoc.includes("worker-src blob:"));

  const src = buildWorkerSource("<script>window.FILM={};</script>", { b: 2, a: 1 });
  assert.ok(src.includes('self.__PARAMS__ = {"a":1,"b":2};'));
  assert.equal(canonicalJson({ z: [1, { y: 2, x: 1 }], a: "ok" }), '{"a":"ok","z":[1,{"x":1,"y":2}]}');
});

test("protocol: request/response ids correlate out-of-order replies, timeouts reject, and dispose cleans up", async () => {
  const clock = createFakeClock();
  const received = [];
  const bitmaps = [];
  let terminated = 0;

  const host = new WorkerHost({
    html: "<script>window.FILM={};</script>",
    params: { sky: "#123456" },
    clock,
    transportFactory: async () => {
      const port = {
        onmessage: null,
        postMessage(msg) {
          received.push(msg);
          if (msg.t === "init") {
            port.onmessage?.({
              data: { t: "init", id: msg.id, w: 10, h: 10, meta: { W: 10, H: 10, fps: 30, durationFrames: 90 } }
            });
          } else if (msg.t === "hb") {
            port.onmessage?.({ data: { t: "hb", id: msg.id } });
          } else if (msg.t === "frame") {
            const bm = makeBitmap(10, 10);
            bitmaps.push(bm);
            // Delay frame 1 so frame 2 answers first (out-of-order id correlation)
            const delay = msg.n === 1 ? 50 : 10;
            clock.setTimeout(() => {
              port.onmessage?.({ data: { t: "frame", id: msg.id, n: msg.n, bitmap: bm, drawMs: delay } });
            }, delay);
          }
        }
      };
      return {
        port,
        terminate() {
          terminated++;
        }
      };
    }
  });

  const initRes = await host.init({ scale: 0.5 });
  assert.equal(initRes.w, 10);
  assert.equal(initRes.meta.fps, 30);

  const p1 = host.frame(1);
  const p2 = host.frame(2);
  await clock.advance(10);
  const r2 = await p2;
  assert.equal(r2.n, 2);
  await clock.advance(40);
  const r1 = await p1;
  assert.equal(r1.n, 1);

  assert.equal(received[0].t, "init");
  assert.ok(received.every((m) => typeof m.id === "number" && m.id > 0));

  host.destroy();
  assert.equal(terminated, 1);
  assert.ok(bitmaps.every((b) => b.closed), "destroy closes all held bitmaps");
  assert.equal(clock.activeTimerCount(), 0, "destroy clears all timers");
});

test("watchdog: missed heartbeat terminates and recreates the Worker; two terminations mark the host unhealthy", async () => {
  const clock = createFakeClock();
  let spawns = 0;
  let terminations = 0;
  let dropHeartbeats = true;
  const unhealthyReasons = [];

  const host = new WorkerHost({
    html: "<script>window.FILM={};</script>",
    clock,
    watchdogMs: 2_000,
    heartbeatIntervalMs: 500,
    onUnhealthy: (r) => unhealthyReasons.push(r),
    transportFactory: async () => {
      spawns++;
      const port = {
        onmessage: null,
        postMessage(msg) {
          if (msg.t === "init") {
            port.onmessage?.({
              data: { t: "init", id: msg.id, w: 10, h: 10, meta: { W: 10, H: 10, fps: 30, durationFrames: 90 } }
            });
          } else if (msg.t === "hb") {
            if (!dropHeartbeats) {
              port.onmessage?.({ data: { t: "hb", id: msg.id } });
            }
          } else if (msg.t === "frame") {
            port.onmessage?.({
              data: { t: "frame", id: msg.id, n: msg.n, bitmap: makeBitmap(10, 10), drawMs: 5 }
            });
          }
        }
      };
      return {
        port,
        terminate() {
          terminations++;
        }
      };
    }
  });

  await host.init({ scale: 1 });
  assert.equal(spawns, 1);
  assert.equal(host.unhealthy, false);

  // First missed heartbeat (500ms interval + 2000ms timeout = 2500ms) -> terminates Worker #1 and recreates Worker #2
  await clock.advance(2_600);
  assert.equal(terminations, 1, "first missed heartbeat terminates Worker #1");
  assert.equal(spawns, 2, "Worker #2 is automatically recreated and re-initialised");
  assert.equal(host.unhealthy, false, "still healthy after 1 termination");

  // Worker #2 can still draw if it responds, or if it also misses heartbeats for 2s -> 2nd termination marks unhealthy
  await clock.advance(2_600);
  assert.equal(terminations, 2, "second missed heartbeat terminates Worker #2");
  assert.equal(host.unhealthy, true, "marked unhealthy after two terminations");
  assert.equal(unhealthyReasons.length, 1);
  await assert.rejects(() => host.frame(0), /unhealthy/);

  host.destroy();
});

test("60 s Worker lifetime recycle counts buffering, scrubbing, and playing time using a fake clock", async () => {
  const clock = createFakeClock();
  let spawns = 0;
  let terminations = 0;
  const recycleEvents = [];

  const host = new WorkerHost({
    html: "<script>window.FILM={};</script>",
    clock,
    lifetimeMs: 60_000,
    onRecycle: (reason, count) => recycleEvents.push({ reason, count }),
    transportFactory: async () => {
      spawns++;
      const port = {
        onmessage: null,
        postMessage(msg) {
          if (msg.t === "init") {
            port.onmessage?.({
              data: { t: "init", id: msg.id, w: 10, h: 10, meta: { W: 10, H: 10, fps: 30, durationFrames: 90 } }
            });
          } else if (msg.t === "hb") {
            port.onmessage?.({ data: { t: "hb", id: msg.id } });
          } else if (msg.t === "frame") {
            port.onmessage?.({
              data: { t: "frame", id: msg.id, n: msg.n, bitmap: makeBitmap(10, 10), drawMs: 8 }
            });
          }
        }
      };
      return {
        port,
        terminate() {
          terminations++;
        }
      };
    }
  });

  await host.init({ scale: 1 });
  assert.equal(spawns, 1);

  // Simulate 25 s of buffering ahead
  await clock.advance(25_000);
  await host.frame(10);
  assert.equal(spawns, 1);

  // Simulate 20 s of scrubbing (total alive = 45 s)
  await clock.advance(20_000);
  await host.frame(40);
  assert.equal(spawns, 1);

  // Simulate another 15 s (total alive = 60 s) -> triggers 60 s lifetime recycle!
  await clock.advance(15_000);
  assert.equal(spawns, 2, "Worker is recycled at 60 s of total alive time");
  assert.equal(terminations, 1);
  assert.equal(host.terminations, 0, "planned 60 s recycle does not count as a watchdog failure");
  assert.equal(host.unhealthy, false);
  assert.deepEqual(recycleEvents[0], { reason: "lifetime", count: 1 });

  // Also verify explicit scene-boundary recycle
  await host.recycle("scene-boundary");
  assert.equal(spawns, 3);
  assert.deepEqual(recycleEvents[1], { reason: "scene-boundary", count: 2 });

  host.destroy();
});

test("host-side byte-budget enforcement and bitmap.close() on replacement, eviction, oversize refusal, and destroy", async () => {
  const clock = createFakeClock();
  const created = new Map();

  // Each 10x10 frame is 10 * 10 * 4 = 400 bytes. Budget of 1200 bytes holds at most 3 frames.
  const host = new WorkerHost({
    html: "<script>window.FILM={};</script>",
    budgetBytes: 1_200,
    clock,
    transportFactory: async () => {
      const port = {
        onmessage: null,
        postMessage(msg) {
          if (msg.t === "init") {
            port.onmessage?.({
              data: { t: "init", id: msg.id, w: 10, h: 10, meta: { W: 10, H: 10, fps: 30, durationFrames: 90 } }
            });
          } else if (msg.t === "hb") {
            port.onmessage?.({ data: { t: "hb", id: msg.id } });
          } else if (msg.t === "frame") {
            const bm = msg.n === 999 ? makeBitmap(100, 100) : makeBitmap(10, 10);
            created.set(`${msg.n}:${created.size}`, bm);
            port.onmessage?.({
              data: { t: "frame", id: msg.id, n: msg.n, bitmap: bm, drawMs: 5 }
            });
          }
        }
      };
      return { port, terminate() {} };
    }
  });

  await host.init({ scale: 1 });

  const f0a = await host.frame(0);
  const f1 = await host.frame(1);
  const f2 = await host.frame(2);
  assert.equal(host.bytes, 1_200);

  // Replacement path: redrawing frame 0 closes the old bitmap for frame 0 and keeps bytes at 1200
  const raw0a = created.get("0:0");
  const f0b = await host.frame(0);
  assert.equal(raw0a.closed, true, "replaced bitmap is closed");
  assert.equal(host.bytes, 1_200);

  // Capacity eviction path: drawing frame 3 evicts the oldest held frame (frame 1) and closes its bitmap
  const raw1 = created.get("1:1");
  const f3 = await host.frame(3);
  assert.equal(raw1.closed, true, "evicted bitmap is closed when budget is reached");
  assert.ok(host.bytes <= 1_200, `host.bytes (${host.bytes}) must stay <= 1200`);

  // Explicit eviction path
  const raw2 = created.get("2:2");
  host.evictFrame(2);
  assert.equal(raw2.closed, true, "evictFrame closes the bitmap");
  assert.equal(host.bytes, 800);

  // Oversize frame refusal path (100x100x4 = 40,000 bytes > 1,200 budget)
  await assert.rejects(() => host.frame(999), /exceeds host byte budget/);
  const raw999 = [...created.entries()].find(([k]) => k.startsWith("999:"))?.[1];
  assert.equal(raw999.closed, true, "oversize bitmap is closed immediately when refused");
  assert.equal(host.bytes, 800);

  // Destroy path closes all remaining held bitmaps (f0b and f3)
  host.destroy();
  assert.equal(host.bytes, 0);
  for (const bm of created.values()) {
    assert.equal(bm.closed, true, "every created bitmap is closed after destroy()");
  }
  void f0a; void f1; void f2; void f0b; void f3;
});
