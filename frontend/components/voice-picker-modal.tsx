"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import {
  isNarrator,
  NARRATOR,
  voiceForSpeaker,
  voiceLanguages,
  voices
} from "@videosaas/contracts";
import { voicePreviewUrl } from "../lib/api";

export type VoiceOption = (typeof voices)[number];

type ToneGroup = "all" | "warm" | "calm" | "bright" | "firm";

const TONE_GROUPS: { id: ToneGroup; label: string; match: RegExp }[] = [
  { id: "all", label: `All (${voices.length})`, match: /.*/ },
  { id: "warm", label: "Warm & Smooth", match: /warm|smooth|storytelling|gentle|kind|breezy/i },
  { id: "calm", label: "Calm & Steady", match: /calm|steady|informative|balanced|even|relaxed|easygoing|poised|soft/i },
  { id: "bright", label: "Bright & Upbeat", match: /upbeat|bright|energetic|youthful|friendly|expressive|clear/i },
  { id: "firm", label: "Firm & Deep", match: /firm|confident|deep|mature|resonant|assured|articulate|knowledgeable/i }
];

export type VoicePickerModalProps = {
  open: boolean;
  /** Who is currently being configured: "Narrator" or a character name from the script. */
  targetSpeaker: string;
  /** Switches which speaker is being configured inside the modal. */
  onChangeSpeaker?: (speaker: string) => void;
  /** "narrator" (single voiceover) or "characters" (narrator + character voices). */
  castMode: "narrator" | "characters";
  /** Speaking characters in the script (`castOf(beats)`). */
  cast: readonly string[];
  /** Current narrator voice ID (e.g. "Kore"). */
  narratorVoice: string;
  /** Custom voice picks keyed by character name (`brief.audio.voices`). */
  characterVoices?: Record<string, string>;
  /** Currently selected narration language ID ("en", "hi", etc.). */
  language?: string;
  /** Called when the user selects a voice for the active speaker (`targetSpeaker`). */
  onSelectVoice: (speaker: string, voiceId: string) => void;
  /** Closes the modal. */
  onClose: () => void;
  /** Optional trigger element to restore focus to when closing. */
  returnFocusEl?: HTMLElement | null;
  /** Optional custom URL builder for testing/fixtures; defaults to `voicePreviewUrl`. */
  sampleUrlFor?: (voiceId: string) => string;
};

