"use client";

import { useEffect, useRef, useState } from "react";

/** Music moods to pick from; each fills the description, which the person can still edit. */
export const MUSIC_PRESETS: readonly { label: string; prompt: string }[] = [
  { label: "Upbeat tech", prompt: "Upbeat modern electronic with crisp percussion and bright synth plucks" },
  { label: "Calm focus", prompt: "Calm, spacious ambient electronic with soft pads and a gentle pulse" },
  { label: "Cinematic lift", prompt: "Cinematic strings and soft drums that build toward a confident finish" },
  { label: "Playful", prompt: "Playful, bouncy pop-electronic with light plucks and claps" },
  { label: "Warm acoustic", prompt: "Warm acoustic guitar and light percussion, friendly and human" }
];

export const MUSIC_PROMPT_LIMIT = 120;

export interface MusicPickerProps {
  /** The music description the film has now (empty when it uses the style's default feel). */
  current: string;
  /** Writes a description from the film (the Suggest button). */
  onSuggest: () => Promise<string>;
  /** Makes the music from this description; resolves when it is ready. */
  onMake: (prompt: string) => Promise<void>;
}

/** Pick a mood or describe the music, ask for a suggestion that fits the film, then make it. */
export function MusicPicker({ current, onSuggest, onMake }: MusicPickerProps) {
  const [text, setText] = useState(current);
  const [busy, setBusy] = useState<"suggest" | "make" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trimmed = text.trim();
  const changed = trimmed !== current.trim();
  // With no description yet, offer one that fits the film's tone right away; the person can edit it or pick a mood instead.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || current.trim()) return;
    asked.current = true;
    setBusy("suggest");
    onSuggest().then((prompt) => setText((now) => (now.trim() ? now : prompt))).catch(() => undefined).finally(() => setBusy(null));
  }, [current, onSuggest]);

  const run = async (kind: "suggest" | "make", job: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try { await job(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Something went wrong. Try again."); } finally { setBusy(null); }
  };

  return (
    <div className="aw-music" role="group" aria-label="Music">
      <div className="aw-music-presets" role="group" aria-label="Pick a mood">
        {MUSIC_PRESETS.map((preset) => (
          <button key={preset.label} type="button" className={`aw-track-chip${trimmed === preset.prompt ? " on" : ""}`} aria-pressed={trimmed === preset.prompt} disabled={busy !== null} onClick={() => setText(preset.prompt)}>
            {preset.label}
          </button>
        ))}
      </div>
      <label className="aw-music-field">
        <span>Or describe the music</span>
        <textarea value={text} maxLength={MUSIC_PROMPT_LIMIT} rows={2} placeholder="e.g. warm, upbeat electronic that lifts at the end" disabled={busy !== null} onChange={(event) => setText(event.target.value.replace(/\n/g, " "))} />
        <small>{text.length}/{MUSIC_PROMPT_LIMIT}</small>
      </label>
      <div className="aw-music-actions">
        <button type="button" className="aw-track-chip" disabled={busy !== null} onClick={() => void run("suggest", async () => setText(await onSuggest()))} title="Write a description that fits this video">
          {busy === "suggest" ? "Matching the film\u2019s tone…" : "✦ Suggest from the film"}
        </button>
        <button type="button" className="aw-track-chip on" disabled={busy !== null || !trimmed || !changed} onClick={() => void run("make", () => onMake(trimmed))} title="Make new music from this description">
          {busy === "make" ? "Making music…" : changed || !current.trim() ? "Make music" : "Music is ready"}
        </button>
      </div>
      {error && <p className="aw-music-error" role="alert">{error}</p>}
    </div>
  );
}
