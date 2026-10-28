import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PLACES, PROPS } from "../vocab.mjs";
const src = fs.readFileSync(new URL("../runtime/doodle.js", import.meta.url), "utf8");

test("the doodle renderer knows every place in the vocabulary (the rendering layer changes, the vocabulary does not)", () => {
  for (const p of Object.keys(PLACES)) assert.ok(new RegExp(`\\b${p}: [0-9.]+`).test(src), `place "${p}" has no horizon in doodle.js`);
});
test("the doodle renderer draws every prop kind", () => {
  for (const p of Object.keys(PROPS)) if (p !== "custom" && p !== "beam") assert.ok(src.includes(`p.kind === "${p}"`), `prop "${p}" is not drawn by doodle.js`);
});
test("every medium has paper, a tone map and a fill mode", () => {
  for (const m of ["marker", "flat", "crayon", "pencil", "woodcut", "chalk"]) assert.ok(new RegExp(`\\b${m}:\\s+\\{ paper: "#[0-9a-f]{6}"[^}]*fill: "(flat|wash|hatch|broken|none)"[^}]*tone:`).test(src), `medium ${m} is incomplete`);
});

test("the doodle engine has every anidoodle mark-making style it claims, each with paper, a tone map and a fill mode", () => {
  for (const m of ["ballpoint", "charcoal", "cyanotype", "sumie", "pixel", "riso", "scratchboard", "engraving"]) assert.ok(new RegExp(`\\b${m}:\\s+\\{ paper: "#[0-9a-f]{6}"[^}]*fill: "(flat|wash|hatch|broken|none)"[^}]*tone:`).test(src), `medium ${m} is incomplete`);
});
test("custom objects are drawn from their recipe, never dropped", () => { assert.ok(src.includes('p.kind === "custom" && p.recipe') && src.includes("recipeItems")); });

test("broken-colour crayon is a style of the doodle engine", () => { assert.ok(/broken:\s+\{ paper: "#[0-9a-f]{6}"[^}]*fill: "broken"[^}]*contour: "own"/.test(src)); assert.ok(src.includes("function dabs")); });

test("narratives and educational explainers have distinct script personas", async () => {
  const { PERSONAS, scriptPersona } = await import("../llm.mjs");
  assert.equal(scriptPersona("A girl and her grandfather plant a lemon tree on a windy hill."), "story");
  assert.equal(scriptPersona("Why does a spinning gyroscope resist gravity?"), "educational");
  assert.equal(scriptPersona("Anything", "3b1b"), "educational");
  assert.equal(scriptPersona("How does gravity work?", "story"), "story");
  assert.doesNotMatch(PERSONAS.story, /3Blue1Brown|Veritasium/);
  assert.match(PERSONAS.educational, /3Blue1Brown|Veritasium/);
});

test("a shape drawn on the ground draws itself during the shot, and the drawer's stick follows its tip", () => {
  assert.ok(src.includes('p.kind === "groundmark"') && src.includes("markShape") && src.includes("reachTo"));
});

test("in side profile, the far arm is drawn behind the torso and the near arm in front (right-facing: left arm behind; left-facing: right arm behind)", () => {
  const fn = src.slice(src.indexOf("function person("), src.indexOf("// ---- interiors"));
  const farLeft = fn.indexOf("if (leftFar) it.push(...leftArm.items)");
  const farRight = fn.indexOf("if (rightFar) it.push(...rightArm.items)");
  const torso = fn.indexOf("it.push(poly([Q([-0.105 * bs, shY])");
  const nearLeft = fn.indexOf("if (!leftFar) it.push(...leftArm.items)");
  const nearRight = fn.indexOf("if (!rightFar) it.push(...rightArm.items)");
  assert.ok(farLeft > 0 && farRight > 0 && torso > farLeft && torso > farRight && nearLeft > torso && nearRight > torso);
});

test("the frame cache is scratch: removed when a render ends unless the caller keeps or names it", async () => {
  const r = (await import("node:fs")).readFileSync(new URL("../render.mjs", import.meta.url), "utf8");
  assert.ok(r.includes("PAINTED_KEEP_CACHE") && r.includes("if (cacheOwned) fs.rmSync(cacheDir"));
});

test("doodle films draw in once (continuous) or at every transition, by the drawIn choice", () => {
  assert.ok(src.includes('"each"') && src.includes('mode === "opening" && !shot.first'));        // "each" is never complete at the start of a shot
  const cli = fs.readFileSync(new URL("../cli.mjs", import.meta.url), "utf8");
  assert.ok(cli.includes('--draw') && cli.includes('continuous: "opening", each: "each"'));
  const player = fs.readFileSync(new URL("../runtime/player.js", import.meta.url), "utf8");
  assert.ok(player.includes('id="cont"') && player.includes("setDrawIn"));
});
