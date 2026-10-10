// Validates the remade prompt rows in scripts/gallery-opus/output-*.json and writes
//   packages/contracts/src/gallery-opus.json  the catalog rows (no preview plans)
//   scripts/gallery-opus/plans.json           the 5-second preview plans, read by build-gallery-previews.mjs
// Rows that fail a rule are listed and dropped, never patched.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { themeIds } from "../packages/contracts/src/themes.ts";

const root = resolve(import.meta.dirname, "..");
const dir = join(root, "scripts/gallery-opus");
const GROUPS = ["Explainer", "Story", "Showreel", "Product", "Typography", "Data", "How-to", "Social"];
const LOOKS = ["clean", "sketch", "hairline", "doodle", "doodle-crosshatch", "doodle-zigzag"];
/** Cards removed on purpose because another card already covers the same post or idea. Keep them out of every re-merge. */
const retired = new Set(["opus-tak3sh8-441895", "opus-demonugc-525162", "opus-twoclipping-402193", "opus-arthurkatcher-604161", "opus-parkerrex-701462"]);
const rows = [];
for (const file of (await readdir(dir)).filter((f) => /^output-\d+\.json$/.test(f)).sort()) rows.push(...JSON.parse(await readFile(join(dir, file), "utf8")).filter((row) => !retired.has(row.id)));

const problems = (row) => {
  const p = [];
  const str = (key, min, max) => { if (typeof row[key] !== "string" || row[key].trim().length < min || row[key].length > max) p.push(`${key} length`); };
  if (!/^opus-[a-z0-9-]+$/.test(row.id ?? "")) p.push("id");
  str("name", 4, 40); str("summary", 20, 130); str("bestFor", 8, 90); str("prompt", 60, 560);
  if (!GROUPS.includes(row.group)) p.push("group");
  if (!LOOKS.includes(row.look)) p.push("look");
  if (!themeIds.includes(row.theme)) p.push("theme");
  if (!["16:9", "9:16", "1:1"].includes(row.aspect)) p.push("aspect");
  if (!Number.isInteger(row.durationSeconds) || row.durationSeconds < 10 || row.durationSeconds > 120) p.push("duration");
  if (!["snappy", "smooth", "springy"].includes(row.motionProfile)) p.push("motion");
  if (!["calm", "balanced", "fast"].includes(row.pace)) p.push("pace");
  if (!["voiceover", "music", "both", "none"].includes(row.audio)) p.push("audio");
  if (!/^Remade from /.test(row.source?.label ?? "") || !/^https:\/\//.test(row.source?.url ?? "")) p.push("source");
  if (/%|https?:|#\w|\[|\]/.test(`${row.prompt} ${row.summary}`)) p.push("prompt has a percentage, link, hashtag or placeholder");
  const beats = row.plan?.beats;
  if (!Array.isArray(beats) || beats.length < 3 || beats.length > 4) p.push("beats count");
  else {
    let t = 0;
    for (const b of beats) {
      if (!["kinetic", "ui", "title"].includes(b.kind) || typeof b.keyword !== "string" || b.keyword.length < 2 || b.keyword.length > 34) p.push("beat text");
      if (typeof b.on_screen === "string" && b.on_screen.length > 44) p.push("beat sub text");
      if (Math.abs(b.start - t) > 0.01 || b.end - b.start < 1) p.push("beat timing");
      if (b.kind === "ui" && !(b.ui && b.verb)) p.push("ui beat");
      if (/%|\d\s?x\b/i.test(`${b.keyword} ${b.on_screen ?? ""}`)) p.push("invented figure in plan");
      t = b.end;
    }
    if (Math.abs(t - 5) > 0.01) p.push("beats end at " + t);
  }
  return p;
};

const seen = new Set(), names = new Set(), keep = [], plans = {}, dropped = [];
for (const row of rows) {
  const p = problems(row);
  if (seen.has(row.id)) p.push("duplicate id");
  if (names.has(row.name.toLowerCase())) p.push("duplicate name");
  if (p.length) { dropped.push(`${row.id}: ${[...new Set(p)].join(", ")}`); continue; }
  seen.add(row.id); names.add(row.name.toLowerCase());
  const { plan, ...rest } = row;
  keep.push(rest);
  plans[row.id] = plan;
}
await writeFile(join(root, "packages/contracts/src/gallery-opus.json"), JSON.stringify(keep, null, 1) + "\n");
await writeFile(join(dir, "plans.json"), JSON.stringify(plans, null, 1) + "\n");
console.log(`${keep.length} rows kept, ${dropped.length} dropped`);
for (const line of dropped) console.log("  dropped " + line);
