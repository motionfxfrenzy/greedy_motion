import type { VideoProject } from "@videosaas/contracts";
import type { PlateAspect, PlateExportState, PlateScene, PlateStatus } from "../../../lib/api";

export const FIXTURE_PROJECT_ID = "00000000-0000-4000-8000-000000000301";

const BEATS = [
  {
    id: "beat-1",
    keyword: "Lantern in the mist",
    visual: "A small red fox holds a warm brass lantern on a snowy forest path at dusk.",
    onScreen: "Hold the warm light",
    line: "Every winter evening begins with a single lantern in the snow.",
    role: "setup" as const,
    sfx: "chime"
  },
  {
    id: "beat-2",
    keyword: "Footprints in snow",
    visual: "Fresh paw prints wind beside a frozen stream while soft snow falls.",
    onScreen: "Follow the quiet trail",
    line: "One small step at a time, the trail leads toward the river.",
    role: "turn" as const,
    sfx: "pop"
  },
  {
    id: "beat-3",
    keyword: "Bridge over stream",
    visual: "The fox crosses an arched wooden bridge as the lantern reflects on ice.",
    onScreen: "Cross the wooden bridge",
    line: "Across the old wooden bridge, a warm window begins to glow.",
    role: "step" as const,
    sfx: "click"
  },
  {
    id: "beat-4",
    keyword: "Warm burrow door",
    visual: "A round oak door opens under tree roots, spilling golden light onto the snow.",
    onScreen: "Open the oak door",
    line: "Under the roots of the old oak tree, the door opens wide.",
    role: "reveal" as const,
    sfx: "chime"
  },
  {
    id: "beat-5",
    keyword: "Sharing the soup",
    visual: "Two foxes sit by the hearth with steaming bowls of soup and a kettle.",
    onScreen: "Home before nightfall",
    line: "No winter night feels long when there is warm soup to share.",
    role: "resolution" as const,
    sfx: "chime"
  }
];

export const FIXTURE_PROJECT: VideoProject = {
  id: FIXTURE_PROJECT_ID,
  name: "The Fox's Winter Lantern",
  state: "Rendering draft",
  createdAt: "2026-11-04T12:00:00.000Z",
  updatedAt: "2026-11-04T12:05:00.000Z",
  request: {
    prompt: "A storybook fable about a small fox carrying a lantern home through the winter forest.",
    format: "landscape",
    style: "clean",
    theme: "neutral",
    template: "product-launch",
    audio: { music: true, voiceover: true, voice: "Aoede" }
  },
  screenshots: [],
  comments: [],
  brief: {
    scriptMode: "own",
    text: BEATS.map((b) => b.line).join(" "),
    durationSeconds: 20,
    aspect: "16:9",
    aspects: ["16:9", "9:16", "1:1"],
    motionProfile: "smooth",
    pace: "calm",
    audio: { mode: "both", voice: "Aoede", musicMood: "warm acoustic storybook" },
    captions: "full",
    template: null,
    theme: "neutral",
    look: "illus-fox",
    videoType: "story",
    scriptBeats: BEATS.map((b) => ({
      keyword: b.keyword,
      visual: b.visual,
      onScreen: b.onScreen,
      line: b.line
    }))
  },
  beatPlan: {
    version: "1.0",
    mode: "own-script",
    template: null,
    format: "social",
    canvas: "16:9",
    target_duration_s: 20,
    clock: "voiceover",
    brand: { name: "Fox Story", motion_profile: "smooth", style_frame: null },
    characters: [{ id: "fox", description: "Small rust-red fox with a cream scarf", sheet: null }],
    beats: BEATS.map((b, i) => ({
      id: b.id,
      role: b.role,
      kind: "kinetic" as const,
      producer: "hyperframes" as const,
      line: b.line,
      verb: null,
      keyword: b.keyword,
      on_screen: b.onScreen,
      success: i === BEATS.length - 1,
      energy: "calm" as const,
      motion: {
        camera: "slow pan",
        entry: { axis: "x" as const, dir: 1 as const },
        exit: { axis: "x" as const, dir: -1 as const },
        text_effect: "soft-blur-in" as const
      },
      sfx: b.sfx,
      scene: null,
      transition_out: { type: i === BEATS.length - 1 ? ("end" as const) : ("match-cut" as const), carrier: null }
    })),
    audio: {
      voice: { engine: "gemini-tts", voice: "Aoede", speed: 1, direction: "Warm storyteller" },
      music: { source: "lyria", prompt: "Warm acoustic guitar and celesta", bpm: 84 },
      captions: "full"
    },
    approvals: ["script", "storyboard"],
    suggestions: [],
    estimate: { generated_shots: 0, api_usd: 0.05, render_s: 20 }
  },
  planAudio: {
    voice: {
      engine: "gemini-tts",
      model: "gemini-2.5-flash-preview-tts",
      voice: "Aoede",
      direction: "Warm storyteller",
      pace: "calm",
      lines: BEATS.map((b, idx) => ({
        beat: b.id,
        text: b.line,
        file: `vo/scene-${idx + 1}.wav`,
        seconds: 3.75,
        words: b.line.split(/\s+/).map((w, wIdx, arr) => ({
          text: w,
          start: Number(((wIdx / arr.length) * 3.5).toFixed(2)),
          end: Number((((wIdx + 1) / arr.length) * 3.5).toFixed(2))
        })),
        aligned: "whisper" as const
      }))
    },
    music: {
      source: "lyria",
      model: "lyria-002",
      prompt: "Warm acoustic guitar and celesta",
      file: "music/bed.wav",
      seconds: 22
    },
    cost_usd: 0.02,
    updatedAt: "2026-11-04T12:04:00.000Z"
  }
};

