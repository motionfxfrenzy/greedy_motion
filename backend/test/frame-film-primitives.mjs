import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { parseFrameMotion } from "@videosaas/contracts";

// Subject-agnostic checks of the shared motion primitives (grow, draw, travel, drift) on scenes from unrelated domains.
const root = new URL("../../", import.meta.url);
const runtime = readFileSync(new URL("worker/templates/frame-film/frame-film.js", root), "utf8");
const gsapSource = readFileSync(new URL("node_modules/gsap/dist/gsap.min.js", root), "utf8");
const html = (beats) => `<html><body style="margin:0"><div id="frame-film" style="position:absolute;inset:0"></div><script id="ff-data" type="application/json">${JSON.stringify({ feel: "explainer", beats }).replace(/</g, "\\u003c")}</script><script>${gsapSource}</script><script>window.__timelines={main:gsap.timeline({paused:true})};</script><script>${runtime}</script></body></html>`;
const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", process.env.CHROME_BIN].find((p) => p && existsSync(p));
const wrap = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 1280"><rect id="bg" width="720" height="1280" fill="#101820"/>${inner}</svg>`;

async function open(svg, motion, seconds = 6) {
  const browser = await chromium.launch({ executablePath: chrome });
  const page = await browser.newPage();
  await page.setContent(html([{ start: 0, end: seconds, svg, motion: parseFrameMotion(motion, svg, seconds) }]));
  const box = (time, id) => page.evaluate(([tm, name]) => { window.__timelines.main.time(tm); const r = document.querySelector("#" + name).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; }, [time, id]);
  return { browser, box, page };
}

// A revenue chart: unrelated to any particular film.
const chart = wrap(`<line id="axis" x1="100" y1="900" x2="640" y2="900" stroke="#fff" stroke-width="4"/>
<rect id="q1" x="140" y="700" width="80" height="200" fill="#4c8"/><rect id="q2" x="280" y="560" width="80" height="340" fill="#4c8"/><rect id="q3" x="420" y="380" width="80" height="520" fill="#4c8"/>
<text id="total" x="360" y="330" font-size="60" fill="#fff" text-anchor="middle">$4.2M</text>
<path id="trend" d="M 180 690 L 320 550 L 460 370" stroke="#fb3" stroke-width="6" fill="none"/>`);
test("chart: axis draws, bars grow from the baseline, the connector draws on, the total counts up", async (t) => {
  if (!chrome) return t.skip("no Chrome available");
  const { browser, box, page } = await open(chart, [
    { kind: "draw", ids: ["axis"], start: 0.1, end: 0.9 },
    { kind: "grow", ids: ["q1", "q2", "q3"], from: "bottom", start: 1, end: 3 },
    { kind: "count", id: "total", from: 0, start: 1, end: 3 },
    { kind: "draw", ids: ["trend"], start: 3.2, end: 4.4 }
  ]);
  try {
    const q3Full = (await box(5.5, "q3")).h;
    const h = []; for (const x of [1.0, 1.5, 2.0, 2.5, 3.2, 5.5]) h.push((await box(x, "q3")).h);
    assert.ok(h[0] < q3Full * 0.1, `bar starts at zero height (${h[0]} of ${q3Full})`);
    assert.ok(h[1] > h[0] && h[2] > h[1] && h[3] > h[2], "bar height keeps growing");
    assert.ok(Math.abs(h[5] - q3Full) < 0.5 && h[4] > q3Full * 0.9, "bar ends at its full height");
    // (relative to the axis, so the film's slow camera push-in does not count as the bar moving)
    const base = []; for (const x of [1.0, 2.0, 5.5]) { const b = await box(x, "q3"), a = await box(x, "axis"); base.push(b.y + b.h - (a.y + a.h)); }
    assert.ok(Math.abs(base[0] - base[2]) < 0.5 && Math.abs(base[1] - base[2]) < 0.5, "the bar stays planted on its baseline");
    const fraction = async (id, time, full) => (await box(time, id)).h / full;
    const q1Full = (await box(5.5, "q1")).h;
    assert.ok((await fraction("q1", 1.6, q1Full)) > (await fraction("q3", 1.6, q3Full)) + 0.1, "bars start one after another");
    const dash = (time) => page.evaluate((tm) => { window.__timelines.main.time(tm); return Number(getComputedStyle(document.querySelector("#trend")).strokeDashoffset.replace("px", "")); }, time);
    assert.ok((await dash(3.3)) > (await dash(4.0)) && (await dash(4.0)) > 0 && (await dash(5.5)) < 1, "the connector draws along its stroke");
    const text = (time) => page.evaluate((tm) => { window.__timelines.main.time(tm, false); return document.querySelector("#total").textContent; }, time);
    assert.equal(await text(5.5), "$4.2M");
  } finally { await browser.close(); }
});

