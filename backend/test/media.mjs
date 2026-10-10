// Media durability check (MEDIA-03): a file written through media.ts survives the loss of the local disk.
// With STORAGE_DRIVER=r2 it runs against the real media bucket under a throwaway project id and cleans up;
// with the filesystem driver it checks the local-only behaviour.
//
//   STORAGE_DRIVER=r2 R2_ENDPOINT=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_UPLOADS_BUCKET=… \
//   R2_OUTPUTS_BUCKET=… R2_MEDIA_BUCKET=… node test/media.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = await mkdtemp(join(tmpdir(), "media-test-"));
process.env.PROJECTS_DIR = join(scratch, "projects");
process.env.BRANDS_DIR = join(scratch, "brands");
process.env.AUDIO_DIR = join(scratch, "audio");
// config.ts validates these at import; this test never opens the database or calls Claude.
process.env.PLANNER ??= "deterministic";
process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/unused";
const { ensureMediaDir, mediaInR2, mediaKey, readMedia, removeMedia, saveMedia } = await import("../src/media.ts");

const project = join(process.env.PROJECTS_DIR, randomUUID());
const shot = join(project, "screenshots", "a.png");
const snapshot = join(project, "site", "section-1.html");
const brand = join(process.env.BRANDS_DIR, randomUUID());
const audio = join(process.env.AUDIO_DIR, "plans", randomUUID());
const fixtures = [
  [shot, "png-bytes"], [snapshot, "<p>snapshot</p>"],
  [join(brand, "logo.png"), "logo-bytes"], [join(brand, "theme.css"), ":root{--brand:#123456}"],
  [join(brand, "fonts", "test.woff2"), "font-bytes"], [join(audio, "vo", "take.wav"), "audio-bytes"]
];
const gone = (path) => stat(path).then(() => false, () => true);
let passed = 0;
const check = async (name, run) => { await run(); passed++; console.log(`ok - ${name}`); };

try {
  await check("keys mirror the local layout", () => {
    assert.match(mediaKey(shot), /^media\/projects\/[0-9a-f-]{36}\/screenshots\/a\.png$/);
    assert.equal(mediaKey(join(process.env.BRANDS_DIR, "x", "fonts", "f.woff2")), "media/brands/x/fonts/f.woff2");
    assert.throws(() => mediaKey(join(scratch, "elsewhere.txt")));
  });
  await check("a saved file reads back", async () => {
    for (const [path, bytes] of fixtures) {
      await saveMedia(path, bytes);
      assert.equal((await readMedia(path))?.toString(), bytes);
    }
  });
  await rm(scratch, { recursive: true, force: true });
  if (mediaInR2) {
    await check("a single file comes back after the disk is lost", async () => {
      assert.equal((await readMedia(shot))?.toString(), "png-bytes");
    });
    await check("a whole directory comes back after the disk is lost", async () => {
      await rm(scratch, { recursive: true, force: true });
      await ensureMediaDir(project);
      await ensureMediaDir(brand);
      await ensureMediaDir(audio);
      assert.equal((await readMedia(snapshot))?.toString(), "<p>snapshot</p>");
      assert.equal(await gone(shot), false);
      for (const [path, bytes] of fixtures) {
        assert.equal(await gone(path), false, `directory hydration: ${path}`);
        assert.equal((await readMedia(path))?.toString(), bytes);
      }
    });
    await check("removal deletes from R2 too", async () => {
      await removeMedia(project);
      await removeMedia(brand);
      await removeMedia(audio);
      assert.equal(await gone(shot), true);
      for (const [path] of fixtures) assert.equal(await readMedia(path), null);
    });
  } else {
    await check("without R2 a lost file is reported missing", async () => {
      for (const [path] of fixtures) assert.equal(await readMedia(path), null);
    });
  }
  await check("preview pages sign private asset URLs only", async () => {
    const { signPreviewUrls, mediaToken, verifyMediaToken } = await import("../src/media-links.ts");
    const user = "00000000-0000-4000-8000-00000000000a";
    const { token } = mediaToken(user);
    assert.equal(verifyMediaToken(token), user);
    assert.equal(verifyMediaToken(token, Date.now() + 14 * 3600_000), null, "expired");
    const html = `<img src="/api/preview/projects/p1/screenshots/s1"><style>@font-face{src:url("/api/preview/brands/b1/fonts/x.woff2")}</style>` +
      `<script src="/api/preview/runtime.js"></script><script>{"src":"/api/preview/plans/p1/audio/vo/a.wav"}</script><audio src="/api/preview/plan-sfx/whoosh.mp3">`;
    const signed = signPreviewUrls(html, token);
    const t = `t=${encodeURIComponent(token)}`;
    for (const url of ["/api/preview/projects/p1/screenshots/s1", "/api/preview/brands/b1/fonts/x.woff2", "/api/preview/plans/p1/audio/vo/a.wav"]) assert.ok(signed.includes(`${url}?${t}`), url);
    assert.ok(signed.includes('"/api/preview/runtime.js"') && signed.includes('"/api/preview/plan-sfx/whoosh.mp3"'), "shared files stay bare");
  });
  console.log(`${passed} checks passed (${mediaInR2 ? "R2" : "filesystem"})`);
} finally {
  // Also clean the throwaway remote prefixes if a recovery assertion failed.
  try {
    const results = await Promise.allSettled([project, brand, audio].map(removeMedia));
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map((result) => result.reason), "Media smoke cleanup failed");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
