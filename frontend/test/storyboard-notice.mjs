// A short balance must be said, not hidden: the cast-preview storyboard shows the reason and the top-up path, and old sketches never stand in for the real sets.
// Source guards on the page wiring (the logic is in backend/test/storyboard-previews.mjs). Run: node --test frontend/test/storyboard-notice.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const studio = readFileSync(new URL("../components/studio.tsx", import.meta.url), "utf8");
const canvas = readFileSync(new URL("../components/script-canvas.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8");

test("the page shows the notice and opens the top-up path", () => {
  assert.match(api, /notice\?: \{ code: "insufficient_tokens"; message: string; needed: number; remaining: number \}/);
  assert.match(studio, /if \(event\.notice\) \{ setSetsNotice\(/);
  assert.match(studio, /onAddTokens: \(\) => showLimit\(new LimitError\(setsNotice\.message, "insufficient_tokens", null, null, null, setsNotice\.needed, setsNotice\.remaining\)\)/, "the usual plans and tokens modal");
  assert.match(canvas, /className="sc-sets-notice" role="status"/); assert.match(canvas, />Add tokens<\/button>/);
  assert.match(studio, /setSetsNotice\(null\);\n/, "the notice goes away when a set arrives");
});

test("sketches saved before the template drew cards never stand in for the real sets", () => {
  assert.match(studio, /const saved = castPreviews\(\) \? \[\] : \(project\?\.scriptFrames/, "a reopened cast-preview project draws its cards from the sets (e9ea7a6e had 10 KB SVG sketches saved)");
});

test("each cast-preview card says its state: painting, drawn, plain (no set will come) or failed (Retry)", () => {
  assert.match(studio, /landFrame\(info, index, svg, maker \? "painting" : undefined\)/, "the key-phrase placeholder lands as a PAINTING card, not a finished one");
  assert.match(studio, /if \(event\.notice\) \{.*settle\(info, "plain"\)/, "no set will come (tokens short): plain key-phrase cards, the notice says why");
  assert.match(studio, /if \(event\.setFailed\) \{.*settle\(info, "failed", event\.setFailed\.message\)/, "a failed set marks its cards failed");
  assert.match(studio, /\.finally\(\(\) => \{ if \(maker\) \{ setPaintingSets\(false\); for \(const i of todo\) \{.*settle\(info, "failed", "The set could not be painted\."\)/, "a request that ends with a card still waiting marks it failed, never leaves it shimmering");
  assert.match(canvas, /slot\.phase === "painting" && <div className="sc-frame-painting"/); assert.match(canvas, /slot\.phase === "failed" && <div className="sc-frame-failed"/);
  const routes = readFileSync(new URL("../../backend/src/plan/routes.ts", import.meta.url), "utf8");
  assert.match(routes, /send\(\{ setFailed: \{ set: event\.set, message: event\.setError \} \}\)/, "the server tells the page which set failed");
  // a set that arrives draws the cast on its cards and clears the phase (landFrame without a phase)
  assert.match(studio, /landFrame\(info, i, made\.url\)/);
});