// A ring road with cars (or any circulating items): a path plus several items on it.
const ring = wrap(`<path id="loop" d="M 360 400 m -200 0 a 200 200 0 1 0 400 0 a 200 200 0 1 0 -400 0" stroke="#789" stroke-width="3" fill="none"/>
${[0, 1, 2, 3].map((k) => `<circle id="car${k}" cx="${360 + 200 * Math.cos(k * Math.PI / 2 + Math.PI)}" cy="${400 + 200 * Math.sin(k * Math.PI / 2 + Math.PI)}" r="14" fill="#f80"/>`).join("")}`);
test("loop: items circulate round a drawn path, shift colour along it, and end where they are drawn", async (t) => {
  if (!chrome) return t.skip("no Chrome available");
  const { browser, box, page } = await open(ring, [{ kind: "travel", ids: ["car0", "car1", "car2", "car3"], path: "loop", mode: "loop", period: 2, colors: ["#ff8800", "#2288ff"], start: 1, end: 5 }]);
  try {
    const rest = await box(0.5, "car0"), later = await box(1.5, "car0");
    assert.ok(Math.hypot(later.cx - rest.cx, later.cy - rest.cy) > 40, "the item moves around the loop");
    const ringBox = await box(0.5, "loop"), seen = new Set(); for (let x = 1; x <= 5; x += 0.05) { const b = await box(x, "car0"); seen.add(Math.round(Math.atan2(b.cy - ringBox.cy, b.cx - ringBox.cx) * 4)); }
    assert.ok(seen.size > 10, "it goes all the way round");
    const rel = async (time) => { const ringAt = await box(time, "loop"), b = await box(time, "car0"); return [(b.cx - ringAt.cx) / ringAt.w, (b.cy - ringAt.cy) / ringAt.h]; };
    const [r0, r1] = [await rel(0.5), await rel(5.5)];
    assert.ok(Math.hypot(r0[0] - r1[0], r0[1] - r1[1]) < 0.01, "it ends where it is drawn");
    const fill = (time) => page.evaluate((tm) => { window.__timelines.main.time(tm); return getComputedStyle(document.querySelector("#car0")).fill; }, time);
    assert.notEqual(await fill(1.2), await fill(2.0), "its colour shifts as it travels");
  } finally { await browser.close(); }
});

// A story: a character walks once along a road and arrives where it is drawn.
const story = wrap(`<path id="road" d="M 100 900 L 600 900" stroke="#cba" stroke-width="10" fill="none"/><circle id="hero" cx="600" cy="880" r="24" fill="#6cf"/>`);
test("walk: a character travels once along its route and arrives where it is drawn", async (t) => {
  if (!chrome) return t.skip("no Chrome available");
  const { browser, box } = await open(story, [{ kind: "travel", ids: ["hero"], path: "road", mode: "once", period: 3, start: 1, end: 4 }]);
  try {
    const x = []; for (const tm of [0.2, 1.8, 2.5, 3.2, 5.5]) x.push((await box(tm, "hero")).cx);
    assert.ok(x[0] < x[4] - 100, "it starts at the start of the route");
    assert.ok(x[1] > x[0] && x[2] > x[1] && x[3] > x[2] && x[4] >= x[3], "it keeps advancing");
  } finally { await browser.close(); }
});

// Rising mist: drifting things keep moving, fade out and in, and settle visible.
const mist = wrap(`${[0, 1, 2].map((k) => `<circle id="puff${k}" cx="${200 + k * 150}" cy="700" r="30" fill="#cde" opacity="0.8"/>`).join("")}`);
test("drift: things keep rising pass after pass and settle visible", async (t) => {
  if (!chrome) return t.skip("no Chrome available");
  const { browser, box, page } = await open(mist, [{ kind: "drift", ids: ["puff0", "puff1", "puff2"], dx: 0, dy: -80, period: 2, start: 0.5, end: 5 }]);
  try {
    const y = []; for (let x = 0.5; x <= 5; x += 0.1) y.push((await box(x, "puff1")).cy);
    assert.ok(Math.max(...y) - Math.min(...y) > 40, "it rises");
    const resets = y.filter((v, i) => i > 0 && v > y[i - 1] + 20).length;
    assert.ok(resets >= 1, "and starts again, pass after pass");
    const op = await page.evaluate(() => { window.__timelines.main.time(5.6); return getComputedStyle(document.querySelector("#puff1").parentNode).opacity; });
    assert.equal(op, "1");
    const rest = await box(5.6, "puff1"); assert.ok(Math.abs(rest.cy - (await box(0.1, "puff1")).cy) < 1, "ends at rest");
  } finally { await browser.close(); }
});