export const OLD_RUBBER_HOSE_7_BEATS = [
  { keyword: "A hen wants bread", visual: "A rubber-hose hen eyes a warm loaf of bread.", onScreen: "Bread for eggs?", line: "A little hen wants a loaf of bread." },
  { keyword: "Eggs, no thanks", visual: "The baker shakes his head at the basket of eggs.", onScreen: "No eggs today", line: "The baker already has plenty of eggs." },
  { keyword: "The long swap", visual: "The hen trades across three market stalls in a row.", onScreen: "Three swaps later", line: "She has to swap with three neighbours first." },
  { keyword: "A pretty shell", visual: "Everyone agrees to trade cowrie shells.", onScreen: "Cowrie shells", line: "Then the town picks a shiny shell everyone takes." },
  { keyword: "Shell to coin", visual: "Shells give way to stamped brass coins.", onScreen: "Stamped coins", line: "Heavy metal coins last longer than brittle shells." },
  { keyword: "Coin to paper", visual: "A vault receipt replaces the heavy sack of coins.", onScreen: "Paper receipts", line: "Paper notes promise the coins are safe in the vault." },
  { keyword: "Still warm", visual: "The hen finally enjoys her warm loaf of bread.", onScreen: "Shared trust", line: "And the hen gets her bread while it is still warm." }
];

export const UPDATED_FOLK_TALE_7_BEATS = [
  { id: "sb-1", keyword: "Wren wants fish", visual: "In the cobbled market square by the well, wren holds out her bread-basket toward tobin's fish-crate.", onScreen: null, line: "Wren wants Tobin's fish." },
  { id: "sb-2", keyword: "Bread for fish", visual: "Wren hands a round loaf across the fish-crate; tobin passes her a silver fish.", onScreen: "The old swap", line: "So she does what everyone in the square does. She swaps a loaf of bread for a fish." },
  { id: "sb-3", keyword: "No more bread", visual: "Tobin sits beside a tall pile of loaves and shakes his head.", onScreen: null, line: "But one morning Tobin's had bread all week. He wants boots, not loaves." },
  { id: "sb-4", keyword: "A string of shells", visual: "Wren lifts a shell-string from her apron; tobin weighs it and smiles.", onScreen: "Shells", line: "So the square picks one thing everyone accepts: shells." },
  { id: "sb-5", keyword: "Little coins", visual: "Small round metal coins clink into tobin's open hand beside the fish-crate.", onScreen: "Metal coins", line: "So they need something rare that lasts. They melt metal into little coins." },
  { id: "sb-6", keyword: "A paper promise", visual: "Wren drops the heavy coin-purse into the strongbox by the well and hands tobin a paper note.", onScreen: "Paper notes", line: "So Wren locks her coins in the square's strongbox and carries a paper note instead." },
  { id: "sb-7", keyword: "Still bread and fish", visual: "Wren and tobin sit on the well's edge sharing a loaf and a fish, the tally-book closed between them.", onScreen: "Crypto & trust", line: "And Wren still gets her fish. Money keeps changing shape." }
];

