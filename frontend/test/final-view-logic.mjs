import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFinalRatioDownloadUrl,
  buildHfFinalRatios,
  buildPlateFinalRatios,
  finalRatioDownloadName,
  finalRatioShape,
  formatFinalRatioTabLabel,
  formatFinalWaitMessage,
  mapPlateRatioStatus,
  shouldShowFinalRatioTabs
} from "../components/animation-workspace/logic.ts";

test("mapPlateRatioStatus maps primary and companion export states to ready, preparing, or failed", () => {
  assert.equal(mapPlateRatioStatus("16:9", "16:9", undefined), "ready");
  assert.equal(mapPlateRatioStatus("16:9", "16:9", { state: "failed" }), "ready");
  assert.equal(mapPlateRatioStatus("9:16", "16:9", { state: "ready", progress: 100 }), "ready");
  assert.equal(mapPlateRatioStatus("9:16", "16:9", { state: "assembling", progress: 65 }), "preparing");
  assert.equal(mapPlateRatioStatus("9:16", "16:9", undefined), "preparing");
  assert.equal(
    mapPlateRatioStatus("1:1", "16:9", { state: "failed", progress: 0, error: "Timed out" }),
    "failed"
  );
});

test("shouldShowFinalRatioTabs hides the tab row for a single ratio and shows it for multiple ratios", () => {
  assert.equal(shouldShowFinalRatioTabs([]), false);
  assert.equal(shouldShowFinalRatioTabs([{ id: "16:9" }]), false);
  assert.equal(shouldShowFinalRatioTabs([{ id: "16:9" }, { id: "9:16" }]), true);
  assert.equal(
    shouldShowFinalRatioTabs([{ id: "16:9" }, { id: "9:16" }, { id: "1:1" }]),
    true
  );
});

test("finalRatioDownloadName formats human-readable project slug or fallback <projectId>-<ratio>.mp4 with colons replaced by x", () => {
  const pid = "00000000-0000-4000-8000-000000000302";
  assert.equal(
    finalRatioDownloadName(pid, "16:9"),
    "00000000-0000-4000-8000-000000000302-16x9.mp4"
  );
  assert.equal(
    finalRatioDownloadName(pid, "9:16"),
    "00000000-0000-4000-8000-000000000302-9x16.mp4"
  );
  assert.equal(
    finalRatioDownloadName(pid, "1:1"),
    "00000000-0000-4000-8000-000000000302-1x1.mp4"
  );
  assert.equal(
    finalRatioDownloadName("62006124-426c-4197-ba2a-47eb81f186a4", "9:16", "Make a 15 second concept reel about overthinking"),
    "overthinking-9x16.mp4"
  );
  assert.equal(
    finalRatioDownloadName(pid, "16:9", "Relay Launch Reel"),
    "relay-launch-reel-16x9.mp4"
  );
  assert.equal(
    finalRatioDownloadName(pid, "9:16", "The Fox's Winter Lantern"),
    "the-foxs-winter-lantern-9x16.mp4"
  );
});

test("buildFinalRatioDownloadUrl appends download=1 and filename while preserving existing media tokens", () => {
  assert.equal(buildFinalRatioDownloadUrl(null, "test.mp4"), null);
  assert.equal(
    buildFinalRatioDownloadUrl(
      "http://localhost:4000/v1/renders/job-1?t=user.123.sig",
      "proj-1-9x16.mp4"
    ),
    "http://localhost:4000/v1/renders/job-1?t=user.123.sig&download=1&filename=proj-1-9x16.mp4"
  );
  assert.equal(
    buildFinalRatioDownloadUrl(
      "/v1/projects/proj-1/plates/export/9-16",
      "proj-1-9x16.mp4"
    ),
    "/v1/projects/proj-1/plates/export/9-16?download=1&filename=proj-1-9x16.mp4"
  );
});

test("buildPlateFinalRatios and buildHfFinalRatios build engine-neutral FinalViewRatio descriptors", () => {
  const platePid = "proj-plate-1";
  const plateRatios = buildPlateFinalRatios(
    platePid,
    "16:9",
    ["16:9", "9:16", "1:1"],
    "/final/16x9.mp4",
    {
      "9:16": { state: "ready", progress: 100 },
      "1:1": { state: "assembling", progress: 65 }
    },
    (r) => `/export/${r.replace(":", "-")}.mp4`
  );

  assert.equal(plateRatios.length, 3);
  assert.equal(shouldShowFinalRatioTabs(plateRatios), true);
  assert.deepEqual(plateRatios[0], {
    id: "16:9",
    label: "16:9",
    status: "ready",
    progress: 0,
    url: "/final/16x9.mp4",
    downloadName: "proj-plate-1-16x9.mp4"
  });
  assert.deepEqual(plateRatios[1], {
    id: "9:16",
    label: "9:16",
    status: "ready",
    progress: 100,
    url: "/export/9-16.mp4",
    downloadName: "proj-plate-1-9x16.mp4"
  });
  assert.deepEqual(plateRatios[2], {
    id: "1:1",
    label: "1:1",
    status: "preparing",
    progress: 65,
    url: null,
    downloadName: "proj-plate-1-1x1.mp4"
  });

  const hfRatios = buildHfFinalRatios("proj-hf-1", "9:16", "/v1/projects/proj-hf-1/out.mp4");
  assert.equal(hfRatios.length, 1);
  assert.equal(shouldShowFinalRatioTabs(hfRatios), false);
  assert.deepEqual(hfRatios[0], {
    id: "9:16",
    label: "9:16",
    status: "ready",
    url: "/v1/projects/proj-hf-1/out.mp4",
    downloadName: "proj-hf-1-9x16.mp4"
  });
});

test("finalRatioShape, formatFinalRatioTabLabel, and formatFinalWaitMessage match PlateFinal copy", () => {
  assert.equal(finalRatioShape("16:9"), "16 / 9");
  assert.equal(finalRatioShape("9:16"), "9 / 16");
  assert.equal(finalRatioShape("1:1"), "1 / 1");
  assert.equal(finalRatioShape("unknown"), "16 / 9");

  assert.equal(formatFinalRatioTabLabel({ label: "16:9", status: "ready", progress: 100 }), "16:9");
  assert.equal(formatFinalRatioTabLabel({ label: "1:1", status: "preparing", progress: 65 }), "1:1 · 65%");
  assert.equal(formatFinalRatioTabLabel({ label: "1:1", status: "failed", progress: 0 }), "1:1 · failed");

  assert.equal(
    formatFinalWaitMessage({ label: "1:1", status: "preparing", progress: 65 }),
    "Preparing 1:1… 65%"
  );
  assert.equal(
    formatFinalWaitMessage({ label: "1:1", status: "failed", error: "Square 1:1 export timed out." }),
    "Square 1:1 export timed out."
  );
  assert.equal(
    formatFinalWaitMessage({ label: "1:1", status: "failed" }),
    "This ratio could not be prepared."
  );
});
