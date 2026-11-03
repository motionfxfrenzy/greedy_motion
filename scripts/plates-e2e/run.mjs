// Plate pipeline acceptance scenarios against the compose `plates-e2e` stack.
//   node scripts/plates-e2e/run.mjs [happy|durability|cache|failures] ...
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allDrawn, api, compose, download, ffprobe, log, pool, redirectOf, resetStub, seedProject, sleep, stubStats, variants, waitFor } from "./lib.mjs";

const scenarios = {
  async happy() {
    // E2E_PROJECT=<id> re-runs the checks on a project that is already drawn (skips seeding and drawing).
    if (!process.env.E2E_PROJECT) await resetStub();
    const { id } = process.env.E2E_PROJECT ? { id: process.env.E2E_PROJECT } : await seedProject({ look: "illus-fox", aspect: "16:9", aspects: ["16:9", "9:16", "1:1"], beats: 3 });
    const t0 = Date.now();
    let r = await api(`/v1/projects/${id}/plates/draw`, { method: "POST" });
    assert.equal(r.status, 202, JSON.stringify(r.json));
    assert.equal(r.json.available, true);
    log("draw accepted; scenes", r.json.scenes.length, "aspects", (await variants(id)).length);
    const primary = await waitFor("primary ratio drawn", () => allDrawn(["16:9"])(id));
    log("primary preview ready in", Math.round(primary.ms / 100) / 10, "s");
    const all = await waitFor("all ratios drawn", () => allDrawn()(id), { timeout: 420_000 });
    const rows = all.value;
    log("all 3 ratios ready after", Math.round((Date.now() - t0) / 100) / 10, "s");
    const stats = await stubStats();
    log("model calls", stats.calls, JSON.stringify(stats.byScene));
    assert.equal(rows.length, 9);
    for (const v of rows) { assert.ok(v.clip_key && v.still_key && v.source_key && v.bundle_key); assert.equal(v.clip_meta.frames, v.frames); assert.equal(v.clip_meta.width, v.width); }
    const status = (await api(`/v1/projects/${id}/plates`)).json;
    assert.deepEqual([...status.drawnAspects].sort(), ["16:9", "1:1", "9:16"]);
    // clips and stills are reachable through the API (a redirect into object storage)
    const dir = mkdtempSync(join(tmpdir(), "plates-e2e-"));
    for (const aspect of ["16:9", "9:16", "1:1"]) {
      const c = await redirectOf(`/v1/projects/${id}/plates/0/clip?aspect=${aspect}`);
      assert.equal(c.status, 302); const file = await download(c.location, join(dir, `c-${aspect.replace(":", "x")}.mp4`));
      const meta = ffprobe(file).streams[0]; assert.equal(Number(meta.nb_read_packets), rows.find((v) => v.aspect === aspect && v.scene_index === 0).frames);
    }
    const still = await redirectOf(`/v1/projects/${id}/plates/0/still`); assert.equal(still.status, 302);
    // export every selected ratio
    for (const [aspect, slug, [w, h]] of [["16:9", "16-9", [1920, 1080]], ["9:16", "9-16", [1080, 1920]], ["1:1", "1-1", [1080, 1080]]]) {
      const te = Date.now();
      let ex = await api(`/v1/projects/${id}/plates/export`, { method: "POST", body: { aspect } });
      assert.ok([200, 202].includes(ex.status), JSON.stringify(ex.json));
      await waitFor(`export ${aspect}`, async () => (await api(`/v1/projects/${id}/plates/export`, { method: "POST", body: { aspect } })).json.state === "ready");
      const dl = await redirectOf(`/v1/projects/${id}/plates/export/${slug}`);
      assert.equal(dl.status, 302);
      const file = await download(dl.location, join(dir, `${slug}.mp4`));
      const p = ffprobe(file); const v = p.streams.find((s) => s.codec_type === "video"), a = p.streams.find((s) => s.codec_type === "audio");
      assert.equal(v.width, w); assert.equal(v.height, h); assert.ok(a, "voice + music + effects mixed");
      log(`export ${aspect}`, `${w}x${h}`, "frames", v.nb_read_packets, "duration", Number(p.format.duration).toFixed(2), "s in", Math.round((Date.now() - te) / 100) / 10, "s");
    }
    log("happy path ok; output dir", dir);
    return { id, dir };
  }
};


