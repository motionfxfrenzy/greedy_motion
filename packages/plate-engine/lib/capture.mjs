// Browser half of the plate engine: opens ONE bundled scene page in Chromium (playwright-core), draws frames, verifies
// them, and encodes the clip. Runs on the render worker only; the backend never imports this file.
//
// The page is untrusted generated code: it is loaded from a file the worker wrote, every other request is aborted, there
// are no service workers, no secrets are placed in the page, and the caller bounds time (AbortSignal) and memory (pages).
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const md5 = (buf) => createHash("md5").update(buf).digest("hex");

/**
 * `code`: the scene itself is wrong (bounded model repair). `infra`: the same source is retried (browser start-up, a worker
 * interruption, storage or network). Every failure that is the scene's own carries kind "code" where it is raised; anything
 * unclassified is treated as infrastructure, so an unknown error can never cost a model call.
 */
export function classifyFailure(error) {
  return error?.kind === "code" ? "code" : "infra";
}

const fail = (kind, message, extra = {}) => Object.assign(new Error(message), { kind, ...extra });

async function playwright() {
  return (await import("playwright-core")).chromium;
}

/**
 * Opens a scene page. `executablePath` is the system Chromium (the worker image installs it; no browser download).
 * Network is blocked except the page file itself.
 */
export async function openScene(pagePath, { executablePath = process.env.PLATE_BROWSER_PATH || process.env.HYPERFRAMES_BROWSER_PATH || undefined, pages = 1, signal } = {}) {
  let browser;
  try {
    const chromium = await playwright();
    browser = await chromium.launch({
      executablePath,
      args: ["--disable-background-timer-throttling", "--disable-extensions", "--disable-dev-shm-usage", "--no-sandbox", "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost", ...(process.env.PLATE_CHROME_ARGS ? process.env.PLATE_CHROME_ARGS.split(" ") : [])]
    });
  } catch (error) {
    throw fail("infra", `Browser could not start: ${error.message}`);
  }
  const target = pathToFileURL(pagePath).href;
  const blocked = [];
  const context = await browser.newContext({ viewport: { width: 640, height: 640 }, deviceScaleFactor: 1, serviceWorkers: "block", acceptDownloads: false, permissions: [] });
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url === target || url.startsWith("data:") || url.startsWith("blob:") || url === "about:blank") return route.continue();
    blocked.push(url.slice(0, 200));
    return route.abort("blockedbyclient");
  });
  const list = [];
  try {
    for (let i = 0; i < pages; i++) {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(target, { timeout: 30_000 });
      try {
        await page.evaluate(async () => { await window.FILM.ready; window.FILM.mount(1); window.FILM.warm(); });
      } catch (error) {
        throw fail(/closed|crash/i.test(error.message) ? "infra" : "code", `Scene failed to start: ${[...errors, error.message].join("; ").slice(0, 1500)}`);
      }
      if (errors.length) throw fail("code", `Scene page error: ${errors.join("; ").slice(0, 1500)}`);
      list.push({ page, errors });
    }
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
  const abortHandler = () => { void browser.close().catch(() => undefined); };
  signal?.addEventListener("abort", abortHandler, { once: true });
  const pick = (w) => list[w % list.length].page;
  const draw = async (n, w) => {
    try {
      const b64 = await pick(w).evaluate((f) => { window.FILM.seek(f, { mode: "full" }); return window.FILM.png(); }, n);
      return Buffer.from(b64, "base64");
    } catch (error) {
      if (signal?.aborted) throw fail("infra", "aborted");
      throw fail(/closed|crash|Target/i.test(error.message) ? "infra" : "code", `Frame ${n} failed to draw: ${error.message}`.slice(0, 1500));
    }
  };
  return {
    workers: list.length,
    blocked,
    meta: () => list[0].page.evaluate(() => window.FILM.meta),
    frame: draw,
    close: async () => { signal?.removeEventListener("abort", abortHandler); await browser.close().catch(() => undefined); }
  };
}

/** The frames to verify: first, a true middle frame, and last. */
export const verifyFrames = (frames) => [...new Set([0, Math.max(1, Math.floor(frames / 2)), frames - 1].map((n) => Math.min(frames - 1, Math.max(0, n))))].sort((a, b) => a - b);

