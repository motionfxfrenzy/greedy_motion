// Verification suite for all 14 Studio reliability, polish, and all-ratio composition issues.
// Run: node backend/test/studio-14-issues.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

process.env.APP_ENV ??= "local";
process.env.PLANNER ??= "deterministic";
process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:5432/unused";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../..");

const contracts = await import("@videosaas/contracts");
const { bundleScene } = await import("@videosaas/plate-engine");
const { config } = await import("../src/config.ts");
const { buildAuthorMessages, contractFor } = await import("../src/plates/prompt.ts");
const { decideRevisionApply } = await import("../src/plates/store.ts");
const { systemBlocks } = await import("../src/plan/script-writer.ts");
const { languageRule } = await import("../src/plan/director.ts");
const { MAX_PLAN_ATTEMPTS } = await import("../src/plan/routes.ts");

test("Issue 1: Templates gallery 'All' mode interleaves all 5 categories, randomizes per seed, and paginates deterministically without duplicates", () => {
  const pageA1 = contracts.queryGallery({ plates: true, limit: 24, seed: "seed-alpha" });
  const pageB1 = contracts.queryGallery({ plates: true, limit: 24, seed: "seed-beta" });
  assert.equal(pageA1.total, 160);
  assert.equal(pageA1.items.length, 24);

  // Every active category (story, saas, explain, brand, colour) must appear in the first 24 items of "All"
  const catCounts = new Map();
  for (const item of pageA1.items) {
    catCounts.set(item.useCase, (catCounts.get(item.useCase) ?? 0) + 1);
  }
  for (const cat of ["story", "saas", "explain", "brand", "colour"]) {
    assert.ok((catCounts.get(cat) ?? 0) >= 3, `Category '${cat}' has balanced representation on Page 1 (got ${catCounts.get(cat) ?? 0})`);
  }

  // Different seeds produce different orderings on Page 1
  assert.notDeepEqual(
    pageA1.items.map((i) => i.id),
    pageB1.items.map((i) => i.id),
    "Different visit seeds shuffle the 'All' gallery order"
  );

  // Paginating through all 160 items with the same seed yields all 160 unique items in exact order with 0 duplicates or skips
  const seen = [];
  let cursor = undefined;
  while (true) {
    const p = contracts.queryGallery({ plates: true, limit: 24, cursor, seed: "seed-alpha" });
    seen.push(...p.items.map((i) => i.id));
    if (!p.nextCursor) break;
    cursor = p.nextCursor;
  }
  assert.equal(seen.length, 160);
  assert.equal(new Set(seen).size, 160, "Pagination with a stable seed yields 160 unique items with zero duplicates");
});

test("Issue 2: User-facing tier specs and UI components expose only Standard and Premium without model version names", () => {
  const { standard, premium } = contracts.ANIMATION_TIER_SPECS;
  assert.equal(standard.label, "Standard");
  assert.equal(premium.label, "Premium");
  assert.doesNotMatch(standard.summary, /Gemini|Claude|Opus|Flash/i);
  assert.doesNotMatch(premium.summary, /Gemini|Claude|Opus|Flash/i);
  // Internal routing metadata remains intact
  assert.equal(standard.provider, "gemini");
  assert.equal(standard.model, "gemini-3.8-flash");
  assert.equal(premium.provider, "anthropic");
  assert.equal(premium.model, "claude-opus-5-5");

  const uiFiles = [
    "frontend/components/film-brief.tsx",
    "frontend/components/prompt-composer.tsx",
    "frontend/components/preview-card.tsx",
    "frontend/components/template-picker.tsx",
    "frontend/components/voice-picker-modal.tsx",
    "frontend/components/storyboard.tsx"
  ];
  for (const rel of uiFiles) {
    const src = readFileSync(join(repoRoot, rel), "utf8");
    assert.doesNotMatch(src, /Gemini 3\.8 Flash|Claude Opus 5\.5|prebuilt Gemini voices|Claude is writing your scenes/i, `${rel} has no model marketing strings`);
  }
});

