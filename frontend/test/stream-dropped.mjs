import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A progress stream cut by a backend restart is not success: the page resumes instead of treating the animation as done, and the scene
// status poll keeps asking (with growing waits) until the stored scenes load. Source-level checks: the code paths need a signed-in browser.
const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8");
const studio = readFileSync(new URL("../components/studio.tsx", import.meta.url), "utf8");
const preview = readFileSync(new URL("../components/plate-preview.tsx", import.meta.url), "utf8");

test("a stream that ends without its done event throws StreamDropped", () => {
  assert.match(api, /class StreamDropped extends Error/);
  assert.match(api, /if \(!sawDone\) throw new StreamDropped\(\)/);
});
test("the studio resumes after a dropped stream, a few times, with a wait", () => {
  assert.match(studio, /dropped instanceof StreamDropped/);
  assert.match(studio, /attempt \+= 1\) > 4/);
});
test("the scene poll never gives up: backoff after errors, a slow poll while not settled, wake on online/visible", () => {
  assert.match(preview, /failedPolls \+= 1/);
  assert.match(preview, /if \(!settled\) schedulePoll\(8000\)/);
  assert.match(preview, /addEventListener\("online", wake\)/);
  assert.match(preview, /addEventListener\("visibilitychange", wake\)/);
});
