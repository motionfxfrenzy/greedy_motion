// Fast export: PUT /v1/projects/:id/plates/clips and GET .../clip-targets (backend/src/plates/browser-clips.ts).
// Offline: no database, no object storage (both injected); the probe is the real ffprobe on tiny real MP4s made by ffmpeg.
// Run: node backend/test/plate-browser-clips.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";

const { LOCAL_USER_ID } = await import("../src/config.ts");
const { registerBrowserClipRoutes, clipCacheKey, probeClip, createRateLimiter } = await import("../src/plates/browser-clips.ts");
const { NotDrawn } = await import("../src/plates/exports.ts");
const { clipCacheKey: workerClipCacheKey } = await import("../../worker/src/plates.mjs");

const dir = mkdtempSync(join(tmpdir(), "browser-clips-test-"));
const make = (name, { w = 64, h = 36, frames = 30, codec = "libx264", fps = 30, pix = "yuv420p" } = {}) => {
  const file = join(dir, name);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc=size=${w}x${h}:rate=${fps}`, "-frames:v", String(frames), "-c:v", codec, "-pix_fmt", pix, "-r", String(fps), file]);
  return readFileSync(file);
};
const good = make("good.mp4");
const wrongSize = make("size.mp4", { w: 32, h: 36 });
const wrongFrames = make("frames.mp4", { frames: 29 });
const wrongCodec = make("codec.mp4", { codec: "mpeg4" });
const wrongFps = make("fps.mp4", { fps: 25, frames: 30 });

const PID = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const projects = {
  [PID]: { id: PID, ownerId: LOCAL_USER_ID },
  [OTHER]: { id: OTHER, ownerId: "someone-else" }
};
const target = (i, digest, extra = {}) => ({
  index: i, variantId: `v${i}`, gen: 1, rev: 1, bundleDigest: digest, bundleKey: `plates/${PID}/b${i}/bundle.html`, bundleSha: "abc", paramsDigest: "p",
  params: { k: i }, bundleFrames: 30, engineDigest: "e".repeat(24), fontSetDigest: "f".repeat(24), width: 64, height: 36, size: "64x36", hasClip: false, cacheDigest: extra.assetsDigest ? `c${digest.slice(1)}` : digest, ...extra
});
const D0 = "a".repeat(64), D1 = "b".repeat(64), D2 = "c".repeat(64);
let notDrawn = false;
const puts = [], rows = [];
const app = Fastify();
await registerBrowserClipRoutes(app, {
  enabled: () => true,
  getProject: async (id) => projects[id] ?? null,
  targets: async (project) => {
    if (notDrawn) throw new NotDrawn("This ratio is still being drawn.", "drawing");
    return project.id === PID ? [target(0, D0), target(1, D1), target(2, D2, { hasClip: true })] : [target(0, "d".repeat(64))];
  },
  probe: (file) => probeClip(file),
  putClip: async (key, bytes) => { puts.push({ key, bytes: bytes.length }); },
  recordClip: async (row) => { const dup = rows.some((r) => r.bundleDigest === row.bundleDigest); if (!dup) rows.push(row); return !dup; },
  presignBundle: async (key) => `https://signed.example/${key}`,
  presignAsset: async (bucket, key) => `https://signed.example/${bucket}/${key}`,
  allow: createRateLimiter({ max: 9, windowMs: 60_000 })
});

const put = (body, { id = PID, digest = D0, aspect = "16:9", type = "video/mp4" } = {}) =>
  app.inject({ method: "PUT", url: `/v1/projects/${id}/plates/clips?aspect=${encodeURIComponent(aspect)}&bundleDigest=${digest}`, headers: { "content-type": type }, payload: body });

try {
  // clip-targets: only scenes without a cached clip, with a signed bundle link and the exact frame count
  const t = await app.inject({ method: "GET", url: `/v1/projects/${PID}/plates/clip-targets?aspect=9-16` });
  assert.equal(t.statusCode, 200);
  const tj = t.json();
  assert.equal(tj.total, 3);
  assert.equal(tj.cached, 1);
  assert.deepEqual(tj.targets.map((x) => x.bundleDigest), [D0, D1]);
  assert.equal(tj.targets[0].bundleUrl, `https://signed.example/plates/${PID}/b0/bundle.html`);
  assert.equal(tj.targets[0].bundleFrames, 30);
  assert.equal((await app.inject({ method: "GET", url: `/v1/projects/${PID}/plates/clip-targets?aspect=4:3` })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: `/v1/projects/${OTHER}/plates/clip-targets?aspect=16:9` })).statusCode, 404, "another user's project is not found");

  // reject cases (nothing stored)
  const reject = async (res, status, re) => { assert.equal(res.statusCode, status, res.body); if (re) assert.match(res.json().error.message, re); };
  await reject(await put(wrongSize), 422, /32x36, expected 64x36/);
  await reject(await put(wrongFrames), 422, /29 frames, expected 30/);
  await reject(await put(wrongCodec), 422, /H\.264/);
  await reject(await put(wrongFps), 422, /fps/);
  await reject(await put(good, { digest: "e".repeat(64) }), 409, /not part of this film/);
  await reject(await put(good, { digest: "../../etc" }), 400);
  await reject(await put(Buffer.from("#EXTM3U\nfile:///etc/passwd\n")), 415);
  await reject(await put(good, { id: OTHER, digest: "d".repeat(64) }), 404);
  assert.equal(puts.length, 0, "no rejected clip was stored");
  assert.equal(rows.length, 0);

  // accepted: stored at the worker's own key, row recorded with source=browser
  const ok = await put(good);
  assert.equal(ok.statusCode, 201, ok.body);
  const key = clipCacheKey(PID, D0, "e".repeat(24), "f".repeat(24), 64, 36);
  assert.equal(key, workerClipCacheKey(PID, D0, "e".repeat(24), "f".repeat(24), 64, 36), "same key as the worker");
  assert.deepEqual(puts, [{ key, bytes: good.length }]);
  assert.equal(rows[0].clipKey, key);
  assert.equal(rows[0].clipMeta.source, "browser");
  assert.equal(rows[0].frames, 30);
  assert.equal(rows[0].size, "64x36");
  // a second upload of the same digest is a no-op duplicate; an already cached scene is not stored again
  assert.equal((await put(good)).json().duplicate, true);
  const cached = await put(good, { digest: D2 });
  assert.equal(cached.statusCode, 200);
  assert.equal(cached.json().duplicate, true);
  assert.equal(puts.length, 2, "the cached scene was not uploaded");

  // not drawn yet: nothing to do
  notDrawn = true;
  assert.equal((await app.inject({ method: "GET", url: `/v1/projects/${PID}/plates/clip-targets?aspect=16:9` })).json().targets.length, 0);
  await reject(await put(good, { digest: D1 }), 409);
  notDrawn = false;

  // rate limit per project (9 in the window)
  let limited = 0;
  for (let i = 0; i < 4; i++) if ((await put(good, { digest: D1 })).statusCode === 429) limited++;
  assert.ok(limited > 0, "the limiter kicks in");

  console.log("plate-browser-clips: ok");
} finally {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
