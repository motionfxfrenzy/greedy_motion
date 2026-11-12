// Unit tests for plate prompt-cache gate, shared-prefix cacheKey, and anthropicStream onStart hook (no database, no network).
// Run: node backend/test/cache-gate.mjs
import assert from "node:assert/strict";

process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";

const { anthropicStream, responseText } = await import("../src/anthropic.ts");
const { DEFAULT_CACHE_TTL_MS, DEFAULT_WARM_TIMEOUT_MS, createCacheGate, plateCacheGate } = await import("../src/plates/cache-gate.ts");
const { buildAuthorMessages, cacheKeyFor, kitModulesFor, lookForPlateName } = await import("../src/plates/prompt.ts");

function makeSseResponse(chunks, status = 200) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });
  return new Response(stream, {
    status,
    headers: { "content-type": "text/event-stream; charset=utf-8" }
  });
}

// ============================================================================
// 1. 7 concurrent acquire calls with the same key:
//    - exactly one "warmer" proceeds immediately
//    - the other 6 stay pending until started()
//    - all 6 proceed within the same tick (no serial delay), roles "follower" or "open"
//    - total delay of the film = time to started() only (3 s, not the 90 s the warmer spends generating)
//    - subsequent calls within ttlMs return role "open" immediately
// ============================================================================
{
  let fakeNow = 100_000;
  const gate = createCacheGate({
    now: () => fakeNow,
    warmTimeoutMs: 20_000,
    ttlMs: 240_000
  });

  const resolved = [];
  const promises = [];
  for (let i = 0; i < 7; i++) {
    const idx = i;
    const p = gate.acquire("film-paper-key").then((lease) => {
      resolved.push({ idx, at: fakeNow, lease });
      return lease;
    });
    promises.push(p);
  }

  // Flush microtasks at t = 100_000
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(resolved.length, 1, "exactly one caller proceeds immediately");
  assert.equal(resolved[0].idx, 0);
  assert.equal(resolved[0].lease.role, "warmer");
  assert.equal(resolved[0].at, 100_000);

  // Advance clock by 2_000 ms (before message_start): the 6 followers must still be waiting
  fakeNow += 2_000;
  await Promise.resolve();
  assert.equal(resolved.length, 1, "other 6 callers remain pending before started()");

  // At t = +3_000 ms (3 s after request sent), SSE message_start arrives -> warmer calls started()
  fakeNow += 1_000;
  const warmerLease = resolved[0].lease;
  warmerLease.started();

  // Within the very same tick, all 6 waiting callers resolve in parallel
  const allLeases = await Promise.all(promises);
  assert.equal(resolved.length, 7, "all 7 callers resolved once started() is called");

  const followers = resolved.slice(1);
  assert.equal(followers.length, 6);
  for (const f of followers) {
    assert.ok(f.lease.role === "follower" || f.lease.role === "open", `expected follower/open role, got ${f.lease.role}`);
    assert.equal(f.at, 103_000, "all 6 followers proceed at the exact started() timestamp (3 s delay)");
  }

  // Simulate each of the 7 scenes taking 90 s to generate after starting:
  // Warmer started at 100_000 -> finishes at 190_000 (90 s).
  // Followers started at 103_000 (after 3 s warm wait) -> finish at 193_000 (90 s generation).
  // Total film wall time = 93 s (3 s gate delay), NOT 90 s + 90 s = 180 s!
  const generationDurationMs = 90_000;
  const warmerFinishAt = resolved[0].at + generationDurationMs;
  const followerFinishAt = Math.max(...followers.map((f) => f.at + generationDurationMs));
  const totalFilmDelayMs = followerFinishAt - warmerFinishAt;
  assert.equal(totalFilmDelayMs, 3_000, "total delay of the film is time to started() only (3 s), not 90 s");

  // Warmer finishes at t = 190_000 and calls done()
  fakeNow = warmerFinishAt;
  warmerLease.done();
  for (const l of allLeases.slice(1)) {
    l.started();
    l.done();
  }

  // Repairs and revisions within ttlMs get role "open" immediately without waiting
  const repairLease = await gate.acquire("film-paper-key");
  assert.equal(repairLease.role, "open", "repair/revision within ttlMs gets role 'open' immediately");
}

