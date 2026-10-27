// Live render job updates. One LISTEN connection per backend replica receives app.render_jobs changes (the trigger in
// migrations/008_render_job_events.sql) and pushes the browser view of a job to every page watching it.
//
// Database cost, by design:
// - Nothing is read for a job nobody is watching, and nothing at all while no job is watched (no heartbeat either).
// - A progress or frame tick is applied from the notification itself: no read.
// - A state, stage or error change reloads the job once for all its watchers on this replica (loads are coalesced).
// - Without a working LISTEN, one timer per replica reloads each watched job every 3 s, however many pages watch it.
//
// This is the only module that knows where events come from. Moving to Redis pub/sub or Supabase Realtime later
// means replacing the LISTEN client here; the SSE route and the page stay as they are.
import type { RenderJob, RenderJobState, RenderStage } from "@videosaas/contracts";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { config } from "../config.ts";
import { pool } from "../db/database.ts";
import { renderJobRepository } from "./repository.ts";

type Watcher = (job: RenderJob) => void;
type Notice = {
  id?: string; state?: RenderJobState; stage?: RenderStage; progress?: number; framesDone?: number | null; framesTotal?: number | null;
  attempt?: number; was?: string | null; reload?: boolean; ping?: string;
};

const CHANNEL = "render_jobs";
// Scene clips drawn in the background (render/scenes.ts, migration 009) share this connection.
const SCENE_CHANNEL = "scene_clips";
const REPLICA = randomUUID();
const PING_EVERY_MS = Number(process.env.RENDER_EVENTS_PING_MS ?? 15_000);
const PING_WAIT_MS = 5000;
const FALLBACK_MS = 3000;
const watchers = new Map<string, Set<Watcher>>();
export type SceneNotice = { id: string; projectId: string; kind: "scene" | "soundtrack"; index: number; state: string; current: boolean; framesDone: number | null; framesTotal: number; thumbFrame: number | null; reload: boolean };
const sceneWatchers = new Map<string, Set<(notice: SceneNotice) => void>>();
/** Pages watching anything: the heartbeat runs only while there is one. */
const watching = () => watchers.size + sceneWatchers.size;
/** Server-side listeners for every job change, watched or not (in memory only: they cost no reads). */
const observers: Array<(notice: { id: string; stage?: RenderStage }) => void> = [];
const lastSeen = new Map<string, RenderJob>();
const loading = new Map<string, { again: boolean }>();
let client: pg.Client | null = null;
let listening = false;
/** A check of a connection that was idle, not a recovery from an outage. */
let verifying = false;
let stopped = true;
let retryMs = 1000;
let pings = 0;
let pending: { token: string; timer: NodeJS.Timeout } | null = null;
let heartbeat: NodeJS.Timeout | undefined;
let fallback: NodeJS.Timeout | undefined;

const log = (level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) =>
  console[level === "info" ? "log" : level](JSON.stringify({ level, event, ...fields }));

function deliver(id: string, job: RenderJob) {
  lastSeen.set(id, job);
  for (const watcher of watchers.get(id) ?? []) watcher(job);
}

/** Reloads one watched job and hands it to its watchers. Changes that arrive mid-load are coalesced into one more load. */
async function load(id: string) {
  if (!watchers.has(id)) return;
  const busy = loading.get(id);
  if (busy) { busy.again = true; return; }
  const state = { again: false };
  loading.set(id, state);
  try {
    do {
      state.again = false;
      const job = await renderJobRepository.find(id);
      if (!job) break;
      deliver(id, job);
    } while (state.again && watchers.has(id));
  } catch (error) {
    log("warn", "render_event_load_failed", { jobId: id, message: error instanceof Error ? error.message : String(error) });
  } finally {
    loading.delete(id);
  }
}

function onNotice(payload: string | undefined) {
  let notice: Notice;
  try { notice = JSON.parse(payload ?? "") as Notice; } catch { return; }
  if (typeof notice.ping === "string") { pong(notice.ping); return; }
  const id = notice.id;
  if (typeof id !== "string") return;
  for (const observer of observers) observer({ id, stage: notice.stage });
  if (watchers.has(id)) {
    const known = lastSeen.get(id);
    // A progress tick: the notification has everything that changed.
    if (known && !notice.reload && !loading.has(id) && known.state === notice.state && known.stage === notice.stage) {
      const { frames: _frames, ...rest } = known;
      deliver(id, {
        ...rest,
        progress: notice.progress ?? known.progress,
        ...(notice.framesTotal ? { frames: { done: notice.framesDone ?? 0, total: notice.framesTotal } } : {}),
        ...(notice.attempt ? { attempt: notice.attempt } : {}),
        updatedAt: new Date().toISOString()
      });
    } else {
      void load(id);
    }
  }
  // A job leaving the render queue moves every watched job behind it up one place.
  if (notice.was === "waiting" && notice.stage !== "waiting") {
    for (const [other, job] of lastSeen) if (other !== id && job.stage === "waiting") void load(other);
  }
}

function onSceneNotice(payload: string | undefined) {
  let notice: SceneNotice;
  try { notice = JSON.parse(payload ?? "") as SceneNotice; } catch { return; }
  for (const watcher of sceneWatchers.get(notice.projectId) ?? []) watcher(notice);
}

/** Without working pushes, every watched job is reloaded on one timer for the whole replica. */
function syncFallback() {
  const needed = !stopped && !listening && watchers.size > 0;
  if (needed && !fallback) fallback = setInterval(() => { for (const id of watchers.keys()) void load(id); }, FALLBACK_MS);
  if (!needed && fallback) { clearInterval(fallback); fallback = undefined; }
}

