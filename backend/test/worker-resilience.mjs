// Offline (DB-free, fake-clock) unit tests for worker & job resilience:
//   A. Live check-grace watchdog (evaluateCheckGraceFallback with fake clock, 90s default, retrying marker, singletonKey)
//   3. Lease tracker fast reclaim timing (createLeaseTracker with fake clock, 45s expiry, attempt fencing)
//   4. Anthropic stream retry on 529/stream drop after partial output + SIGTERM abort signal wiring
//   6. UI truth: SceneProgress.retrying exposed for open stages and cleared on ready/failed
//   Extra Finding: revisionDedupeHash, mergeRevisionNotes, decideRevisionApply (deduplicate & coalesce within N seconds)
import assert from "node:assert/strict";

process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/unused";
process.env.PLANNER ??= "deterministic";

const { anthropicStream, responseText } = await import("../src/anthropic.ts");
const { createLeaseTracker, LEASE_EXPIRY_SECONDS, LEASE_SECONDS } = await import("../src/jobs/control.ts");
const { abortActiveAuthorsForShutdown, MAX_AUTHOR_MODEL_STARTS } = await import("../src/plates/author.ts");
const { estimateScene } = await import("../src/plates/eta.ts");
const { CHECK_FALLBACK_REASON, CHECK_GRACE_SECONDS, evaluateCheckGraceFallback } = await import("../src/plates/reconcile.ts");
const { decideRevisionApply, mergeRevisionNotes, REVISE_COALESCE_SECONDS, revisionDedupeHash } = await import("../src/plates/store.ts");

// ------------------------------------------------------------------
// A. Check-grace watchdog with fake clock (DB-free)
// ------------------------------------------------------------------
{
  assert.equal(CHECK_GRACE_SECONDS, 180);
  const t0 = 1_700_000_000_000;
  const baseRow = {
    id: "6806947c-7800-42df-a0e3-255ec930e16e",
    gen: 3,
    state: "bundled",
    stage: "checking",
    liveMode: "live",
    bundleDigest: "dig-gen3",
    clipKey: null,
    hasCheckReport: false,
    updatedAt: new Date(t0),
    timings: {}
  };

  // Within 180s grace (e.g. +179s): does NOT fall back
  const within = evaluateCheckGraceFallback(baseRow, { now: t0 + 179_000 });
  assert.deepEqual(within, { fallback: false, reason: "within_grace" });

  // At/past 180s grace (+180s) with no check report: moves to clip path with singletonKey and retrying JSON
  const triggered = evaluateCheckGraceFallback(baseRow, { now: t0 + 180_000 });
  assert.deepEqual(triggered, {
    fallback: true,
    stage: "queued for rendering",
    singletonKey: "6806947c-7800-42df-a0e3-255ec930e16e:3",
    retrying: {
      attempt: 1,
      reason: CHECK_FALLBACK_REASON,
      at: t0 + 180_000
    }
  });

  // Fenced: if already moved to "queued for rendering", or has check report, or not live -> does NOT fall back again
  assert.deepEqual(
    evaluateCheckGraceFallback({ ...baseRow, stage: "queued for rendering" }, { now: t0 + 200_000 }),
    { fallback: false, reason: "wrong_stage" }
  );
  assert.deepEqual(
    evaluateCheckGraceFallback({ ...baseRow, hasCheckReport: true }, { now: t0 + 200_000 }),
    { fallback: false, reason: "already_reported" }
  );
  assert.deepEqual(
    evaluateCheckGraceFallback({ ...baseRow, liveMode: "clip" }, { now: t0 + 200_000 }),
    { fallback: false, reason: "not_live" }
  );
}

