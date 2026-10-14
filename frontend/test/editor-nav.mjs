import assert from "node:assert/strict";
import test from "node:test";
import { cameFrom } from "../lib/editor/nav.ts";

const here = "http://localhost:3000";
test("back goes to the page the editor was opened from", () => {
  assert.equal(cameFrom(`${here}/studio?p=abc&step=1`, here), "/studio?p=abc&step=1");
  assert.equal(cameFrom(`${here}/templates`, here), "/templates");
});
test("no referrer, another site or another editor page falls back", () => {
  assert.equal(cameFrom("", here), null);
  assert.equal(cameFrom("https://example.com/studio", here), null);
  assert.equal(cameFrom(`${here}/editor/other`, here), null);
  assert.equal(cameFrom("not a url", here), null);
});
