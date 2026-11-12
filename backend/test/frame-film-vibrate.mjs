import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { parseFrameMotion } from "@videosaas/contracts";

const root = new URL("../../", import.meta.url);
const runtime = readFileSync(new URL("worker/templates/frame-film/frame-film.js", root), "utf8");
const gsapSource = readFileSync(new URL("node_modules/gsap/dist/gsap.min.js", root), "utf8");

// Scene 7 of the bottle film, reduced: hot air atoms, a steel lattice row, cold water atoms.
const atoms = (prefix, cx0, cy, n, fill) => Array.from({ length: n }, (_, i) => `<circle id="${prefix}${i + 1}" cx="${cx0 + i * 40}" cy="${cy}" r="10" fill="${fill}"/>`).join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 1280"><rect id="bg" width="720" height="1280" fill="#050810"/>
<text id="title" x="360" y="80" font-size="40" fill="#fff">Atoms domino through steel</text>
<g id="hot">${atoms("hot", 60, 300, 4, "#f60")}</g><g id="steel">${atoms("st", 60, 600, 6, "#888")}</g><g id="cold">${atoms("cold", 60, 900, 4, "#39f")}</g></svg>`;

const motion = [
  { kind: "vibrate", ids: ["hot1", "hot2", "hot3", "hot4"], mode: "jiggle", amp: 4, freq: 10, start: 0.3, end: 5 },
  { kind: "vibrate", ids: ["st1", "st2", "st3", "st4", "st5", "st6"], mode: "wave", amp: 4, freq: 8, start: 1, end: 4 },
  { kind: "vibrate", ids: ["cold1", "cold2", "cold3", "cold4"], mode: "jiggle", amp: 3, freq: 9, start: 4, end: 5.5 }
];

const page_html = (data) => `<html><body style="margin:0"><div id="frame-film" style="position:absolute;inset:0"></div><script id="ff-data" type="application/json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script><script>${gsapSource}</script><script>window.__timelines={main:gsap.timeline({paused:true})};</script><script>${runtime}</script></body></html>`;

test("vibrate entries survive validation and are clamped", () => {
  const parsed = parseFrameMotion([...motion, { kind: "vibrate", ids: ["nope"], mode: "wave" }, { kind: "vibrate", ids: ["hot1"], mode: "x", amp: 99, freq: 999, start: 0, end: 2 }], svg, 6);
  assert.equal(parsed.length, 4);
  assert.equal(parsed[0].mode, "jiggle");
  assert.equal(parsed[1].mode, "wave");
  assert.deepEqual([parsed[3].amp, parsed[3].freq, parsed[3].mode], [8, 14, "jiggle"]);
});

