#!/usr/bin/env node
// Plates film smoke test: drives the same public API calls the real frontend makes (frontend/lib/api.ts, the Studio flow in
// frontend/components/studio.tsx and plate-preview.tsx), from an empty account to a downloaded MP4. Plain Node 20+, built-in
// fetch only. No database, no object-store client: everything is checked from outside, as a signed-in user.
//
//   SMOKE_API=http://localhost:4100 node tools/staging/plates-smoke.mjs                       (local stack, AUTH_MODE=none)
//   SMOKE_API=https://backend-staging-aec6.up.railway.app SMOKE_TOKEN=... node tools/staging/plates-smoke.mjs
//
// Configuration is environment only (see README block in docs/staging/plates-smoke-report.md). The bearer token is never
// printed, never written to a file and never put in a URL; every output line goes through redact().
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(
    "Plates film smoke test. Configure with SMOKE_API (required), SMOKE_TOKEN, SMOKE_LOOK, SMOKE_BEATS, SMOKE_ASPECT, SMOKE_DURATION, SMOKE_AUDIO, SMOKE_OUT, SMOKE_STEPS, SMOKE_MAX_TOKENS, SMOKE_KEEP, SMOKE_PROJECT, SMOKE_POLL_MS, SMOKE_PLAN_TIMEOUT_MS, SMOKE_STREAM_TIMEOUT_MS, SMOKE_ANIMATE_TIMEOUT_MS, SMOKE_CLIP_TIMEOUT_MS, SMOKE_RENDER_TIMEOUT_MS, SMOKE_REQUEST_TIMEOUT_MS, SMOKE_FFPROBE. Flag: --continue."
  );
  process.exit(0);
}
const CONTINUE = argv.includes("--continue");

