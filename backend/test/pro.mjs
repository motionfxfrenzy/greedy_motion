// Pro Editor store rules that need no database: path confinement, size limits, optimistic concurrency, the blank
// composition and the preview path guard.
//
//   node test/pro.mjs
import assert from "node:assert/strict";

const { proPath, checkWrites, requireRev, servePath, sha256, ProInvalid, ProConflict, PRO_LIMITS } = await import("../src/pro/files.ts");
const { blankComposition } = await import("../src/pro/blank.ts");
process.env.PLANNER ??= "deterministic";
process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/unused";
const { mediaTokenIn, isMediaGet } = await import("../src/auth.ts");
const { mediaToken, verifyMediaToken } = await import("../src/media-links.ts");

let passed = 0;
const check = (name, run) => { run(); passed++; console.log(`ok - ${name}`); };

check("editable paths: ordinary names pass, escapes and odd extensions fail", () => {
  for (const ok of ["index.html", "css/theme.css", "scenes/a_b-1.js", "data/vars.json"]) assert.equal(proPath(ok), ok);
  for (const bad of ["../x.html", "a/../b.html", "/etc/passwd.html", "a//b.html", ".env.json", "x.png", "x.html/", "", "a b.html", "a\\b.html", "x".repeat(300) + ".html", 42, null])
    assert.throws(() => proPath(bad), ProInvalid, `rejects ${JSON.stringify(bad)}`);
});

check("a write batch is validated as a whole: types, duplicates, per-file and project limits", () => {
  assert.deepEqual(checkWrites({}, [{ path: "index.html", content: "<p>hi</p>" }]), [{ path: "index.html", content: "<p>hi</p>" }]);
  assert.throws(() => checkWrites({}, []), ProInvalid);
  assert.throws(() => checkWrites({}, "x"), ProInvalid);
  assert.throws(() => checkWrites({}, [{ path: "index.html", content: 5 }]), ProInvalid);
  assert.throws(() => checkWrites({}, [{ path: "a.html", content: "" }, { path: "a.html", content: "" }]), /twice/);
  assert.throws(() => checkWrites({}, [{ path: "a.html", content: "x".repeat(PRO_LIMITS.fileBytes + 1) }]), (e) => e.code === "too_large");
  const full = Object.fromEntries(Array.from({ length: PRO_LIMITS.files }, (_, i) => [`f${i}.json`, { size: 1, sha256: "" }]));
  assert.throws(() => checkWrites(full, [{ path: "one-more.json", content: "{}" }]), (e) => e.code === "too_large");
  assert.doesNotThrow(() => checkWrites(full, [{ path: "f1.json", content: "{}" }]), "overwriting an existing file does not add to the count");
  const big = { "a.html": { size: PRO_LIMITS.totalBytes - 5, sha256: "" } };
  assert.throws(() => checkWrites(big, [{ path: "b.html", content: "123456789" }]), (e) => e.code === "too_large");
});

check("optimistic concurrency: the matching revision passes, a stale one is a conflict that names the current revision", () => {
  assert.doesNotThrow(() => requireRev({ rev: 3 }, 3));
  assert.throws(() => requireRev({ rev: 3 }, 2), (e) => e instanceof ProConflict && e.currentRev === 3);
  assert.throws(() => requireRev({ rev: 3 }, undefined), ProInvalid);
  assert.throws(() => requireRev({ rev: 3 }, "3"), ProInvalid);
});

check("preview paths: nested assets pass; dot-segments, hidden files and empty parts do not", () => {
  for (const ok of ["index.html", "vendor/gsap.min.js", "shots/abc.png", "fonts/Inter 400.woff2"]) assert.equal(servePath(ok), ok);
  for (const bad of ["../a", "a/../b", ".env", "a/.git/config", "a//b", "", "a\u0000b"]) assert.throws(() => servePath(bad), ProInvalid, JSON.stringify(bad));
});

check("blank composition: stage carries the canvas and duration, one clip, one timeline, valid for each aspect", () => {
  for (const [aspect, w, h] of [["16:9", 1920, 1080], ["9:16", 1080, 1920], ["1:1", 1080, 1080]]) {
    const { html, canvas } = blankComposition(aspect, 12);
    assert.deepEqual(canvas, { width: w, height: h });
    assert.match(html, new RegExp(`data-width="${w}" data-height="${h}" data-duration="12"`));
    assert.equal((html.match(/data-start=/g) ?? []).length, 1);
    assert.match(html, /window\.__timelines\["main"\] = tl/);
  }
});

check("sha256 is stable and distinguishes content", () => {
  assert.equal(sha256("a"), sha256(Buffer.from("a")));
  assert.notEqual(sha256("a"), sha256("b"));
  assert.match(sha256("a"), /^[0-9a-f]{64}$/);
});

check("the preview token is read from the path for pro previews and from ?t= elsewhere; it never opens other routes", () => {
  const user = "11111111-2222-3333-4444-555555555555";
  const project = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const { token } = mediaToken(user);
  const inPath = `/v1/preview/projects/${project}/pro/@${token}/vendor/gsap.min.js`;
  assert.equal(mediaTokenIn(inPath, undefined), token);
  assert.equal(verifyMediaToken(mediaTokenIn(inPath, undefined)), user);
  assert.equal(mediaTokenIn(`/v1/preview/projects/${project}`, { t: token }), token);
  assert.equal(mediaTokenIn(`/v1/preview/projects/${project}/pro/@x/a.js`, { t: token }), "x", "the path token wins, so a smuggled ?t= cannot override it");
  assert.equal(verifyMediaToken(`${token}x`), null);
  assert.ok(isMediaGet("GET", inPath));
  assert.ok(!isMediaGet("POST", inPath));
  assert.ok(!isMediaGet("GET", `/v1/projects/${project}/pro/files`), "the editor API itself needs a Bearer token");
  assert.ok(!isMediaGet("PUT", `/v1/projects/${project}/pro/files`));
});

console.log(`${passed} checks passed`);
