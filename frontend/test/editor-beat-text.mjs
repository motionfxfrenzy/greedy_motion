import assert from "node:assert/strict";
import test from "node:test";
import { readBeatText, writeBeatText } from "../lib/editor/beat-text.ts";

const plan = JSON.stringify({ beats: [{ id: "b1", role: "hook", keyword: "Original Xiaomi", on_screen: "Original Xiaomi, in Pakistan" }, { id: "b2", role: "feature", keyword: "Official", on_screen: "" }] });
const page = (block) => `<html><script id="hf-variables" type="application/json">${JSON.stringify(block)}</script><body></body></html>`;

test("reads each frame's words from the plan", () => {
  const frames = readBeatText(page({ plan }));
  assert.deepEqual(frames.map((f) => [f.id, f.role, f.keyword, f.onScreen]), [["b1", "hook", "Original Xiaomi", "Original Xiaomi, in Pakistan"], ["b2", "feature", "Official", ""]]);
});

test("an edit shows up on the next read and leaves the plan alone", () => {
  const edited = writeBeatText(page({ plan }), "b1.keyword", "Genuine Xiaomi");
  assert.equal(readBeatText(edited)[0].keyword, "Genuine Xiaomi");
  assert.equal(readBeatText(edited)[1].keyword, "Official");
  assert.equal(JSON.parse(/<script id="hf-variables"[^>]*>([\s\S]*?)<\/script>/.exec(edited)[1]).plan, plan);
});

test("an override beats the plan, and a later edit replaces it", () => {
  const first = writeBeatText(page({ plan }), "b2.on_screen", "Warranty included");
  const second = writeBeatText(first, "b2.on_screen", "Two-year warranty");
  assert.equal(readBeatText(second)[1].onScreen, "Two-year warranty");
});

test("words can never close the script element", () => {
  const edited = writeBeatText(page({ plan }), "b1.on_screen", "</script><img src=x onerror=alert(1)>");
  assert.ok(!/<\/script><img/.test(edited));
  assert.equal(readBeatText(edited)[0].onScreen, "</script><img src=x onerror=alert(1)>");
});

test("only frame words are writable; other pages are not storyboard films", () => {
  const html = page({ plan });
  assert.equal(writeBeatText(html, "plan", "x"), html);
  assert.equal(writeBeatText(html, "b1.line", "x"), html);
  assert.equal(readBeatText("<html><body>hi</body></html>"), null);
  assert.equal(readBeatText(page({})), null);
});