// ------------------------------------------------------------------
// 3. Fast reclaim of claimed work with fake clock (createLeaseTracker)
// ------------------------------------------------------------------
{
  assert.equal(LEASE_SECONDS, 30);
  assert.equal(LEASE_EXPIRY_SECONDS, 45);

  let fakeNow = 500_000;
  const tracker = createLeaseTracker({ now: () => fakeNow, leaseExpiryMs: 45_000 });

  tracker.record({
    queue: "plate-render",
    id: "job-1",
    attempt: 1,
    workerId: "w-1",
    data: { variantId: "v-1", gen: 3 }
  });
  tracker.record({
    queue: "plate-render",
    id: "job-2",
    attempt: 1,
    workerId: "w-2",
    data: { variantId: "v-2", gen: 1 }
  });

  // Advance 20s: worker 1 heartbeats, worker 2 is dead (silent)
  fakeNow += 20_000;
  assert.equal(tracker.touch("plate-render", "job-1", 1), true);
  assert.equal(tracker.touch("plate-render", "job-1", 2), false, "fenced by attempt number");
  assert.equal(tracker.collectExpired().length, 0, "neither lease expired at 20s");

  // Advance another 25s (total 45s since start, 25s since worker 1's last heartbeat):
  // worker 2's lease expires at 45s while worker 1's lease stays alive!
  fakeNow += 25_000;
  const expired = tracker.collectExpired();
  assert.equal(expired.length, 1, "dead worker 2 lease reclaimed at 45s");
  assert.equal(expired[0].id, "job-2");
  assert.equal(tracker.size(), 1, "live worker 1 lease remains active");
}

// ------------------------------------------------------------------
// 4. Anthropic stream drop after partial output restarts cleanly + SIGTERM abort
// ------------------------------------------------------------------
{
  const encoder = new TextEncoder();
  let streamCalls = 0;
  const progressLog = [];

  const reply = await anthropicStream(
    { model: "claude-sonnet-4-6", max_tokens: 1000, messages: [{ role: "user", content: "draw" }] },
    {
      errorPrefix: "Scene authoring failed",
      sleep: async () => {},
      log: () => {},
      onProgress: (p) => progressLog.push(p),
      request: async () => {
        streamCalls++;
        if (streamCalls === 1) {
          // Attempt 1: emits partial text_delta, then drops stream without message_delta / stop_reason / message_stop!
          const droppedStream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":50,"output_tokens":1}}}\n\n` +
                    `event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"PARTIAL_CORRUPT_HALF_MODULE"}}\n\n`
                )
              );
              controller.close();
            }
          });
          return new Response(droppedStream, { status: 200, headers: { "content-type": "text/event-stream" } });
        }
        // Attempt 2: clean complete stream
        const cleanStream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":50,"output_tokens":10}}}\n\n` +
                  `event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"export const film = { ok: true };\\n"}}\n\n` +
                  `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":12}}\n\n` +
                  `event: message_stop\ndata: {"type":"message_stop"}\n\n`
              )
            );
            controller.close();
          }
        });
        return new Response(cleanStream, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
    }
  );

  assert.equal(streamCalls, 2, "retried after mid-stream drop");
  assert.equal(
    responseText(reply),
    "export const film = { ok: true };\n",
    "partial output from dropped stream was discarded and scene restarted cleanly"
  );
  assert.equal(typeof abortActiveAuthorsForShutdown, "function");
  assert.equal(MAX_AUTHOR_MODEL_STARTS, 3, "model starts per (variant, gen) capped at 3");
}

// ------------------------------------------------------------------
// 6. UI truth: SceneProgress.retrying exposed for open scenes, cleared on ready/failed
// ------------------------------------------------------------------
{
  const now = 2_000_000;
  const checkingProg = estimateScene(
    {
      state: "bundled",
      stage: "queued for rendering",
      mode: "live",
      frames: 90,
      framesDone: 0,
      retrying: { attempt: 1, reason: "the preview check did not report; drawing it on the server" }
    },
    { now }
  );
  assert.deepEqual(checkingProg.retrying, {
    attempt: 1,
    reason: "the preview check did not report; drawing it on the server"
  });

  const drawingProg = estimateScene(
    {
      state: "rendering",
      stage: "rendering",
      mode: "live",
      frames: 90,
      framesDone: 15,
      retrying: { attempt: 2, reason: "the drawing worker restarted" }
    },
    { now }
  );
  assert.deepEqual(drawingProg.retrying, {
    attempt: 2,
    reason: "the drawing worker restarted"
  });

  const readyProg = estimateScene(
    {
      state: "drawn",
      mode: "live",
      frames: 90,
      framesDone: 90,
      retrying: { attempt: 2, reason: "the drawing worker restarted" }
    },
    { now }
  );
  assert.equal(readyProg.retrying, undefined, "ready scene never shows retrying");
}

