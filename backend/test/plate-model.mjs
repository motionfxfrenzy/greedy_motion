// Plate model: what changes a scene's signature (and what must not), the integer-frame timeline, stream-copy eligibility,
// subtitle settings, and the pure cue rules. No database, no network.
// Run: node backend/test/plate-model.mjs
import assert from "node:assert/strict";
process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";
const m = await import("../src/plates/model.ts");

const base = { look: "illus-fox", engineDigest: "e1", styleDigest: "s1", promptDigest: "p1", film: "A film about a keeper", castKeywords: ["Keeper", "Lantern"], beat: { keyword: "Keeper", visual: "A keeper climbs", onScreen: null, line: "He climbs." }, frames: 90, aspect: "16:9" };
const sig = (over = {}) => m.variantSignature({ ...base, ...over, beat: { ...base.beat, ...(over.beat ?? {}) } });

// --- what redraws
assert.equal(sig(), sig(), "signature is stable");
assert.ok(m.isCurrentSignature(sig()), "signatures carry the pipeline version");
for (const [name, over] of Object.entries({
  "engine version": { engineDigest: "e2" }, "style source": { styleDigest: "s2" }, "prompt template": { promptDigest: "p2" }, "film brief": { film: "Another film" },
  "shared cast": { castKeywords: ["Keeper", "Boat"] }, "visual line": { beat: { visual: "A keeper falls" } }, "narration": { beat: { line: "He falls." } },
  "length": { frames: 91 }, "aspect": { aspect: "9:16" }, "style": { look: "illus-balloon" }
})) assert.notEqual(sig(over), sig(), `${name} changes the artwork signature`);
assert.notEqual(sig({ aspect: "9:16" }), sig({ aspect: "1:1" }), "each ratio has its own signature");
// the signature takes no audio/subtitle input at all: those cannot invalidate artwork
assert.equal(m.variantSignature.length, 1);
assert.equal(m.isCurrentSignature("v2:abcdef"), false, "a legacy signature is never reused");
assert.equal(m.isCurrentSignature("0123456789abcdef"), false);
assert.equal(m.isCurrentSignature(null), false);

// --- the export is a different layer: subtitles/audio change it, artwork stays
const clips = [{ sig: "a", clipKey: "k1" }, { sig: "b", clipKey: "k2" }];
const ex = (over = {}) => m.exportSignature({ aspect: "16:9", clips, timelineFrames: [90, 60], subtitles: { mode: "full", style: "pill" }, audio: { music: "m1" }, cues: [], watermark: false, ...over });
assert.equal(ex(), ex());
assert.notEqual(ex({ subtitles: { mode: "full", style: "paper" } }), ex(), "subtitle style re-assembles");
assert.notEqual(ex({ audio: { music: "m2" } }), ex(), "music re-assembles");
assert.notEqual(ex({ clips: [{ sig: "a", clipKey: "k1" }, { sig: "b", clipKey: "k3" }] }), ex(), "a redrawn clip re-assembles");
assert.notEqual(ex({ watermark: true }), ex(), "the plan's watermark is part of the film");

// --- timeline: integer frames, voiceover never cut off, never shortened
const tl = m.buildTimeline([90, 105, 60], [undefined, 3.4, 1]);
assert.deepEqual(tl.frames, [90, 110, 60], "a take longer than its scene (plus 0.25 s) lengthens the scene to whole frames");
assert.deepEqual(tl.starts, [0, 90, 200]);
assert.equal(tl.totalFrames, 260);
assert.ok(tl.frames.every(Number.isInteger));
assert.deepEqual(m.buildTimeline([60], [0.5]).frames, [60], "a short take never shortens the scene");

// --- stream copy: exact frames, nothing touching pixels
const good = { codec: "h264", width: 1920, height: 1080, pixFmt: "yuv420p", fps: 30, frames: 90 };
const size = { w: 1920, h: 1080 };
assert.equal(m.canStreamCopy([good, { ...good, frames: 60 }], [90, 60], size, 0), true);
assert.equal(m.canStreamCopy([good], [90], size, 1), false, "subtitles or a watermark need encoding");
assert.equal(m.canStreamCopy([{ ...good, frames: 89 }], [90], size, 0), false, "one frame short: no stream copy, and the timeline is not shortened to fit");
assert.equal(m.canStreamCopy([{ ...good, width: 1080 }], [90], size, 0), false);
assert.equal(m.canStreamCopy([{ ...good, fps: 25 }], [90], size, 0), false);
assert.equal(m.canStreamCopy([{ ...good, pixFmt: "yuv444p" }], [90], size, 0), false);

// --- subtitle settings
const defaults = m.defaultSubtitlesFor({ brief: { look: "illus-blueprint" } });
assert.equal(defaults.style, "blueprint");
assert.equal(defaults.mode, "full");
assert.equal(defaults.y, 70);
const merged = m.mergeSubtitles(defaults, { size: 500, opacity: 5, x: -4, color: "#abcdef", music: false, transitions: true, aspects: ["9:16", "bogus"], scenePositions: { 0: { x: 20, y: 30 }, x: { x: 1, y: 1 } } }, "16:9");
assert.equal(merged.size, 160); assert.equal(merged.opacity, 20); assert.equal(merged.x, 8);
assert.equal(merged.color, "#abcdef"); assert.equal(merged.music, false); assert.equal(merged.transitions, true); assert.equal(merged.sfx, true);
assert.deepEqual(merged.aspects, ["9:16"]); assert.deepEqual(Object.keys(merged.scenePositions), ["0"]);
assert.equal(m.mergeSubtitles(merged, { color: "javascript:1" }, "16:9").color, "#abcdef", "an invalid color keeps the current one");
assert.equal(m.mergeSubtitles(merged, { scenePositions: null }, "16:9").scenePositions && Object.keys(m.mergeSubtitles(merged, { scenePositions: null }, "16:9").scenePositions).length, 0);

// --- cues
assert.equal(m.buildSubtitleCues([], [], [], [], "none").length, 0);
const cues = m.buildSubtitleCues([{ index: 0, keyword: "k", state: "drawn", seconds: 3, frames: 90, sig: "s" }], [{ keyword: "k", visual: null, onScreen: null, line: "one two three four five six seven eight" }], [3], [0], "full");
assert.equal(cues.length, 2); assert.ok(cues.every((c) => c.start >= 0 && c.end <= 3));
const sfx = m.sceneSfxCues({ keyword: "the lantern glowed" }, [{ text: "lantern", start: 0.5, end: 0.9 }], 3, 1);
assert.equal(sfx[0].name, "chime");
assert.equal(m.sceneTransitionCues(3, 2, 3).length, 0, "the last scene has no transition sound");
console.log("plate model: ok");
