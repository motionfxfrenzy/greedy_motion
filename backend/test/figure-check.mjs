// Where figures stand and whether they pile up (prop-check.ts figureIssues, kit.txt K.crowd), and a set that covers the whole frame (set-flatness.ts, K.set).
// The cases are the owner's defects on staging film e9ea7a6e (Blondin): bystanders standing ON the tightrope, a crowd stacked in scene 1, a blank beige band at the bottom
// of the rope scene. Offline. Run: node backend/test/figure-check.mjs   (E9_SCENES=<dir> also runs the real scene sources of e9ea7a6e)
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.PLANNER ??= "deterministic";

const here = dirname(fileURLToPath(import.meta.url));
const { templatePack } = await import("../src/plan/template-packs.ts");
const { scenePropIssues, probeScene } = await import("../src/plan/packs/history-reel/prop-check.ts");
const { flatBandShare, FLAT_BAND_MAX } = await import("../src/plates/set-flatness.ts");
const pa = await import("../src/plates/pack-assets.ts");
const sharp = (await import("sharp")).default;
const pack = templatePack("history-reel");
const kit = pack.scenes().kit;
const render = readFileSync(join(here, "history-reel-render.mjs"), "utf8");
const NIAGARA = /const SCENE = `([\s\S]*?)`;\n/.exec(render)[1];
// the Niagara proof scene without its big foreground puppet, so only the figures a test adds are judged
const BASE = NIAGARA.replace(/K\.puppet\(g, cam, harry, 300, 1640, 480,[^\n]*\n/, "").replace(/K\.crowd\(g, cam, crowd, \[\[1500, 230, 4\], \[1650, 290, 4\]\][^\n]*\n/, "").replace(/K\.puppet\(g, cam, blondin,[^\n]*\n/, "");
const withFigures = (body) => BASE.replace("K.motes(g, cam, t);", `${body}\n    K.motes(g, cam, t);`);
const check = (code, beat) => scenePropIssues(code, kit, { aspect: "9:16", beat });
const has = (list, re) => list.some((m) => re.test(m));
const cast = `const c1 = K.makeCast({}), c2 = K.makeCast({ shirt: "#a83f3f" }), c3 = K.makeCast({ shirt: "#5f8d4e" });`;
const stand = (name, x, y, h) => `K.puppet(g, cam, ${name}, ${x}, ${y}, ${h}, { face: 1, ...K.pose.stand(${name}, "three") }, { sun: "left" });`;

// the Niagara rope runs from plate (150,1095) to (960,770): points on it
const ropeAt = (u) => [150 + 810 * u, 1095 - 325 * u + 70 * 4 * u * (1 - u)];
const [rx, ry] = ropeAt(0.5);
const ROPE_BEAT = { visual: "[rope] wide, blondin, a full cartoon character walks steadily along the rope", line: "A quarter-mile wire." };
const BYSTANDER_BEAT = { visual: "[gorge] medium, the crowd watches", line: "Everyone watched." };

// ---- 1. every figure stands on a support
const drawRope = `K.drawRope(g, cam, K.ropeCurve({ x: 150, y: 1095, d: 0.65 }, { x: 960, y: 770, d: 0.12 }, 70), 8);`;
const onRope = (name, x) => { const y = ropeAt((x - 150) / 810)[1]; return stand(name, x, y, 300); };
{
  const walkerOnly = check(withFigures(`${cast}\n    ${drawRope}\n    ${onRope("c1", 560)}`), ROPE_BEAT);
  assert.ok(!has(walkerOnly, /ON the rope/), "the walker the beat names may be on the rope");
  const crowdOnRope = check(withFigures(`${cast}\n    ${drawRope}\n    ${onRope("c1", 560)}\n    ${onRope("c2", 880)}\n    ${onRope("c3", 940)}`), ROPE_BEAT);
  assert.ok(has(crowdOnRope, /figures stand ON the rope line.*only the character the beat names \(and one it carries or follows\) may be on the rope/s), `bystanders on the rope are flagged: ${crowdOnRope.map((m) => m.slice(0, 60))}`);
  assert.ok(!has(check(withFigures(`${cast}\n    ${drawRope}\n    ${stand("c2", 300, 1560, 300)}\n    ${stand("c3", 880, 1560, 300)}`), ROPE_BEAT), /ON the rope/), "the same bystanders on the ground are fine");
  const noRopeBeat = check(withFigures(`${cast}\n    ${drawRope}\n    ${onRope("c1", 560)}`), { visual: "[gorge] wide, a man tips his hat", line: "He smiled." });
  assert.ok(has(noRopeBeat, /does not put anyone on the rope/), "a beat that does not mention the rope puts nobody on it");
  const rope = withFigures(`${cast}\n    K.drawRope(g, cam, K.ropeCurve({ x: 150, y: 1095, d: 0.65 }, { x: 960, y: 770, d: 0.12 }, 70), 8);\n    ${onRope("c2", 940)}`);
  assert.ok(has(check(rope, BYSTANDER_BEAT), /ON the rope/), "with a rope drawn (K.drawRope records its line) a bystander on it is flagged");
}
// floating
{
  const floating = check(withFigures(`${cast}\n    ${stand("c1", 540, 900, 380)}`), { visual: "[gorge] wide, a man stands", line: "" });
  assert.ok(has(floating, /A figure floats above the ground/), "a big figure whose feet are higher than the floor of the set floats");
  assert.ok(!has(check(withFigures(`${cast}\n    ${stand("c1", 540, 900, 380)}`), { visual: "[gorge] wide, a man jumps", line: "" }), /floats/), "a jump in the VISUAL lifts him");
  assert.ok(!has(check(withFigures(`${cast}\n    ${stand("c1", 540, 1050, 70)}`), { visual: "[gorge] wide, the far bank", line: "" }), /floats/), "a small far figure on the far bank is not floating");
  assert.ok(!has(check(withFigures(`${cast}\n    K.prop(g, cam, { name: "bench", x: 540, y: 1620, on: "bench", w: 300, h: 40, draw: (c) => { c.fillRect(-150, -40, 300, 40); } });\n    ${stand("c1", 540, 1620 - 96, 380)}`), { visual: "[lab] wide, a man stands", line: "" }), /floats/), "a figure on a prop's surface is supported");
}

// ---- 2. a crowd never piles up
{
  const apart = check(withFigures(`${cast}\n    ${stand("c1", 200, 1500, 300)}\n    ${stand("c2", 420, 1500, 300)}\n    ${stand("c3", 640, 1500, 300)}`), BYSTANDER_BEAT);
  assert.ok(!has(apart, /overlap|head line/), `figures a body apart: fine (${apart.map((m) => m.slice(0, 50))})`);
  const overlapping = check(withFigures(`${cast}\n    ${stand("c1", 400, 1500, 300)}\n    ${stand("c2", 430, 1500, 300)}`), BYSTANDER_BEAT);
  assert.ok(has(overlapping, /Figures at the same depth overlap by more than 35% of a body/), "two bodies on the same spot");
  const onHeads = check(withFigures(`${cast}\n    ${stand("c1", 400, 1500, 300)}\n    ${stand("c2", 410, 1500 - 300 * 0.86 - 20, 260)}`), BYSTANDER_BEAT);
  assert.ok(has(onHeads, /feet are above another figure's head line and right over it/), "a figure standing over another's head");
  assert.ok(!has(check(withFigures(`${cast}\n    ${stand("c1", 400, 1500, 300)}\n    ${stand("c2", 700, 1500 - 300 * 0.86 - 20, 260)}`), BYSTANDER_BEAT), /head line/), "the same height further along is not over him");
  assert.ok(!has(check(withFigures(`${cast}\n    ${stand("c1", 400, 1500, 300)}\n    ${stand("c2", 420, 1450, 300)}`), { visual: "[gorge] close, colcord climbs onto blondin's back", line: "" }), /overlap/), "the two named characters of a carry or a climb meet by design");
  // K.crowd spaces its own rows: the owner's scene 1 rows, plus a crammed row, never trip the check
  const rows = check(withFigures(`const crowd = K.crowdCast(12, 5);\n    K.crowd(g, cam, crowd, [[1540, 220, 5], [1680, 280, 7]], frame, "watch", 60, 400);`), BYSTANDER_BEAT);
  assert.ok(!has(rows, /overlap|head line/), `K.crowd keeps its rows apart: ${rows.map((m) => m.slice(0, 70))}`);
  const crammed = probeScene(withFigures(`const crowd = K.crowdCast(12, 5);\n    K.crowd(g, cam, crowd, [[1500, 200, 30]], frame, "watch", 60, 400);`), kit);
  const n0 = crammed.puppets.filter((p) => p.frame === crammed.puppets[0].frame);
  assert.ok(n0.length < 30 && n0.length >= 3, `30 figures in 340 px do not fit: the row holds ${n0.length}`);
  const xs = n0.map((p) => p.x).sort((a, b) => a - b); const bw = n0[0].bw;
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= bw * 0.6, `spacing ${Math.round(xs[i] - xs[i - 1])} >= 60% of a body (${Math.round(bw)})`);
  // rows: the back row is smaller and higher, and its feet are never above the front row's head line
  const two = probeScene(withFigures(`const crowd = K.crowdCast(8, 5);\n    K.crowd(g, cam, crowd, [[1420, 300, 3], [1600, 280, 3]], frame, "watch", 60, 900);`), kit);
  const f0 = two.puppets.filter((p) => p.frame === two.puppets[0].frame).sort((a, b) => a.y - b.y);
  const back = f0[0], front = f0.at(-1);
  assert.ok(back.h <= front.h * 0.9 + 0.01, "a row further back is smaller"); assert.ok(back.y < front.y, "and higher on the ground");
  assert.ok(back.y >= front.y - front.h * 0.86, "never above the front row's head line");
}

// ---- 3. the set covers the whole frame: no blank band
{
  const gradient = await sharp({ create: { width: 540, height: 960, channels: 3, background: "#d8b98a" } }).jpeg().toBuffer();
  const noise = (h, w = 540) => { const b = Buffer.alloc(w * h * 3); for (let i = 0; i < b.length; i++) b[i] = 90 + ((i * 2654435761) >>> 24) % 70; return b; };
  const textured = await sharp(noise(960), { raw: { width: 540, height: 960, channels: 3 } }).jpeg().toBuffer();
  const bottomBlank = await sharp(Buffer.concat([noise(640), Buffer.alloc(540 * 320 * 3, 200)]), { raw: { width: 540, height: 960, channels: 3 } }).jpeg().toBuffer();
  assert.ok((await flatBandShare(gradient)) > 0.9, "an all-flat picture"); assert.ok((await flatBandShare(textured)) < 0.01, "a textured picture");
  const share = await flatBandShare(bottomBlank); assert.ok(share > 0.3 && share < 0.36, `a blank bottom third measures ${share.toFixed(2)}`);
  assert.equal(FLAT_BAND_MAX, 0.05); assert.equal(pa.FLAT_BAND_LIMIT, 0.05);
  // generatePackAssets repaints a set with a blank band, says why in the prompt, and keeps every try as a candidate
  const files = new Map(); const prompts = []; let n = 0;
  const deps = { getObject: async (b, k) => files.get(`${b}:${k}`) ?? null, putObject: async (b, k, body) => { files.set(`${b}:${k}`, Buffer.isBuffer(body) ? body : Buffer.from(body)); }, objectSize: async (b, k) => (files.has(`${b}:${k}`) ? files.get(`${b}:${k}`).length : null),
    image: async (prompt) => { prompts.push(prompt); n += 1; return { data: Buffer.from(n === 1 ? "blank" : "good"), mime: "image/jpeg" }; }, checkText: async () => ({ extra: [], figures: [], usd: 0 }), enqueueDepth: async () => {},
    flatBand: async (image) => (image.toString() === "blank" ? 0.33 : 0.0), parallel: 1 };
  const spec = { name: "set-rope", prompt: "a gorge", aspect: "9:16", size: "2K", noText: true, noFigures: true };
  const index = await pa.generatePackAssets("cccccccc-2222-3333-4444-555555555555", [spec], deps);
  assert.equal(index.status, "ready"); assert.equal(prompts.length, 2, "one repaint");
  assert.match(prompts[1], /BLANK GROUND: the bottom 33% of the last attempt was one flat, smooth band of colour\. The real ground, with its texture .* must continue all the way to the bottom edge/);
  assert.equal(Buffer.from(files.get(`uploads:${index.assets["set-rope"].key}`)).toString(), "good");
  assert.equal(JSON.parse(files.get(`uploads:${pa.candidateListKey("cccccccc-2222-3333-4444-555555555555", index.assets["set-rope"].hash)}`).toString()).length, 2, "both tries are kept (paid for once)");
}
// the real pictures (when present): the staging rope set has a blank band, the textured sets do not
{
  const D = process.env.E9_SETS ?? join(here, "../../../VideoSaaS/experiments/set-brief-niagara");
  if (existsSync(join(D, "set-rope.jpg"))) {
    const rope = await flatBandShare(readFileSync(join(D, "set-rope.jpg")));
    assert.ok(rope > 0.3, `e9ea7a6e set-rope: a ${Math.round(rope * 100)}% blank band at the bottom (flagged, repainted)`);
    assert.ok((await flatBandShare(readFileSync(join(here, "../src/plan/packs/history-reel/set-reference.jpg")))) < FLAT_BAND_MAX, "the house reference picture is clean");
  }
}
// the kit's own set always covers the frame (cover-scale, never letterbox): the visible plate rectangle stays inside the picture for any camera and any frame shape
{
  const { transformSync } = await import("esbuild");
  const K = new Function(`${transformSync(kit, { loader: "ts", target: "es2020" }).code}\n;return K;`)();
  const ctx = new Proxy({}, { get: (_t, k) => (k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => undefined), set: () => true });
  for (const [W, H] of [[1080, 1920], [1920, 1080], [1080, 1080]]) for (const key of [{ x: 540, y: 968, z: 1 }, { x: 0, y: 0, z: 0.4 }, { x: 5000, y: 5000, z: 1.7 }, { x: 540, y: 1900, z: 2.4, roll: 6 }]) {
    const env = { W, H, scale: 1, cache: new Map(), canvas: (w, h) => ({ canvas: { width: w, height: h }, ctx }), image: () => ({ width: 1080, height: 1920 }) };
    const cam = K.camera(0, [[0, key]], { push: false }); K.set(ctx, env, cam, "gorge");
    const halfW = W / (2 * cam.z), halfH = H / (2 * cam.z), PH = cam.PH;
    assert.ok(halfW * 2 <= 1080 + 0.5 && halfH * 2 <= PH + 0.5, `${W}x${H} ${JSON.stringify(key)}: the view (${Math.round(halfW * 2)} x ${Math.round(halfH * 2)}) fits inside the picture (1080 x ${Math.round(PH)})`);
    if (!key.roll) assert.ok(cam.x - halfW >= -0.5 && cam.x + halfW <= 1080.5 && cam.y - halfH >= -0.5 && cam.y + halfH <= PH + 0.5, `${W}x${H} ${JSON.stringify(key)}: the camera never leaves the picture`);
  }
}

// ---- the author prompt carries the rules; the check is part of the pack's scene rules
const direction = readFileSync(join(here, "../src/plan/packs/history-reel/index.ts"), "utf8");
assert.match(direction, /Every figure stands on something, and nobody stands on anybody/); assert.match(direction, /bystanders, the crowd and everyone else stand on the ground at the cliff edge, never on the rope line/);
assert.match(direction, /at least 60% of a body width apart \(bodies overlap by 35% at most\)/); assert.match(direction, /The set picture always covers the whole frame/);
assert.ok(pack.sceneIssues(withFigures(`${cast}\n    ${stand("c1", 400, 1500, 300)}\n    ${stand("c2", 430, 1500, 300)}`), BYSTANDER_BEAT, { aspect: "9:16" }).some((m) => /overlap/.test(m)), "the pack's sceneIssues reports it (one repair round)");

// ---- the real scene sources of staging film e9ea7a6e, when present: the owner's three scenes are flagged, the rest pass
const dir = process.env.E9_SCENES;
if (dir && existsSync(join(dir, "beats.json"))) {
  const beats = JSON.parse(readFileSync(join(dir, "beats.json"), "utf8")), fp = JSON.parse(readFileSync(join(dir, "film-props.json"), "utf8"));
  const flagged = [];
  for (let n = 1; n <= beats.length; n++) {
    const issues = scenePropIssues(readFileSync(join(dir, `scene-${n}.ts`), "utf8"), kit, { aspect: "9:16", filmProps: { plan: fp.plan, code: fp.code }, beat: beats[n - 1], beatIndex: n - 1 });
    if (issues.length) flagged.push(n); console.log(`  e9ea7a6e scene ${n}: ${issues.length ? "FLAGGED " + issues[0].slice(0, 90) : "pass"}`);
  }
  for (const n of [1, 11]) assert.ok(flagged.includes(n), `scene ${n} (reported by the owner) is flagged`);
}
console.log("figure-check: figures stand on a support, crowds do not pile up, sets cover the frame: ok");