test("atoms keep moving: jiggle shakes, wave travels left to right, then they settle where drawn", async (t) => {
  const exe = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", process.env.CHROME_BIN].find((p) => p && existsSync(p));
  if (!exe) return t.skip("no Chrome available");
  const browser = await chromium.launch({ executablePath: exe });
  try {
    const page = await browser.newPage();
    const data = { feel: "explainer", beats: [{ start: 0, end: 6, svg, motion: parseFrameMotion(motion, svg, 6) }] };
    await page.setContent(page_html(data));
    const at = (time, id) => page.evaluate(([tm, name]) => { window.__timelines.main.time(tm); const r = document.querySelector("#" + name).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, [time, id]);
    const spread = async (id, from, to) => { const xs = []; for (let x = from; x <= to; x += 0.05) xs.push((await at(x, id))[0]); return Math.max(...xs) - Math.min(...xs); };
    // 1. Hot atoms jiggle through the whole line.
    assert.ok(await spread("hot2", 1, 4) > 2, "hot atoms jiggle");
    // 2. The wave reaches later atoms later (domino): atom 1 moves before atom 6 does.
    const firstMove = async (id) => { const base = (await at(0.9, id))[0]; for (let x = 1; x <= 4.5; x += 0.02) if (Math.abs((await at(x, id))[0] - base) > 0.8) return x; return Infinity; };
    const first = await firstMove("st1"), last = await firstMove("st6");
    assert.ok(first < last - 0.5, `wave travels (st1 ${first}, st6 ${last})`);
    // 3. Cold atoms are still until the wave arrives, then jiggle.
    // (measured against the neighbouring atom, so the film's slow camera push-in does not count as shaking)
    const gap = async (from, to) => { const xs = []; for (let x = from; x <= to; x += 0.05) xs.push((await at(x, "cold2"))[0] - (await at(x, "cold1"))[0]); return Math.max(...xs) - Math.min(...xs); };
    assert.ok(await gap(2.5, 3.8) < 0.4, "cold atoms wait");
    assert.ok(await gap(4.1, 5.4) > 1.5, "cold atoms warm up and jiggle");
    // 4. Everything settles exactly where it is drawn: compare with the same film that has no vibration.
    const still = await browser.newPage();
    const quiet = { feel: "explainer", beats: [{ start: 0, end: 6, svg, motion: [] }] };
    await still.setContent(page_html(quiet));
    for (const id of ["hot2", "st3", "cold2"]) {
      const a = await at(6, id);
      const b = await still.evaluate((name) => { window.__timelines.main.time(6); const r = document.querySelector("#" + name).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, id);
      assert.ok(Math.abs(a[0] - b[0]) < 0.05 && Math.abs(a[1] - b[1]) < 0.05, `${id} settles where drawn (${a} vs ${b})`);
    }
  } finally { await browser.close(); }
});

// Scene 5 of the bottle film, reduced: a 3x3 lattice of atoms joined by spring lines; the centre atom is hit first.
test("lattice: atoms jiggle, then the vibration spreads from the centre atom to its neighbours", async (t) => {
  const exe = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", process.env.CHROME_BIN].find((p) => p && existsSync(p));
  if (!exe) return t.skip("no Chrome available");
  const cells = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]];
  const lattice = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 1280"><rect id="bg" width="720" height="1280" fill="#050810"/>
<line id="spring1" x1="200" y1="400" x2="360" y2="400" stroke="#f90" stroke-width="3"/>
${cells.map(([c, r]) => `<circle id="a${c}${r}" cx="${200 + c * 160}" cy="${400 + r * 160}" r="22" fill="#f80"/>`).join("")}</svg>`;
  const all = cells.map(([c, r]) => `a${c}${r}`);
  const ringed = ["a11", "a01", "a21", "a10", "a12", "a00", "a20", "a02", "a22"]; // centre first, then edges, then corners
  const lm = [
    { kind: "vibrate", ids: all, mode: "jiggle", amp: 2.5, freq: 9, start: 0.3, end: 1.8 },
    { kind: "vibrate", ids: ringed, mode: "wave", amp: 4, freq: 8, start: 1.8, end: 5 }
  ];
  const browser = await chromium.launch({ executablePath: exe });
  try {
    const page = await browser.newPage();
    await page.setContent(page_html({ feel: "explainer", beats: [{ start: 0, end: 6, svg: lattice, motion: parseFrameMotion(lm, lattice, 6) }] }));
    const xAt = (time, id) => page.evaluate(([tm, name]) => { window.__timelines.main.time(tm); const r = document.querySelector("#" + name).getBoundingClientRect(); return r.x + r.width / 2; }, [time, id]);
    const swing = async (id, from, to, ref) => { const d = []; for (let x = from; x <= to; x += 0.04) d.push((await xAt(x, id)) - (await xAt(x, ref))); return Math.max(...d) - Math.min(...d); };
    assert.ok(await swing("a11", 0.6, 1.7, "bg") > 0.8, "the centre atom visibly jiggles back and forth");
    const firstMove = async (id) => { const base = (await xAt(1.75, id)); for (let x = 1.8; x <= 5; x += 0.02) if (Math.abs((await xAt(x, id)) - base) > 1) return x; return Infinity; };
    const centre = await firstMove("a11"), corner = await firstMove("a22");
    assert.ok(centre < corner - 0.5, `energy spreads outward (centre ${centre}, corner ${corner})`);
  } finally { await browser.close(); }
});
