import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  paintedLookById,
  type PaintedDrawMode,
  type PaintedLook,
  type PaintedShot,
  type PaintedSpec,
  type PaintedTimeline,
  type PaintedTimelineBeat
} from "@videosaas/contracts";
import { synthesizeVoiceover } from "../audio/gemini-tts.ts";
import { wavDuration } from "../audio/wav.ts";
import { config } from "../config.ts";
import { ensureMediaDir, persistMedia } from "../media.ts";
import { getOutputFile, putOutputFile } from "../storage.ts";

const execFileAsync = promisify(execFile);

const paintedTemplateDir = join(config.templatesDir, "painted");

/** Point the painted engine's writable stores under projectsDir so Docker/Railway non-root users can always write them. */
function configurePaintedEnv() {
  if (config.geminiApiKey) process.env.GEMINI_API_KEY = config.geminiApiKey;
  if (config.anthropicApiKey) process.env.ANTHROPIC_API_KEY = config.anthropicApiKey;
  process.env.PAINTED_WORLD_DB ||= join(config.projectsDir, "_painted-world-db");
  process.env.PAINTED_RECIPE_CACHE ||= join(config.projectsDir, "_painted-recipes");
}

type PaintedModules = {
  directorBrief: () => string;
  supervise: (opts: { spec: PaintedSpec; script: string; engine: string; ask: (o: Record<string, unknown>) => Promise<unknown> }) => Promise<{ spec: PaintedSpec; notes: string[]; applied: number; asked: number }>;
  normalize: (spec: PaintedSpec) => { spec: PaintedSpec; notes: string[] };
  resolveCustom: (spec: PaintedSpec, opts: { cacheDir: string; apiKey: string; concurrency?: number }) => Promise<PaintedSpec>;
  ask: (o: Record<string, unknown>) => Promise<string>;
  askJson: (o: Record<string, unknown>) => Promise<unknown>;
  engineName: (v?: string | null) => "gemini" | "claude";
  scriptPersona: (topic: string, mode?: string | null) => "story" | "educational";
  writeScript: (topic: string, engine: string, opts?: { mode?: string }) => Promise<string>;
  recordEditEvent: (opts: Record<string, unknown>) => { classification: string };
  retrieveCameraExemplars: (script: string) => { say: string; shots: unknown[] }[];
  PLATES: Record<string, { hash?: string }>;
};

let modulesPromise: Promise<PaintedModules> | null = null;

async function loadPaintedModules(): Promise<PaintedModules> {
  configurePaintedEnv();
  if (!modulesPromise) {
    modulesPromise = (async () => {
      const imp = (file: string) => import(pathToFileURL(join(paintedTemplateDir, file)).href);
      const [briefMod, supMod, lintMod, recipeMod, llmMod, worldMod, vocabMod] = await Promise.all([
        imp("brief.mjs"),
        imp("supervise.mjs"),
        imp("lint.mjs"),
        imp("recipe.mjs"),
        imp("llm.mjs"),
        imp("world-db.mjs"),
        imp("vocab.mjs")
      ]);
      return {
        directorBrief: briefMod.directorBrief,
        supervise: supMod.supervise,
        normalize: lintMod.normalize,
        resolveCustom: recipeMod.resolveCustom,
        ask: llmMod.ask,
        askJson: llmMod.askJson,
        engineName: llmMod.engineName,
        scriptPersona: llmMod.scriptPersona,
        writeScript: llmMod.writeScript,
        recordEditEvent: worldMod.recordEditEvent,
        retrieveCameraExemplars: worldMod.retrieveCameraExemplars,
        PLATES: vocabMod.PLATES ?? {}
      };
    })();
  }
  return modulesPromise;
}

const RUNTIME_FILES = ["kit.js", "layout.js", "plates.js", "scenes.js", "doodle.js", "paint.js", "stage.js"] as const;
let cachedRuntimeJs: string | null = null;

/** Concatenated browser runtime (`kit.js` .. `stage.js`) so the browser can draw storyboard frames and play the animation live. */
export async function getPaintedRuntimeJs(): Promise<string> {
  if (cachedRuntimeJs && config.appEnv !== "local") return cachedRuntimeJs;
  const parts = await Promise.all(
    RUNTIME_FILES.map(async (file) => `// --- ${file} ---\n` + (await readFile(join(paintedTemplateDir, "runtime", file), "utf8")))
  );
  cachedRuntimeJs = parts.join("\n");
  return cachedRuntimeJs;
}

export const paintedWorkDir = (projectId: string) => join(config.projectsDir, projectId, "painted");

function lightningTimes(shot: PaintedShot, dur: number, id: string): number[] {
  if (shot.weather !== "storm") return [];
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const out: number[] = [];
  let t = 0.6 + ((h >>> 0) % 9) / 10;
  for (let i = 0; t < dur - 0.3; i++) {
    out.push(Number(t.toFixed(2)));
    t += 2.4 + (((h >>> (i * 3)) & 7) / 7) * 1.6;
  }
  return out;
}

