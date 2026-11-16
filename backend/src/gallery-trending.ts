import { trendingGalleryIds } from "@videosaas/contracts";

/**
 * The Trending tab's template ids, in order, from app.gallery_trending (ordered by position). Cached in memory for a minute so a
 * gallery request does not hit the database. If the read fails the contracts default list is used (and a warning logged), so the
 * gallery never breaks. An empty table is an empty Trending tab. Unknown ids are dropped later by queryGallery.
 * A future admin endpoint calls invalidateGalleryTrending() after it writes the table.
 */
export const GALLERY_TRENDING_TTL_MS = 60_000;

type Query = (text: string, params?: unknown[]) => Promise<{ rows: Array<{ template_id: string }> }>;
type Log = { warn: (object: unknown, message?: string) => void };

export function createGalleryTrending(options: { query: Query; now?: () => number; ttlMs?: number; log?: Log }) {
  const { query, now = Date.now, ttlMs = GALLERY_TRENDING_TTL_MS, log } = options;
  let cached: { ids: readonly string[]; at: number } | null = null;
  let pending: Promise<readonly string[]> | null = null;

  async function load(): Promise<readonly string[]> {
    try {
      const { rows } = await query("select template_id from app.gallery_trending order by position, template_id");
      const ids = rows.map((row) => row.template_id);
      cached = { ids, at: now() };
      return ids;
    } catch (error) {
      log?.warn({ err: error }, "gallery trending read failed; using the default list");
      // Keep the failure cached briefly too, so a down database is not hit by every request.
      cached = { ids: trendingGalleryIds, at: now() - ttlMs + Math.min(ttlMs, 5_000) };
      return trendingGalleryIds;
    }
  }

  return {
    async get(): Promise<readonly string[]> {
      if (cached && now() - cached.at < ttlMs) return cached.ids;
      pending ??= load().finally(() => { pending = null; });
      return pending;
    },
    invalidate() { cached = null; },
  };
}

let shared: ReturnType<typeof createGalleryTrending> | null = null;
let sharedLog: Log | undefined;

export function setGalleryTrendingLog(log: Log) { sharedLog = log; }

/** The shared, database-backed loader (the database module is loaded on first use). */
export async function getGalleryTrendingIds(): Promise<readonly string[]> {
  shared ??= createGalleryTrending({
    query: async (text, params) => (await import("./db/database.ts")).query<{ template_id: string }>(text, params),
    log: { warn: (object, message) => sharedLog?.warn(object, message) ?? console.warn(message, object) },
  });
  return shared.get();
}

/** Drops the cached list; the next gallery request re-reads the table. Call after changing app.gallery_trending. */
export function invalidateGalleryTrending() { shared?.invalidate(); }