function setListening(next: boolean) {
  listening = next;
  syncFallback();
}

/**
 * Heartbeat, only while a job is watched: this replica notifies itself through the ordinary pool and counts as live only
 * while that ping comes back on the LISTEN connection. A pooler can accept LISTEN and then deliver nothing (transaction
 * mode), and a connection can die without an error; either way the ping goes missing, the fallback timer takes over, and
 * the connection is replaced.
 */
function ping() {
  const current = client;
  if (!current || pending || watching() === 0) return;
  const token = `${REPLICA}:${++pings}`;
  const timer = setTimeout(() => {
    if (pending?.token !== token) return;
    pending = null;
    log("warn", "render_events_silent", { wasLive: listening, waitedMs: PING_WAIT_MS, retryMs });
    verifying = false;
    setListening(false);
    void current.end().catch(() => undefined); // "end" schedules the reconnect
  }, PING_WAIT_MS);
  pending = { token, timer };
  pool.query("select pg_notify($1, $2)", [CHANNEL, JSON.stringify({ ping: token })]).catch((error) => {
    // The database is unreachable for everyone; the next heartbeat tries again.
    if (pending?.token === token) { clearTimeout(timer); pending = null; }
    log("warn", "render_events_ping_failed", { message: error instanceof Error ? error.message : String(error) });
  });
}

function pong(token: string) {
  if (pending?.token !== token) return; // another replica's heartbeat
  clearTimeout(pending.timer);
  pending = null;
  if (listening) return;
  setListening(true);
  retryMs = 1000;
  const recovering = !verifying;
  verifying = false;
  log("info", "render_events_listening");
  // After an outage, anything that changed while pushes were off reaches watchers now. (A check made when the first page
  // started watching missed nothing: that page has just been sent the job.)
  if (recovering) for (const id of watchers.keys()) void load(id);
}

function reconnectLater() {
  setTimeout(() => void connect(), retryMs);
  retryMs = Math.min(retryMs * 2, 30_000);
}

async function connect() {
  if (stopped) return;
  // keepAlive stops a NAT or pooler from dropping the connection while it sits idle between renders.
  const next = new pg.Client({ connectionString: config.listenDatabaseUrl, application_name: "render-events", keepAlive: true });
  next.on("notification", (message) => {
    if (message.channel === CHANNEL) onNotice(message.payload);
    else if (message.channel === SCENE_CHANNEL) onSceneNotice(message.payload);
  });
  next.on("error", (error) => log("warn", "render_events_connection_error", { message: error.message }));
  next.on("end", () => {
    if (client !== next) return;
    client = null;
    if (pending) { clearTimeout(pending.timer); pending = null; }
    verifying = false;
    setListening(false);
    if (!stopped) { log("warn", "render_events_disconnected", { retryMs }); reconnectLater(); }
  });
  try {
    await next.connect();
    await next.query(`listen ${CHANNEL}`);
    await next.query(`listen ${SCENE_CHANNEL}`);
    client = next;
    // Live only once a ping comes back; with nobody watching, the first watcher sends it.
    ping();
  } catch (error) {
    // A pooler that refuses LISTEN, or no database: watched jobs are reloaded on the fallback timer until this succeeds.
    log("warn", "render_events_listen_failed", { message: error instanceof Error ? error.message : String(error), retryMs });
    await next.end().catch(() => undefined);
    reconnectLater();
  }
}

export const renderEvents = {
  start() {
    stopped = false;
    heartbeat = setInterval(ping, PING_EVERY_MS);
    void connect();
  },
  async stop() {
    stopped = true;
    clearInterval(heartbeat);
    if (pending) { clearTimeout(pending.timer); pending = null; }
    setListening(false);
    const current = client;
    client = null;
    await current?.end().catch(() => undefined);
  },
  /** Calls `observer` with the id and stage of every job change this replica hears. */
  observe(observer: (notice: { id: string; stage?: RenderStage }) => void) { observers.push(observer); },
  /**
   * Calls `watcher` with the job's view after every change; returns the unsubscribe function. `current` is the view the
   * caller already sent: it is the base that progress ticks are applied to, and it tells a waiting job apart.
   */
  watch(id: string, watcher: Watcher, current: RenderJob) {
    const first = watching() === 0;
    const set = watchers.get(id) ?? new Set<Watcher>();
    set.add(watcher);
    watchers.set(id, set);
    if (!lastSeen.has(id)) lastSeen.set(id, current);
    // After an idle spell the connection may have died quietly: check it before trusting it.
    if (first && client) { verifying = true; setListening(false); ping(); }
    syncFallback();
    return () => {
      set.delete(watcher);
      if (set.size === 0) { watchers.delete(id); lastSeen.delete(id); }
      syncFallback();
    };
  },
  /** True while pushes are known to arrive; a scene stream reloads on a timer otherwise. */
  get live() { return listening; },
  /** Calls `watcher` with every change to the project's scene clips; returns the unsubscribe function. */
  watchScenes(projectId: string, watcher: (notice: SceneNotice) => void) {
    const first = watching() === 0;
    const set = sceneWatchers.get(projectId) ?? new Set();
    set.add(watcher);
    sceneWatchers.set(projectId, set);
    if (first && client) { verifying = true; setListening(false); ping(); }
    return () => {
      set.delete(watcher);
      if (set.size === 0) sceneWatchers.delete(projectId);
    };
  }
};
