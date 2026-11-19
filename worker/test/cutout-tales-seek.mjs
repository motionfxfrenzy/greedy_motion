// Seek determinism + layout rules for Cutout tales, in headless Chrome with the bundled fonts.
//  1. Frames are pixel-identical forwards, backwards, shuffled/repeated, and in a brand-new browser page.
//  2. At every sampled time, overlays never overlap each other or a character's head, and stay inside the frame.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { openKit, TEMPLATE } from "../../scripts/cutout-lib.mjs";

const base = JSON.parse(await readFile(`${TEMPLATE}/samples/red-mesa.json`, "utf8"));
const overlapBox = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
let failures = 0;
const kit = await openKit();
for (const aspect of ["16:9", "9:16"]) {
  const spec = { ...structuredClone(base), aspect };
  const W = aspect === "16:9" ? 1920 : 1080, H = aspect === "16:9" ? 1080 : 1920;
  const times = []; for (let t = 0; t <= spec.duration; t += 0.75) times.push(Math.round(t * 100) / 100);
  times.push(0.033, 4.97, 5.03, 10.99, 17.5, 29.99);

  const forward = await kit.hashes(spec, times);
  const backward = (await kit.hashes(spec, [...times].reverse())).reverse();
  assert.deepEqual(backward, forward, `${aspect}: backward seek differs from forward`);
  const order = times.map((_, i) => (i * 7 + 3) % times.length);
  const shuffled = await kit.hashes(spec, [...order, ...order].map((i) => times[i]));
  [...order, ...order].forEach((idx, k) => assert.equal(shuffled[k], forward[idx], `${aspect}: shuffled/repeated seek differs at t=${times[idx]}`));
  assert.ok(new Set(forward).size > times.length * 0.8, `${aspect}: frames should change over time`);
  console.log(`${aspect}: ${times.length} frames identical forwards, backwards and shuffled`);

  // Overlap rule at 10 Hz.
  const dense = []; for (let t = 0; t <= spec.duration; t += 0.1) dense.push(Math.round(t * 10) / 10);
  const samples = await kit.boxes(spec, dense);
  let checked = 0;
  for (const s of samples) {
    const all = [...s.overlays];
    for (const o of all) {
      checked++;
      if (o.failed) { failures++; console.error(`${aspect} t=${s.t}: no collision-free slot for ${o.id}`); }
      const b = o.box;
      if (b.x0 < -1 || b.y0 < -1 || b.x1 > W + 1 || b.y1 > H + 1) { failures++; console.error(`${aspect} t=${s.t}: ${o.id} leaves the frame`, b); }
      for (const h of s.heads) if (overlapBox(b, h.box)) { failures++; console.error(`${aspect} t=${s.t}: ${o.id} overlaps ${h.id}`); }
    }
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (overlapBox(all[i].box, all[j].box)) { failures++; console.error(`${aspect} t=${s.t}: ${all[i].id} overlaps ${all[j].id}`); }
  }
  console.log(`${aspect}: ${checked} overlay placements checked against heads and each other`);
}
await kit.close();

// A brand-new page (fresh process state) must also reproduce the same pixels.
const a = await openKit(), b = await openKit();
const spec = structuredClone(base), probe = [1.2, 8.8, 16.4, 22.6, 27.3];
assert.deepEqual(await a.hashes(spec, probe), await b.hashes(spec, [...probe]), "two independent browser pages disagree");
await a.close(); await b.close();
assert.equal(failures, 0, `${failures} layout violation(s)`);
console.log("cutout-tales seek + layout tests passed");
