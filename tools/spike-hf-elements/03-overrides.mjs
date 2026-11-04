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

import { createHash } from "node:crypto"; import { writeFileSync } from "node:fs";
const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 12);
const seek = (t) => pg.evaluate((t) => { window.__timelines.main.seek(t, false); }, t);
const shot = async (name) => { const b = await pg.screenshot(); writeFileSync(S + name + ".png", b); return sha(b); };
await seek(3.2); const base = await shot("s3-base");
// tag by structure (the stand-in for engine-stamped ids): beat index, class, order
const tagged = await pg.evaluate(() => { const ws = [...document.querySelectorAll("#stage .w")]; ws.forEach((el, i) => el.setAttribute("data-el", "w" + i)); return ws.map((el) => [el.dataset.el, el.textContent, el.parentElement.className]); });
console.log("tagged words", JSON.stringify(tagged));
const apply = (css) => pg.evaluate((css) => { let st = document.getElementById("ov"); if (!st) { st = document.createElement("style"); st.id = "ov"; document.head.appendChild(st); } st.textContent = css; }, css);
await apply('[data-el="w5"]{color:#ff3b6b !important}'); await seek(3.2); const colour = await shot("s3-colour");
await apply('[data-el="w5"]{color:#ff3b6b !important; font-size:1.3em !important}'); await seek(3.2); const size = await shot("s3-size");
await apply('[data-el="w5"]{color:#ff3b6b !important; scale:1.4 !important; translate:0 -40px !important}'); await seek(3.2); const xf = await shot("s3-xform");
// determinism: away and back, twice
await seek(6.4); await seek(0.5); await seek(3.2); const back1 = await shot("s3-back1"); await seek(7.0); await seek(3.2); const back2 = await shot("s3-back2");
// no override, same trip: baseline reproducible?
await apply(""); await seek(6.4); await seek(3.2); const base2 = await shot("s3-base2");
console.log(JSON.stringify({ base, colour, size, xf, back1, back2, base2, colourChanged: colour !== base, sizeChanged: size !== colour, xfChanged: xf !== size, reseekStable: back1 === back2 && back1 === xf, baseReproducible: base === base2 }));
await b.close(); srv.close();
