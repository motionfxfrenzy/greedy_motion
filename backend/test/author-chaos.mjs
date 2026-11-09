// Scene writing under model failures (529 overloaded, dropped streams, a hang): the write retries and recovers, or fails cleanly with a
// message the UI shows; the row is never left "authoring"/"queued" with nothing to move it. Hermetic: in-process S3 + model stub, real Postgres.
// Run: DATABASE_URL=postgres://videosaas:videosaas@localhost:55432/plates_resil node --experimental-strip-types test/author-chaos.mjs
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { assertThrowawayDb } from "./support/throwaway-db.mjs";

process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
assertThrowawayDb();

const sha256Hex = (input) => createHash("sha256").update(input).digest("hex");

// Hermetic in-process S3 + Anthropic mock server bound to 127.0.0.1
const s3Store = new Map();
const s3PutHistory = new Map();
const script = [];
let replyText = "";
const replyQueue = [];
const arrivals = [];
const bodies = [];
let modelCalls = 0;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "POST" && url.pathname === "/v1/messages") {
    modelCalls += 1;
    const bodyChunks = [];
    for await (const c of req) bodyChunks.push(c);
    try { bodies.push(JSON.parse(Buffer.concat(bodyChunks).toString("utf8"))); } catch { bodies.push({}); }
    arrivals.push(Date.now());
    const step = script.shift() ?? "ok";
    if (step === "529") { res.writeHead(529, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { type: "overloaded_error", message: "Overloaded" } })); return; }
    if (step === "hang") { return; }
    const text = replyQueue.shift() ?? replyText;
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (step === "slow-start") await new Promise((r) => setTimeout(r, 1500));
    const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    res.write(ev("message_start", { message: { usage: { input_tokens: 10, output_tokens: 1 } } }));
    if (step === "drop") { res.write(ev("content_block_delta", { delta: { type: "text_delta", text: text.slice(0, 200) } })); setTimeout(() => res.destroy(), 20); return; }
    res.write(ev("content_block_delta", { delta: { type: "text_delta", text } }));
    res.write(ev("message_delta", { delta: { stop_reason: step === "cut" ? "max_tokens" : "end_turn" }, usage: { output_tokens: 50 } }));
    res.end(ev("message_stop", {}));
    return;
  }

  const key = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (req.method === "HEAD") {
    const entry = s3Store.get(key);
    if (!entry) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-length": String(entry.bytes.length), "content-type": entry.contentType });
    res.end();
    return;
  }
  if (req.method === "PUT") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const bytes = Buffer.concat(chunks);
    s3Store.set(key, { bytes, contentType: req.headers["content-type"] ?? "application/octet-stream" });
    const hist = s3PutHistory.get(key) ?? [];
    hist.push(sha256Hex(bytes));
    s3PutHistory.set(key, hist);
    res.writeHead(200, { ETag: `"${createHash("md5").update(bytes).digest("hex")}"` });
    res.end();
    return;
  }
  if (req.method === "GET") {
    const entry = s3Store.get(key);
    if (!entry) {
      res.writeHead(404, { "content-type": "application/xml" });
      res.end("<Error><Code>NoSuchKey</Code></Error>");
      return;
    }
    res.writeHead(200, { "content-length": String(entry.bytes.length), "content-type": entry.contentType });
    res.end(entry.bytes);
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

process.env.STORAGE_DRIVER = "r2";
process.env.R2_ENDPOINT = `http://127.0.0.1:${port}`;
process.env.R2_FORCE_PATH_STYLE = "1";
process.env.R2_ACCESS_KEY_ID = "test-key";
process.env.R2_SECRET_ACCESS_KEY = "test-secret";
process.env.R2_UPLOADS_BUCKET = "test-uploads";
process.env.R2_OUTPUTS_BUCKET = "test-outputs";
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

const { config } = await import("../src/config.ts");
const { migrate, pool } = await import("../src/db/database.ts");
const { boss, startQueues } = await import("../src/jobs/queues.ts");
const { getObject } = await import("../src/storage.ts");
const { handleAuthor } = await import("../src/plates/author.ts");
const store = await import("../src/plates/store.ts");

function makeSceneCode(colorHex, label) {
  return [
    "```ts",
    'import { Ctx, Env } from "./core";',
    'import { Film } from "./film";',
    "const W = 1920, H = 1080, durationFrames = 60;",
    "const draw = (ctx: Ctx, frame: number, env: Env): void => {",
    "  ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);",
    `  ctx.fillStyle = "${colorHex}";`,
    "  ctx.fillRect(0, 0, W, H);",
    `  ctx.fillStyle = "#112233";`,
    `  ctx.fillRect(100 + frame * 2, 100, 200, 120); // ${label}`,
    "};",
    `export const film: Film = { meta: { title: "${label}", W: 1920, H: 1080, fps: 30, bpm: 120, durationFrames }, assets: { images: {} }, shots: [{ id: "scene", start: 0, end: durationFrames, draw }] };`,
    "```"
  ].join("\n");
}

function makeProjectRow(id, text = "A fox carries a warm lantern.") {
  const beats = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => ({ id: `b${i + 1}`, keyword: "Fox", visual: "A fox with a warm lantern.", onScreen: "Fox", line: "A fox carries a warm lantern." }));
  return {
    id,
    ownerId: "00000000-0000-4000-8000-000000000000",
    name: "Immutable Bundle Test",
    state: "Draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    request: { prompt: "test", template: "product-launch", style: "kinetic", theme: "neutral", format: "landscape" },
    screenshots: [],
    comments: [],
    brief: {
      text,
      look: "illus-fox",
      aspect: "16:9",
      aspects: ["16:9"],
      captions: "none",
      scriptBeats: beats
    },
    beatPlan: {
      target_duration_s: 2,
      canvas: { width: 1920, height: 1080, fps: 30 },
      beats: [
        {
          id: "b1",
          role: "hook",
          kind: "plate",
          producer: "plates",
          keyword: "Fox",
          visual: "A fox with a warm lantern.",
          line: "A fox carries a warm lantern."
        }
      ]
    }
  };
}