export const UPDATED_FOLK_TALE_7_PROJECT: VideoProject = {
  ...FIXTURE_PROJECT,
  id: "316f1cbd-b5b9-49af-ae3b-2add10a18ed5",
  name: "how money evolves",
  state: "Ready for review",
  request: {
    ...FIXTURE_PROJECT.request,
    format: "portrait",
    prompt: "how money evolves from barter system to crypto"
  },
  brief: {
    ...FIXTURE_PROJECT.brief!,
    text: "how money evolves from barter system to crypto",
    look: "illus-folk-tale",
    styleExample: "story-illus-folk-tale",
    aspect: "9:16",
    aspects: ["9:16"],
    captions: "key-phrases",
    scriptBeats: UPDATED_FOLK_TALE_7_BEATS
  },
  beatPlan: {
    ...FIXTURE_PROJECT.beatPlan!,
    canvas: "9:16",
    beats: UPDATED_FOLK_TALE_7_BEATS.map((b, i) => ({
      id: `b${i + 1}`,
      role: i === 0 ? ("setup" as const) : i === 6 ? ("resolution" as const) : ("turn" as const),
      kind: "kinetic" as const,
      producer: "hyperframes" as const,
      line: b.line,
      verb: null,
      keyword: b.keyword,
      on_screen: b.onScreen,
      success: i === 6,
      energy: "calm" as const,
      motion: {
        camera: "slow drift",
        entry: { axis: "x" as const, dir: 1 as const },
        exit: { axis: "x" as const, dir: -1 as const },
        text_effect: "waterfall" as const
      },
      sfx: "pop",
      scene: null,
      transition_out: { type: i === 6 ? ("end" as const) : ("j-cut" as const), carrier: null }
    }))
  }
};

export function makeOldRubberHose7Status(): PlateStatus {
  return {
    available: true,
    look: "illus-rubber-hose",
    mode: "live",
    scenes: OLD_RUBBER_HOSE_7_BEATS.map((b, index) => ({
      index,
      keyword: b.keyword,
      state: "drawn" as const,
      seconds: 4,
      frames: 120,
      sig: `v3:old-rh-${index}`,
      rev: 0,
      gen: 1,
      variantId: `00000000-0000-4000-8000-00000000070${index + 1}`,
      bundleDigest: `old-rh-digest-${index}-${"b".repeat(48)}`,
      live: false,
      variants: {
        "9:16": {
          state: "drawn" as const,
          sig: `v3:old-rh-${index}`,
          v: `rhclip${index}`,
          variantId: `00000000-0000-4000-8000-00000000070${index + 1}`,
          bundleDigest: `old-rh-digest-${index}-${"b".repeat(48)}`,
          live: false
        }
      }
    })),
    comments: [],
    subtitles: {
      mode: "full",
      style: "kinetic",
      size: 100,
      opacity: 100,
      color: null,
      bgColor: null,
      x: 50,
      y: 80,
      scenePositions: null,
      voice: true,
      music: true,
      sfx: true,
      transitions: false,
      aspects: ["9:16"]
    },
    running: false,
    drawnAspects: ["9:16"],
    drawingAspects: []
  };
}

function makeScenes(states: PlateScene["state"][], errors?: Partial<Record<number, string>>): PlateScene[] {
  return BEATS.map((b, index) => {
    const state = states[index] ?? "drawn";
    const error = errors?.[index];
    return {
      index,
      keyword: b.keyword,
      state,
      seconds: 4,
      frames: 120,
      sig: `sig-fox-${index}`,
      rev: 1,
      ...(error ? { error } : {}),
      variants: {
        "16:9": { state, sig: `sig-fox-${index}-16x9`, v: "v1" },
        "9:16": { state: "drawn", sig: `sig-fox-${index}-9x16`, v: "v1" },
        "1:1": { state: "drawn", sig: `sig-fox-${index}-1x1`, v: "v1" }
      }
    };
  });
}