const MOVES = ["push", "drift", "pull", "rise", "push", "pan-right", "drift", "fall"];
const FORMATS: Record<string, [number, number]> = {
  "9:16": [1080, 1920],
  "16:9": [1920, 1080],
  "1:1": [1080, 1080]
};

/**
 * Builds the in-browser player timeline from `spec`. Uses real spoken audio seconds when recorded,
 * or a natural reading-speed estimate while on the Storyboard step.
 */
export function buildPaintedTimeline(spec: PaintedSpec, width = 540, plates: Record<string, { hash?: string }> = {}): PaintedTimeline {
  const [fw, fh] = FORMATS[spec.format ?? "9:16"] ?? FORMATS["9:16"]!;
  const scale = width / fw;
  const W = Math.round((fw * scale) / 2) * 2;
  const H = Math.round((fh * scale) / 2) * 2;
  const fps = spec.fps ?? 24;
  const twos = spec.twos ?? 2;
  const pause = spec.pause ?? 0.3;
  const lead = spec.lead ?? 0.35;
  const tail = spec.tail ?? 0.9;
  let cursor = lead;
  const beats: PaintedTimelineBeat[] = [];
  const captions: { text: string; t0: number; t1: number }[] = [];

  (spec.lines ?? []).forEach((line, li) => {
    const wordCount = (line.say ?? "").trim().split(/\s+/).filter(Boolean).length;
    const spoken = line.audio?.seconds && line.audio.seconds > 0 ? line.audio.seconds : Math.max(1.8, wordCount * 0.42);
    const start = cursor;
    const end = start + spoken + (line.hold ?? 0);
    const shots = line.shots?.length ? line.shots : [{ place: "meadow", time: "day" }];
    const n = shots.length;
    const per = (end - start) / n;

    shots.forEach((shot, si) => {
      const id = `l${li}s${si}`;
      const beat: PaintedTimelineBeat = {
        id,
        lineIndex: li,
        shotIndex: si,
        t0: Number((start + si * per).toFixed(3)),
        t1: Number((start + (si + 1) * per).toFixed(3)),
        move: (shot.move as string) ?? MOVES[beats.length % MOVES.length]!,
        ...(shot.moveAmount !== undefined ? { moveAmount: shot.moveAmount } : {}),
        shot,
        seed: (shot.seed as string) ?? "",
        flashes: lightningTimes(shot, per, id)
      };
      if (shot.place === "plate" && typeof shot.plate === "string" && plates[shot.plate]?.hash) {
        beat.plateHash = plates[shot.plate]!.hash;
      }
      beats.push(beat);
    });

    const words = (line.caption ?? line.say ?? "").trim().split(/\s+/).filter(Boolean);
    if (words.length > 0) {
      const even = Math.ceil(words.length / Math.max(1, Math.ceil(words.length / 5)));
      const sized: string[][] = [];
      for (let i = 0; i < words.length; i += even) sized.push(words.slice(i, i + even));
      const totalChars = sized.reduce((s, c) => s + c.join(" ").length + 1, 0);
      let c0 = start;
      sized.forEach((ch) => {
        const share = ((ch.join(" ").length + 1) / totalChars) * spoken;
        captions.push({ text: ch.join(" "), t0: Number(c0.toFixed(3)), t1: Number((c0 + share).toFixed(3)) });
        c0 += share;
      });
    }
    cursor = end + pause;
  });

  const total = Math.max(2, Number((cursor - pause + tail).toFixed(3)));
  if (beats.length > 0) {
    beats[0]!.fadeIn = 0.4;
    beats[beats.length - 1]!.t1 = total;
    beats[beats.length - 1]!.fadeOut = 0.8;
  }

  return {
    W,
    H,
    fps,
    twos,
    duration: total,
    look: spec.look ?? "oil",
    style: spec.style,
    doodle: spec.doodle,
    drawIn: spec.drawIn,
    beats,
    captions,
    captionStyle: spec.captions?.style ?? "box",
    captionSize: spec.captions?.size,
    captionY: spec.captions?.y
  };
}

/** Applies the chosen look (`doodle:riso`, `oil:oil`, etc.), aspect ratio and drawIn mode to `spec`. */
export function applyLookToSpec(spec: PaintedSpec, lookId: string, drawIn: PaintedDrawMode, aspect: "9:16" | "16:9"): PaintedSpec {
  const look: PaintedLook | undefined = paintedLookById(lookId);
  const next = structuredClone(spec);
  next.format = aspect;
  next.drawIn = drawIn;
  if (!look || look.engine === "doodle") {
    next.style = "doodle";
    next.doodle = look?.medium ?? lookId.split(":")[1] ?? "marker";
    next.look = "oil";
    next.captions ??= { style: "box", y: 0.76 };
  } else {
    delete next.style;
    delete next.doodle;
    next.look = look.medium;
    next.captions ??= { style: "box", y: 0.76 };
  }
  return next;
}

