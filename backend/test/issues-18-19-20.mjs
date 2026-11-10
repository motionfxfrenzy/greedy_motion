import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
process.env.PLANNER ??= "deterministic";

const { audioTags, withAudioContinuity } = await import("../src/plan/sound.ts");
const { enginePlan, withSubtitleStyling } = await import("../src/plan/composition.ts");
const { withFrameFilm } = await import("../src/plan/frame-film.ts");
const { hfOptionsConfig, resolveVisibleOptions } = await import("../../frontend/components/animation-workspace/logic.ts");

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");

test("Issue 18: hfOptionsConfig exposes full subtitle controls (style, size, colors, opacity, position) and enginePlan/withSubtitleStyling/withFrameFilm honor saved PlateSubtitles", async () => {
  const vis = resolveVisibleOptions(hfOptionsConfig({ voice: true, music: true }));
  assert.equal(vis.showSubtitleTab, true);
  assert.deepEqual(vis.subtitleModes, ["none", "key-phrases", "full"]);
  assert.equal(vis.subtitleStyle, true);
  assert.equal(vis.subtitleSize, true);
  assert.equal(vis.subtitleColors, true);
  assert.equal(vis.subtitleOpacity, true);
  assert.equal(vis.subtitlePosition, true);

  const plan = {
    canvas: "9:16",
    brand: { name: "Acme", motion_profile: "smooth" },
    audio: { voice: "Kore", music: "ambient", captions: "full" },
    beats: [
      {
        id: "b1",
        role: "hook",
        kind: "kinetic",
        keyword: "Route Overview",
        on_screen: "Animated route across 9 stops",
        line: "Every stop along the route updates in real time.",
        verb: null,
        success: false,
        energy: "calm",
        ui: null,
        motion: { entry: { axis: "x", dir: -1 }, exit: { axis: "x", dir: 1 } },
        transition_out: { type: "j-cut" }
      }
    ]
  };
  const timing = {
    total: 5,
    warnings: [],
    beats: [
      {
        id: "b1",
        start: 0,
        end: 5,
        vo: { start: 0.2, end: 4.5 },
        actAt: null,
        successAt: null,
        words: null
      }
    ]
  };
  const customSubtitles = {
    mode: "key-phrases",
    style: "cinema",
    size: 130,
    opacity: 85,
    color: "#fef08a",
    bgColor: "#090b10",
    x: 50,
    y: 24,
    scenePositions: { "0": { x: 42, y: 18 } }
  };

  const ep = enginePlan(plan, timing, {}, "clean", customSubtitles);
  assert.equal(ep.captions, "key-phrases");
  assert.deepEqual(ep.subtitles, customSubtitles);

  const baseHtml = `<!doctype html><html><head></head><body><div id="root" data-width="1080" data-height="1920"><div id="stage"></div><div id="captions" data-layout-allow-overlap></div></div></body></html>`;
  const filmHtml = await withFrameFilm(baseHtml, [
    { start: 0, end: 5, svg: '<svg viewBox="0 0 1080 1920"><rect width="1080" height="1920" fill="#0b0d12"/></svg>', motion: [] }
  ]);
  assert.ok(!filmHtml.includes("bottom: auto !important"), "withFrameFilm must not lock bottom with !important");
  assert.ok(filmHtml.includes("#captions .cap { top: 70%; bottom: auto; }"), "withFrameFilm keeps 70% as non-!important default");

  const styledHtml = withSubtitleStyling(filmHtml, customSubtitles);
  assert.ok(styledHtml.includes('id="bp-subtitles"'), "withSubtitleStyling injects bp-subtitles script");
});

test("Issue 19: Create a video chooser modal with Create a blank project + Styles gallery and customer-facing Styles wording", () => {
  const appShell = readFileSync(join(ROOT, "frontend/components/app-shell.tsx"), "utf8");
  assert.ok(appShell.includes('{ id: "templates", label: "Styles", href: "/templates" }'), "Top nav renames Templates to Styles while keeping /templates href");

  const gallery = readFileSync(join(ROOT, "frontend/components/template-gallery.tsx"), "utf8");
  assert.ok(gallery.includes("<h1>Styles</h1>") && gallery.includes("<h2>Styles</h2>"), "Gallery uses Styles heading in standalone and embedded modal modes");
  assert.ok(gallery.includes('placeholder="Search styles"'), "Gallery search placeholder uses Search styles");
  assert.ok(gallery.includes("Styles could not be loaded."), "Gallery error message uses Styles");

  const studio = readFileSync(join(ROOT, "frontend/components/studio.tsx"), "utf8");
  assert.ok(studio.includes('id="create-video-modal-title"'), "Studio renders Create a video chooser modal");
  assert.ok(studio.includes("Create a blank project"), "Chooser modal includes Create a blank project action");
  assert.ok(studio.includes("<TemplatesPage\n          embedded"), "Chooser modal embeds the Styles gallery");
  assert.ok(studio.includes("<h2>Start from a style</h2>") && studio.includes("Browse all styles"), "Empty state shelf uses Styles wording");

  assert.equal(existsSync(join(ROOT, "frontend/app/styles/page.tsx")), true, "/styles route alias exists");
});