// ------------------------------------------------------------------
// Extra Finding: comment revision deduplication & coalescing (N writes -> 1)
// ------------------------------------------------------------------
{
  assert.equal(REVISE_COALESCE_SECONDS, 90);
  const t0 = 10_000_000;
  const checkedRow = {
    state: "checked",
    gen: 1,
    rev: 0,
    bundle_digest: "bundle-dig-g1",
    source_key: "plates/p/16x9/2/g1/sources/s1/source.ts",
    revise: null,
    timings: {},
    updated_at: new Date(t0 - 60_000)
  };

  // First apply on checked row -> new_generation (gen 2, rev 1)
  const first = decideRevisionApply(checkedRow, "- at 1.2 s: make the lantern warmer", { now: t0 });
  assert.equal(first.action, "new_generation");
  assert.equal(first.gen, 2);
  assert.equal(first.rev, 1);
  assert.equal(first.dedupeHash, revisionDedupeHash("- at 1.2 s: make the lantern warmer", "bundle-dig-g1"));

  // Second apply with IDENTICAL notes while gen 2 is queued/authoring -> deduplicate (gen stays 2, 0 extra model calls)
  const authoringRow = {
    ...checkedRow,
    state: "authoring",
    gen: 2,
    rev: 1,
    bundle_digest: null,
    revise: {
      notes: first.notes,
      codeKey: first.codeKey,
      baseBundleDigest: first.baseBundleDigest,
      dedupeHash: first.dedupeHash
    },
    timings: { authorStartedAt: t0 + 1_000 },
    updated_at: new Date(t0 + 1_000)
  };
  const duplicateApply = decideRevisionApply(authoringRow, "  - at 1.2 s: make the lantern warmer\n", { now: t0 + 15_000 });
  assert.equal(duplicateApply.action, "deduplicate", "identical notes while authoring deduplicates");
  assert.equal(duplicateApply.gen, 2);

  // Third apply with NEW notes 20s into the write (< 90s coalesce window) -> coalesce (merges notes, keeps gen 2!)
  const coalescedApply = decideRevisionApply(
    authoringRow,
    "- at 1.2 s: make the lantern warmer\n- at 2.5 s: add drifting snow",
    { now: t0 + 20_000 }
  );
  assert.equal(coalescedApply.action, "coalesce", "newer notes within coalesce window coalesce instead of superseding mid-write");
  assert.equal(coalescedApply.gen, 2, "gen stays 2");
  assert.equal(
    coalescedApply.notes,
    "- at 1.2 s: make the lantern warmer\n- at 2.5 s: add drifting snow"
  );
  assert.equal(
    mergeRevisionNotes("- at 1.0 s: a", "- at 1.0 s: a\n- at 2.0 s: b"),
    "- at 1.0 s: a\n- at 2.0 s: b"
  );

  // Apply with NEW notes after 100s (>= 90s coalesce window) -> new_generation (gen 3, rev 2)
  const lateApply = decideRevisionApply(
    authoringRow,
    "- at 3.0 s: change sky to dawn",
    { now: t0 + 105_000 }
  );
  assert.equal(lateApply.action, "new_generation");
  assert.equal(lateApply.gen, 3);
  assert.equal(lateApply.rev, 2);
}

console.log("worker-resilience: ok");