// ============================================================================
// 2. Different keys never block each other
// ============================================================================
{
  let fakeNow = 200_000;
  const gate = createCacheGate({ now: () => fakeNow });

  const events = [];
  const pA1 = gate.acquire("key-A").then((l) => { events.push(["A1", l.role, fakeNow]); return l; });
  const pA2 = gate.acquire("key-A").then((l) => { events.push(["A2", l.role, fakeNow]); return l; });
  const pB1 = gate.acquire("key-B").then((l) => { events.push(["B1", l.role, fakeNow]); return l; });
  const pB2 = gate.acquire("key-B").then((l) => { events.push(["B2", l.role, fakeNow]); return l; });

  await Promise.resolve();
  await Promise.resolve();

  // Both A1 and B1 proceed immediately as warmers; A2 and B2 wait on their respective keys only
  assert.deepEqual(events, [
    ["A1", "warmer", 200_000],
    ["B1", "warmer", 200_000]
  ]);

  fakeNow += 1_500;
  const leaseB1 = await pB1;
  leaseB1.started();
  await pB2;

  assert.deepEqual(events, [
    ["A1", "warmer", 200_000],
    ["B1", "warmer", 200_000],
    ["B2", "follower", 201_500]
  ], "starting key-B unblocks B2 while A2 still waits on key-A");

  fakeNow += 1_000;
  const leaseA1 = await pA1;
  leaseA1.started();
  await pA2;

  assert.deepEqual(events[3], ["A2", "follower", 202_500]);
  leaseA1.done();
  leaseB1.done();
}

// ============================================================================
// 3. Warmer fails before started() (done() without start):
//    - the next waiting caller becomes the warmer
//    - the rest keep waiting for the new warmer, never deadlock
//    Warmer hangs:
//    - followers proceed after warmTimeoutMs (and never throw)
// ============================================================================
{
  let fakeNow = 300_000;
  const gate = createCacheGate({
    now: () => fakeNow,
    warmTimeoutMs: 20_000,
    ttlMs: 240_000
  });

  const resolved = [];
  const c1 = gate.acquire("fail-key").then((l) => { resolved.push({ id: 1, role: l.role, at: fakeNow, lease: l }); return l; });
  const c2 = gate.acquire("fail-key").then((l) => { resolved.push({ id: 2, role: l.role, at: fakeNow, lease: l }); return l; });
  const c3 = gate.acquire("fail-key").then((l) => { resolved.push({ id: 3, role: l.role, at: fakeNow, lease: l }); return l; });
  const c4 = gate.acquire("fail-key").then((l) => { resolved.push({ id: 4, role: l.role, at: fakeNow, lease: l }); return l; });

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].id, 1);
  assert.equal(resolved[0].role, "warmer");

  // c1 fails at +1_200 ms before message_start -> calls done() without started()
  fakeNow += 1_200;
  resolved[0].lease.done();
  // Calling done() a second time must be a safe no-op and not disturb the newly promoted warmer
  resolved[0].lease.done();

  await Promise.resolve();
  await Promise.resolve();

  // Only c2 is promoted to warmer; c3 and c4 keep waiting for c2
  assert.equal(resolved.length, 2, "next waiting caller promoted to warmer; others still waiting");
  assert.equal(resolved[1].id, 2);
  assert.equal(resolved[1].role, "warmer");
  assert.equal(resolved[1].at, 301_200);

  // Suppose c2 ALSO fails before started() at +800 ms
  fakeNow += 800;
  resolved[1].lease.done();

  await Promise.resolve();
  await Promise.resolve();

  // c3 is promoted to warmer; c4 still waits for c3
  assert.equal(resolved.length, 3, "third caller promoted after second warmer also failed");
  assert.equal(resolved[2].id, 3);
  assert.equal(resolved[2].role, "warmer");
  assert.equal(resolved[2].at, 302_000);

  // c3 succeeds and sees message_start at +2_000 ms -> c4 proceeds as follower
  fakeNow += 2_000;
  resolved[2].lease.started();

  await Promise.all([c1, c2, c3, c4]);
  assert.equal(resolved.length, 4);
  assert.equal(resolved[3].id, 4);
  assert.equal(resolved[3].role, "follower");
  assert.equal(resolved[3].at, 304_000);
  resolved[2].lease.done();
}

