// Static server for the phase 0 harness. COOP/COEP make the page cross-origin isolated (needed by measureUserAgentSpecificMemory).
// /probe-hit records any request a contained scene managed to send: a hit count above zero means containment failed.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
const [dir, port = "8766"] = process.argv.slice(2);
const here = import.meta.dirname, types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png" };
export const hits = [];
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x"), path = decodeURIComponent(url.pathname);
  const headers = { "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp", "cross-origin-resource-policy": "cross-origin", "cache-control": "no-store" };
  if (path === "/probe-hit") { hits.push({ path: req.url, origin: req.headers.origin ?? null, at: Date.now() }); res.writeHead(200, { ...headers, "access-control-allow-origin": "*" }); return res.end("hit"); }
  if (path === "/probe-hits") { res.writeHead(200, { ...headers, "content-type": "application/json" }); return res.end(JSON.stringify(hits)); }
  if (path === "/probe-reset") { hits.length = 0; res.writeHead(200, headers); return res.end("ok"); }
  const file = [join(dir, path), join(here, path)].find((f) => !f.endsWith("/") && existsSync(f));
  if (!file) { res.writeHead(404, headers); return res.end("not found"); }
  res.writeHead(200, { ...headers, "content-type": types[extname(file)] ?? "application/octet-stream" }); res.end(readFileSync(file));
});
server.on("upgrade", (req, socket) => { hits.push({ path: req.url, via: "websocket", at: Date.now() }); socket.destroy(); });
server.listen(Number(port), "127.0.0.1", () => console.log("phase0 server on 127.0.0.1:" + port));
