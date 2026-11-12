import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
process.env.PLANNER ??= "deterministic";
process.env.ANTHROPIC_API_KEY ??= "test";
process.env.GEMINI_API_KEY ??= "test";

const { scopeDefs } = await import("../src/plan/frame-film.ts");
const { cleanSvg, withBrandLogo } = await import("../src/plan/frame-sketch.ts");

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

test("the brand logo survives the render cleanup, other images do not, and it does not count against the size cap", () => {
  const uri = "data:image/png;base64," + "A".repeat(60000);
  const base = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="10" height="10"/><image href="https://evil.example/x.png"/></svg>';
  const withLogo = withBrandLogo(base, uri, "16:9", "focus");
  const cleaned = cleanSvg(withLogo);
  assert.ok(cleaned, "not rejected for size");
  assert.ok(cleaned.includes('<image id="brand-logo"'), "logo kept");
  assert.ok(!cleaned.includes("evil.example"), "other images stripped");
  assert.ok(cleaned.endsWith("</svg>"));
  const forged = '<svg xmlns="http://www.w3.org/2000/svg"><image id="brand-logo" href="javascript:alert(1)" x="1" y="1" width="1" height="1" preserveAspectRatio="none"/></svg>';
  assert.ok(!cleanSvg(forged).includes("javascript"));
  assert.ok(!cleanSvg(forged).includes("<image"));
});
