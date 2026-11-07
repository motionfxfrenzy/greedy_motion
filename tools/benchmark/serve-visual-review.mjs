import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

const RESULTS_DIR = "/private/tmp/gm-draft-preview-integration-results";
const VISUAL_DIR = join(RESULTS_DIR, "visual");
const BENCH_DIR = join(RESULTS_DIR, "benchmarks");
const SUMMARY_PATH = join(BENCH_DIR, "visual-crops-and-masks-summary.json");

function calcDerivedDrawRateFps(p50Ms) {
  const n = Number(p50Ms);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return (Math.round((1000 / n) * 10) / 10).toFixed(1);
}

function target30BadgeHtml(p50Ms) {
  const n = Number(p50Ms);
  if (!Number.isFinite(n) || n <= 0) return "";
  const meets30 = n <= 33.33;
  const fps = calcDerivedDrawRateFps(n);
  return meets30
    ? `<span style="background:#14532d;color:#bbf7d0;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;border:1px solid #166534;">${fps} FPS derived draw rate (&le; 33.3 ms 30fps target)</span>`
    : `<span style="background:#78350f;color:#fde68a;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;border:1px solid #92400e;">${fps} FPS derived draw rate (&gt; 33.3 ms 30fps target &middot; buffers locally)</span>`;
}

const OWNER_REVIEW_STATUS_BY_STYLE = {
  balloon: {
    text: "Owner Review: 75k Approved · 6k & 4k Rejected · 40k Awaits Review",
    bg: "#1e3a8a",
    fg: "#dbeafe"
  },
  stipple: {
    text: "Owner Review: 40k & 75k Await Review",
    bg: "#854d0e",
    fg: "#fef9c3"
  },
  halftone: {
    text: "Owner Review: 40k & 75k Await Review",
    bg: "#854d0e",
    fg: "#fef9c3"
  },
  mellan: {
    text: "Owner Review: 4k & Pitch 75% Accepted · Pitch 75% + 4k arcStep Awaiting Review",
    bg: "#166534",
    fg: "#dcfce7"
  },
  charcoalErasure: {
    text: "Owner Review: 6k Acceptable (viewed comparison still/crop)",
    bg: "#166534",
    fg: "#dcfce7"
  },
  blueprint: {
    text: "Owner Review: 4k OR 6k Acceptable — Final Choice Pending",
    bg: "#166534",
    fg: "#dcfce7"
  },
  pocketWatch: {
    text: "Owner Review: 4k OR 6k Acceptable — Final Choice Pending",
    bg: "#166534",
    fg: "#dcfce7"
  },
  paintedOil: {
    text: "Owner Review: 75k Approved · 6k Acceptable (viewed comparison)",
    bg: "#166534",
    fg: "#dcfce7"
  },
  embroidery: {
    text: "Owner Review: 75k Approved · 4k OR 6k Acceptable — Final Choice Pending",
    bg: "#166534",
    fg: "#dcfce7"
  }
};

