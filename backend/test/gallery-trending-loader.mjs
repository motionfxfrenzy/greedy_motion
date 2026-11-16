// The database-backed Trending list: ordering, empty table, failure fallback, cache, invalidation.
// Run: node backend/test/gallery-trending-loader.mjs
import assert from "node:assert/strict";
process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
const { createGalleryTrending } = await import("../src/gallery-trending.ts");
const { trendingGalleryIds } = await import("@videosaas/contracts");

let clock = 0, calls = 0, rows = [{ template_id: "dark-fable" }, { template_id: "history-reel" }], fail = false;
const warnings = [];
const query = async (text) => { calls++; assert.match(text, /app\.gallery_trending/); assert.match(text, /order by position/); if (fail) throw new Error("db down"); return { rows }; };
const loader = createGalleryTrending({ query, now: () => clock, ttlMs: 60_000, log: { warn: (o, m) => warnings.push(m) } });

assert.deepEqual(await loader.get(), ["dark-fable", "history-reel"], "rows come back in the order the query returns (ordered by position)");
await loader.get(); await loader.get();
assert.equal(calls, 1, "cached within the TTL");
clock = 59_999; await loader.get(); assert.equal(calls, 1);
rows = [];
clock = 60_001; assert.deepEqual(await loader.get(), [], "an empty table is an empty list, not the default");
assert.equal(calls, 2, "re-read after the TTL");
rows = [{ template_id: "picture-film" }];
assert.deepEqual(await loader.get(), [], "still cached");
loader.invalidate();
assert.deepEqual(await loader.get(), ["picture-film"], "invalidate forces a re-read");
assert.equal(calls, 3);

// concurrent first requests share one query
const l2 = createGalleryTrending({ query, now: () => clock });
calls = 0; await Promise.all([l2.get(), l2.get(), l2.get()]); assert.equal(calls, 1);

// failure -> default list + warning, never throws; the failure is retried soon, not hammered
fail = true; calls = 0; clock = 0;
const l3 = createGalleryTrending({ query, now: () => clock, ttlMs: 60_000, log: { warn: (o, m) => warnings.push(m) } });
assert.deepEqual(await l3.get(), [...trendingGalleryIds]);
assert.equal(warnings.length, 1);
await l3.get(); assert.equal(calls, 1, "failure is briefly cached");
fail = false; clock = 5_001;
assert.deepEqual(await l3.get(), ["picture-film"], "recovers on the next read after the short failure window");
assert.equal(calls, 2);
console.log("gallery-trending-loader: ok");