const wordsOf = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

function checkVerbatim(script: string, spec: PaintedSpec) {
  const a = wordsOf(script).join(" ");
  const b = wordsOf((spec.lines ?? []).map((l) => l.say).join(" ")).join(" ");
  if (a !== b) throw new Error("Director changed the script's words; retrying.");
}

const needsSupervise = (s: PaintedSpec) =>
  !(s.lines ?? []).every(
    (l) =>
      l.scene &&
      (l.shots ?? []).length &&
      (l.shots ?? []).every((sh) => sh.place && ((sh.subjects ?? []).length + (sh.props ?? []).length > 0))
  );

/**
 * Step 1 -> Step 2: Generates the Storyboard (`spec` + `timeline`) from either an idea (`mode === "idea"`)
 * or a user-written script (`mode === "script"`). Runs in Node without launching a browser.
 */
export async function generatePaintedStoryboard(input: {
  mode: "idea" | "script";
  text: string;
  look: string;
  drawIn: PaintedDrawMode;
  aspect: "9:16" | "16:9";
  workDir: string;
  onStage?: (stage: string, draft?: { script: string; spec: PaintedSpec; timeline: PaintedTimeline }) => Promise<void> | void;
}): Promise<{ script: string; spec: PaintedSpec; timeline: PaintedTimeline }> {
  const mods = await loadPaintedModules();
  const engine = mods.engineName();
  await mkdir(join(input.workDir, "recipes"), { recursive: true });

  let script = input.text.trim();
  if (input.mode === "idea") {
    await input.onStage?.("writing");
    const persona = mods.scriptPersona(script);
    script = await mods.writeScript(script, engine, { mode: persona });
  }

  await input.onStage?.("directing");
  const lookMeta = paintedLookById(input.look);
  const lookName = lookMeta?.engine === "oil" ? lookMeta.medium : "oil";
  const exemplars = mods.retrieveCameraExemplars(script);
  const learnedBlock = exemplars.length
    ? `\n\n# Verified camera exemplars from user-approved films\n${exemplars.map((e) => `- Line: "${e.say}" -> ${JSON.stringify(e.shots)}`).join("\n")}`
    : "";
  const system = mods.directorBrief() + learnedBlock;

  let rawSpec: PaintedSpec | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const candidate = (await mods.askJson({
        engine,
        what: "director",
        system,
        user: `Format: ${input.aspect}\nLook: ${lookName}\n\nScript:\n${script}`
      })) as PaintedSpec;
      if (attempt < 3) checkVerbatim(script, candidate);
      rawSpec = candidate;
      break;
    } catch (error) {
      if (attempt >= 3) throw error;
    }
  }
  if (!rawSpec || !Array.isArray(rawSpec.lines) || rawSpec.lines.length === 0) {
    throw new Error("Could not direct the scenes for this script. Try again.");
  }

  let spec = applyLookToSpec(rawSpec, input.look, input.drawIn, input.aspect);

  if (needsSupervise(spec)) {
    try {
      await mods.supervise({ spec, script, engine, ask: mods.askJson });
    } catch {
      /* Supervisor is advisory; lint.normalize repairs invariants next. */
    }
  }

  const linted = mods.normalize(spec);
  spec = applyLookToSpec(linted.spec, input.look, input.drawIn, input.aspect);

  const initialTimeline = buildPaintedTimeline(spec, 540, mods.PLATES);
  await input.onStage?.("objects", {
    script: spec.lines.map((l) => l.say).join("\n"),
    spec,
    timeline: initialTimeline
  });
  await mods.resolveCustom(spec, {
    cacheDir: join(input.workDir, "recipes"),
    apiKey: config.geminiApiKey
  });

  await writeFile(join(input.workDir, "spec.json"), JSON.stringify(spec, null, 2));
  await persistMedia(input.workDir);

  const timeline = buildPaintedTimeline(spec, 540, mods.PLATES);
  return { script: spec.lines.map((l) => l.say).join("\n"), spec, timeline };
}

/**
 * Rewrites specific scenes from user comments (`comments: [{ line, text }]`) in either Step 2 (Storyboard)
 * or Step 3 (Animation), resolves any newly introduced custom props/places, and returns the updated spec & timeline.
 */
