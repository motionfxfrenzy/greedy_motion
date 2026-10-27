// TCP proxy in front of local Postgres for the render-events fault tests (see scenarios.mjs).
//   node test/events-faults/proxy.mjs <listenPort> <pgPort> <controlPort>
// Modes (GET http://127.0.0.1:<controlPort>/<mode>):
//   pass   forward everything
//   silent forward everything except NotificationResponse ('A') messages: LISTEN is accepted, nothing arrives
//   refuse close every open connection and refuse new ones
import net from "node:net";
import http from "node:http";

const [listenPort, pgPort, controlPort] = process.argv.slice(2).map(Number);
let mode = "pass";
const sockets = new Set();
let dropped = 0;

function filterServer(onOut) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    if (mode !== "silent") { if (buf.length) { onOut(buf); buf = Buffer.alloc(0); } onOut(chunk); return; }
    buf = Buffer.concat([buf, chunk]);
    const out = [];
    while (buf.length >= 5) {
      const len = buf.readInt32BE(1);
      if (buf.length < 1 + len) break;
      const msg = buf.subarray(0, 1 + len);
      buf = buf.subarray(1 + len);
      if (msg[0] === 0x41) { dropped++; continue; } // 'A' NotificationResponse
      out.push(msg);
    }
    if (out.length) onOut(Buffer.concat(out));
  };
}

net.createServer((client) => {
  if (mode === "refuse") { client.destroy(); return; }
  const server = net.connect(pgPort, "127.0.0.1");
  sockets.add(client); sockets.add(server);
  client.on("data", (d) => server.write(d));
  server.on("data", filterServer((d) => client.write(d)));
  const close = () => { client.destroy(); server.destroy(); sockets.delete(client); sockets.delete(server); };
  client.on("close", close); server.on("close", close); client.on("error", close); server.on("error", close);
}).listen(listenPort, "127.0.0.1");

http.createServer((req, res) => {
  const next = req.url.slice(1);
  if (["pass", "silent", "refuse"].includes(next)) {
    mode = next;
    if (mode === "refuse") for (const s of sockets) s.destroy();
  }
  res.end(JSON.stringify({ mode, dropped, open: sockets.size / 2 }));
}).listen(controlPort, "127.0.0.1");
console.log(`proxy :${listenPort} → :${pgPort}, control :${controlPort}`);