// Warmer hangs past warmTimeoutMs: followers proceed after warmTimeoutMs and never throw
{
  let fakeNow = 400_000;
  const shortTimeoutMs = 40;
  const gate = createCacheGate({
    now: () => fakeNow,
    warmTimeoutMs: shortTimeoutMs,
    ttlMs: 240_000
  });

  const w = await gate.acquire("hang-key");
  assert.equal(w.role, "warmer");

  const f1Promise = gate.acquire("hang-key");
  const f2Promise = gate.acquire("hang-key");
  const f3Promise = gate.acquire("hang-key");

  // Wait for warmTimeoutMs to elapse while w hangs (calls neither started() nor done())
  await new Promise((r) => setTimeout(() => { fakeNow += shortTimeoutMs; r(); }, shortTimeoutMs + 25));

  const [f1, f2, f3] = await Promise.all([f1Promise, f2Promise, f3Promise]);
  assert.equal(f1.role, "follower");
  assert.equal(f2.role, "follower");
  assert.equal(f3.role, "follower");

  // Even if the hung warmer calls done() or started() much later, it does not throw
  w.done();
  w.started();
}

// ============================================================================
// 4. Caller whose signal aborts while waiting proceeds/returns without throwing
//    and without blocking others
// ============================================================================
{
  let fakeNow = 500_000;
  const gate = createCacheGate({ now: () => fakeNow, warmTimeoutMs: 20_000, ttlMs: 240_000 });

  const warmer = await gate.acquire("abort-key");
  assert.equal(warmer.role, "warmer");

  const abortCtrl = new AbortController();
  const resolvedOrder = [];

  const waiter1 = gate.acquire("abort-key").then((l) => { resolvedOrder.push(["w1", l.role, fakeNow]); return l; });
  const waiterAborted = gate.acquire("abort-key", abortCtrl.signal).then((l) => { resolvedOrder.push(["wAbort", l.role, fakeNow]); return l; });
  const waiter2 = gate.acquire("abort-key").then((l) => { resolvedOrder.push(["w2", l.role, fakeNow]); return l; });

  await Promise.resolve();
  assert.equal(resolvedOrder.length, 0);

  // Abort waiterAborted at +500 ms while warmer is still pending
  fakeNow += 500;
  abortCtrl.abort(new Error("user_cancelled"));

  const abortedLease = await waiterAborted;
  assert.equal(abortedLease.role, "follower", "aborted waiter resolves without throwing");
  assert.deepEqual(resolvedOrder, [["wAbort", "follower", 500_500]], "only the aborted waiter resolved; others still wait");

  // Pre-aborted signal also returns immediately without throwing or blocking
  const preAbortedLease = await gate.acquire("abort-key", abortCtrl.signal);
  assert.equal(preAbortedLease.role, "follower");

  // Warmer starts at +2_500 ms: waiter1 and waiter2 proceed normally
  fakeNow += 2_000;
  warmer.started();
  await Promise.all([waiter1, waiter2]);

  assert.deepEqual(resolvedOrder, [
    ["wAbort", "follower", 500_500],
    ["w1", "follower", 502_500],
    ["w2", "follower", 502_500]
  ]);
  warmer.done();
}

