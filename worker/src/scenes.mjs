// Scene drawing, worker half (backend/src/render/scenes.ts has the other half). Consumes `render-scene` { clipId }: draws
// one scene of a storyboard film as a time range of the film page itself, or mixes the film's soundtrack, while the
// person is still in the Preview. The final render then joins the clips (joinScenes) instead of drawing the film again.
//
// A clip is fenced like a render job: every write is conditional on the row's `attempt`, and a clip the film stopped
// using (`current` false, after a fix) is dropped mid-draw and put back in the queue state, never written as drawn.
import { readFile, rename, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { HYPERFRAMES, run } from "./compose.mjs";
import { downloadOutput, downloadProject, storageEnabled, uploadOutput } from "./storage.mjs";
import { progress } from "./jobs.mjs";

export const SCENE_QUEUE = "render-scene";
const RENDERS_DIR = "/renders";
const THUMBS = join(import.meta.dirname, "ffmpeg-thumbs.sh");
// Scenes of one project drawn at once, so one film cannot take every slot of a worker pool.
const PROJECT_CAP = Number.parseInt(process.env.SCENE_PROJECT_CAP ?? "3", 10);
// Same encode as the full render (RENDER_FLAGS in worker.mjs), so clips join without re-encoding.
const SCENE_FLAGS = ["--no-best-effort", "--workers", "1", "--quality", "standard", "--no-browser-gpu"];

const log = (level, event, fields = {}) => console.log(JSON.stringify({ level, event, ...fields }));
const UUID = /^[a-f0-9-]{36}$/i;
const PAGE_DIR = /^\/renders\/scenes\/([a-f0-9-]{36})\/pages\/[a-f0-9]{24}$/i;
const PAGE_PREFIX = /^scenes\/([a-f0-9-]{36})\/pages\/[a-f0-9]{24}$/i;

/**
 * The film page playing only frames [from, to): the clip's clock drives the film's paused timeline from `from`, so frame
 * k of the clip is frame from + k of the film, captured from the same page state. The soundtrack is not drawn here.
 */
export function scenePage(html, from, to, fps) {
  const clock = `<script id="ff-clip">(function () { var film = window.__timelines && window.__timelines.main; if (!film) return; film.pause(); var clip = gsap.timeline({ paused: true }); clip.add(film.tweenFromTo(${from} / ${fps}, ${to} / ${fps}, { ease: "none" }), 0); window.__timelines.main = clip; })();</script>`;
  const silent = html.replace(/<audio\b[^>]*><\/audio>/g, "");
  if (!silent.includes("</body>")) throw new Error("The film page has no body.");
  return silent.replace("</body>", () => `  ${clock}\n</body>`);
}

/** The film page with its pictures hidden: rendered at 1 fps, it is only a way to mix the soundtrack exactly as the full render does. */
export function soundtrackPage(html) {
  return html.replace("</head>", () => `  <style id="ff-soundtrack">#frame-film, #gm-watermark { display: none !important; }</style>\n</head>`);
}

/** Claims a queued clip for one attempt. Null when it is gone, drawn, no longer current, or the project is at its cap. */
async function claim(pool, clipId) {
  const result = await pool.query(
    `update app.scene_clips c
        set state = 'drawing', attempt = attempt + 1, frames_done = 0, thumb = null, thumb_frame = null, error = null, updated_at = now()
      where id = $1 and state = 'queued' and current
        and (select count(*) from app.scene_clips d where d.project_id = c.project_id and d.state = 'drawing') < $2
      returning id, project_id, kind, signature, attempt, frames_total, render_input`,
    [clipId, PROJECT_CAP]
  );
  return result.rows[0] ?? null;
}

const write = (pool, clip, sql, values) => pool.query(`update app.scene_clips set ${sql}, updated_at = now() where id = $1 and attempt = $2 and state = 'drawing' returning current`, [clip.id, clip.attempt, ...values]);

/** Draws one scene (or mixes the soundtrack) into its clip file. Throws on failure; the caller decides retry or fail. */
async function draw(pool, clip, signal) {
  const input = clip.render_input ?? {};
  const scratch = join("/tmp", `scene-${clip.id}-a${clip.attempt}`);
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true });
  try {
    let page;
    if (storageEnabled) {
      if (!PAGE_PREFIX.test(input.page?.prefix ?? "") || PAGE_PREFIX.exec(input.page.prefix)[1] !== clip.project_id) throw new Error("The film page location is invalid.");
      page = join(scratch, "page");
      await downloadProject(input.page.prefix, page);
    } else {
      if (!PAGE_DIR.test(input.page?.dir ?? "") || PAGE_DIR.exec(input.page.dir)[1] !== clip.project_id) throw new Error("The film page location is invalid.");
      page = input.page.dir;
    }
    const html = await readFile(join(page, "index.html"), "utf8");
    const soundtrack = clip.kind === "soundtrack";
    const from = Number(input.from), to = Number(input.to), fps = soundtrack ? 1 : Number(input.fps) || 30;
    if (!soundtrack && !(Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to > from)) throw new Error("The scene's frame range is invalid.");
    // Written next to the page's own index.html (relative asset paths), under a name no other clip uses; atomic, since
    // other scenes of the same page may be starting at the same moment.
    const name = soundtrack ? "soundtrack.html" : `clip-${from}-${to}.html`;
    await writeFile(join(page, `.${name}.${clip.id}`), soundtrack ? soundtrackPage(html) : scenePage(html, from, to, fps));
    await rename(join(page, `.${name}.${clip.id}`), join(page, name));

    const video = join(scratch, "clip.mp4");
    const thumb = join(scratch, "thumb.jpg");
    let framesDone = 0;
    let lastWrite = 0;
    let lastThumb = 0;
    let lost = null;
    let writing = Promise.resolve();
    const guard = new AbortController();
    const check = (result) => {
      if (result.rowCount === 0 || result.rows[0]?.current === false) { lost ??= result.rowCount === 0 ? "superseded" : "not current"; guard.abort(new Error(`Clip ${lost}.`)); }
    };
    const tick = (force = false) => {
      const now = Date.now();
      if (!force && now - lastWrite < 1000) return;
      lastWrite = now;
      const done = framesDone;
      writing = writing.then(() => write(pool, clip, "frames_done = $3", [done])).then(check).catch((error) => log("warn", "scene_progress_failed", { clipId: clip.id, message: error.message }));
    };
    // The live thumbnail: the encoder overwrites one small JPEG as it goes (ffmpeg-thumbs.sh); send it on when it changes.
    const thumbs = setInterval(() => {
      writing = writing.then(async () => {
        const info = await stat(thumb).catch(() => null);
        if (!info || info.mtimeMs === lastThumb) return;
        lastThumb = info.mtimeMs;
        check(await write(pool, clip, "thumb = $3, thumb_frame = $4", [await readFile(thumb), framesDone]));
      }).catch((error) => log("warn", "scene_thumb_failed", { clipId: clip.id, message: error.message }));
    }, 1200);
    try {
      await run(HYPERFRAMES, ["render", page, "--composition", name, "--variables-file", join(page, "variables.json"), "--output", video, "--fps", String(fps), ...SCENE_FLAGS.map((flag) => (soundtrack && flag === "standard" ? "draft" : flag))], {
        signal: AbortSignal.any([signal, guard.signal]),
        env: soundtrack ? {} : { HYPERFRAMES_FFMPEG_PATH: THUMBS, SCENE_THUMB: thumb },
        onLine(line) {
          const match = /frame\s+(\d+)\s*\/\s*(\d+)/i.exec(line);
          if (match && !soundtrack) { framesDone = Math.min(Number(match[1]), clip.frames_total); tick(); }
        }
      });
    } catch (error) {
      if (!lost) throw error;
    } finally {
      clearInterval(thumbs);
      await writing;
    }
    if (lost) return { lost };

    // A clip must hold exactly its frames, or the join would drift: count them before keeping it.
    let file = video;
    if (soundtrack) {
      file = join(scratch, "soundtrack.m4a");
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", video, "-vn", "-c:a", "copy", file], { signal });
    } else {
      const counted = Number((await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", video], { signal })).trim());
      if (counted !== to - from) throw new Error(`The clip has ${counted} frames, expected ${to - from}.`);
      // The last drawn frame, so the strip shows the finished scene.
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-sseof", "-0.1", "-i", video, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "5", thumb], { signal }).catch(() => undefined);
      const last = await readFile(thumb).catch(() => null);
      if (last) check(await write(pool, clip, "thumb = $3, thumb_frame = $4", [last, to - from]));
      if (lost) return { lost };
    }
    const ext = soundtrack ? "m4a" : "mp4";
    if (storageEnabled) {
      const key = `scenes/${clip.project_id}/${clip.signature}.${ext}`;
      await uploadOutput(file, key);
      return { output: { key } };
    }
    const relative = `scenes/${clip.project_id}/clips/${clip.signature}.${ext}`;
    await mkdir(join(RENDERS_DIR, "scenes", clip.project_id, "clips"), { recursive: true });
    await rename(file, join(RENDERS_DIR, relative)).catch(async () => { await writeFile(join(RENDERS_DIR, relative), await readFile(file)); });
    return { output: { file: relative } };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** pg-boss handler for one `render-scene` message. A failed scene is tried once more, then marked failed in plain words. */
export async function handleScene(job, { pool, boss }) {
  const clipId = job.data?.clipId;
  if (typeof clipId !== "string" || !UUID.test(clipId)) return;
  const clip = await claim(pool, clipId);
  if (!clip) {
    // Still wanted but its project is at the cap: look again shortly, without spending a retry.
    const { rows } = await pool.query("select 1 from app.scene_clips where id = $1 and state = 'queued' and current", [clipId]);
    if (rows.length) await boss.send(SCENE_QUEUE, { clipId }, { startAfter: 4 });
    return;
  }
  const started = Date.now();
  log("info", "scene_started", { clipId, projectId: clip.project_id, kind: clip.kind, attempt: clip.attempt, frames: clip.frames_total });
  try {
    const result = await draw(pool, clip, job.signal);
    if (result.lost) {
      await pool.query("update app.scene_clips set state = 'queued', frames_done = null, updated_at = now() where id = $1 and attempt = $2 and state = 'drawing'", [clip.id, clip.attempt]);
      log("info", "scene_dropped", { clipId, reason: result.lost });
      return;
    }
    const committed = await pool.query(
      "update app.scene_clips set state = 'drawn', output = $3, frames_done = frames_total, drawn_at = now(), updated_at = now() where id = $1 and attempt = $2 and state = 'drawing'",
      [clip.id, clip.attempt, result.output]);
    log("info", committed.rowCount ? "scene_drawn" : "scene_superseded", { clipId, kind: clip.kind, seconds: Math.round((Date.now() - started) / 100) / 10, fps: Math.round((clip.frames_total / Math.max(1, (Date.now() - started) / 1000)) * 10) / 10 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const last = job.retryCount >= 1;
    log("error", "scene_failed", { clipId, attempt: clip.attempt, final: last, message: message.slice(-400) });
    // The person never sees engine output: one plain sentence, the detail stays in the row and the log.
    await pool.query(
      "update app.scene_clips set state = $3, error = $4, updated_at = now() where id = $1 and attempt = $2 and state = 'drawing'",
      [clip.id, clip.attempt, last ? "failed" : "queued", { code: "scene_failed", message: last ? "This scene could not be drawn ahead; the final render will draw it with the rest of the film." : "Drawing this scene again.", detail: message.slice(-800) }]);
    if (!last) throw error;
  }
}

/**
 * The final render as a join: waits for every clip of the film (reporting the scenes still drawing as the job's frames),
 * then joins the scene clips in order and adds the soundtrack, without re-encoding the pictures. Returns false when the
 * clips cannot be used (one failed for good, or stopped being drawn), so the caller renders the full film instead.
 */
export async function joinScenes(plan, output, { pool, jobId, attempt, signal, onLost }) {
  const ids = [...(plan?.scenes ?? []), plan?.soundtrack];
  if (!UUID.test(plan?.projectId ?? "") || ids.some((id) => typeof id !== "string" || !UUID.test(id))) return false;
  const fps = Number(plan.fps) || 30;
  const started = Date.now();
  let rows;
  let lastDone = -1;
  let stalledSince = Date.now();
  for (;;) {
    if (signal.aborted) throw signal.reason ?? new Error("Aborted.");
    ({ rows } = await pool.query("select id, project_id, kind, state, current, frames_done, frames_total, output from app.scene_clips where id = any($1)", [ids]));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const clips = ids.map((id) => byId.get(id));
    if (clips.some((clip) => !clip || clip.project_id !== plan.projectId || clip.state === "failed" || (clip.state !== "drawn" && !clip.current))) return false;
    const scenes = clips.slice(0, -1);
    const done = scenes.reduce((sum, clip) => sum + (clip.state === "drawn" ? clip.frames_total : Math.min(clip.frames_done ?? 0, clip.frames_total)), 0);
    if (clips.every((clip) => clip.state === "drawn")) { rows = clips; break; }
    if (done !== lastDone) { lastDone = done; stalledSince = Date.now(); }
    // A scene that makes no progress for ten minutes is not coming: draw the film the usual way.
    if (Date.now() - stalledSince > 600_000) return false;
    const total = Number(plan.totalFrames) || scenes.reduce((sum, clip) => sum + clip.frames_total, 0);
    if (!(await progress(pool, jobId, attempt, { stage: "frames", progress: 52 + Math.round((done / Math.max(1, total)) * 38), framesDone: done, framesTotal: total }))) onLost();
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const waited = Date.now() - started;
  const total = rows.slice(0, -1).reduce((sum, clip) => sum + clip.frames_total, 0);
  if (!(await progress(pool, jobId, attempt, { stage: "encoding", progress: 92, framesDone: total, framesTotal: total }))) onLost();

  const scratch = join("/tmp", `join-${jobId}-a${attempt}`);
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true });
  try {
    const files = [];
    for (const [i, clip] of rows.entries()) {
      if (storageEnabled) {
        if (typeof clip.output?.key !== "string" || !clip.output.key.startsWith(`scenes/${plan.projectId}/`)) return false;
        const file = join(scratch, `${i}-${clip.output.key.split("/").pop()}`);
        await downloadOutput(clip.output.key, file);
        files.push(file);
      } else {
        if (typeof clip.output?.file !== "string" || !clip.output.file.startsWith(`scenes/${plan.projectId}/clips/`) || clip.output.file.includes("..")) return false;
        files.push(join(RENDERS_DIR, clip.output.file));
      }
    }
    const soundtrack = files.pop();
    const list = join(scratch, "scenes.txt");
    await writeFile(list, files.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
    // Stream copy: the clips were encoded exactly as the full render encodes, each opening on a keyframe.
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-i", soundtrack, "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-t", (total / fps).toFixed(6), "-movflags", "+faststart", "-metadata", "greedymotion_join=scenes", output], { signal });
    const counted = Number((await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", output], { signal })).trim());
    if (counted !== total) throw new Error(`The joined film has ${counted} frames, expected ${total}.`);
    log("info", "scenes_joined", { jobId, scenes: files.length, frames: total, waitedSeconds: Math.round(waited / 100) / 10, joinSeconds: Math.round((Date.now() - started - waited) / 100) / 10 });
    return true;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
