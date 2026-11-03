// Helpers for the plate acceptance scenarios (scripts/plates-e2e/run.mjs). Talks to the compose stack from the host:
// API http://localhost:4100, stub http://localhost:58787, Postgres plates_e2e, object store http://localhost:59000.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import pg from "pg";

export const API = process.env.E2E_API ?? "http://localhost:4100";
export const STUB = process.env.E2E_STUB ?? "http://localhost:58787";
export const pool = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL ?? "postgres://videosaas:videosaas@localhost:55432/plates_e2e", max: 4 });
const s3 = new S3Client({ region: "auto", endpoint: process.env.E2E_S3 ?? "http://localhost:59000", forcePathStyle: true, credentials: { accessKeyId: "plates", secretAccessKey: "plates-secret-1" } });
export const OWNER = "00000000-0000-4000-8000-000000000000";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const now = () => Date.now();

export async function api(path, { method = "GET", body, raw } = {}) {
  const res = await fetch(`${API}${path}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  if (raw) return res;
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
// Retried once: the stub is a bare node server and may close an idle keep-alive socket just as a request reuses it.
export const stub = async (path, body) => {
  for (let attempt = 0; ; attempt++) {
    try { return await (await fetch(`${STUB}${path}`, { ...(body ? { method: "POST", body: JSON.stringify(body) } : {}), headers: { connection: "close" } })).json(); }
    catch (error) { if (attempt >= 2) throw error; await sleep(500); }
  }
};
export const stubStats = () => stub("/stats");

const SOURCE = "397b0ec8-263e-44a8-b9ab-4620c782094c"; // a real fox storyboard with recorded voice + music, in the developer's database
/**
 * Seeds a project (a real storyboard and its recorded audio) into the acceptance database and object store.
 * `beats` limits the scene count; `look` picks the style the stub answers for (fox, blueprint, balloon).
 */
export async function seedProject({ look = "illus-fox", aspect = "16:9", aspects, beats = 3, audio = true, name } = {}) {
  const local = new pg.Pool({ connectionString: "postgres://videosaas:videosaas@localhost:55432/videosaas" });
  const { rows } = await local.query("select data from app.projects where id = $1", [SOURCE]);
  await local.end();
  const data = rows[0].data;
  const id = randomUUID();
  data.id = id; data.ownerId = OWNER; data.name = name ?? `plates e2e ${look}`; data.state = "Draft"; delete data.renderJobId;
  data.brief.look = look; data.brief.aspect = aspect; data.brief.captions = "full";
  if (aspects) data.brief.aspects = aspects; else delete data.brief.aspects;
  data.brief.scriptBeats = data.brief.scriptBeats.slice(0, beats);
  data.beatPlan.beats = data.beatPlan.beats.slice(0, beats);
  if (data.planAudio?.voice) data.planAudio.voice.lines = data.planAudio.voice.lines.slice(0, beats);
  if (!audio) delete data.planAudio;
  else {
    for (const file of [...(data.planAudio.voice?.lines ?? []).map((l) => l.file), data.planAudio.music?.file]) {
      if (!file) continue;
      try {
        await s3.send(new PutObjectCommand({ Bucket: "plates-uploads", Key: `media/audio/plans/${id}/${file}`, Body: readFileSync(`var/audio/plans/${SOURCE}/${file}`) }));
      } catch { /* a take missing on the developer's disk: that scene is unvoiced */ }
    }
  }
  await pool.query("insert into app.projects (id, owner_id, name, state, data) values ($1, $2, $3, $4, $5)", [id, OWNER, data.name, data.state, data]);
  return { id, data };
}

export const variants = async (id) => (await pool.query("select * from app.plate_variants where project_id = $1 order by aspect, scene_index", [id])).rows;
export async function waitFor(label, fn, { timeout = 240_000, every = 1500 } = {}) {
  const t0 = now();
  for (;;) {
    const v = await fn();
    if (v) return { value: v, ms: now() - t0 };
    if (now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await sleep(every);
  }
}
export const allDrawn = (aspects) => async (id) => { const v = await variants(id); const want = aspects ? v.filter((r) => aspects.includes(r.aspect)) : v; return want.length > 0 && want.every((r) => r.state === "drawn") && want; };
export const compose = (...args) => execFileSync("docker", ["compose", "--profile", "plates-e2e", ...args], { cwd: new URL("../..", import.meta.url).pathname, encoding: "utf8" });
export const ffprobe = (file) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_packets", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,nb_read_packets,duration", "-show_entries", "format=duration", "-of", "json", file], { encoding: "utf8" }));
export async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}
/** Follows an API redirect to the object store and returns the final URL. */
export async function redirectOf(path) { const r = await api(path, { raw: true }); return { status: r.status, location: r.headers.get("location") }; }
export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
export async function resetStub(extra = {}) { await stub("/control", { reset: true, ...extra }); }
