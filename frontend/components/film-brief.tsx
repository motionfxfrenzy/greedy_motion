"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { aspects, briefAspects, castOf, DEFAULT_LOOK, defaultStyleExample, DURATION_MIN, durationPresets, findGalleryTemplate, formatDurationSeconds, isFilmTemplate, isNarrator, NARRATOR, OWN_SCRIPT_MAX, parseScriptBrief, PROBLEM_TEXT_MAX, resolveDurationMode, scriptSeconds, toggleBriefAspect, voiceForSpeaker, voiceLanguages, voices, type Aspect, type CaptionMode, type Pace, type ScriptBeat, type ScriptBrief } from "@videosaas/contracts";
import { BrandedSelect } from "./branded-select";
import { StylePicker } from "./style-picker";
import { VoicePickerModal } from "./voice-picker-modal";

function resizeSaid(node: HTMLTextAreaElement) {
  const scroller = node.closest(".fb-doc");
  const prevScroll = scroller ? scroller.scrollTop : 0;
  node.style.height = "auto";
  node.style.height = `${node.scrollHeight}px`;
  if (scroller) scroller.scrollTop = prevScroll;
}

/** A borderless text area that grows with its text, so the script reads like a page and not a form. */
function AutoText({ value, onChange, disabled, label }: { value: string; onChange: (value: string) => void; disabled?: boolean; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    resizeSaid(node);
    if (typeof ResizeObserver === "undefined") return;
    let lastWidth = node.clientWidth;
    const ro = new ResizeObserver(() => {
      if (node.clientWidth !== lastWidth) {
        lastWidth = node.clientWidth;
        resizeSaid(node);
      }
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [value]);
  return <textarea ref={ref} className="fb-said" rows={1} value={value} disabled={disabled} aria-label={label} placeholder="(no line)"
    onChange={(event) => { resizeSaid(event.target); onChange(event.target.value); }} />;
}

/** The script being drafted on the Brief page (the studio's script canvas state). */
export type ScriptDraft = { beats: ScriptBeat[]; streaming: boolean; writing?: number | null; flags?: { beat: number; message: string }[]; error?: string | null };

type VoicePick = "narrator" | "characters" | "none";
const voicePicks: { id: VoicePick; label: string }[] = [{ id: "narrator", label: "Narrator" }, { id: "characters", label: "Narrator + characters" }, { id: "none", label: "No voice" }];
const paceOptions: { id: Pace; label: string; detail: string }[] = [
  { id: "calm", label: "Calm", detail: "~130 wpm" },
  { id: "balanced", label: "Balanced", detail: "~145 wpm" },
  { id: "fast", label: "Fast", detail: "~160 wpm" }
];
const captionOptions: { id: CaptionMode; label: string; detail: string }[] = [
  { id: "key-phrases", label: "Key phrases", detail: "Words that land on beat" },
  { id: "full", label: "Every word", detail: "Full spoken transcript" },
  { id: "none", label: "No captions", detail: "Clean picture only" }
];
const languageSelectOptions = voiceLanguages.map((language) => ({ id: language.id, label: language.label }));
const aspectShape: Record<Aspect, string> = { "16:9": "landscape", "9:16": "portrait", "1:1": "square" };

/**
 * The Brief page for a film (a story or an explainer): the script written right here with the person above a persistent
 * bottom prompt composer, and compact film settings on the right. The script goes to the storyboard (page 2) only when
 * the person continues.
 */
export function FilmBrief({ brief, update, draft, writeDraft, editDraft, stopDraft, continueDraft, continueToStoryboard, hasStoryboard, error }: {
  brief: ScriptBrief;
  update: (patch: Partial<ScriptBrief>) => void;
  draft: ScriptDraft | null;
  /** Writes the script from the idea, or with `instruction` changes it; stays on this page. */
  writeDraft: (instruction?: string) => void;
  editDraft: (index: number, patch: Partial<ScriptBeat>) => void;
  stopDraft: () => void;
  /** Sends the drafted script to the storyboard (page 2), which draws it. */
  continueDraft: () => void;
  continueToStoryboard: () => void;
  hasStoryboard: boolean;
  error: string | null;
  back?: () => void;
}) {
  const own = brief.scriptMode === "own";
  const max = own ? OWN_SCRIPT_MAX : PROBLEM_TEXT_MAX;
  const parsed = parseScriptBrief(brief);
  const durationMode = resolveDurationMode(brief);
  const selectedAspects = briefAspects(brief);
  const lastCustomRef = useRef<number>(
    Number.isSafeInteger(Math.round(brief.durationSeconds)) && Math.round(brief.durationSeconds) >= DURATION_MIN
      ? Math.round(brief.durationSeconds)
      : 30
  );
  const [customDraft, setCustomDraft] = useState<string>(() => String(brief.durationSeconds));
  const customEditingRef = useRef(false);
  useEffect(() => {
    if (Number.isSafeInteger(Math.round(brief.durationSeconds)) && Math.round(brief.durationSeconds) >= DURATION_MIN) {
      lastCustomRef.current = Math.round(brief.durationSeconds);
    }
    if (!customEditingRef.current) {
      setCustomDraft(String(brief.durationSeconds));
    }
  }, [brief.durationSeconds, brief.durationMode]);

  const trimmedCustom = customDraft.trim();
  const customParsedNum =
    trimmedCustom !== "" && /^-?\d+(\.\d+)?$/.test(trimmedCustom) ? Math.round(Number(trimmedCustom)) : NaN;
  const customError =
    durationMode !== "custom"
      ? null
      : trimmedCustom === ""
        ? `Enter a duration (at least ${DURATION_MIN}s).`
        : !Number.isSafeInteger(customParsedNum) || customParsedNum < DURATION_MIN
          ? `Duration must be at least ${DURATION_MIN} seconds.`
          : null;
  const invalid = customError ?? ("error" in parsed ? parsed.error : null);
  const [ask, setAsk] = useState("");
  const [composerTab, setComposerTab] = useState<"ask" | "brief">("ask");
  const [selectedCharacter, setSelectedCharacter] = useState("");
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [voiceModalSpeaker, setVoiceModalSpeaker] = useState<string>(NARRATOR);
  const voiceModalReturnRef = useRef<HTMLElement | null>(null);
  const askRef = useRef<HTMLTextAreaElement>(null);
  const beats = draft?.beats ?? [];
  const streaming = Boolean(draft?.streaming);
  const hasScript = beats.length > 0;
  const isBriefMode = (!hasScript && !streaming) || composerTab === "brief";

  useLayoutEffect(() => {
    const node = askRef.current;
    if (!node || isBriefMode) return;
    if (!ask) {
      node.style.height = "";
      return;
    }
    node.style.height = "auto";
    node.style.height = `${Math.min(124, Math.max(76, node.scrollHeight))}px`;
  }, [ask, isBriefMode]);

  const voiced = brief.audio.mode === "voiceover" || brief.audio.mode === "both";
  const music = brief.audio.mode === "music" || brief.audio.mode === "both";
  const voicePick: VoicePick = !voiced ? "none" : brief.audio.cast === "characters" ? "characters" : "narrator";
  const setSound = (pick: VoicePick, withMusic: boolean) => {
    const mode = pick === "none" ? (withMusic ? "music" : "none") : (withMusic ? "both" : "voiceover");
    const { cast: _cast, ...rest } = brief.audio;
    update({ audio: { ...rest, mode, ...(pick === "characters" ? { cast: "characters" as const } : {}) } });
  };
  const narratorVoice = brief.audio.voice ?? "Kore";
  const narratorVoiceMeta = voices.find((v) => v.id === narratorVoice) ?? voices[0]!;
  const cast = castOf(beats);
  const activeCharacter = (selectedCharacter && cast.includes(selectedCharacter) ? selectedCharacter : cast[0]) ?? "";
  const activeCharacterVoiceId = activeCharacter ? voiceForSpeaker(activeCharacter, narratorVoice, brief.audio.voices) : narratorVoice;
  const activeCharacterVoiceMeta = voices.find((v) => v.id === activeCharacterVoiceId) ?? voices[0]!;
  const speakersMissing = voicePick === "characters" && hasScript && !streaming && cast.length === 0;
  const setCharacterVoice = (name: string, voice: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const keyLower = trimmed.toLowerCase();
    const existingEntries = Object.entries(brief.audio.voices ?? {}).filter(([k]) => k.trim().toLowerCase() !== keyLower);
    const activeCastSet = new Set(cast.map((c) => c.trim().toLowerCase()));
    const activeEntries = existingEntries.filter(([k]) => activeCastSet.has(k.trim().toLowerCase()));
    const inactiveEntries = existingEntries.filter(([k]) => !activeCastSet.has(k.trim().toLowerCase()));
    update({
      audio: {
        ...brief.audio,
        voices: Object.fromEntries([[trimmed, voice], ...activeEntries, ...inactiveEntries])
      }
    });
  };
  const setSpeakerVoice = (speaker: string, voiceId: string) => {
    if (isNarrator(speaker)) {
      update({ audio: { ...brief.audio, voice: voiceId } });
    } else {
      setCharacterVoice(speaker, voiceId);
    }
  };
  const openVoiceModal = (speaker: string, trigger?: HTMLElement | null) => {
    voiceModalReturnRef.current = trigger ?? (typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null);
    const cleanSpeaker = isNarrator(speaker) ? NARRATOR : speaker.trim();
    setVoiceModalSpeaker(cleanSpeaker);
    if (!isNarrator(cleanSpeaker) && cast.includes(cleanSpeaker)) {
      setSelectedCharacter(cleanSpeaker);
    }
    setVoiceModalOpen(true);
  };

  const submitAsk = () => { const text = ask.trim(); if (!text || streaming) return; writeDraft(text); setAsk(""); };
  const submitBrief = () => { if (invalid || streaming) return; setComposerTab("ask"); writeDraft(); };

  return <div className="flow-page script-style film-brief" role="region" aria-label="Film brief">
    <div className="fb-layout">
      <section className="ss-card fb-script" aria-label="Idea and script">
        <header className="fb-script-head">
          <div>
            <b>Idea and script</b>
            <span>{own ? "Your words are kept as written." : "We write it from your idea, in this style's way of telling a story."}</span>
          </div>
          {hasScript && !streaming && <small className="fb-note">The pictures for each line are planned on the storyboard, the next step.</small>}
        </header>

        <div className="fb-cast-bar" aria-label="Voice mode and cast">
          <span className={`fb-mode-pill mode-${voicePick}`}>
            {voicePick === "characters"
              ? "Character dialogue"
              : voicePick === "narrator"
                ? "Narrator-only voiceover"
                : "No voiceover · On-screen text"}
          </span>
          {voiced ? (
            <div className="fb-cast-pills" role="group" aria-label="Speaker voice assignments">
              <button
                type="button"
                className="fb-cast-pill is-narrator"
                disabled={streaming}
                aria-haspopup="dialog"
                aria-label={`Narrator voice: ${narratorVoiceMeta.label}. Click to choose voice`}
                onClick={(e) => openVoiceModal(NARRATOR, e.currentTarget)}
              >
                <span className="fb-cast-pill-role">{NARRATOR}</span>
                <b className="fb-cast-pill-voice">{narratorVoiceMeta.label}</b>
                <i aria-hidden="true">▾</i>
              </button>
              {voicePick === "characters" &&
                cast.map((name) => {
                  const charVoiceId = voiceForSpeaker(name, narratorVoice, brief.audio.voices);
                  return (
                    <button
                      key={name}
                      type="button"
                      className={`fb-cast-pill${activeCharacter === name ? " is-active" : ""}`}
                      disabled={streaming}
                      aria-haspopup="dialog"
                      aria-label={`${name} voice: ${charVoiceId}. Click to choose voice`}
                      onClick={(e) => {
                        setSelectedCharacter(name);
                        openVoiceModal(name, e.currentTarget);
                      }}
                    >
                      <span className="fb-cast-pill-role">{name}</span>
                      <b className="fb-cast-pill-voice">{charVoiceId}</b>
                      <i aria-hidden="true">▾</i>
                    </button>
                  );
                })}
            </div>
          ) : (
            <small className="fb-cast-silent-note">
              Lines below appear as on-screen captions{music ? " over background music" : ""}.
            </small>
          )}
        </div>

        {/* The script, read as a script: the spoken lines (or, with no voice, the words on screen). The key phrase and the
            picture of each beat are kept for the storyboard, which plans the visuals on the next page. */}
        <div className="fb-doc" aria-live="polite">
          {(hasScript || streaming) ? <>
            {beats.map((beat, index) => {
              const characters = voicePick === "characters" && voiced;
              const said = voiced ? beat.line ?? "" : [beat.keyword, beat.onScreen].filter(Boolean).join(". ");
              const lineSpeaker = characters && beat.speaker && !isNarrator(beat.speaker) ? beat.speaker.trim() : NARRATOR;
              const lineVoice = voiceForSpeaker(lineSpeaker, narratorVoice, brief.audio.voices);
              return <div key={index} className={draft?.writing === index ? "fb-para writing" : "fb-para"}>
                {characters ? (
                  <div className="fb-who-cell">
                    <input
                      className={beat.speaker && !isNarrator(beat.speaker) ? "fb-who" : "fb-who narrator"}
                      list="fb-cast"
                      value={beat.speaker ?? ""}
                      maxLength={24}
                      placeholder={NARRATOR}
                      onChange={(event) => editDraft(index, { speaker: event.target.value.trim() ? event.target.value : null })}
                      aria-label={`Who says line ${index + 1}`}
                      disabled={streaming}
                      title={beat.speaker ?? NARRATOR}
                    />
                    <button
                      type="button"
                      className="fb-line-voice"
                      disabled={streaming}
                      aria-haspopup="dialog"
                      aria-label={`Voice for ${lineSpeaker} on line ${index + 1}: ${lineVoice}`}
                      title={`Voice for ${lineSpeaker}: ${lineVoice} — click to preview or change`}
                      onClick={(e) => {
                        if (!isNarrator(lineSpeaker)) setSelectedCharacter(lineSpeaker);
                        openVoiceModal(lineSpeaker, e.currentTarget);
                      }}
                    >
                      <span>{lineVoice}</span>
                      <i aria-hidden="true">▾</i>
                    </button>
                  </div>
                ) : voiced ? (
                  <button
                    type="button"
                    className="fb-who-pill narrator"
                    disabled={streaming}
                    aria-haspopup="dialog"
                    aria-label={`Line ${index + 1} speaker: ${NARRATOR} (${narratorVoice})`}
                    title={`Spoken by ${NARRATOR} (${narratorVoice}) — click to change voice`}
                    onClick={(e) => openVoiceModal(NARRATOR, e.currentTarget)}
                  >
                    <span className="fb-who-pill-name">{NARRATOR}</span>
                    <span className="fb-who-pill-voice">{narratorVoice} ▾</span>
                  </button>
                ) : (
                  <span className="fb-who-pill silent" title={`Scene ${index + 1} on-screen text`}>
                    On screen
                  </span>
                )}
                <AutoText value={said} disabled={streaming} label={`Line ${index + 1}`} onChange={(value) => editDraft(index, voiced ? { line: value || null } : { keyword: value.slice(0, 28) })} />
                {draft?.flags?.filter((flag) => flag.beat === index).map((flag) => <small key={flag.message} className="fb-flag">{flag.message}</small>)}
              </div>;
            })}
            {streaming && <p className="fb-para pending"><small>Writing the script…</small></p>}
          </> : <div className="fb-empty">
            <b>Your script will appear here</b>
            <p>{own ? "Paste your script in the composer below and click Write script to break it into editable lines." : "Describe the film idea in the composer below and click Write script. You can edit any line directly or ask for changes afterward."}</p>
          </div>}
        </div>

        {voicePick === "characters" && <datalist id="fb-cast">{[NARRATOR, ...cast].map((name) => <option key={name} value={name} />)}</datalist>}

        <div className="fb-composer">
          {draft?.error && <p className="fb-error" role="alert">{draft.error}</p>}
          <div className="fb-composer-bar">
            <div className="source-tabs">
              {(hasScript || streaming) && <button type="button" className={!isBriefMode ? "selected" : ""} onClick={() => setComposerTab("ask")}>Ask for a change</button>}
              <button type="button" className={isBriefMode && !own ? "selected" : ""} onClick={() => { update({ scriptMode: "problem" }); setComposerTab("brief"); }}>Describe the idea</button>
              <button type="button" className={isBriefMode && own ? "selected" : ""} onClick={() => { update({ scriptMode: "own" }); setComposerTab("brief"); }}>Paste my script</button>
            </div>
            {!isBriefMode && !streaming && <button type="button" className="secondary-button fb-regen-btn" disabled={Boolean(invalid)} onClick={submitBrief}>Write it again</button>}
          </div>

          {!isBriefMode ? (
            <form className="fb-ask" onSubmit={(event) => { event.preventDefault(); submitAsk(); }}>
              <textarea
                ref={askRef}
                className="fb-ask-input"
                rows={3}
                value={ask}
                disabled={streaming}
                onChange={(event) => setAsk(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    submitAsk();
                  }
                }}
                placeholder={streaming ? "Writing the script…" : "Ask for a change: make the teapot grumpier, add a twist at the end…"}
                aria-label="Ask for a change to the script"
              />
              {streaming
                ? <button type="button" className="secondary-button" onClick={stopDraft}>Stop</button>
                : <button type="submit" className="secondary-button" disabled={!ask.trim()}>Change</button>}
            </form>
          ) : (
            <div className="fb-brief-entry">
              <textarea className="script-prompt" value={brief.text} maxLength={max} rows={own ? 3 : 2} disabled={streaming} onChange={(event) => update({ text: event.target.value })} aria-label={own ? "Your script" : "Your idea"} placeholder={own ? "Paste your script. One sentence per idea works best." : "A coffee pot that dances on the counter every morning, until one day…"} />
              <div className="fb-actions">
                <small>{brief.text.length}/{max}</small>
                {streaming
                  ? <button type="button" className="secondary-button" onClick={stopDraft}>Stop</button>
                  : <button type="button" className={hasScript ? "secondary-button" : "primary-button"} disabled={Boolean(invalid)} onClick={submitBrief}>{hasScript ? "Write it again" : "Write script"}</button>}
              </div>
            </div>
          )}
        </div>
      </section>

      <aside className="ss-card fb-panel" aria-label="Film settings">
        <div className="fb-style">
          <StylePicker
            compact
            scope="film"
            value={brief.look ?? DEFAULT_LOOK}
            family={brief.styleFamily}
            example={brief.styleExample}
            onChange={(look, styleFamily, example) => {
              const sameStyle = styleFamily === brief.styleFamily && look === (brief.look ?? DEFAULT_LOOK);
              const currentTpl = findGalleryTemplate(brief.styleExample);
              const keepCurrent = sameStyle && Boolean(currentTpl && isFilmTemplate(currentTpl) && currentTpl.look === look);
              const nextExample = example ?? (keepCurrent ? brief.styleExample : defaultStyleExample(styleFamily ?? look, { scope: "film", plates: true }));
              update({
                look,
                styleFamily,
                ...(nextExample ? { styleExample: nextExample } : { styleExample: undefined })
              });
            }}
          />
        </div>

        <div className="fb-sound" aria-label="Sound">
          <div className="fb-section-head">
            <b className="fb-section-title">Sound &amp; voice</b>
            <label className="fb-toggle"><input type="checkbox" checked={music} onChange={(event) => setSound(voicePick, event.target.checked)} /><span>Music</span></label>
          </div>
          <div className="fb-row fb-sound-top">
            <div className="ss-chips" role="radiogroup" aria-label="Voice">{voicePicks.map((pick) => <button type="button" role="radio" aria-checked={voicePick === pick.id} key={pick.id} className={voicePick === pick.id ? "selected" : ""} onClick={() => setSound(pick.id, music)}>{pick.label}</button>)}</div>
          </div>
          {(voiced || music) && <div className="fb-row fb-selects">
            {voiced && (
              <div className="fb-field">
                <span>{voicePick === "characters" ? "Narrator voice" : "Voice"}</span>
                <button
                  type="button"
                  className="gm-voice-trigger"
                  aria-haspopup="dialog"
                  aria-label={voicePick === "characters" ? "Narrator voice" : "Voice"}
                  onClick={(e) => openVoiceModal(NARRATOR, e.currentTarget)}
                >
                  <span className="gm-voice-trigger-copy">
                    <b>{narratorVoiceMeta.label}</b>
                    <small>· {narratorVoiceMeta.character}</small>
                  </span>
                  <span className="gm-voice-trigger-badge">{voices.length} ▾</span>
                </button>
              </div>
            )}
            {voiced && (
              <div className="fb-field">
                <span>Language</span>
                <BrandedSelect
                  ariaLabel="Language"
                  value={brief.audio.language ?? "en"}
                  options={languageSelectOptions}
                  onChange={(val) => update({ audio: { ...brief.audio, language: val === "en" ? undefined : val } })}
                />
              </div>
            )}
            <div className={!voiced && !music ? "fb-field fb-grow" : "fb-field"}>
              <span>Captions</span>
              <BrandedSelect
                ariaLabel="Captions"
                value={brief.captions}
                options={captionOptions}
                onChange={(val) => update({ captions: val })}
              />
            </div>
            {music && <label className="fb-field"><span>Music mood</span><input value={brief.audio.musicMood ?? ""} maxLength={60} onChange={(event) => update({ audio: { ...brief.audio, musicMood: event.target.value || undefined } })} placeholder="Playful, light, warm" /></label>}
          </div>}
          {voicePick === "characters" && voiced && cast.length > 0 && activeCharacter && <div className="fb-row fb-cast" aria-label="Character voices">
            <div className="fb-field fb-cast-pick">
              <span>Character ({cast.length})</span>
              <BrandedSelect
                ariaLabel="Character"
                value={activeCharacter}
                showBadgeInTrigger={false}
                options={cast.map((name) => ({
                  id: name,
                  label: name,
                  badge: voiceForSpeaker(name, narratorVoice, brief.audio.voices)
                }))}
                onChange={(val) => setSelectedCharacter(val)}
              />
            </div>
            <div className="fb-field fb-cast-voice">
              <span>{activeCharacter}&apos;s voice</span>
              <button
                type="button"
                className="gm-voice-trigger"
                aria-haspopup="dialog"
                aria-label={`${activeCharacter}'s voice`}
                onClick={(e) => openVoiceModal(activeCharacter, e.currentTarget)}
              >
                <span className="gm-voice-trigger-copy">
                  <b>{activeCharacterVoiceMeta.label}</b>
                  <small>· {activeCharacterVoiceMeta.character}</small>
                </span>
                <span className="gm-voice-trigger-badge">▾</span>
              </button>
            </div>
          </div>}
          {speakersMissing && <p className="fb-hint">This script has no character lines yet. <button type="button" className="link-button" onClick={() => writeDraft("Give the story's characters their own spoken lines: mark who says each line with SPEAKER, keep the narrator for setting the scene.")}>Give the characters lines</button></p>}
          {voicePick === "characters" && !hasScript && <p className="fb-hint">The script will mark who says each line; each character gets a voice of its own.</p>}
        </div>

        <div className="fb-shape" aria-label="Length and shape">
          <div className="fb-row fb-shape-durations">
            <div className="fb-section-head">
              <b className="fb-section-title">Length</b>
            </div>
            <div className="ss-chips fb-duration-chips" role="group" aria-label="Length">
              {durationPresets.map((seconds) => {
                const isSelected = durationMode === "preset" && brief.durationSeconds === seconds;
                return (
                  <button
                    type="button"
                    key={seconds}
                    aria-pressed={isSelected}
                    className={isSelected ? "selected" : ""}
                    onClick={() => {
                      customEditingRef.current = false;
                      lastCustomRef.current = seconds;
                      setCustomDraft(String(seconds));
                      update({ durationMode: "preset", durationSeconds: seconds });
                    }}
                  >
                    {seconds}s
                  </button>
                );
              })}
              <button
                type="button"
                aria-pressed={durationMode === "script"}
                className={durationMode === "script" ? "selected" : ""}
                title="Let the script determine the runtime"
                onClick={() => {
                  customEditingRef.current = false;
                  setCustomDraft(String(brief.durationSeconds));
                  update({ durationMode: "script", lockDuration: undefined });
                }}
              >
                Let script decide
              </button>
              <label
                className={`ss-custom fb-custom${durationMode === "custom" ? " selected" : ""}${customError ? " invalid" : ""}`}
                onClick={() => {
                  if (durationMode !== "custom") {
                    const nextSec = lastCustomRef.current;
                    setCustomDraft(String(nextSec));
                    update({ durationMode: "custom", durationSeconds: nextSec });
                  }
                }}
              >
                <span>Custom</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={customDraft}
                  aria-label="Custom duration in seconds"
                  aria-invalid={Boolean(customError)}
                  onFocus={() => {
                    customEditingRef.current = true;
                    if (durationMode !== "custom") {
                      update({ durationMode: "custom", durationSeconds: lastCustomRef.current });
                    }
                  }}
                  onChange={(event) => {
                    customEditingRef.current = true;
                    const raw = event.target.value;
                    setCustomDraft(raw);
                    const clean = raw.trim();
                    if (/^-?\d+(\.\d+)?$/.test(clean)) {
                      const n = Math.round(Number(clean));
                      if (Number.isSafeInteger(n) && n >= DURATION_MIN) {
                        lastCustomRef.current = n;
                        update({ durationMode: "custom", durationSeconds: n });
                        return;
                      }
                    }
                    if (durationMode !== "custom") {
                      update({ durationMode: "custom" });
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                  onBlur={() => {
                    customEditingRef.current = false;
                    const clean = customDraft.trim();
                    if (/^-?\d+(\.\d+)?$/.test(clean)) {
                      const n = Math.round(Number(clean));
                      if (Number.isSafeInteger(n) && n >= DURATION_MIN) {
                        lastCustomRef.current = n;
                        setCustomDraft(String(n));
                      }
                    }
                  }}
                />
                <span>s</span>
              </label>
            </div>
            <small className={customError ? "fb-shape-hint is-error" : "fb-shape-hint"} role={customError ? "alert" : undefined}>
              {customError
                ? customError
                : durationMode === "script"
                  ? hasScript
                    ? `~${formatDurationSeconds(scriptSeconds(beats, brief.pace))} from script`
                    : "Length follows your script"
                  : `Target ${formatDurationSeconds(brief.durationSeconds)}`}
            </small>
          </div>
          <div className="fb-row fb-shape-bottom">
            <div className="fb-aspect-group">
              <div className="fb-label-row">
                <span className="fb-field-label">Format</span>
                <small className="fb-format-hint">Select one or more</small>
              </div>
              <div className="ss-chips fb-aspect-chips" role="group" aria-label="Aspect ratio">
                {aspects.map((aspect) => {
                  const isSelected = selectedAspects.includes(aspect);
                  const isPrimary = brief.aspect === aspect;
                  const isOnly = isSelected && selectedAspects.length === 1;
                  return (
                    <button
                      type="button"
                      key={aspect}
                      aria-pressed={isSelected}
                      className={isSelected ? (isPrimary && selectedAspects.length > 1 ? "selected primary" : "selected") : ""}
                      title={
                        isOnly
                          ? `${aspect} selected (at least one format required)`
                          : isSelected
                            ? `${aspect} selected${isPrimary && selectedAspects.length > 1 ? " (primary preview)" : ""} — click to deselect`
                            : `Select ${aspect} format`
                      }
                      onClick={() => update(toggleBriefAspect(brief, aspect))}
                    >
                      <i className={"ss-shape " + aspectShape[aspect]} />
                      {aspect}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="fb-inline fb-pace-field">
              <span className="fb-field-label">Pace</span>
              <BrandedSelect
                ariaLabel="Pace"
                value={brief.pace}
                options={paceOptions}
                onChange={(val) => update({ pace: val })}
              />
            </div>
          </div>
        </div>

        <div className="fb-cta">
          <span className={invalid || error ? "" : "ready"}><i />{error ?? invalid ?? (streaming ? "Writing your script…" : hasScript ? "Edit any line, or ask for a change. The storyboard is drawn from this script." : "Write the script first, then build the storyboard from it.")}</span>
          <div className="fb-cta-buttons">
            <button type="button" className="primary-button" disabled={!hasScript || streaming || Boolean(invalid)} onClick={continueDraft}>{hasStoryboard ? "Build storyboard again" : "Build storyboard"}</button>
            {hasStoryboard && <button type="button" className="secondary-button" onClick={continueToStoryboard}>Open storyboard</button>}
          </div>
        </div>
      </aside>
    </div>

    <VoicePickerModal
      open={voiceModalOpen}
      targetSpeaker={voiceModalSpeaker}
      onChangeSpeaker={(nextSpeaker) => {
        setVoiceModalSpeaker(nextSpeaker);
        if (!isNarrator(nextSpeaker) && cast.includes(nextSpeaker)) {
          setSelectedCharacter(nextSpeaker);
        }
      }}
      castMode={voicePick === "characters" ? "characters" : "narrator"}
      cast={cast}
      narratorVoice={narratorVoice}
      characterVoices={brief.audio.voices}
      language={brief.audio.language ?? "en"}
      onSelectVoice={setSpeakerVoice}
      onClose={() => setVoiceModalOpen(false)}
      returnFocusEl={voiceModalReturnRef.current}
    />
  </div>;
}

