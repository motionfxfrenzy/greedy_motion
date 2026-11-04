import type { ScriptBeat, VideoProject } from "@videosaas/contracts";
import type { Composition } from "../../../lib/api";

export const FIXTURE_HF_PROJECT_ID = "00000000-0000-4000-8000-000000000302";

const HF_BEATS = [
  {
    id: "b1",
    keyword: "Launch in minutes",
    visual: "Clean kinetic headline with brand accent and smooth horizontal entry.",
    onScreen: "Turn release notes into motion",
    line: "Every product update deserves a clear story that customers actually watch.",
    role: "setup" as const,
    sfx: "impact-bass-1",
    seconds: 2.4
  },
  {
    id: "b2",
    keyword: "Paste your brief",
    visual: "Prompt card morphing into a five-scene storyboard timeline.",
    onScreen: "One prompt builds the plan",
    line: "Start from a short brief or your own script and get a timed storyboard.",
    role: "turn" as const,
    sfx: "pop",
    seconds: 2.4
  },
  {
    id: "b3",
    keyword: "Voice and music",
    visual: "Waveform and ducked music bed aligning automatically to each beat.",
    onScreen: "Narration sets the clock",
    line: "Natural voiceover and a ducked music bed lock every cut to the spoken words.",
    role: "step" as const,
    sfx: "click",
    seconds: 2.4
  },
  {
    id: "b4",
    keyword: "Preview in browser",
    visual: "Live browser stage playing smooth vector typography at 60fps.",
    onScreen: "Instant playback, zero wait",
    line: "Watch the live composition in your browser and pin comments to any second.",
    role: "reveal" as const,
    sfx: "chime",
    seconds: 2.4
  },
  {
    id: "b5",
    keyword: "Render when ready",
    visual: "Brand lockup landing with a crisp call to action pill.",
    onScreen: "Export MP4",
    line: "Approve the animation and render the finished film in a single click.",
    role: "resolution" as const,
    sfx: "chime",
    seconds: 2.2
  }
];

export const FIXTURE_HF_BEATS: ScriptBeat[] = HF_BEATS.map((b) => ({
  keyword: b.keyword,
  visual: b.visual,
  onScreen: b.onScreen,
  line: b.line
}));

export const FIXTURE_HF_FRAMES: string[] = HF_BEATS.map(
  (b, idx) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360">` +
    `<rect width="640" height="360" fill="#0f172a"/>` +
    `<rect x="36" y="36" width="568" height="288" rx="18" fill="#1e293b" stroke="#3b82f6" stroke-width="3"/>` +
    `<circle cx="${120 + idx * 90}" cy="180" r="44" fill="#2563eb" opacity="0.85"/>` +
    `<text x="64" y="110" fill="#f8fafc" font-family="sans-serif" font-size="28" font-weight="700">0${idx + 1} · ${b.keyword}</text>` +
    `<text x="64" y="156" fill="#94a3b8" font-family="sans-serif" font-size="18">${b.onScreen}</text>` +
    `</svg>`
);