function makeLiveScenes(
  configs: {
    state: "bundled" | "checked" | "drawn" | "rendering" | "failed";
    hasBundle?: boolean;
    hasClip?: boolean;
    error?: string;
  }[]
): PlateScene[] {
  return BEATS.map((b, index) => {
    const cfg = configs[index] ?? { state: "checked", hasBundle: true, hasClip: false };
    const variantId = `00000000-0000-4000-8000-00000000040${index + 1}`;
    const bundleDigest = cfg.hasBundle !== false ? `digest-live-scene-${index + 1}-${"a".repeat(48)}` : null;
    const clipV = cfg.hasClip || cfg.state === "drawn" ? "v1" : null;
    const live = cfg.state === "checked";
    const sceneObj = {
      index,
      keyword: b.keyword,
      state: cfg.state as PlateScene["state"],
      seconds: 4,
      frames: 120,
      sig: `sig-fox-${index}`,
      rev: 1,
      variantId: cfg.hasBundle !== false ? variantId : undefined,
      bundleDigest,
      live,
      ...(cfg.error ? { error: cfg.error } : {}),
      variants: {
        "16:9": {
          state: cfg.state as PlateScene["state"],
          sig: `sig-fox-${index}-16x9`,
          v: clipV,
          variantId: cfg.hasBundle !== false ? variantId : undefined,
          bundleDigest,
          live
        },
        "9:16": { state: "drawn" as PlateScene["state"], sig: `sig-fox-${index}-9x16`, v: "v1" },
        "1:1": { state: "drawn" as PlateScene["state"], sig: `sig-fox-${index}-1x1`, v: "v1" }
      }
    };
    return sceneObj as PlateScene;
  });
}

