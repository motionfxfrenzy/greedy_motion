import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
process.env.PLANNER ??= "deterministic";
process.env.ANTHROPIC_API_KEY ??= "test";
process.env.GEMINI_API_KEY ??= "test";

const { brandColorBlock } = await import("../src/plan/frame-sketch.ts");
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