export async function applyPaintedSceneChanges(input: {
  spec: PaintedSpec;
  comments: { line: number; text: string }[];
  look: string;
  drawIn: PaintedDrawMode;
  aspect: "9:16" | "16:9";
  workDir: string;
  onStage?: (stage: string) => Promise<void> | void;
}): Promise<{ spec: PaintedSpec; timeline: PaintedTimeline; linesChanged: boolean }> {
  const mods = await loadPaintedModules();
  const engine = mods.engineName();
  await ensureMediaDir(input.workDir);
  await mkdir(join(input.workDir, "recipes"), { recursive: true });

  let spec = structuredClone(input.spec);
  const vocab = mods.directorBrief().split("# Example")[0]!;
  let linesChanged = false;

  await input.onStage?.("directing");
  for (const fix of input.comments) {
    const li = fix.line;
    const line = spec.lines[li];
    if (!line) continue;
    const brief = spec.lines
      .map(
        (l, i) =>
          `${i}${i === li ? " (THE ONE TO FIX)" : ""}: "${l.say}" (scene: ${l.scene ?? ""}) -> ${JSON.stringify(
            (l.shots ?? []).map(({ place, time, weather, ground, room, framing, subjects, props }) => ({
              place,
              time,
              weather,
              ground,
              room,
              framing,
              subjects,
              props
            }))
          )}`
      )
      .join("\n");

    const response = (await mods.askJson({
      engine,
      maxTokens: 16000,
      system: `You repair ONE scene of a painted short film based on the user's request. The spec vocabulary:\n\n${vocab}\n\nReturn JSON with shape {"say":"<keep the exact spoken line unless the user explicitly asked to rewrite the spoken words>","scene":"<updated plain-language description of what is drawn>","shots":[1-3 replacement shots in the spec vocabulary]}. Keep people, clothes and weather/time continuity with surrounding scenes unless the user asked to change them. No prose, no code fence.`,
      user: `Story objects: ${JSON.stringify(spec.objects ?? {})}\n\nThe film, line by line:\n${brief}\n\nFix scene ${li}: ${fix.text}`
    })) as { say?: string; scene?: string; shots?: PaintedShot[] } | PaintedShot[];

    const shots = Array.isArray(response) ? response : Array.isArray(response?.shots) ? response.shots : [];
    if (!shots.length) throw new Error(`Could not update scene ${li + 1}. Try phrasing the change differently.`);

    const before = structuredClone(line.shots ?? []);
    line.shots = shots;
    if (!Array.isArray(response)) {
      if (typeof response.scene === "string" && response.scene.trim()) line.scene = response.scene.trim();
      if (typeof response.say === "string" && response.say.trim() && response.say.trim() !== line.say.trim()) {
        line.say = response.say.trim();
        delete line.audio;
        linesChanged = true;
      }
    }
    try {
      mods.recordEditEvent({
        engine: spec.style || spec.look || "doodle",
        say: line.say,
        scene: line.scene,
        instruction: fix.text,
        shotsBefore: before,
        shotsAfter: shots
      });
    } catch {
      /* Telemetry is non-blocking. */
    }
  }

  const linted = mods.normalize(spec);
  spec = applyLookToSpec(linted.spec, input.look, input.drawIn, input.aspect);

  await input.onStage?.("objects");
  await mods.resolveCustom(spec, {
    cacheDir: join(input.workDir, "recipes"),
    apiKey: config.geminiApiKey
  });

  await writeFile(join(input.workDir, "spec.json"), JSON.stringify(spec, null, 2));
  await persistMedia(input.workDir);

  const timeline = buildPaintedTimeline(spec, 540, mods.PLATES);
  return { spec, timeline, linesChanged };
}

// ---- Sound & Ambience Mixing (matching worker/templates/painted/render.mjs) ----

type AmbienceLayer = { src: string; fx: string; vol: number };

function ambienceFor(shot: PaintedShot): AmbienceLayer[] {
  const out: AmbienceLayer[] = [];
  const place = shot.place ?? "meadow";
  const wx = shot.weather ?? "clear";
  const night = ["night", "dusk"].includes(shot.time ?? "");
  if (["sea", "lake", "shore"].includes(place))
    out.push({ src: "anoisesrc=c=brown:a=0.9", fx: "lowpass=f=420,tremolo=f=0.16:d=0.7", vol: wx === "storm" ? 0.75 : wx === "rain" ? 0.55 : 0.4 });
  if (wx === "rain" || wx === "storm")
    out.push({ src: "anoisesrc=c=pink:a=0.6", fx: "highpass=f=1400,lowpass=f=9000", vol: wx === "storm" ? 0.42 : 0.32 });
  if (wx === "blizzard" || wx === "sandstorm")
    out.push(
      { src: "anoisesrc=c=pink:a=0.8", fx: "bandpass=f=700:width_type=h:w=600,tremolo=f=0.4:d=0.85", vol: 0.5 },
      { src: "anoisesrc=c=white:a=0.5", fx: "highpass=f=3000,tremolo=f=0.3:d=0.7", vol: 0.12 }
    );
  if (wx === "storm") out.push({ src: "anoisesrc=c=brown:a=0.9", fx: "bandpass=f=500:width_type=h:w=400,tremolo=f=0.3:d=0.8", vol: 0.3 });
  if (wx === "snow" || wx === "fog" || wx === "cloudy" || place === "mountains" || place === "hills" || place === "field")
    out.push({ src: "anoisesrc=c=brown:a=0.8", fx: "bandpass=f=350:width_type=h:w=300,tremolo=f=0.1:d=0.8", vol: 0.28 });
  if (["city", "street", "village"].includes(place)) out.push({ src: "anoisesrc=c=brown:a=0.8", fx: "lowpass=f=260", vol: 0.22 });
  if (["meadow", "forest", "field", "road"].includes(place) && !night && wx === "clear")
    out.push({ src: "anoisesrc=c=pink:a=0.5", fx: "bandpass=f=3200:width_type=h:w=1800,tremolo=f=5:d=0.95,tremolo=f=0.25:d=0.8", vol: 0.05 });
  if (place === "interior") {
    out.length = 0;
    out.push(
      { src: "anoisesrc=c=pink:a=0.6", fx: "highpass=f=2500,tremolo=f=11:d=0.9", vol: 0.1 },
      { src: "anoisesrc=c=brown:a=0.8", fx: "lowpass=f=200", vol: 0.12 }
    );
    if (wx === "snow" || wx === "blizzard" || wx === "storm" || wx === "rain")
      out.push({ src: "anoisesrc=c=pink:a=0.6", fx: "lowpass=f=900", vol: 0.12 });
  }
  if (!out.length) out.push({ src: "anoisesrc=c=brown:a=0.8", fx: "lowpass=f=300,tremolo=f=0.12:d=0.6", vol: 0.2 });
  return out;
}

