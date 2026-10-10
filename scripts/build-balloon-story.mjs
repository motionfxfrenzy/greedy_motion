// Builds the Crayon story (balloon) preview: the engine's drawing film (var/gallery-films/illus-balloon.mp4) as a short
// time-lapse of the picture being made, then the finished picture comes alive and the balloon flies away.
//   node --experimental-strip-types scripts/build-balloon-story.mjs
// 1. renders the fly-away scene (scripts/gallery-scenes/story-illus-balloon, 720x720, about 3 s, starts on the film's last frame);
// 2. joins [drawing time-lapse] + [fly-away] and lays it out like the other story clips (blurred copy fills the sides);
// Writes var/gallery-src/story-illus-balloon.mp4|jpg (about 7.5 s). The scene's source is the published reference code.
import { execFileSync } from "node:child_process";
import { mkdir, rename } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const src = join(root, "var/gallery-src");
const films = join(root, "var/gallery-films");
await mkdir(films, { recursive: true });
execFileSync("node", ["--experimental-strip-types", join(root, "scripts/build-gallery-scenes.mjs"), "story-illus-balloon"], { stdio: "inherit", cwd: root });
const fly = join(films, "illus-balloon-fly.mp4");
await rename(join(src, "story-illus-balloon.mp4"), fly);
const ff = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
const speed = 15 / 4.3; // the picture is finished at 4.3 s, as in the other story clips
const graph =
  `[0:v]setpts=PTS/${speed.toFixed(4)},fps=30,scale=720:720,trim=duration=4.3,setpts=PTS-STARTPTS[a];` +
  `[1:v]fps=30,scale=720:720,setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1:a=0,split[x][y];` +
  `[x]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,boxblur=32:6,eq=brightness=-0.12[bg];[bg][y]overlay=(W-w)/2:0[v]`;
const out = join(src, "story-illus-balloon.mp4");
ff(["-i", join(films, "illus-balloon.mp4"), "-i", fly, "-filter_complex", graph, "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", out]);
ff(["-ss", "4.2", "-i", out, "-frames:v", "1", "-q:v", "3", join(src, "story-illus-balloon.jpg")]);
console.log("wrote story-illus-balloon (draw, then the balloon flies)");
