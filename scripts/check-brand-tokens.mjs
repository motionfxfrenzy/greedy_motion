// Brand-consistency lint: a composition must take every colour and typeface from the brand theme tokens
// (--bg, --fg, --brand, --accent, --font-display, …), never from literals, so the brand kit read from the
// customer's website is what every video shows. Scans the render engine, starter templates and creative
// spikes. Allowed literals: neutral black/white shadows and scrims (rgba(0,0,0,a) / rgba(255,255,255,a)),
// `transparent`, and fallbacks inside var(--token, fallback).
//   node scripts/check-brand-tokens.mjs            → lists violations, exits 1 if any are new
//   node scripts/check-brand-tokens.mjs --baseline → records today's violations as accepted (for legacy files)
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const SCAN = ["worker/templates", "validation/creative-libraries"];
const BASELINE = join(root, "scripts/brand-tokens-baseline.json");
const EXT = /\.(html|css|js|mjs)$/;
const SKIP = /(^|\/)(vendor|assets|sfx|node_modules|snapshots)(\/|$)/;

const NEUTRAL = /^rgba?\(\s*(0\s*,\s*0\s*,\s*0|255\s*,\s*255\s*,\s*255)\s*(,\s*[\d.]+\s*)?\)$/i;

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name);
    if (SKIP.test(relative(root, path))) continue;
    if (entry.isDirectory()) yield* files(path);
    else if (EXT.test(entry.name)) yield path;
  }
}

/** Removes var(--x, fallback) fallbacks so literals there are allowed. */
const stripFallbacks = (line) => line.replace(/var\(\s*--[\w-]+\s*,[^()]*(\([^()]*\))?[^()]*\)/g, "var()");

// Third-party libraries inlined into a page (e.g. <script id="bp-rough">) keep their own defaults; our code
// overrides every colour they draw with, so their blocks are blanked (line numbers kept) before scanning.
const VENDORED = /<script id="bp-rough">[\s\S]*?<\/script>/g;

function violations(source) {
  const found = [];
  const text = source.replace(VENDORED, (block) => block.replace(/[^\n]/g, ""));
  text.split("\n").forEach((raw, index) => {
    const line = stripFallbacks(raw);
    if (/^\s*(\/\/|\*|\/\*|<!--)/.test(line)) return;
    // Colour functions only when they hold numbers: `rgb(s)` in engine code is a helper call, not a colour.
    for (const m of line.matchAll(/#[0-9a-f]{3,8}\b(?![\w-])|\b(rgba?|hsla?|oklch|lab|lch)\(\s*[\d.]+[^)]*\)/gi)) {
      const literal = m[0];
      if (literal.startsWith("#") && /(href|url|src|id|getElementById|querySelector|selector)\b|["'`]#[a-z]/i.test(line.slice(Math.max(0, m.index - 30), m.index + 1))) continue;
      if (NEUTRAL.test(literal)) continue;
      found.push({ line: index + 1, kind: "colour", literal });
    }
    for (const m of line.matchAll(/font-family\s*:\s*([^;"}]+)/gi)) {
      if (!/var\(/.test(m[1]) && !/\b(inherit|initial|unset)\b/.test(m[1])) found.push({ line: index + 1, kind: "font", literal: m[1].trim().slice(0, 60) });
    }
  });
  return found;
}

const all = {};
for (const base of SCAN) for await (const file of files(join(root, base))) {
  const found = violations(await readFile(file, "utf8"));
  if (found.length) all[relative(root, file)] = found;
}

const key = (file, v) => `${file}|${v.kind}|${v.literal}`;
if (process.argv.includes("--baseline")) {
  await writeFile(BASELINE, JSON.stringify(Object.entries(all).flatMap(([f, list]) => list.map((v) => key(f, v))).sort(), null, 2) + "\n");
  console.log(`baseline written: ${Object.values(all).flat().length} accepted literals in ${Object.keys(all).length} files`);
  process.exit(0);
}
const accepted = new Set(JSON.parse(await readFile(BASELINE, "utf8").catch(() => "[]")));
let fresh = 0;
for (const [file, list] of Object.entries(all)) for (const v of list) {
  if (accepted.has(key(file, v))) continue;
  fresh++;
  console.log(`${file}:${v.line}  hard-coded ${v.kind} ${v.literal}  → use a theme token (var(--brand), var(--font-display), …)`);
}
console.log(fresh ? `${fresh} brand-token violation(s)` : `brand tokens ok (${accepted.size} accepted legacy literals)`);
process.exit(fresh ? 1 : 0);