const ACCENTS: Record<string, [string, string, number, number, number][]> = {
  thunder: [
    ["anoisesrc=c=white:a=0.9", "bandpass=f=2200:width_type=h:w=3500,afade=t=out:st=0.05:d=0.5", 0.6, 1.0, 0],
    ["anoisesrc=c=brown:a=0.9", "lowpass=f=450,tremolo=f=11:d=0.45", 3.6, 1.2, 0.05],
    ["anoisesrc=c=pink:a=0.6", "bandpass=f=220:width_type=h:w=240", 2.6, 0.8, 0.2]
  ],
  crash: [
    ["anoisesrc=c=white:a=0.8", "bandpass=f=900:width_type=h:w=1800,afade=t=in:d=0.5", 1.8, 0.7, 0],
    ["anoisesrc=c=brown:a=0.9", "lowpass=f=300", 2.0, 0.9, 0.1]
  ],
  splash: [["anoisesrc=c=white:a=0.8", "lowpass=f=3800", 0.6, 0.6, 0]],
  chime: [["aevalsrc='0.5*sin(2*PI*880*t)*exp(-3*t)+0.3*sin(2*PI*1320*t)*exp(-4*t)':s=48000", "", 2.4, 0.5, 0]],
  bell: [["aevalsrc='0.5*sin(2*PI*392*t)*exp(-1.4*t)+0.3*sin(2*PI*784*t)*exp(-2*t)+0.2*sin(2*PI*1176*t)*exp(-3*t)':s=48000", "", 3.2, 0.5, 0]],
  cheer: [["anoisesrc=c=pink:a=0.7", "bandpass=f=1300:width_type=h:w=1800,tremolo=f=7:d=0.5", 2.6, 0.45, 0]],
  knock: [
    ["aevalsrc='0.9*sin(2*PI*120*t)*exp(-28*t)':s=48000", "", 0.5, 1.0, 0],
    ["aevalsrc='0.9*sin(2*PI*110*t)*exp(-28*t)':s=48000", "", 0.5, 1.0, 0.32]
  ],
  birds: [["aevalsrc='0.3*sin(2*PI*(3200+900*sin(2*PI*10*t))*t)*lt(mod(t,0.7),0.15)*sin(PI*mod(t,0.7)/0.15)':s=48000", "", 3.0, 0.5, 0]]
};

function momentsOf(beats: PaintedTimelineBeat[], i: number) {
  const b = beats[i]!;
  const prev = beats[i - 1];
  const sh = b.shot;
  const has = (s: PaintedShot | undefined, ...k: string[]) => s?.props?.some((p) => k.includes(String(p.kind)));
  const stormy = (s: PaintedShot | undefined) => ["rain", "storm"].includes(String(s?.weather));
  const out = new Map<string, number>();
  const put = (name: string, at: number) => {
    if (!out.has(name)) out.set(name, at);
  };
  for (const f of b.flashes || []) out.set("thunder@" + f, f + 0.2);
  if (sh.weather === "storm" && prev?.shot.weather !== "storm") put("crash", 0.15);
  if (has(sh, "beam", "lamp") && !has(prev?.shot, "beam", "lamp")) put("chime", 0.1);
  if ((sh.subjects ?? []).filter((s) => s.pose === "cheer").length >= 2) put("cheer", 0.2);
  if (["dawn", "morning"].includes(String(sh.time)) && (sh.weather ?? "clear") === "clear" && stormy(prev?.shot)) put("birds", 0.4);
  for (const name of sh.sfx ?? []) if (ACCENTS[name]) put(name, 0.2);
  return [...out].map(([name, at]) => ({ name: name.split("@")[0]!, at: b.t0 + at }));
}

