// Drives the harness in headless Chrome. Usage: node run.mjs <step> [args]   steps: smoke | speed | throttle | contain | hang | memory | soak | identity | all
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { execFileSync } from "node:child_process";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", URL_ = "http://127.0.0.1:8766/harness.html";
const [step = "smoke", ...rest] = process.argv.slice(2);
const PROFILE = "/private/tmp/claude-501/-Users-osamaehsaan-Code-Market-apps-VideoSaaS/125f37d8-8f64-4270-9874-a6c0d420e0ee/scratchpad/p0profile";
const browser = await chromium.launchPersistentContext(PROFILE, { executablePath: CHROME, headless: true, args: ["--enable-precise-memory-info"], viewport: { width: 1280, height: 800 } });
const rssMB = () => { const rows = execFileSync("ps", ["-axo", "rss=,command="]).toString().split("\n").filter((l) => l.includes("p0profile")); return Math.round(rows.reduce((t, l) => t + Number(l.trim().split(/\s+/)[0]), 0) / 1024); };
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 200)));
await page.goto(URL_); await page.waitForFunction(() => window.phase0);
const ev = (fn, ...args) => page.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
const show = (label, v) => console.log("\n## " + label + "\n" + JSON.stringify(v, null, 1));
const names = await ev(async () => (await (await fetch("index.json")).json()).filter((s) => !s.error).map((s) => s.name));
try {
  if (step === "smoke") { show("features", await ev(() => phase0.features())); show("speed", await ev((n) => phase0.speed(n, 0.445), names[3])); show("identity", await ev((n) => phase0.identity(n), names[3])); }
  if (step === "speed" || step === "all") { const rows = []; for (const n of names) for (const scale of [0.445, 1]) rows.push(await ev((n, s) => phase0.speed(n, s), n, scale)); show("speed", rows.map((r) => ({ name: r.name, scale: r.scale, size: r.size, readyMs: r.readyMs, drawMean: r.drawMs?.mean, drawP95: r.drawMs?.p95, drawMax: r.drawMs?.max, copy: r.copyMsMean, fps: r.produceFps, ratio: r.realtimeRatio, gate: r.gate?.decision, lead: r.gate?.leadSeconds, ahead: r.gate?.aheadSeconds, err: r.error }))); }
  if (step === "throttle" || step === "all") { const cdp = await browser.newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 }); const viaCdp = await ev((n) => phase0.speed(n, 0.445), names[3]); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }); const base = await ev((n) => phase0.speed(n, 0.445), names[3]); show("cdp throttle 6x reaches worker?", { base: base.drawMs, throttled: viaCdp.drawMs }); const rows = []; for (const n of names) for (const repeat of [3, 6]) rows.push(await ev((n, r) => phase0.speed(n, 0.445, { repeat: r }), n, repeat)); show("emulated slower device (repeat draw)", rows.map((r) => ({ name: r.name, slow: r.repeat + "x", drawMean: r.drawMs?.mean, fps: r.produceFps, ratio: r.realtimeRatio, lead: r.gate?.leadSeconds, ahead: r.gate?.aheadSeconds, gate: r.gate?.decision }))); }
  if (step === "contain" || step === "all") show("containment", await ev(() => phase0.containment()));
  if (step === "hang" || step === "all") { const rows = []; for (const k of ["plain", "csp+neuter"]) rows.push(await ev((k) => phase0.hang(k), k)); show("hang", rows); const before = rssMB(); const bomb = await ev(() => phase0.bomb(1500)); show("allocation bomb", { ...bomb, rssBeforeMB: before, rssAfterMB: rssMB() }); }
  if (step === "memory" || step === "all") { const before = rssMB(); const v = await ev(() => phase0.memoryVisibility("fox-397b0ec8-0", 300)); show("memory visibility", { ...v, osRssBeforeMB: before, osRssAfterMB: rssMB() }); }
  if (step === "identity" || step === "all") { const rows = []; for (const n of names) rows.push(await ev((n) => phase0.identity(n), n)); show("identity", rows); show("digests", await ev((n) => phase0.digests(n), names[0])); }
  if (step === "params") show("parameter edit through both hosts", await ev(() => phase0.paramEdit()));
  if (step === "leak") { const base = rssMB(), samples = []; const t = setInterval(() => samples.push(rssMB()), 400); const r = await ev(() => phase0.leak(20, 40)); clearInterval(t); await new Promise((ok) => setTimeout(ok, 1500)); show("heartbeating memory leak (20 MB per frame)", { ...r, rssBeforeMB: base, rssPeakMB: Math.max(...samples), rssAfterTerminateMB: rssMB() }); }
  if (step === "pace") { const rows = []; for (const n of [names[4], names[8], names[0]]) { const x = await ev((n) => phase0.soak(n, 40, 64, false), n); rows.push({ name: x.name, produced40s: x.produced, expected: 1200, lateFrames: x.lateFrames, lateMsP95: x.lateMsP95 }); } show("real-time pacing, no memory sampling", rows); }
  if (step === "soak") { const seconds = Number(rest[0] ?? 180), samples = []; const timer = setInterval(() => samples.push(rssMB()), 5000); const r = await ev((n, s) => phase0.soak(n, s), names[4], seconds); clearInterval(timer); show("soak " + seconds + "s", { ...r, osRssMBEvery5s: samples }); }
} finally { await browser.close(); }
