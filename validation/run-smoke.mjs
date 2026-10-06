import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const project = join(root, 'smoke');
const output = join(project, 'renders');
const frames = join(project, 'frames');
mkdirSync(join(project, 'vendor'), { recursive: true });
mkdirSync(output, { recursive: true });
mkdirSync(frames, { recursive: true });
copyFileSync(join(root, 'node_modules/gsap/dist/gsap.min.js'), join(project, 'vendor/gsap.min.js'));
const env = { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1' };
const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!env.HYPERFRAMES_BROWSER_PATH && process.platform === 'darwin' && existsSync(systemChrome)) {
  env.HYPERFRAMES_BROWSER_PATH = systemChrome;
}
const cli = join(root, 'node_modules/.bin/hyperframes');
const report = { startedAt: new Date().toISOString(), node: process.version, platform: process.platform, steps: [], acceptance: null };

function run(name, executable, args) {
  const started = performance.now();
  const result = spawnSync(executable, args, { cwd: root, env, encoding: 'utf8', timeout: 300_000, maxBuffer: 8 * 1024 * 1024 });
  const step = { name, executable, args, seconds: Number(((performance.now() - started) / 1000).toFixed(3)), exitCode: result.status, error: result.error?.message };
  report.steps.push(step);
  writeFileSync(join(output, `${name}.log`), `${result.stdout || ''}\n${result.stderr || ''}`);
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`${name}: exit=${result.status}; ${step.seconds}s`);
  if (result.status !== 0) throw new Error(`${name} failed; see ${join(output, `${name}.log`)}`);
  return result.stdout;
}

try {
  run('lint', cli, ['lint', project]);
  run('check', cli, ['check', project]);
  run('render', cli, ['render', project, '--output', join(output, 'smoke.mp4'), '--fps', '30', '--workers', '1', '--quality', 'delivery']);
  const metadata = JSON.parse(run('probe', 'ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', join(output, 'smoke.mp4')]));
  writeFileSync(join(output, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
  const video = metadata.streams.find(stream => stream.codec_type === 'video');
  report.acceptance = {
    codec: video?.codec_name === 'h264',
    dimensions: video?.width === 1920 && video?.height === 1080,
    fps: video?.avg_frame_rate === '30/1',
    frames: Number(video?.nb_read_frames) === 180,
    duration: Math.abs(Number(metadata.format.duration) - 6) <= 1 / 30,
    visualReview: 'pending',
    playbackReview: 'pending'
  };
  for (const second of [0, 2, 5]) {
    run(`frame-${second}`, 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(second), '-i', join(output, 'smoke.mp4'), '-frames:v', '1', join(frames, `second-${second}.png`)]);
  }
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  if (Object.entries(report.acceptance).some(([key, value]) => !key.endsWith('Review') && value !== true)) throw new Error('Output metadata failed acceptance');
  console.log(JSON.stringify(report.acceptance, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
