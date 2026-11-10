// Tests for FilmBrief style picker scope ("film") vs general gallery scope ("all"):
// - eligible explain/story/illus examples & styles
// - incompatible product/brand/colour/3D exclusion
// - mixed-family and mixed-use-case styles
// - server counts, cursor pagination, deduplication, and search
// - capability gating (plates: true vs plates: false) and heldForV2 enforcement
// - selection round-trip (explicit example & "Use this style" defaultExample) preserving isFilmBrief
// - Fastify /v1/gallery/templates and /v1/gallery/styles route validation
import assert from "node:assert/strict";
import test from "node:test";

process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:5432/unused";

const c = await import("@videosaas/contracts");

test("film scope includes all eligible educational (explain) and code-drawn story (illus-*) styles and templates", () => {
  const styles = c.galleryStyles({ scope: "film", plates: true });
  const styleIds = new Set(styles.map((s) => s.id));

  // All 31 code-drawn illustration styles must be present
  const illusLooks = c.looks.filter((l) => l.available && l.id.startsWith("illus-"));
  assert.equal(illusLooks.length, 31, "catalog has 31 illus-* looks");
  for (const look of illusLooks) {
    assert.ok(styleIds.has(look.id), `film styles must include ${look.id}`);
    const card = styles.find((s) => s.id === look.id);
    assert.equal(card.examples, 1, `${look.id} has 1 story plate example`);
    assert.equal(card.defaultExample, `story-${look.id}`, `${look.id} defaultExample is story-${look.id}`);
    assert.ok(card.preview.video, `${look.id} has a video preview clip`);
  }

  // Rubber hose specifically
  const rubberHose = styles.find((s) => s.id === "illus-rubber-hose");
  assert.ok(rubberHose, "Rubber hose style is present in film scope");
  assert.equal(rubberHose.name, "Illustration · Rubber hose");
  assert.equal(rubberHose.defaultExample, "story-illus-rubber-hose");

  // Educational styles with explain templates must be present
  for (const id of ["clean-data", "sketch", "doodle", "clean-type", "clean-ui"]) {
    assert.ok(styleIds.has(id), `educational/mixed style ${id} is present in film scope`);
  }
  assert.equal(styles.length, 36, "31 illus-* styles + 5 educational styles = 36 film styles");
});

test("film scope excludes incompatible product/brand-only styles and unshipped generated looks", () => {
  const styles = c.galleryStyles({ scope: "film", plates: true });
  const styleIds = new Set(styles.map((s) => s.id));

  // Purely SaaS / Brand / 3D styles have 0 film-compatible templates and must not appear
  for (const excluded of ["hairline", "doodle-crosshatch", "doodle-zigzag", "vox-collage", "clean-3d"]) {
    assert.equal(styleIds.has(excluded), false, `${excluded} has no film-compatible templates and must be excluded`);
  }

  // Held-for-v2 non-plate generated looks (paper-*, clay-*) must remain excluded
  for (const held of ["paper-diorama", "paper", "paper-cutout", "paper-stop-motion", "paper-collage", "origami", "paper-cut", "clay-goofy", "clay-clean", "clay-puppet", "claymation"]) {
    assert.equal(styleIds.has(held), false, `held generated look ${held} must not be exposed`);
  }

  // Querying templates in film scope never returns saas, brand, threed, or colour items
  const pageAll = c.queryGallery({ scope: "film", plates: true, limit: 48 });
  const page2 = c.queryGallery({ scope: "film", plates: true, cursor: pageAll.nextCursor ?? "48", limit: 48 });
  const combined = [...pageAll.items, ...page2.items];
  assert.equal(pageAll.total, 70, "39 explain + 31 story = 70 film templates");
  assert.equal(combined.length, 70);
  for (const item of combined) {
    assert.ok(item.useCase === "explain" || item.useCase === "story", `item ${item.id} has incompatible useCase ${item.useCase}`);
    assert.equal(c.isFilmBrief({ look: c.findGalleryTemplate(item.id)?.look, styleExample: item.id }), true, `${item.id} must be recognized by isFilmBrief`);
  }
  assert.equal(pageAll.counts.saas, 0);
  assert.equal(pageAll.counts.brand, 0);
  assert.equal(pageAll.counts.colour, 0);
  assert.equal(pageAll.counts.threed, 0);
  assert.equal(pageAll.counts.explain, 39);
  assert.equal(pageAll.counts.story, 31);
  assert.equal(pageAll.counts.all, 70);
});

