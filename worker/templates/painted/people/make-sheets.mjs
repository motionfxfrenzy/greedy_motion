#!/usr/bin/env node
/*
 * Character sheets: one Gemini image per group, five different people side by side, in the flat painted-storybook style the engine draws.
 *   node people/make-sheets.mjs [group ...]      (needs GEMINI_API_KEY; writes people/sheets/<group>.png)
 * read-sheets.mjs then reads each sheet back into people.json, the library the engine draws from.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const GROUPS = {
  boy: "five different boys aged about 8 to 12",
  girl: "five different girls aged about 8 to 12",
  young_man: "five different young men aged about 20 to 35",
  young_woman: "five different young women aged about 20 to 35",
  old_man: "five different old men aged about 65 to 85",
  old_woman: "five different old women aged about 65 to 85"
};
const MODEL = process.env.PAINTED_IMAGE_MODEL || "gemini-3.1-flash-image";
const PROMPT = (who) => `Character design sheet for a hand-painted storybook short film. ${who[0].toUpperCase() + who.slice(1)}, standing side by side in one row, evenly spaced, numbered left to right by position only (no text, no numbers, no labels). Each is shown full body from head to feet, facing the viewer, standing straight with arms relaxed at the sides. They must be clearly different from one another: different hair style and colour, different skin tone, different clothes and clothing colours, different build. Simple flat shapes with soft painted brush texture, bold readable silhouettes, limited harmonious palette, the way a children's picture book draws people. Plain light warm-grey background, no shadows on the ground, no scenery, nothing else in the picture.`;

export async function makeSheet(group, apiKey = process.env.GEMINI_API_KEY) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(240_000),
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: PROMPT(GROUPS[group]) }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "1K" } } })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${group}: image request failed (${res.status}) ${body.error?.message?.slice(0, 160) ?? ""}`);
  const part = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.mimeType?.startsWith("image/"));
  if (!part) throw new Error(`${group}: no image returned (${body.candidates?.[0]?.finishReason ?? "unknown"})`);
  const file = path.join(here, "sheets", `${group}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.from(part.inlineData.data, "base64"));
  return file;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const groups = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(GROUPS);
  const results = await Promise.allSettled(groups.map(async (g) => { for (let a = 1; ; a++) { try { return await makeSheet(g); } catch (e) { if (a >= 3) throw e; console.error(e.message + " (retrying)"); } } }));
  results.forEach((r, i) => console.log(r.status === "fulfilled" ? "✓ " + r.value : "✗ " + groups[i] + ": " + r.reason.message));
}