export function VoicePickerModal({
  open,
  targetSpeaker,
  onChangeSpeaker,
  castMode,
  cast,
  narratorVoice,
  characterVoices,
  language = "en",
  onSelectVoice,
  onClose,
  returnFocusEl,
  sampleUrlFor = voicePreviewUrl
}: VoicePickerModalProps) {
  const reactId = useId();
  const titleId = `voice-modal-title-${reactId}`;
  const descId = `voice-modal-desc-${reactId}`;

  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playTokenRef = useRef(0);

  const [query, setQuery] = useState("");
  const [toneGroup, setToneGroup] = useState<ToneGroup>("all");
  const [loadingVoiceId, setLoadingVoiceId] = useState<string | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [errorsByVoice, setErrorsByVoice] = useState<Record<string, string>>({});

  const configuringNarrator = isNarrator(targetSpeaker);
  const displaySpeaker = configuringNarrator ? NARRATOR : targetSpeaker.trim();
  const activeVoiceId = configuringNarrator
    ? narratorVoice
    : voiceForSpeaker(displaySpeaker, narratorVoice, characterVoices);

  const hasExplicitCharacterPick = useMemo(() => {
    if (configuringNarrator || !characterVoices) return false;
    const key = displaySpeaker.toLowerCase();
    return Object.entries(characterVoices).some(
      ([k, v]) => k.trim().toLowerCase() === key && Boolean(v)
    );
  }, [characterVoices, configuringNarrator, displaySpeaker]);

  const allSpeakers = useMemo(() => {
    if (castMode !== "characters") return [NARRATOR];
    const list = [NARRATOR, ...cast];
    if (!configuringNarrator && !list.some((s) => s.toLowerCase() === displaySpeaker.toLowerCase())) {
      list.push(displaySpeaker);
    }
    return list;
  }, [cast, castMode, configuringNarrator, displaySpeaker]);

  /** Map of voiceId -> list of other speakers using this voice so users can tell voices apart. */
  const usedByOtherSpeakers = useMemo(() => {
    const map = new Map<string, string[]>();
    if (castMode !== "characters") return map;
    for (const sp of allSpeakers) {
      if (sp.toLowerCase() === displaySpeaker.toLowerCase()) continue;
      const vId = isNarrator(sp) ? narratorVoice : voiceForSpeaker(sp, narratorVoice, characterVoices);
      const list = map.get(vId) ?? [];
      list.push(sp);
      map.set(vId, list);
    }
    return map;
  }, [allSpeakers, castMode, characterVoices, displaySpeaker, narratorVoice]);

  const stopAndReleaseAudio = useCallback(() => {
    playTokenRef.current += 1;
    const current = audioRef.current;
    if (current) {
      current.onplaying = null;
      current.onended = null;
      current.onerror = null;
      current.onpause = null;
      try {
        current.pause();
        current.removeAttribute("src");
        current.load();
      } catch {
        // Ignore cleanup errors on detached media elements
      }
      audioRef.current = null;
    }
    setLoadingVoiceId(null);
    setPlayingVoiceId(null);
  }, []);

  // Stop audio when switching speakers
  const prevSpeakerRef = useRef(displaySpeaker);
  useEffect(() => {
    if (prevSpeakerRef.current !== displaySpeaker) {
      prevSpeakerRef.current = displaySpeaker;
      stopAndReleaseAudio();
    }
  }, [displaySpeaker, stopAndReleaseAudio]);

  // Stop audio on unmount
  useEffect(() => {
    return () => {
      stopAndReleaseAudio();
    };
  }, [stopAndReleaseAudio]);

  const restoreFocus = useCallback(() => {
    const target = returnFocusEl ?? previousFocusRef.current;
    if (target && typeof target.focus === "function" && document.contains(target)) {
      requestAnimationFrame(() => {
        target.focus();
      });
    }
  }, [returnFocusEl]);

  const handleClose = useCallback(() => {
    stopAndReleaseAudio();
    const dlg = dialogRef.current;
    if (dlg?.open) {
      dlg.close();
    }
    onClose();
    restoreFocus();
  }, [onClose, restoreFocus, stopAndReleaseAudio]);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open) {
      previousFocusRef.current = (returnFocusEl ?? (document.activeElement as HTMLElement | null)) || null;
      setQuery("");
      setToneGroup("all");
      if (!dlg.open) {
        try {
          dlg.showModal();
        } catch {
          dlg.setAttribute("open", "");
        }
      }
      // Focus the currently selected card's Choose button or the search input
      requestAnimationFrame(() => {
        const selectedBtn = dlg.querySelector<HTMLElement>(
          `[data-voice-card="${activeVoiceId}"] [data-voice-choose]`
        );
        const fallback = dlg.querySelector<HTMLElement>("input[type='search'], button");
        (selectedBtn ?? fallback)?.focus();
      });
    } else {
      stopAndReleaseAudio();
      if (dlg.open) {
        try {
          dlg.close();
        } catch {
          dlg.removeAttribute("open");
        }
      }
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSample = useCallback(
    (voiceId: string) => {
      if (playingVoiceId === voiceId || loadingVoiceId === voiceId) {
        stopAndReleaseAudio();
        return;
      }

      stopAndReleaseAudio();
      const token = playTokenRef.current;
      setLoadingVoiceId(voiceId);
      setErrorsByVoice((prev) => {
        if (!prev[voiceId]) return prev;
        const next = { ...prev };
        delete next[voiceId];
        return next;
      });

      let audio: HTMLAudioElement;
      try {
        audio = new Audio(sampleUrlFor(voiceId));
        audio.preload = "auto";
      } catch {
        setLoadingVoiceId(null);
        setErrorsByVoice((prev) => ({
          ...prev,
          [voiceId]: "Sample preview unavailable right now."
        }));
        return;
      }

      audioRef.current = audio;

      const failSample = (reason?: string) => {
        if (playTokenRef.current !== token) return;
        if (audioRef.current === audio) {
          audioRef.current = null;
        }
        setLoadingVoiceId(null);
        setPlayingVoiceId(null);
        setErrorsByVoice((prev) => ({
          ...prev,
          [voiceId]: reason || "Sample preview unavailable right now."
        }));
      };

      audio.onplaying = () => {
        if (playTokenRef.current !== token) return;
        setLoadingVoiceId(null);
        setPlayingVoiceId(voiceId);
      };

      audio.onended = () => {
        if (playTokenRef.current !== token) return;
        if (audioRef.current === audio) {
          audioRef.current = null;
        }
        setLoadingVoiceId(null);
        setPlayingVoiceId(null);
      };

      audio.onerror = () => {
        failSample("Sample preview unavailable right now.");
      };

      try {
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch(() => {
            failSample("Sample preview unavailable right now.");
          });
        }
      } catch {
        failSample("Sample preview unavailable right now.");
      }
    },
    [loadingVoiceId, playingVoiceId, sampleUrlFor, stopAndReleaseAudio]
  );

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      handleClose();
      return;
    }

    if (event.key === "Tab") {
      const dlg = dialogRef.current;
      if (!dlg) return;
      const focusable = Array.from(
        dlg.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (!active || active === first || !dlg.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (!active || active === last || !dlg.contains(active)) {
          event.preventDefault();
          first.focus();
        }
      }
    }
  };

  const needle = query.trim().toLowerCase();
  const activeToneRule = TONE_GROUPS.find((g) => g.id === toneGroup) ?? TONE_GROUPS[0]!;
  const filteredVoices = useMemo(() => {
    return voices.filter((v) => {
      const matchesTone = toneGroup === "all" || activeToneRule.match.test(v.character);
      const matchesQuery =
        !needle ||
        v.label.toLowerCase().includes(needle) ||
        v.id.toLowerCase().includes(needle) ||
        v.character.toLowerCase().includes(needle);
      return matchesTone && matchesQuery;
    });
  }, [activeToneRule, needle, toneGroup]);

  const languageMeta = voiceLanguages.find((l) => l.id === language) ?? voiceLanguages[0]!;
  const isNonEnglish = language !== "en";
  const currentVoiceMeta = voices.find((v) => v.id === activeVoiceId) ?? voices[0]!;

  return (
    <dialog
      ref={dialogRef}
      className="voice-dialog"
      aria-labelledby={titleId}
      aria-describedby={descId}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        handleClose();
      }}
      onKeyDown={handleDialogKeyDown}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          handleClose();
        }
      }}
    >
      <div className="theme-dialog-inner voice-dialog-inner">
        <header className="theme-dialog-header voice-dialog-header">
          <div className="voice-dialog-heading">
            <div className="voice-dialog-eyebrow-row">
              <span className="eyebrow">{voices.length} prebuilt voices</span>
              <span className="voice-sample-lang-pill">Sample audio: English</span>
            </div>
            <h2 id={titleId}>Choose a voice for {displaySpeaker}</h2>
            <p id={descId}>
              {configuringNarrator ? (
                <>
                  Currently using <b>{currentVoiceMeta.label}</b> ({currentVoiceMeta.character}) for{" "}
                  <b>{NARRATOR}</b>. Play any sample to compare tone, then choose a voice.
                </>
              ) : (
                <>
                  Configuring character <b>{displaySpeaker}</b> · currently{" "}
                  <b>{currentVoiceMeta.label}</b> ({currentVoiceMeta.character}
                  {hasExplicitCharacterPick ? ", custom pick" : ", auto-assigned"}).{" "}
                  {NARRATOR} stays set to <b>{narratorVoice}</b>.
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            className="voice-close"
            onClick={handleClose}
            aria-label="Close voice picker"
          >
            ✕
          </button>
        </header>

        {castMode === "characters" && allSpeakers.length > 1 && (
          <div className="voice-speaker-bar" role="tablist" aria-label="Speaker being configured">
            <span className="voice-speaker-bar-label">Speaker:</span>
            {allSpeakers.map((sp) => {
              const isCurrentSpeaker = sp.toLowerCase() === displaySpeaker.toLowerCase();
              const spVoice = isNarrator(sp)
                ? narratorVoice
                : voiceForSpeaker(sp, narratorVoice, characterVoices);
              return (
                <button
                  key={sp}
                  type="button"
                  role="tab"
                  aria-selected={isCurrentSpeaker}
                  className={`voice-speaker-tab${isCurrentSpeaker ? " is-active" : ""}`}
                  onClick={() => onChangeSpeaker?.(sp)}
                >
                  <span className="voice-speaker-tab-role">
                    {isNarrator(sp) ? "Narrator" : sp}
                  </span>
                  <small className="voice-speaker-tab-voice">{spVoice}</small>
                </button>
              );
            })}
          </div>
        )}

        {isNonEnglish && (
          <div className="voice-lang-notice" role="note">
            <span>
              <b>Sample language note:</b> Voice previews play a short <b>English</b> sample so you can compare timbre and delivery. Your script lines will be spoken in <b>{languageMeta.label}</b>.
            </span>
          </div>
        )}

        <div className="voice-dialog-tools">
          <input
            className="gallery-search voice-search"
            type="search"
            value={query}
            placeholder={`Search all ${voices.length} voices by name or tone (e.g. warm, calm, energetic)…`}
            aria-label="Search voices"
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="style-filters voice-tone-filters" role="group" aria-label="Filter voices by tone">
            {TONE_GROUPS.map((group) => (
              <button
                type="button"
                key={group.id}
                aria-pressed={toneGroup === group.id}
                onClick={() => setToneGroup(group.id)}
              >
                {group.label}
              </button>
            ))}
          </div>
        </div>

        {filteredVoices.length === 0 ? (
          <div className="voice-empty" role="status">
            <p>No voices match &ldquo;{query.trim()}&rdquo; in this filter.</p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setQuery("");
                setToneGroup("all");
              }}
            >
              Show all {voices.length} voices
            </button>
          </div>
        ) : (
          <div
            className="voice-grid"
            role="region"
            aria-label={`Available voices for ${displaySpeaker}`}
          >
            {filteredVoices.map((voice) => {
              const isSelected = voice.id === activeVoiceId;
              const isLoading = loadingVoiceId === voice.id;
              const isPlaying = playingVoiceId === voice.id;
              const sampleError = errorsByVoice[voice.id];
              const otherUsers = usedByOtherSpeakers.get(voice.id);

              return (
                <article
                  key={voice.id}
                  data-voice-card={voice.id}
                  className={`voice-card${isSelected ? " is-selected" : ""}${isPlaying ? " is-playing" : ""}`}
                >
                  <div className="voice-card-top">
                    <div className="voice-card-title-row">
                      <strong className="voice-card-name">{voice.label}</strong>
                      {isSelected ? (
                        <span className="voice-card-badge is-selected">
                          ✓ {displaySpeaker}
                        </span>
                      ) : otherUsers?.length ? (
                        <span
                          className="voice-card-badge is-used"
                          title={`Currently assigned to ${otherUsers.join(", ")}`}
                        >
                          {otherUsers[0]}
                          {otherUsers.length > 1 ? ` +${otherUsers.length - 1}` : ""}
                        </span>
                      ) : null}
                    </div>
                    <span className="voice-card-character">{voice.character}</span>
                    <div className="voice-card-meta">
                      <span className="voice-card-lang">EN sample</span>
                      {isPlaying && (
                        <span className="voice-card-wave" aria-live="polite">
                          <i /><i /><i /> Playing
                        </span>
                      )}
                    </div>
                  </div>

                  {sampleError && (
                    <small className="voice-card-error" role="status">
                      {sampleError}
                    </small>
                  )}

                  <div className="voice-card-actions">
                    <button
                      type="button"
                      data-voice-play={voice.id}
                      className={`secondary-button voice-sample-btn${isPlaying ? " is-playing" : ""}${sampleError ? " is-error" : ""}`}
                      aria-label={
                        isLoading
                          ? `Stop loading sample for ${voice.label}`
                          : isPlaying
                            ? `Stop sample for ${voice.label}`
                            : sampleError
                              ? `Retry sample for ${voice.label}`
                              : `Play sample for ${voice.label}`
                      }
                      onClick={() => toggleSample(voice.id)}
                    >
                      {isLoading ? (
                        <>
                          <i className="gm-spinner voice-btn-spinner" aria-hidden="true" />
                          <span>Loading…</span>
                        </>
                      ) : isPlaying ? (
                        <>
                          <span aria-hidden="true">■</span>
                          <span>Stop</span>
                        </>
                      ) : sampleError ? (
                        <>
                          <span aria-hidden="true">↻</span>
                          <span>Retry</span>
                        </>
                      ) : (
                        <>
                          <span aria-hidden="true">▶</span>
                          <span>Play sample</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      data-voice-choose={voice.id}
                      className={isSelected ? "secondary-button voice-choose-btn is-selected" : "primary-button voice-choose-btn"}
                      aria-label={
                        isSelected
                          ? `Keep ${voice.label} for ${displaySpeaker}`
                          : `Choose ${voice.label} for ${displaySpeaker}`
                      }
                      onClick={() => {
                        onSelectVoice(displaySpeaker, voice.id);
                        handleClose();
                      }}
                    >
                      {isSelected ? "Selected" : "Choose"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <footer className="voice-dialog-footer">
          <small>
            Browsing or choosing a voice updates your speaker assignment immediately without rewriting your script or spending tokens. Audio is recorded when you build the storyboard or animation.
          </small>
        </footer>
      </div>
    </dialog>
  );
}