test("Issue 20: audioTags sets preload=auto and withAudioContinuity injects blob pre-buffering, micro-drift guard, and pause/seek rewind", () => {
  const tags = audioTags([
    { id: "vo-b1", src: "/api/preview/plans/p1/audio/vo/1.wav", start: 0.2, duration: 3.56, track: 12, volume: 1 },
    { id: "vo-b2", src: "/api/preview/plans/p1/audio/vo/2.wav", start: 4.203, duration: 5.19, track: 12, volume: 1 }
  ]);
  assert.ok(tags.includes('id="vo-b1"') && tags.includes('preload="auto"'), "audioTags includes preload=\"auto\" on every track");

  const html = withAudioContinuity(`<!doctype html><html><body><div id="root">${tags}</div></body></html>`);
  assert.ok(html.includes('id="hf-audio-continuity"'), "withAudioContinuity injects hf-audio-continuity script");
  assert.ok(html.includes("URL.createObjectURL"), "withAudioContinuity pre-buffers audio tracks into Blob URLs");
  assert.ok(html.includes("GuardThreshold = 0.35"), "withAudioContinuity guards against micro-drift seeks while playing");
  assert.ok(html.includes("scheduleRewind"), "withAudioContinuity rewinds paused clips after their window for repeated continuous playback");
});

test("What-If and How-Does curated script writer templates, A-Roll/B-Roll visual tags, and curated SVG style guide", async () => {
  const { findGalleryTemplate, inferScriptTemplate, hookWordLimit } = await import("@videosaas/contracts");
  const { systemBlocks, WHAT_IF_VOICE, HOW_DOES_VOICE } = await import("../src/plan/script-writer.ts");
  const { CURATED_THOUGHT_EXPERIMENT_STYLE_GUIDE } = await import("../src/plan/frame-sketch.ts");

  assert.equal(inferScriptTemplate({ text: "What if you could rewind time by exactly 10 seconds?" }), "what-if");
  assert.equal(inferScriptTemplate({ text: "Imagine if gravity turned off for 5 seconds every noon." }), "what-if");
  assert.equal(inferScriptTemplate({ text: "How does active noise cancellation silence a jet engine?" }), "how-does");
  assert.equal(inferScriptTemplate({ text: "What happens when you swipe a credit card under the hood?" }), "how-does");
  assert.equal(hookWordLimit("balanced", "what-if"), 16);
  assert.equal(hookWordLimit("balanced", "how-does"), 16);

  const whatIfTpl = findGalleryTemplate("what-if-story-explainer");
  const howDoesTpl = findGalleryTemplate("how-does-system-explainer");
  assert.ok(whatIfTpl && whatIfTpl.name === "What-If Thought Experiment");
  assert.ok(howDoesTpl && howDoesTpl.name === "How-Does Mechanism Explainer");

  const whatIfBlocks = systemBlocks({
    brief: {
      scriptMode: "problem",
      text: "What if you could rewind time by 10 seconds?",
      durationSeconds: 90,
      durationMode: "script",
      aspect: "16:9",
      motionProfile: "smooth",
      pace: "balanced",
      audio: { mode: "both", voice: "Kore" },
      captions: "full",
      template: null,
      theme: "bold",
      look: "clean"
    },
    context: { brandName: "", screenshots: [], productNamed: false }
  });
  assert.equal(whatIfBlocks[1]?.text, WHAT_IF_VOICE);
  assert.match(WHAT_IF_VOICE, /\[A-ROLL: WIDE SCENE\]/);
  assert.match(WHAT_IF_VOICE, /\[A-ROLL: CLOSE-UP\]/);
  assert.match(WHAT_IF_VOICE, /\[B-ROLL: LINE GRAPH\]/);
  assert.match(WHAT_IF_VOICE, /\[B-ROLL: BAR COMPARISON\]/);
  assert.match(WHAT_IF_VOICE, /\[B-ROLL: DUAL CLOCK\]/);
  assert.match(WHAT_IF_VOICE, /3-Part Science \/ Psychology Sandwiches/);

  const howDoesBlocks = systemBlocks({
    brief: {
      scriptMode: "problem",
      text: "How does a DNS lookup work under the hood?",
      durationSeconds: 60,
      durationMode: "script",
      aspect: "16:9",
      motionProfile: "smooth",
      pace: "balanced",
      audio: { mode: "both", voice: "Kore" },
      captions: "full",
      template: null,
      theme: "cobalt-grid",
      look: "clean"
    },
    context: { brandName: "", screenshots: [], productNamed: false }
  });
  assert.equal(howDoesBlocks[1]?.text, HOW_DOES_VOICE);
  assert.match(CURATED_THOUGHT_EXPERIMENT_STYLE_GUIDE, /id="character"/);
  assert.match(CURATED_THOUGHT_EXPERIMENT_STYLE_GUIDE, /id="room-backdrop"/);
});
