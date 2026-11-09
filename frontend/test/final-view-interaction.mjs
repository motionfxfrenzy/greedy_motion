import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runFinalViewAssertions, startFixtureServer } from "./final-view-fixture.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(HERE, "..");
const NEXT_DEV_LOCK = join(FRONTEND_DIR, ".next/dev/lock");

function findFreePort() {
  return new Promise((resolvePort, rejectPort) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close((err) => (err ? rejectPort(err) : resolvePort(port)));
    });
    srv.on("error", rejectPort);
  });
}

async function waitForServer(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
    } catch {
      // still booting
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  throw new Error(`Timed out waiting for Next dev server at ${url}`);
}

test(
  "FinalView headless Chrome interaction on both fixture pages: branded video controls, per-player top-right downloads, multi-ratio comparison layout, pause-other-player coordination, and Approve/Back states",
  { timeout: 120_000 },
  async () => {
    // If another Next dev server is already running and holding .next/dev/lock (e.g. localhost:3000),
    // use the in-memory fixture server to avoid corrupting .next or failing on the lock.
    if (existsSync(NEXT_DEV_LOCK)) {
      const { srv, origin, port } = await startFixtureServer();
      try {
        await runFinalViewAssertions(origin, port);
      } finally {
        await new Promise((r) => srv.close(r));
      }
      return;
    }

    const port = await findFreePort();
    const origin = `http://127.0.0.1:${port}`;

    const nextProc = spawn(
      "npx",
      ["next", "dev", "--webpack", "-H", "127.0.0.1", "-p", String(port)],
      {
        cwd: FRONTEND_DIR,
        env: {
          ...process.env,
          NEXT_PUBLIC_LIVE_DEV: "1",
          NEXT_PUBLIC_APP_ENV: "local",
          NEXT_PUBLIC_API_URL: "http://127.0.0.1:4000",
          NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-dev-anon-key"
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    nextProc.stdout?.resume();
    nextProc.stderr?.resume();

    try {
      await waitForServer(`${origin}/dev/hf-final-fixture`);
      await waitForServer(`${origin}/dev/plate-preview-fixture`);
      await runFinalViewAssertions(origin, port);
    } finally {
      if (!nextProc.killed) {
        try {
          nextProc.kill("SIGTERM");
        } catch {
          // ignore
        }
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }
);
