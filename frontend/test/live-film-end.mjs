// The film stops at its end (lib/live/film-end.ts, components/plate-live-stage.tsx).
// Cause this guards: the stage's tick returns early while the last scene's player says "buffering", so a film whose last frame left the
// player there never reached its end check: `playing` stayed true, the clock stayed at the end and the last frames kept repeating.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FILM_END_GRACE_MS, filmClockAtEnd, filmEndGuardDue } from "../lib/live/film-end.ts";

test("the clock is at the end only for a scene nothing can follow", () => {
  assert.equal(filmClockAtEnd({ localSec: 4.2, sceneDur: 4.17, hasPlayableAfter: false }), true);
  assert.equal(filmClockAtEnd({ localSec: 4.17, sceneDur: 4.17, hasPlayableAfter: false }), true);
  assert.equal(filmClockAtEnd({ localSec: 4.1, sceneDur: 4.17, hasPlayableAfter: false }), false, "still inside the scene");
  assert.equal(filmClockAtEnd({ localSec: 9, sceneDur: 4.17, hasPlayableAfter: true }), false, "a later scene plays on");
});

test("the guard finishes the film after the grace, with no help from the tick", () => {
  assert.equal(filmEndGuardDue(null, 1e9), false, "the end was never reached");
  assert.equal(filmEndGuardDue(1000, 1000 + FILM_END_GRACE_MS - 1), false);
  assert.equal(filmEndGuardDue(1000, 1000 + FILM_END_GRACE_MS), true);
  assert.ok(FILM_END_GRACE_MS >= 300 && FILM_END_GRACE_MS <= 1500, "long enough for the last frames to land, short enough to feel like an end");
});

test("the stage runs the guard on its own timer and stops it with the effect", () => {
  const src = readFileSync(new URL("../components/plate-live-stage.tsx", import.meta.url), "utf8");
  assert.match(src, /const endGuard = window\.setInterval\(/);
  assert.match(src, /filmEndGuardDue\(endReachedAtMs, performance\.now\(\)\)/);
  assert.match(src, /filmClockAtEnd\(\{ localSec, sceneDur, hasPlayableAfter: hasPlayableAfterCurrent\(\) \}\)/);
  assert.equal((src.match(/window\.clearInterval\(endGuard\)/g) ?? []).length, 3, "cleared when the guard fires, when the tick ends the film itself, and on cleanup");
  // the guard marks the clock BEFORE the player's buffering returns (otherwise a stuck player would hide the end from it)
  const mark = src.indexOf("endReachedAtMs = performance.now()");
  const buffering = src.indexOf("fp.scenes[current]?.isBufferingNow || fp.scenes[current]?.isPreparing", mark);
  assert.ok(mark > 0 && buffering > mark, "the end is noticed before the tick can return for buffering");
  // the finish is the one the tick uses: cleanup, then the preview's advanceFrom (which stops playback on the last frame)
  const guard = src.slice(src.indexOf("const endGuard"), src.indexOf("const scheduleNextTick"));
  assert.match(guard, /completeFilmCleanup\(\)/);
  assert.match(guard, /onAdvanceSceneRef\.current\(current\)/);
});

test("the preview's end branch stops on the last frame and Play restarts from the start", () => {
  const src = readFileSync(new URL("../components/plate-preview.tsx", import.meta.url), "utf8");
  const end = src.slice(src.indexOf("const endVerKey = computeFilmVersionKey(scenes)"));
  assert.match(end.slice(0, 1200), /setPlaying\(false\)[\s\S]*setTime\(total\)/);
  assert.match(src, /if \(time >= total - 0\.1\) seek\(0\)/);
});
