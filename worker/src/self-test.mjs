import { spawnSync } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureRoot = join(appRoot, "fixtures", "smoke");
const runRoot = join("/tmp", `renderer-self-test-${process.pid}-${Date.now()}`);
const projectRoot = join(runRoot, "smoke");
const outputPath = join(projectRoot, "renders", "smoke.mp4");
const cliPath = join(appRoot, "node_modules", ".bin", "hyperframes");
const defaultBrowserPath = process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/usr/bin/chromium";
const report = {
  test: "renderer-container-smoke",
  startedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  steps: []
};

function command(name, executable, args) {
  const startedAt = performance.now();
  const result = spawnSync(executable, args, {
    cwd: appRoot,
    env: {
      ...process.env,
      HYPERFRAMES_BROWSER_PATH: process.env.HYPERFRAMES_BROWSER_PATH ?? defaultBrowserPath,
      HYPERFRAMES_NO_TELEMETRY: "1",
      HYPERFRAMES_NO_UPDATE_CHECK: "1"
    },
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 4 * 1024 * 1024
  });
  report.steps.push({ name, seconds: Number(((performance.now() - startedAt) / 1000).toFixed(3)), exitCode: result.status });
  if (result.status !== 0) throw new Error(`${name} failed: ${(result.stderr || result.stdout || result.error?.message || "unknown error").slice(-1200)}`);
  return result.stdout;
}

try {
  await mkdir(runRoot, { recursive: true });
  await cp(fixtureRoot, projectRoot, { recursive: true });
  await mkdir(join(projectRoot, "vendor"), { recursive: true });
  await cp(join(appRoot, "node_modules", "gsap", "dist", "gsap.min.js"), join(projectRoot, "vendor", "gsap.min.js"));
  command("lint", cliPath, ["lint", projectRoot]);
  command("check", cliPath, ["check", projectRoot, "--no-browser-gpu"]);
  command("render", cliPath, ["render", projectRoot, "--output", outputPath, "--fps", "30", "--workers", "1", "--quality", "standard", "--no-browser-gpu"]);
  const metadata = JSON.parse(command("probe", "ffprobe", ["-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", outputPath]));
  const video = metadata.streams.find((stream) => stream.codec_type === "video");
  const assertions = {
    codec: video?.codec_name === "h264",
    dimensions: video?.width === 1920 && video?.height === 1080,
    fps: video?.avg_frame_rate === "30/1",
    frames: Number(video?.nb_read_frames) === 300,
    duration: Math.abs(Number(metadata.format?.duration) - 10) <= 1 / 30
  };
  if (Object.values(assertions).some((value) => !value)) throw new Error(`Unexpected output metadata: ${JSON.stringify(assertions)}`);
  report.finishedAt = new Date().toISOString();
  report.assertions = assertions;
  report.outputBytes = Number(metadata.format.size);
  console.log(JSON.stringify(report));
  await writeFile(join(runRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  report.failedAt = new Date().toISOString();
  report.error = error instanceof Error ? error.message : "Unknown self-test failure";
  console.error(JSON.stringify(report));
  process.exitCode = 1;
} finally {
  await rm(runRoot, { recursive: true, force: true });
}