async function generatePaintedMusic(spec: PaintedSpec, workDir: string, musicMood?: string) {
  const existing = ["music.wav", "music.mp3"].map((f) => join(workDir, f)).find((f) => existsSync(f));
  if (existing) {
    spec.audio ??= {};
    spec.audio.music = existing.endsWith(".mp3") ? "music.mp3" : "music.wav";
    return;
  }
  const mods = await loadPaintedModules();
  const engine = mods.engineName();
  const secs = Math.ceil((spec.lines ?? []).reduce((n, l) => n + (l.shots?.length ?? 1) * 3, 0) + 6);
  const model = secs <= 28 ? "lyria-3-clip-preview" : "lyria-3-pro-preview";
  const base = (mood: string) =>
    `Instrumental background music for a ${secs}-second narrated short film. ${mood.replace(/\.$/, "")}. It sits under a narrator: no vocals, no lead melody in the voice range, no big drops. Starts immediately, lifts gently toward the final third, ends on a soft resolved chord.`.slice(
      0,
      600
    );
  const SYNONYMS: [RegExp, string][] = [
    [/\bthunder(ing)?\b/gi, "deep rolling"],
    [/\bstorm(y|s)?\b/gi, "swelling"],
    [/\blightning\b/gi, "bright flashes"],
    [/\btension\b/gi, "anticipation"],
    [/\btense\b/gi, "expectant"],
    [/\bdrums?\b/gi, "low percussion"],
    [/\bdanger(ous)?\b/gi, "uncertainty"],
    [/\bdark(er|ness)?\b/gi, "shadowed"],
    [/\b(fear|scary|menacing|ominous)\b/gi, "mysterious"],
    [/\b(violent|fierce|furious|raging)\b/gi, "powerful"],
    [/\b(war|battle|fight)\b/gi, "struggle"],
    [/\b(death|dying|grief)\b/gi, "farewell"],
    [/\bdry\b/gi, "sparse"]
  ];
  const soften = (m: string) => SYNONYMS.reduce((t, [re, to]) => t.replace(re, to), m);
  const mood0 = musicMood?.trim() || spec.audio?.mood || "gentle, warm, cinematic";
  const soft = soften(mood0);
  const ladder = [
    () => Promise.resolve(base(mood0)),
    ...(soft !== mood0 ? [() => Promise.resolve(base(soft))] : []),
    () => Promise.resolve(base("Warm acoustic guitar and soft strings, slow and hopeful, gentle and cinematic"))
  ];
  const wavFile = join(workDir, "music.wav");
  const mp3File = join(workDir, "music.mp3");
  for (const make of ladder) {
    if (existsSync(wavFile) || existsSync(mp3File)) break;
    try {
      const prompt = await make();
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": config.geminiApiKey },
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({ model, input: prompt, store: false })
      });
      if (!res.ok) continue;
      const p = (await res.json()) as {
        steps?: { content?: { type?: string; data?: string }[] }[];
        outputs?: { type?: string; data?: string }[];
      };
      const part = [...(p.steps ?? []).flatMap((s) => s.content ?? []), ...(p.outputs ?? [])].find((x) => x.type === "audio" && x.data);
      if (!part?.data) continue;
      const bytes = Buffer.from(part.data, "base64");
      const target = bytes.toString("ascii", 0, 4) === "RIFF" ? wavFile : mp3File;
      await writeFile(target, bytes);
    } catch {
      /* Try next gentler prompt in ladder. */
    }
  }
  const got = [wavFile, mp3File].find((f) => existsSync(f));
  spec.audio ??= {};
  if (got) spec.audio.music = got.endsWith(".mp3") ? "music.mp3" : "music.wav";
}

