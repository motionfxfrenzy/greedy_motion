/**
 * Render jobs waiting or running, for deciding how many workers to start.
 * pg-boss serves queue counts from a cache that can be minutes old, so a job queued a moment ago may not be in
 * them yet. The enqueue calls kickWorkers(true) after it commits, and those kicks are counted here until they are
 * old enough for the counts to include them.
 */
export const KICK_MEMORY_MS = 120_000;

export function createDemand(now: () => number = Date.now) {
  let kicks: number[] = [];
  return {
    /** Remember that a job was just queued. */
    kick() { kicks.push(now()); },
    /** The larger of the counted demand and the jobs queued within the last KICK_MEMORY_MS. */
    count(counted: number) {
      const cutoff = now() - KICK_MEMORY_MS;
      kicks = kicks.filter((at) => at > cutoff);
      return Math.max(counted, kicks.length);
    }
  };
}
