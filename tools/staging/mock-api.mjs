// In-process mock of the backend routes the plates smoke script calls. Node `http` only; no Docker, no database, no network
// beyond the port it listens on. Response shapes are copied from the real backend (cited per route below). Failure switches:
//   options.fail (string or array), or POST /__control { fail: "..." } at run time. Known switches:
//   auth          every /v1 route answers 401 (server.ts registerAuth)
//   script        script stream sends { error }            plan        planning.status "failed" (plan/routes.ts)
//   voice         script/voice answers 503 audio_unavailable (plan/routes.ts)
//   animate       script/animate sends { type: "error" }
//   scene-failed  scene 2 goes to state "failed" with an error (plates/service.ts viewOf)
//   no-bundle     bundle route 404s                         bundle-not-html   the bundle body is not an HTML document
//   render        the render job fails and the spend is refunded (render/service.ts failForGood)
//   double-spend  the Idempotency-Key is ignored: every request makes a job and spends (the bug the smoke must catch)
//   not-mp4       the output is not an MP4                  quote-high  quote above SMOKE_MAX_TOKENS
//   quote-mismatch  the quote seconds differ from the film length (the billing bug found on staging 2026-11-05)
//   fix-same      a comment revision does not change the digest   fix-spill  a comment also changes scene 3
//   Options: mode "clip" (scenes reach `drawn`) or "live" (scenes stop at `bundled`, as with PLATE_LIVE_PREVIEW and no browser).
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const uuid = () => randomUUID();

/** A minimal ftyp+moov+mdat file, used only if the ffmpeg fixtures are missing (not decodable; the test then runs with SMOKE_FFPROBE=off). */
function syntheticMp4(size) {
  const box = (type, payload) => { const b = Buffer.alloc(8 + payload.length); b.writeUInt32BE(b.length, 0); b.write(type, 4, "latin1"); payload.copy(b, 8); return b; };
  return Buffer.concat([box("ftyp", Buffer.from("isom\0\0\x02\0isomiso2mp41", "latin1")), box("moov", Buffer.alloc(64)), box("mdat", Buffer.alloc(size))]);
}
const fixture = (name, fallbackSize) => { const file = join(HERE, "fixtures", name); return existsSync(file) ? readFileSync(file) : syntheticMp4(fallbackSize); };

const BUNDLE_HTML = "<!doctype html><html><head><meta charset=\"utf-8\"><title>scene</title><style>html,body{margin:0}</style></head><body><canvas id=\"c\" width=\"1920\" height=\"1080\"></canvas><script>/* inlined scene module */const c=document.getElementById('c').getContext('2d');c.fillRect(0,0,10,10);</script></body></html>";

