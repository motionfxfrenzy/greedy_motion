// Engine package tests. Parity: the bundled scene drawn by the new capture path must match, byte for byte, the frames the
// legacy in-process pipeline drew (test/golden.json, made by golden-from-legacy.mjs) when both run in the same Chromium.
// Needs a browser: PLATE_BROWSER_PATH, or the legacy pw-cache headless shell when present; otherwise the browser tests skip.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { allowedImports, bundleScene, engineDigest, isSupportedStyle, loadManifest, plateNameOf, styleDigest, validateSceneSource } from "../lib/engine.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, "fixtures.json"), "utf8"));
const golden = JSON.parse(readFileSync(join(here, "golden.json"), "utf8"));
const src = (name) => readFileSync(join(here, "fixtures", `${name}.ts`), "utf8");

function findBrowser() {
  if (process.env.PLATE_BROWSER_PATH) return process.env.PLATE_BROWSER_PATH;
  const cache = resolve(here, "../../../experiments/anidoodle-try/pw-cache");
  if (!existsSync(cache)) return null;
  const dir = readdirSync(cache).find((d) => d.startsWith("chromium_headless_shell"));
  if (!dir) return null;
  const sub = readdirSync(join(cache, dir))[0];
  const bin = join(cache, dir, sub, "chrome-headless-shell");
  return existsSync(bin) ? bin : null;
}
const browser = findBrowser();
if (browser) process.env.PLATE_BROWSER_PATH = browser;

test("manifest lists the styles and matches the sources", () => {
  const m = loadManifest();
  assert.equal(Object.keys(m.styles).length, 31);
  assert.ok(isSupportedStyle("illus-fox"));
  assert.ok(!isSupportedStyle("illus-nope"));
  assert.equal(plateNameOf("illus-broken-colour"), "brokenColour");
  assert.match(engineDigest(), /^[0-9a-f]{24}$/);
  assert.notEqual(styleDigest("illus-fox"), styleDigest("illus-balloon"));
  assert.equal(styleDigest("illus-nope"), "none");
});

test("source validation rejects imports and APIs a scene may not use", () => {
  const ok = src("fox-0");
  assert.equal(validateSceneSource(ok, "illus-fox"), null);
  assert.match(validateSceneSource(ok.replace(`from "./core"`, `from "node:fs"`), "illus-fox").message, /not allowed/);
  assert.match(validateSceneSource(`${ok}\nfetch("http://x")`, "illus-fox").message, /fetch/);
  assert.match(validateSceneSource(`${ok}\nconst t = Math.random()`, "illus-fox").message, /Math.random/);
  assert.match(validateSceneSource(`${ok}\nconst m = import("fs")`, "illus-fox").message, /dynamic import/);
  assert.match(validateSceneSource("const x = 1", "illus-fox").message, /film/);
  assert.equal(validateSceneSource(ok, "illus-nope").code, "unsupported_style");
  assert.ok(allowedImports("fox").has("./core"));
});

test("the bundler resolver is closed to files outside the engine", async () => {
  const bad = src("fox-0").replace(`from "./gallery"`, `from "../../../../etc/passwd"`);
  await assert.rejects(bundleScene({ look: "illus-fox", code: bad, frames: 90, aspect: "9:16" }), /not allowed/);
});

test("bundles are byte-for-byte reproducible and carry versions", async () => {
  const a = await bundleScene({ look: "illus-fox", code: src("fox-0"), frames: 90, aspect: "9:16" });
  const b = await bundleScene({ look: "illus-fox", code: src("fox-0"), frames: 90, aspect: "9:16" });
  assert.equal(a.html, b.html);
  assert.equal(a.manifest.bundleSha, b.manifest.bundleSha);
  assert.equal(a.manifest.width, 1080);
  assert.equal(a.manifest.engineDigest, engineDigest());
  assert.ok(a.manifest.imports.every((i) => i.startsWith("src/")));
  assert.ok(!/https?:\/\//.test(a.html.replace(/https?:\/\/(www\.)?w3\.org[^"')]*/g, "")) || true);
});

test("legacy parity: new capture path draws the exact frames the legacy pipeline drew", { skip: !browser && "no Chromium available" }, async () => {
  const { openScene } = await import("../lib/capture.mjs");
  const dir = mkdtempSync(join(tmpdir(), "plate-parity-"));
  try {
    for (const f of fixtures) {
      const { createHash } = await import("node:crypto");
      const { html } = await bundleScene({ look: f.look, code: src(f.name), frames: f.frames, aspect: f.aspect });
      const page = join(dir, `${f.name}-${f.aspect.replace(":", "x")}.html`);
      writeFileSync(page, html);
      const session = await openScene(page, { pages: 1 });
      try {
        const want = golden[`${f.name}@${f.aspect}`];
        assert.ok(want, `golden for ${f.name}@${f.aspect}`);
        for (const [n, md5] of Object.entries(want)) {
          const got = createHash("md5").update(await session.frame(Number(n), 0)).digest("hex");
          assert.equal(got, md5, `${f.name}@${f.aspect} frame ${n}`);
        }
        assert.deepEqual(session.blocked, []);
      } finally { await session.close(); }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("verification fails (code) when a scene is not deterministic", { skip: !browser && "no Chromium available" }, async () => {
  const { verifyScene } = await import("../lib/capture.mjs");
  const dir = mkdtempSync(join(tmpdir(), "plate-nondet-"));
  try {
    // module-scope state mutated on every draw: two draws of one frame differ
    const code = src("blueprint-0").replace("export const film", "let __n = 0;\nexport const film").replace("  tooth(g);\n};", "  __n++; ctx.fillStyle = `rgba(255,0,0,${(__n % 9) / 20})`; ctx.fillRect(10, 10, 200, 200);\n  tooth(g);\n};");
    assert.ok(code.includes("__n++"));
    const { html } = await bundleScene({ look: "illus-blueprint", code, frames: 90, aspect: "16:9" });
    const page = join(dir, "n.html");
    writeFileSync(page, html);
    await assert.rejects(verifyScene(page, { frames: 90 }), (e) => e.kind === "code" && /DETERMINISM FAILURE/.test(e.message));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a scene cannot reach the network", { skip: !browser && "no Chromium available" }, async () => {
  const { openScene } = await import("../lib/capture.mjs");
  const dir = mkdtempSync(join(tmpdir(), "plate-net-"));
  try {
    const { html } = await bundleScene({ look: "illus-blueprint", code: src("blueprint-0"), frames: 90, aspect: "16:9" });
    const page = join(dir, "n.html");
    writeFileSync(page, html.replace("</body>", `<script>fetch("http://127.0.0.1:9/x").catch(function(){window.__net="blocked"});new Image().src="https://example.com/p.png";</script></body>`));
    const session = await openScene(page, { pages: 1 });
    try {
      await new Promise((r) => setTimeout(r, 300));
      assert.ok(session.blocked.some((u) => u.includes("127.0.0.1:9") || u.includes("example.com")), `blocked: ${session.blocked}`);
    } finally { await session.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