// ============================================================================
// 5. After ttlMs a new warmer is elected
// ============================================================================
{
  let fakeNow = 600_000;
  const ttlMs = 240_000;
  const gate = createCacheGate({ now: () => fakeNow, warmTimeoutMs: 20_000, ttlMs });

  const w1 = await gate.acquire("ttl-key");
  assert.equal(w1.role, "warmer");

  fakeNow += 3_000;
  w1.started();
  w1.done();

  // Just before ttlMs expires (at start + ttlMs - 1)
  fakeNow = 603_000 + ttlMs - 1;
  const stillWarm = await gate.acquire("ttl-key");
  assert.equal(stillWarm.role, "open", "entry is still warm 1 ms before ttlMs expires");

  // Exactly at start + ttlMs: entry has expired -> new warmer elected
  fakeNow = 603_000 + ttlMs;
  const w2 = await gate.acquire("ttl-key");
  assert.equal(w2.role, "warmer", "new warmer is elected once ttlMs has elapsed");
  w2.started();
  w2.done();
}

// Also verify PLATE_CACHE_GATE=off bypasses waiting on the singleton
{
  const prev = process.env.PLATE_CACHE_GATE;
  try {
    process.env.PLATE_CACHE_GATE = "off";
    const l1 = await plateCacheGate.acquire("disabled-key");
    const l2 = await plateCacheGate.acquire("disabled-key");
    assert.equal(l1.role, "open");
    assert.equal(l2.role, "open");
  } finally {
    if (prev === undefined) delete process.env.PLATE_CACHE_GATE;
    else process.env.PLATE_CACHE_GATE = prev;
  }
  assert.equal(DEFAULT_WARM_TIMEOUT_MS, 20_000);
  assert.equal(DEFAULT_CACHE_TTL_MS, 240_000);
}

// ============================================================================
// 6. cacheKey is equal for two scenes of the same film/style and differs when
//    the cast note, style or kit changes
// ============================================================================
{
  const beats = [
    { keyword: "Wood chips", visual: "A friendly sheet of paper with simple eyes points at a pile of pine wood chips.", onScreen: null, line: "Paper begins as wood chips." },
    { keyword: "Pulp", visual: "The same paper character stirs a warm vat of watery wood pulp with a wooden paddle.", onScreen: null, line: "Water and heat turn chips into pulp." }
  ];

  const scene0 = await buildAuthorMessages({
    look: lookForPlateName("folkTale"),
    plateName: "folkTale",
    film: "How paper is made",
    beats,
    aspect: "16:9",
    index: 0,
    frames: 150
  });

  const scene1 = await buildAuthorMessages({
    look: lookForPlateName("folkTale"),
    plateName: "folkTale",
    film: "How paper is made",
    beats,
    aspect: "16:9",
    index: 1,
    frames: 210
  });

  assert.equal(typeof scene0.cacheKey, "string");
  assert.equal(scene0.cacheKey.length, 16);
  assert.equal(scene0.cacheKey, cacheKeyFor(scene0.messages[0].content[0].text));
  assert.equal(scene0.cacheKey, scene1.cacheKey, "cacheKey is identical across scenes of the same film and style");

  // Repair / revision of a scene shares the exact same cacheKey
  const scene1Repair = await buildAuthorMessages({
    look: lookForPlateName("folkTale"),
    plateName: "folkTale",
    film: "How paper is made",
    beats,
    aspect: "16:9",
    index: 1,
    frames: 210,
    error: "Compile failed",
    previous: "export const film = {};"
  });
  assert.equal(scene1Repair.cacheKey, scene0.cacheKey, "repair call shares the film's cacheKey");

  // Changing the cast note (beat visual/keyword) changes cacheKey
  const differentCastScene = await buildAuthorMessages({
    look: lookForPlateName("folkTale"),
    plateName: "folkTale",
    film: "How paper is made",
    beats: [
      beats[0],
      { ...beats[1], visual: "A brass press rolls a damp sheet flat." }
    ],
    aspect: "16:9",
    index: 0,
    frames: 150
  });
  assert.notEqual(differentCastScene.cacheKey, scene0.cacheKey, "cacheKey differs when the cast note changes");

  // Changing the style changes cacheKey
  const differentStyleScene = await buildAuthorMessages({
    look: lookForPlateName("koi"),
    plateName: "koi",
    film: "How paper is made",
    beats,
    aspect: "16:9",
    index: 0,
    frames: 150
  });
  assert.notEqual(differentStyleScene.cacheKey, scene0.cacheKey, "cacheKey differs when the style changes");

  // Changing the kit module content changes cacheKey (even with identical film, cast, and style)
  const originalKits = kitModulesFor("folkTale");
  const modifiedKits = originalKits.map((k, idx) =>
    idx === 0 ? { ...k, source: `${k.source}\nexport const extraHelper = () => {};` } : k
  );
  const differentKitScene = await buildAuthorMessages({
    look: lookForPlateName("folkTale"),
    plateName: "folkTale",
    film: "How paper is made",
    beats,
    aspect: "16:9",
    index: 0,
    frames: 150,
    kitModules: modifiedKits
  });
  assert.notEqual(differentKitScene.cacheKey, scene0.cacheKey, "cacheKey differs when the kit changes");
}

