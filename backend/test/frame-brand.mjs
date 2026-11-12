import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
process.env.PLANNER ??= "deterministic";
process.env.ANTHROPIC_API_KEY ??= "test";
process.env.GEMINI_API_KEY ??= "test";

const { brandColorBlock, brandGround, withBrandLogo } = await import("../src/plan/frame-sketch.ts");
const { scriptFrameKey } = await import("@videosaas/contracts");

test("the brand's colours go into the frame prompt, and the style keeps its layout", () => {
  const block = brandColorBlock({ name: "Greedy Motion", colors: { primary: "#168bff", accent: "#ff6a2a", background: "#ffffff", text: "#0a0d12", } });
  assert.match(block, /Greedy Motion/);
  for (const hex of ["#168bff", "#ff6a2a", "#ffffff", "#0a0d12"]) assert.ok(block.includes(hex), hex);
  assert.match(block, /REPLACE the style guide's palette/);
  assert.match(block, /keep the style's layout, shapes and motion/);
});

test("no brand, or no valid primary colour, adds nothing", () => {
  assert.equal(brandColorBlock(null), null);
  assert.equal(brandColorBlock({ name: "X", colors: { primary: "blue" } }), null);
  const partial = brandColorBlock({ name: "X", colors: { primary: "#168bff", accent: "nope" } });
  assert.ok(partial.includes("#168bff"));
  assert.ok(!partial.includes("nope"));
});

test("a different brand kit is a different frame; films without a kit keep their old keys", () => {
  const beat = { keyword: "Hook", visual: "v", onScreen: "s" };
  const base = { styleExample: "stat-highlight", look: "clean", aspect: "16:9" };
  assert.equal(scriptFrameKey(beat, base), scriptFrameKey(beat, { ...base, brandId: undefined }));
  assert.notEqual(scriptFrameKey(beat, base), scriptFrameKey(beat, { ...base, brandId: "a42a9672-8fb6-4343-92d3-d2bb713d4338" }));
  assert.notEqual(scriptFrameKey(beat, { ...base, brandId: "a42a9672-8fb6-4343-92d3-d2bb713d4338" }), scriptFrameKey(beat, { ...base, brandId: "7d164af6-f829-4401-b7aa-b9bf00373758" }));
});

test("a light brand is drawn on a light ground, whatever the style's reference looks like", () => {
  const light = { name: "Greedy Motion", colors: { primary: "#168bff", accent: "#ff5a1f", text: "#0a0d12" } };
  assert.equal(brandGround(light), "light");
  const block = brandColorBlock(light);
  assert.match(block, /GROUND: this brand is LIGHT/);
  assert.match(block, /Never a black or dark-navy background/);
  assert.equal(brandGround({ name: "x", colors: { primary: "#168bff", background: "#0b0d12" } }), "dark");
  assert.equal(brandGround({ name: "x", colors: { primary: "#168bff", background: "#fafafa", text: "#ffffff" } }), "light");
  assert.equal(brandGround({ name: "x", colors: { primary: "#168bff", text: "#f5f5f5" } }), "dark");
  assert.equal(brandGround({ name: "x", colors: { primary: "#168bff" }, mode: "light" }), "light");
  assert.equal(brandGround({ name: "x", colors: { primary: "#168bff" } }), null);
  assert.doesNotMatch(brandColorBlock({ name: "x", colors: { primary: "#168bff" } }), /GROUND/);
});

test("the logo is placed by us in the bottom-right corner, and the model is told to leave it empty", () => {
  const uri = "data:image/png;base64,AAAA";
  const block = brandColorBlock({ name: "x", colors: { primary: "#168bff" }, logoDataUri: uri });
  assert.match(block, /bottom-right corner/);
  const out = withBrandLogo('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect/></svg>\n', uri, "16:9");
  assert.match(out, /<image id="brand-logo" href="data:image\/png;base64,AAAA" x="1\d{3}" y="6\d\d"/);
  assert.ok(out.endsWith("</svg>"));
  assert.doesNotMatch(brandColorBlock({ name: "x", colors: { primary: "#168bff" } }), /bottom-right/);
});
