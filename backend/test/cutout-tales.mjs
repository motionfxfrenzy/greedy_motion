// Contract tests for the Cutout tales shot list: schema, original-character guard, voiceover timing, flag, and kit parity.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cutoutSpecProblems, resolveCutoutTimings, cutoutTalesEnabled, cutoutNameProblem,
  cutoutSets, cutoutMoods, cutoutProps, cutoutArchetypes, cutoutPoses, cutoutExpressions, cutoutOverlayTypes, cutoutHairs
} from "../../packages/contracts/src/cutout-tales.ts";

const root = new URL("../../worker/templates/cutout-tales/", import.meta.url);
const sample = JSON.parse(readFileSync(new URL("samples/red-mesa.json", root), "utf8"));
assert.deepEqual(cutoutSpecProblems(sample), [], "the bundled sample is a valid spec");
assert.deepEqual(cutoutSpecProblems({ ...sample, aspect: "9:16" }), []);

// Unknown enum, off-catalog appearance option, drawing code smuggled in a field, and overlap-prone raw anchors are refused.
const bad = (mutate) => { const s = structuredClone(sample); mutate(s); return cutoutSpecProblems(s); };
assert.ok(bad((s) => { s.shots[1].set = "nuclear_plant"; }).length);
assert.ok(bad((s) => { s.shots[1].cast[0].look = { evil: "x" }; }).some((p) => /not a known appearance/.test(p)));
assert.ok(bad((s) => { s.shots[1].cast[0].look = { shirt: "url(javascript:1)" }; }).some((p) => /#rrggbb/.test(p)));
assert.ok(bad((s) => { s.shots[1].overlays[0].speaker = 9; }).length);
assert.ok(bad((s) => { s.shots[2].overlays[1].speaker = undefined; }).some((p) => /speaker/.test(p)));
assert.ok(bad((s) => { s.shots[1].t0 = 4; }).some((p) => /contiguous/.test(p)));
assert.ok(bad((s) => { s.duration = 99; }).some((p) => /last shot/.test(p)));
assert.ok(bad((s) => { s.shots[1].cast = new Array(6).fill(s.shots[1].cast[0]); }).length);
assert.ok(bad((s) => { s.shots[1].overlays[0].text = "x".repeat(500); }).length);
assert.ok(cutoutSpecProblems("nope").length && cutoutSpecProblems({}).length);

// Original characters only.
assert.ok(cutoutNameProblem("Arthur Morgan"));
assert.ok(cutoutNameProblem("Mario"));
assert.equal(cutoutNameProblem("Cade"), null);
assert.ok(bad((s) => { s.shots[1].cast[0].name = "Arthur Morgan"; }).some((p) => /existing character/.test(p)));
assert.ok(bad((s) => { s.shots[1].overlays[0].text = "BATMAN"; }).some((p) => /existing character/.test(p)));

// Voiceover timing: shots are driven by sentence windows and abut.
const sentences = [{ start: 0.3, end: 4 }, { start: 4.6, end: 8 }, { start: 8.5, end: 13 }, { start: 13.4, end: 20 }];
const draft = {
  aspect: "16:9",
  shots: [
    { sentences: [0, 0], set: "silhouette", mood: "gold", props: ["riders"], cast: [], overlays: [{ type: "title", text: "HELLO", atSentence: 0, offset: 0.5 }] },
    { sentences: [1, 3], set: "western_town", mood: "dusk",
      cast: [
        { archetype: "drifter", name: "Cade", x: 0.4, talkSentences: [0, 2], gestures: [{ atSentence: 1, pose: "point" }] },
        { archetype: "scamp", name: "Tuck", x: 0.75 }
      ],
      overlays: [{ type: "bubble", text: "Howdy.", speaker: 0, atSentence: 0 }, { type: "tag", text: "CADE", target: 0, atSentence: 1 }] }
  ]
};
const resolved = resolveCutoutTimings(draft, sentences);
assert.ok("spec" in resolved, JSON.stringify(resolved));
const { spec } = resolved;
assert.equal(spec.shots[0].t0, 0);
assert.equal(spec.shots[0].t1, 4.6, "shot 0 runs to the next shot's first sentence");
assert.equal(spec.shots[1].t0, 4.6);
assert.equal(spec.duration, 21.2);
assert.equal(spec.shots[1].t1, 21.2);
assert.deepEqual(spec.shots[1].cast[0].talk, [[0, 3.4], [8.8, 15.4]], "talking mouth follows the sentence windows");
assert.equal(spec.shots[1].cast[0].gestures[0].t, 3.9);
const bubble = spec.shots[1].overlays[0];
assert.ok(bubble.t1 > bubble.t0 && bubble.t1 <= 3.4 + 0.31, "bubble lasts its sentence");
assert.deepEqual(cutoutSpecProblems(spec), []);
assert.ok("error" in resolveCutoutTimings({ ...draft, shots: [draft.shots[1]] }, sentences), "shots must cover every sentence from 0");
assert.ok("error" in resolveCutoutTimings(draft, sentences.slice(0, 2)), "range beyond the sentences is refused");

// Staging-only flag.
assert.equal(cutoutTalesEnabled({ CUTOUT_TALES_ENABLED: "1", APP_ENV: "staging" }), true);
assert.equal(cutoutTalesEnabled({ CUTOUT_TALES_ENABLED: "1", APP_ENV: "production" }), false);
assert.equal(cutoutTalesEnabled({ APP_ENV: "staging" }), false);

// The contract vocabulary and the renderer kit must not drift apart.
await import(new URL("kit.js", root).href); // browser-global script: registers globalThis.CutoutKit
const kit = globalThis.CutoutKit;
const same = (a, b, name) => assert.deepEqual([...a].sort(), [...b].sort(), `${name} differ between contract and kit`);
same(cutoutSets, kit.SETS, "sets"); same(cutoutMoods, kit.MOODS, "moods"); same(cutoutProps, kit.PROPS, "props");
same(cutoutArchetypes, kit.ARCHETYPES, "archetypes"); same(cutoutPoses, kit.POSES, "poses"); same(cutoutExpressions, kit.EXPRESSIONS, "expressions");
same(cutoutOverlayTypes, kit.OVERLAYS, "overlays"); same(cutoutHairs, kit.HAIRS, "hairs");
console.log("cutout-tales contract tests passed");
