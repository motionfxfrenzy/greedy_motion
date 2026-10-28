/* Static file server shared by the live preview (preview.mjs) and the renderer (render.mjs, for films with plates): the painter's own files at /, anidoodle films at /plates/, optional extra dir at /p/. */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const here = path.dirname(fileURLToPath(import.meta.url));
/** Where the anidoodle films (dist/*.html) are: ANIDOODLE_DIST, else the scaffold next to this repository. */
export const platesDir = () => path.resolve(process.env.ANIDOODLE_DIST || path.join(here, "../../../../VideoSaaS/experiments/anidoodle-try/dist"));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".m4a": "audio/mp4", ".wav": "audio/wav", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

export function handler({ outDir } = {}) {
  return (req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const [root, rel] = p.startsWith("/p/") && outDir ? [outDir, p.slice(3)] : p.startsWith("/plates/") ? [platesDir(), p.slice(8)] : [here, p === "/" ? "index.html" : p.slice(1)];
    const file = path.resolve(root, rel);
    if (!file.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end("not found"); return; }
    const size = fs.statSync(file).size, range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
    const head = { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store", "accept-ranges": "bytes" };
    if (range) { const a = Number(range[1]), b = range[2] ? Number(range[2]) : size - 1; res.writeHead(206, { ...head, "content-range": `bytes ${a}-${b}/${size}`, "content-length": b - a + 1 }); fs.createReadStream(file, { start: a, end: b }).pipe(res); }
    else { res.writeHead(200, { ...head, "content-length": size }); fs.createReadStream(file).pipe(res); }
  };
}
/** Starts the server on `port` (0 = any free port) and resolves with { server, port }. */
export const serve = ({ port = 0, outDir } = {}) => new Promise((res, rej) => { const server = http.createServer(handler({ outDir })); server.once("error", rej); server.listen(port, "127.0.0.1", () => res({ server, port: server.address().port })); });