export function generateVisualReviewHtml() {
  const summary = JSON.parse(readFileSync(SUMMARY_PATH, "utf8"));

  const rowsHtml = summary.cases
    .map((c) => {
      const has40k = Boolean(c.include40k && c.draft40kStats && c.gpuTimings?.d40k);
      const hasSub4k = Boolean(c.includeSub4k && c.draft2kStats && c.gpuTimings?.d2k);
      const hasPitchExp = Boolean(c.includeSub4k && c.draftPitch75Stats && c.gpuTimings?.dpitch75);

      const statusInfo = OWNER_REVIEW_STATUS_BY_STYLE[c.id] || {
        text: "Pending Owner Visual Review",
        bg: "#854d0e",
        fg: "#fef9c3"
      };
      const badge = `<span style="background:${statusInfo.bg};color:${statusInfo.fg};padding:2px 8px;border-radius:99px;font-size:12px;margin-left:8px;">${statusInfo.text}</span>`;

      const scope40kBadge = has40k
        ? `<span class="scope-40k-badge" style="background:#1e40af;color:#dbeafe;padding:2px 8px;border-radius:99px;font-size:11px;margin-left:6px;border:1px solid #3b82f6;">Draft 40k Measured${hasSub4k ? " + 2k/1k/500 + Pitch 75%/50%/25%" : ""}</span>`
        : `<span class="scope-40k-badge" style="background:#1f2937;color:#9ca3af;padding:2px 8px;border-radius:99px;font-size:11px;margin-left:6px;border:1px solid #374151;">40k / 2k / 1k / 500 Not Tested on This Style</span>`;

      const profiles = [
        ["Full (Reference)", "full", c.gpuTimings?.full, c.swColdFirstSeekMs?.full, c.fullStats, null, "100% turns (pitch=6.2px, arcStep=1.4px)"],
        ["Draft 75k (Default)", "draft-75k", c.gpuTimings?.d75k, c.swColdFirstSeekMs?.d75k, c.draft75kStats, c.metrics75k, "target=75,000"],
        ["Draft 60k", "draft-60k", c.gpuTimings?.d60k, c.swColdFirstSeekMs?.d60k, c.draft60kStats, c.metrics60k, "target=60,000"],
        ...(has40k
          ? [["Draft 40k", "draft-40k", c.gpuTimings?.d40k, c.swColdFirstSeekMs?.d40k, c.draft40kStats, c.metrics40k, "target=40,000"]]
          : []),
        ["Draft 6k", "draft-6k", c.gpuTimings?.d6k, c.swColdFirstSeekMs?.d6k, c.draft6kStats, c.metrics6k, "target=6,000"],
        ["Draft 4k", "draft-4k", c.gpuTimings?.d4k, c.swColdFirstSeekMs?.d4k, c.draft4kStats, c.metrics4k, "target=4,000"],
        ...(hasSub4k
          ? [
              ["Draft 2k (arcStep)", "draft-2k", c.gpuTimings?.d2k, c.swColdFirstSeekMs?.d2k, c.draft2kStats, c.metrics2k, "target=2,000 (arcStep=6.02px, 100% turns)"],
              ["Draft 1k (arcStep)", "draft-1k", c.gpuTimings?.d1k, c.swColdFirstSeekMs?.d1k, c.draft1kStats, c.metrics1k, "target=1,000 (arcStep=9.46px, 100% turns)"],
              ["Draft 500 (arcStep)", "draft-500", c.gpuTimings?.d500, c.swColdFirstSeekMs?.d500, c.draft500Stats, c.metrics500, "target=500 (arcStep=14.86px, 100% turns)"]
            ]
          : []),
        ...(hasPitchExp
          ? [
              ["Pitch 75% Turns", "draft-pitch75", c.gpuTimings?.dpitch75, c.swColdFirstSeekMs?.dpitch75, c.draftPitch75Stats, c.metricsPitch75, "effPitch=8.27px (75% turns, arcStep=1.62px)"],
              ...(c.draftPitch75_4kStats && c.gpuTimings?.dpitch75_4k
                ? [["Pitch 75% + 4k arcStep", "draft-pitch75-4k", c.gpuTimings?.dpitch75_4k, c.swColdFirstSeekMs?.dpitch75_4k, c.draftPitch75_4kStats, c.metricsPitch75_4k, "effPitch=8.27px (75% turns) + 4k arcStep=3.84px"]]
                : []),
              ["Pitch 50% Turns", "draft-pitch50", c.gpuTimings?.dpitch50, c.swColdFirstSeekMs?.dpitch50, c.draftPitch50Stats, c.metricsPitch50, "effPitch=12.40px (50% turns, arcStep=1.98px)"],
              ["Pitch 25% Turns", "draft-pitch25", c.gpuTimings?.dpitch25, c.swColdFirstSeekMs?.dpitch25, c.draftPitch25Stats, c.metricsPitch25, "effPitch=24.80px (25% turns, arcStep=2.80px)"]
            ]
          : [])
      ];

      const makeMetaEntry = (label, gt, st, m, note = "", isRef = false) => {
        const advP50 = gt?.gpuAdvancingP50Ms ?? "—";
        const advP95 = gt?.gpuAdvancingP95Ms ?? "—";
        const advMax = gt?.gpuAdvancingMaxMs ?? "—";
        const capFps = calcDerivedDrawRateFps(advP50);
        const meets30 = Number.isFinite(Number(advP50)) && Number(advP50) <= 33.33;
        return {
          label,
          note,
          targetB: st?.draftTargetVerticesPerFrame ?? 0,
          verts: st?.totalSceneVertices ?? 0,
          exceededFloor: Boolean(st?.budgetExceededByFloor),
          advP50,
          advP95,
          advMax,
          capFps,
          meets30,
          coldMs: gt?.gpuColdFirstSeekMedianMs ?? "—",
          warmMs: gt?.gpuWarmSameFrameMedianMs ?? "—",
          bmMs: gt?.gpuWorkerFrameReadyMedianMs ?? "—",
          psnr: isRef ? "Ref (∞)" : `${m?.psnrDb ?? "—"} dB`,
          exactIou: isRef ? "1.000" : m?.exactPixelMaskIou ?? "—",
          dilIou: isRef ? "1.000" : m?.dilated1pxMaskIou ?? "—",
          cov: isRef ? "1.000" : m?.coverageRatio ?? "—"
        };
      };

      const profileMetaObj = {
        full: makeMetaEntry("Full (Reference)", c.gpuTimings?.full, c.fullStats, null, "100% turns", true),
        "draft-75k": makeMetaEntry("Draft 75k (Default)", c.gpuTimings?.d75k, c.draft75kStats, c.metrics75k, "target=75k"),
        "draft-60k": makeMetaEntry("Draft 60k", c.gpuTimings?.d60k, c.draft60kStats, c.metrics60k, "target=60k"),
        ...(has40k
          ? { "draft-40k": makeMetaEntry("Draft 40k", c.gpuTimings?.d40k, c.draft40kStats, c.metrics40k, "target=40k") }
          : {}),
        "draft-6k": makeMetaEntry("Draft 6k", c.gpuTimings?.d6k, c.draft6kStats, c.metrics6k, "target=6k"),
        "draft-4k": makeMetaEntry("Draft 4k", c.gpuTimings?.d4k, c.draft4kStats, c.metrics4k, "target=4k"),
        ...(hasSub4k
          ? {
              "draft-2k": makeMetaEntry("Draft 2k (arcStep)", c.gpuTimings?.d2k, c.draft2kStats, c.metrics2k, "target=2k · arcStep=6.02px"),
              "draft-1k": makeMetaEntry("Draft 1k (arcStep)", c.gpuTimings?.d1k, c.draft1kStats, c.metrics1k, "target=1k · arcStep=9.46px"),
              "draft-500": makeMetaEntry("Draft 500 (arcStep)", c.gpuTimings?.d500, c.draft500Stats, c.metrics500, "target=500 · arcStep=14.86px")
            }
          : {}),
        ...(hasPitchExp
          ? {
              "draft-pitch75": makeMetaEntry("Pitch 75% Turns", c.gpuTimings?.dpitch75, c.draftPitch75Stats, c.metricsPitch75, "effPitch=8.27px (75% turns)"),
              ...(c.draftPitch75_4kStats && c.gpuTimings?.dpitch75_4k
                ? { "draft-pitch75-4k": makeMetaEntry("Pitch 75% + 4k arcStep", c.gpuTimings?.dpitch75_4k, c.draftPitch75_4kStats, c.metricsPitch75_4k, "effPitch=8.27px + 4k arcStep=3.84px") }
                : {}),
              "draft-pitch50": makeMetaEntry("Pitch 50% Turns", c.gpuTimings?.dpitch50, c.draftPitch50Stats, c.metricsPitch50, "effPitch=12.40px (50% turns)"),
              "draft-pitch25": makeMetaEntry("Pitch 25% Turns", c.gpuTimings?.dpitch25, c.draftPitch25Stats, c.metricsPitch25, "effPitch=24.80px (25% turns)")
            }
          : {})
      };

      const profileMetaJson = JSON.stringify(profileMetaObj).replace(/'/g, "&#39;");
      const vertsHeaderLabel = hasSub4k
        ? "Actual Vertices (Full / 75k / 60k / 40k / 6k / 4k / 2k / 1k / 500 / Pitch75% / Pitch75%+4k / Pitch50% / Pitch25%)"
        : has40k
          ? "Actual Vertices (Full / 75k / 60k / 40k / 6k / 4k)"
          : "Actual Vertices (Full / 75k / 60k / 6k / 4k)";
      const vertsHeaderValues = hasSub4k
        ? `${c.fullStats?.totalSceneVertices ?? 0} / ${c.draft75kStats?.totalSceneVertices ?? 0} / ${c.draft60kStats?.totalSceneVertices ?? 0} / ${c.draft40kStats?.totalSceneVertices ?? 0} / ${c.draft6kStats?.totalSceneVertices ?? 0} / ${c.draft4kStats?.totalSceneVertices ?? 0} / ${c.draft2kStats?.totalSceneVertices ?? 0} / ${c.draft1kStats?.totalSceneVertices ?? 0} / ${c.draft500Stats?.totalSceneVertices ?? 0} / ${c.draftPitch75Stats?.totalSceneVertices ?? 0} / ${c.draftPitch75_4kStats?.totalSceneVertices ?? 0} / ${c.draftPitch50Stats?.totalSceneVertices ?? 0} / ${c.draftPitch25Stats?.totalSceneVertices ?? 0}`
        : has40k
          ? `${c.fullStats?.totalSceneVertices ?? 0} / ${c.draft75kStats?.totalSceneVertices ?? 0} / ${c.draft60kStats?.totalSceneVertices ?? 0} / ${c.draft40kStats?.totalSceneVertices ?? 0} / ${c.draft6kStats?.totalSceneVertices ?? 0} / ${c.draft4kStats?.totalSceneVertices ?? 0}`
          : `${c.fullStats?.totalSceneVertices ?? 0} / ${c.draft75kStats?.totalSceneVertices ?? 0} / ${c.draft60kStats?.totalSceneVertices ?? 0} / ${c.draft6kStats?.totalSceneVertices ?? 0} / ${c.draft4kStats?.totalSceneVertices ?? 0}`;

      const d75Meta = profileMetaObj["draft-75k"];
      const fullMeta = profileMetaObj.full;

      return `
      <section id="section-${c.id}" class="style-card" data-style-id="${c.id}" data-has-40k="${has40k ? "1" : "0"}" data-has-sub4k="${hasSub4k ? "1" : "0"}" data-profile-meta='${profileMetaJson}' style="background:#161922;border:1px solid ${has40k ? "#3b82f6" : "#2a2f3d"};border-radius:10px;padding:18px;margin-bottom:24px;">
        <h2 style="margin:0 0 6px 0;font-size:18px;color:#f8fafc;">${c.id} (<code>${c.look}</code>, frame ${c.frame}) ${badge} ${scope40kBadge}</h2>
        <p style="margin:0 0 12px 0;color:#94a3b8;font-size:13px;">
          <b>1:1 Crop Region:</b> ${c.crop.label} (${c.crop.w}×${c.crop.h} at ${c.crop.x},${c.crop.y}) ·
          <b>${vertsHeaderLabel}:</b>
          <code>${vertsHeaderValues}</code>
        </p>

        <!-- INTERACTIVE BEFORE / AFTER COMPARISON SLIDER -->
        <div style="background:#0f1117;border:1px solid #334155;border-radius:8px;padding:14px;margin-bottom:16px;">
          <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <span style="font-size:13px;font-weight:600;color:#f8fafc;">Interactive Split Slider:</span>
              <label style="font-size:12px;color:#94a3b8;">
                Left (Base):
                <select class="slider-left-select" data-style="${c.id}" style="background:#1e293b;color:#f8fafc;border:1px solid #475569;border-radius:4px;padding:3px 8px;font-size:12px;margin-left:4px;">
                  <option value="full" selected>Full (Reference)</option>
                  <option value="draft-75k">Draft 75k (Default)</option>
                  <option value="draft-60k">Draft 60k</option>
                  ${has40k ? `<option value="draft-40k">Draft 40k</option>` : ""}
                  <option value="draft-6k">Draft 6k</option>
                  <option value="draft-4k">Draft 4k</option>
                  ${
                    hasSub4k
                      ? `<option value="draft-2k">Draft 2k (arcStep)</option>
                  <option value="draft-1k">Draft 1k (arcStep)</option>
                  <option value="draft-500">Draft 500 (arcStep)</option>`
                      : ""
                  }
                  ${
                    hasPitchExp
                      ? `<option value="draft-pitch75">Pitch 75% Turns (8.27px)</option>
                  <option value="draft-pitch75-4k">Pitch 75% + 4k arcStep (8.27px, 3.84px)</option>
                  <option value="draft-pitch50">Pitch 50% Turns (12.40px)</option>
                  <option value="draft-pitch25">Pitch 25% Turns (24.80px)</option>`
                      : ""
                  }
                </select>
              </label>
              <span style="color:#64748b;font-size:12px;">vs</span>
              <div class="slider-right-buttons" data-style="${c.id}" style="display:inline-flex;flex-wrap:wrap;gap:4px;background:#161b26;padding:3px;border-radius:6px;border:1px solid #262b38;">
                <button type="button" class="right-prof-btn active" data-prof="draft-75k" style="background:#2563eb;color:#fff;border:none;border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer;font-weight:600;">Draft 75k</button>
                <button type="button" class="right-prof-btn" data-prof="draft-60k" style="background:transparent;color:#cbd5e1;border:none;border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer;">Draft 60k</button>
                ${
                  has40k
                    ? `<button type="button" class="right-prof-btn" data-prof="draft-40k" style="background:transparent;color:#93c5fd;border:1px solid rgba(59,130,246,0.4);border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer;">Draft 40k</button>`
                    : `<span class="untested-40k-pill" style="padding:4px 8px;font-size:11px;color:#64748b;border:1px dashed #334155;border-radius:4px;">40k not tested</span>`
                }
                <button type="button" class="right-prof-btn" data-prof="draft-6k" style="background:transparent;color:#cbd5e1;border:none;border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer;">Draft 6k</button>
                <button type="button" class="right-prof-btn" data-prof="draft-4k" style="background:transparent;color:#cbd5e1;border:none;border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer;">Draft 4k</button>
                ${
                  hasSub4k
                    ? `<button type="button" class="right-prof-btn" data-prof="draft-2k" style="background:transparent;color:#fcd34d;border:1px solid rgba(245,158,11,0.4);border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer;">Draft 2k</button>
                <button type="button" class="right-prof-btn" data-prof="draft-1k" style="background:transparent;color:#fcd34d;border:1px solid rgba(245,158,11,0.4);border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer;">Draft 1k</button>
                <button type="button" class="right-prof-btn" data-prof="draft-500" style="background:transparent;color:#fcd34d;border:1px solid rgba(245,158,11,0.4);border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer;">Draft 500</button>`
                    : ""
                }
                ${
                  hasPitchExp
                    ? `<button type="button" class="right-prof-btn" data-prof="draft-pitch75" style="background:transparent;color:#86efac;border:1px solid rgba(34,197,94,0.4);border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer;">Pitch 75%</button>
                <button type="button" class="right-prof-btn" data-prof="draft-pitch75-4k" style="background:transparent;color:#5eead4;border:1px solid rgba(20,184,166,0.6);border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer;font-weight:600;">Pitch 75% + 4k</button>
                <button type="button" class="right-prof-btn" data-prof="draft-pitch50" style="background:transparent;color:#86efac;border:1px solid rgba(34,197,94,0.4);border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer;">Pitch 50%</button>
                <button type="button" class="right-prof-btn" data-prof="draft-pitch25" style="background:transparent;color:#86efac;border:1px solid rgba(34,197,94,0.4);border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer;">Pitch 25%</button>`
                    : ""
                }
              </div>
              <span class="untested-40k-notice" style="display:none;font-size:11px;color:#fbbf24;background:#451a03;border:1px solid #92400e;padding:2px 8px;border-radius:4px;">Profile not tested on ${c.id}; keeping current profile</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;min-width:240px;flex:1;max-width:360px;">
              <span style="font-size:11px;color:#94a3b8;">Split:</span>
              <input type="range" class="split-range" data-style="${c.id}" min="0" max="100" value="50" style="flex:1;cursor:ew-resize;accent-color:#3b82f6;" />
              <code class="split-pct-label" style="font-size:11px;color:#cbd5e1;min-width:34px;text-align:right;">50%</code>
            </div>
          </div>

          <div class="live-compare-metrics" style="font-size:12px;color:#cbd5e1;background:#161b26;padding:8px 12px;border-radius:6px;margin-bottom:12px;display:flex;flex-wrap:wrap;align-items:center;gap:14px;">
            <span><b>Right Profile:</b> <code class="m-label">Draft 75k (Default)</code></span>
            <span><b>Derived draw-rate FPS (1000/p50):</b> <code class="m-fps" style="color:#38bdf8;font-weight:700;">${d75Meta.capFps} FPS</code> <span class="m-30badge" style="font-size:11px;color:${d75Meta.meets30 ? "#4ade80" : "#fbbf24"};">(${d75Meta.meets30 ? "meets 30 FPS / 33.3 ms target" : "exceeds 33.3 ms target; buffers locally"})</span></span>
            <span><b>Advancing-frame draw time (p50 / p95 / max):</b> <code class="m-adv">${d75Meta.advP50} / ${d75Meta.advP95} / ${d75Meta.advMax} ms</code> (vs Full <code>${fullMeta.advP50} ms</code> = <code>${fullMeta.capFps} FPS</code>)</span>
            <span><b>Cold first-seek time (init+build):</b> <code class="m-cold">${d75Meta.coldMs} ms</code> (vs Full <code>${fullMeta.coldMs} ms</code>)</span>
            <span><b>Actual Vertices:</b> <code class="m-verts">${d75Meta.verts}</code> (vs Full <code>${fullMeta.verts}</code>)</span>
            <span><b>Exact / 1px Mask IoU:</b> <code class="m-exact">${d75Meta.exactIou}</code> / <code class="m-dil">${d75Meta.dilIou}</code></span>
            <span><b>Coverage:</b> <code class="m-cov">${d75Meta.cov}</code></span>
            <span><b>PSNR:</b> <code class="m-psnr">${d75Meta.psnr}</code></span>
          </div>

          <div style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start;">
            <!-- Full Still Split View -->
            <div style="flex:1;min-width:320px;max-width:640px;">
              <div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">Drag across Preview Still (Left = Base, Right = Selected Profile):</div>
              <div class="split-viewport" data-style="${c.id}" style="position:relative;width:100%;overflow:hidden;border-radius:6px;border:1px solid #475569;cursor:ew-resize;user-select:none;line-height:0;">
                <img class="split-right-img" src="crops-and-motion/${c.id}/draft-75k.png" draggable="false" style="display:block;width:100%;height:auto;pointer-events:none;" />
                <img class="split-left-img" src="crops-and-motion/${c.id}/full.png" draggable="false" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;clip-path:inset(0 50% 0 0);pointer-events:none;" />
                <div class="split-handle" style="position:absolute;top:0;bottom:0;left:50%;width:2px;background:#3b82f6;box-shadow:0 0 6px rgba(0,0,0,0.8);pointer-events:none;">
                  <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:26px;height:26px;border-radius:50%;background:#2563eb;border:2px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,0.6);">⇄</div>
                </div>
                <span class="badge-left" style="position:absolute;top:8px;left:8px;background:rgba(15,23,42,0.82);color:#e2e8f0;padding:3px 7px;border-radius:4px;font-size:11px;line-height:1.2;pointer-events:none;">Full (Reference)</span>
                <span class="badge-right" style="position:absolute;top:8px;right:8px;background:rgba(37,99,235,0.88);color:#fff;padding:3px 7px;border-radius:4px;font-size:11px;line-height:1.2;pointer-events:none;">Draft 75k (Default)</span>
              </div>
            </div>

            <!-- 1:1 Crop Split View -->
            <div>
              <div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">Drag across 1:1 Detail Crop (${c.crop.w}×${c.crop.h} px, 1.5× zoom):</div>
              <div class="split-viewport" data-style="${c.id}" style="position:relative;width:${Math.round(c.crop.w * 1.5)}px;height:${Math.round(c.crop.h * 1.5)}px;overflow:hidden;border-radius:6px;border:1px solid #475569;cursor:ew-resize;user-select:none;line-height:0;">
                <img class="split-right-crop" src="crops-and-motion/${c.id}/draft-75k-crop.png" draggable="false" style="display:block;width:100%;height:100%;image-rendering:pixelated;pointer-events:none;" />
                <img class="split-left-crop" src="crops-and-motion/${c.id}/full-crop.png" draggable="false" style="position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;clip-path:inset(0 50% 0 0);pointer-events:none;" />
                <div class="split-handle" style="position:absolute;top:0;bottom:0;left:50%;width:2px;background:#3b82f6;box-shadow:0 0 6px rgba(0,0,0,0.8);pointer-events:none;">
                  <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:22px;height:22px;border-radius:50%;background:#2563eb;border:2px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700;">⇄</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- SIDE-BY-SIDE GRID (${profiles.length} CARDS) -->
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:10px;">
          ${profiles
            .map(
              ([title, prefix, gt, swCold, st, m, note]) => `
            <div style="background:#0f1117;border:1px solid ${prefix === "draft-40k" ? "#3b82f6" : prefix.startsWith("draft-pitch") ? "#22c55e" : ["draft-2k", "draft-1k", "draft-500"].includes(prefix) ? "#f59e0b" : "#262b38"};border-radius:8px;padding:10px;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:4px;margin-bottom:2px;">
                <span style="font-size:13px;font-weight:600;color:#e2e8f0;">${title}</span>
              </div>
              <div style="font-size:10px;color:#94a3b8;margin-bottom:5px;">${note || ""}</div>
              <div style="margin-bottom:6px;">${target30BadgeHtml(gt?.gpuAdvancingP50Ms)}</div>
              <div style="font-size:11px;color:#cbd5e1;background:#161b26;padding:6px 8px;border-radius:6px;margin-bottom:8px;line-height:1.48;">
                <div><b>Derived draw-rate FPS:</b> <code style="color:#38bdf8;font-weight:700;">${calcDerivedDrawRateFps(gt?.gpuAdvancingP50Ms)} FPS</code> <span style="color:#64748b;">(1000/p50)</span></div>
                <div><b>Advancing-frame draw (p50/p95):</b> <code>${gt?.gpuAdvancingP50Ms ?? "—"}</code> / <code>${gt?.gpuAdvancingP95Ms ?? "—"} ms</code> (max <code>${gt?.gpuAdvancingMaxMs ?? "—"}</code>)</div>
                <div><b>Cold first-seek time:</b> <code>${gt?.gpuColdFirstSeekMedianMs ?? "—"} ms</code></div>
                <div><b>Warm same-frame:</b> <code>${gt?.gpuWarmSameFrameMedianMs ?? "—"} ms</code> · <b>Draw+bitmap (DOM):</b> <code>${gt?.gpuWorkerFrameReadyMedianMs ?? "—"} ms</code></div>
                <div style="color:#64748b;"><b>SwiftShader cold:</b> <code>${swCold ?? st?.totalSeekMs ?? "—"} ms</code></div>
                <div style="color:#cbd5e1;"><b>Actual Verts:</b> <code>${st?.totalSceneVertices ?? 0}</code> ${st?.draftTargetVerticesPerFrame ? `<span style="color:#64748b;">(target=${st.draftTargetVerticesPerFrame}${st.budgetExceededByFloor ? ", >target floor" : ""})</span>` : ""}</div>
                ${
                  m
                    ? `<div style="margin-top:3px;padding-top:3px;border-top:1px solid #262b38;color:#93c5fd;"><b>IoU (exact/1px):</b> <code>${m.exactPixelMaskIou}/${m.dilated1pxMaskIou}</code> · <b>Cov:</b> <code>${m.coverageRatio}</code> · <b>PSNR:</b> <code>${m.psnrDb}dB</code></div>`
                    : `<div style="margin-top:3px;padding-top:3px;border-top:1px solid #262b38;color:#64748b;"><b>Reference Ground Truth</b></div>`
                }
              </div>
              <div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">Preview Still:</div>
              <img src="crops-and-motion/${c.id}/${prefix}.png" style="width:100%;height:auto;border-radius:4px;border:1px solid #334155;" />
              <div style="font-size:11px;color:#94a3b8;margin:8px 0 4px 0;">1:1 Detail Crop (${c.crop.w}×${c.crop.h} px):</div>
              <img src="crops-and-motion/${c.id}/${prefix}-crop.png" style="width:${c.crop.w}px;height:${c.crop.h}px;image-rendering:pixelated;border-radius:4px;border:1px solid #334155;" />
              <div style="font-size:11px;color:#94a3b8;margin:8px 0 4px 0;">3-Frame Motion Strip (f-2, f-1, f):</div>
              <img src="crops-and-motion/${c.id}/${prefix}-motion.png" style="width:100%;height:auto;border-radius:4px;border:1px solid #334155;" />
            </div>`
            )
            .join("")}
        </div>
      </section>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Draft Preview Visual Review — Full vs Draft (75k / 60k / 40k / 6k / 4k / Mellan 2k, 1k, 500 &amp; Pitch 75%, 50%, 25%)</title>
</head>
<body style="margin:0;padding:24px;background:#0b0d12;color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="position:sticky;top:0;z-index:50;background:rgba(11,13,18,0.95);backdrop-filter:blur(8px);border-bottom:1px solid #2a2f3d;padding:12px 0;margin-bottom:20px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;">
    <div style="max-width:740px;">
      <h1 style="margin:0 0 4px 0;font-size:20px;">Draft Preview Integration — Interactive Slider, Derived Draw-Rate FPS &amp; Cold First-Seek Time</h1>
      <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.4;">
        <b>Timing Methodology:</b> Page-level timings measure synchronous <code>window.FILM.seek()</code> and <code>createImageBitmap(canvas)</code> on a DOM <code>&lt;canvas&gt;</code> in normal headless Chrome (default browser backend enabled, vs forced-SwiftShader <code>--use-angle=swiftshader --disable-gpu</code>; hardware GPU rasterization is not asserted without GPU backend diagnostics). <b>Derived draw-rate FPS</b> = <code>1000 / Advancing-frame p50 ms</code> (30 FPS target = <code>33.3 ms/frame</code>). Actual Worker / live-player playback metrics are reported separately.
      </p>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;background:#161922;border:1px solid #334155;padding:8px 12px;border-radius:8px;">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span style="font-size:12px;font-weight:600;color:#e2e8f0;">Set All Sliders To:</span>
        <button type="button" class="global-prof-btn" data-prof="draft-75k" style="background:#2563eb;color:#fff;border:none;border-radius:4px;padding:4px 9px;font-size:12px;cursor:pointer;font-weight:600;">Full vs 75k</button>
        <button type="button" class="global-prof-btn" data-prof="draft-60k" style="background:#1e293b;color:#cbd5e1;border:1px solid #475569;border-radius:4px;padding:4px 9px;font-size:12px;cursor:pointer;">Full vs 60k</button>
        <button type="button" class="global-prof-btn" id="master-40k-btn" data-prof="draft-40k" style="background:#1e3a8a;color:#dbeafe;border:1px solid #3b82f6;border-radius:4px;padding:4px 9px;font-size:12px;cursor:pointer;font-weight:600;">Full vs 40k (4 Styles)</button>
        <button type="button" class="global-prof-btn" data-prof="draft-6k" style="background:#1e293b;color:#cbd5e1;border:1px solid #475569;border-radius:4px;padding:4px 9px;font-size:12px;cursor:pointer;">Full vs 6k</button>
        <button type="button" class="global-prof-btn" data-prof="draft-4k" style="background:#1e293b;color:#cbd5e1;border:1px solid #475569;border-radius:4px;padding:4px 9px;font-size:12px;cursor:pointer;">Full vs 4k</button>
        <span style="font-size:11px;color:#94a3b8;margin-left:4px;">Master Split:</span>
        <input id="master-split-range" type="range" min="0" max="100" value="50" style="width:100px;cursor:ew-resize;accent-color:#3b82f6;" />
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-top:4px;border-top:1px solid #262b38;">
        <span style="font-size:11px;font-weight:600;color:#fcd34d;">Mellan Only (Sub-4k &amp; Spiral Pitch):</span>
        <button type="button" class="mellan-only-btn" data-prof="draft-2k" style="background:#451a03;color:#fde68a;border:1px solid #b45309;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;">Mellan 2k</button>
        <button type="button" class="mellan-only-btn" data-prof="draft-1k" style="background:#451a03;color:#fde68a;border:1px solid #b45309;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;">Mellan 1k</button>
        <button type="button" class="mellan-only-btn" data-prof="draft-500" style="background:#451a03;color:#fde68a;border:1px solid #b45309;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;">Mellan 500</button>
        <button type="button" class="mellan-only-btn" data-prof="draft-pitch75" style="background:#052e16;color:#bbf7d0;border:1px solid #15803d;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;">Pitch 75% Turns</button>
        <button type="button" class="mellan-only-btn" data-prof="draft-pitch75-4k" style="background:#134e4a;color:#99f6e4;border:1px solid #14b8a6;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;font-weight:600;">Pitch 75% + 4k arcStep</button>
        <button type="button" class="mellan-only-btn" data-prof="draft-pitch50" style="background:#052e16;color:#bbf7d0;border:1px solid #15803d;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;">Pitch 50% Turns</button>
        <button type="button" class="mellan-only-btn" data-prof="draft-pitch25" style="background:#052e16;color:#bbf7d0;border:1px solid #15803d;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;">Pitch 25% Turns</button>
      </div>
    </div>
  </div>
  ${rowsHtml}

  <script>
    (function () {
      function setCardSplit(card, pct) {
        const clamped = Math.max(0, Math.min(100, Number(pct)));
        const range = card.querySelector(".split-range");
        if (range) range.value = String(clamped);
        const label = card.querySelector(".split-pct-label");
        if (label) label.textContent = Math.round(clamped) + "%";
        card.querySelectorAll(".split-left-img, .split-left-crop").forEach((img) => {
          img.style.clipPath = "inset(0 " + (100 - clamped) + "% 0 0)";
        });
        card.querySelectorAll(".split-handle").forEach((h) => {
          h.style.left = clamped + "%";
        });
      }

      function updateCardProfiles(card, leftProf, rightProf, fromMaster = false) {
        const styleId = card.getAttribute("data-style-id");
        const metaMap = JSON.parse(card.getAttribute("data-profile-meta") || "{}");
        const notice = card.querySelector(".untested-40k-notice");
        if (notice) {
          if (fromMaster && rightProf && !metaMap[rightProf]) {
            notice.textContent = rightProf + " not tested on " + styleId + "; keeping current profile";
            notice.style.display = "inline-block";
          } else {
            notice.style.display = "none";
          }
        }

        const leftSelect = card.querySelector(".slider-left-select");
        if (leftProf && leftSelect && metaMap[leftProf]) leftSelect.value = leftProf;
        const curLeft = leftSelect ? leftSelect.value : "full";

        let curRight = rightProf;
        if (!curRight || !metaMap[curRight]) {
          const activeBtn = card.querySelector(".right-prof-btn.active");
          curRight = activeBtn ? activeBtn.getAttribute("data-prof") : "draft-75k";
        }

        card.querySelectorAll(".right-prof-btn").forEach((btn) => {
          const isAct = btn.getAttribute("data-prof") === curRight;
          btn.classList.toggle("active", isAct);
          btn.style.background = isAct ? "#2563eb" : "transparent";
          btn.style.color = isAct ? "#fff" : "#cbd5e1";
          btn.style.fontWeight = isAct ? "600" : "400";
        });

        const leftImg = card.querySelector(".split-left-img");
        const rightImg = card.querySelector(".split-right-img");
        const leftCrop = card.querySelector(".split-left-crop");
        const rightCrop = card.querySelector(".split-right-crop");
        if (leftImg) leftImg.src = "crops-and-motion/" + styleId + "/" + curLeft + ".png";
        if (rightImg) rightImg.src = "crops-and-motion/" + styleId + "/" + curRight + ".png";
        if (leftCrop) leftCrop.src = "crops-and-motion/" + styleId + "/" + curLeft + "-crop.png";
        if (rightCrop) rightCrop.src = "crops-and-motion/" + styleId + "/" + curRight + "-crop.png";

        const lMeta = metaMap[curLeft] || {};
        const rMeta = metaMap[curRight] || {};
        const bLeft = card.querySelector(".badge-left");
        const bRight = card.querySelector(".badge-right");
        if (bLeft) bLeft.textContent = lMeta.label || curLeft;
        if (bRight) bRight.textContent = rMeta.label || curRight;

        const mLabel = card.querySelector(".m-label");
        const mFps = card.querySelector(".m-fps");
        const m30Badge = card.querySelector(".m-30badge");
        const mVerts = card.querySelector(".m-verts");
        const mAdv = card.querySelector(".m-adv");
        const mCold = card.querySelector(".m-cold");
        const mExact = card.querySelector(".m-exact");
        const mDil = card.querySelector(".m-dil");
        const mCov = card.querySelector(".m-cov");
        const mPsnr = card.querySelector(".m-psnr");
        if (mLabel) mLabel.textContent = rMeta.label || curRight;
        if (mFps) mFps.textContent = (rMeta.capFps || "—") + " FPS";
        if (m30Badge) {
          m30Badge.textContent = rMeta.meets30
            ? "(meets 30 FPS / 33.3 ms target)"
            : "(exceeds 33.3 ms target; buffers locally)";
          m30Badge.style.color = rMeta.meets30 ? "#4ade80" : "#fbbf24";
        }
        if (mVerts) {
          const targetSuffix = rMeta.targetB
            ? " (target=" + rMeta.targetB + (rMeta.exceededFloor ? ", >target floor" : "") + ")"
            : "";
          mVerts.textContent = String(rMeta.verts ?? "—") + targetSuffix;
        }
        if (mAdv) mAdv.textContent = rMeta.advP50 + " / " + rMeta.advP95 + " / " + rMeta.advMax + " ms";
        if (mCold) mCold.textContent = rMeta.coldMs + " ms";
        if (mExact) mExact.textContent = String(rMeta.exactIou ?? "—");
        if (mDil) mDil.textContent = String(rMeta.dilIou ?? "—");
        if (mCov) mCov.textContent = String(rMeta.cov ?? "—");
        if (mPsnr) mPsnr.textContent = String(rMeta.psnr ?? "—");
      }

      document.querySelectorAll(".style-card").forEach((card) => {
        const range = card.querySelector(".split-range");
        if (range) {
          range.addEventListener("input", () => setCardSplit(card, range.value));
        }
        const leftSelect = card.querySelector(".slider-left-select");
        if (leftSelect) {
          leftSelect.addEventListener("change", () => updateCardProfiles(card, leftSelect.value, null, false));
        }
        card.querySelectorAll(".right-prof-btn").forEach((btn) => {
          btn.addEventListener("click", () => updateCardProfiles(card, null, btn.getAttribute("data-prof"), false));
        });

        card.querySelectorAll(".split-viewport").forEach((vp) => {
          let dragging = false;
          const updateFromEvent = (e) => {
            const rect = vp.getBoundingClientRect();
            const clientX = e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX;
            const pct = ((clientX - rect.left) / Math.max(1, rect.width)) * 100;
            setCardSplit(card, pct);
          };
          vp.addEventListener("pointerdown", (e) => {
            dragging = true;
            vp.setPointerCapture(e.pointerId);
            updateFromEvent(e);
          });
          vp.addEventListener("pointermove", (e) => {
            if (!dragging) return;
            updateFromEvent(e);
          });
          vp.addEventListener("pointerup", () => {
            dragging = false;
          });
          vp.addEventListener("pointercancel", () => {
            dragging = false;
          });
        });
      });

      document.querySelectorAll(".global-prof-btn").forEach((gBtn) => {
        gBtn.addEventListener("click", () => {
          const prof = gBtn.getAttribute("data-prof");
          document.querySelectorAll(".global-prof-btn").forEach((b) => {
            const act = b === gBtn;
            b.style.background = act ? "#2563eb" : "#1e293b";
            b.style.color = act ? "#fff" : "#cbd5e1";
            b.style.border = act ? "none" : "1px solid #475569";
            b.style.fontWeight = act ? "600" : "400";
          });
          document.querySelectorAll(".style-card").forEach((card) => {
            updateCardProfiles(card, "full", prof, true);
          });
        });
      });

      document.querySelectorAll(".mellan-only-btn").forEach((mBtn) => {
        mBtn.addEventListener("click", () => {
          const prof = mBtn.getAttribute("data-prof");
          const mellanCard = document.getElementById("section-mellan");
          if (mellanCard) {
            updateCardProfiles(mellanCard, "full", prof, false);
            mellanCard.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        });
      });

      const masterRange = document.getElementById("master-split-range");
      if (masterRange) {
        masterRange.addEventListener("input", () => {
          document.querySelectorAll(".style-card").forEach((card) => {
            setCardSplit(card, masterRange.value);
          });
        });
      }
    })();
  </script>
</body>
</html>`;

  const outPath = join(VISUAL_DIR, "visual-review.html");
  writeFileSync(outPath, html);
  return outPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const htmlPath = generateVisualReviewHtml();
  if (process.argv.includes("--generate-only")) {
    console.log(`Generated ${htmlPath}`);
    process.exit(0);
  }
  const port = Number(process.env.PORT || 4477);
  const mime = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".json": "application/json" };
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const rel = u.pathname === "/" ? "/visual-review.html" : u.pathname;
    const filePath = join(VISUAL_DIR, rel);
    if (existsSync(filePath)) {
      res.writeHead(200, { "content-type": mime[extname(filePath)] || "application/octet-stream" });
      res.end(readFileSync(filePath));
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Visual review server listening at http://127.0.0.1:${port}`);
  });
}
