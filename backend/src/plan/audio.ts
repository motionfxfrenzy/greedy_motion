import { join } from "node:path";
import { currentTake, voiceText, type AudioMode, type PlanAudio, type VideoProject } from "@videosaas/contracts";
import { config } from "../config.ts";
import { TTS_MODEL } from "../audio/gemini-tts.ts";
import { updateProjectAudio } from "../projects/store.ts";
import { musicPrompt, produceMusic } from "./music.ts";
import { produceVoice, VOICE_RULES, voiceSettings } from "./voice.ts";

/**
 * Generates the plan's sound: the voiceover takes (voice.ts) and the music bed (music.ts) in
 * parallel, then saves them on the project. Runs per project one at a time; a run always starts
 * from the latest saved plan, so takes requested while the storyboard was being edited are made
 * for the current lines. Takes and tracks are cached on disk, so a re-run after one edit only
 * pays for that line.
 */
export const planAudioDir = (projectId: string) => join(config.audioDir, "plans", projectId);

export class AudioUnavailable extends Error {}

export type AudioPart = "voice" | "music";

/** The brief's audio mode (or the plan's, for plans made before briefs carried it). */
export function audioMode(project: Pick<VideoProject, "brief" | "beatPlan">): AudioMode {
  if (project.brief) return project.brief.audio.mode;
  const voice = Boolean(project.beatPlan?.audio.voice);
  const music = Boolean(project.beatPlan?.audio.music);
  return voice && music ? "both" : voice ? "voiceover" : music ? "music" : "none";
}

/** What the storyboard needs to know: which lines speak, which are waiting for a take, and the bed. */
export function audioStatus(project: VideoProject) {
  const mode = audioMode(project);
  const voiced = mode === "voiceover" || mode === "both";
  const lines = voiced ? (project.beatPlan?.beats ?? []).filter((beat) => voiceText(beat.line)) : [];
  const stale = lines.filter((beat) => !currentTake(project.planAudio, beat)).map((beat) => beat.id);
  const music = mode === "music" || mode === "both";
  return {
    mode,
    voice: voiced ? { voice: project.planAudio?.voice?.voice ?? null, lines: lines.length, ready: lines.length - stale.length, stale, aligned: project.planAudio?.voice?.lines.some((line) => line.aligned === "estimate") ? "estimate" : "whisper" } : null,
    music: music ? { ready: Boolean(project.planAudio?.music), model: project.planAudio?.music?.model ?? null, seconds: project.planAudio?.music?.seconds ?? null } : null,
    /** True when every part the brief asks for is generated for the current text. */
    ready: (!voiced || stale.length === 0) && (!music || Boolean(project.planAudio?.music)),
    cost_usd: project.planAudio?.cost_usd ?? 0
  };
}

const chains = new Map<string, Promise<unknown>>();

export type AudioRun = { project: VideoProject; warnings: string[]; spentUsd: number };

/** Produces the requested parts (default: what the brief needs and is not yet generated). */
export function producePlanAudio(projectId: string, load: () => Promise<VideoProject | null>, parts?: AudioPart[]): Promise<AudioRun | null> {
  const previous = chains.get(projectId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const project = await load();
    if (!project) return null;
    return run(project, parts);
  });
  chains.set(projectId, next);
  void next.finally(() => { if (chains.get(projectId) === next) chains.delete(projectId); }).catch(() => undefined);
  return next;
}

async function run(project: VideoProject, requested?: AudioPart[]): Promise<AudioRun> {
  const plan = project.beatPlan;
  if (!plan) throw new AudioUnavailable("Generate the plan first.");
  const mode = audioMode(project);
  const wantVoice = (mode === "voiceover" || mode === "both") && (!requested || requested.includes("voice"));
  const wantMusic = (mode === "music" || mode === "both") && (!requested || requested.includes("music"));
  const jobs = wantVoice ? plan.beats.filter((beat) => voiceText(beat.line)).map((beat) => ({ beat: beat.id, text: beat.line! })) : [];
  if (!jobs.length && !wantMusic) return { project, warnings: [], spentUsd: 0 };
  if (!config.geminiApiKey) throw new AudioUnavailable("Voiceover and music need GEMINI_API_KEY in backend/.env.");

  const dir = planAudioDir(project.id);
  const settings = voiceSettings(project);
  const prompt = musicPrompt(plan, project.brief, plan.target_duration_s);
  const [voice, music] = await Promise.allSettled([
    jobs.length ? produceVoice(config.geminiApiKey, dir, settings, jobs, project.planAudio?.voice?.lines ?? []) : Promise.resolve(null),
    wantMusic ? produceMusic(config.geminiApiKey, dir, prompt, plan.target_duration_s) : Promise.resolve(null)
  ]);
  // The voice is the clock: without it there is nothing to save. A failed bed only warns.
  if (voice.status === "rejected") throw voice.reason instanceof Error ? voice.reason : new Error("The voiceover failed.");
  const warnings: string[] = [];
  if (music.status === "rejected") warnings.push(`Music: ${music.reason instanceof Error ? music.reason.message : "generation failed"}. The film plays without a bed until it is generated.`);
  if (voice.value?.aligned === "estimate") warnings.push("Word timing is estimated inside each measured line (Whisper is not available on this server).");
  const track = music.status === "fulfilled" ? music.value : null;
  const spentUsd = Math.round(((voice.value?.spentSeconds ?? 0) * VOICE_RULES.usdPerSecond + (track?.spentUsd ?? 0)) * 10000) / 10000;

  const saved = await updateProjectAudio(project.id, (current) => {
    const before = current.planAudio;
    const audio: PlanAudio = {
      voice: voice.value
        ? { engine: "gemini-tts", model: TTS_MODEL, voice: settings.voice, direction: settings.direction, pace: settings.pace, lines: voice.value.lines }
        : before?.voice ?? null,
      music: track ? { source: "lyria", model: track.model, prompt: track.prompt, file: track.file, seconds: Math.round(track.seconds * 1000) / 1000 } : before?.music ?? null,
      cost_usd: Math.round(((before?.cost_usd ?? 0) + spentUsd) * 10000) / 10000,
      updatedAt: new Date().toISOString()
    };
    return audio;
  });
  if (!saved) throw new AudioUnavailable("Project not found.");
  return { project: saved, warnings, spentUsd };
}
