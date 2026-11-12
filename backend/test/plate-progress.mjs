// Unit tests for plate authoring stream progress, 2 s throttling, and pure ETA maths (no database, no network).
// Run: node backend/test/plate-progress.mjs
import assert from "node:assert/strict";

process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";

const { anthropicMessage, anthropicStream, responseText } = await import("../src/anthropic.ts");
const { AUTHOR_PROGRESS_THROTTLE_MS, createProgressThrottle } = await import("../src/plates/author.ts");
const {
  CHECKING_SECONDS,
  DEFAULT_DRAWING_SECONDS,
  DEFAULT_TYPICAL_AUTHOR_MS,
  DEFAULT_TYPICAL_TOKENS,
  estimateFilm,
  estimateScene,
  toEtaRange
} = await import("../src/plates/eta.ts");

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
// 1. anthropicStream: SSE parsing, byte-identical text, stopErrors, error events, monotonic onProgress
// ============================================================================
{
  const deltas = [
    "export default function scene(ctx) {\n",
    "  const { width, height, frame } = ctx;\n",
    "  ctx.fillStyle = '#102030';\n",
    "  ctx.fillRect(0, 0, width, height);\n",
    "  // draw lantern glow\n",
    "  return { ok: true, frame };\n",
    "}\n"
  ];
  const fullText = deltas.join("");

  // Non-streaming reference response
  const nonStreamReply = await anthropicMessage(
    { model: "claude-haiku-5-5", max_tokens: 4000, messages: [{ role: "user", content: "draw" }] },
    {
      errorPrefix: "Scene authoring failed",
      log: () => {},
      request: async () =>
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: fullText }],
            stop_reason: "end_turn",
            usage: { input_tokens: 420, output_tokens: 85, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    }
  );

  // Build full SSE payload and slice it at arbitrary positions (including right in the middle of SSE lines and JSON)
  const sseLines = [
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: { usage: { input_tokens: 420, output_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } }
    })}\n\n`,
    `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`,
    ...deltas.map(
      (piece, idx) =>
        `event: content_block_delta\ndata: ${JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: piece }
        })}\n${idx % 2 === 0 ? "\n" : ""}`
    ),
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 85 }
    })}\n\n`,
    `event: message_stop\ndata: {"type":"message_stop"}\n\n`
  ].join("");

  // Cut the raw SSE string into odd-sized slices (e.g. 7, 13, 19 chars) so lines are split mid-token
  const splitChunks = [];
  const stepSizes = [7, 13, 19, 5, 29, 11];
  let cursor = 0;
  let stepIdx = 0;
  while (cursor < sseLines.length) {
    const size = stepSizes[stepIdx % stepSizes.length];
    splitChunks.push(sseLines.slice(cursor, cursor + size));
    cursor += size;
    stepIdx++;
  }

  const progressEvents = [];
  const usageLogs = [];
  const streamReply = await anthropicStream(
    { model: "claude-haiku-5-5", max_tokens: 4000, messages: [{ role: "user", content: "draw" }] },
    {
      errorPrefix: "Scene authoring failed",
      log: (line) => usageLogs.push(JSON.parse(line)),
      onProgress: (p) => progressEvents.push({ ...p }),
      request: async (_url, init) => {
        const sent = JSON.parse(String(init?.body ?? "{}"));
        assert.equal(sent.stream, true, "anthropicStream sends stream: true");
        return makeSseResponse(splitChunks);
      }
    }
  );

  // (a) Byte-identical text + matching stop_reason and usage
  assert.equal(responseText(streamReply), responseText(nonStreamReply), "streamed text is byte-identical to non-streaming reply");
  assert.equal(responseText(streamReply), fullText);
  assert.equal(streamReply.stop_reason, "end_turn");
  assert.deepEqual(streamReply.usage, nonStreamReply.usage);
  assert.equal(usageLogs.length, 1);
  assert.equal(usageLogs[0].event, "anthropic_usage");
  assert.equal(usageLogs[0].input, 420);
  assert.equal(usageLogs[0].output, 85);

  // (d) onProgress is monotonic in chars, lines, and tokens
  assert.equal(progressEvents.length, deltas.length, "onProgress called once per text_delta");
  for (let i = 1; i < progressEvents.length; i++) {
    assert.ok(progressEvents[i].chars >= progressEvents[i - 1].chars, `chars monotonic at ${i}`);
    assert.ok(progressEvents[i].lines >= progressEvents[i - 1].lines, `lines monotonic at ${i}`);
    assert.ok(progressEvents[i].tokens >= progressEvents[i - 1].tokens, `tokens monotonic at ${i}`);
  }
  const lastProgress = progressEvents[progressEvents.length - 1];
  assert.equal(lastProgress.chars, fullText.length);
  assert.equal(lastProgress.lines, deltas.length);
  assert.equal(lastProgress.tokens, Math.round(fullText.length / 3.5));

  // (b) stop_reason max_tokens with stopErrors throws the exact same message as anthropicMessage
  const cutOffMsg = "CUT OFF: the module was longer than the output limit.";
  const maxTokensSse = [
    `event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":1}}}\n\n`,
    `event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"partial"}}\n\n`,
    `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":24000}}\n\n`
  ];
  await assert.rejects(
    () =>
      anthropicStream(
        { messages: [] },
        {
          errorPrefix: "Scene authoring failed",
          log: () => {},
          stopErrors: { max_tokens: cutOffMsg },
          request: async () => makeSseResponse(maxTokensSse)
        }
      ),
    (err) => err instanceof Error && err.message === cutOffMsg,
    "stop_reason max_tokens throws configured stopErrors message"
  );

  // (c) SSE error event throws with errorPrefix
  const errorSse = [
    `event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":1}}}\n\n`,
    `event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n`
  ];
  await assert.rejects(
    () =>
      anthropicStream(
        { messages: [] },
        {
          errorPrefix: "Scene authoring failed",
          includeErrorDetail: true,
          sleep: async () => {},
          log: () => {},
          request: async () => makeSseResponse(errorSse)
        }
      ),
    /Scene authoring failed: Overloaded/,
    "SSE error event throws with errorPrefix"
  );

  // (e) Plain application/json reply fallback: identical responseText, usage log, onProgress once, and stopErrors handling
  const jsonProgress = [];
  const jsonUsageLogs = [];
  const jsonStreamReply = await anthropicStream(
    { model: "claude-haiku-5-5", max_tokens: 4000, messages: [{ role: "user", content: "draw" }] },
    {
      errorPrefix: "Scene authoring failed",
      log: (line) => jsonUsageLogs.push(JSON.parse(line)),
      onProgress: (p) => jsonProgress.push({ ...p }),
      request: async () =>
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: fullText }],
            stop_reason: "end_turn",
            usage: { input_tokens: 420, output_tokens: 85, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }
          }),
          { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }
        )
    }
  );
  assert.equal(responseText(jsonStreamReply), responseText(nonStreamReply), "application/json fallback gives identical responseText");
  assert.equal(jsonStreamReply.stop_reason, nonStreamReply.stop_reason);
  assert.deepEqual(jsonStreamReply.usage, nonStreamReply.usage);
  assert.deepEqual(jsonProgress, [{ chars: fullText.length, lines: deltas.length, tokens: 85 }], "onProgress called once with usage.output_tokens");
  assert.equal(jsonUsageLogs.length, 1);
  assert.equal(jsonUsageLogs[0].event, "anthropic_usage");
  assert.equal(jsonUsageLogs[0].input, 420);
  assert.equal(jsonUsageLogs[0].output, 85);

  const jsonProgressFallbackTokens = [];
  await anthropicStream(
    { messages: [] },
    {
      errorPrefix: "Scene authoring failed",
      log: () => {},
      onProgress: (p) => jsonProgressFallbackTokens.push({ ...p }),
      request: async () =>
        new Response(JSON.stringify({ content: [{ type: "text", text: fullText }], stop_reason: "end_turn" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    }
  );
  assert.deepEqual(
    jsonProgressFallbackTokens,
    [{ chars: fullText.length, lines: deltas.length, tokens: Math.round(fullText.length / 3.5) }],
    "onProgress falls back to chars/3.5 when usage.output_tokens is absent"
  );

  await assert.rejects(
    () =>
      anthropicStream(
        { messages: [] },
        {
          errorPrefix: "Scene authoring failed",
          log: () => {},
          stopErrors: { max_tokens: cutOffMsg },
          request: async () =>
            new Response(
              JSON.stringify({
                content: [{ type: "text", text: "partial" }],
                stop_reason: "max_tokens",
                usage: { input_tokens: 10, output_tokens: 24000 }
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            )
        }
      ),
    (err) => err instanceof Error && err.message === cutOffMsg,
    "application/json fallback applies identical stopErrors handling as anthropicMessage"
  );

  // (f) An SSE body that ends empty (no message_stop and no text) throws a transient repairable-free error
  let emptySseAttempts = 0;
  await assert.rejects(
    () =>
      anthropicStream(
        { messages: [] },
        {
          errorPrefix: "Scene authoring failed",
          sleep: async () => {},
          log: () => {},
          request: async () => {
            emptySseAttempts += 1;
            return makeSseResponse([]);
          }
        }
      ),
    (err) => err instanceof Error && /Scene authoring failed/.test(err.message) && !err.repairable,
    "empty SSE stream throws repairable-free transient error"
  );
  assert.equal(emptySseAttempts, 3, "empty SSE stream retries transient failure across 3 attempts");
}

// ============================================================================
// 2. Throttle: fake clock over a long stream -> at most 1 write per 2000 ms + 1 final flush
// ============================================================================
{
  let fakeNow = 10_000;
  const writes = [];
  const throttle = createProgressThrottle({
    now: () => fakeNow,
    intervalMs: AUTHOR_PROGRESS_THROTTLE_MS,
    authorStartedAt: fakeNow,
    write: (patch) => {
      writes.push({ at: fakeNow, ...patch });
    }
  });

  // Initial reset at t = 10_000 records authorStartedAt and zeros
  await throttle.reset();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].authorStartedAt, 10_000);
  assert.equal(writes[0].chars, 0);

  // Simulate 9.5 seconds of streaming with chunks every 100 ms (t = 10_100 .. 19_500)
  for (let elapsed = 100; elapsed <= 9500; elapsed += 100) {
    fakeNow = 10_000 + elapsed;
    const chars = elapsed * 2;
    const lines = Math.floor(chars / 40);
    const tokens = Math.round(chars / 3.5);
    throttle.onProgress({ chars, lines, tokens });
  }

  // Writes during stream should only have occurred at 12_000, 14_000, 16_000, 18_000 (4 throttled writes after the t=10_000 start)
  assert.deepEqual(
    writes.map((w) => w.at),
    [10_000, 12_000, 14_000, 16_000, 18_000],
    "at most one progress write per 2000 ms during stream"
  );
  for (let i = 1; i < writes.length; i++) {
    assert.ok(writes[i].at - writes[i - 1].at >= 2000, "writes separated by at least 2000 ms");
    assert.equal(writes[i].authorStartedAt, undefined, "subsequent writes do not re-send authorStartedAt");
  }

  // Final flush at stream end (t = 19_500) writes the final state once
  await throttle.flush();
  assert.equal(writes.length, 6, "one final write flushed when stream ends");
  assert.equal(writes[writes.length - 1].at, 19_500);
  assert.equal(writes[writes.length - 1].chars, 19_000);

  // Calling flush again without new progress does not write a duplicate
  await throttle.flush();
  assert.equal(writes.length, 6);
}

// ============================================================================
// 3. ETA table tests
// ============================================================================
{
  const now = 1_000_000;

  const table = [
    {
      name: "no history (fallback 3 min = 180s)",
      run: () => {
        const film = estimateFilm({
          now,
          cap: 4,
          scenes: [{ state: "queued", createdAt: now - 5_000, frames: 90, framesDone: 0 }]
        });
        assert.deepEqual(film.typicalSceneSeconds, toEtaRange(DEFAULT_TYPICAL_AUTHOR_MS / 1000));
        assert.deepEqual(film.typicalSceneSeconds, { low: 140, high: 270 });
        // 1 queued scene (180s) + checking tail (20s) = 200s -> low 150, high 300
        assert.deepEqual(film.etaSeconds, toEtaRange(180 + CHECKING_SECONDS));
        assert.equal(film.total, 1);
        assert.equal(film.written, 0);
      }
    },
    {
      name: "this film's finished scenes median overrides recent-median and default",
      run: () => {
        const film = estimateFilm({
          now,
          cap: 4,
          recentMedianAuthorMs: 240_000,
          scenes: [
            { state: "checked", authorTotalMs: 100_000, writtenTokens: 4000, frames: 90, framesDone: 0 },
            { state: "drawn", authorTotalMs: 140_000, writtenTokens: 5000, frames: 90, framesDone: 90 },
            { state: "queued", createdAt: now - 2_000, frames: 90, framesDone: 0 }
          ]
        });
        // Median of [100_000, 140_000] is 120_000 ms (120s) -> typicalSceneSeconds: low 90, high 180
        assert.deepEqual(film.typicalSceneSeconds, { low: 90, high: 180 });
        assert.equal(film.written, 2);
        assert.equal(film.checked, 2);
        assert.equal(film.drawn, 1);
        assert.deepEqual(film.etaSeconds, toEtaRange(120 + CHECKING_SECONDS));
      }
    },
    {
      name: "recent-median fallback when this film has no finished scenes yet",
      run: () => {
        const film = estimateFilm({
          now,
          cap: 4,
          recentMedianAuthorMs: 120_000,
          scenes: [{ state: "queued", createdAt: now - 1_000, frames: 90, framesDone: 0 }]
        });
        assert.deepEqual(film.typicalSceneSeconds, { low: 90, high: 180 });
        assert.deepEqual(film.etaSeconds, toEtaRange(120 + CHECKING_SECONDS));
      }
    },
    {
      name: "queued scene behind the cap waits ceil(position / cap) rounds of typical writing time",
      run: () => {
        // Cap = 2: positions 1 and 2 take 1 round (180s), position 3 takes ceil(3/2) = 2 rounds (360s), position 5 takes ceil(5/2) = 3 rounds (540s)
        const wave1 = estimateScene({ state: "queued", createdAt: now - 3_000 }, { now, position: 2, cap: 2 });
        const wave2 = estimateScene({ state: "queued", createdAt: now - 3_000 }, { now, position: 3, cap: 2 });
        const wave3 = estimateScene({ state: "queued", createdAt: now - 3_000 }, { now, position: 5, cap: 2 });
        assert.equal(wave1.stage, "waiting");
        assert.equal(wave1.elapsedMs, 3_000);
        assert.deepEqual(wave1.etaSeconds, toEtaRange(180));
        assert.deepEqual(wave2.etaSeconds, toEtaRange(360));
        assert.deepEqual(wave3.etaSeconds, toEtaRange(540));
      }
    },
    {
      name: "writing at 10% / 50% / 95% (clamped to [0.03, 0.95], remaining >= 10s)",
      run: () => {
        const s10 = estimateScene(
          {
            state: "authoring",
            authorStartedAt: now - 20_000,
            writtenTokens: Math.round(DEFAULT_TYPICAL_TOKENS * 0.1),
            writtenChars: 2100,
            writtenLines: 30
          },
          { now }
        );
        const s50 = estimateScene(
          {
            state: "authoring",
            authorStartedAt: now - 90_000,
            writtenTokens: Math.round(DEFAULT_TYPICAL_TOKENS * 0.5),
            writtenChars: 10500,
            writtenLines: 140
          },
          { now }
        );
        const s95 = estimateScene(
          {
            state: "authoring",
            authorStartedAt: now - 170_000,
            writtenTokens: DEFAULT_TYPICAL_TOKENS * 2, // exceeds typical -> clamped to 0.95
            writtenChars: 42000,
            writtenLines: 500
          },
          { now }
        );
        assert.equal(s10.stage, "writing");
        assert.equal(s10.fraction, 0.1);
        assert.equal(s10.elapsedMs, 20_000);
        assert.deepEqual(s10.etaSeconds, toEtaRange(180 * 0.9)); // 162s -> { low: 120, high: 240 }

        assert.equal(s50.fraction, 0.5);
        assert.deepEqual(s50.etaSeconds, toEtaRange(180 * 0.5)); // 90s -> { low: 70, high: 140 }

        assert.equal(s95.fraction, 0.95);
        // 180 * (1 - 0.95) = 9s, clamped to minimum 10s -> { low: 10, high: 20 }
        assert.deepEqual(s95.etaSeconds, toEtaRange(10));
        assert.ok(s10.etaSeconds.low > s50.etaSeconds.low && s50.etaSeconds.low > s95.etaSeconds.low, "ETA shrinks as writing progresses");
      }
    },
    {
      name: "drawing from frames (0 framesDone assumes 40s; partial framesDone scales remaining)",
      run: () => {
        const d0 = estimateScene({ state: "rendering", frames: 120, framesDone: 0, authorStartedAt: now - 100_000 }, { now });
        const dHalf = estimateScene({ state: "rendering", frames: 120, framesDone: 60, authorStartedAt: now - 120_000 }, { now });
        assert.equal(d0.stage, "drawing");
        assert.equal(d0.fraction, 0);
        assert.deepEqual(d0.etaSeconds, toEtaRange(DEFAULT_DRAWING_SECONDS)); // 40s -> { low: 30, high: 60 }

        assert.equal(dHalf.stage, "drawing");
        assert.equal(dHalf.fraction, 0.5);
        assert.deepEqual(dHalf.etaSeconds, toEtaRange(DEFAULT_DRAWING_SECONDS * 0.5)); // 20s -> { low: 20, high: 30 }
      }
    },
    {
      name: "all done => film.etaSeconds and scene.etaSeconds are null",
      run: () => {
        const film = estimateFilm({
          now,
          mode: "live",
          scenes: [
            { state: "checked", authorTotalMs: 110_000, writtenTokens: 5200, frames: 90, framesDone: 0 },
            { state: "drawn", authorTotalMs: 130_000, writtenTokens: 6100, frames: 90, framesDone: 90 }
          ]
        });
        assert.equal(film.etaSeconds, null);
        assert.equal(film.total, 2);
        assert.equal(film.written, 2);
        assert.equal(film.checked, 2);
        assert.equal(film.drawn, 1);

        const readyScene = estimateScene({ state: "drawn", frames: 90, framesDone: 90, authorTotalMs: 130_000 }, { now });
        assert.equal(readyScene.stage, "ready");
        assert.equal(readyScene.fraction, 1);
        assert.equal(readyScene.etaSeconds, null);
      }
    },
    {
      name: "failed scenes excluded from ETA and medians; all ready or failed => null",
      run: () => {
        const doneWithFailed = estimateFilm({
          now,
          mode: "live",
          scenes: [
            { state: "checked", authorTotalMs: 120_000, writtenTokens: 5000, frames: 90, framesDone: 0 },
            { state: "failed", authorTotalMs: 999_000, writtenTokens: 99_000, frames: 90, framesDone: 0 }
          ]
        });
        assert.equal(doneWithFailed.failed, 1);
        assert.equal(doneWithFailed.etaSeconds, null, "ready + failed has no remaining ETA");
        // Failed scene's bogus 999_000 ms must not pollute typicalSceneSeconds (stays 120s -> low 90, high 180)
        assert.deepEqual(doneWithFailed.typicalSceneSeconds, { low: 90, high: 180 });

        const failedScene = estimateScene({ state: "failed", frames: 90, framesDone: 0 }, { now });
        assert.equal(failedScene.stage, "failed");
        assert.equal(failedScene.etaSeconds, null);
      }
    },
    {
      name: "overdue checking scene (>= 60s in checking) clears etaSeconds instead of promising 'under a minute' indefinitely",
      run: () => {
        const freshCheck = estimateScene(
          {
            state: "bundled",
            stage: "checking",
            mode: "live",
            updatedAt: now - 15_000,
            authorStartedAt: now - 75_000
          },
          { now }
        );
        assert.equal(freshCheck.stage, "checking");
        assert.deepEqual(freshCheck.etaSeconds, { low: 20, high: 30 });

        const stuckCheck = estimateScene(
          {
            state: "bundled",
            stage: "checking",
            mode: "live",
            updatedAt: now - 120_000,
            authorStartedAt: now - 180_000
          },
          { now }
        );
        assert.equal(stuckCheck.stage, "checking");
        assert.equal(stuckCheck.etaSeconds, null, "stuck checking scene must not promise 20-30s indefinitely");

        const stuckFilm = estimateFilm({
          now,
          mode: "live",
          scenes: [
            { state: "bundled", stage: "checking", updatedAt: now - 120_000, authorTotalMs: 56_000, writtenTokens: 7000 },
            { state: "checked", authorTotalMs: 60_000, writtenTokens: 8000 },
            { state: "checked", authorTotalMs: 50_000, writtenTokens: 7500 }
          ]
        });
        assert.equal(stuckFilm.etaSeconds, null, "film with only an overdue checking scene must not promise under a minute");
      }
    }
  ];

  for (const t of table) {
    t.run();
  }
}

console.log("plate progress: ok");
