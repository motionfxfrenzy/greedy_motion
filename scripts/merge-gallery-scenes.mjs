// Collects the hand-authored preview scenes (scripts/gallery-scenes/<id>/row.json), validates each one and writes
// packages/contracts/src/gallery-scenes.json. A scene is kept only if its composition and its rendered clip exist.
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { themeIds } from "../packages/contracts/src/themes.ts";

const root = resolve(import.meta.dirname, "..");
const dir = join(root, "scripts/gallery-scenes");
const GROUPS = ["Math", "Tech", "3D", "Flat vector", "Whiteboard", "Blackboard", "Kinetic type", "Screencast", "Data & maps", "Storybook"];
const LOOKS = ["clean", "sketch", "hairline", "doodle", "doodle-crosshatch", "doodle-zigzag"];
const keep = [], dropped = [];
for (const entry of (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory() && e.name !== "vendor").sort((a, b) => a.name.localeCompare(b.name))) {
  const id = entry.name;
  const row = JSON.parse(await readFile(join(dir, id, "row.json"), "utf8").catch(() => "null"));
  if (row?.previewOnly) continue; // a hand-built clip for a catalog row that lives elsewhere (e.g. gallery-opus.json)
  const p = [];
  if (!row) p.push("no row.json");
  else {
    const str = (key, min, max) => { if (typeof row[key] !== "string" || row[key].trim().length < min || row[key].length > max) p.push(`${key} length`); };
    if (row.id !== id) p.push("id");
    str("name", 4, 44); str("summary", 20, 140); str("bestFor", 8, 100); str("prompt", 60, 560);
    if (!GROUPS.includes(row.group)) p.push("group");
    if (!LOOKS.includes(row.look)) p.push("look");
    if (!themeIds.includes(row.theme)) p.push("theme");
    if (!["16:9", "9:16", "1:1"].includes(row.aspect)) p.push("aspect");
    if (!Number.isInteger(row.durationSeconds) || row.durationSeconds < 10 || row.durationSeconds > 120) p.push("duration");
    if (!["snappy", "smooth", "springy"].includes(row.motionProfile)) p.push("motion");
    if (!["calm", "balanced", "fast"].includes(row.pace)) p.push("pace");
    if (!["voiceover", "music", "both", "none"].includes(row.audio)) p.push("audio");
    if (row.source && (!/^Remade from /.test(row.source.label ?? "") || !/^https:\/\//.test(row.source.url ?? ""))) p.push("source");
    if (/%|https?:|#\w|\[|\]/.test(`${row.prompt} ${row.summary}`)) p.push("prompt has a percentage, link, hashtag or placeholder");
  }
  if (!existsSync(join(dir, id, "index.html"))) p.push("no index.html");
  if (!existsSync(join(root, "var/gallery-src", `${id}.mp4`))) p.push("not rendered");
  if (p.length) dropped.push(`${id}: ${p.join(", ")}`);
  else { const { poster, ...rest } = row; keep.push(rest); }
}
await writeFile(join(root, "packages/contracts/src/gallery-scenes.json"), JSON.stringify(keep, null, 1) + "\n");
console.log(`${keep.length} scenes kept, ${dropped.length} dropped`);
for (const line of dropped) console.log("  dropped " + line);
