import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The film must not throb: no looping scale on the camera, the host or a whole subject.
const source = readFileSync(new URL("../../worker/templates/frame-film/frame-film.js", import.meta.url), "utf8");

test("frame film never loops a scale or pops the whole picture on the beat", () => {
  assert.ok(!/repeat:\s*-1/.test(source), "no infinite repeat tweens");
  assert.ok(!/(tl\.(fromTo|to)|gsap\.(fromTo|to))\(\s*host\b/.test(source), "the host (whole picture) is never tweened");
  assert.ok(!/pulses\.forEach/.test(source), "music beats are not turned into per-beat scale pops");
});

test("every scene's camera only pushes in: starts at scale 1, never zooms out", () => {
  const alive = /function alive\(frame\) \{[\s\S]*?\n  \}\n/.exec(source)?.[0] ?? "";
  assert.ok(alive, "alive() camera function exists");
  const cameras = [...alive.matchAll(/tl\.fromTo\(frame\.svg,\s*\{([^}]*)\},\s*\{([^}]*)\}/g)];
  assert.equal(cameras.length, 1, "one camera tween per scene");
  const [, from, to] = cameras[0];
  assert.match(from, /scale:\s*1\b(?!\s*\+)/, "every scene starts from scale 1 (no pop at the cut)");
  const amp = Number(/var amp = [^?]*\?\s*([\d.]+)\s*:\s*([\d.]+)/.exec(alive)?.slice(1).map(Number).reduce((x, y) => Math.max(x, y)));
  assert.ok(amp > 0 && amp <= 0.018, "push-in stays at 1.8% or less");
  assert.match(to, /scale:\s*1\s*\+\s*amp/, "the scene ends larger than it began");
  assert.ok(!/frame\.index\s*%\s*2/.test(alive), "no alternating push and ease-out");
  assert.ok(!/panA|panB/.test(alive), "no pan that would jump at a cut");
});
