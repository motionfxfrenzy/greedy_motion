// Cutout tales backend pieces without services: sentence split, voice-take joining (timings), project folder, flag.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.PLANNER = "deterministic";
process.env.DATABASE_URL = "postgres://unused@127.0.0.1:1/unused";
process.env.CUTOUT_TALES_ENABLED = "1";
const { splitSentences, joinTakes, readPcm, buildCutoutProject } = await import("../src/cutout-tales/routes.ts");
const { pcmToWav } = await import("../src/audio/wav.ts");
const { config } = await import("../src/config.ts");
const { cutoutSpecProblems } = await import("../../packages/contracts/src/cutout-tales.ts");

assert.deepEqual(splitSentences("One two.  Three? Four!  Five"), ["One two.", "Three?", "Four!", "Five"]);
const take = (seconds) => pcmToWav(Buffer.alloc(Math.round(24000 * seconds) * 2), 24000, 1);
const joined = joinTakes([take(1), take(2)], ["A.", "B."]);
assert.deepEqual(joined.timings.map((t) => [t.start, t.end]), [[0.3, 1.3], [1.75, 3.75]], "each sentence window sits on the film clock after the 0.3s lead-in and a 0.45s pause");
assert.equal(readPcm(joined.wav).rate, 24000);
assert.throws(() => joinTakes([take(1), pcmToWav(Buffer.alloc(100), 16000, 1)], ["A.", "B."]), /disagree/);

assert.equal(config.cutoutTales, true, "on when the flag is set outside production");
const spec = JSON.parse(await readFile(new URL("../../worker/templates/cutout-tales/samples/red-mesa.json", import.meta.url), "utf8"));
assert.deepEqual(cutoutSpecProblems(spec), []);
const dir = await mkdtemp(join(tmpdir(), "ct-"));
await buildCutoutProject(dir, { ...spec, aspect: "9:16" }, take(1));
const html = await readFile(join(dir, "index.html"), "utf8");
assert.match(html, /data-width="1080" data-height="1920"/); assert.match(html, /<audio id="voiceover" src="audio\/voiceover.wav"/);
assert.match(html, /"spec":\{"version":1,"aspect":"9:16"/); assert.match(html, /<style id="fonts">/); assert.ok(html.includes("Grow With Kaz"));
for (const f of ["vendor/gsap.min.js", "audio/voiceover.wav", "fonts/fonts.css"]) await stat(join(dir, f));
await rm(dir, { recursive: true, force: true });
console.log("cutout-tales route tests passed");
