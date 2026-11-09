// Process-level resilience & safety net for the render worker:
//  1. Swallows EPIPE / ECONNRESET on process.stdout and process.stderr without recursive console logging.
//  2. Handles uncaughtException and unhandledRejection with an EPIPE-proof fs.writeSync(2, ...) `worker_fatal` log,
//     re-entry guard, bounded drain (FATAL_DRAIN_SECONDS, default 10), and non-zero exit (1).
//  3. Handles SIGTERM / SIGINT with DRAIN_SECONDS (default 25) drain, then explicitly hands back any still-leased jobs
//     via `control.fail(queue, id, attempt, "worker shutting down")` (5 s overall timeout) before exiting 0.
import { writeSync } from "node:fs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Attaches error listeners on process.stdout and process.stderr that swallow EPIPE/ECONNRESET
 * and never call console.log / console.error recursively.
 */
export function installStdioSafety(proc = process) {
  const onStdioError = (error) => {
    if (error?.code === "EPIPE" || error?.code === "ECONNRESET") return;
    // Never call console.log / console.error here; write best-effort to stderr fd if possible.
  };
  proc.stdout?.on?.("error", onStdioError);
  proc.stderr?.on?.("error", onStdioError);
}

/** Writes one structured JSON line to fd 2 (stderr) via fs.writeSync, ignoring any EPIPE/IO failure. */
export function writeFatalLine(fields = {}) {
  try {
    const line = JSON.stringify({ level: "fatal", event: "worker_fatal", ...fields });
    writeSync(2, `${line}\n`);
  } catch {
    // Ignore EPIPE or closed fd 2
  }
}

/**
 * Hands back all still-leased jobs in `inFlight` by calling `control.fail(queue, id, attempt, "worker shutting down")`
 * once per job (skipping any job whose lease was lost or already acknowledged), bounded by `timeoutMs` (default 5000 ms).
 */
export async function handBackInFlight(inFlight, control, { timeoutMs = 5000 } = {}) {
  if (!inFlight || inFlight.size === 0 || !control?.fail) return;
  const signal = AbortSignal.timeout(timeoutMs);
  const tasks = [];
  for (const item of [...inFlight]) {
    if (!item || item.lost || item.acked) continue;
    if (typeof item.failOnShutdown === "function") {
      tasks.push(item.failOnShutdown(signal));
    } else {
      item.acked = true;
      tasks.push(
        Promise.resolve()
          .then(() => control.fail(item.queue, item.id, item.attempt, "worker shutting down", { maxRetryMs: timeoutMs, signal }))
          .catch(() => undefined)
      );
    }
  }
  if (!tasks.length) return;
  await Promise.race([
    Promise.allSettled(tasks),
    sleep(timeoutMs)
  ]);
}

/**
 * Installs SIGTERM, SIGINT, uncaughtException, and unhandledRejection handlers.
 */
export function installProcessSafety({
  proc = process,
  control,
  inFlight,
  isActive = () => (inFlight ? inFlight.size > 0 : false),
  onShuttingDown,
  stopPolling,
  abortJobs,
  server,
  log = (level, event, fields = {}) => {
    try { writeSync(1, `${JSON.stringify({ level, event, ...fields })}\n`); } catch {}
  },
  drainSeconds = Number.parseInt(process.env.DRAIN_SECONDS ?? "25", 10),
  fatalDrainSeconds = Number.parseInt(process.env.FATAL_DRAIN_SECONDS ?? "10", 10),
  handBackTimeoutMs = 5000,
  postAbortGraceMs = Number.parseInt(process.env.POST_ABORT_GRACE_MS ?? "4000", 10),
  exit = (code) => proc.exit(code)
} = {}) {
  installStdioSafety(proc);

  let shuttingDown = false;
  let fatalEntered = false;

  const hasRunning = () => Boolean((inFlight && inFlight.size > 0) || isActive());

  async function shutdown(signal = "SIGTERM") {
    if (shuttingDown) return;
    shuttingDown = true;
    onShuttingDown?.();
    try {
      log("info", "worker_shutdown", { signal, inFlight: inFlight?.size ?? 0 });
    } catch {}
    stopPolling?.();

    const deadline = Date.now() + Math.max(0, drainSeconds) * 1000;
    while (hasRunning() && Date.now() < deadline) {
      await sleep(50);
    }

    if (hasRunning()) {
      // Hand back any still-leased jobs explicitly before aborting/exiting.
      const handBackPromise = handBackInFlight(inFlight, control, { timeoutMs: handBackTimeoutMs });
      abortJobs?.();
      await handBackPromise;
      // Let the aborted handlers run their own cleanup (e.g. put a scene back to "bundled" so the retry can claim it at once);
      // exiting now would leave the row "rendering" until its staleness window (90 s) passes.
      const settleBy = Date.now() + Math.max(0, postAbortGraceMs);
      while (hasRunning() && Date.now() < settleBy) await sleep(50);
    }

    if (server && typeof server.close === "function") {
      try {
        server.close(() => exit(0));
        setTimeout(() => exit(0), 500).unref?.();
        return;
      } catch {
        // Fall through to exit(0)
      }
    }
    exit(0);
  }

  async function onFatal(kind, reason) {
    // Re-entry guard: a second fatal error exits at once.
    if (fatalEntered) {
      exit(1);
      return;
    }
    fatalEntered = true;
    shuttingDown = true;
    onShuttingDown?.();
    stopPolling?.();

    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error && typeof reason.stack === "string" ? reason.stack.slice(0, 1200) : undefined;
    const code = reason && typeof reason === "object" && typeof reason.code === "string" ? reason.code : undefined;

    writeFatalLine({
      kind,
      message,
      ...(code ? { code } : {}),
      ...(stack ? { stack } : {})
    });

    const drainMs = Math.max(0, fatalDrainSeconds) * 1000;
    const hardTimer = setTimeout(() => exit(1), drainMs + 200);
    hardTimer.unref?.();

    const deadline = Date.now() + drainMs;
    while (hasRunning() && Date.now() < deadline) {
      await sleep(50);
    }

    clearTimeout(hardTimer);
    exit(1);
  }

  const onSigterm = () => void shutdown("SIGTERM");
  const onSigint = () => void shutdown("SIGINT");
  const onUncaught = (error) => void onFatal("uncaughtException", error);
  const onUnhandled = (reason) => void onFatal("unhandledRejection", reason);

  proc.on("SIGTERM", onSigterm);
  proc.on("SIGINT", onSigint);
  proc.on("uncaughtException", onUncaught);
  proc.on("unhandledRejection", onUnhandled);

  return {
    shutdown,
    onFatal,
    isShuttingDown: () => shuttingDown,
    dispose() {
      proc.off?.("SIGTERM", onSigterm);
      proc.off?.("SIGINT", onSigint);
      proc.off?.("uncaughtException", onUncaught);
      proc.off?.("unhandledRejection", onUnhandled);
    }
  };
}