export function fixturePlateStatus(stateName: string): PlateStatus {
  const baseSubtitles = {
    mode: "full" as const,
    style: "paper" as const,
    size: 100,
    opacity: 100,
    color: null,
    bgColor: null,
    x: 50,
    y: 88,
    scenePositions: null,
    voice: true,
    music: true,
    sfx: true,
    transitions: false,
    aspects: ["16:9", "9:16", "1:1"] as ("16:9" | "9:16" | "1:1")[]
  };

  switch (stateName) {
    case "a-prep-drawing":
      // 3 of 5 scenes drawn (60%), scene 1 currently rendering on stage, scene 5 authoring
      return {
        available: true,
        look: "illus-fox",
        scenes: makeScenes(["rendering", "drawn", "drawn", "drawn", "authoring"]),
        comments: [],
        subtitles: baseSubtitles,
        running: true,
        drawnAspects: ["16:9"],
        drawingAspects: []
      };

    case "b-prep-error":
      // Scene 1 & 5 failed with error message and Retry button visible in toolbar (busy = false)
      return {
        available: true,
        look: "illus-fox",
        scenes: makeScenes(
          ["failed", "drawn", "drawn", "drawn", "failed"],
          {
            0: "The scene timed out while drawing the lantern glow. Try again.",
            4: "Could not draw the final scene."
          }
        ),
        comments: [],
        subtitles: baseSubtitles,
        running: false,
        drawnAspects: ["16:9"],
        drawingAspects: []
      };

    case "d-comments":
      return {
        available: true,
        look: "illus-fox",
        scenes: makeScenes(["drawn", "drawn", "drawn", "drawn", "drawn"]),
        comments: [
          {
            id: "comment-1",
            at: 0,
            scene: 0,
            sceneAt: 0,
            body: "Keep the fox's scarf a warmer rust colour throughout."
          },
          {
            id: "comment-2",
            at: 6.4,
            scene: 1,
            sceneAt: 2.4,
            body: "Make the snow footprints glow softly as she steps."
          }
        ],
        subtitles: baseSubtitles,
        running: false,
        drawnAspects: ["16:9"],
        drawingAspects: []
      };

    case "h-scene-updating":
      // Scene 1 is drawn & shown on stage; Scene 2 is updating ("rendering"), Scene 4 has failed / needs update ("failed")
      return {
        available: true,
        look: "illus-fox",
        scenes: makeScenes(
          ["drawn", "rendering", "drawn", "failed", "drawn"],
          { 3: "Needs update after storyboard change." }
        ),
        comments: [
          {
            id: "comment-u1",
            at: 5.0,
            scene: 1,
            sceneAt: 1.0,
            body: "Add more falling snowflakes near the stream."
          }
        ],
        subtitles: baseSubtitles,
        running: true,
        drawnAspects: ["16:9"],
        drawingAspects: []
      };

    case "i-aspect-picker":
    case "k-plate-final":
    case "q-plate-final-approved":
    case "r-plate-final-all-ready":
      return {
        available: true,
        look: "illus-fox",
        scenes: makeScenes(["drawn", "drawn", "drawn", "drawn", "drawn"]),
        comments: [],
        subtitles: baseSubtitles,
        running: false,
        drawnAspects: ["16:9", "9:16", "1:1"],
        drawingAspects: []
      };

    case "s-plate-final-two-ratios":
      return {
        available: true,
        look: "illus-fox",
        scenes: makeScenes(["drawn", "drawn", "drawn", "drawn", "drawn"]),
        comments: [],
        subtitles: { ...baseSubtitles, aspects: ["16:9", "9:16"] },
        running: false,
        drawnAspects: ["16:9", "9:16"],
        drawingAspects: []
      };

    case "t-plate-final-single-9x16":
      return {
        available: true,
        look: "illus-fox",
        scenes: makeScenes(["drawn", "drawn", "drawn", "drawn", "drawn"]),
        comments: [],
        subtitles: { ...baseSubtitles, aspects: ["9:16"] },
        running: false,
        drawnAspects: ["9:16"],
        drawingAspects: []
      };

    case "p-aspect-drawing":
      return {
        available: true,
        look: "illus-fox",
        scenes: makeScenes(["drawn", "drawn", "drawn", "drawn", "drawn"]),
        comments: [],
        subtitles: baseSubtitles,
        running: true,
        drawnAspects: ["16:9"],
        drawingAspects: ["9:16"]
      };

    case "live-a-playing":
    case "live-d-buffering":
      return {
        available: true,
        look: "illus-fox",
        mode: "live",
        scenes: makeLiveScenes([
          { state: "checked", hasBundle: true },
          { state: "checked", hasBundle: true },
          { state: "checked", hasBundle: true },
          { state: "checked", hasBundle: true },
          { state: "checked", hasBundle: true }
        ]),
        comments: [],
        subtitles: baseSubtitles,
        running: false,
        drawnAspects: ["16:9"],
        drawingAspects: []
      } as PlateStatus;

    case "live-b-clip-fallback":
      return {
        available: true,
        look: "illus-fox",
        mode: "live",
        scenes: makeLiveScenes([
          { state: "drawn", hasBundle: true, hasClip: true },
          { state: "drawn", hasBundle: true, hasClip: true },
          { state: "drawn", hasBundle: true, hasClip: true },
          { state: "drawn", hasBundle: true, hasClip: true },
          { state: "drawn", hasBundle: true, hasClip: true }
        ]),
        comments: [],
        subtitles: baseSubtitles,
        running: false,
        drawnAspects: ["16:9"],
        drawingAspects: []
      } as PlateStatus;

    case "live-c-mixed":
      return {
        available: true,
        look: "illus-fox",
        mode: "live",
        scenes: makeLiveScenes([
          { state: "checked", hasBundle: true, hasClip: false },
          { state: "drawn", hasBundle: false, hasClip: true },
          { state: "checked", hasBundle: true, hasClip: false },
          { state: "drawn", hasBundle: false, hasClip: true },
          { state: "checked", hasBundle: true, hasClip: false }
        ]),
        comments: [],
        subtitles: baseSubtitles,
        running: false,
        drawnAspects: ["16:9"],
        drawingAspects: []
      } as PlateStatus;

    case "live-e-needs-update":
      return {
        available: true,
        look: "illus-fox",
        mode: "live",
        scenes: makeLiveScenes([
          { state: "checked", hasBundle: true },
          { state: "checked", hasBundle: true },
          { state: "checked", hasBundle: true },
          { state: "checked", hasBundle: true },
          { state: "checked", hasBundle: true }
        ]),
        comments: [
          {
            id: "comment-1",
            at: 0,
            scene: 0,
            sceneAt: 0,
            body: "Keep the fox's scarf a warmer rust colour throughout."
          },
          {
            id: "comment-2",
            at: 6.4,
            scene: 1,
            sceneAt: 2.4,
            body: "Make the snow footprints glow softly as she steps."
          }
        ],
        subtitles: baseSubtitles,
        running: false,
        drawnAspects: ["16:9"],
        drawingAspects: []
      } as PlateStatus;

    case "u-stale-revision":
      return makeOldRubberHose7Status();

    case "v-partial-stale":
      return {
        available: true,
        look: "illus-folk-tale",
        mode: "live",
        stale: true,
        needsReconcile: true,
        scenes: UPDATED_FOLK_TALE_7_BEATS.map((b, index) => {
          const isStale = index === 1 || index === 4;
          const variantId = isStale ? undefined : `00000000-0000-4000-8000-00000000080${index + 1}`;
          return {
            index,
            keyword: b.keyword,
            state: isStale ? ("queued" as const) : ("drawn" as const),
            stage: isStale ? "stale" : undefined,
            stale: isStale,
            needsReconcile: isStale,
            seconds: 4,
            frames: 120,
            sig: `v3:ft-${index}`,
            rev: 0,
            gen: 1,
            variantId,
            bundleDigest: null,
            live: false,
            variants: {
              "9:16": {
                state: isStale ? ("queued" as const) : ("drawn" as const),
                stage: isStale ? "stale" : undefined,
                stale: isStale,
                needsReconcile: isStale,
                sig: `v3:ft-${index}`,
                v: isStale ? null : `ftclip${index}`,
                variantId,
                bundleDigest: null,
                live: false
              }
            }
          };
        }),
        comments: [],
        subtitles: { ...baseSubtitles, aspects: ["9:16"] },
        running: false,
        drawnAspects: [],
        drawingAspects: []
      };

    case "w-preparing-revision":
      return {
        available: true,
        look: "illus-folk-tale",
        mode: "live",
        stale: false,
        needsReconcile: false,
        scenes: UPDATED_FOLK_TALE_7_BEATS.map((b, index) => {
          const state = index < 2 ? ("authoring" as const) : ("queued" as const);
          return {
            index,
            keyword: b.keyword,
            state,
            stale: false,
            seconds: 4,
            frames: 120,
            sig: `v3:ft-${index}`,
            rev: 0,
            gen: 2,
            variantId: `00000000-0000-4000-8000-00000000070${index + 1}`,
            bundleDigest: null,
            live: false,
            variants: {
              "9:16": {
                state,
                stale: false,
                sig: `v3:ft-${index}`,
                v: null,
                variantId: `00000000-0000-4000-8000-00000000070${index + 1}`,
                bundleDigest: null,
                live: false
              }
            }
          };
        }),
        comments: [],
        subtitles: { ...baseSubtitles, aspects: ["9:16"] },
        running: true,
        drawnAspects: [],
        drawingAspects: ["9:16"]
      };

    default:
      return {
        available: true,
        look: "illus-fox",
        scenes: makeScenes(["drawn", "drawn", "drawn", "drawn", "drawn"]),
        comments: [],
        subtitles: baseSubtitles,
        running: false,
        drawnAspects: ["16:9"],
        drawingAspects: []
      };
  }
}

export function fixturePlateExport(stateName: string, aspect: PlateAspect): PlateExportState {
  if (stateName === "r-plate-final-all-ready" || stateName === "s-plate-final-two-ratios" || stateName === "t-plate-final-single-9x16") {
    return { state: "ready", progress: 100 };
  }
  if (stateName === "q-plate-final-approved") {
    if (aspect === "9:16") return { state: "ready", progress: 100 };
    return { state: "failed", progress: 0, error: "Square 1:1 export timed out." };
  }
  if (aspect === "9:16") return { state: "ready", progress: 100 };
  return { state: "assembling", progress: 65, stage: "encoding" };
}
