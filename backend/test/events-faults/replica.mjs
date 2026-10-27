// Starts an extra local backend replica for the render-events fault tests (see scenarios.mjs).
//   node test/events-faults/replica.mjs <port> [listenViaProxyPort]
// AUTH_MODE=none (local only) so test streams need no token; the heartbeat runs every 3 s.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const backend = fileURLToPath(new URL("../..", import.meta.url));
process.loadEnvFile(`${backend}/.env`);
const [port, proxyPort] = process.argv.slice(2);
const env = { ...process.env, PORT: port, AUTH_MODE: "none", RENDER_EVENTS_PING_MS: "3000" };
if (proxyPort) { const u = new URL(process.env.DATABASE_URL); u.port = proxyPort; env.LISTEN_DATABASE_URL = u.toString(); }
const child = spawn(process.execPath, ["src/server.ts"], { cwd: backend, env, stdio: "inherit" });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