test("Issue 3: Hindi language selection enforces Hindi Devanagari VOICE lines in system & user prompts while keeping BEAT/VISUAL/SCREEN English", () => {
  const parsed = contracts.parseScriptBrief({
    scriptMode: "problem",
    text: "A hot-air balloon rises above the valley at dawn.",
    durationSeconds: 30,
    aspect: "9:16",
    motionProfile: "smooth",
    pace: "balanced",
    captions: "full",
    look: "illus-balloon",
    audio: { mode: "both", voice: "Kore", language: "hi" }
  });
  assert.ok("brief" in parsed);
  const sysText = systemBlocks({ brief: parsed.brief, context: { brandName: "", screenshots: [] } })
    .map((b) => b.text)
    .join("\n");
  assert.match(sysText, /VOICE LANGUAGE: Hindi/);
  assert.match(sysText, /Devanagari/);
  assert.match(sysText, /Never write English VOICE lines when Hindi is selected/);
  assert.doesNotMatch(sysText, /Tell it simply, in spoken English with contractions/);
  const rules = languageRule(parsed.brief).join("\n");
  assert.match(rules, /BEAT key phrases, VISUAL directions and SCREEN \/ on-screen words stay in English/);

  const filmBriefSrc = readFileSync(join(repoRoot, "frontend/components/film-brief.tsx"), "utf8");
  assert.match(filmBriefSrc, /Language changed to \{selectedLanguageLabel\}\. Regenerate the script to apply it\./);
});

test("Issue 4, 8 & 14: All-ratio centered composition (9:16, 16:9, 1:1), foreground-over-background layering, and PROP/character continuity", async () => {
  const beats = [
    {
      keyword: "Morning lift",
      visual: "The striped balloon, a plain prop with no face, rises centrally above distant green hills.",
      onScreen: null,
      line: "सुबह की हवा में गुब्बारा ऊपर उठता है।"
    }
  ];
  const scriptNotes = {
    idea: "Warm air lifts the balloon above the valley.",
    objects: "balloon (PROP, no face), burner (PROP), basket (PROP)",
    example: "Striped red-orange-yellow balloon over green hills"
  };

  for (const [aspect, w, h] of [
    ["9:16", 1080, 1920],
    ["16:9", 1920, 1080],
    ["1:1", 1080, 1080]
  ]) {
    const sys = contractFor({ w, h, label: `${w}x${h}` }, 220, "balloon");
    assert.equal(sys.split("\n").length, 11, `${aspect}: contractFor keeps exact 11-line structure`);
    assert.match(sys, /draw background sky\/hills\/ground FIRST and the foreground focal subject AFTER background hills/);
    assert.match(sys, /never bottom-heavy/);

    const msg = await buildAuthorMessages({
      look: "illus-balloon",
      plateName: "balloon",
      film: "A balloon rises over the valley.",
      beats,
      aspect,
      index: 0,
      frames: 150,
      scriptNotes
    });
    const shared = msg.messages[0].content[0].text;
    const scene = msg.messages[0].content[1].text;
    assert.match(shared, /RECURRING OBJECTS \/ CAST NOTES: balloon \(PROP, no face\)/);
    assert.match(scene, new RegExp(`COMPOSITION, LAYERING & CONTINUITY \\(${w}x${h}, ${aspect}\\):`));
    assert.match(scene, /CENTERED FRAMING ACROSS ALL RATIOS/);
    assert.match(scene, /COMPLETE SUBJECT VISIBILITY & CAPTION SAFE ZONE/);
    assert.match(scene, /FOREGROUND OVER BACKGROUND LAYERING/);
    assert.match(scene, /Never add eyes, brows, or a mouth to a PROP/);
  }

  const sketchSrc = readFileSync(join(repoRoot, "backend/src/plan/frame-sketch.ts"), "utf8");
  assert.match(sketchSrc, /across all aspect ratios \(16:9, 9:16, and 1:1\)/);
  assert.match(sketchSrc, /never draw eyes, brows, or a mouth on a plain PROP/);
});

