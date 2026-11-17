// A scene gets its first draft plus at most 2 repair rounds, across ALL checks together; after that a scene that fails only soft checks is shown (best attempt),
// and the page says "Fixing the scene (repair N of 2)" while a repair runs. Offline. Run: node backend/test/scene-repair-cap.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";
const { SCENE_REPAIR_MAX, sceneCallCap, bestSoftAttempt } = await import("../src/plates/author.ts");
const { fixingOf, REPAIR_ROUNDS_MAX } = await import("../src/plates/service.ts");

assert.equal(SCENE_REPAIR_MAX, 2);
assert.equal(REPAIR_ROUNDS_MAX, 2);
assert.ok(sceneCallCap() <= 3, "the draft plus 2 repairs is the most model calls a scene may use");
// the best attempt is the one with the fewest issues; the first wins a tie
const a = { code: "a", issues: 3, list: "x" }, b = { code: "b", issues: 1, list: "y" }, c = { code: "c", issues: 1, list: "z" };
assert.equal(bestSoftAttempt([a, b, c]).code, "b");
assert.equal(bestSoftAttempt([]), undefined);

// the page's progress: repair N of 2, from the author's note or from a worker send-back; never once the scene is past writing
const v = (over) => ({ state: "authoring", stage: null, repairs: 0, timings: {}, ...over });
assert.deepEqual(fixingOf(v({ timings: { fixing: { round: 1 } } })), { round: 1, of: 2 });
assert.deepEqual(fixingOf(v({ timings: { fixing: { round: 5 } } })), { round: 2, of: 2 }, "never says more than 2");
assert.deepEqual(fixingOf(v({ state: "queued", stage: "repairing", repairs: 1 })), { round: 1, of: 2 });
assert.equal(fixingOf(v({ state: "bundled", timings: { fixing: { round: 1 } } })), undefined);
assert.equal(fixingOf(v()), undefined);

// the loop in author.ts: soft issues are repaired within the cap, then the best attempt is bundled; only hard failures fail (checked in the source, as the loop needs a database)
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/plates/author.ts"), "utf8");
assert.match(src, /used < sceneCallCap\(\)/, "repairs stop at the cap");
assert.match(src, /bestSoftAttempt\(softAttempts\)/, "the best soft attempt is kept");
assert.match(src, /"scene_soft_issues"/, "leftover issues are logged for the owner");
assert.match(src, /noteFixing\(/, "the page is told a repair is running");
assert.doesNotMatch(src, /policyRepairs/, "no per-check repair counter is left");
console.log("scene-repair-cap: ok");
