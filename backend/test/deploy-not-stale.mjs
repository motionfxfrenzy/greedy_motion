// A deploy must never make a film that is already drawn look stale or charge to redraw it: new code (kit, prompts, engine, set-brief/plan versions) applies to
// scenes drawn from then on; only the person's own edits change what a scene needs. Offline. Run: node backend/test/deploy-not-stale.mjs
import assert from "node:assert/strict";
process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";
const { variantSignature } = await import("../src/plates/model.ts");
const { matchVariantsToDesired, SIGNATURE_FORMULA } = await import("../src/plates/store.ts");
const fp = await import("../src/plates/film-props.ts");

const base = { look: "story-cartoon", styleExample: "history-reel", film: "the film", castKeywords: ["A"], beat: { keyword: "A", visual: "[lab] wide", onScreen: "", line: "hello" }, frames: 120, aspect: "9:16" };
// 1. the signature does not carry any code version
const a = variantSignature({ ...base, engineDigest: "e1", styleDigest: "s1", promptDigest: "p1:kit1" });
const b = variantSignature({ ...base, engineDigest: "e2", styleDigest: "s2", promptDigest: "p2:kit2" });
assert.equal(a, b, "a new engine, style, prompt or template kit leaves every signature as it was");
assert.notEqual(a, variantSignature({ ...base, beat: { ...base.beat, line: "hello there" } }), "the person's own edit still changes it");

// 2. a film drawn before this change (signed with the old formula, no sigFormula) is still drawn: matched, nothing to author, quote zero
const oldRow = (i) => ({ id: "r" + i, scene_index: i, aspect: "9:16", keyword: "K" + i, frames: 100 + i, signature: "v3:" + "0".repeat(23) + i, state: "drawn", bundle_key: "b" + i, clip_key: "c" + i, source_key: "s" + i, timings: { contentSig: "v3:old" + i } });
const rows = [0, 1, 2].map(oldRow);
const desired = (i, over = {}) => ({ index: i, aspect: "9:16", keyword: "K" + i, frames: 100 + i, width: 1080, height: 1920, signature: a.slice(0, -1) + i, contentSignature: a, ...over });
let m = matchVariantsToDesired(rows, [0, 1, 2].map((i) => desired(i)));
assert.equal(m.matched.size, 3, "all three scenes of the earlier film stay matched (quote: 0 scenes to author, 0 tokens)");
// 3. the person's own edit: the scene's name or length moved -> that scene needs a redraw, the others do not
m = matchVariantsToDesired(rows, [desired(0), desired(1, { frames: 140 }), desired(2, { keyword: "Renamed" })]);
assert.deepEqual([...m.matched.keys()].sort(), ["0:9:16"], "only the untouched scene stays; the edited ones need an update");
// 4. once re-signed by the new formula the rule is strict again: a different signature no longer matches
const resigned = rows.map((r) => ({ ...r, timings: { ...r.timings, sigFormula: SIGNATURE_FORMULA }, signature: a.slice(0, -1) + r.scene_index, keyword: r.keyword }));
m = matchVariantsToDesired(resigned, [desired(0), desired(1, { signature: "v3:" + "f".repeat(24), contentSignature: "v3:" + "e".repeat(24) }), desired(2)]);
assert.deepEqual([...m.matched.keys()].sort(), ["0:9:16", "2:9:16"]);
// a scene that is only queued (nothing drawn) is never adopted
m = matchVariantsToDesired([{ ...oldRow(0), state: "queued", bundle_key: null }], [desired(0)]);
assert.equal(m.matched.size, 0);

// 5. film props: a file made when their hash carried the kit is kept (no second plan or drawing call), and a new kit does not invalidate a current one
const beats = [{ line: "l", visual: "v" }, { line: "l2", visual: "v2" }];
assert.equal(fp.filmPropsHash(beats, null, "kit1"), fp.filmPropsHash(beats, null, "kit2"), "the props hash follows the script, not the kit");
assert.equal(fp.filmPropsStillValid({ hash: "legacy-with-kit" }, fp.filmPropsHash(beats, null)), true, "a file from before is kept");
assert.equal(fp.filmPropsStillValid({ hash: "x", format: fp.FILM_PROPS_FORMAT }, fp.filmPropsHash(beats, null)), false, "an edited script re-plans");
assert.equal(fp.filmPropsStillValid({ hash: fp.filmPropsHash(beats, null), format: fp.FILM_PROPS_FORMAT }, fp.filmPropsHash(beats, null)), true);
console.log("deploy-not-stale: ok");