export function startMock(options = {}) {
  const fails = new Set([].concat(options.fail ?? []));
  const state = {
    mode: options.mode ?? "clip", beats: options.beats ?? 3, expectedToken: options.token ?? null,
    balance: 40, ledger: [], projects: new Map(), jobs: new Map(), idem: new Map(), requests: [], mediaToken: `m-${uuid()}`, spendCount: 0
  };
  const film = fixture("film.mp4", 200_000);
  const clip = fixture("clip.mp4", 5_000);
  const SECONDS_PER_SCENE = 4;
  // The quote must be the finished film's length rounded up (render/quote.ts quoteFrom: ceil), so it follows the fixture film.
  const FILM_SECONDS = (() => { const f = join(HERE, "fixtures", "film.mp4"); try { const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }); const d = Number(String(r.stdout).trim()); return r.status === 0 && d > 0 ? Math.ceil(d - 0.05) : 12; } catch { return 12; } })();
  const QUOTE_TOKENS = () => (fails.has("quote-high") ? 500 : 6);

  const readBody = (req) => new Promise((resolve) => { let b = ""; req.on("data", (d) => { b += d; }); req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } }); });
  const send = (res, status, body, headers = {}) => { res.writeHead(status, { "Content-Type": "application/json", ...headers }); res.end(body === undefined ? "" : JSON.stringify(body)); };
  const notFound = (res) => send(res, 404, { error: { code: "not_found", message: "Not found." } });
  // plates/routes.ts and server.ts answer errors as { error: { code, message } }.
  const err = (res, status, code, message) => send(res, status, { error: { code, message } });
  const sseStart = (res) => res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
  const sseSend = (res, event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  const summary = () => ({
    remaining: state.balance, plan: null,
    free: { granted: 40, used: 40 - state.balance, remaining: state.balance }, packs: { remaining: 0 },
    recent: state.ledger.slice().reverse().slice(0, 20)
  });
  const ledger = (amount, kind, projectId) => { state.ledger.push({ id: state.ledger.length + 1, amount, kind, reason: "render", pool: "free", projectId, createdAt: new Date().toISOString() }); };

  const script = () => Array.from({ length: state.beats }, (_, i) => ({ keyword: `Scene ${i + 1} idea`, visual: `A lighthouse at step ${i + 1}`, onScreen: `On screen ${i + 1}`, line: `Spoken line number ${i + 1} about the lighthouse beam.` }));
  const plan = (p) => ({
    version: "1.0", mode: "own-script", template: null, format: "explainer", canvas: p.brief.aspect, target_duration_s: p.brief.durationSeconds,
    beats: p.brief.scriptBeats.map((b, i) => ({ id: `b${i + 1}`, role: "step", kind: "2d", producer: "hyperframes", line: b.line, keyword: b.keyword, on_screen: b.onScreen })),
    audio: {}, approvals: [], suggestions: [], estimate: {}
  });

  const newScene = (i) => ({ index: i, state: "queued", rev: 0, polls: 0, digest: null, variantId: uuid(), error: null, keyword: `Scene ${i + 1} idea`, clip: false });
  const digestOf = (scene) => (fails.has("fix-same") || fails.has("fix-stub-same") ? `d${scene.index}` : `d${scene.index}-r${scene.rev}-${scene.salt ?? 0}`);
  // plates/service.ts shown(): in clip mode `bundled` is shown as `rendering`.
  const shown = (s) => (s.state === "bundled" && state.mode === "clip" ? "rendering" : s.state);
  const advance = (p) => {
    for (const s of p.plates.scenes) {
      if (s.state === "failed") continue;
      if (fails.has("scene-failed") && s.index === 1 && s.state === "authoring") { s.state = "failed"; s.error = "authoring failed after 2 attempts"; continue; }
      if (s.state === "queued") s.state = "authoring";
      else if (s.state === "authoring") { s.state = "bundled"; s.digest = digestOf(s); }
      else if (s.state === "bundled" && state.mode === "clip") s.state = "rendering";
      else if (s.state === "rendering") { s.state = "drawn"; s.clip = true; }
    }
  };
  const platesView = (p) => {
    const scenes = p.plates.scenes.map((s) => ({
      index: s.index, keyword: s.keyword, state: shown(s), seconds: SECONDS_PER_SCENE, frames: SECONDS_PER_SCENE * 30, sig: `sig-${s.index}`, rev: s.rev,
      variantId: s.variantId, bundleDigest: s.digest, live: false,
      ...(s.state === "failed" ? { error: s.error } : {}),
      variants: { [p.brief.aspect]: { state: shown(s), sig: `sig-${s.index}`, v: s.clip ? `v${s.rev}` : null, variantId: s.variantId, bundleDigest: s.digest, live: false } }
    }));
    const open = p.plates.scenes.some((s) => ["queued", "authoring", "bundled", "rendering"].includes(s.state));
    return { available: true, look: p.brief.look, mode: state.mode, scenes, comments: p.plates.comments, subtitles: { mode: "key-phrases", style: "pill", aspects: [p.brief.aspect] }, running: open, drawnAspects: [], drawingAspects: [] };
  };

  const jobView = (job) => ({
    id: job.id, state: job.state, ...(job.stage ? { stage: job.stage } : {}), progress: job.progress, attempt: 1, createdAt: job.createdAt,
    revision: { id: uuid(), title: "smoke", scenes: [], look: job.look },
    ...(job.state === "ready" ? { output: { url: `/v1/renders/${job.id}`, format: "mp4", durationSeconds: 12 } } : {}),
    ...(job.state === "failed" ? { error: { code: "scene_needs_fix", message: "Scene 2 failed verification." } } : {})
  });
  const advanceJob = (job) => {
    const order = [["queued", "directing", 5], ["planning", "directing", 30], ["rendering", "waiting", 45], ["rendering", "frames", 70], ["rendering", "encoding", 95]];
    if (job.state === "ready" || job.state === "failed") return;
    if (job.step < order.length) { const [st, stage, pr] = order[job.step]; job.state = st; job.stage = stage; job.progress = pr; job.step += 1; return; }
    if (fails.has("render")) {
      job.state = "failed"; job.stage = "failed";
      if (!fails.has("no-refund")) { state.balance += job.cost; ledger(job.cost, "refund", job.projectId); }
    } else { job.state = "ready"; job.stage = "done"; job.progress = 100; }
  };

  // Object-store links point at a different origin ("localhost" vs the API's 127.0.0.1), as R2 presigned links do, so a script that
  // sent its bearer to every host would be caught (the /obj routes reject an Authorization header).
  const objectOrigin = () => `http://localhost:${server.address().port}`;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;
    const method = req.method;
    const reqRecord = { method, path, auth: req.headers.authorization ? "yes" : "no", idem: req.headers["idempotency-key"] ?? null, body: null };
    state.requests.push(reqRecord);
    if (path === "/__control" && method === "POST") { const b = await readBody(req); for (const f of [].concat(b.fail ?? [])) fails.add(f); if (b.clear) fails.clear(); if (b.mode) state.mode = b.mode; return send(res, 200, { fails: [...fails] }); }
    if (path === "/__state") return send(res, 200, { balance: state.balance, spendCount: state.spendCount, jobs: state.jobs.size, requests: state.requests.length });
    // server.ts:64
    if (path === "/healthz") return send(res, 200, { status: "ok", service: "backend" });
    // Object store stand-in (R2 presigned links): no auth, as a presigned URL carries its own signature.
    if (path.startsWith("/obj/")) {
      if (req.headers.authorization) return err(res, 400, "bad_signature", "An object-store link was sent an Authorization header.");
      if (path.startsWith("/obj/bundle/")) {
        if (fails.has("bundle-not-html")) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end("{\"not\":\"html\"}"); }
        const ctype = fails.has("bundle-ctype") ? "application/octet-stream" : "text/html";
        res.writeHead(200, { "Content-Type": ctype }); return res.end(BUNDLE_HTML);
      }
      if (path.startsWith("/obj/clip/")) { res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": clip.length }); return res.end(clip); }
      if (path === "/obj/film.mp4") {
        if (fails.has("not-mp4")) { res.writeHead(200, { "Content-Type": "video/mp4" }); return res.end(Buffer.alloc(200_000, 0x41)); }
        if (fails.has("small-mp4")) { const small = syntheticMp4(4_000); res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": small.length }); return res.end(small); }
        res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": film.length }); return res.end(film);
      }
      return notFound(res);
    }
    if (!path.startsWith("/v1/")) return notFound(res);

    // auth.ts: a bearer is required, except media routes which also accept ?t=<media token> (mediaGets).
    const mediaGet = method === "GET" && (/^\/v1\/renders\/[^/]+$/.test(path) || /^\/v1\/projects\/[^/]+\/plates\/\d+\/(clip|still)$/.test(path));
    const bearerOk = state.expectedToken === null ? true : req.headers.authorization === `Bearer ${state.expectedToken}`;
    const mediaOk = mediaGet && url.searchParams.get("t") === state.mediaToken;
    if (fails.has("auth") || (!bearerOk && !mediaOk)) return err(res, 401, "unauthorized", "Sign in to continue.");
    // The smoke must never put the bearer token in a URL.
    if (state.expectedToken && req.url.includes(state.expectedToken)) return err(res, 400, "token_in_url", "The bearer token is in the URL.");

    // GET /v1/me/tokens (tokens/routes.ts + tokens/store.ts tokenSummary)
    if (path === "/v1/me/tokens" && method === "GET") return send(res, 200, summary());
    // GET /v1/media-token (server.ts:188, media-links.ts mediaToken)
    if (path === "/v1/media-token") return send(res, 200, { token: state.mediaToken, expiresAt: new Date(Date.now() + 3 * 3600_000).toISOString() });

    // POST /v1/projects (server.ts:192, projects/store.ts createProject: 201 + a new project)
    if (path === "/v1/projects" && method === "POST") {
      const b = await readBody(req);
      reqRecord.body = b;
      if (typeof b.request?.prompt !== "string" || b.request.prompt.length < 12) return err(res, 400, "invalid_project", "Choose a template, format, and motion style before creating the project.");
      const now = new Date().toISOString();
      const project = { id: uuid(), ownerId: "00000000-0000-4000-8000-000000000000", name: b.name || "Untitled video", state: "Ready to create", createdAt: now, updatedAt: now, request: b.request, screenshots: [], comments: [] };
      state.projects.set(project.id, { project, brief: null, plates: { scenes: [], comments: [] }, planPolls: 0, voiced: false });
      return send(res, 201, project);
    }
    const m = /^\/v1\/projects\/([0-9a-f-]{36})(\/.*)?$/.exec(path);
    if (m) {
      const entry = state.projects.get(m[1]);
      if (!entry) return notFound(res);
      const sub = m[2] ?? "";
      const full = () => ({ ...entry.project, ...(entry.brief ? { brief: entry.brief } : {}), ...(entry.beatPlan ? { beatPlan: entry.beatPlan } : {}), ...(entry.planning ? { planning: entry.planning } : {}) });

      if (sub === "" && method === "PUT") { const b = await readBody(req); reqRecord.body = b; if (b.request) entry.project.request = b.request; if (typeof b.archived === "boolean") entry.project.archived = b.archived; return send(res, 200, full()); }
      // GET /v1/projects/:id (server.ts:202): the project; planning is cleared when the plan is applied (projects/store.ts updateProjectPlan)
      if (sub === "" && method === "GET") {
        if (entry.planning?.status === "running") { entry.planPolls += 1; if (entry.planPolls >= 2) { if (fails.has("plan")) entry.planning = { ...entry.planning, status: "failed", error: "The script director failed." }; else { delete entry.planning; entry.beatPlan = plan({ brief: entry.brief }); } } }
        return send(res, 200, full());
      }
      // POST script/stream (plan/routes.ts:255): events { t } ... { done, beats, notes, flags, ms } | { error }
      if (sub === "/script/stream" && method === "POST") {
        const b = await readBody(req);
        if (!b.brief?.text) return err(res, 400, "invalid_brief", "Describe the problem in at least a sentence.");
        sseStart(res);
        sseSend(res, { t: "IDEA: a lighthouse\n" }); sseSend(res, { t: "1. Scene" });
        if (fails.has("script")) sseSend(res, { error: "The script writer failed." });
        else sseSend(res, { done: true, beats: script(), notes: null, flags: [], ms: 1200 });
        return res.end();
      }
      // POST plan (plan/routes.ts:725): 202 { project } with planning.status "running"; the brief is saved with the plan
      if (sub === "/plan" && method === "POST") {
        const b = await readBody(req);
        if (!Array.isArray(b.scriptBeats) || !b.scriptBeats.length) return err(res, 400, "invalid_brief", "Send the script.");
        entry.brief = b; entry.planPolls = 0; entry.planning = { status: "running", startedAt: new Date().toISOString() };
        return send(res, 202, { project: full() });
      }
      // POST script/voice (plan/routes.ts:363): events start, take*, [music], done { failed, project }
      if (sub === "/script/voice" && method === "POST") {
        const b = await readBody(req);
        if (fails.has("voice")) return err(res, 503, "audio_unavailable", "Voiceover and music need GEMINI_API_KEY.");
        sseStart(res);
        const total = b.beats.length + (b.includeMusic ? 1 : 0);
        sseSend(res, { type: "start", total, progress: 2 });
        b.beats.forEach((_, index) => sseSend(res, { type: "take", index, file: `vo/${index}.wav`, seconds: 3.2, progress: Math.round(((index + 1) / total) * 100) }));
        if (b.includeMusic) sseSend(res, { type: "music", file: "music/bed.wav", seconds: 12, progress: 99 });
        entry.voiced = true;
        sseSend(res, { type: "done", progress: 100, failed: 0, project: full() });
        return res.end();
      }
      // GET composition (plan/routes.ts:937)
      if (sub === "/composition" && method === "GET") {
        if (!entry.beatPlan) return err(res, 409, "no_plan", "Generate the plan first.");
        const beatTimes = Object.fromEntries(entry.beatPlan.beats.map((bt, i) => [bt.id, { start: i * SECONDS_PER_SCENE, end: (i + 1) * SECONDS_PER_SCENE }]));
        return send(res, 200, { engine: "beat-plan", baseUrl: `/v1/preview/plans/${m[1]}`, canvas: entry.brief.aspect, durationSeconds: entry.beatPlan.beats.length * SECONDS_PER_SCENE, variables: {}, beatTimes, audio: { mode: "voiceover", ready: true }, readiness: { ok: true, blocking: [], warnings: [], durationSeconds: entry.beatPlan.beats.length * SECONDS_PER_SCENE }, slots: [] });
      }
      // POST script/animate (plan/routes.ts:521): stage/frame/voice/motion events, then done { progress, project } | { type: "error" }
      if (sub === "/script/animate" && method === "POST") {
        const b = await readBody(req);
        sseStart(res);
        sseSend(res, { type: "stage", stage: "frames", done: 0, total: b.beats.length, progress: 0 });
        if (fails.has("animate")) { sseSend(res, { type: "error", error: "Could not prepare the browser animation." }); return res.end(); }
        b.beats.forEach((_, i) => sseSend(res, { type: "frame", index: i, done: i + 1, total: b.beats.length, progress: 25 }));
        b.beats.forEach((_, i) => sseSend(res, { type: "motion", index: i, done: i + 1, total: b.beats.length, cached: false, progress: 98 }));
        sseSend(res, { type: "done", progress: 100, project: full() });
        return res.end();
      }
      // plates/routes.ts
      if (sub === "/plates" && method === "GET") { advance(entry); return send(res, 200, platesView(entry)); }
      if (sub === "/plates/draw" && method === "POST") {
        if (!entry.brief?.scriptBeats?.length) return err(res, 409, "plates", "Write the script and storyboard first.");
        if (!entry.plates.scenes.length) entry.plates.scenes = entry.brief.scriptBeats.map((_, i) => newScene(i));
        return send(res, 202, platesView(entry));
      }
      if (sub === "/plates/comments" && method === "POST") {
        const b = await readBody(req);
        if (!b.body) return err(res, 400, "plates", "Write what should change.");
        const scene = Math.min(entry.plates.scenes.length - 1, Math.floor(Number(b.at) / SECONDS_PER_SCENE));
        const comment = { id: randomUUID().replace(/-/g, "").slice(0, 12), at: Number(b.at), scene, sceneAt: Number(b.at) - scene * SECONDS_PER_SCENE, body: b.body };
        entry.plates.comments.push(comment);
        return send(res, 201, comment);
      }
      // plates/service.ts fixPlates: 409 while a target scene is drawing; rev rises and the scene is queued again
      if (sub === "/plates/fix" && method === "POST") {
        if (!entry.plates.comments.length) return err(res, 409, "plates", "Add a comment first.");
        const targets = [...new Set(entry.plates.comments.map((c) => c.scene))];
        const busyStates = state.mode === "live" ? ["queued", "authoring", "rendering"] : ["queued", "authoring", "bundled", "rendering"];
        if (targets.some((i) => busyStates.includes(entry.plates.scenes[i].state))) return err(res, 409, "plates", "Wait for the scenes that are being drawn.");
        const bump = (i) => { const s = entry.plates.scenes[i]; s.rev += 1; s.state = "queued"; s.clip = false; if (!fails.has("fix-same")) s.salt = (s.salt ?? 0) + 1; };
        targets.forEach(bump);
        if (fails.has("fix-spill") && entry.plates.scenes[2]) bump(2);
        entry.plates.comments = [];
        return send(res, 202, platesView(entry));
      }
      // plates/routes.ts bundle: { url, expiresAt, bundleDigest, manifest, params }; 404 unless the variant is authored
      let b2 = /^\/plates\/([0-9a-f-]{36})\/bundle$/.exec(sub);
      if (b2 && method === "GET") {
        const s = entry.plates.scenes.find((x) => x.variantId === b2[1]);
        if (!s || fails.has("no-bundle") || !["bundled", "checked", "rendering", "drawn"].includes(s.state)) return notFound(res);
        res.setHeader("Cache-Control", "no-store");
        const bundlePath = fails.has("fix-same") ? `/obj/bundle/${s.variantId}` : `/obj/bundle/${s.variantId}/g${s.rev + 1}/bundle.html`;
        return send(res, 200, { url: `${objectOrigin()}${bundlePath}`, expiresAt: new Date(Date.now() + 900_000).toISOString(), bundleDigest: s.digest, manifest: {}, params: {} });
      }
      // plates/routes.ts clip-request: 202 { state: "rendering" } for a bundled/checked scene
      b2 = /^\/plates\/([0-9a-f-]{36})\/clip-request$/.exec(sub);
      if (b2 && method === "POST") {
        const s = entry.plates.scenes.find((x) => x.variantId === b2[1]);
        if (!s) return notFound(res);
        if (!["bundled", "checked"].includes(s.state)) return err(res, 409, "invalid_state", "Scene is not in bundled or checked state.");
        s.state = "rendering"; s.requested = true;
        return send(res, 202, { state: "rendering" });
      }
      // plates/routes.ts clip: 302 to a short-lived object-store link; 404 until the scene has a clip
      b2 = /^\/plates\/(\d{1,2})\/clip$/.exec(sub);
      if (b2 && method === "GET") {
        const s = entry.plates.scenes[Number(b2[1])];
        if (!s || !s.clip) return notFound(res);
        res.writeHead(302, { Location: `${objectOrigin()}/obj/clip/${s.variantId}?sig=1`, "Cache-Control": "no-store" }); return res.end();
      }
      // render/quote.ts: quoteFrom(planReadiness(project), ...)
      if (sub === "/render/quote" && method === "GET") {
        if (!entry.beatPlan) {
          const tokens = fails.has("quote-high") ? QUOTE_TOKENS() : null;
          return send(res, 200, { seconds: null, tokens, parts: { start: 2, perSecond: 0.5, seconds: null }, ready: false, material: { required: false, owedTokens: 0 }, balance: state.balance, enough: false });
        }
        const seconds = FILM_SECONDS + (fails.has("quote-mismatch") ? 5 : 0);
        return send(res, 200, { seconds, tokens: QUOTE_TOKENS(), parts: { start: 2, perSecond: 0.5, seconds }, ready: true, material: { required: false, owedTokens: 0 }, balance: state.balance, enough: state.balance >= QUOTE_TOKENS() });
      }
      // server.ts:261 render + render/quote.ts idempotency hook: the same (project, key) returns 202 with the existing job before any spend
      if (sub === "/render" && method === "POST") {
        // server.ts: a project without a storyboard takes the legacy path and is refused before any spend (unless testing worker-failure refund on an empty project)
        if (!entry.beatPlan && !fails.has("render")) return err(res, 400, "script_unconfirmed", "Check and confirm the script before rendering.");
        const key = req.headers["idempotency-key"];
        const existingId = key ? state.idem.get(`${m[1]}:${key}`) : null;
        const existingJob = existingId ? state.jobs.get(existingId) : null;
        const ignoreIdem = fails.has("double-spend") || (fails.has("double-spend-running") && existingJob && existingJob.step > 0);
        if (existingJob && !ignoreIdem) return send(res, 202, jobView(existingJob));
        await new Promise((r) => setTimeout(r, 15)); // a race window: concurrent requests with one key must still make one job
        const againId = key ? state.idem.get(`${m[1]}:${key}`) : null;
        const againJob = againId ? state.jobs.get(againId) : null;
        const ignoreAgain = fails.has("double-spend") || (fails.has("double-spend-running") && againJob && againJob.step > 0);
        if (againJob && !ignoreAgain) return send(res, 202, jobView(againJob));
        const cost = QUOTE_TOKENS();
        if (state.balance < cost) return err(res, 402, "insufficient_tokens", "Not enough tokens.");
        state.balance -= cost; state.spendCount += 1; ledger(-cost, "spend", m[1]);
        const job = { id: uuid(), projectId: m[1], state: "queued", stage: "queued", progress: 0, step: 0, createdAt: new Date().toISOString(), cost, look: entry.brief?.look ?? "illus-blueprint" };
        state.jobs.set(job.id, job);
        if (key) state.idem.set(`${m[1]}:${key}`, job.id);
        return send(res, 202, jobView(job));
      }
      return notFound(res);
    }
    // server.ts:429 render job view, advanced one step per read
    let r = /^\/v1\/render-jobs\/([0-9a-f-]{36})$/.exec(path);
    if (r && method === "GET") { const job = state.jobs.get(r[1]); if (!job) return notFound(res); advanceJob(job); return send(res, 200, jobView(job), { "Cache-Control": "no-store" }); }
    // server.ts:475 output: a 302 to the MP4 when ready (R2 presigned link), or 200 directly whenstorageDriver !== "r2"
    r = /^\/v1\/renders\/([0-9a-f-]{36})$/.exec(path);
    if (r && method === "GET") {
      const job = state.jobs.get(r[1]);
      if (!job || job.state !== "ready") return err(res, 503, "video_unavailable", "The worker did not leave an output file.");
      if (fails.has("download-200")) { res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": film.length, "Cache-Control": "no-store" }); return res.end(film); }
      res.writeHead(302, { Location: `${objectOrigin()}/obj/film.mp4?sig=1`, "Cache-Control": "no-store" }); return res.end();
    }
    return notFound(res);
  });

  return new Promise((resolve) => {
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port, url: `http://127.0.0.1:${port}`, state, fails, close: () => new Promise((done) => { server.closeAllConnections?.(); server.close(() => done()); }) });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mock = await startMock({ port: Number(process.env.MOCK_PORT ?? 0), fail: (process.env.MOCK_FAIL ?? "").split(",").filter(Boolean), mode: process.env.MOCK_MODE, token: process.env.MOCK_TOKEN || null });
  console.log(`mock plates API listening on ${mock.url}`);
}