async function mixPaintedAudio(spec: PaintedSpec, timeline: PaintedTimeline, workDir: string) {
  const scratch = await mkdtemp(join(tmpdir(), "painted-mix-"));
  try {
    const total = timeline.duration;
    const beats = timeline.beats;
    const pause = spec.pause ?? 0.3;
    const lead = spec.lead ?? 0.35;
    let cursor = lead;
    const voiceFiles: { file: string; start: number; spoken: number }[] = [];

    for (const line of spec.lines ?? []) {
      const file = line.audio?.file ? resolve(workDir, line.audio.file) : null;
      const spoken = line.audio?.seconds ?? Math.max(1.8, (line.say?.split(/\s+/).length ?? 4) * 0.42);
      if (file && existsSync(file)) voiceFiles.push({ file, start: cursor, spoken });
      cursor += spoken + (line.hold ?? 0) + pause;
    }

    const track = join(scratch, "voice.wav");
    if (voiceFiles.length > 0) {
      const vInputs = voiceFiles.flatMap((v) => ["-i", v.file]);
      const vFilter =
        voiceFiles
          .map((_, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=mono,adelay=${Math.round(voiceFiles[i]!.start * 1000)}:all=1[a${i}]`)
          .join(";") +
        ";" +
        voiceFiles.map((_, i) => `[a${i}]`).join("") +
        `amix=inputs=${voiceFiles.length}:normalize=0,apad=whole_dur=${total.toFixed(3)}[v]`;
      await execFileAsync("ffmpeg", ["-v", "error", "-y", ...vInputs, "-filter_complex", vFilter, "-map", "[v]", "-t", total.toFixed(3), track]);
    }

    const musicFile = spec.audio?.music ? resolve(workDir, spec.audio.music) : null;
    const music = musicFile && existsSync(musicFile) ? musicFile : null;

    const inputs: string[] = [];
    const chains: string[] = [];
    const sfx: string[] = [];
    const acc: string[] = [];
    let n = 0;
    const add = (src: string, fx: string, t0: number, dur: number, vol: number, fade: number, bucket = sfx) => {
      const i = n++;
      inputs.push("-f", "lavfi", "-t", dur.toFixed(2), "-i", src);
      chains.push(
        `[${i}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,${fx ? fx + "," : ""}volume=${vol},afade=t=in:d=${fade},afade=t=out:st=${Math.max(0, dur - fade).toFixed(2)}:d=${fade},adelay=${Math.round(t0 * 1000)}:all=1[s${i}]`
      );
      bucket.push(`[s${i}]`);
    };

    beats.forEach((b, i) => {
      const t0 = Math.max(0, b.t0 - 0.5);
      const dur = Math.max(0.5, b.t1 - t0 + 0.5);
      for (const a of ambienceFor(b.shot)) add(a.src + `:d=${dur.toFixed(2)}:r=48000`, a.fx, t0, dur, a.vol, 0.5);
      if (i > 0)
        add(
          "anoisesrc=c=white:a=0.5:d=0.7:r=48000",
          "bandpass=f=1800:width_type=h:w=1800,afade=t=in:d=0.25",
          Math.max(0, b.t0 - 0.2),
          0.7,
          0.07,
          0.3
        );
      for (const m of momentsOf(beats, i)) {
        for (const [src, fx, secs, vol, off] of ACCENTS[m.name] ?? []) {
          add(src.includes("aevalsrc") ? `${src}:d=${secs}` : `${src}:d=${secs}:r=48000`, fx, m.at + off, secs, vol, Math.min(0.3, secs / 3), acc);
        }
      }
    });

    const bed: string[] = [];
    if (music) {
      const i = n++;
      inputs.push("-stream_loop", "-1", "-i", music);
      chains.push(
        `[${i}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${spec.audio?.musicVolume ?? 0.55},afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, total - 3).toFixed(2)}:d=3,atrim=0:${total.toFixed(2)}[mus]`
      );
      bed.push("[mus]");
    }
    chains.push(`${sfx.join("")}amix=inputs=${sfx.length}:normalize=0,atrim=0:${total.toFixed(2)}[fx]`);
    bed.push("[fx]");
    if (acc.length) chains.push(`${acc.join("")}amix=inputs=${acc.length}:normalize=0,atrim=0:${total.toFixed(2)}[accraw]`);
    let filter = chains.join(";") + `;${bed.join("")}amix=inputs=${bed.length}:normalize=0[bedraw]`;
    if (voiceFiles.length > 0) {
      const v = n++;
      inputs.push("-i", track);
      filter += `;[${v}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asplit=3[vox][key][key2]`;
      filter += `;[bedraw][key]sidechaincompress=threshold=0.015:ratio=12:attack=15:release=450:makeup=1[bed];[bed]volume=0.5[bedq]`;
      if (acc.length) filter += `;[accraw][key2]sidechaincompress=threshold=0.04:ratio=2.5:attack=10:release=200:makeup=1[accq]`;
      else filter += `;[key2]anullsink`;
      filter += `;[vox]volume=1.0[voxq];[voxq][bedq]${acc.length ? "[accq]" : ""}amix=inputs=${acc.length ? 3 : 2}:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[out]`;
    } else {
      filter += `;${acc.length ? "[bedraw][accraw]amix=inputs=2:normalize=0," : "[bedraw]"}loudnorm=I=-16:TP=-1.5:LRA=11[out]`;
    }

    const mixWav = join(scratch, "mix.wav");
    await execFileAsync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", filter, "-map", "[out]", "-ar", "48000", "-t", total.toFixed(3), mixWav], {
      maxBuffer: 1 << 26
    });
    const outM4a = join(workDir, "audio.m4a");
    await execFileAsync("ffmpeg", ["-v", "error", "-y", "-i", mixWav, "-c:a", "aac", "-b:a", "128k", outM4a]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Step 2 -> Step 3: Produces the voiceover per line (cached by voice + line text), background music,
 * mixed `audio.m4a`, and the exact `timeline` for the in-browser Animation player. No video frames are rendered!
 */
export async function producePaintedAnimation(input: {
  spec: PaintedSpec;
  look: string;
  drawIn: PaintedDrawMode;
  aspect: "9:16" | "16:9";
  voice: string;
  musicMood?: string;
  workDir: string;
  onStage?: (stage: string) => Promise<void> | void;
}): Promise<{ spec: PaintedSpec; timeline: PaintedTimeline }> {
  const mods = await loadPaintedModules();
  await ensureMediaDir(input.workDir);
  await mkdir(join(input.workDir, "tts"), { recursive: true });

  const spec = applyLookToSpec(input.spec, input.look, input.drawIn, input.aspect);
  const voice = input.voice || "Charon";

  await input.onStage?.("voice");
  const lines = spec.lines ?? [];
  let nextIdx = 0;
  const workers = Array.from({ length: Math.min(4, lines.length) }, async () => {
    for (let i = nextIdx++; i < lines.length; i = nextIdx++) {
      const line = lines[i]!;
      const hash = createHash("sha1").update(`${voice}:${line.say.trim()}`).digest("hex").slice(0, 12);
      const rel = `tts/${String(i).padStart(2, "0")}-${hash}.wav`;
      const abs = join(input.workDir, rel);
      if (existsSync(abs)) {
        const bytes = await readFile(abs);
        line.audio = { file: rel, seconds: Number(wavDuration(bytes).toFixed(3)) };
      } else {
        const { wav, seconds } = await synthesizeVoiceover(config.geminiApiKey, {
          text: line.say,
          voice,
          style: "Warm, steady storytelling delivery with a calm, unhurried pace."
        });
        await writeFile(abs, wav);
        line.audio = { file: rel, seconds: Number(seconds.toFixed(3)) };
      }
    }
  });
  await Promise.all(workers);

  await input.onStage?.("music");
  await generatePaintedMusic(spec, input.workDir, input.musicMood);

  await input.onStage?.("mixing");
  const timeline = buildPaintedTimeline(spec, 540, mods.PLATES);
  await mixPaintedAudio(spec, timeline, input.workDir);

  await writeFile(join(input.workDir, "spec.json"), JSON.stringify(spec, null, 2));
  await persistMedia(input.workDir);

  return { spec, timeline };
}

/**
 * Packs the project's `workDir` (`spec.json`, `recipes/`, `tts/`, `music.*`) into `painted/<id>/work.tgz`
 * in the outputs bucket so the render worker can immediately paint the approved film without re-running LLMs/TTS.
 */
export async function packPaintedWorkForWorker(targetId: string, workDir: string): Promise<boolean> {
  await ensureMediaDir(workDir);
  if (!existsSync(join(workDir, "spec.json"))) return false;
  const scratch = await mkdtemp(join(tmpdir(), "painted-pack-"));
  try {
    const archive = join(scratch, "work.tgz");
    await execFileAsync("tar", ["-czf", archive, "-C", workDir, "--exclude=frames-cache", "--exclude=frames", "--exclude=audio.m4a", "."]);
    await putOutputFile(`painted/${targetId}/work.tgz`, archive);
    return true;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Hydrates `spec.json`, `timeline` and `audio.m4a` from an existing worker archive (`painted/<jobId>/work.tgz`)
 * so Story films created before the 4-step flow also open with their full storyboard and in-browser animation.
 */
export async function hydrateFromWorkerArchive(jobId: string, workDir: string): Promise<{ spec: PaintedSpec; timeline: PaintedTimeline } | null> {
  const mods = await loadPaintedModules();
  await ensureMediaDir(workDir);
  const specFile = join(workDir, "spec.json");
  if (!existsSync(specFile)) {
    const scratch = await mkdtemp(join(tmpdir(), "painted-hydrate-"));
    try {
      const archive = join(scratch, "work.tgz");
      if (!(await getOutputFile(`painted/${jobId}/work.tgz`, archive))) return null;
      await mkdir(workDir, { recursive: true });
      await execFileAsync("tar", ["-xzf", archive, "-C", workDir]);
    } catch {
      return null;
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
  if (!existsSync(specFile)) return null;
  const spec = JSON.parse(await readFile(specFile, "utf8")) as PaintedSpec;
  for (const line of spec.lines ?? []) {
    if (line.audio?.file && !line.audio.seconds) {
      const wavPath = resolve(workDir, line.audio.file);
      if (existsSync(wavPath)) {
        const bytes = await readFile(wavPath);
        try {
          line.audio.seconds = Number(wavDuration(bytes).toFixed(3));
        } catch {
          /* keep estimate */
        }
      }
    }
  }
  const timeline = buildPaintedTimeline(spec, 540, mods.PLATES);
  if (!existsSync(join(workDir, "audio.m4a"))) {
    try {
      await mixPaintedAudio(spec, timeline, workDir);
    } catch {
      /* Audio mix optional during hydration */
    }
  }
  await writeFile(specFile, JSON.stringify(spec, null, 2));
  await persistMedia(workDir);
  return { spec, timeline };
}