await migrate();
await startQueues();
const projectId = randomUUID();
const job = (v, retryCount = 0) => ({ id: randomUUID(), name: "plate-author", data: { variantId: v.id, gen: v.gen }, retryCount, signal: new AbortController().signal });
const scene = async (i, pid = projectId) => {
  await store.reconcileVariants(pid, [{ index: i, aspect: "16:9", signature: `v3:chaos-${i}`, frames: 60, width: 1920, height: 1080, keyword: "Fox" }], { scenes: i + 1 });
  return (await store.listVariants(pid)).find((v) => v.scene_index === i);
};
const results = [];
const extraProjects = [];
const check = async (name, fn) => { await fn(); results.push(name); console.log("  PASS:", name); };

try {
  const pData = makeProjectRow(projectId);
  await pool.query("insert into app.projects (id, owner_id, name, state, data) values ($1, $2, $3, $4, $5)", [projectId, pData.ownerId, pData.name, pData.state, pData]);
  const plainReply = makeSceneCode("#fff8ee", "chaos");
  const kitReply = plainReply.replace("const draw =", "const kitUse = [figure, foreground, normals];\nconst draw =").replace('import { Film } from "./film";', 'import { Film } from "./film";\ndeclare const figure: unknown, foreground: unknown, normals: unknown;');
  replyText = kitReply;

  await check("A. two 529 overloads then success: one write call recovers inside the HTTP retry, scene bundled", async () => {
    const v = await scene(0); modelCalls = 0; script.push("529", "529");
    await handleAuthor(job(v));
    assert.equal(modelCalls, 3);
    assert.equal((await store.getVariant(v.id)).state, "bundled");
  });

  await check("B. a dropped stream after partial output twice, then success: recovers, bundled", async () => {
    const v = await scene(1); modelCalls = 0; script.push("drop", "drop");
    await handleAuthor(job(v));
    assert.equal(modelCalls, 3);
    assert.equal((await store.getVariant(v.id)).state, "bundled");
  });

  await check("C. persistent 529: first delivery releases the row for the queue's retry; the final delivery fails it with a clear message", async () => {
    const v = await scene(2); modelCalls = 0;
    script.push("529", "529", "529");
    await assert.rejects(handleAuthor(job(v, 0)));
    let row = await store.getVariant(v.id);
    assert.equal(row.state, "queued", "released for the retry, not stuck authoring");
    assert.equal(row.author_owner, null);
    script.push("529", "529", "529");
    await handleAuthor(job(v, 2));
    row = await store.getVariant(v.id);
    assert.equal(row.state, "failed");
    assert.equal(row.error.code, "author_unavailable");
    assert.match(row.error.message, /Press Draw to try again/);
    assert.equal(modelCalls, 6, "bounded: 3 HTTP tries per delivery, no endless loop (and 529s are not billed)");
  });

  await check("D. a hung model call is bounded by the call's own deadline (anthropicStream aborts, never hangs)", async () => {
    const { anthropicStream } = await import("../src/anthropic.ts");
    script.push("hang", "hang", "hang");
    const t0 = Date.now();
    await assert.rejects(anthropicStream({ model: "x", max_tokens: 10, messages: [] }, { errorPrefix: "Scene authoring failed", timeoutMs: 1500 }));
    assert.ok(Date.now() - t0 < 4000, `aborted at the deadline, took ${Date.now() - t0} ms`);
    script.length = 0; // the aborted call consumed one scripted hang; drop the rest so later cases are not affected
  });

  await check("E. an author row whose process died (lease expired) is reclaimed by the sweep within the resend window, not left forever", async () => {
    const v = await scene(3);
    await store.claimAuthor(v.id, v.gen, "dead-owner", 90, 4);
    await pool.query("update app.plate_variants set author_until = now() - interval '5 seconds', enqueued_at = now() - interval '2 minutes' where id = $1", [v.id]);
    const { reconcilePlates } = await import("../src/plates/reconcile.ts");
    await reconcilePlates();
    const row = await store.getVariant(v.id);
    assert.equal(row.timings?.retrying?.reason, "the writing process restarted");
    const jobs = await pool.query("select count(*)::int n from pgboss.job where name = 'plate-author' and data->>'variantId' = $1 and state in ('created','retry','active')", [v.id]);
    assert.ok(jobs.rows[0].n >= 1, "a new author message exists");
  });

  await check("M1. cut off once: retried at the 128k limit (same model, no effort change), then bundled", async () => {
    const v = await scene(8); modelCalls = 0; replyText = kitReply; bodies.length = 0; script.push("cut");
    await handleAuthor(job(v));
    assert.equal(modelCalls, 2);
    assert.equal(bodies[0].max_tokens, 24000);
    assert.equal(bodies[1].max_tokens, 128000);
    assert.equal(bodies[1].output_config, undefined);
    assert.equal(bodies[1].model, bodies[0].model);
    assert.equal((await store.getVariant(v.id)).state, "bundled");
  });

  await check("M2. cut off twice: third call is effort high at 128k, then bundled", async () => {
    const v = await scene(9); modelCalls = 0; replyText = kitReply; bodies.length = 0; script.push("cut", "cut");
    await handleAuthor(job(v));
    assert.equal(modelCalls, 3);
    assert.deepEqual(bodies.map((b) => b.max_tokens), [24000, 128000, 128000]);
    assert.equal(bodies[2].output_config?.effort, "high");
    assert.equal((await store.getVariant(v.id)).state, "bundled");
  });

  await check("M3. a non-cut-off failure (module without a film export) keeps the single repair: same limit, no effort change", async () => {
    const v = await scene(10); modelCalls = 0; bodies.length = 0; replyQueue.push("```ts\nconst nothing = 1;\n```"); replyText = kitReply;
    await handleAuthor(job(v));
    assert.equal(modelCalls, 2);
    assert.deepEqual(bodies.map((b) => b.max_tokens), [24000, 24000]);
    assert.equal(bodies[1].output_config, undefined);
    assert.equal((await store.getVariant(v.id)).state, "bundled");
  });

  await check("K1. a scene without the style's kit helpers gets exactly ONE repair round, then is accepted", async () => {
    const v = await scene(4); modelCalls = 0; replyText = plainReply;
    await handleAuthor(job(v));
    assert.equal(modelCalls, 2, "first write + one kit repair, then accepted as written");
    assert.equal((await store.getVariant(v.id)).state, "bundled");
  });

  await check("K2. a scene built from the kit helpers needs no repair (one model call)", async () => {
    const v = await scene(5); modelCalls = 0; replyText = kitReply;
    await handleAuthor(job(v));
    assert.equal(modelCalls, 1);
    assert.equal((await store.getVariant(v.id)).state, "bundled");
  });

  await check("K3. a stored draft that fails the kit check is repaired once (no endless reuse)", async () => {
    const v = await scene(6); modelCalls = 0; replyText = kitReply;
    await store.claimAuthor(v.id, v.gen, "dead-owner", 90, 4);
    await store.saveDraft(v.id, v.gen, "dead-owner", plainReply);
    await pool.query("update app.plate_variants set author_until = now() - interval '5 seconds' where id = $1", [v.id]);
    await handleAuthor(job(v));
    assert.equal(modelCalls, 1, "the reused plain draft failed the check, one repair call produced a kit scene");
    assert.equal((await store.getVariant(v.id)).state, "bundled");
  });

  await check("K4. a scene that draws letters gets exactly one repair, then FAILS with the text message if it still draws them", async () => {
    const v = await scene(7); modelCalls = 0;
    replyText = kitReply.replace("ctx.fillRect(0, 0, W, H);", 'ctx.fillRect(0, 0, W, H); ctx.fillText("Hello", 100, 100);');
    await handleAuthor(job(v));
    assert.equal(modelCalls, 2, "first write + exactly one policy repair");
    const row = await store.getVariant(v.id);
    assert.equal(row.state, "failed");
    assert.equal(row.error.code, "author_text_drawn");
    assert.match(row.error.message, /drew words into the picture/);
    assert.match(row.error.message, /Press Draw to try again/);
    assert.ok(row.error.detail && row.error.detail.length > 0, "detail names the issue");
    const jobs = await pool.query("select count(*)::int n from pgboss.job where name = 'plate-render' and data->>'variantId' = $1", [v.id]);
    assert.equal(jobs.rows[0].n, 0, "nothing was queued for bundling/rendering");
  });

  await check("K5. after the repair the text is gone but the kit helpers are still missing: accepted and bundled", async () => {
    const v = await scene(8); modelCalls = 0;
    replyQueue.push(plainReply.replace("ctx.fillRect(0, 0, W, H);", 'ctx.fillRect(0, 0, W, H); ctx.fillText("Hello", 100, 100);'), plainReply);
    await handleAuthor(job(v));
    assert.equal(modelCalls, 2, "first write + one repair that removed the text");
    assert.equal((await store.getVariant(v.id)).state, "bundled", "kit-only shortfall is accepted");
  });

  const filmProject = async (text) => {
    const id = randomUUID(); extraProjects.push(id);
    const d = makeProjectRow(id, text);
    await pool.query("insert into app.projects (id, owner_id, name, state, data) values ($1, $2, $3, $4, $5)", [id, d.ownerId, d.name, d.state, d]);
    return id;
  };

  await check("G1. three scenes of one film started together: exactly one request goes first, the others only after its stream starts", async () => {
    const pid = await filmProject("Gate film one: a fox and a lantern.");
    config.plates.projectAuthorCap = 6;
    const vs = [await scene(0, pid), await scene(1, pid), await scene(2, pid)];
    replyText = kitReply; arrivals.length = 0; modelCalls = 0; script.length = 0; script.push("slow-start");
    const t0 = Date.now();
    await Promise.all(vs.map((v) => handleAuthor(job(v))));
    assert.equal(modelCalls, 3);
    assert.equal(arrivals.length, 3);
    const gaps = arrivals.map((a) => a - arrivals[0]);
    assert.ok(gaps[1] >= 1200 && gaps[2] >= 1200, `followers waited for the first stream to start (gaps ${gaps.join(", ")} ms)`);
    assert.ok(gaps[1] < 8000 && gaps[2] < 8000, "and were released together, well inside the warm timeout");
    for (const v of vs) assert.equal((await store.getVariant(v.id)).state, "bundled");
    assert.ok(Date.now() - t0 < 15_000);
  });

  await check("G2. a failed first request does not stall the others (the next caller is promoted)", async () => {
    const pid = await filmProject("Gate film two: a different fox, a different lantern.");
    config.plates.projectAuthorCap = 6;
    const vs = [await scene(0, pid), await scene(1, pid), await scene(2, pid)];
    replyText = kitReply; arrivals.length = 0; modelCalls = 0; script.length = 0; script.push("529", "529", "529");
    const t0 = Date.now();
    const settled = await Promise.allSettled(vs.map((v) => handleAuthor(job(v))));
    const states = await Promise.all(vs.map(async (v) => (await store.getVariant(v.id)).state));
    assert.equal(states.filter((s) => s === "bundled").length, 2, "the two followers were written");
    assert.equal(settled.filter((r) => r.status === "rejected").length, 1, "only the failed warmer is handed back to the queue");
    assert.ok(Date.now() - t0 < 12_000, `no stall: took ${Date.now() - t0} ms`);
  });

  console.log(`author-chaos: ok (${results.length} cases)`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.query("delete from app.plate_variants where project_id = $1", [projectId]).catch(() => undefined);
  for (const pid of [projectId, ...extraProjects]) {
    await pool.query("delete from app.plate_variants where project_id = $1", [pid]).catch(() => undefined);
    await pool.query("delete from app.projects where id = $1", [pid]).catch(() => undefined);
  }
  await boss.stop({ graceful: false }).catch(() => undefined);
  await pool.end().catch(() => undefined);
  server.close();
  process.exit(process.exitCode ?? 0);
}