const dbq = async (sql, v) => (await pool.query(sql, v)).rows;
const calls = async () => (await stubStats()).calls;
const stateOf = async (id) => (await variants(id)).map((v) => `${v.scene_index}/${v.aspect}:${v.state}`).join(" ");
async function fresh(opts) { await resetStub(); const p = await seedProject(opts); return p; }
const draw = (id) => api(`/v1/projects/${id}/plates/draw`, { method: "POST" });
const setBeat = async (id, i, patch) => { const { rows } = await pool.query("select data from app.projects where id = $1", [id]); const d = rows[0].data; Object.assign(d.brief.scriptBeats[i], patch); await pool.query("update app.projects set data = $2 where id = $1", [id, d]); };

Object.assign(scenarios, {
  async comments() {
    const { id } = await fresh({ look: "illus-blueprint", aspect: "16:9", aspects: ["16:9", "9:16"], beats: 2, audio: false });
    await draw(id); await waitFor("drawn", () => allDrawn()(id), { timeout: 420_000 });
    const st = await stubStats();
    assert.ok(st.log.some((l) => l.aspect === "9:16" && l.reference), "the second ratio is authored with the first ratio's module as its reference");
    const base = st.calls;
    const c = await api(`/v1/projects/${id}/plates/comments`, { method: "POST", body: { at: 1.0, body: "wider sky, bigger lantern" } });
    assert.equal(c.status, 201, JSON.stringify(c.json));
    assert.equal((await api(`/v1/projects/${id}/plates`)).json.comments.length, 1);
    const fix = await api(`/v1/projects/${id}/plates/fix`, { method: "POST" }); assert.equal(fix.status, 202, JSON.stringify(fix.json));
    await waitFor("revised", async () => { const v = await variants(id); return v.every((r) => r.state === "drawn") && v.filter((r) => r.scene_index === 0).every((r) => r.rev === 1); }, { timeout: 420_000 });
    const st2 = await stubStats();
    assert.equal(st2.calls - base, 2, "one revision call per ratio of the commented scene");
    assert.ok(st2.log.slice(-2).every((l) => l.revise && l.notes), "the model received the current module and the notes");
    const status = (await api(`/v1/projects/${id}/plates`)).json;
    assert.equal(status.comments.length, 0, "an answered comment is cleared");
    assert.equal((await variants(id)).filter((r) => r.scene_index === 1).every((r) => r.rev === 0 && r.gen === 1), true, "other scenes are untouched");
    log("comments scenario ok");
  },

  async cache() {
    const { id } = await fresh({ look: "illus-blueprint", aspect: "16:9", beats: 3, audio: true });
    await draw(id); await waitFor("drawn", () => allDrawn()(id), { timeout: 400_000 });
    const base = await calls(); log("authored with", base, "model calls for 3 scenes");
    assert.equal(base, 3);
    const rows0 = await variants(id);
    // 1. unchanged storyboard: nothing is authored or drawn again
    await draw(id); await sleep(3000);
    assert.equal(await calls(), base, "unchanged scenes do not call the model again");
    assert.deepEqual((await variants(id)).map((v) => v.gen), rows0.map((v) => v.gen));
    // 2. subtitle / audio edits reuse the artwork
    await api(`/v1/projects/${id}/plates/subtitles`, { method: "PUT", body: { style: "cinema", size: 130, music: false, sfx: false, y: 70 } });
    await draw(id); await sleep(3000);
    assert.equal(await calls(), base, "subtitle and audio settings never reach the model");
    assert.deepEqual((await variants(id)).map((v) => v.clip_key), rows0.map((v) => v.clip_key), "clips are reused");
    // 3. one scene edited: exactly that scene is authored and drawn again
    await setBeat(id, 1, { visual: "A lone blueprint umbrella drifts across the sheet while rain rules the page." });
    const t0 = Date.now(); await draw(id);
    await waitFor("scene 1 redrawn", async () => (await variants(id)).every((v) => v.state === "drawn") && (await variants(id))[1].gen === 2, { timeout: 300_000 });
    const after = await variants(id);
    assert.deepEqual(after.map((v) => v.gen), [1, 2, 1], "only the edited scene is superseded");
    assert.equal((await calls()) - base, 1, "one model call for one edited scene");
    assert.equal(after[0].clip_key, rows0[0].clip_key); assert.equal(after[2].clip_key, rows0[2].clip_key);
    log("one-scene edit redrawn in", Math.round((Date.now() - t0) / 100) / 10, "s");
    // 4. a new ratio draws only the missing variants
    const before = await calls();
    await api(`/v1/projects/${id}/plates/draw-aspect`, { method: "POST", body: { aspect: "1:1" } });
    await waitFor("1:1 drawn", () => allDrawn()(id), { timeout: 420_000 });
    assert.equal((await calls()) - before, 3, "three scenes, three model calls, only for the new ratio");
    assert.deepEqual((await variants(id)).filter((v) => v.aspect === "16:9").map((v) => v.gen), [1, 2, 1], "the finished ratio is untouched");
    // 5. a film brief change invalidates everything that depends on it
    await dbq("update app.projects set data = jsonb_set(data, '{brief,text}', to_jsonb(data->'brief'->>'text' || ' It is a stormy night.')) where id = $1", [id]);
    await draw(id); await sleep(2000);
    assert.ok((await variants(id)).every((v) => v.state !== "drawn"), "a shared-spec change supersedes every scene and ratio");
    log("cache scenarios ok");
  },

  async failures() {
    const { id } = await fresh({ look: "illus-balloon", aspect: "16:9", beats: 1, audio: false });
    // invalid source: a bounded repair call, then it draws
    await resetStub({ mode: "bad-import", times: 1 });
    await draw(id); await waitFor("repaired", () => allDrawn()(id), { timeout: 300_000 });
    let v = (await variants(id))[0]; assert.equal((await stubStats()).calls, 2, "invalid import: 1 call + 1 repair"); assert.equal(v.render_attempt, 1);
    // non-deterministic scene: caught by verification in the browser, repaired through authoring
    const p2 = await fresh({ look: "illus-blueprint", aspect: "16:9", beats: 1, audio: false });
    await resetStub({ mode: "nondeterministic", times: 1 });
    await draw(p2.id); await waitFor("repaired nondeterminism", () => allDrawn()(p2.id), { timeout: 400_000 });
    v = (await variants(p2.id))[0]; const st = await stubStats();
    assert.equal(st.calls, 2, "determinism failure: 1 call + 1 repair"); assert.equal(v.repairs, 1);
    // a model-service outage is retried on the same row and does not eat the repair budget
    const p3 = await fresh({ look: "illus-balloon", aspect: "16:9", beats: 1, audio: false });
    await resetStub({ mode: "http500", times: 3 });
    await draw(p3.id); await waitFor("outage survived", () => allDrawn()(p3.id), { timeout: 300_000 });
    v = (await variants(p3.id))[0]; assert.equal(v.repairs, 0); assert.equal(v.authored, 1, "outage attempts are not counted as authoring calls");
    log("failure scenarios ok");
  },

  async exhausted() {
    let v;
    // hopeless scene code: fails in words, after exactly the allowed number of calls
    const p4 = await fresh({ look: "illus-balloon", aspect: "16:9", beats: 1, audio: false });
    await resetStub({ mode: "bad-import", times: 10 });
    await draw(p4.id); await waitFor("failure", async () => (await variants(p4.id))[0].state === "failed", { timeout: 300_000 });
    v = (await variants(p4.id))[0]; log("exhausted:", v.error.message.slice(0, 160));
    assert.equal((await stubStats()).calls, 3); assert.match(v.error.message, /could not be drawn after 3 attempts/);
    const status = (await api(`/v1/projects/${p4.id}/plates`)).json; assert.equal(status.scenes[0].state, "failed"); assert.ok(status.scenes[0].error);
    // pressing Draw again retries (a failed scene without a bundle starts from authoring)
    await resetStub(); await draw(p4.id); await waitFor("retry works", () => allDrawn()(p4.id), { timeout: 300_000 });
    log("exhausted scenario ok");
  },

  async durability() {
    const { id } = await fresh({ look: "illus-blueprint", aspect: "16:9", beats: 2, audio: true });
    // --- API restarted while the model is answering: nobody presses Draw again
    await resetStub({ mode: "slow", times: 0, delayMs: 20_000 });
    await draw(id);
    await waitFor("authoring", async () => (await variants(id)).some((v) => v.state === "authoring"), { timeout: 30_000, every: 500 });
    log("restarting the API during authoring"); compose("restart", "plate-api");
    await resetStub({ delayMs: 0 });
    await waitFor("drawn after API restart", () => allDrawn()(id), { timeout: 420_000 });
    log("recovered after API restart; model calls", await calls());
    // --- worker killed mid-render
    const p2 = await fresh({ look: "illus-blueprint", aspect: "16:9", beats: 2, audio: false });
    await draw(p2.id);
    await waitFor("rendering", async () => (await variants(p2.id)).some((v) => v.state === "rendering" && v.stage === "rendering"), { timeout: 200_000, every: 500 });
    const callsBefore = await calls();
    log("killing the worker mid-render"); compose("kill", "plate-worker");
    await sleep(5000); log("states while the worker is gone:", await stateOf(p2.id));
    compose("up", "-d", "plate-worker");
    await waitFor("drawn after worker kill", () => allDrawn()(p2.id), { timeout: 420_000 });
    const rows = await variants(p2.id);
    assert.equal(await calls(), callsBefore, "a worker crash never costs a model call");
    assert.ok(rows.some((v) => v.render_attempt >= 2), "the interrupted scene was taken over by a newer attempt");
    log("recovered after worker kill; attempts", rows.map((v) => v.render_attempt).join(","));
    // --- duplicate delivery
    const p3 = await fresh({ look: "illus-blueprint", aspect: "16:9", beats: 1, audio: false });
    await draw(p3.id);
    const bundled = await waitFor("bundled", async () => (await variants(p3.id)).find((v) => ["bundled", "rendering"].includes(v.state)), { timeout: 100_000, every: 300 });
    for (let i = 0; i < 3; i++) await pool.query("insert into pgboss.job (name, data) values ('plate-render', $1)", [JSON.stringify({ variantId: bundled.value.id, gen: bundled.value.gen })]);
    await waitFor("drawn", () => allDrawn()(p3.id), { timeout: 300_000 });
    await sleep(8000);
    assert.equal((await variants(p3.id))[0].render_attempt, 1, "the same message delivered four times draws once");
    // --- edit while an older revision renders
    const p4 = await fresh({ look: "illus-blueprint", aspect: "16:9", beats: 2, audio: false });
    await draw(p4.id);
    await waitFor("rendering", async () => (await variants(p4.id)).some((v) => v.state === "rendering" && v.stage === "rendering"), { timeout: 200_000, every: 400 });
    const old = (await variants(p4.id)).find((v) => v.state === "rendering");
    await setBeat(p4.id, old.scene_index, { visual: "A different blueprint: an umbrella opening over a harbour plan." });
    await draw(p4.id);
    await waitFor("all drawn at new gen", async () => { const r = await variants(p4.id); return r.every((v) => v.state === "drawn") && r.find((v) => v.scene_index === old.scene_index).gen > old.gen; }, { timeout: 420_000 });
    const now_ = (await variants(p4.id)).find((v) => v.scene_index === old.scene_index);
    assert.ok(now_.clip_key.includes(`/g${now_.gen}/`), "the published clip belongs to the new revision");
    assert.notEqual(now_.signature, old.signature);
    log("stale render did not publish:", now_.clip_key.split("/").slice(-3).join("/"));
    // --- scratch removed, containers recreated: artifacts still play and export
    compose("up", "-d", "--force-recreate", "plate-api", "plate-worker"); await sleep(15_000);
    const status = await waitFor("api back", async () => { try { return (await api(`/v1/projects/${p4.id}/plates`)).json; } catch { return null; } }, { timeout: 90_000 });
    assert.equal(status.value.scenes.every((s) => s.state === "drawn"), true);
    const c = await redirectOf(`/v1/projects/${p4.id}/plates/0/clip`); assert.equal(c.status, 302); const file = await download(c.location, join(mkdtempSync(join(tmpdir(), "p-")), "c.mp4")); assert.ok(file);
    await api(`/v1/projects/${p4.id}/plates/export`, { method: "POST", body: { aspect: "16:9" } });
    await waitFor("export after recreate", async () => (await api(`/v1/projects/${p4.id}/plates/export`, { method: "POST", body: { aspect: "16:9" } })).json.state === "ready", { timeout: 300_000 });
    log("durability scenarios ok");
  },

  async concurrency() {
    const { id } = await fresh({ look: "illus-blueprint", aspect: "16:9", beats: 4, audio: false });
    compose("up", "-d", "--scale", "plate-worker=2", "plate-worker");
    await sleep(8000);
    await draw(id); await waitFor("drawn", () => allDrawn()(id), { timeout: 600_000 });
    const rows = await variants(id);
    assert.ok(rows.every((v) => v.render_attempt === 1), "two workers, four scenes: each scene drawn exactly once");
    const workers = new Set(rows.map((v) => v.clip_meta.worker));
    log("scenes drawn by", [...workers].join(", "));
    assert.equal(workers.size, 2, "both workers took part");
    compose("up", "-d", "--scale", "plate-worker=1", "plate-worker");
  }
});

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenarios);
for (const name of names) { log("== scenario", name); await scenarios[name](); }
await pool.end();