test("mixed-use-case and mixed-family styles expose only their film-compatible examples in film scope", () => {
  // clean-data has 30 explain + 1 saas in general scope; only 30 explain in film scope
  const cleanDataAll = c.queryGallery({ look: "clean-data", plates: true, limit: 48 });
  const cleanDataFilm = c.queryGallery({ look: "clean-data", scope: "film", plates: true, limit: 48 });
  assert.equal(cleanDataAll.total, 31);
  assert.equal(cleanDataFilm.total, 30);
  assert.equal(cleanDataFilm.counts.saas, 0);
  assert.equal(cleanDataFilm.counts.explain, 30);
  assert.ok(cleanDataFilm.items.every((item) => item.useCase === "explain"));

  // sketch has 6 saas + 4 explain + 2 brand = 12 in general scope; only 4 explain in film scope
  const sketchAll = c.queryGallery({ look: "sketch", plates: true, limit: 48 });
  const sketchFilm = c.queryGallery({ look: "sketch", scope: "film", plates: true, limit: 48 });
  assert.equal(sketchAll.total, 12);
  assert.equal(sketchFilm.total, 4);
  assert.equal(sketchFilm.counts.saas, 0);
  assert.equal(sketchFilm.counts.brand, 0);
  assert.equal(sketchFilm.counts.explain, 4);
  assert.deepEqual(
    sketchFilm.items.map((i) => i.id),
    ["stick-figure-lesson", "whiteboard-concept-explainer", "whiteboard-idea-to-launch", "whiteboard-marker-diagram"]
  );

  // doodle has 10 saas + 1 explain = 11 in general scope; only 1 explain in film scope
  const doodleAll = c.queryGallery({ look: "doodle", plates: true, limit: 48 });
  const doodleFilm = c.queryGallery({ look: "doodle", scope: "film", plates: true, limit: 48 });
  assert.equal(doodleAll.total, 11);
  assert.equal(doodleFilm.total, 1);
  assert.equal(doodleFilm.items[0].id, "storybook-raindrop-journey");

  // hairline has 8 saas + 3 brand = 11 in general scope; 0 in film scope
  const hairlineFilm = c.queryGallery({ look: "hairline", scope: "film", plates: true, limit: 48 });
  assert.equal(hairlineFilm.total, 0);
  assert.equal(hairlineFilm.items.length, 0);
});

test("pagination, search, and capability gating (plates: false vs true) work before slicing", () => {
  // Pagination across clean-data (30 items, page size 12)
  const p1 = c.queryGallery({ look: "clean-data", scope: "film", plates: true, limit: 12 });
  assert.equal(p1.items.length, 12);
  assert.equal(p1.total, 30);
  assert.equal(p1.nextCursor, "12");

  const p2 = c.queryGallery({ look: "clean-data", scope: "film", plates: true, cursor: p1.nextCursor, limit: 12 });
  assert.equal(p2.items.length, 12);
  assert.equal(p2.total, 30);
  assert.equal(p2.nextCursor, "24");

  const p3 = c.queryGallery({ look: "clean-data", scope: "film", plates: true, cursor: p2.nextCursor, limit: 12 });
  assert.equal(p3.items.length, 6);
  assert.equal(p3.total, 30);
  assert.equal(p3.nextCursor, null);

  const ids = [...p1.items, ...p2.items, ...p3.items].map((i) => i.id);
  assert.equal(new Set(ids).size, 30, "all 30 paginated items are unique");

  // Search in film scope finds compatible items and ignores SaaS items
  const searchBayes = c.queryGallery({ look: "clean-data", scope: "film", plates: true, q: "  bayes  " });
  assert.equal(searchBayes.total, 1);
  assert.equal(searchBayes.items[0].id, "bayes-boxes");

  const searchSaas = c.queryGallery({ scope: "film", plates: true, q: "Feature spotlight" });
  assert.equal(searchSaas.total, 0);
  assert.equal(searchSaas.counts.all, 0);

  const searchLaunch = c.queryGallery({ scope: "film", plates: true, q: "Product launch" });
  assert.equal(searchLaunch.items.some((i) => i.id === "product-launch"), false, "SaaS product-launch starter is excluded in film scope");
  assert.ok(searchLaunch.items.every((i) => i.useCase === "explain" || i.useCase === "story"));

  // Capability gating: plates: false hides code-drawn story-illus-* styles and templates
  const stylesNoPlates = c.galleryStyles({ scope: "film", plates: false });
  assert.equal(stylesNoPlates.length, 5, "only the 5 native educational styles remain when plates=false");
  assert.equal(stylesNoPlates.some((s) => s.id.startsWith("illus-")), false);

  const templatesNoPlates = c.queryGallery({ scope: "film", plates: false, limit: 48 });
  assert.equal(templatesNoPlates.total, 39);
  assert.equal(templatesNoPlates.counts.story, 0);
  assert.equal(templatesNoPlates.counts.explain, 39);
});

