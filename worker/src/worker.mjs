import { preflightRender, RenderContractError, RENDER_CAPABILITIES } from "./render-preflight.mjs";
// Render worker. Takes `render-video` and plate work from the backend dispatcher (control.mjs), renders with
// HyperFrames, reports real progress into app.render_jobs, and publishes `render-finished`.
// Scale out by adding replicas; each one runs RENDER_CONCURRENCY renders at a time (default 1).
import http from "node:http";
import { access, mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { HYPERFRAMES, addAudio, addScreenshot, buildProject, idOrDefault, run, writeVariables } from "./compose.mjs";
import { deleteOutputs, downloadProject, otherAttempts, storageEnabled, uploadOutput } from "./storage.mjs";
import { QUEUES, claim, finish, noteRetry, progress } from "./jobs.mjs";
import { consume, createControl, runLeased } from "./control.mjs";
import { renderWithMotionBlur, wantsMotionBlur } from "./motion-blur.mjs";
import { PLATE_EXPORT_QUEUE, PLATE_RENDER_QUEUE, handlePlateExport, handlePlateRender, plateCapability, renderPlateFilmJob } from "./plates.mjs";

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
// Railway private networking needs "::"; local Docker uses 0.0.0.0.
const host = process.env.HOST ?? "0.0.0.0";
const concurrency = Number.parseInt(process.env.RENDER_CONCURRENCY ?? "1", 10);
// Plate scenes (plates.mjs): verified and drawn in Chromium, each one a browser; PLATE_CONCURRENCY at a time on this task (CPU workers only).
const plateConcurrency = Number.parseInt(process.env.PLATE_CONCURRENCY ?? "2", 10);
// Seconds to let in-flight renders finish on SIGTERM before handing them back to the queue.
const drainSeconds = Number.parseInt(process.env.DRAIN_SECONDS ?? "25", 10);
const RENDERS_DIR = "/renders";
// Scale to zero (WORKER_LAUNCH=ecs on the backend): exit after this many seconds with nothing running and
// nothing queued, so the task stops billing. The backend starts a new one when a render is queued.
// 0 (the default) keeps the worker running, as a long-lived service or local Docker needs.
const idleExitSeconds = Number.parseInt(process.env.IDLE_EXIT_SECONDS ?? "0", 10);

if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("RENDER_CONCURRENCY must be a positive integer.");
if (!Number.isInteger(idleExitSeconds) || idleExitSeconds < 0) throw new Error("IDLE_EXIT_SECONDS must be 0 or a positive integer.");

const QUEUE = QUEUES.video;
const log = (level, event, fields = {}) => console.log(JSON.stringify({ level, event, ...fields }));
// The worker holds no database connection and no pg-boss client: every claim, heartbeat, write and acknowledgment goes through the
// backend's job-control routes (control.mjs, docs/JOB_CONTROL.md), so adding workers never adds pooler clients.
const control = createControl();

let ready = false;
let shuttingDown = false;
let active = 0;
let activePlates = 0;
let lastBusy = Date.now();

/** Errors that would fail the same way on every attempt: fail now instead of retrying. */
class PermanentError extends Error {}

/** Turns HyperFrames progress lines ("62%  Streaming frame 202/300") into throttled, fenced job updates. */
function progressReporter(jobId, attempt, onLost) {
  let last = 0;
  let frames = null;
  let stage = "preparing";
  let fixedPercent = null;
  let writing = Promise.resolve();
  const write = (force = false) => {
    const now = Date.now();
    if (!force && now - last < 1000) return;
    last = now;
    const percent = fixedPercent ?? (stage === "encoding" ? 92 : frames ? 52 + Math.round((frames.done / frames.total) * 38) : 50);
    writing = writing
      .then(() => progress(control, jobId, attempt, { stage, progress: percent, framesDone: frames?.done ?? null, framesTotal: frames?.total ?? null }))
      .then((owned) => { if (!owned) onLost(); })
      .catch((error) => log("warn", "progress_write_failed", { jobId, message: error.message }));
  };
  return {
    line(text) {
      const match = /frame\s+(\d+)\s*\/\s*(\d+)/i.exec(text);
      if (match) {
        frames = { done: Number(match[1]), total: Number(match[2]) };
        const nextStage = frames.done >= frames.total ? "encoding" : "frames";
        const changed = nextStage !== stage;
        stage = nextStage;
        write(changed);
      } else if (frames && /encod|mux|audio|finaliz/i.test(text) && stage !== "encoding") {
        stage = "encoding";
        write(true);
      }
    },
    /** A job that reports its own stages: name the stage and the percent directly. */
    set(next, percent) { stage = next; fixedPercent = percent; frames = null; write(true); },
    flush: () => writing
  };
}

const RENDER_FLAGS = ["--fps", "30", "--no-best-effort", "--workers", "1", "--quality", "standard", "--no-browser-gpu"];
// Previews (Pro Editor): fewer frames and a cheaper encode, then scaled down. They are for checking timing, never delivered.
const PREVIEW_FLAGS = ["--fps", "24", "--no-best-effort", "--workers", "1", "--quality", "draft", "--no-browser-gpu"];
const isPreview = (input) => input.quality === "draft540" || input.quality === "preview720";

/** The preview's pixel size. The backend computes it (contracts previewSize); a row is never trusted: even integers in range, or no scaling. */
function previewScale(input) {
  if (!isPreview(input)) return null;
  const width = Number(input.previewWidth);
  const height = Number(input.previewHeight);
  return [width, height].every((v) => Number.isInteger(v) && v >= 2 && v <= 3840 && v % 2 === 0) ? { width, height } : null;
}

/**
 * Renders a prepared folder. A folder without variables.json (a Pro Editor project) renders as written; a preview is
 * rendered cheaply at the composition's own size, then scaled to 540p / 720p with ffmpeg.
 */
async function renderFolder(folder, output, input, options) {
  try {
    if (input.renderContractVersion !== undefined && input.renderContractVersion !== 1) throw new RenderContractError("Unsupported render contract version");
    // Pro source is intentionally editable; a manifest copied from its initial snapshot is stale.
    if (input.kind === "beat-plan") await preflightRender(folder, { requireManifest: input.renderContractVersion === 1 });
  } catch (error) {
    if (error instanceof RenderContractError || error?.code === "ENOENT") throw new PermanentError(`Prepared project failed preflight: ${error.message}`);
    throw error;
  }
  const variables = join(folder, "variables.json");
  const hasVariables = await access(variables).then(() => true, () => false);
  const args = (to, fps) => ["render", folder, ...(hasVariables ? ["--variables-file", variables] : []), "--output", to, ...(isPreview(input) ? PREVIEW_FLAGS : fps ? ["--fps", String(fps), ...RENDER_FLAGS.slice(2)] : RENDER_FLAGS)];
  // Motion blur is the person's choice at final submission and never touches a preview.
  if (wantsMotionBlur(input, isPreview)) await renderWithMotionBlur({ run, hyperframes: HYPERFRAMES, hyperframesArgs: args, output, options });
  else await run(HYPERFRAMES, args(output), options);
  const scale = previewScale(input);
  if (!scale) return;
  const scaled = `${output}.scaled.mp4`;
  try {
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", output, "-vf", `scale=${scale.width}:${scale.height}`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", scaled], { signal: options.signal });
    await rename(scaled, output);
  } finally {
    await rm(scaled, { force: true });
  }
}

