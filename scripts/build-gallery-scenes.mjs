// Renders hand-authored preview scenes (scripts/gallery-scenes/<id>/index.html) on this machine: 2b1b-style math,
// tech explainers and Three.js scenes. Each scene is a self-contained HyperFrames composition of about 5 seconds.
//   node --experimental-strip-types scripts/build-gallery-scenes.mjs <id> [id ...]    (no ids: every scene)
// The folder is copied to a temp dir with ./vendor (gsap, three), ./fonts and a fonts <style> added, rendered with the
// bundled HyperFrames CLI, and written to var/gallery-src/<id>.mp4 plus a poster <id>.jpg (time from row.json "poster").
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const scenes = join(root, "scripts/gallery-scenes");
const out = join(root, "var/gallery-src");
const hyperframes = join(root, "worker/node_modules/.bin/hyperframes");
await mkdir(out, { recursive: true });
const wanted = process.argv.slice(2);
const ids = (await readdir(scenes, { withFileTypes: true })).filter((e) => e.isDirectory() && e.name !== "vendor").map((e) => e.name).filter((id) => !wanted.length || wanted.includes(id)).sort();
const fontCss = await readFile(join(root, "worker/fonts/fonts.css"), "utf8");
let failed = 0;
for (const id of ids) {
  const src = join(scenes, id);
  const dir = await mkdtemp(join(tmpdir(), `scene-${id}-`));
  try {
    await cp(src, dir, { recursive: true });
    await cp(join(scenes, "vendor"), join(dir, "vendor"), { recursive: true });
    await cp(join(root, "worker/fonts"), join(dir, "fonts"), { recursive: true });
    const html = await readFile(join(dir, "index.html"), "utf8");
    await writeFile(join(dir, "index.html"), html.replace("</head>", () => `  <style id="fonts">\n${fontCss}\n  </style>\n</head>`));
    const row = JSON.parse(await readFile(join(src, "row.json"), "utf8").catch(() => "{}"));
    const raw = join(dir, "render.mp4");
    console.log(`rendering ${id}`);
    execFileSync(hyperframes, ["render", "--output", raw], { cwd: dir, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env } });
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-t", String(row.duration ?? 5), "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", join(out, `${id}.mp4`)]);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(row.poster ?? 2.5), "-i", raw, "-frames:v", "1", "-q:v", "3", join(out, `${id}.jpg`)]);
    console.log(`  wrote ${id}.mp4 and ${id}.jpg`);
  } catch (error) { failed++; console.error(`  FAILED ${id}: ${error.message.split("\n")[0]}`); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
if (failed) process.exitCode = 1;
