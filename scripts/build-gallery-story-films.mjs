// Builds the Story clips that can be real motion, from films we already have, instead of a moving still:
//  - each illustration style: its engine film (var/gallery-films, scripts/render-gallery-films.mjs) shown as a 5 s time-lapse
//    of the picture being made, centred over a blurred copy of itself;
//  - the editorial collage: five-second windows of our own editorial explainer film (experiments/vox-explainer/final.mp4,
//    motion graphics where elements enter, draw and leave), one for the Story version and one for the product version.
//   node --experimental-strip-types scripts/build-gallery-story-films.mjs [look-id ...]
// Writes var/gallery-src/story-<look>.mp4|jpg (and saas-vox-collage.mp4|jpg).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { films } from "./render-gallery-films.mjs";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "var/gallery-src");
await mkdir(out, { recursive: true });
const wanted = process.argv.slice(2);
const ff = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
const duration = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim());
const encode = ["-an", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-t", "5"];

for (const look of Object.keys(films)) {
  if (wanted.length && !wanted.includes(look)) continue;
  const film = join(root, "var/gallery-films", `${look}.mp4`);
  if (!existsSync(film)) { console.error(`no film for ${look}`); continue; }
  // The picture finishes being made at about 4.3 s, then holds. Films shorter than that play at their own speed.
  const speed = Math.max(1, duration(film) / 4.3);
  const graph = `[0:v]setpts=PTS/${speed.toFixed(4)},fps=30,tpad=stop_mode=clone:stop_duration=2,trim=duration=5,setpts=PTS-STARTPTS,split[a][b];` +
    `[a]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,boxblur=32:6,eq=brightness=-0.16[bg];[b]scale=-2:720[fg];[bg][fg]overlay=(W-w)/2:0[v]`;
  ff(["-i", film, "-filter_complex", graph, "-map", "[v]", ...encode, join(out, `story-${look}.mp4`)]);
  ff(["-ss", "4.4", "-i", join(out, `story-${look}.mp4`), "-frames:v", "1", "-q:v", "3", join(out, `story-${look}.jpg`)]);
  console.log(`wrote story-${look} (x${speed.toFixed(1)})`);
}

const vox = join(root, "experiments/vox-explainer/final.mp4");
if (existsSync(vox) && (!wanted.length || wanted.includes("vox-collage"))) {
  for (const [id, start, poster] of [["story-vox-collage", 10.2, 3.2], ["saas-vox-collage", 36.4, 3.4]]) {
    ff(["-ss", String(start), "-i", vox, "-vf", "scale=1280:720", ...encode, join(out, `${id}.mp4`)]);
    ff(["-ss", String(poster), "-i", join(out, `${id}.mp4`), "-frames:v", "1", "-q:v", "3", join(out, `${id}.jpg`)]);
    console.log(`wrote ${id}`);
  }
}
