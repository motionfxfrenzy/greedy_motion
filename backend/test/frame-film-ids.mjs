import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
process.env.PLANNER ??= "deterministic";
process.env.ANTHROPIC_API_KEY ??= "test";
process.env.GEMINI_API_KEY ??= "test";

const { scopeDefs } = await import("../src/plan/frame-film.ts");
const { cleanSvg, fillLogoSlot } = await import("../src/plan/frame-sketch.ts");

const frame = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
<defs><linearGradient id="bg-grad"><stop offset="0" stop-color="#fff"/></linearGradient><filter id="card-shadow"><feGaussianBlur stdDeviation="4"/></filter><clipPath id="swatch-clip"><rect width="10" height="10"/></clipPath><g id="icon"><circle r="4"/></g></defs>
<rect id="bg" width="1280" height="720" fill="url(#bg-grad)"/>
<rect id="card" filter="url(#card-shadow)" style="fill:url('#bg-grad')"/>
<rect id="swatch" clip-path="url(#swatch-clip)"/>
<use href="#icon"/><use xlink:href="#icon"/>
<text id="title">Brand kit</text></svg>`;

test("defs get a per-frame name, with every reference; animated ids stay", () => {
  const out = scopeDefs(frame, "f6");
  for (const id of ["bg-grad", "card-shadow", "swatch-clip", "icon"]) {
    assert.ok(out.includes(`id="${id}-f6"`), `${id} renamed`);
    assert.ok(!out.includes(`id="${id}"`), `${id} gone`);
  }
  assert.ok(out.includes('fill="url(#bg-grad-f6)"'));
  assert.ok(out.includes('filter="url(#card-shadow-f6)"'));
  assert.ok(out.includes("fill:url(#bg-grad-f6)"));
  assert.ok(out.includes('clip-path="url(#swatch-clip-f6)"'));
  assert.ok(out.includes('href="#icon-f6"') && out.includes('xlink:href="#icon-f6"'));
  for (const id of ["bg", "card", "swatch", "title"]) assert.ok(out.includes(`id="${id}"`), `${id} kept for the motion`);
});

test("two frames with the same def names no longer share them", () => {
  const a = scopeDefs(frame, "f1"), b = scopeDefs(frame, "f6");
  const ids = (svg) => [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]).filter((id) => /-f\d$/.test(id));
  const shared = ids(a).filter((id) => ids(b).includes(id));
  assert.deepEqual(shared, []);
});

test("a frame with no references is returned unchanged", () => {
  const plain = '<svg xmlns="http://www.w3.org/2000/svg"><rect id="a"/></svg>';
  assert.equal(scopeDefs(plain, "f1"), plain);
});

test("the slot-placed brand logo survives the render cleanup, other images and old pasted logos do not, and it does not count against the size cap", () => {
  const uri = "data:image/png;base64," + "A".repeat(60000);
  const base = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="10" height="10"/><rect id="logo-slot" x="448" y="94" width="384" height="202" fill="none"/><image href="https://evil.example/x.png"/></svg>';
  const cleaned = cleanSvg(fillLogoSlot(base, uri));
  assert.ok(cleaned, "not rejected for size");
  assert.ok(cleaned.includes('<image id="brand-logo"'), "logo kept");
  assert.ok(!cleaned.includes("evil.example"), "other images stripped");
  assert.ok(cleaned.endsWith("</svg>"));
  const oldPaste = `<svg xmlns="http://www.w3.org/2000/svg"><image id="brand-logo" href="${uri}" x="1" y="1" width="1" height="1" preserveAspectRatio="xMidYMid meet"/></svg>`;
  assert.ok(!cleanSvg(oldPaste).includes("<image"), "an old fixed-position logo is dropped");
  const forged = '<svg xmlns="http://www.w3.org/2000/svg"><image id="brand-logo" href="javascript:alert(1)" x="1" y="1" width="1" height="1" preserveAspectRatio="xMidYMid meet" data-slot="1"/></svg>';
  assert.ok(!cleanSvg(forged).includes("javascript"));
  assert.ok(!cleanSvg(forged).includes("<image"));
});

const { enrichMotion } = await import("../src/plan/frame-film.ts");
const { parseFrameMotion } = await import("@videosaas/contracts");

const scene = `<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="bg-grad"/></defs>
<rect id="bg"/><text id="title">T</text><g id="card"><rect id="m1"/></g><g id="swatches"/><g id="toggle"/><g id="cursor"/><circle id="badge"/><g id="ambient"/></svg>`;

test("pieces the director left out still arrive, staggered and from varying directions", () => {
  const directed = [{ kind: "move", id: "card", from: { opacity: "0" }, start: 0.1, end: 0.6 }];
  const out = enrichMotion(scene, null, directed, 3.6);
  assert.deepEqual(out[0], directed[0], "the director's entries come first and are untouched");
  const added = out.slice(1).map((entry) => entry.id);
  assert.deepEqual(added, ["swatches", "toggle", "badge", "ambient"], "named pieces only: not the ground, title, cursor, defs or m-ids, and not what was directed");
  const starts = out.slice(1).map((entry) => entry.start);
  assert.deepEqual([...starts].sort((a, b) => a - b), starts, "one after another");
  assert.ok(starts.every((s) => s >= 0.15 && s <= 3.6 - 0.7));
  const froms = new Set(out.slice(1).map((entry) => entry.from.transform));
  assert.ok(froms.size > 1, "not all the same entrance");
  assert.ok(out.slice(1).every((entry) => entry.from.opacity === "0" && entry.end <= 3.4 && entry.end > entry.start));
  // The runtime and the validator accept what we generate.
  assert.equal(parseFrameMotion(out.slice(1), scene, 3.6).length, out.length - 1);
});

test("pieces already on screen in the previous scene are carried, not re-entered", () => {
  const previous = '<svg><g id="swatches"/><g id="toggle"/></svg>';
  const out = enrichMotion(scene, previous, [], 3.6);
  assert.deepEqual(out.map((entry) => entry.id), ["card", "badge", "ambient"]);
});

test("a rich director plan or a very short scene is left as is; nothing to add means no change", () => {
  const many = Array.from({ length: 16 }, (_, i) => ({ kind: "move", id: `x${i}`, from: { opacity: "0" }, start: 0, end: 1 }));
  assert.equal(enrichMotion(scene, null, many, 3.6), many);
  assert.deepEqual(enrichMotion(scene, null, [], 1.0), []);
  assert.deepEqual(enrichMotion('<svg><rect id="bg"/></svg>', null, [], 3), []);
});

test("the validator now keeps up to 24 directed entries", () => {
  const ids = Array.from({ length: 30 }, (_, i) => `e${i}`);
  const svg = `<svg>${ids.map((id) => `<g id="${id}"/>`).join("")}</svg>`;
  const plan = ids.map((id) => ({ kind: "move", id, from: { opacity: "0", transform: "translate(0 20)" }, start: 0.1, end: 0.5 }));
  assert.equal(parseFrameMotion(plan, svg, 4).length, 24);
});
