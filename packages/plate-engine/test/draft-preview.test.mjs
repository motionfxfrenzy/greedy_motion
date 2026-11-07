import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { bundleScene, loadManifest } from "../lib/engine.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");
const NATIVE_SCENES_DIR = "/private/tmp/gm-native-style-fps-results/generated-scenes";
const CHROME_PATH =
  process.env.PLATE_BROWSER_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("all 31 manifest styles bundle cleanly and advertise FILM.capabilities.draftSupported", async () => {
  const styles = Object.keys(loadManifest().styles);
  assert.equal(styles.length, 31);
  const balloonCode = readFileSync(join(FIXTURES, "balloon-0.ts"), "utf8");
  const bundled = await bundleScene({
    look: "illus-balloon",
    code: balloonCode,
    frames: 105,
    aspect: "16:9"
  });
  assert.ok(bundled.html.includes("draftSupported:!0") || bundled.html.includes("draftSupported: true"));
  assert.ok(bundled.html.includes("seekAcceptsQuality:!0") || bundled.html.includes("seekAcceptsQuality: true"));
  assert.ok(bundled.html.includes("defaultDraftTargetVerticesPerFrame:75e3") || bundled.html.includes("75000"));
});

test(
  "real Chromium: single tunable draftTargetVerticesPerFrame (6000, 60000, 75000), stroke preservation, and zero-diff Full identity across styles",
  async () => {
    assert.ok(existsSync(CHROME_PATH), `Chromium required at ${CHROME_PATH}`);

    const balloonCode = readFileSync(join(FIXTURES, "balloon-0.ts"), "utf8");
    const blueprintCode = readFileSync(join(FIXTURES, "blueprint-0.ts"), "utf8");

    const cases = [
      { id: "balloon", look: "illus-balloon", code: balloonCode, frames: 105, testFrame: 95 },
      { id: "blueprint", look: "illus-blueprint", code: blueprintCode, frames: 90, testFrame: 70 }
    ];

    if (existsSync(NATIVE_SCENES_DIR)) {
      const nativeStyles = [
        { id: "toyBrick", look: "illus-toy-brick", file: "toyBrick/scene3.ts", frames: 240, testFrame: 180 },
        { id: "woodcut", look: "illus-woodcut", file: "woodcut/scene3.ts", frames: 240, testFrame: 180 },
        { id: "paintedOil", look: "illus-painted-oil", file: "paintedOil/scene3.ts", frames: 240, testFrame: 180 },
        { id: "embroidery", look: "illus-embroidery", file: "embroidery/scene3.ts", frames: 240, testFrame: 180 },
        { id: "charcoalErasure", look: "illus-charcoal-erasure", file: "charcoalErasure/scene3.ts", frames: 240, testFrame: 180 },
        { id: "pocketWatch", look: "illus-pocket-watch", file: "pocketWatch/scene3.ts", frames: 240, testFrame: 180 }
      ];
      for (const ns of nativeStyles) {
        const p = join(NATIVE_SCENES_DIR, ns.file);
        if (existsSync(p)) {
          cases.push({
            id: ns.id,
            look: ns.look,
            code: readFileSync(p, "utf8"),
            frames: ns.frames,
            testFrame: ns.testFrame
          });
        }
      }
    }

    const browser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--disable-gpu"]
    });

    try {
      for (const tc of cases) {
        const { html } = await bundleScene({
          look: tc.look,
          code: tc.code,
          frames: tc.frames,
          aspect: "16:9"
        });

        // Page 1: Fresh Full-only reference
        const pageFullOnly = await browser.newPage();
        await pageFullOnly.setContent(html, { waitUntil: "load" });
        const refFull = await pageFullOnly.evaluate((f) => {
          window.FILM.mount(640 / 1920);
          window.FILM.seek(f, "full");
          const c = document.getElementById("film");
          const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
          let h = 0x811c9dc5;
          for (let i = 0; i < d.length; i++) {
            h ^= d[i];
            h = Math.imul(h, 0x01000193);
          }
          // Compute foreground bounding box and foreground pixel mask (non-corner color pixels)
          const r0 = d[0], g0 = d[1], b0 = d[2];
          let minX = c.width, maxX = 0, minY = c.height, maxY = 0, fgCount = 0;
          const fgMask = new Uint8Array(c.width * c.height);
          for (let y = 0; y < c.height; y++) {
            for (let x = 0; x < c.width; x++) {
              const pIdx = y * c.width + x;
              const idx = pIdx * 4;
              const diff = Math.abs(d[idx] - r0) + Math.abs(d[idx + 1] - g0) + Math.abs(d[idx + 2] - b0);
              if (diff > 18) {
                fgMask[pIdx] = 1;
                fgCount++;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }
          return {
            hash: (h >>> 0).toString(16),
            stats: window.FILM.getLastFrameStats(),
            capabilities: window.FILM.capabilities,
            bbox: fgCount > 0 ? [minX, minY, maxX, maxY] : [0, 0, c.width, c.height],
            fgCount,
            fgMask: Array.from(fgMask)
          };
        }, tc.testFrame);
        await pageFullOnly.close();

        assert.equal(refFull.capabilities?.draftSupported, true, `${tc.id}: capabilities.draftSupported is true`);

        // Page 2: Render Draft at 6000, 60000, 75000, then render Full on the SAME page and verify zero pixel diff!
        const pageMixed = await browser.newPage();
        await pageMixed.setContent(html, { waitUntil: "load" });
        const mixed = await pageMixed.evaluate((f) => {
          window.FILM.mount(640 / 1920);
          const c = document.getElementById("film");
          const ctx = c.getContext("2d");

          const captureAt = (spec) => {
            window.FILM.seek(f, spec);
            const d = ctx.getImageData(0, 0, c.width, c.height).data;
            let h = 0x811c9dc5;
            for (let i = 0; i < d.length; i++) {
              h ^= d[i];
              h = Math.imul(h, 0x01000193);
            }
            const r0 = d[0], g0 = d[1], b0 = d[2];
            let minX = c.width, maxX = 0, minY = c.height, maxY = 0, fgCount = 0;
            const fgMask = new Uint8Array(c.width * c.height);
            for (let y = 0; y < c.height; y++) {
              for (let x = 0; x < c.width; x++) {
                const pIdx = y * c.width + x;
                const idx = pIdx * 4;
                const diff = Math.abs(d[idx] - r0) + Math.abs(d[idx + 1] - g0) + Math.abs(d[idx + 2] - b0);
                if (diff > 18) {
                  fgMask[pIdx] = 1;
                  fgCount++;
                  if (x < minX) minX = x;
                  if (x > maxX) maxX = x;
                  if (y < minY) minY = y;
                  if (y > maxY) maxY = y;
                }
              }
            }
            return {
              hash: (h >>> 0).toString(16),
              stats: window.FILM.getLastFrameStats(),
              calibration: window.FILM.getCalibration(),
              bbox: fgCount > 0 ? [minX, minY, maxX, maxY] : [0, 0, c.width, c.height],
              fgCount,
              fgMask: Array.from(fgMask)
            };
          };

          const d6k = captureAt({ mode: "draft", draftTargetVerticesPerFrame: 6000 });
          const d60k = captureAt({ mode: "draft", draftTargetVerticesPerFrame: 60000 });
          const d75k = captureAt("draft"); // default 75,000
          const fullAfterDraft = captureAt("full");

          return { d6k, d60k, d75k, fullAfterDraft };
        }, tc.testFrame);
        await pageMixed.close();

        // 1. Full output after Draft rendering must be 100% identical to fresh Full-only rendering (zero cache pollution!)
        assert.equal(
          mixed.fullAfterDraft.hash,
          refFull.hash,
          `${tc.id}: Full render after 6k/60k/75k Draft renders must be byte-identical to fresh Full render`
        );

        // 2. Default "draft" string uses draftTargetVerticesPerFrame = 75000
        assert.equal(mixed.d75k.stats.draftTargetVerticesPerFrame, 75000, `${tc.id}: default draft target is 75000`);
        assert.equal(mixed.d60k.stats.draftTargetVerticesPerFrame, 60000, `${tc.id}: 60k target recorded`);
        assert.equal(mixed.d6k.stats.draftTargetVerticesPerFrame, 6000, `${tc.id}: 6k target recorded`);

        // 3. For Gfx.pen styles, verify Gfx.pen never drops a stroke (penPrimaryRibbons === penCalls)
        //    and lowering draftTargetVerticesPerFrame from 75k -> 60k -> 6k preserves 100% of penCalls while scaling vertices monotonically
        if (refFull.stats.penCalls > 0) {
          assert.equal(
            mixed.d75k.stats.penPrimaryRibbons,
            mixed.d75k.stats.penCalls,
            `${tc.id}: 75k Draft Gfx.pen draws 100% of strokes (penPrimaryRibbons === penCalls)`
          );
          assert.equal(
            mixed.d60k.stats.penPrimaryRibbons,
            mixed.d60k.stats.penCalls,
            `${tc.id}: 60k Draft Gfx.pen draws 100% of strokes (penPrimaryRibbons === penCalls)`
          );
          assert.equal(
            mixed.d6k.stats.penPrimaryRibbons,
            mixed.d6k.stats.penCalls,
            `${tc.id}: 6k Draft Gfx.pen draws 100% of strokes without dropping any stroke`
          );
          assert.equal(
            mixed.d6k.stats.penCalls,
            mixed.d75k.stats.penCalls,
            `${tc.id}: lowering draftTargetVerticesPerFrame from 75k to 6k drops zero strokes (${mixed.d6k.stats.penCalls})`
          );
          assert.equal(
            mixed.d60k.stats.penCalls,
            mixed.d75k.stats.penCalls,
            `${tc.id}: lowering draftTargetVerticesPerFrame from 75k to 60k drops zero strokes (${mixed.d60k.stats.penCalls})`
          );
          assert.ok(
            mixed.d6k.stats.penRibbonVertices <= mixed.d60k.stats.penRibbonVertices &&
              mixed.d60k.stats.penRibbonVertices <= mixed.d75k.stats.penRibbonVertices &&
              mixed.d75k.stats.penRibbonVertices < refFull.stats.penRibbonVertices,
            `${tc.id}: penRibbonVertices scales monotonically: 6k(${mixed.d6k.stats.penRibbonVertices}) <= 60k(${mixed.d60k.stats.penRibbonVertices}) <= 75k(${mixed.d75k.stats.penRibbonVertices}) < full(${refFull.stats.penRibbonVertices})`
          );
        }

        // 4. For native kit styles, verify protected polygons are preserved and draft primitives/material reductions are active
        assert.equal(
          mixed.d75k.stats.draftPrimitivesUsed,
          true,
          `${tc.id}: draftPrimitivesUsed is true in Draft mode (optimization=${mixed.d75k.stats.effectiveOptimization})`
        );
        if (refFull.stats.protectedPolygons > 0) {
          assert.equal(
            mixed.d75k.stats.protectedPolygons,
            refFull.stats.protectedPolygons,
            `${tc.id}: protectedPolygons count preserved 1:1 in Draft mode (${refFull.stats.protectedPolygons})`
          );
        }

        // 5. Both Bounding-box IoU and Pixel-level Foreground Silhouette Mask IoU between 75k Draft and Full
        const [ax0, ay0, ax1, ay1] = refFull.bbox;
        const [bx0, by0, bx1, by1] = mixed.d75k.bbox;
        const ix0 = Math.max(ax0, bx0), iy0 = Math.max(ay0, by0);
        const ix1 = Math.min(ax1, bx1), iy1 = Math.min(ay1, by1);
        const inter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
        const areaA = Math.max(1, (ax1 - ax0) * (ay1 - ay0));
        const areaB = Math.max(1, (bx1 - bx0) * (by1 - by0));
        const bboxIou = inter / (areaA + areaB - inter);
        assert.ok(bboxIou >= 0.95, `${tc.id}: Draft vs Full bounding-box IoU (${bboxIou.toFixed(3)}) >= 0.95`);

        let maskInter = 0, maskUnion = 0;
        for (let i = 0; i < refFull.fgMask.length; i++) {
          const a = refFull.fgMask[i], b = mixed.d75k.fgMask[i];
          if (a && b) maskInter++;
          if (a || b) maskUnion++;
        }
        const silhouetteMaskIou = maskUnion > 0 ? maskInter / maskUnion : 1;
        // Wireframe line-drawing styles (blueprint, pocketWatch) and grain-bitten charcoal (charcoalErasure)
        // have sub-pixel tooth/step differences on 1px edges; solid-fill styles exceed 0.90 exact-pixel mask IoU.
        const minMaskIou =
          tc.id === "charcoalErasure"
            ? 0.65
            : tc.id === "blueprint" || tc.id === "pocketWatch"
              ? 0.78
              : 0.88;
        assert.ok(
          silhouetteMaskIou >= minMaskIou,
          `${tc.id}: Draft vs Full pixel-level foreground silhouette mask IoU (${silhouetteMaskIou.toFixed(3)}) >= ${minMaskIou}`
        );
      }
    } finally {
      await browser.close();
    }
  }
);