export const FIXTURE_HF_PROJECT: VideoProject = {
  id: FIXTURE_HF_PROJECT_ID,
  name: "Relay Launch Reel",
  state: "Ready for review",
  createdAt: "2026-11-04T12:00:00.000Z",
  updatedAt: "2026-11-04T12:05:00.000Z",
  request: {
    prompt: "A concise launch film showing how Relay turns product updates into animated videos.",
    format: "landscape",
    style: "clean",
    theme: "neutral",
    template: "product-launch",
    audio: { music: true, voiceover: true, voice: "Kore" }
  },
  screenshots: [],
  comments: [],
  brief: {
    scriptMode: "own",
    text: HF_BEATS.map((b) => b.line).join(" "),
    durationSeconds: 20,
    aspect: "16:9",
    aspects: ["16:9"],
    motionProfile: "smooth",
    pace: "calm",
    audio: { mode: "both", voice: "Kore", musicMood: "warm modern instrumental" },
    captions: "full",
    template: null,
    theme: "neutral",
    videoType: "promo",
    productName: "Relay",
    scriptBeats: FIXTURE_HF_BEATS
  },
  beatPlan: {
    version: "1.0",
    mode: "own-script",
    template: null,
    format: "social",
    canvas: "16:9",
    target_duration_s: 20,
    clock: "voiceover",
    brand: { name: "Relay", motion_profile: "smooth", style_frame: null },
    characters: [],
    beats: HF_BEATS.map((b, i) => ({
      id: b.id,
      role: b.role,
      kind: "kinetic" as const,
      producer: "hyperframes" as const,
      line: b.line,
      verb: null,
      keyword: b.keyword,
      on_screen: b.onScreen,
      success: i === HF_BEATS.length - 1,
      energy: "calm" as const,
      motion: {
        camera: "slow push",
        entry: { axis: "x" as const, dir: -1 as const },
        exit: { axis: "x" as const, dir: -1 as const },
        text_effect: "waterfall" as const
      },
      sfx: b.sfx,
      scene: null,
      transition_out: { type: i === HF_BEATS.length - 1 ? ("end" as const) : ("j-cut" as const), carrier: null }
    })),
    audio: {
      voice: { engine: "gemini-tts", voice: "Kore", speed: 1, direction: "Clear, engaging product narrator" },
      music: { source: "lyria", prompt: "Warm modern electronic pulse", bpm: 96 },
      captions: "full"
    },
    approvals: ["script", "storyboard", "motion-preview"],
    suggestions: [],
    estimate: { generated_shots: 0, api_usd: 0.05, render_s: 20 }
  },
  planAudio: {
    voice: {
      engine: "gemini-tts",
      model: "gemini-2.5-flash-preview-tts",
      voice: "Kore",
      direction: "Clear, engaging product narrator",
      pace: "calm",
      lines: HF_BEATS.map((b, idx) => ({
        beat: b.id,
        text: b.line,
        file: `vo/scene-${idx + 1}.wav`,
        seconds: b.seconds,
        words: b.line.split(/\s+/).map((w, wIdx, arr) => ({
          text: w,
          start: Number(((wIdx / arr.length) * b.seconds).toFixed(2)),
          end: Number((((wIdx + 1) / arr.length) * b.seconds).toFixed(2))
        })),
        aligned: "whisper" as const
      }))
    },
    music: {
      source: "lyria",
      model: "lyria-002",
      prompt: "Warm modern electronic pulse",
      file: "music/bed.wav",
      seconds: 22
    },
    cost_usd: 0.02,
    updatedAt: "2026-11-04T12:04:00.000Z"
  }
};

export const FIXTURE_HF_COMPOSITION: Composition = {
  engine: "beat-plan",
  baseUrl: `/v1/preview/plans/${FIXTURE_HF_PROJECT_ID}`,
  canvas: "16:9",
  durationSeconds: 20,
  variables: Object.fromEntries(
    HF_BEATS.flatMap((b) => [
      [`${b.id}.keyword`, b.keyword],
      [`${b.id}.on_screen`, b.onScreen],
      [`${b.id}.line`, b.line]
    ])
  ),
  beatTimes: {
    b1: { start: 0, end: 4 },
    b2: { start: 4, end: 8 },
    b3: { start: 8, end: 12 },
    b4: { start: 12, end: 16 },
    b5: { start: 16, end: 20 }
  },
  audio: {
    mode: "both",
    voice: { voice: "Kore", lines: 5, ready: 5, stale: [] },
    music: { ready: true, model: "lyria-002", seconds: 22 },
    ready: true,
    cost_usd: 0.02
  },
  readiness: {
    ok: true,
    blocking: [],
    warnings: [],
    durationSeconds: 20
  },
  slots: HF_BEATS.flatMap((b) => [
    { id: `${b.id}.keyword`, beat: b.id, budget: { chars: 28, words: 4 } },
    { id: `${b.id}.on_screen`, beat: b.id, budget: { chars: 60 } },
    { id: `${b.id}.line`, beat: b.id, budget: { words: 24 } }
  ])
};
