import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
process.env.PLANNER ??= "deterministic";
process.env.ANTHROPIC_API_KEY ??= "test";
process.env.GEMINI_API_KEY ??= "test";

const { brandColorBlock, brandGround, logoPlacement, withBrandLogo } = await import("../src/plan/frame-sketch.ts");
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
  assert.notEqual(scriptFrameKey({ keyword: "Hook", visual: "v", onScreen: "s" }, base), scriptFrameKey({ keyword: "Hook", visual: "v", onScreen: "s" }, { ...base, brandId: "a42a9672-8fb6-4343-92d3-d2bb713d4338" }));
  assert.notEqual(scriptFrameKey(beat, { ...base, brandId: "a42a9672-8fb6-4343-92d3-d2bb713d4338" }), scriptFrameKey(beat, { ...base, brandId: "7d164af6-f829-4401-b7aa-b9bf00373758" }));
});

test("a brand is drawn on its own ground; light when nothing says", () => {
  const light = { name: "Greedy Motion", colors: { primary: "#168bff", accent: "#ff5a1f", text: "#0a0d12" } };
  assert.equal(brandGround(light), "light");
  const block = brandColorBlock(light);
  assert.match(block, /GROUND: this brand is LIGHT/);
  assert.match(block, /Never a black or dark-navy background/);
  assert.equal(brandGround({ name: "x", colors: { primary: "#168bff", background: "#0b0d12" } }), "dark");
  assert.equal(brandGround({ name: "x", colors: { primary: "#168bff", background: "#fafafa", text: "#ffffff" } }), "light");
  assert.equal(brandGround({ name: "x", colors: { primary: "#168bff", text: "#f5f5f5" } }), "dark");
  assert.equal(brandGround({ name: "x", colors: { primary: "#168bff" }, mode: "dark" }), "dark");
  assert.equal(brandGround({ name: "x", colors: { primary: "#168bff" } }), "light");
});

const uri = "data:image/png;base64,AAAA";
const brand = { name: "Greedy Motion", colors: { primary: "#168bff" }, logoDataUri: uri };
const beat = (over = {}) => ({ keyword: "Hook", visual: "A cluttered timeline collapses into a prompt bar.", onScreen: "Build videos from a brief", line: null, ...over });

test("the logo is not on every frame: focus on the closing frame, side where the brand is named, none elsewhere", () => {
  assert.equal(logoPlacement({ beat: beat(), index: 0, count: 13, brand }), "none");
  assert.equal(logoPlacement({ beat: beat({ keyword: "Skip the timeline" }), index: 4, count: 13, brand }), "none");
  assert.equal(logoPlacement({ beat: beat(), index: 12, count: 13, brand }), "focus");
  assert.equal(logoPlacement({ beat: beat({ visual: "The Greedy Motion logo sits in the centre." }), index: 2, count: 13, brand }), "focus");
  assert.equal(logoPlacement({ beat: beat({ onScreen: "Greedy Motion turns briefs into MP4s" }), index: 3, count: 13, brand }), "side");
  assert.equal(logoPlacement({ beat: beat({ line: "Meet GreedyMotion." }), index: 1, count: 13, brand }), "side");
  assert.equal(logoPlacement({ beat: beat(), index: 12, count: 13, brand: { ...brand, logoDataUri: undefined } }), "none");
  assert.equal(logoPlacement({ beat: beat(), index: 0, count: 1, brand }), "none");
});

test("the prompt tells the model where the logo goes, or that there is none", () => {
  assert.match(brandColorBlock(brand, "focus"), /large and centred in the upper middle/);
  assert.match(brandColorBlock(brand, "side"), /bottom-right corner/);
  assert.match(brandColorBlock(brand, "none"), /Do not draw a logo/);
});

test("the logo is placed by us: centred and large for focus, in the corner for side", () => {
  const base = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect/></svg>\n';
  const side = withBrandLogo(base, uri, "16:9", "side");
  assert.match(side, /<image id="brand-logo" href="data:image\/png;base64,AAAA" x="1\d{3}" y="6\d\d" width="166" height="61"/);
  const focus = withBrandLogo(base, uri, "16:9", "focus");
  assert.match(focus, /x="448" y="94" width="384" height="202" preserveAspectRatio="xMidYMid meet"/);
  assert.ok(focus.endsWith("</svg>") && side.endsWith("</svg>"));
});