test("Issue 5, 6 & 15A: Planning restart recovery config, 8/12 authoring concurrency/cap, post-return re-enqueue, and checked live preservation during background export", () => {
  assert.equal(MAX_PLAN_ATTEMPTS, 3, "Interrupted storyboard planning supports bounded automatic restart recovery");
  assert.equal(config.plates.authorConcurrency, 8, "Default PLATE_AUTHOR_CONCURRENCY is 8");
  assert.equal(config.plates.projectAuthorCap, 12, "Default PLATE_PROJECT_AUTHOR_CAP is 12 so 6-, 7-, and 10-scene projects never cap the final scene");

  const authorSrc = readFileSync(join(repoRoot, "backend/src/plates/author.ts"), "utf8");
  assert.match(authorSrc, /setTimeout\(\(\) => \{\s*void sendOnce\(null, QUEUES\.plateAuthor/, "author.ts re-enqueues after pg-boss handler returns so singletonKey does not self-collide");

  const storeSrc = readFileSync(join(repoRoot, "backend/src/plates/store.ts"), "utf8");
  assert.match(storeSrc, /select id, gen from app\.plate_variants where project_id = \$1 and state = 'queued'/, "commitBundle immediately wakes remaining queued variants on the project");

  const serviceSrc = readFileSync(join(repoRoot, "backend/src/plates/service.ts"), "utf8");
  assert.match(serviceSrc, /hasPassedFastLiveCheck/, "service.ts keeps already-checked live scenes playable when background export renders clips");
});

test("Observations 3 & 4: Default subtitle mode is 'full' (Subtitles) and default vertical offset is Y=70% across contracts, backend, frontend, and worker", async () => {
  const { defaultSubtitlesFor, mergeSubtitles } = await import("../src/plates/model.ts");
  assert.equal(contracts.defaultScriptBrief.captions, "full", "defaultScriptBrief.captions is 'full'");

  const allTemplates = contracts.galleryTemplates;
  assert.ok(allTemplates.length >= 160);
  for (const item of allTemplates) {
    const b = contracts.galleryBrief(item);
    assert.equal(b.captions, "full", `galleryBrief(${item.id}).captions defaults to 'full'`);
  }

  const def = defaultSubtitlesFor({ brief: { look: "illus-koi", aspect: "9:16" } });
  assert.equal(def.mode, "full", "defaultSubtitlesFor mode is 'full'");
  assert.equal(def.x, 50, "defaultSubtitlesFor x is 50");
  assert.equal(def.y, 70, "defaultSubtitlesFor y is 70");

  // Explicit user choices (none, key-phrases, custom y, per-scene positions) are preserved
  const explicit = defaultSubtitlesFor({ brief: { look: "illus-koi", captions: "none" } });
  assert.equal(explicit.mode, "none");
  const merged = mergeSubtitles(def, { mode: "key-phrases", y: 82, scenePositions: { "2": { x: 45, y: 64 } } }, "9:16");
  assert.equal(merged.mode, "key-phrases");
  assert.equal(merged.y, 82);
  assert.deepEqual(merged.scenePositions, { "2": { x: 45, y: 64 } });

  const workerSrc = readFileSync(join(repoRoot, "worker/src/plates.mjs"), "utf8");
  assert.match(workerSrc, /sub\.y \?\? 70/, "worker/src/plates.mjs defaults subtitle Y to 70%");

  const cssSrc = readFileSync(join(repoRoot, "frontend/app/animation-workspace.css"), "utf8");
  assert.match(cssSrc, /\.aw-subtitle\{position:absolute;left:50%;top:70%/, "animation-workspace.css defaults .aw-subtitle top to 70%");
  assert.match(cssSrc, /\.aw-bottom-scene-slot\{/, "animation-workspace.css defines dedicated .aw-bottom-scene-slot outside .aw-canvas");
});

test("Issue 9: Live comments coalesce onto in-flight initial queued/authoring scenes without blocking", () => {
  const initialAuthoringRow = {
    state: "authoring",
    gen: 1,
    rev: 0,
    bundle_digest: null,
    source_key: null,
    revise: null,
    timings: { authorStartedAt: Date.now() - 5_000 },
    updated_at: new Date()
  };
  const dec = decideRevisionApply(initialAuthoringRow, "- at 1.5 s: move balloon higher in frame");
  assert.equal(dec.action, "coalesce", "Comment applied during initial authoring coalesces instead of blocking");
  assert.equal(dec.gen, 1);
  assert.equal(dec.rev, 1);
  assert.equal(dec.notes, "- at 1.5 s: move balloon higher in frame");
});

test("Issue 13: Gfx.layer() full clearRect in bundleScene eliminates offscreen layer dirty-pixel leaks", async () => {
  const sampleCode = readFileSync(join(repoRoot, "packages/plate-engine/test/fixtures/balloon-0.ts"), "utf8");
  const bundled = await bundleScene({ look: "illus-balloon", code: sampleCode, frames: 105, aspect: "9:16" });
  assert.ok(
    bundled.html.includes(".clearRect(0,0,this.DW,this.DH)"),
    "bundleScene emits full layer clearRect(0,0,this.DW,this.DH)"
  );
  assert.ok(
    !/\.clearRect\(([A-Za-z0-9_$]+)\[0\],\1\[1\],\1\[2\]-\1\[0\],\1\[3\]-\1\[1\]\)/.test(bundled.html),
    "bundleScene has zero partial dirty-rect clearRect calls"
  );
});

test("Issues 16 & 17: frame-film SVG transform preservation on late-reveal elements (no top-left 0,0 jump) and visible narration subtitles at Y=70% across 9:16, 16:9, 1:1", async () => {
  const { withFrameFilm } = await import("../src/plan/frame-film.ts");
  const { engineVariables, fillTextBlock, hfBlockValues, scriptJson, stampCanvas } = await import("../src/plan/composition.ts");
  const { chromium } = await import("../../node_modules/playwright-core/index.mjs");

  const templateHtml = readFileSync(join(repoRoot, "worker/templates/beat-plan/index.html"), "utf8");
  const runtimeJs = readFileSync(join(repoRoot, "node_modules/hyperframes/dist/hyperframe-runtime.js"), "utf8");
  const gsapJs = readFileSync(join(repoRoot, "frontend/public/editor/gsap.min.js"), "utf8");
  const themeCss = readFileSync(join(repoRoot, "worker/themes/blue-professional.css"), "utf8");

  const frames = [
    {
      start: 0,
      end: 4,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280">
        <rect id="m2" width="720" height="1280" fill="#0d2438"/>
        <text id="title" x="60" y="140" fill="#ffffff" font-size="44">One password across 30 hops</text>
        <g id="node-1"><circle id="m8" cx="180" cy="390" r="28" fill="#1d4468"/></g>
        <g id="m38" transform="translate(360, 990)">
          <rect id="m39" x="-140" y="-30" width="280" height="60" rx="30" fill="#091b2b"/>
          <text id="m41" x="-75" y="7" fill="#ffffff" font-size="20">HOP COUNT: 30</text>
        </g>
      </svg>`,
      motion: [
        { id: "m38", kind: "move", start: 1.87, end: 2.5, from: { opacity: "0", transform: "translate(360, 1020)" } }
      ]
    },
    {
      start: 4,
      end: 11,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280">
        <rect id="m2" width="720" height="1280" fill="#0d2438"/>
        <g id="node-1" transform="translate(180, 420)"><circle id="m9" r="28" fill="#1d4468"/></g>
        <g id="node-2"><circle id="m13" cx="520" cy="520" r="24" fill="#1d4468"/></g>
        <g id="packet-card" transform="translate(180, 420)">
          <rect id="m25" x="-14" y="0" width="160" height="96" rx="8" fill="#ffffff"/>
          <text id="m29" x="-4" y="26" font-size="12" fill="#e63946">HTTP GET /</text>
        </g>
      </svg>`,
      motion: [
        { id: "packet-card", kind: "move", start: 1.86, end: 2.68, from: { opacity: "0", transform: "translate(180, 360) scale(0.2)" } },
        { id: "node-2", kind: "move", start: 3.5, end: 4.2, from: { opacity: "0", transform: "scale(0.5)" } },
        { id: "packet-card", kind: "move", start: 3.71, end: 5.7, steps: 2, from: { transform: "translate(180, 420)" } },
        { id: "packet-card", kind: "move", start: 5.97, end: 6.65, from: { transform: "translate(360, 770)" } }
      ]
    },
    {
      start: 11,
      end: 18,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280">
        <rect id="m2" width="720" height="1280" fill="#0d2438"/>
        <g id="node-1"><circle id="m7" cx="180" cy="300" r="28" fill="#143450"/></g>
        <g id="eye-icon">
          <g id="m23" transform="translate(480, 434)">
            <path id="m24" d="M -40 0 Q 0 -26 40 0 Q 0 26 -40 0 Z" fill="#0d2438" stroke="#ff5964" stroke-width="3.5"/>
            <circle id="m25" cx="0" cy="0" r="14" fill="#ff5964"/>
          </g>
          <g id="m29" transform="translate(240, 734)">
            <path id="m30" d="M -40 0 Q 0 -26 40 0 Q 0 26 -40 0 Z" fill="#0d2438" stroke="#ff5964" stroke-width="3.5"/>
            <circle id="m31" cx="0" cy="0" r="14" fill="#ff5964"/>
          </g>
        </g>
        <g id="packet-card" transform="translate(350, 640)">
          <rect id="m34" x="-140" y="-70" width="280" height="140" rx="8" fill="#fffdfa"/>
        </g>
        <g id="m48" transform="translate(360, 1190)">
          <rect id="m49" x="-240" y="-30" width="480" height="56" rx="28" fill="#143450"/>
        </g>
      </svg>`,
      motion: [
        { id: "packet-card", kind: "move", start: 1.06, end: 2.4, from: { transform: "translate(450, 500) rotate(20)" } },
        { id: "m23", kind: "move", start: 2.35, end: 3.2, from: { opacity: "0", transform: "translate(480, 434) scale(0)" } },
        { id: "m29", kind: "move", start: 2.7, end: 3.55, from: { opacity: "0", transform: "translate(240, 734) scale(0)" } },
        { id: "m48", kind: "move", start: 5.5, end: 6.5, from: { opacity: "0", transform: "translate(360, 1250)" } }
      ]
    }
  ];

  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true
  });

  try {
    for (const [aspect, vw, vh] of [
      ["9:16", 1080, 1920],
      ["16:9", 1920, 1080],
      ["1:1", 1080, 1080]
    ]) {
      const plan = {
        canvas: aspect,
        brand: { name: "Test", motion_profile: "smooth" },
        audio: { voice: { voice: "Kore", speed: 1, engine: "gemini-tts" }, music: null, captions: "full" },
        beats: [
          {
            id: "b1",
            role: "question",
            kind: "kinetic",
            keyword: "One password across 30 hops",
            on_screen: "30 public nodes",
            line: "One password crosses thirty strangers. How?",
            verb: "crosses",
            success: false,
            energy: "calm",
            ui: null,
            motion: { entry: { axis: "x", dir: 1 }, exit: { axis: "x", dir: 1 } },
            transition_out: { type: "match-cut" }
          },
          {
            id: "b2",
            role: "setup",
            kind: "kinetic",
            keyword: "Typing google.com hops route",
            on_screen: "Public routers pass your request",
            line: "Say you type google.com and your browser sends a message.",
            verb: "type",
            success: false,
            energy: "calm",
            ui: null,
            motion: { entry: { axis: "x", dir: 1 }, exit: { axis: "y", dir: 1 } },
            transition_out: { type: "push-through" }
          },
          {
            id: "b3",
            role: "step",
            kind: "kinetic",
            keyword: "Middle stops can read it",
            on_screen: "Routers 2 and 3 see the text",
            line: "But as that postcard hops through stops two and three, anyone can read it.",
            verb: "read",
            success: false,
            energy: "medium",
            ui: null,
            motion: { entry: { axis: "x", dir: 1 }, exit: { axis: "x", dir: 1 } },
            transition_out: { type: "end" }
          }
        ]
      };
      const timing = {
        total: 18,
        beats: [
          { id: "b1", start: 0, end: 4, vo: { start: 0.2, end: 3.5 }, actAt: null, successAt: null, words: null },
          { id: "b2", start: 4, end: 11, vo: { start: 4.2, end: 10.5 }, actAt: null, successAt: null, words: null },
          { id: "b3", start: 11, end: 18, vo: { start: 11.2, end: 17.5 }, actAt: null, successAt: null, words: null }
        ]
      };
      const vars = engineVariables({ plan, timing, shots: {}, brandName: "Test" });
      let html = stampCanvas(templateHtml, aspect);
      html = html.replace(
        '<script src="vendor/gsap.min.js"></script>',
        () => `<script>window.__hfVariables = ${scriptJson(vars)};</script>\n<script>${runtimeJs}</script>\n<script>${gsapJs}</script>`
      );
      html = fillTextBlock(html, hfBlockValues(plan.beats));
      html = await withFrameFilm(html, frames, "explainer");
      html = html.replace("</head>", () => `<style id="theme">${themeCss}</style></head>`);

      const page = await browser.newPage({ viewport: { width: vw, height: vh } });
      await page.setContent(html, { waitUntil: "domcontentloaded" });

      const inspect = await page.evaluate(
        ({ vw, vh }) => {
          const tl = window.__timelines.main;
          const sampleAt = (t) => {
            tl.seek(t, false);
            const activeCap = Array.from(document.querySelectorAll("#captions .cap")).find((el) => {
              const cs = getComputedStyle(el);
              return cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity) > 0.1;
            });
            const capRect = activeCap ? activeCap.getBoundingClientRect() : null;
            const boxOf = (sceneIdx, id) => {
              const layer = document.querySelectorAll("#frame-film .ff-layer")[sceneIdx];
              const el = layer?.querySelector("#" + CSS.escape(id));
              if (!el) return null;
              const r = el.getBoundingClientRect();
              return {
                cxPct: ((r.left + r.width / 2) / vw) * 100,
                cyPct: ((r.top + r.height / 2) / vh) * 100,
                transform: el.getAttribute("transform")
              };
            };
            return {
              capText: activeCap ? activeCap.textContent.trim() : null,
              capTopPct: capRect ? (capRect.top / vh) * 100 : null,
              s1_m38: boxOf(0, "m38"),
              s2_packet: boxOf(1, "packet-card"),
              s2_node2: boxOf(1, "node-2"),
              s3_m23: boxOf(2, "m23"),
              s3_m29: boxOf(2, "m29"),
              s3_m48: boxOf(2, "m48")
            };
          };
          return {
            at2_0: sampleAt(2.0),
            at2_6: sampleAt(2.6),
            at9_0: sampleAt(9.0),
            at14_0: sampleAt(14.0),
            at17_0: sampleAt(17.0),
            seekBack14_0: sampleAt(14.0),
            seekBack2_6: sampleAt(2.6)
          };
        },
        { vw, vh }
      );

      // 1. Subtitles visible at Y ≈ 70% during spoken lines in all ratios
      for (const snap of [inspect.at2_0, inspect.at9_0, inspect.at14_0]) {
        assert.ok(snap.capText && snap.capText.length > 0, `${aspect}: narration subtitle is visible`);
        assert.ok(snap.capTopPct >= 68 && snap.capTopPct <= 72, `${aspect}: subtitle sits at Y=70% (got ${snap.capTopPct}%)`);
      }

      // 2. Scene 1 #m38 (count badge) stays centered horizontally (~50%) and near lower-middle (~75-80% Y), never at top-left (0,0)
      assert.ok(inspect.at2_0.s1_m38.cxPct > 40 && inspect.at2_0.s1_m38.cxPct < 60, `${aspect}: S1 #m38 centered at 2.0s`);
      assert.ok(inspect.at2_6.s1_m38.cyPct > 65 && inspect.at2_6.s1_m38.cyPct < 88, `${aspect}: S1 #m38 at 2.6s (${inspect.at2_6.s1_m38.cyPct}%)`);

      // 3. Scene 2 #packet-card and #node-2 stay in the middle of the route at 9.0s, never at top-left (0,0)
      assert.ok(inspect.at9_0.s2_packet.cxPct > 25 && inspect.at9_0.s2_packet.cyPct > 35, `${aspect}: S2 #packet-card in route at 9.0s`);
      assert.ok(inspect.at9_0.s2_node2.cxPct > 40 && inspect.at9_0.s2_node2.cyPct > 30, `${aspect}: S2 #node-2 in route at 9.0s`);

      // 4. Scene 3 (Scene 4 in koi/http film) late-reveal eye icons (#m23, #m29) and bottom banner (#m48) stay at their nodes, never at (0,0)
      assert.ok(inspect.at14_0.s3_m23.cxPct > 45 && inspect.at14_0.s3_m23.cyPct > 25, `${aspect}: late-reveal #m23 at Node 2`);
      assert.ok(inspect.at14_0.s3_m29.cxPct > 20 && inspect.at14_0.s3_m29.cyPct > 45, `${aspect}: late-reveal #m29 at Node 3`);
      assert.ok(inspect.at17_0.s3_m48.cxPct > 40 && inspect.at17_0.s3_m48.cyPct > 80, `${aspect}: late-reveal #m48 at bottom banner`);

      // 5. Backward seek matches forward playback identically
      assert.equal(inspect.seekBack14_0.s3_m23.transform, inspect.at14_0.s3_m23.transform);
      assert.equal(inspect.seekBack2_6.s1_m38.transform, inspect.at2_6.s1_m38.transform);

      await page.close();
    }
  } finally {
    await browser.close();
  }
});
