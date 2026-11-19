// The Trending tab is a curated pick from the other tabs (not a category of its own) and is stored in app.gallery_trending (see gallery-trending-loader.mjs);
// Cartoon history lives under Story & film, Dark fable and Illustrated facts under Explainers & learning.
// Run: node backend/test/gallery-trending.mjs
import assert from "node:assert/strict";
process.env.APP_ENV ??= "local";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
const { queryGallery, galleryTemplates, useCaseOf, trendingGalleryIds } = await import("@videosaas/contracts");
const byId = (id) => galleryTemplates.find((t) => t.id === id);
assert.equal(useCaseOf(byId("history-reel")), "story", "Cartoon history is under Story & film");
assert.equal(useCaseOf(byId("dark-fable")), "explain", "Dark fable is under Explainers & learning");
assert.equal(useCaseOf(byId("picture-film")), "explain", "Illustrated facts is under Explainers & learning");

const all = queryGallery({ plates: true, limit: 200 });
const story = queryGallery({ plates: true, useCase: "story", limit: 200 }).items.map((x) => x.id);
const explain = queryGallery({ plates: true, useCase: "explain", limit: 200 }).items.map((x) => x.id);
assert.ok(story.includes("history-reel") && !explain.includes("history-reel"));
assert.ok(explain.includes("dark-fable") && explain.includes("picture-film"));

// trending: the default list, in order, drawn from the other tabs (counts of those tabs still include them)
const t1 = queryGallery({ plates: true, useCase: "trending" });
// Cutout tales is staging-only: its template leads the list but is hidden while the flag is off.
const visibleTrending = trendingGalleryIds.filter((id) => id !== "cutout-tales-western");
assert.ok(trendingGalleryIds[0] === "cutout-tales-western");
assert.deepEqual(t1.items.map((x) => x.id), visibleTrending);
assert.equal(t1.counts.trending, visibleTrending.length);
assert.ok(all.counts.story >= 1 && all.counts.explain >= 2, "the templates are still counted in their own tabs");
// changed on the fly: another list, another order, unknown ids ignored
const t2 = queryGallery({ plates: true, useCase: "trending", trending: ["dark-fable", "no-such-template", "story-vox-collage"] });
assert.deepEqual(t2.items.map((x) => x.id), ["dark-fable", "story-vox-collage"]);
assert.equal(queryGallery({ plates: true, useCase: "trending", trending: [] }).total, 0, "an empty list is an empty tab (the page opens on All)");
assert.equal(byId("history-reel").group, "Story", "the card badge follows the category");
assert.equal(byId("dark-fable").group, "Explainer");
// Trending is not a category: All counts every template once, and the per-category counts add up to All.
const cats = Object.entries(all.counts).filter(([k]) => k !== "all" && k !== "trending").reduce((n, [, v]) => n + v, 0);
assert.equal(cats, all.counts.all, "All = sum of real categories (Trending not counted twice)");
const allIds = []; for (let cursor; ; ) { const page = queryGallery({ plates: true, limit: 50, cursor, seed: "t" }); allIds.push(...page.items.map((x) => x.id)); if (!page.nextCursor) break; cursor = page.nextCursor; }
assert.equal(allIds.length, all.counts.all, "paging All yields every template");
assert.equal(allIds.filter((id) => id === "history-reel").length, 1, "a trending item shows once in All");
// 16:9 rule: the card shows any non-16:9 film letterboxed, so the page needs no per-template flag; make sure the data stays one of the known aspects.
for (const t of galleryTemplates) assert.ok(["16:9", "9:16", "1:1"].includes(t.aspect), `${t.id}: aspect ${t.aspect}`);
console.log("gallery-trending: ok");
