import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

const LOCK_PATH = "/Users/osamaehsaan/Code/Market_apps/.lock-timing";

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function withTimingLock(label, fn, timeoutMs = 300_000) {
  const start = Date.now();
  let acquired = false;
  while (Date.now() - start < timeoutMs) {
    try {
      const fd = openSync(LOCK_PATH, "wx", 0o600);
      writeFileSync(
        fd,
        JSON.stringify({
          pid: process.pid,
          label,
          worktree: "/private/tmp/gm-draft-preview-integration",
          acquiredAt: new Date().toISOString()
        })
      );
      closeSync(fd);
      acquired = true;
      break;
    } catch {
      if (existsSync(LOCK_PATH)) {
        try {
          const info = JSON.parse(readFileSync(LOCK_PATH, "utf8"));
          if (info?.pid && !isPidAlive(Number(info.pid))) {
            unlinkSync(LOCK_PATH);
            continue;
          }
        } catch {
          // ignore parse error while another process writes
        }
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (!acquired) {
    throw new Error(`Timed out waiting to acquire ${LOCK_PATH} for ${label}`);
  }
  try {
    return await fn();
  } finally {
    try {
      if (existsSync(LOCK_PATH)) {
        const info = JSON.parse(readFileSync(LOCK_PATH, "utf8"));
        if (info?.pid === process.pid) {
          unlinkSync(LOCK_PATH);
        }
      }
    } catch {}
  }
}
