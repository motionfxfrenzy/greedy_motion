// Builds a self-contained HyperFrames project (template + GSAP + bundled fonts + theme) for one render.
// Shared by the HTTP worker (worker.mjs) and the preview generator (previews.mjs).
import { spawn } from "node:child_process";
import { access, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const APP_ROOT = "/app";
export const HYPERFRAMES = join(APP_ROOT, "node_modules/.bin/hyperframes");
const SAFE_ID = /^[a-z0-9-]{1,40}$/;

/** Only ids shaped like generated file and folder names are accepted; the file must also exist. */
export function idOrDefault(value, fallback) {
  return typeof value === "string" && SAFE_ID.test(value) ? value : fallback;
}

export async function listTemplates() {
  return (await readdir(join(APP_ROOT, "templates"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

export async function listThemes() {
  return (await readdir(join(APP_ROOT, "themes"))).filter((file) => file.endsWith(".css")).map((file) => file.slice(0, -4)).sort();
}

const BRANDS_ROOT = "/brands";
const BRAND_ID = /^[0-9a-f-]{36}$/;

/** PNG width/height from the IHDR header (logos are always normalized to PNG by the backend). */
async function pngSize(file) {
  const header = await readFile(file).then((buffer) => buffer.subarray(0, 24));
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

/**
 * Brand kits live read-only at /brands/<id>/ (theme.css, fonts.css, fonts/, logo.png). Returns the theme CSS,
 * extra font CSS, and the logo variables the renderer sets; callers never supply these values.
 */
async function loadBrand(project, brandId) {
  if (!BRAND_ID.test(brandId)) throw new Error("Invalid brand kit id.");
  const dir = join(BRANDS_ROOT, brandId);
  const themeCss = await readFile(join(dir, "theme.css"), "utf8").catch(() => { throw new Error("Brand kit not found."); });
  const fontCss = await readFile(join(dir, "fonts.css"), "utf8").catch(() => "");
  await cp(join(dir, "fonts"), join(project, "brand-fonts"), { recursive: true }).catch(() => {});
  const variables = {};
  const logo = join(dir, "logo.png");
  if (await access(logo).then(() => true, () => false)) {
    await mkdir(join(project, "brand"), { recursive: true });
    await cp(logo, join(project, "brand", "logo.png"));
    const { width, height } = await pngSize(logo);
    variables.logo = "brand/logo.png";
    // Wide logos are wordmarks that already spell the name; square ones are icons that need the name beside them.
    variables.logoWordmark = width / height > 2.2;
  }
  return { themeCss, fontCss, variables };
}

export async function buildProject(project, { template, theme, brandId }) {
  const templateDir = join(APP_ROOT, "templates", template);
  await access(join(templateDir, "index.html")).catch(() => { throw new Error(`Unknown template "${template}".`); });
  const brand = brandId ? await loadBrand(`${project}.brand-staging`, brandId).catch((error) => { throw error; }) : null;
  const themeCss = brand ? brand.themeCss : await readFile(join(APP_ROOT, "themes", `${theme}.css`), "utf8").catch(() => { throw new Error(`Unknown theme "${theme}".`); });
  await cp(templateDir, project, { recursive: true });
  await mkdir(join(project, "vendor"), { recursive: true });
  await cp(join(APP_ROOT, "node_modules/gsap/dist/gsap.min.js"), join(project, "vendor/gsap.min.js"));
  // Bundled fonts: declaring every @font-face up front stops HyperFrames fetching fonts at render time.
  await cp(join(APP_ROOT, "fonts"), join(project, "fonts"), { recursive: true });
  const fontCss = await readFile(join(APP_ROOT, "fonts/fonts.css"), "utf8");
  if (brand) {
    // Move brand files staged before the template copy into the project.
    await cp(`${project}.brand-staging`, project, { recursive: true }).catch(() => {});
    await rm(`${project}.brand-staging`, { recursive: true, force: true });
  }
  const htmlPath = join(project, "index.html");
  const html = await readFile(htmlPath, "utf8");
  const brandFonts = brand?.fontCss ? `\n  <style id="brand-fonts">\n${brand.fontCss}\n  </style>` : "";
  await writeFile(htmlPath, html.replace("</head>", `  <style id="fonts">\n${fontCss}\n  </style>${brandFonts}\n  <style id="theme" data-theme="${brand ? "brand" : theme}">\n${themeCss}\n  </style>\n</head>`));
  return { brandVariables: brand?.variables ?? {} };
}

const AUDIO_ROOT = "/audio";
const VOICE_START = 0.3;
const PROJECTS_ROOT = "/projects";
const PROJECT_ID = /^[0-9a-f-]{36}$/;

/**
 * Copies a saved project screenshot into the isolated HyperFrames project and
 * returns its template variable. The worker receives only validated ids, never
 * a caller-controlled filesystem path.
 */
export async function addScreenshot(project, screenshot) {
  if (!screenshot || typeof screenshot !== "object") return {};
  const { projectId, screenshotId } = screenshot;
  if (typeof projectId !== "string" || typeof screenshotId !== "string" || !PROJECT_ID.test(projectId) || !PROJECT_ID.test(screenshotId)) throw new Error("Invalid project screenshot reference.");
  const sourceDir = join(PROJECTS_ROOT, projectId, "screenshots");
  const candidates = [".png", ".jpg"].map((extension) => join(sourceDir, screenshotId + extension));
  const source = await Promise.any(candidates.map(async (file) => {
    await access(file);
    return file;
  })).catch(() => { throw new Error("The selected project screenshot is unavailable to the renderer."); });
  const extension = source.endsWith(".png") ? ".png" : ".jpg";
  const destinationDir = join(project, "assets");
  await mkdir(destinationDir, { recursive: true });
  const destination = join(destinationDir, "project-screenshot" + extension);
  await cp(source, destination);
  return { screenshot: "assets/project-screenshot" + extension };
}

/**
 * Adds the job's generated audio (from /audio/<jobId>/, written by the backend) as HyperFrames <audio> tracks.
 * Music fades in and out and ducks under the voiceover with a data-automation volume lane.
 */
export async function addAudio(project, jobId, audio, durationSeconds = 10) {
  if (!audio || (!audio.music && !audio.voiceover)) return;
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw new Error("Invalid job id for audio.");
  const dir = join(AUDIO_ROOT, jobId);
  await mkdir(join(project, "audio"), { recursive: true });
  const tags = [];
  const voice = audio.voiceover && Number.isFinite(audio.voiceover.seconds) ? Math.min(audio.voiceover.seconds, durationSeconds - VOICE_START) : null;
  if (voice) {
    await cp(join(dir, "voiceover.wav"), join(project, "audio", "voiceover.wav"));
    tags.push(`<audio id="voiceover" src="audio/voiceover.wav" data-start="${VOICE_START}" data-duration="${voice.toFixed(2)}" data-track-index="11" data-volume="1"></audio>`);
  }
  if (audio.music) {
    await cp(join(dir, "music.wav"), join(project, "audio", "music.wav"));
    const bed = voice ? 0.28 : 0.85;
    const end = durationSeconds;
    const points = voice
      ? [[0, 0], [0.6, 0.6], [VOICE_START + 0.2, bed], [VOICE_START + voice, bed], [Math.min(VOICE_START + voice + 0.5, end - 0.8), 0.6], [end - 0.8, 0.6], [end, 0]]
      : [[0, 0], [0.6, bed], [end - 0.8, bed], [end, 0]];
    const lane = { version: 1, lanes: [{ target: "volume", points: points.map(([t, v]) => ({ t: Math.round(t * 100) / 100, v })) }] };
    tags.push(`<audio id="music-bed" src="audio/music.wav" data-start="0" data-duration="${end}" data-track-index="10" data-volume="1" data-automation='${JSON.stringify(lane)}'></audio>`);
  }
  const htmlPath = join(project, "index.html");
  const html = await readFile(htmlPath, "utf8");
  const rootOpen = /<div id="root"[^>]*>/.exec(html);
  if (!rootOpen) throw new Error("Template has no #root element for audio.");
  await writeFile(htmlPath, html.replace(rootOpen[0], `${rootOpen[0]}\n    ${tags.join("\n    ")}`));
}

/** Writes caller values to a file for `--variables-file`; HyperFrames validates them with `--strict-variables`. */
export async function writeVariables(project, variables) {
  const file = join(project, "variables.json");
  await writeFile(file, JSON.stringify(variables ?? {}));
  return file;
}

/**
 * Runs a command. `onLine` receives each output line (progress bars redraw with \r, so both \r and \n
 * end a line). Aborting `signal` kills the whole process group, including Chromium and FFmpeg children.
 */
export function run(command, args, { onLine, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("Aborted."));
    const child = spawn(command, args, { cwd: APP_ROOT, env: process.env, detached: Boolean(signal) });
    let stdout = "";
    let stderr = "";
    let pending = "";
    const lines = (chunk) => {
      if (!onLine) return;
      pending += chunk;
      const parts = pending.split(/[\r\n]+/);
      pending = parts.pop() ?? "";
      for (const line of parts) if (line.trim()) onLine(line);
    };
    const kill = () => {
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    };
    signal?.addEventListener("abort", kill, { once: true });
    child.stdout.on("data", (chunk) => { stdout += chunk; lines(String(chunk)); });
    child.stderr.on("data", (chunk) => { stderr += chunk; lines(String(chunk)); });
    child.on("error", reject);
    child.on("close", (code) => {
      signal?.removeEventListener("abort", kill);
      if (signal?.aborted) return reject(signal.reason ?? new Error("Aborted."));
      return code === 0 ? resolve(stdout) : reject(Object.assign(new Error(`Command failed (${code}): ${(stderr || stdout).slice(-800)}`), { stdout }));
    });
  });
}