/**
 * An approved storyboard: the backend wrote the complete HyperFrames project (stamped canvas, variables,
 * fonts, shots, voice, music, SFX) to /renders/<id>/project. Render it as is; nothing is generated here.
 */
async function renderBeatPlan(id, input, attempt, signal, reporter) {
  // Object storage: pull the prepared folder from R2 into a private scratch directory, render there, upload the MP4.
  if (storageEnabled) {
    const scratch = join("/tmp", `render-${id}-a${attempt}`);
    const folder = join(scratch, "project");
    const output = join(scratch, "out.mp4");
    const key = `renders/${id}/a${attempt}.mp4`;
    if (input.projectPrefix !== `jobs/${id}/project`) throw new PermanentError("The prepared storyboard location is missing or invalid.");
    try {
      try {
        await rm(scratch, { recursive: true, force: true });
        await downloadProject(input.projectPrefix, folder);
        await access(join(folder, "index.html"));
        if (input.kind === "beat-plan") await access(join(folder, "variables.json"));
      } catch (error) {
        if (error?.code === "ENOENT" || /missing in storage|Invalid project prefix/.test(error?.message ?? "")) throw new PermanentError("The prepared storyboard folder is incomplete. Submit the storyboard again.");
        throw error;
      }
      await renderFolder(folder, output, input, { onLine: reporter.line, signal });
      await uploadOutput(output, key);
      return { url: `/v1/renders/${id}`, format: "mp4", durationSeconds: Number(input.durationSeconds) || 10, file: `${id}-a${attempt}.mp4`, key };
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
  const folder = join(RENDERS_DIR, id, "project");
  // Only the job's own folder: a row can never point the renderer elsewhere.
  if (input.workerDir !== folder) throw new PermanentError("The prepared storyboard folder is missing or invalid.");
  try {
    await access(join(folder, "index.html"));
    if (input.kind === "beat-plan") await access(join(folder, "variables.json"));
  } catch {
    throw new PermanentError("The prepared storyboard folder is incomplete. Submit the storyboard again.");
  }
  const file = `${id}-a${attempt}.mp4`;
  const output = join(RENDERS_DIR, file);
  try {
    await renderFolder(folder, output, input, { onLine: reporter.line, signal });
    return { url: `/v1/renders/${id}`, format: "mp4", durationSeconds: Number(input.durationSeconds) || 10, file };
  } catch (error) {
    await rm(output, { force: true });
    throw error;
  }
}

/**
 * The final film of a code-drawn plate project: waits for its scenes, assembles voice, music, effects and subtitles from the
 * export manifest (plates.mjs), and uploads under the usual per-attempt key. Progress and fencing are the job's own.
 */
async function renderPlateFilm(id, input, attempt, signal) {
  if (!storageEnabled) throw new PermanentError("Plate films need object storage.");
  const scratch = join("/tmp", `render-${id}-a${attempt}`);
  const output = join(scratch, "out.mp4");
  const key = `renders/${id}/a${attempt}.mp4`;
  const report = async ({ stage, progress: percent, framesDone = null, framesTotal = null }) => {
    if (!(await progress(control, id, attempt, { stage, progress: percent, framesDone, framesTotal }))) throw new Error("This attempt no longer owns the job.");
  };
  try {
    await rm(scratch, { recursive: true, force: true });
    await mkdir(scratch, { recursive: true });
    let result;
    try {
      result = await renderPlateFilmJob(id, input, attempt, { control, signal, report, output });
    } catch (error) {
      if (error?.permanent) throw new PermanentError(error.message);
      throw error;
    }
    await uploadOutput(output, key);
    return { url: `/v1/renders/${id}`, format: "mp4", durationSeconds: result.durationSeconds, file: `${id}-a${attempt}.mp4`, key };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function renderVideo(input, attempt, signal, reporter) {
  const id = typeof input.id === "string" && /^[a-f0-9-]{36}$/i.test(input.id) ? input.id : "";
  if (!id) throw new PermanentError("A valid render id is required.");
  if (input.kind === "beat-plan" || input.kind === "pro") return renderBeatPlan(id, input, attempt, signal, reporter);
  if (input.kind === "plate-film") return renderPlateFilm(id, input, attempt, signal);
  if (storageEnabled) throw new PermanentError("Template renders are not available with object storage yet; render the approved storyboard instead.");
  const template = idOrDefault(input.template, "product-launch");
  const theme = idOrDefault(input.theme, "neutral");
  const variables = input.variables && typeof input.variables === "object" && !Array.isArray(input.variables) ? { ...input.variables } : {};
  // Renderer-owned slots: never taken from the caller.
  delete variables.logo;
  delete variables.logoWordmark;
  const brandId = typeof input.brandId === "string" ? input.brandId : undefined;
  const project = join("/tmp", `render-${id}-a${attempt}`);
  // One file per attempt: a stale attempt can never overwrite the winner's MP4.
  const file = `${id}-a${attempt}.mp4`;
  const output = join(RENDERS_DIR, file);
  try {
    let variablesFile;
    try {
      const { brandVariables } = await buildProject(project, { template, theme, brandId });
      const screenshotVariables = await addScreenshot(project, input.screenshot);
      await addAudio(project, id, input.audio);
      variablesFile = await writeVariables(project, { ...variables, ...brandVariables, ...screenshotVariables });
    } catch (error) {
      // Missing brand kit, screenshot or audio: the inputs are wrong, so a retry cannot help.
      throw new PermanentError(error instanceof Error ? error.message : "The render inputs are invalid.");
    }
    await run(HYPERFRAMES, ["render", project, "--variables-file", variablesFile, "--strict-variables", "--output", output, "--fps", "30", "--workers", "1", "--quality", "standard", "--no-browser-gpu"], { onLine: reporter.line, signal });
    return { url: `/v1/renders/${id}`, format: "mp4", durationSeconds: Number(input.durationSeconds) || 10, file };
  } catch (error) {
    await rm(output, { force: true });
    throw error;
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(`${project}.brand-staging`, { recursive: true, force: true });
  }
}

/**
 * A crashed attempt cannot clean up after itself. Once a newer attempt holds the job, the older ones are
 * fenced out, so their partial MP4s and HyperFrames transaction folders are safe to delete.
 */
async function removeEarlierAttempts(jobId, attempt) {
  if (attempt < 2) return;
  if (storageEnabled) {
    await deleteOutputs(await otherAttempts(jobId, `renders/${jobId}/a${attempt}.mp4`).then((keys) => keys.filter((key) => Number(/a(\d+)\.mp4$/.exec(key)?.[1]) < attempt))).catch(() => undefined);
    return;
  }
  const earlier = new RegExp(`^\\.?${jobId}-a(\\d+)(\\.mp4|\\.hf-transaction-.+)$`);
  for (const name of await readdir(RENDERS_DIR).catch(() => [])) {
    const match = earlier.exec(name);
    if (match && Number(match[1]) < attempt) await rm(join(RENDERS_DIR, name), { recursive: true, force: true });
  }
}

/** pg-boss handler for one `render-video` message. Throwing tells pg-boss to retry (with backoff). */
async function handle(job) {
  const { jobId } = job.data ?? {};
  const attempt = job.retryCount + 1;
  const input = await claim(control, jobId, attempt);
  if (!input) {
    log("info", "render_skipped", { jobId, attempt, reason: "not claimable (finished, failed, or superseded)" });
    return;
  }
  active += 1;
  lastBusy = Date.now();
  const started = Date.now();
  await removeEarlierAttempts(jobId, attempt);
  // Abort when pg-boss reports the claim is gone (heartbeat lost, expired) or the row moved to a newer attempt.
  const lost = new AbortController();
  const signal = AbortSignal.any([job.signal, lost.signal]);
  const reporter = progressReporter(jobId, attempt, () => lost.abort(new Error("This attempt no longer owns the job.")));
  log("info", "render_started", { jobId, attempt });
  try {
    const output = await renderVideo(input, attempt, signal, reporter);
    await reporter.flush();
    const committed = await finish(control, jobId, attempt, { output });
    if (!committed) {
      if (output.key) await deleteOutputs([output.key]).catch(() => undefined);
      else await rm(join(RENDERS_DIR, output.file), { force: true });
    }
    log("info", committed ? "render_completed" : "render_superseded", { jobId, attempt, seconds: Math.round((Date.now() - started) / 1000) });
  } catch (error) {
    await reporter.flush();
    const message = error instanceof Error ? error.message : "Render failed.";
    if (signal.aborted) {
      log("warn", "render_abandoned", { jobId, attempt, message });
      throw error;
    }
    if (error instanceof PermanentError) {
      await finish(control, jobId, attempt, { error: { code: "render_invalid", message } });
      log("error", "render_failed_permanently", { jobId, attempt, message });
      return;
    }
    await noteRetry(control, jobId, attempt, { code: "render_failed", message: "The renderer hit an error and is trying again.", detail: message.slice(-800) });
    log("error", "render_attempt_failed", { jobId, attempt, message: message.slice(-400) });
    throw error;
  } finally {
    active -= 1;
    lastBusy = Date.now();
  }
}

/**
 * Takes work from the backend's dispatcher with long-held polls (control.mjs). One loop; each leased job runs under runLeased, which
 * renews its lease and acknowledges the outcome. Plate scenes: CPU workers only, and only where this image can draw them
 * (Chromium + the engine's capture adapter).
 */
const stop = new AbortController();
let activeExports = 0;
const leased = { [QUEUES.video]: 0, [PLATE_RENDER_QUEUE]: 0, [PLATE_EXPORT_QUEUE]: 0 };
let drawsPlates = false;

async function startConsuming() {
  const capability = QUEUE === QUEUES.video && plateConcurrency > 0 ? await plateCapability() : null;
  drawsPlates = Boolean(capability);
  const handlers = {
    [QUEUES.video]: async (job) => { await handle(job); },
    [PLATE_RENDER_QUEUE]: async (job) => {
      activePlates += 1; lastBusy = Date.now();
      try { await handlePlateRender(job, { control }); } finally { activePlates -= 1; lastBusy = Date.now(); }
    },
    [PLATE_EXPORT_QUEUE]: async (job) => {
      activePlates += 1; activeExports += 1; lastBusy = Date.now();
      try { await handlePlateExport(job, { control }); } finally { activePlates -= 1; activeExports -= 1; lastBusy = Date.now(); }
    }
  };
  ready = true;
  log("info", "worker_consuming", { queue: QUEUE, concurrency, plateConcurrency: drawsPlates ? plateConcurrency : 0, idleExitSeconds, workerId: control.workerId });
  if (idleExitSeconds > 0) watchIdle();
  const inFlight = new Set();
  await consume(control, {
    stop: stop.signal,
    log,
    slots: () => shuttingDown ? {} : {
      [QUEUES.video]: Math.max(0, concurrency - leased[QUEUES.video]),
      [PLATE_RENDER_QUEUE]: drawsPlates ? Math.max(0, plateConcurrency - leased[PLATE_RENDER_QUEUE]) : 0,
      [PLATE_EXPORT_QUEUE]: drawsPlates ? Math.max(0, 1 - leased[PLATE_EXPORT_QUEUE]) : 0
    },
    onJob: (lease) => {
      const handler = handlers[lease.queue];
      if (!handler) { void control.fail(lease.queue, lease.id, lease.attempt, "unknown queue").catch(() => undefined); return; }
      // Counted from the moment it is leased (not when the handler starts), so the next poll never offers this slot again.
      leased[lease.queue] += 1;
      lastBusy = Date.now();
      const run = runLeased(control, lease, handler, { shutdown: stop.signal }).then((outcome) => log("info", "job_ended", { queue: lease.queue, id: lease.id, attempt: lease.attempt, outcome })).finally(() => { leased[lease.queue] -= 1; lastBusy = Date.now(); inFlight.delete(run); });
      inFlight.add(run);
    }
  });
  await Promise.allSettled([...inFlight]);
}

/** Exits once the worker has had nothing to do for idleExitSeconds and nothing is queued. */
function watchIdle() {
  const timer = setInterval(async () => {
    if (shuttingDown || active > 0 || activePlates > 0 || Object.values(leased).some((n) => n > 0) || Date.now() - lastBusy < idleExitSeconds * 1000) return;
    // Unknown state (backend unreachable): stay up rather than strand a job; the next tick asks again.
    const demand = await control.op("demand.idle").catch(() => null);
    if (!demand || demand.plate === null) return;
    if (demand.queued + demand.plate > 0) { lastBusy = Date.now(); return; }
    clearInterval(timer);
    void shutdown("idle");
  }, 15_000);
  timer.unref();
}

function send(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(`${JSON.stringify(payload)}\n`);
}

// Health only. Renders arrive through the queue, never over HTTP.
const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/capabilities") return void plateCapability().then((plates) => send(response, 200, { ...RENDER_CAPABILITIES, ...(plates ? { plates } : {}) }));
  if (request.method === "GET" && request.url === "/healthz") return send(response, 200, { status: "ok", service: "worker" });
  if (request.method === "GET" && request.url === "/readyz") return send(response, ready && !shuttingDown ? 200 : 503, { ready: ready && !shuttingDown, active, concurrency });
  return send(response, 404, { error: { code: "not_found", message: "Not found." } });
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", "worker_shutdown", { signal, active });
  // Stop taking jobs and let running renders finish. Anything still running at the deadline is handed
  // back: its heartbeat lapses and another replica retries it as a new, fenced attempt.
  // Stop polling; in-flight jobs get DRAIN_SECONDS, then their lease lapses and another worker retries them as a new, fenced attempt.
  const deadline = Date.now() + drainSeconds * 1000;
  stop.abort();
  while ((active > 0 || activePlates > 0) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 500));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

server.listen(port, host, () => log("info", "worker_ready", { host, port, concurrency }));
void startConsuming().catch((error) => {
  log("error", "worker_start_failed", { message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