/**
 * Draws each verification frame twice on one page and once, reversed, on a second page. Any hash difference throws a
 * `code` failure (the model can repair non-determinism). Returns the PNGs of the true middle frame and a hash table.
 */
export async function verifyScene(pagePath, { frames, signal } = {}) {
  const session = await openScene(pagePath, { pages: 2, signal });
  try {
    const meta = await session.meta();
    if (meta.durationFrames !== frames) throw fail("code", `The scene lasts ${meta.durationFrames} frames, expected ${frames}.`);
    const list = verifyFrames(frames);
    const first = new Map(), mismatches = [];
    for (const n of list) {
      const a = await session.frame(n, 0), b = await session.frame(n, 0);
      first.set(n, a);
      if (md5(a) !== md5(b)) mismatches.push(`frame ${n} (same page)`);
    }
    for (const n of [...list].reverse()) {
      const c = await session.frame(n, 1);
      if (md5(c) !== md5(first.get(n))) mismatches.push(`frame ${n} (second page)`);
    }
    if (mismatches.length) throw fail("code", `DETERMINISM FAILURE: drawing the same frame twice produced different pixels (${mismatches.join(", ")}). Keep draw(ctx, frame, env) a pure function of (frame, env) using only seeded rng(seed), without mutating module-scope state across draws.`);
    const mid = list[Math.floor(list.length / 2)];
    const hashes = Object.fromEntries(list.map((n) => [n, md5(first.get(n))]));
    return { width: meta.W, height: meta.H, fps: meta.fps, frames: meta.durationFrames, hashes, midFrame: mid, midPng: first.get(mid), blocked: session.blocked };
  } finally {
    await session.close();
  }
}

/** Renders every frame to an H.264 MP4 (no audio), encoded exactly as the previous in-process renderer did. */
export async function renderScene(pagePath, outFile, { frames, fps = 30, workers = 2, ffmpeg = "ffmpeg", signal, onProgress } = {}) {
  const session = await openScene(pagePath, { pages: workers, signal });
  let ff;
  try {
    const meta = await session.meta();
    if (meta.durationFrames !== frames) throw fail("code", `The scene lasts ${meta.durationFrames} frames, expected ${frames}.`);
    ff = spawn(ffmpeg, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "medium", "-movflags", "+faststart", outFile], { stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    ff.stderr.on("data", (d) => { err = (err + d).slice(-1500); });
    const done = new Promise((resolve, reject) => { ff.on("close", (c) => (c ? reject(fail("infra", `ffmpeg exited ${c}: ${err}`)) : resolve())); ff.on("error", (e) => reject(fail("infra", `ffmpeg: ${e.message}`))); });
    done.catch(() => undefined);
    const pending = new Map();
    let next = 0, write = 0;
    const pump = async () => { while (pending.has(write)) { const b = pending.get(write); pending.delete(write); if (!ff.stdin.write(b)) await new Promise((r) => ff.stdin.once("drain", r)); write++; onProgress?.(write); } };
    await Promise.all(Array.from({ length: session.workers }, async (_, w) => {
      while (next < frames) {
        if (signal?.aborted) throw fail("infra", "aborted");
        const n = next++;
        while (n - write > session.workers * 3) await new Promise((r) => setTimeout(r, 5));
        pending.set(n, await session.frame(n, w));
        await pump();
      }
    }));
    await pump();
    ff.stdin.end();
    await done;
    return { blocked: session.blocked };
  } catch (error) {
    ff?.kill("SIGKILL");
    throw error;
  } finally {
    await session.close();
  }
}

/** ffprobe facts about a finished clip: what the assembler trusts instead of the saved seconds. */
export function probeVideo(file, { ffprobe = "ffprobe" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobe, ["-v", "error", "-count_packets", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,pix_fmt,r_frame_rate,nb_read_packets,duration:format=duration", "-of", "json", file]);
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code) return reject(new Error(`ffprobe failed (${code}): ${err.slice(-300)}`));
      const s = JSON.parse(out).streams?.[0] ?? {};
      const [num, den] = String(s.r_frame_rate ?? "0/1").split("/").map(Number);
      resolve({ codec: s.codec_name, width: s.width, height: s.height, pixFmt: s.pix_fmt, fps: den ? num / den : 0, frames: Number(s.nb_read_packets), duration: Number(s.duration ?? JSON.parse(out).format?.duration ?? 0) });
    });
  });
}
