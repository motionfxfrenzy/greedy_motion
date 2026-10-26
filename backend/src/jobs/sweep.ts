/**
 * Runs `check` repeatedly, on `busyMs` while it reports demand and on the slower `idleMs` while it does not.
 * Returns a stop function. Kept apart from the launcher so the cadence can be tested without cloud settings.
 */
export function startSweep(check: () => Promise<number>, busyMs: number, idleMs: number) {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const tick = async () => {
    const demand = await check().catch(() => 0);
    if (stopped) return;
    timer = setTimeout(() => void tick(), demand > 0 ? busyMs : idleMs);
    timer.unref();
  };
  void tick();
  return () => { stopped = true; clearTimeout(timer); };
}