// ============================================================================
// 7. anthropicStream onStart called exactly once:
//    - on the first SSE message_start event
//    - never twice across HTTP retries of the same call
//    - once on the plain-JSON fallback path right before returning
//    - exceptions thrown by onStart are swallowed
// ============================================================================
{
  // (a) SSE with retries: attempt 1 emits message_start then drops mid-stream; attempt 2 succeeds with message_start -> onStart called once
  let attempts = 0;
  let onStartCalls = 0;
  const eventsOrder = [];

  const reply = await anthropicStream(
    { model: "claude-haiku-5-5", max_tokens: 1000, messages: [{ role: "user", content: "draw" }] },
    {
      errorPrefix: "Scene authoring failed",
      sleep: async () => {},
      log: () => {},
      onStart: () => {
        onStartCalls += 1;
        eventsOrder.push(`onStart:${attempts}`);
        throw new Error("boom inside onStart must be swallowed");
      },
      onProgress: (p) => {
        eventsOrder.push(`progress:${attempts}:${p.chars}`);
      },
      request: async () => {
        attempts += 1;
        if (attempts === 1) {
          // Emits message_start and partial text, then closes without message_stop (triggers retry)
          return makeSseResponse([
            `event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":100,"output_tokens":1}}}\n\n`,
            `event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"partial"}}\n\n`
          ]);
        }
        return makeSseResponse([
          `event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":100,"output_tokens":1}}}\n\n`,
          `event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"complete module"}}\n\n`,
          `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n`,
          `event: message_stop\ndata: {"type":"message_stop"}\n\n`
        ]);
      }
    }
  );

  assert.equal(attempts, 2, "retried after dropped first SSE stream");
  assert.equal(onStartCalls, 1, "onStart called exactly once across HTTP retries");
  assert.equal(eventsOrder[0], "onStart:1", "onStart fired on the first message_start before any text_delta");
  assert.equal(responseText(reply), "complete module");

  // (b) Plain-JSON fallback path: onStart called once right before returning (and swallows errors)
  let jsonOnStartCalls = 0;
  const jsonOrder = [];
  const jsonReply = await anthropicStream(
    { model: "claude-haiku-5-5", max_tokens: 1000, messages: [{ role: "user", content: "draw" }] },
    {
      errorPrefix: "Scene authoring failed",
      log: () => { jsonOrder.push("log"); },
      onProgress: () => { jsonOrder.push("progress"); },
      onStart: () => {
        jsonOnStartCalls += 1;
        jsonOrder.push("onStart");
        throw new Error("swallowed on json fallback too");
      },
      request: async () =>
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "json fallback text" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 50, output_tokens: 10 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    }
  );

  assert.equal(jsonOnStartCalls, 1, "onStart called once on plain-JSON fallback path");
  assert.equal(jsonOrder[jsonOrder.length - 1], "onStart", "onStart called right before result returns on plain-JSON path");
  assert.equal(responseText(jsonReply), "json fallback text");
}

console.log("cache-gate: ok");
