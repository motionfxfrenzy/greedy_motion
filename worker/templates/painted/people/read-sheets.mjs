#!/usr/bin/env node
/*
 * Reads every character sheet in people/sheets with a Gemini vision model and writes people/people.json, the library the engine draws people from:
 * for each of the five people on a sheet (left to right), the traits the painter can draw (hair style and colour, skin, clothes, dress, build, relative height)
 * and one line saying who they are. Run after make-sheets.mjs:  node people/read-sheets.mjs  (needs GEMINI_API_KEY)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askJson } from "../llm.mjs";
import { GROUPS } from "./make-sheets.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
// What each group means to the engine: age class, gender, and the usual height in metres (the sheet then says shorter or taller than usual).
export const BASE = {
  boy: { age: "child", gender: "m", heightM: 1.4 }, girl: { age: "child", gender: "f", heightM: 1.35 },
  young_man: { age: "young", gender: "m", heightM: 1.78 }, young_woman: { age: "young", gender: "f", heightM: 1.65 },
  old_man: { age: "old", gender: "m", heightM: 1.7 }, old_woman: { age: "old", gender: "f", heightM: 1.58 }
};
const SYSTEM = `You read a character design sheet for a 2D painted-film engine and describe each person in the engine's terms. The picture shows five people in a row. Describe them LEFT TO RIGHT, exactly five entries.
For each person give:
- "name": a short first name that suits them (not printed text)
- "desc": ONE plain sentence for a film director: who they are and what stands out (e.g. "a stout old man in a navy cable-knit jumper with round glasses and curly grey hair")
- "hair": the nearest engine hair style: "short" (short or curly or cropped hair), "long" (hair past the shoulders, loose, plaits, ponytail), "bun" (hair gathered up in a bun or top knot), "beard" (a clear beard, with whatever hair they have), "bald" (no hair on top), "hood" (hood or hat covering the hair)
- "hairColor": hex #rrggbb of the hair, sampled from the picture
- "skin": hex #rrggbb of the skin tone, sampled from the picture
- "top": hex of the main upper-body garment (the coat or jumper that shows most)
- "bottom": hex of the trousers or leggings; for a dress or skirt use the legs' colour (tights, or skin if bare)
- "dress": true if they wear a dress or skirt that hangs to about the knee, else false
- "build": "slim", "average" or "stocky"
- "height": "short", "average" or "tall" compared with the others in THIS row
- "extras": list of any of "glasses", "cane", "hat", "scarf", "apron", "braid", "curly" that clearly apply (can be empty)
Answer JSON only: {"people":[{...} x5]}`;

const out = { version: 1, generated: new Date().toISOString().slice(0, 10), groups: {} };
const HEX = /^#[0-9a-f]{6}$/i, STYLES = ["short", "long", "bun", "beard", "bald", "hood"];
for (const group of Object.keys(GROUPS)) {
  const file = path.join(here, "sheets", `${group}.png`);
  if (!fs.existsSync(file)) { console.error(`✗ ${group}: no sheet (run make-sheets.mjs)`); continue; }
  let people;
  for (let attempt = 1; ; attempt++) {
    try {
      const v = await askJson({ engine: "gemini", system: SYSTEM, user: `This is the sheet for: ${GROUPS[group]}.`, images: [{ mime: "image/png", base64: fs.readFileSync(file).toString("base64") }], maxTokens: 8000, temperature: 0.2, timeoutMs: 180_000 });
      people = v.people;
      if (!Array.isArray(people) || people.length !== 5) throw new Error(`expected 5 people, got ${people?.length}`);
      for (const p of people) {
        if (!STYLES.includes(p.hair)) throw new Error(`hair "${p.hair}"`);
        for (const k of ["hairColor", "skin", "top", "bottom"]) if (!HEX.test(p[k] ?? "")) throw new Error(`${k} "${p[k]}" is not a hex colour`);
      }
      break;
    } catch (e) { console.error(`${group} attempt ${attempt}: ${e.message}`); if (attempt >= 3) throw e; }
  }
  const base = BASE[group], tall = { short: -0.06, average: 0, tall: 0.06 };
  out.groups[group] = { ...base, people: people.map((p, i) => ({
    id: `${group}_${i + 1}`, name: String(p.name).slice(0, 20), desc: String(p.desc).slice(0, 160), hair: p.hair, hairColor: p.hairColor.toLowerCase(), skin: p.skin.toLowerCase(),
    top: p.top.toLowerCase(), bottom: p.bottom.toLowerCase(), dress: Boolean(p.dress), build: ["slim", "average", "stocky"].includes(p.build) ? p.build : "average",
    heightM: Number((base.heightM * (1 + (tall[p.height] ?? 0))).toFixed(2)), extras: (p.extras ?? []).filter((x) => typeof x === "string").slice(0, 4)
  })) };
  console.log(`✓ ${group}: ` + people.map((p) => p.name).join(", "));
}
fs.writeFileSync(path.join(here, "people.json"), JSON.stringify(out, null, 1));
console.log("✓ people/people.json");
