// The worker stamps the cutout-tales canvas and length from the shot list and refuses anything else.
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { stampCutoutTales } = await import("../src/compose.mjs");
const dir = await mkdtemp(join(tmpdir(), "stamp-"));
const fresh = async () => { await cp(new URL("../templates/cutout-tales/index.html", import.meta.url), join(dir, "index.html")); };
const shots = [{ t0: 0, t1: 12, set: "plain", cast: [] }];
await fresh();
assert.deepEqual(await stampCutoutTales(dir, { spec: JSON.stringify({ aspect: "9:16", duration: 12, shots }) }), { width: 1080, height: 1920, duration: 12 });
const html = await readFile(join(dir, "index.html"), "utf8");
assert.match(html, /data-width="1080" data-height="1920"/); assert.match(html, /data-duration="12"/); assert.match(html, /content="width=1080, height=1920"/);
await fresh();
assert.equal((await stampCutoutTales(dir, { spec: { aspect: "16:9", duration: 30.5, shots } })).width, 1920, "an object spec also works");
for (const bad of [undefined, "{", JSON.stringify({ aspect: "4:3", duration: 10, shots }), JSON.stringify({ aspect: "16:9", duration: 9999, shots }), JSON.stringify({ aspect: "16:9", duration: 10, shots: [] })]) {
  await fresh();
  await assert.rejects(() => stampCutoutTales(dir, { spec: bad }), /shot list/);
}
await rm(dir, { recursive: true, force: true });
console.log("cutout-tales stamp tests passed");
