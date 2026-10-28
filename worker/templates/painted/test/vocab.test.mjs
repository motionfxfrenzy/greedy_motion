import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PLACES, WEATHERS, PROPS, POSES, ROOMS, HOUSE_STYLES } from "../vocab.mjs";
import { directorBrief } from "../brief.mjs";

const scenes = fs.readFileSync(new URL("../runtime/scenes.js", import.meta.url), "utf8"), kit = fs.readFileSync(new URL("../runtime/kit.js", import.meta.url), "utf8");

test("every place in the vocabulary is drawn by the engine", () => {
  for (const p of Object.keys(PLACES)) assert.ok(new RegExp(`\\b${p}: [0-9.]+`).test(scenes), `place "${p}" has no ground line (BASE) in scenes.js`);
  for (const p of Object.keys(PLACES)) if (p !== "custom") assert.ok(scenes.includes(`case "${p}"`) || p === "sky" || p === "interior", `place "${p}" has no case in scenes.js`);
});
test("every weather is known to the engine", () => {
  for (const w of Object.keys(WEATHERS)) assert.ok(new RegExp(`\\b${w}: \\{`).test(scenes) || w === "clear", `weather "${w}" is missing in scenes.js`);
});
test("every prop is drawn", () => {
  for (const p of Object.keys(PROPS)) assert.ok(scenes.includes(`prop.kind === "${p}"`) || scenes.includes(`kind === "${p}"`), `prop "${p}" is not drawn in scenes.js`);
});
test("every pose is drawn", () => { for (const p of POSES) assert.ok(kit.includes(`"${p}"`), `pose "${p}" is not in kit.js`); });
test("every room and house style is drawn", () => {
  for (const r of Object.keys(ROOMS)) assert.ok(kit.includes(`"${r}"`) || kit.includes(`${r}:`), `room "${r}" is not in kit.js`);
  for (const s of HOUSE_STYLES) assert.ok(kit.includes(`${s}:`) || kit.includes(`"${s}"`), `house style "${s}" is not in kit.js`);
});
test("the director's brief lists the whole vocabulary", () => {
  const brief = directorBrief();
  for (const w of [...Object.keys(PLACES), ...Object.keys(WEATHERS), ...Object.keys(PROPS), ...POSES, ...Object.keys(ROOMS), ...HOUSE_STYLES]) assert.ok(brief.includes(w), `"${w}" is not in the brief`);
});

test("the director brief asks for a written scene per line, read against the shots by the verifier", async () => {
  const brief = directorBrief(); assert.match(brief, /"scene"/); assert.match(brief, /Read first, describe, then build/); assert.match(brief, /EVERY object/);
});

test("the director is told to give a made thing its own close shot (a mark drawn on the ground, for one)", async () => {
  const { PROPS } = await import("../vocab.mjs"); assert.ok("groundmark" in PROPS); assert.match(directorBrief(), /Moments worth seeing/);
});