// ---------- configuration ----------
const int = (name, fallback) => { const v = Number(env[name]); return Number.isFinite(v) && v > 0 ? v : fallback; };
const TOKEN = (env.SMOKE_TOKEN ?? "").trim();
const rawApi = (env.SMOKE_API ?? "").trim();
if (!rawApi) { console.error("SMOKE_API is required, e.g. http://localhost:4100"); process.exit(2); }
// frontend/lib/api.ts: apiOrigin has no trailing slash and every path starts with "/v1/". A base given with /v1 would double it.
let API;
try {
  const u = new URL(rawApi);
  u.username = ""; u.password = ""; u.search = ""; u.hash = "";
  API = u.toString().replace(/\/+$/, "").replace(/\/v1$/, "");
} catch { console.error("SMOKE_API is not a valid URL"); process.exit(2); }
const API_ORIGIN = new URL(API).origin;
const ASPECT = env.SMOKE_ASPECT ?? "16:9";
if (!["16:9", "9:16", "1:1"].includes(ASPECT)) { console.error("SMOKE_ASPECT must be 16:9, 9:16 or 1:1"); process.exit(2); }
const LOOK = env.SMOKE_LOOK ?? "illus-blueprint";
if (!/^illus-[a-z0-9-]+$/.test(LOOK)) { console.error("SMOKE_LOOK must be an illus-* look"); process.exit(2); }
const BEATS = Math.round(int("SMOKE_BEATS", 3));
const DURATION = Math.min(120, Math.max(5, Math.round(int("SMOKE_DURATION", Math.max(10, BEATS * 4)))));
const AUDIO = env.SMOKE_AUDIO ?? "voiceover";
if (!["voiceover", "music", "both", "none"].includes(AUDIO)) { console.error("SMOKE_AUDIO must be voiceover, music, both or none"); process.exit(2); }
const MAX_TOKENS = int("SMOKE_MAX_TOKENS", 20);
const KEEP = ["1", "true", "yes", "on"].includes((env.SMOKE_KEEP ?? "").toLowerCase());
const CUSTOM_POLL_MS = env.SMOKE_POLL_MS ? int("SMOKE_POLL_MS", 3000) : null;
const POLL_MS = CUSTOM_POLL_MS ?? 3000;
// plate-preview.tsx line 244: flagEnabled (live mode) polls every 1500 ms, clip mode every 3000 ms.
const platePollMs = (mode) => CUSTOM_POLL_MS ?? ((mode ?? report?.mode) === "live" ? 1500 : 3000);
const T = {
  plan: int("SMOKE_PLAN_TIMEOUT_MS", 5 * 60_000),
  stream: int("SMOKE_STREAM_TIMEOUT_MS", 5 * 60_000),
  animate: int("SMOKE_ANIMATE_TIMEOUT_MS", 15 * 60_000),
  clip: int("SMOKE_CLIP_TIMEOUT_MS", 10 * 60_000),
  render: int("SMOKE_RENDER_TIMEOUT_MS", 20 * 60_000),
  request: int("SMOKE_REQUEST_TIMEOUT_MS", 30_000)
};
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT = resolve(env.SMOKE_OUT ?? join(HERE, "out", STAMP));
const ALL_STEPS = ["health", "create", "script", "plan", "animate", "preview-assets", "comment", "quote", "render", "download", "report"];
const requested = (env.SMOKE_STEPS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const unknown = requested.filter((s) => ![...ALL_STEPS, "refund"].includes(s));
if (unknown.length) { console.error(`Unknown SMOKE_STEPS entries: ${unknown.join(", ")}`); process.exit(2); }
const runStepNames = requested.length ? new Set(requested) : new Set(ALL_STEPS);
const FFPROBE_OFF = (env.SMOKE_FFPROBE ?? "") === "off";

// The brief of the plates project: a fixed two-sentence topic.
const TOPIC = "A lighthouse keeper lights the lamp every evening so ships can find the harbour in the dark. Explain, in a few simple scenes, why a lighthouse beam sweeps around instead of shining in one direction.";

// ---------- output with redaction ----------
const redact = (s) => {
  let text = String(s);
  if (TOKEN) text = text.split(TOKEN).join("[redacted]");
  return text.replace(/([?&]t=)[^&\s"']+/g, "$1[redacted]").replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[redacted]");
};
const out = (line) => console.log(redact(line));
const info = (line) => console.log(redact(`  ${line}`));
const warnings = [];
const warn = (line) => { warnings.push(redact(line)); console.log(redact(`  warn ${line}`)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

class Fail extends Error {}
class Abort extends Error {}
class Skip extends Error {}
const fail = (message) => { throw new Fail(message); };
const skip = (message) => { throw new Skip(message); };

// ---------- HTTP ----------
const sameOrigin = (url) => { try { return new URL(url, API).origin === API_ORIGIN; } catch { return false; } };
const abs = (path) => (/^https?:\/\//i.test(path) ? path : new URL(path, API + "/").toString());

/** One request. Authorization is sent only to the API's own origin (never to a presigned object-store link). */
async function request(method, path, { body, headers = {}, timeoutMs = T.request, redirect = "manual", auth = true } = {}) {
  const url = abs(path);
  const h = { ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (TOKEN && auth && sameOrigin(url)) h.Authorization = `Bearer ${TOKEN}`;
  let res;
  try {
    res = await fetch(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const cause = error?.cause?.code ?? error?.cause?.message ?? error?.name ?? "error";
    fail(`${method} ${shortPath(path)} could not be reached (${cause})`);
  }
  return res;
}
const shortPath = (path) => String(path).replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "");

async function describeError(res, method, path) {
  const text = await res.text().catch(() => "");
  let message = text.slice(0, 200);
  try { const j = JSON.parse(text); message = `${j?.error?.code ? j.error.code + ": " : ""}${j?.error?.message ?? message}`; } catch { /* plain text */ }
  return `${method} ${shortPath(path)} -> ${res.status} ${message}`.trim();
}

/** JSON call; throws Fail on a non-2xx answer. */
async function json(method, path, options = {}) {
  const res = await request(method, path, options);
  const ok = options.accept ? options.accept.includes(res.status) : res.ok;
  if (!ok) fail(await describeError(res, method, path));
  const text = await res.text();
  try { return { status: res.status, headers: res.headers, data: text ? JSON.parse(text) : null }; }
  catch { fail(`${method} ${shortPath(path)} -> ${res.status} did not answer JSON`); }
}

/** Server-sent events as the frontend reads them (`data: {...}` blocks separated by a blank line; ": ping" keep-alives ignored). */
async function sse(path, body, onEvent, timeoutMs = T.stream) {
  const res = await request("POST", path, { body, timeoutMs });
  if (!res.ok || !res.body) fail(await describeError(res, "POST", path));
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += value;
      let end;
      while ((end = buffered.indexOf("\n\n")) >= 0) {
        const block = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        if (!block.startsWith("data:")) continue;
        let event;
        try { event = JSON.parse(block.replace(/^data:\s*/, "")); } catch { fail(`${shortPath(path)} sent an event that is not JSON`); }
        if (onEvent(event) === "stop") { await reader.cancel().catch(() => undefined); return; }
      }
    }
  } catch (error) {
    if (error instanceof Fail) throw error;
    fail(`${shortPath(path)} stream broke (${error?.name ?? "error"})`);
  }
}

async function until(label, check, { timeoutMs, everyMs = POLL_MS }) {
  const t0 = now();
  for (;;) {
    const value = await check();
    if (value) return { value, ms: now() - t0 };
    if (now() - t0 > timeoutMs) fail(`timed out after ${Math.round(timeoutMs / 1000)} s waiting for ${label}`);
    await sleep(everyMs);
  }
}

// ---------- shared state and the report ----------
const ctx = { project: null, projectId: null, brief: null, beats: null, notes: null, scenes: [], quote: null, job: null, media: null };
const report = {
  api: API, look: LOOK, aspect: ASPECT, beatsRequested: BEATS, audioMode: AUDIO, startedAt: new Date().toISOString(),
  projectId: null, jobId: null, steps: [], balances: {}, quote: null, scenes: [], bundleSizes: [], clip: null, mp4: null, mode: null,
  idempotency: null, notChecked: [], warnings, result: null, failedStep: null, reportPath: null
};
const READY = (scene, mode) => scene.state === "drawn" || scene.state === "checked" || (mode === "live" && scene.state === "bundled");

async function tokens() {
  const { data } = await json("GET", "/v1/me/tokens");
  // frontend/lib/api.ts getMyTokens: remaining number, free, packs, recent[].
  if (typeof data?.remaining !== "number" || !data.free || !data.packs || !Array.isArray(data.recent)) fail("GET /v1/me/tokens -> unexpected token response");
  return data;
}
async function getPlates() {
  const { data } = await json("GET", `/v1/projects/${ctx.projectId}/plates`);
  if (!data || !Array.isArray(data.scenes)) fail("GET plates -> unexpected answer");
  return data;
}
async function mediaToken() {
  if (ctx.media && Date.parse(ctx.media.expiresAt) - now() > 60_000) return ctx.media.token;
  const { data } = await json("GET", "/v1/media-token");
  if (typeof data?.token !== "string" || !data.token) fail("GET /v1/media-token -> no token");
  ctx.media = data;
  return data.token;
}
const withMedia = async (path) => `${path}${path.includes("?") ? "&" : "?"}t=${encodeURIComponent(await mediaToken())}`;

async function loadReuseProject() {
  if (!env.SMOKE_PROJECT || ctx.projectId) return;
  const { data } = await json("GET", `/v1/projects/${env.SMOKE_PROJECT}`);
  ctx.project = data;
  ctx.projectId = data.id;
  ctx.brief = data.brief
    ? {
        ...data.brief,
        ...(env.SMOKE_AUDIO ? { audio: { ...(data.brief.audio ?? {}), mode: AUDIO, voice: data.brief.audio?.voice ?? "Kore" } } : {}),
        ...(env.SMOKE_LOOK ? { look: LOOK } : {}),
        ...(env.SMOKE_ASPECT ? { aspect: ASPECT } : {})
      }
    : null;
  ctx.beats = data.brief?.scriptBeats ?? null;
  report.projectId = data.id;
  info(`reusing project ${data.id}`);
}

let failedStep = null, aborted = null;

async function need(...names) {
  if (env.SMOKE_PROJECT && !ctx.projectId) await loadReuseProject();
  if (!ctx.projectId && !runStepNames.has("create") && !env.SMOKE_PROJECT) {
    fail("SMOKE_PROJECT is required when SMOKE_STEPS omits create");
  }
  if (names.includes("scenes") && (!ctx.scenes || !ctx.scenes.length) && ctx.projectId && !runStepNames.has("animate") && !failedStep && !aborted) {
    const st = await getPlates();
    if (st.scenes?.length) { ctx.scenes = st.scenes; report.mode ??= st.mode ?? null; }
  }
  const missing = names.filter((n) => ctx[n] === null || ctx[n] === undefined || (Array.isArray(ctx[n]) && !ctx[n].length));
  if (missing.length) {
    if (failedStep || aborted) skip(`needs ${missing.join(", ")} from an earlier step`);
    fail(`SMOKE_STEPS requires ${missing.join(", ")} (include earlier steps or set SMOKE_PROJECT)`);
  }
}

// ---------- steps ----------
const steps = {};

steps.health = async () => {
  const res = await request("GET", "/healthz", { auth: false });
  if (!res.ok) fail(`GET /healthz -> ${res.status}`);
  const t = await tokens(); // the auth check: a 401 here is the failure to look for
  report.balances.start = t.remaining;
  info(`balance ${t.remaining} tokens`);
  if (env.SMOKE_PROJECT) await loadReuseProject();
};

steps.create = async () => {
  // studio.tsx requestFromBrief + ensureProject + writeScript: POST /v1/projects { name, request }, then PUT /v1/projects/:id { request }.
  const prompt = TOPIC.trim().replace(/\s+/g, " ").slice(0, 600);
  const name = (TOPIC.trim().split(/[.!?\n]/)[0]?.slice(0, 80) || "Untitled video").trim();
  const request_ = {
    prompt, format: ASPECT === "9:16" ? "portrait" : "landscape", style: "clean", theme: "neutral", template: "product-launch",
    audio: { music: false, voiceover: false, voice: "Kore" }
  };
  const { status, data } = await json("POST", "/v1/projects", { body: { name, request: request_ } });
  if (status !== 201) fail(`POST /v1/projects -> ${status}, expected 201`);
  if (!/^[0-9a-f-]{36}$/i.test(data?.id ?? "")) fail("POST /v1/projects -> no project id");
  ctx.project = data; ctx.projectId = data.id; report.projectId = data.id;
  await json("PUT", `/v1/projects/${data.id}`, { body: { request: request_ } });
  // The brief exactly as ScriptStyleStep builds it (defaultBrief + the chosen look); validated by parseScriptBrief on the server.
  ctx.brief = {
    scriptMode: "problem", text: TOPIC, durationSeconds: DURATION, aspect: ASPECT, motionProfile: "smooth", pace: "balanced",
    audio: { mode: AUDIO, voice: "Kore" }, captions: "key-phrases", template: null, theme: "neutral", look: LOOK
  };
  info(`project ${data.id}`);
};

steps.script = async () => {
  await need("projectId", "brief");
  // studio.tsx writeScript -> api.streamScript: POST /v1/projects/:id/script/stream { brief }; events { t } ... { done, beats, notes, flags, ms } | { error }.
  let result = null, pieces = 0;
  await sse(`/v1/projects/${ctx.projectId}/script/stream`, { brief: ctx.brief }, (event) => {
    if (event.t) pieces += 1;
    if (event.error) fail(`script stream error: ${event.error}`);
    if (event.done) { result = event; return "stop"; }
  });
  if (!result) fail("the script stopped before it finished");
  const beats = result.beats ?? [];
  if (!beats.length) fail("the script came back with no beats");
  if (beats.some((b) => typeof b?.keyword !== "string" || !b.keyword.trim())) fail("a script beat has no key phrase");
  ctx.beats = beats; ctx.notes = result.notes ?? null;
  report.beatsGot = beats.length;
  info(`${beats.length} beats (asked for ${BEATS}), ${pieces} text pieces, ${result.ms ?? "?"} ms, ${(result.flags ?? []).length} flags`);
  if (beats.length !== BEATS) warn(`script has ${beats.length} beats, SMOKE_BEATS asked for ${BEATS}`);
};

steps.plan = async () => {
  await need("projectId", "brief", "beats");
  // studio.tsx buildStoryboard: POST /v1/projects/:id/plan { ...brief, scriptBeats, scriptNotes, screenshotIds } -> 202 { project }; the page polls the project.
  const body = { ...ctx.brief, scriptBeats: ctx.beats, ...(ctx.notes ? { scriptNotes: ctx.notes } : {}), screenshotIds: [] };
  const started = await json("POST", `/v1/projects/${ctx.projectId}/plan`, { body });
  if (started.status !== 202) fail(`POST plan -> ${started.status}, expected 202`);
  const t0 = now();
  const { value: planned } = await until("the storyboard", async () => {
    const { data } = await json("GET", `/v1/projects/${ctx.projectId}`);
    if (data.planning?.status === "failed") fail(`storyboard failed: ${data.planning.error ?? "no reason given"}`);
    return !data.planning && data.beatPlan?.beats?.length ? data : null;
  }, { timeoutMs: T.plan, everyMs: Math.min(POLL_MS, 2000) });
  ctx.project = planned;
  report.planMs = now() - t0;
  if (planned.beatPlan.beats.length !== ctx.beats.length) warn(`storyboard has ${planned.beatPlan.beats.length} beats for ${ctx.beats.length} script beats`);
  if (!planned.brief?.look?.startsWith("illus-")) fail(`project brief lost its plates look (look=${planned.brief?.look ?? "none"})`);

  // Voice and music: studio.tsx recordVoice -> api.streamScriptVoice (POST script/voice, events start/take/take-error/music/music-error/done).
  const voiced = AUDIO === "voiceover" || AUDIO === "both";
  const music = AUDIO === "music" || AUDIO === "both";
  if (voiced || music) {
    const wantedTakes = ctx.beats.filter((b) => typeof b.line === "string" && b.line.trim()).length;
    const seen = { takes: 0, takeErrors: [], music: false, musicError: null, done: null };
    const v0 = now();
    await sse(`/v1/projects/${ctx.projectId}/script/voice`, { brief: ctx.brief, beats: ctx.beats, includeMusic: music }, (event) => {
      if (event.type === "take") seen.takes += 1;
      else if (event.type === "take-error") seen.takeErrors.push(`scene ${event.index + 1}: ${event.error}`);
      else if (event.type === "music") seen.music = true;
      else if (event.type === "music-error") seen.musicError = event.error;
      else if (event.type === "done") { seen.done = event; return "stop"; }
    });
    if (!seen.done) fail("the voice stream closed before it finished");
    if (seen.takeErrors.length) fail(`voice failed: ${seen.takeErrors.join("; ")}`);
    if (voiced && seen.takes < wantedTakes) fail(`voice made ${seen.takes} of ${wantedTakes} takes`);
    if (music && !seen.music) fail(`music was not made${seen.musicError ? `: ${seen.musicError}` : ""}`);
    report.voiceMs = now() - v0;
    info(`voice ${seen.takes}/${wantedTakes} takes${music ? ", music bed" : ""}, ${report.voiceMs} ms`);
    if (seen.done.project) ctx.project = seen.done.project;
  } else info("audio mode none: voice skipped");

  // Timing: getComposition (beat-storyboard.tsx) reports each beat's slot on the film, the plan clock.
  const { data: comp } = await json("GET", `/v1/projects/${ctx.projectId}/composition`);
  const times = comp.beatTimes ?? {};
  const slots = planned.beatPlan.beats.map((b) => times[b.id]);
  if (!(comp.durationSeconds > 0)) fail("composition has no duration");
  if (slots.some((s) => !s || !(s.end > s.start))) fail("some storyboard beats have no timing");
  report.planSeconds = comp.durationSeconds;
  if (comp.readiness && comp.readiness.ok === false) fail(`storyboard not ready: ${(comp.readiness.blocking ?? []).map((b) => b.message).join("; ")}`);
  info(`storyboard ${planned.beatPlan.beats.length} beats, ${comp.durationSeconds.toFixed(1)} s`);
};

/** The scene rows worth recording (no secrets). */
const sceneRow = (s) => ({ index: s.index, state: s.state, rev: s.rev ?? null, variantId: s.variantId ?? null, bundleDigest: s.bundleDigest ?? null, sig: s.sig ?? null, seconds: s.seconds ?? null, live: s.live ?? null });

steps.animate = async () => {
  await need("projectId", "brief", "beats");
  // studio.tsx startBrowserAnimation -> api.streamScriptAnimate: POST script/animate { brief, beats }; stage/frame/voice/music/motion/done | error.
  const counts = { frame: 0, voice: 0, motion: 0 };
  let done = false;
  const a0 = now();
  await sse(`/v1/projects/${ctx.projectId}/script/animate`, { brief: ctx.brief, beats: ctx.beats }, (event) => {
    if (event.type === "error") fail(`animate failed: ${event.error}`);
    if (counts[event.type] !== undefined) counts[event.type] += 1;
    if (event.type === "done") { done = true; return "stop"; }
  }, T.animate);
  if (!done) fail("the animation preparation closed before it finished");
  info(`prepared in ${now() - a0} ms (frames ${counts.frame}, voice ${counts.voice}, motion ${counts.motion})`);

  // plate-preview.tsx mount: ensureMediaToken, getPlates; if available and not running and a scene is not done -> drawPlates; keep polling (1.5 s in live, 3 s in clip).
  await mediaToken();
  let status = await getPlates();
  if (!status.available) fail(`plates are not available for this project (look ${status.look ?? "none"}): the pipeline is off or the look is unsupported`);
  report.mode = status.mode ?? null;
  const isDone = (st) => st.scenes.length === ctx.beats.length && st.scenes.every((s) => READY(s, st.mode));
  const firstReady = {};
  if (!status.running && !isDone(status)) {
    const r = await json("POST", `/v1/projects/${ctx.projectId}/plates/draw`, { accept: [200, 202] });
    status = r.data;
  }
  const d0 = now();
  const settle = (st) => {
    for (const s of st.scenes) {
      if (s.state === "failed") fail(`scene ${s.index + 1} (${s.keyword}) failed: ${s.error ?? "no reason given"}`);
      if (READY(s, st.mode) && firstReady[s.index] === undefined) firstReady[s.index] = now() - d0;
    }
    return isDone(st) ? st : null;
  };
  const finished = settle(status) ?? (await until("every scene to be ready", async () => settle(await getPlates()), { timeoutMs: T.animate, everyMs: platePollMs(status.mode) })).value;
  report.mode = finished.mode ?? report.mode;
  ctx.scenes = finished.scenes;
  report.scenes = finished.scenes.map((s) => ({ ...sceneRow(s), msToReady: firstReady[s.index] ?? null }));
  const missing = finished.scenes.filter((s) => !s.variantId);
  if (missing.length) fail(`scene status does not expose variantId for scene ${missing[0].index + 1}`);
  if (finished.scenes.some((s) => !s.bundleDigest)) warn("some scenes expose no bundleDigest after authoring");
  info(`mode ${finished.mode ?? "unknown"}: ${finished.scenes.map((s) => `${s.index + 1}:${s.state}`).join(" ")} in ${now() - d0} ms`);
  if (finished.mode === "live") warn("live mode: scenes stay `bundled` until a browser checks them; the smoke treats bundled as authored");
};

const fetchBinary = async (url) => {
  // Presigned object-store links never carry Authorization.
  const res = await request("GET", url, { auth: false, timeoutMs: 120_000, redirect: "follow" });
  return res;
};

steps["preview-assets"] = async () => {
  await need("projectId", "scenes");
  // Live bundle: GET plates/:variantId/bundle -> { url, expiresAt, bundleDigest, manifest, params } (plates/routes.ts), then the bundle at `url`.
  for (const scene of ctx.scenes) {
    const t0 = now();
    const { data: bundle } = await json("GET", `/v1/projects/${ctx.projectId}/plates/${scene.variantId}/bundle`);
    if (typeof bundle?.url !== "string" || !bundle.url) fail(`scene ${scene.index + 1}: bundle route gave no url`);
    if (scene.bundleDigest && bundle.bundleDigest !== scene.bundleDigest) fail(`scene ${scene.index + 1}: bundle digest differs from the plate status`);
    const res = await fetchBinary(bundle.url);
    if (res.status !== 200) fail(`scene ${scene.index + 1}: bundle download -> ${res.status}`);
    const ctype = res.headers.get("content-type") ?? "";
    const text = await res.text();
    if (!text.length) fail(`scene ${scene.index + 1}: bundle is empty`);
    const lower = text.toLowerCase();
    const opens = (lower.match(/<html[\s>]/g) ?? []).length, closes = (lower.match(/<\/html>/g) ?? []).length;
    if (!(lower.trimStart().startsWith("<!doctype html") || lower.trimStart().startsWith("<html")) || opens !== 1 || closes !== 1) fail(`scene ${scene.index + 1}: bundle is not a single HTML document (html open ${opens}, close ${closes})`);
    if (!/html/i.test(ctype)) warn(`scene ${scene.index + 1}: bundle content-type is "${ctype || "none"}", not text/html`);
    if (/<script[^>]+\bsrc\s*=/i.test(text)) warn(`scene ${scene.index + 1}: bundle loads an external script`);
    const bytes = Buffer.byteLength(text);
    report.bundleSizes.push({ index: scene.index, bytes, ms: now() - t0, contentType: ctype });
    info(`bundle ${scene.index + 1}: ${bytes} bytes in ${now() - t0} ms`);
  }

  // Clip fallback: a drawn scene has a clip; in live mode a bundled scene needs clip-request (POST, 202 { state: "rendering" }) first.
  let target = ctx.scenes.find((s) => s.state === "drawn");
  if (!target) {
    target = ctx.scenes[0];
    const r = await json("POST", `/v1/projects/${ctx.projectId}/plates/${target.variantId}/clip-request`, { accept: [202] });
    info(`clip requested for scene ${target.index + 1}: ${r.data?.state ?? "?"}`);
    const c0 = now();
    const { value } = await until(`scene ${target.index + 1} to be drawn`, async () => {
      const st = await getPlates();
      const row = st.scenes.find((s) => s.index === target.index);
      if (row?.state === "failed") fail(`scene ${target.index + 1} failed while drawing the clip: ${row.error ?? "no reason given"}`);
      return row?.state === "drawn" ? row : null;
    }, { timeoutMs: T.clip, everyMs: platePollMs() });
    target = value;
    info(`clip drawn in ${now() - c0} ms`);
  }
  const t0 = now();
  const clipPath = await withMedia(`/v1/projects/${ctx.projectId}/plates/${target.index}/clip?aspect=${encodeURIComponent(ASPECT)}`);
  const redirect = await request("GET", clipPath, { auth: false, redirect: "manual" });
  let bytes;
  if (redirect.status >= 300 && redirect.status < 400) {
    if (redirect.status !== 302) warn(`clip route answered ${redirect.status}, expected 302`);
    const location = redirect.headers.get("location");
    if (!location) fail("clip route redirected without a Location");
    const res = await fetchBinary(location);
    if (res.status !== 200 && res.status !== 206) fail(`clip download -> ${res.status}`);
    bytes = Buffer.from(await res.arrayBuffer());
  } else if (redirect.status === 200) {
    warn("clip route answered 200, expected 302");
    bytes = Buffer.from(await redirect.arrayBuffer());
  } else fail(`clip route -> ${redirect.status}`);
  if (bytes.length < 1000) fail(`clip is only ${bytes.length} bytes`);
  if (bytes.subarray(4, 8).toString("latin1") !== "ftyp") fail("clip is not an MP4 (no ftyp box)");
  report.clip = { index: target.index, bytes: bytes.length, ms: now() - t0, redirected: redirect.status >= 300 };
  info(`clip ${target.index + 1}: ${bytes.length} bytes in ${now() - t0} ms`);
  report.notChecked.push("live canvas playback in a browser (no canvas code is run here)");
};

steps.comment = async () => {
  await need("projectId", "scenes");
  // fixPlates refuses while a target scene is being drawn; the comment at 1.0 s lands on the first scene, so wait for that one to be ready (reusing the live-mode rule from animate).
  const before = (await until("the first scene to be quiet", async () => {
    const st = await getPlates();
    const bad = st.scenes.find((s) => s.state === "failed");
    if (bad) fail(`scene ${bad.index + 1} failed: ${bad.error ?? "no reason given"}`);
    const first = st.scenes[0];
    return first && READY(first, st.mode) ? st : null;
  }, { timeoutMs: T.clip, everyMs: platePollMs() })).value;
  const snap = Object.fromEntries(before.scenes.map((s) => [s.index, sceneRow(s)]));
  const { data: bundleBefore } = await json("GET", `/v1/projects/${ctx.projectId}/plates/${before.scenes[0].variantId}/bundle`);
  const pathBefore = bundleBefore?.url ? new URL(bundleBefore.url, API).pathname : null;
  // plate-preview.tsx: addPlateComment (POST plates/comments { at, body } -> 201 { id, at, scene, sceneAt, body }), then fixPlates (POST plates/fix -> 202 status).
  const { status, data: comment } = await json("POST", `/v1/projects/${ctx.projectId}/plates/comments`, { body: { at: 1.0, body: "Make the sky slightly warmer." } });
  if (status !== 201) fail(`add comment -> ${status}, expected 201`);
  if (!/^[0-9a-f]{12}$/.test(comment?.id ?? "")) fail("the comment has no id");
  if (!Number.isInteger(comment.scene) || !snap[comment.scene]) fail(`the comment landed on scene ${comment.scene}, which does not exist`);
  const sceneIndex = comment.scene;
  const fix = await json("POST", `/v1/projects/${ctx.projectId}/plates/fix`, { accept: [202] });
  if (!fix.data?.scenes) fail("fix answered without scene status");
  const f0 = now();
  const { value: after } = await until(`scene ${sceneIndex + 1} to be redrawn`, async () => {
    const st = await getPlates();
    const row = st.scenes.find((s) => s.index === sceneIndex);
    if (row?.state === "failed") fail(`scene ${sceneIndex + 1} failed to take the comment: ${row.error ?? "no reason given"}`);
    return row && (row.rev ?? 0) > (snap[sceneIndex].rev ?? 0) && READY(row, st.mode) ? st : null;
  }, { timeoutMs: T.clip, everyMs: platePollMs(fix.data?.mode) });
  const changed = after.scenes.find((s) => s.index === sceneIndex);
  const was = snap[sceneIndex];
  const { data: bundleAfter } = await json("GET", `/v1/projects/${ctx.projectId}/plates/${changed.variantId}/bundle`);
  const pathAfter = bundleAfter?.url ? new URL(bundleAfter.url, API).pathname : null;
  const digestChanged = Boolean((was.bundleDigest || changed.bundleDigest) && changed.bundleDigest !== was.bundleDigest);
  const artifactChanged = Boolean(pathBefore && pathAfter && pathAfter !== pathBefore);
  if (was.bundleDigest || changed.bundleDigest) {
    if (!digestChanged && !artifactChanged) fail(`scene ${sceneIndex + 1}: revision ${was.rev} -> ${changed.rev} but bundleDigest did not change`);
    if (!digestChanged && artifactChanged) warn(`scene ${sceneIndex + 1}: revision ${was.rev} -> ${changed.rev} wrote a new bundle (${pathAfter}) with the same bundleDigest (stub returned identical code)`);
  } else warn("no bundleDigest exposed; only the revision number proves the redraw");
  for (const s of after.scenes) {
    if (s.index === sceneIndex) continue;
    const old = snap[s.index];
    if ((s.rev ?? 0) !== (old.rev ?? 0) || (s.bundleDigest ?? null) !== (old.bundleDigest ?? null)) fail(`scene ${s.index + 1} changed (rev ${old.rev} -> ${s.rev}) though only scene ${sceneIndex + 1} had a comment`);
  }
  if (after.comments?.some((c) => c.id === comment.id)) warn("the comment is still listed after the redraw");
  ctx.scenes = after.scenes;
  report.comment = { scene: sceneIndex, revFrom: was.rev, revTo: changed.rev, digestChanged, artifactChanged, ms: now() - f0 };
  report.scenes = after.scenes.map(sceneRow);
  info(`scene ${sceneIndex + 1} redrawn: rev ${was.rev} -> ${changed.rev} in ${now() - f0} ms; other scenes unchanged`);
};

steps.quote = async () => {
  if (runStepNames.has("animate")) await need("projectId", "scenes");
  else await need("projectId");
  const { data: q } = await json("GET", `/v1/projects/${ctx.projectId}/render/quote`);
  report.quote = q;
  if (typeof q.tokens !== "number" || !(q.tokens > 0) || typeof q.seconds !== "number") fail("the quote has no price");
  if (!q.ready) fail("the storyboard is not ready to render (quote.ready is false)");
  ctx.quote = q;
  info(`quote ${q.tokens} tokens for ${q.seconds} s, balance ${q.balance}`);
  if (q.tokens > MAX_TOKENS) throw new Abort(`quote ${q.tokens} tokens is above SMOKE_MAX_TOKENS=${MAX_TOKENS}`);
  if (!q.enough) fail(`balance ${q.balance} does not cover ${q.tokens} tokens`);
};

const near = (a, b) => Math.abs(a - b) < 0.0015;

steps.render = async () => {
  await need("projectId", "quote");
  const spendFor = (t) => t.recent.filter((e) => e.kind === "spend" && e.projectId === ctx.projectId);
  const start = await tokens();
  report.balances.beforeRender = start.remaining;
  const spendsBefore = spendFor(start).length;
  const key = randomUUID();
  const send = () => json("POST", `/v1/projects/${ctx.projectId}/render`, { headers: { "Idempotency-Key": key }, accept: [200, 202] });
  const first = await send();
  const second = await send(); // immediately, same key
  const [third, fourth] = await Promise.all([send(), send()]); // and two at once
  const ids = [first, second, third, fourth].map((r) => r.data?.id);
  if (!ids[0] || !/^[0-9a-f-]{36}$/i.test(ids[0])) fail("render answered without a job id");
  if (new Set(ids).size !== 1) fail(`the same Idempotency-Key produced ${new Set(ids).size} different jobs`);
  const afterPost = await tokens();
  const spent = start.remaining - afterPost.remaining;
  const entries = spendFor(afterPost).length - spendsBefore;
  report.idempotency = { requests: 4, jobIds: 1, spent, quoted: ctx.quote.tokens, spendEntries: entries, checkedWhileRunning: false };
  if (!near(spent, ctx.quote.tokens)) fail(`balance dropped by ${spent} for 4 requests with one key; the quote was ${ctx.quote.tokens} (spent ${spent / ctx.quote.tokens} times)`);
  if (entries > 1) fail(`${entries} spend entries were written for one Idempotency-Key`);
  report.balances.afterRender = afterPost.remaining;
  report.jobId = ids[0];
  info(`job ${ids[0]}; four requests, one key: one job, spent ${spent} (quote ${ctx.quote.tokens})`);

  // watchRenderJob's plain-poll fallback: GET /v1/render-jobs/:id until ready or failed. Also send a repeat request with the
  // same Idempotency-Key once the job is already running (gap b) and assert the same job id and single spend.
  const stages = [];
  let checkedRunning = false;
  const r0 = now();
  const { value: job } = await until("the render to finish", async () => {
    const { data } = await json("GET", `/v1/render-jobs/${ids[0]}`);
    const tag = `${data.state}${data.stage ? "/" + data.stage : ""}`;
    if (stages[stages.length - 1] !== tag) { stages.push(tag); info(`render ${tag} ${data.progress ?? ""}%${data.attempt > 1 ? " attempt " + data.attempt : ""}`); }
    if (!checkedRunning && (data.state === "planning" || data.state === "rendering" || data.state === "ready" || data.state === "failed")) {
      checkedRunning = true;
      const whileRunning = await send();
      const runningId = whileRunning.data?.id;
      const allIds = new Set([...ids, runningId]);
      const midTokens = await tokens();
      const midEntries = spendFor(midTokens).length - spendsBefore;
      const midSpent = start.remaining - midTokens.remaining;
      report.idempotency = { requests: 5, jobIds: allIds.size, spent: midSpent, quoted: ctx.quote.tokens, spendEntries: midEntries, checkedWhileRunning: true, runningState: data.state };
      if (runningId !== ids[0]) fail(`repeat render with same Idempotency-Key while job was ${data.state} produced a different job (${runningId} vs ${ids[0]})`);
      if (midEntries > 1 || (data.state !== "failed" && !near(midSpent, ctx.quote.tokens))) {
        fail(`repeat render with same Idempotency-Key while job was ${data.state} spent ${midSpent} (expected ${ctx.quote.tokens}, entries ${midEntries})`);
      }
    }
    return data.state === "ready" || data.state === "failed" ? data : null;
  }, { timeoutMs: T.render });
  report.job = { state: job.state, stages, attempt: job.attempt ?? 1, ms: now() - r0, look: job.revision?.look ?? null };
  const end = await tokens();
  report.balances.end = end.remaining;
  if (job.state === "failed") {
    report.refunded = near(end.remaining, start.remaining);
    report.refund = { mode: "worker-failure", jobId: job.id, balanceBefore: start.remaining, balanceAfterPost: afterPost.remaining, balanceAfter: end.remaining, balanceChange: end.remaining - start.remaining, restored: report.refunded };
    fail(`render failed: ${job.error?.code ?? "no code"}: ${job.error?.message ?? "no message"} (${report.refunded ? "tokens refunded" : "tokens NOT refunded"})`);
  }
  ctx.job = job;
  if (!job.output?.url || job.output.format !== "mp4") fail("the finished job has no mp4 output");
  if (!(job.output.durationSeconds > 0)) fail("the finished job reports no duration");
  if (job.revision?.look && job.revision.look !== LOOK) fail(`job look ${job.revision.look} is not ${LOOK}`);
  if (!near(start.remaining - end.remaining, ctx.quote.tokens)) fail(`final balance changed by ${start.remaining - end.remaining}, expected ${ctx.quote.tokens} (settled)`);
  info(`render ready in ${now() - r0} ms`);
};

steps.download = async () => {
  await need("projectId", "job");
  if (!ctx.job.output?.url) fail("no output url on the job");
  // The output route answers a 302 redirect to the MP4 when ready (render/ GET /v1/renders/:id). Any other 3xx or a direct 200 is recorded as a warning.
  const path = await withMedia(ctx.job.output.url);
  const first = await request("GET", path, { auth: false, redirect: "manual", timeoutMs: 180_000 });
  let res = first, redirected = false;
  if (first.status >= 300 && first.status < 400) {
    if (first.status !== 302) warn(`output route answered ${first.status}, expected 302`);
    const location = first.headers.get("location");
    if (!location) fail("output route redirected without a Location");
    redirected = true;
    res = await fetchBinary(location);
  } else if (first.status === 200) {
    warn("output route answered 200, expected 302");
  } else {
    fail(`output download -> ${first.status}${first.status === 503 ? " (video_unavailable)" : ""}`);
  }
  if (res.status !== 200 && res.status !== 206) fail(`output download -> ${res.status}${first.status === 503 ? " (video_unavailable)" : ""}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 100 * 1024) fail(`film.mp4 is only ${bytes.length} bytes`);
  if (bytes.subarray(4, 8).toString("latin1") !== "ftyp") fail("film.mp4 does not start with an MP4 ftyp box");
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, "film.mp4");
  writeFileSync(file, bytes);
  const facts = { file, bytes: bytes.length, redirected, redirectStatus: first.status, contentType: res.headers.get("content-type") ?? null, ffprobe: "skipped" };
  const probe = FFPROBE_OFF ? { status: 127 } : spawnSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,nb_read_frames,duration", "-show_entries", "format=duration", "-of", "json", file], { encoding: "utf8" });
  if (probe.error || probe.status === 127 || FFPROBE_OFF) { warn("ffprobe not available: width, height, duration and frame count not checked"); }
  else if (probe.status !== 0) { rmSync(file, { force: true }); fail(`ffprobe could not read film.mp4: ${(probe.stderr ?? "").trim().slice(0, 160)}`); }
  else {
    const parsed = JSON.parse(probe.stdout);
    const v = parsed.streams?.[0] ?? {};
    const duration = Number(parsed.format?.duration ?? v.duration);
    Object.assign(facts, { ffprobe: "ok", codec: v.codec_name, width: v.width, height: v.height, durationSeconds: duration, frames: Number(v.nb_read_frames) });
    const [aw, ah] = ASPECT.split(":").map(Number);
    if (!v.width || Math.abs(v.width / v.height - aw / ah) > 0.02) { rmSync(file, { force: true }); fail(`film is ${v.width}x${v.height}, not ${ASPECT}`); }
    if (!(duration > 0) || !(facts.frames > 0)) { rmSync(file, { force: true }); fail("film has no frames or no duration"); }
    // Billing rule (docs/PRICING.md): the quote charges each started second of the finished film, so the quoted seconds must be the film's length rounded up (0.05 s allowed for container padding).
    if (ctx.quote?.seconds != null && ctx.quote.seconds !== Math.ceil(duration - 0.05)) fail(`quote said ${ctx.quote.seconds} s but film.mp4 lasts ${duration.toFixed(2)} s (expected ${Math.ceil(duration - 0.05)} s): the render was ${ctx.quote.seconds < duration ? "undercharged" : "overcharged"}`);
    if (Math.abs(duration - ctx.job.output.durationSeconds) > 2) warn(`film lasts ${duration.toFixed(2)} s, the job says ${ctx.job.output.durationSeconds} s`);
  }
  report.mp4 = facts;
  info(`film.mp4 ${bytes.length} bytes${facts.width ? `, ${facts.width}x${facts.height}, ${facts.durationSeconds.toFixed(2)} s, ${facts.frames} frames, ${facts.codec}` : ""}`);
};

/** SMOKE_STEPS=refund only. Checks the quote against SMOKE_MAX_TOKENS, records balance before/after, and asserts a refused or failed render restores the balance exactly. */
steps.refund = async () => {
  if (env.SMOKE_PROJECT && !ctx.projectId) await loadReuseProject();
  if (ctx.projectId) {
    const { data: q } = await json("GET", `/v1/projects/${ctx.projectId}/render/quote`);
    if (typeof q?.tokens === "number" && q.tokens > MAX_TOKENS) throw new Abort(`quote ${q.tokens} tokens is above SMOKE_MAX_TOKENS=${MAX_TOKENS}`);
  }
  const { data: p } = await json("POST", "/v1/projects", { body: { name: `smoke refund ${STAMP}`.slice(0, 80), request: { prompt: "Refund check: an empty project that cannot render.", format: "landscape", style: "clean", theme: "neutral", template: "product-launch", audio: { music: false, voiceover: false, voice: "Kore" } } } });
  const archiveTemp = () => request("PUT", `/v1/projects/${p.id}`, { body: { archived: true } }).then((r) => r.text()).catch(() => undefined);
  const { data: pq } = await json("GET", `/v1/projects/${p.id}/render/quote`);
  if (typeof pq?.tokens === "number" && pq.tokens > MAX_TOKENS) {
    await archiveTemp();
    throw new Abort(`quote ${pq.tokens} tokens is above SMOKE_MAX_TOKENS=${MAX_TOKENS}`);
  }
  const start = await tokens();
  const res = await request("POST", `/v1/projects/${p.id}/render`, { headers: { "Idempotency-Key": randomUUID() } });
  const text = await res.text().catch(() => "");
  if (res.status === 202) {
    let queued = null;
    try { queued = JSON.parse(text); } catch { /* ignore */ }
    if (!queued?.id) { await archiveTemp(); fail("refund render answered 202 without a job id"); }
    const { value: job } = await until("the refund check render to finish", async () => {
      const { data } = await json("GET", `/v1/render-jobs/${queued.id}`);
      return data.state === "ready" || data.state === "failed" ? data : null;
    }, { timeoutMs: T.render });
    await archiveTemp();
    const end = await tokens();
    const restored = near(start.remaining, end.remaining);
    report.refund = { mode: "worker-failure", jobId: job.id, balanceBefore: start.remaining, balanceAfter: end.remaining, balanceChange: end.remaining - start.remaining, restored };
    if (job.state !== "failed") fail(`render of an empty project finished as ${job.state}, expected a refusal or failure`);
    if (!restored) fail(`failed render did not restore the balance: before ${start.remaining}, after ${end.remaining}`);
    info(`failed render refunded tokens: balance ${start.remaining} -> ${end.remaining}`);
    return;
  }
  const refused = res.status >= 400;
  const end = await tokens();
  await archiveTemp();
  const restored = near(start.remaining, end.remaining);
  report.refund = { mode: "refused-render", refusedStatus: res.status, balanceBefore: start.remaining, balanceAfter: end.remaining, balanceChange: end.remaining - start.remaining, restored };
  if (!refused) fail(`render of an empty project answered ${res.status}, expected a refusal`);
  if (!restored) fail(`a refused render changed the balance by ${end.remaining - start.remaining} (before ${start.remaining}, after ${end.remaining})`);
  report.notChecked.push("refund after a user cancel or a worker failure: no public cancel route exists (user cancel is not refunded; failures are); check app.token_ledger in the DB");
  info(`refused render (${res.status}) charged nothing: balance ${start.remaining} -> ${end.remaining}`);
};

// ---------- runner ----------
const finalReport = () => {
  report.finishedAt = new Date().toISOString();
  report.notChecked.push("zero `plate-render` jobs for drawn scenes and manifest schema 2 (checked by the manager in the DB/logs)", "R2 object contents and keys", "worker DB access (none by design)");
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, "report.json");
  report.reportPath = file;
  writeFileSync(file, redact(JSON.stringify(report, null, 2)));
  return file;
};

const stepOrder = [...ALL_STEPS.filter((s) => s !== "report"), ...(runStepNames.has("refund") ? ["refund"] : [])];
for (const name of stepOrder) {
  if (!runStepNames.has(name)) { report.steps.push({ name, status: "skipped", ms: 0 }); continue; }
  if (failedStep && !CONTINUE) { report.steps.push({ name, status: "skipped", ms: 0 }); continue; }
  if (aborted) { report.steps.push({ name, status: "skipped", ms: 0 }); continue; }
  const t0 = now();
  try {
    await steps[name]();
    const ms = now() - t0;
    report.steps.push({ name, status: "ok", ms });
    out(`step ${name} ok ${ms}`);
  } catch (error) {
    const ms = now() - t0;
    if (error instanceof Abort) { aborted = { step: name, reason: error.message }; report.steps.push({ name, status: "abort", ms, reason: error.message }); out(`step ${name} ABORT ${error.message}`); continue; }
    if (error instanceof Skip) { report.steps.push({ name, status: "skipped", ms, reason: redact(error.message) }); out(`step ${name} skipped ${error.message}`); continue; }
    const reason = error instanceof Fail ? error.message : `unexpected ${error?.name ?? "error"}: ${error?.message ?? error}`;
    report.steps.push({ name, status: "fail", ms, reason: redact(reason) });
    out(`step ${name} FAIL ${reason}`);
    failedStep ??= name;
  }
}

// Archive (never delete) the project unless SMOKE_KEEP is set.
if (ctx.projectId && !KEEP && !env.SMOKE_PROJECT) {
  try { const r = await request("PUT", `/v1/projects/${ctx.projectId}`, { body: { archived: true } }); await r.text(); if (r.ok) info("project archived"); else warn(`could not archive the project (${r.status})`); }
  catch { warn("could not archive the project"); }
}

report.result = failedStep ? "fail" : aborted ? "abort" : "pass";
report.failedStep = failedStep ?? aborted?.step ?? null;
if (aborted) report.abortReason = aborted.reason;
const reportStart = now();
report.steps.push({ name: "report", status: "ok", ms: 0 });
let reportFile = join(OUT, "report.json");
try { reportFile = finalReport(); out(`step report ok ${now() - reportStart}`); }
catch (error) { out(`step report FAIL ${error?.message}`); failedStep ??= "report"; }
if (failedStep) { out(`SMOKE FAIL ${failedStep} ${reportFile}`); process.exit(1); }
if (aborted) { out(`SMOKE ABORT ${aborted.step} ${reportFile}`); process.exit(3); }
out(`SMOKE PASS ${reportFile}`);
process.exit(0);
