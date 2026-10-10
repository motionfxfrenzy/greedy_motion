// Renders the two previews of every generated style: a Story & film one (the whole scene, full frame, with a caption)
// and a SaaS one (the same scene behind a product screen and headline), each 5 seconds, on this machine.
//   node --experimental-strip-types scripts/build-gallery-styles.mjs [look-id ...] [--rows-only]
// Art: third_party/gallery-art (paper, clay, editorial frames) and third_party/anidoodle/references (illustration styles).
// Writes var/gallery-src/story-<look>.mp4|jpg and saas-<look>.mp4|jpg, and packages/contracts/src/gallery-styles.json.
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "var/gallery-src");
const hyperframes = join(root, "worker/node_modules/.bin/hyperframes");
const catalog = JSON.parse(await readFile(join(root, "packages/contracts/src/style-library/catalog.json"), "utf8"));
const anidoodle = JSON.parse(await readFile(join(root, "third_party/anidoodle/styles.gen.json"), "utf8"));
const heroes = Object.fromEntries(anidoodle.map((style) => ["illus-" + style.id.replace(/([A-Z])/g, "-$1").toLowerCase(), style.hero]));
const args = process.argv.slice(2);
const rowsOnly = args.includes("--rows-only");
const wanted = args.filter((arg) => !arg.startsWith("--"));
const onlyMode = args.find((arg) => arg.startsWith("--mode="))?.slice(7);

/** The art we have for each generated look. A look without safe art of its own is left out of the gallery. */
const art = (look) => {
  const own = join(root, "third_party/gallery-art", `${look.id}.jpg`);
  if (existsSync(own)) return { story: own, saas: existsSync(join(root, "third_party/gallery-art", `${look.id}-ui.jpg`)) ? join(root, "third_party/gallery-art", `${look.id}-ui.jpg`) : own };
  const illustration = join(root, "third_party/anidoodle/references", `${look.id}.jpg`);
  return existsSync(illustration) ? { story: illustration, saas: illustration } : null;
};
const captions = ["A small moment, told slowly.", "The morning everything changed.", "Made by hand. Felt by everyone.", "One scene. One feeling.", "Where the story begins.", "Every frame, crafted."];
const clean = (name) => name.replace(/^(Illustration|Vox) · /, "");

const looks = catalog.filter((look) => look.renderMode === "generated" && art(look));
const rows = looks.map((look, index) => ({ look: look.id, name: clean(look.name), group: look.group, description: look.description, hero: heroes[look.id] ?? null, caption: captions[index % captions.length] }));
await writeFile(join(root, "packages/contracts/src/gallery-styles.json"), JSON.stringify(rows, null, 1) + "\n");
console.log(`${rows.length} styles with art`);
if (rowsOnly) process.exit(0);

await mkdir(out, { recursive: true });
const template = await readFile(join(root, "scripts/gallery-art/template.html"), "utf8");
const fontCss = await readFile(join(root, "worker/fonts/fonts.css"), "utf8");
const storyClasses = /class="(?:fill|scene|layer (?:sway|sweep|motes|vignette))\b|<svg width="0"|<feTurb/;
const saasClasses = /class="(?:cover|layer wash|headline|sub|pill|card)\b/;

for (const [index, row] of rows.entries()) {
  if (wanted.length && !wanted.includes(row.look)) continue;
  const sources = art(looks[index]);
  for (const mode of ["story", "saas"]) {
    if (onlyMode && mode !== onlyMode) continue;
    const id = `${mode}-${row.look}`;
    const dir = await mkdtemp(join(tmpdir(), `style-${id}-`));
    try {
      await cp(sources[mode], join(dir, "art.jpg"));
      await cp(join(root, "worker/templates/product-launch/assets/screenshot.svg"), join(dir, "shot.svg"));
      await mkdir(join(dir, "vendor"), { recursive: true });
      await cp(join(root, "node_modules/gsap/dist/gsap.min.js"), join(dir, "vendor/gsap.min.js"));
      await cp(join(root, "worker/fonts"), join(dir, "fonts"), { recursive: true });
      // Tall art (paper and clay panels) fills the frame; square plates stay whole.
      const [w, h] = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", sources[mode]], { encoding: "utf8" }).trim().split(",").map(Number);
      const tall = w / h < 0.8;
      const keep = mode === "story" ? storyClasses : saasClasses, drop = mode === "story" ? saasClasses : storyClasses;
      const html = template.split("\n").filter((line) => !drop.test(line.trim()) && !(keep === storyClasses ? false : false))
        .join("\n").replaceAll('"ART"', '"art.jpg"').replaceAll("ART", "art.jpg").replace('class="scene alive"', tall ? 'class="scene tall alive"' : 'class="scene alive"').replace("POS", tall ? "24%" : "50%").replace("CAPTION", row.look === "vox-collage" ? "" : row.caption).replace("HEADLINE", "Your product, in this style.")
        .replace(">SUB<", ">Your real screens. Your own words.<").replace(">CTA<", ">Start free<").replace('const build = "BUILD"', `const build = "${mode === "story" ? (/^paper/.test(row.look) ? "paper" : row.look === "origami" ? "origami" : /clay/.test(row.look) ? "clay" : "none") : "none"}"`).replace('const mode = "MODE"', `const mode = "${mode}"`)
        .replace("</head>", () => `  <style id="fonts">\n${fontCss}\n  </style>\n</head>`);
      await writeFile(join(dir, "index.html"), html);
      const raw = join(dir, "render.mp4");
      console.log(`rendering ${id}`);
      execFileSync(hyperframes, ["render", "--output", raw], { cwd: dir, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env } });
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-t", "5", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", join(out, `${id}.mp4`)]);
      execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", "2.4", "-i", raw, "-frames:v", "1", "-q:v", "3", join(out, `${id}.jpg`)]);
    } catch (error) { console.error(`  FAILED ${id}: ${error.message.split("\n")[0]}`); process.exitCode = 1; }
    finally { await rm(dir, { recursive: true, force: true }); }
  }
}
