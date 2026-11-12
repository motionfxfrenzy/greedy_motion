import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
process.env.PLANNER ??= "deterministic";
process.env.ANTHROPIC_API_KEY ??= "test";
process.env.GEMINI_API_KEY ??= "test";

const { systemBlocks, productVoice } = await import("../src/plan/script-writer.ts");
const { productFlowFor, findGalleryTemplate } = await import("@videosaas/contracts");

const brief = (over = {}) => ({ text: "Launch video for Relay", audio: { mode: "voiceover" }, ...over });
const textOf = (request) => systemBlocks(request).map((block) => block.text).join("\n");
const product = { brandName: "Relay", productNamed: true };

test("a product film follows its template's flow; the default is the launch-page sections", () => {
  assert.equal(productFlowFor(undefined), "launch-sections");
  assert.equal(productFlowFor("product-launch"), "launch-sections");
  assert.equal(productFlowFor("feature-spotlight"), "ui-moments");
  assert.equal(productFlowFor("not-a-template"), "launch-sections");
  assert.ok(findGalleryTemplate("feature-walkthrough"), "template exists");
  assert.match(productVoice("product-launch"), /launch page set in motion/);
  assert.match(productVoice("feature-spotlight"), /one interface piece at a time/);
  assert.doesNotMatch(productVoice("product-launch"), /one interface piece at a time/);
});

test("product films use the product voice (with the flow); the script reads without sound", () => {
  const text = textOf({ brief: brief({ styleExample: "product-launch" }), context: product });
  assert.match(text, /VOICE FOR THIS FILM: a product film/);
  assert.match(text, /Brand reveal/);
  assert.match(text, /sound off/);
  const demo = textOf({ brief: brief({ styleExample: "feature-spotlight" }), context: product });
  assert.match(demo, /product demo moments/);
  assert.doesNotMatch(demo, /Brand reveal/);
});

test("What-If and How-Does films never get the product flow", () => {
  for (const [styleExample, marker] of [["what-if-story-explainer", /a 'What If' thought-experiment/], ["how-does-system-explainer", /a 'How Does' mechanism/]]) {
    const text = textOf({ brief: brief({ styleExample, text: "What if the sun vanished?" }), context: { brandName: "", productNamed: false } });
    assert.doesNotMatch(text, /a product film/);
    assert.match(text, marker);
  }
  // Even with a brand kit attached, a what-if template stays a what-if film.
  const withBrand = textOf({ brief: brief({ styleExample: "what-if-story-explainer" }), context: product });
  assert.doesNotMatch(withBrand, /a product film/);
  assert.match(withBrand, /a 'What If' thought-experiment/);
});