test("selecting any film-scoped style (with or without explicit example card) stays isFilmBrief", () => {
  const styles = c.galleryStyles({ scope: "film", plates: true });
  for (const style of styles) {
    const families = c.familiesOfLook(style.look);
    const styleFamily = families.length ? style.id : undefined;
    // 1. "Use this style" without explicit example card uses defaultStyleExample
    const fallbackExample = style.defaultExample ?? c.defaultStyleExample(style.id, { scope: "film", plates: true });
    assert.ok(fallbackExample, `${style.id} has a film-compatible defaultStyleExample`);
    const briefFromStyle = {
      scriptMode: "problem",
      text: "Explain how money evolves from barter to digital ledgers.",
      durationSeconds: 45,
      aspect: "16:9",
      motionProfile: "smooth",
      pace: "balanced",
      captions: "key-phrases",
      audio: { mode: "both", voice: "Kore", cast: "characters", voices: { Merchant: "Puck" } },
      look: style.look,
      ...(styleFamily ? { styleFamily } : {}),
      styleExample: fallbackExample
    };
    assert.equal(c.isFilmBrief(briefFromStyle), true, `Use this style on ${style.id} remains isFilmBrief`);
    const parsed = c.parseScriptBrief(briefFromStyle);
    assert.ok("brief" in parsed, `Brief with ${style.id} and ${fallbackExample} is valid`);
    assert.equal(c.isFilmBrief(parsed.brief), true, `Parsed brief for ${style.id} remains isFilmBrief`);

    // 2. Every example in styleExamples(style.id, { scope: "film" }) also remains isFilmBrief
    const examples = c.styleExamples(style.id, { scope: "film", plates: true });
    assert.ok(examples.length > 0);
    for (const ex of examples) {
      assert.equal(c.isFilmBrief({ look: style.look, styleFamily, styleExample: ex.id }), true, `example ${ex.id} of ${style.id} isFilmBrief`);
    }
  }
});

test("general gallery and non-film style picker remain unchanged", () => {
  const generalStyles = c.galleryStyles({ plates: true });
  assert.equal(generalStyles.length, 41, "general picker has all 41 available styles (10 native + 31 illus)");
  assert.ok(generalStyles.some((s) => s.id === "hairline"));
  assert.ok(generalStyles.some((s) => s.id === "vox-collage"));
  assert.ok(generalStyles.some((s) => s.id === "clean-ui" && s.examples === 30));

  const generalTemplates = c.queryGallery({ plates: true, limit: 24 });
  assert.equal(generalTemplates.total, 162);
  assert.equal(generalTemplates.counts.saas, 60);
  assert.equal(generalTemplates.counts.explain, 39);
  assert.equal(generalTemplates.counts.brand, 16);
  assert.equal(generalTemplates.counts.story, 31);
  assert.equal(generalTemplates.counts.colour, 16);
});

test("Fastify /v1/gallery/styles and /v1/gallery/templates routes enforce scope and validate inputs", async () => {
  const Fastify = (await import("fastify")).default;
  const { registerGalleryRoutes } = await import("../src/gallery.ts");
  const app = Fastify();
  await registerGalleryRoutes(app);

  const stylesFilmRes = await app.inject({ method: "GET", url: "/v1/gallery/styles?scope=film" });
  assert.equal(stylesFilmRes.statusCode, 200);
  const stylesFilmBody = stylesFilmRes.json();
  assert.ok(Array.isArray(stylesFilmBody.items));
  assert.equal(stylesFilmBody.items.some((s) => s.id === "hairline"), false);
  assert.equal(stylesFilmBody.items.some((s) => s.id === "clean-data" && s.examples === 30), true);

  const stylesBadScope = await app.inject({ method: "GET", url: "/v1/gallery/styles?scope=invalid" });
  assert.equal(stylesBadScope.statusCode, 400);

  const templatesFilmRes = await app.inject({ method: "GET", url: "/v1/gallery/templates?scope=film&look=sketch" });
  assert.equal(templatesFilmRes.statusCode, 200);
  const templatesFilmBody = templatesFilmRes.json();
  assert.equal(templatesFilmBody.total, 4);
  assert.equal(templatesFilmBody.counts.saas, 0);
  assert.equal(templatesFilmBody.counts.explain, 4);

  const templatesBadScope = await app.inject({ method: "GET", url: "/v1/gallery/templates?scope=invalid" });
  assert.equal(templatesBadScope.statusCode, 400);

  await app.close();
});
