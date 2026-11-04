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
  if (stateName === "q-plate-final-approved") {
    if (aspect === "9:16") return { state: "ready", progress: 100 };
    return { state: "failed", progress: 0, error: "Square 1:1 export timed out." };
  }
  if (aspect === "9:16") return { state: "ready", progress: 100 };
  return { state: "assembling", progress: 65, stage: "encoding" };
}
