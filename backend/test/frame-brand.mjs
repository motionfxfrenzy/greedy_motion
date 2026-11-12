import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
process.env.PLANNER ??= "deterministic";
process.env.ANTHROPIC_API_KEY ??= "test";
process.env.GEMINI_API_KEY ??= "test";

const { brandColorBlock, brandGround, logoPlacement, fillLogoSlot, withoutLegacyLogo } = await import("../src/plan/frame-sketch.ts");
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

test("the logo is not on every frame: focus on the closing frame, inline where the picture shows a logo, side where the brand is named, none elsewhere", () => {
  assert.equal(logoPlacement({ beat: beat(), index: 0, count: 13, brand }), "none");
  assert.equal(logoPlacement({ beat: beat({ keyword: "Skip the timeline" }), index: 4, count: 13, brand }), "none");
  assert.equal(logoPlacement({ beat: beat(), index: 12, count: 13, brand }), "focus");
  assert.equal(logoPlacement({ beat: beat({ visual: "A brand card populates a logo and a hex swatch." }), index: 5, count: 13, brand }), "inline");
  assert.equal(logoPlacement({ beat: beat({ visual: "The logo and an Open Studio button sit in the centre." }), index: 12, count: 13, brand }), "focus", "the closing frame stays focus");
  assert.equal(logoPlacement({ beat: beat({ onScreen: "Greedy Motion turns briefs into MP4s" }), index: 3, count: 13, brand }), "side");
  assert.equal(logoPlacement({ beat: beat({ line: "Meet GreedyMotion." }), index: 1, count: 13, brand }), "side");
  assert.equal(logoPlacement({ beat: beat(), index: 12, count: 13, brand: { ...brand, logoDataUri: undefined } }), "none");
  assert.equal(logoPlacement({ beat: beat(), index: 0, count: 1, brand }), "none");
});

test("the prompt asks for an empty logo slot where a real page would keep the logo, never a drawn logo", () => {
  for (const placement of ["focus", "inline", "side"]) {
    const block = brandColorBlock(brand, placement);
    assert.match(block, /id="logo-slot"/);
    assert.match(block, /never draw a logo, symbol, icon or letters of your own/);
  }
  assert.match(brandColorBlock(brand, "focus"), /vertical middle sits at the middle of the frame/);
  assert.match(brandColorBlock(brand, "focus"), /Do not add a web address unless the on-screen words contain one/);
  assert.doesNotMatch(brandColorBlock(brand, "focus"), /must show the web address/i);
  assert.match(brandColorBlock(brand, "inline"), /extracted logo/);
  assert.match(brandColorBlock(brand, "side"), /page hierarchy: the logo sits in the page's header or nav bar/);
  assert.match(brandColorBlock(brand, "side"), /never over the browser chrome/);
  assert.match(brandColorBlock(brand, "none"), /Do not draw a logo/);
  assert.doesNotMatch(brandColorBlock(brand, "none"), /logo-slot/);
});

test("the real logo goes exactly inside the slot, and a frame with no usable slot gets none", () => {
  const frame = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><g transform="translate(10 20)"><rect width="400" height="200" fill="#fff"/><rect id="logo-slot" x="120.5" y="40" width="160" height="80" fill="none"/></g></svg>';
  const out = fillLogoSlot(frame, uri);
  assert.match(out, /<image id="brand-logo" href="data:image\/png;base64,AAAA" x="120.5" y="40" width="160" height="80" preserveAspectRatio="xMidYMid meet" data-slot="1"\/>/);
  assert.ok(!out.includes("logo-slot"), "slot removed");
  assert.ok(out.indexOf("translate(10 20)") < out.indexOf("<image"), "stays inside its group, so it moves with the card");
  assert.equal(fillLogoSlot('<svg><rect id="logo-slot" x="1" y="1" width="4" height="4"/></svg>', uri), "<svg></svg>", "too small: removed, no logo");
  assert.equal(fillLogoSlot('<svg><rect id="logo-slot" fill="none"/></svg>', uri), "<svg></svg>", "no size: removed, no logo");
  const none = '<svg><rect id="card" width="5" height="5"/></svg>';
  assert.equal(fillLogoSlot(none, uri), none, "no slot: unchanged, never pasted over the picture");
});

test("a logo pasted at a fixed spot by an earlier version is dropped; one placed in a slot is kept", () => {
  const legacy = '<svg><rect/><image id="brand-logo" href="data:image/png;base64,AAAA" x="448" y="94" width="384" height="202" preserveAspectRatio="xMidYMid meet"/></svg>';
  assert.ok(!withoutLegacyLogo(legacy).includes("<image"));
  const placed = fillLogoSlot('<svg><rect id="logo-slot" x="1" y="1" width="40" height="20"/></svg>', uri);
  assert.equal(withoutLegacyLogo(placed), placed);
});
