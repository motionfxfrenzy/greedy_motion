import { chromium } from "/Users/osamaehsaan/Code/Market_apps/VideoSaaS-live-scenes/node_modules/playwright-core/index.mjs";
import { createServer } from "node:http"; import { readFileSync, existsSync } from "node:fs"; import { join, extname } from "node:path";
const S = new URL(".", import.meta.url).pathname;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const srv = createServer((q, r) => { const p = join(S, decodeURIComponent(new URL(q.url, "http://x").pathname)); if (!existsSync(p) || p.endsWith("/")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": types[extname(p)] ?? "application/octet-stream" }); r.end(readFileSync(p)); }).listen(0, "127.0.0.1");
await new Promise((ok) => srv.once("listening", ok)); const port = srv.address().port;
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const pg = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const logs = []; pg.on("console", (m) => logs.push(m.type() + ": " + m.text().slice(0, 200))); pg.on("pageerror", (e) => logs.push("PAGEERROR " + String(e).slice(0, 300)));
await pg.addInitScript({ path: S + "runtime.js" });
let html = readFileSync(S + "index.html", "utf8").replace("</head>", '<link rel="stylesheet" href="theme.css"></head>');
await pg.route("**/probe.html", (r) => r.fulfill({ contentType: "text/html", body: html }));
await pg.goto(`http://127.0.0.1:${port}/probe.html`); await pg.waitForTimeout(1500);

const walk = (t) => pg.evaluate((t) => {
  window.__timelines.main.seek(t, false);
  const out = [];
  const eff = (el) => { let o = 1, e = el; while (e && e !== document.body) { const cs = getComputedStyle(e); if (cs.visibility === "hidden" || cs.display === "none") return 0; o *= parseFloat(cs.opacity); e = e.parentElement; } return o; };
  document.querySelectorAll("#stage *, #captions *").forEach((el) => {
    const r = el.getBoundingClientRect(); const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("");
    const o = eff(el); if (o < 0.05 || r.width < 2 || r.height < 2) return;
    if (!own && !["IMG", "CANVAS", "svg", "SVG"].includes(el.tagName) && el.children.length) return;
    out.push({ tag: el.tagName.toLowerCase(), cls: el.className && el.className.baseVal === undefined ? String(el.className) : "", id: el.id || null, data: Object.keys(el.dataset).join(","), text: own.slice(0, 40), box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], op: +o.toFixed(2) });
  });
  return out;
}, t);
for (const t of [1.0, 3.2, 6.4]) { const r = await walk(t); console.log("t=" + t, JSON.stringify(r, null, 0).slice(0, 1500)); }
await pg.screenshot({ path: S + "t6.png" }); await b.close(); srv.close();
