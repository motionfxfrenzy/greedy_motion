"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HyperframesPlayer } from "@hyperframes/player";
import { BEAT_LIMITS, beatPlanProblems, type Beat, type BeatPlan, type VideoProject } from "@videosaas/contracts";
import { useMediaToken } from "../lib/use-media-token";
import { editPlan, ensureMediaToken, generatePlanAudio, getComposition, PlanProblems, projectScreenshotUrl, type Composition, type PlanAudioStatus, type PlanPatch } from "../lib/api";
import { HyperframesPreview } from "./studio-editor";

/** Colours and type the frame cards are drawn with: the brand kit's, or the gallery theme's. */
export type FrameLook = { bg: string; fg: string; muted: string; brand: string; font: string };

type TextField = "keyword" | "on_screen" | "line";
const roleLabel: Record<Beat["role"], string> = { hook: "Hook", problem: "Problem", reveal: "Reveal", feature: "Feature", proof: "Proof", success: "Success", cta: "Call to action" };
const kindLabel: Record<Beat["kind"], string> = { ui: "Product screen", kinetic: "Kinetic type", "3d": "3D shot", footage: "Footage", title: "Title card" };
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
/**
 * The beat-plan composition reads its text from one JSON block (agreed with the backend), so edits can be
 * shown by rewriting that block in the player's srcdoc instead of re-rendering on the server.
 */
const VARIABLES_BLOCK = /(<script id="hf-variables" type="application\/json">)([\s\S]*?)(<\/script>)/;
function withBeatText(html: string, plan: BeatPlan) {
  if (!VARIABLES_BLOCK.test(html)) return html;
  const values: Record<string, string> = {};
  for (const beat of plan.beats) {
    values[`${beat.id}.keyword`] = beat.keyword;
    values[`${beat.id}.on_screen`] = beat.on_screen ?? "";
    values[`${beat.id}.line`] = beat.line ?? "";
  }
  // Escape "<" so beat text can never close the script element.
  return html.replace(VARIABLES_BLOCK, (_match, open: string, _json: string, close: string) => open + JSON.stringify(values).replace(/</g, "\\u003c") + close);
}
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;

/** One frame, drawn in the browser from the beat's own text, so every keystroke shows immediately. */
const plain = (text: string) => text.replace(/[*_`]+/g, "");

function FrameCard({ beat, index, canvas, look, screenshot }: { beat: Beat; index: number; canvas: string; look: FrameLook; screenshot?: string }) {
  const parts = plain(beat.keyword).trim().split(/\s+/);
  const accent = parts.pop() ?? "";
  const generated = beat.kind === "3d" || beat.kind === "footage";
  return <div className={"frame-card " + (canvas === "9:16" ? "portrait" : canvas === "1:1" ? "square" : "landscape")} style={{ background: look.bg, color: look.fg, fontFamily: look.font }}>
    <span className="frame-index" style={{ color: look.muted }}>{String(index + 1).padStart(2, "0")}</span>
    {beat.kind === "ui" && screenshot ? <img className="frame-shot" src={screenshot} alt="" /> : generated ? <span className="frame-generated" style={{ borderColor: look.brand, color: look.brand }}>{kindLabel[beat.kind]} · generated after Submit</span> : null}
    <div className={beat.kind === "ui" && screenshot ? "frame-copy over-shot" : "frame-copy"}>
      <strong>{parts.join(" ")}{parts.length ? " " : ""}<em style={{ color: look.brand }}>{accent}</em></strong>
      {beat.on_screen && <small style={{ color: look.muted }}>{plain(beat.on_screen)}</small>}
    </div>
  </div>;
}

function Budget({ text, chars, max }: { text: string; chars: number; max?: number }) {
  const over = text.length > chars || (max !== undefined && words(text) > max);
  return <small className={over ? "budget over" : "budget"}>{text.length}/{chars}{max !== undefined ? ` · ${words(text)}/${max} words` : ""}</small>;
}

export function BeatStoryboardStep({ project, look, warnings, busy, onSaved, back, submit, openStudio }: {
  project: VideoProject & { beatPlan: BeatPlan };
  look: FrameLook;
  /** Non-blocking warnings from the last plan generation. */
  warnings: string[];
  busy: boolean;
  onSaved: (project: VideoProject) => void;
  back: () => void;
  submit: () => void;
  openStudio: () => void;
}) {
  const [plan, setPlan] = useState<BeatPlan>(project.beatPlan);
  const [active, setActive] = useState(project.beatPlan.beats[0]?.id ?? "");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [serverProblems, setServerProblems] = useState<string[]>([]);
  const [composition, setComposition] = useState<Composition | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [playerLoaded, setPlayerLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [liveHtml, setLiveHtml] = useState<string | null>(null);
  const [audio, setAudio] = useState<PlanAudioStatus | null>(null);
  const [audioBusy, setAudioBusy] = useState<false | "all" | "voice">(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  /** Timing notes from a successful audio run (e.g. "b1: the hook runs 4.3s…"). About the script, never a failure. */
  const [audioWarnings, setAudioWarnings] = useState<string[]>([]);
  const [muted, setMuted] = useState(true);
  const [soundChosen, setSoundChosen] = useState(false);
  const autoAudio = useRef(false);
  const revoiceTimer = useRef<number | null>(null);
  // flush() is declared before makeAudio(); it reaches it through this ref.
  const makeAudioRef = useRef<(parts?: ("voice" | "music")[]) => Promise<void>>(async () => undefined);
  const playerRef = useRef<HyperframesPlayer | null>(null);
  const pending = useRef(new Map<string, { id: string; keyword?: string; on_screen?: string; line?: string }>());
  const timer = useRef<number | null>(null);

  // A newer plan from the server (e.g. regenerated) replaces local edits.
  useEffect(() => { setPlan(project.beatPlan); }, [project.beatPlan]);

  const mediaToken = useMediaToken();
  const screenshotFor = useMemo(() => {
    const ordered = project.brief?.screenshotIds?.length ? project.brief.screenshotIds.map((id) => project.screenshots.find((shot) => shot.id === id)).filter(Boolean) : project.screenshots;
    let next = 0;
    const map = new Map<string, string>();
    for (const beat of plan.beats) {
      if (beat.kind !== "ui" || ordered.length === 0) continue;
      const shot = ordered[Math.min(next, ordered.length - 1)]!;
      map.set(beat.id, projectScreenshotUrl(project.id, shot.id));
      next += 1;
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mediaToken changes the URLs projectScreenshotUrl builds
  }, [plan.beats, project.brief?.screenshotIds, project.id, project.screenshots, mediaToken]);

  // Local validation with the same rules the server applies, so problems show while typing.
  const localProblems = useMemo(() => beatPlanProblems(plan, project.brief), [plan, project.brief]);
  const problemsFor = (beatId: string) => [...localProblems, ...serverProblems].filter((problem) => problem.includes(`(${beatId})`));
  const generalProblems = [...new Set([...localProblems, ...serverProblems].filter((problem) => !/\(b[\w-]+\)/.test(problem)))];
  // Audio notes start with the beat they concern ("b1: …" or "b1→b4: …"); those also show on that beat's card.
  const NOTE_BEAT = /^(b[\w-]+)(?:\s*→\s*b[\w-]+)?:\s*/;
  const notesFor = (beatId: string) => [
    ...audioWarnings.filter((note) => NOTE_BEAT.exec(note)?.[1] === beatId).map((note) => note.replace(NOTE_BEAT, "")),
    ...(composition?.readiness?.warnings ?? []).filter((item) => item.beat === beatId).map((item) => item.message.replace(NOTE_BEAT, ""))
  ];
  // The server's readiness is what Submit must satisfy (rules, voice, music, hook, length). Local rules
  // add instant feedback while typing; both are shown on the beat they name.
  const readiness = composition?.readiness;
  const readinessFor = (beatId: string) => (readiness?.blocking ?? []).filter((item) => item.beat === beatId).map((item) => item.message.replace(NOTE_BEAT, ""));
  const readinessGeneral = (readiness?.blocking ?? []).filter((item) => !item.beat).map((item) => item.message);
  const totalSeconds = plan.target_duration_s;

  const [notice, setNotice] = useState<string | null>(null);
  /** Persists a patch. Returns false when the server refused it, so callers can undo optimistic changes. */
  const refreshStatus = useCallback(async () => {
    try {
      const next = await getComposition(project.id);
      setComposition(next);
      setAudio(next.audio ?? null);
    } catch { /* Keep the last known status; the next save retries. */ }
  }, [project.id]);
  const send = useCallback(async (patch: PlanPatch): Promise<boolean> => {
    setSaveState("saving");
    try {
      const saved = await editPlan(project.id, patch);
      setServerProblems([]);
      setSaveState("saved");
      onSaved(saved);
      void refreshStatus();
      return true;
    } catch (caught) {
      const problems = caught instanceof PlanProblems ? caught.problems : [caught instanceof Error ? caught.message : "Could not save the storyboard."];
      if (patch.order) {
        // The server re-chains motion seams on reorder; what it still refuses (the hook must open, the CTA must close) is explained in its own words.
        setSaveState("saved");
        setNotice(`${problems[0] ?? "That order isn't allowed."} The move was undone.`);
        return false;
      }
      setSaveState("error");
      setServerProblems(problems);
      return false;
    }
  }, [onSaved, project.id]);

  const flush = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    const beats = [...pending.current.values()];
    pending.current.clear();
    if (!beats.length) return;
    const lineChanged = beats.some((beat) => beat.line !== undefined);
    void send({ beats }).then((ok) => {
      if (!ok || !lineChanged || !audio || audio.mode === "none" || audio.mode === "music") return;
      if (revoiceTimer.current) window.clearTimeout(revoiceTimer.current);
      revoiceTimer.current = window.setTimeout(() => void makeAudioRef.current(["voice"]), 2000);
    });
  }, [audio, send]);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const edit = (beat: Beat, field: TextField, value: string) => {
    const next = { ...plan, beats: plan.beats.map((item) => item.id === beat.id ? { ...item, [field]: field === "line" ? (value.trim() ? value : null) : field === "on_screen" ? (value || null) : value } : item) };
    setPlan(next);
    pending.current.set(beat.id, { ...(pending.current.get(beat.id) ?? { id: beat.id }), [field]: value });
    // Only persist edits that pass the shared rules; the frame still updates on every keystroke.
    const blocking = beatPlanProblems(next, project.brief).some((problem) => problem.includes(`(${beat.id})`));
    if (timer.current) window.clearTimeout(timer.current);
    if (!blocking) timer.current = window.setTimeout(flush, 700);
  };

  const move = (beatId: string, by: -1 | 1) => {
    const order = plan.beats.map((beat) => beat.id);
    const from = order.indexOf(beatId);
    const to = from + by;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to]!, order[from]!];
    const previous = plan;
    setNotice(null);
    setPlan({ ...plan, beats: order.map((id) => plan.beats.find((beat) => beat.id === id)!) });
    flush();
    void send({ order }).then((ok) => { if (!ok) setPlan(previous); });
  };

  const decide = (index: number, accepted: boolean) => {
    setPlan({ ...plan, suggestions: plan.suggestions.map((item, position) => position === index ? { ...item, accepted } : item) });
    void send({ suggestions: [{ index, accepted }] });
  };

  // Quick preview: the real HyperFrames player on the project's composition.
  useEffect(() => {
    let live = true;
    void import("@hyperframes/player").then(() => { if (live) setPlayerLoaded(true); }).catch(() => { if (live) setPreviewError("The HyperFrames player could not be loaded."); });
    return () => { live = false; };
  }, []);
  const loadComposition = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await getComposition(project.id);
      // Same-origin through the Next proxy, which the player needs to inspect the frame.
      const media = encodeURIComponent(await ensureMediaToken());
      const response = await fetch(`${next.baseUrl.replace(/^\/v1\/preview\//, "/api/preview/")}?t=${media}`, { cache: "no-store", signal });
      if (!response.ok) throw new Error(`The preview service returned ${response.status}.`);
      const html = await response.text();
      if (signal?.aborted) return null;
      setComposition(next);
      setAudio(next.audio ?? null);
      setPreviewHtml(html);
      setPreviewError(null);
      return next;
    } catch (caught) {
      if (!signal?.aborted) setPreviewError(caught instanceof Error ? caught.message : "The preview could not be loaded.");
      return null;
    }
  }, [project.id]);

  /** Voices lines (cached by text) and/or makes the music bed, then reloads the timing and tracks. */
  const makeAudio = useCallback(async (parts?: ("voice" | "music")[]) => {
    setAudioBusy(parts?.length === 1 && parts[0] === "voice" ? "voice" : "all");
    setAudioError(null);
    try {
      const result = await generatePlanAudio(project.id, parts);
      setAudio(result.audio);
      onSaved(result.project);
      await loadComposition();
      setAudioWarnings(result.warnings);
    } catch (caught) {
      setAudioError(caught instanceof Error ? caught.message : "Could not make the voice and music.");
    } finally {
      setAudioBusy(false);
    }
  }, [loadComposition, onSaved, project.id]);
  useEffect(() => { makeAudioRef.current = makeAudio; }, [makeAudio]);

  // Load once per project. Text edits reach the composition through its variables block (no reload);
  // the first time a plan that wants sound has none, make it.
  useEffect(() => {
    const controller = new AbortController();
    void loadComposition(controller.signal).then((next) => {
      if (!next?.audio || next.audio.mode === "none" || next.audio.ready || autoAudio.current) return;
      autoAudio.current = true;
      void makeAudio();
    });
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);
  useEffect(() => () => { if (revoiceTimer.current) window.clearTimeout(revoiceTimer.current); }, []);

  // Debounced so typing doesn't reload the player on every keystroke.
  useEffect(() => {
    if (!previewHtml) return;
    const handle = window.setTimeout(() => setLiveHtml(withBeatText(previewHtml, plan)), 300);
    return () => window.clearTimeout(handle);
  }, [plan, previewHtml]);

  const live = composition?.engine === "beat-plan";
  const lengthSeconds = live && composition ? composition.durationSeconds : totalSeconds;
  /** Selecting a frame shows that beat in the player, once its text has landed (mid-beat, at most 1 s in). */
  const showBeat = useCallback((beatId: string) => {
    setActive(beatId);
    const time = composition?.beatTimes?.[beatId];
    const player = playerRef.current;
    if (!time || !player) return;
    player.pause();
    player.seek(time.start + Math.min(1, (time.end - time.start) / 2));
  }, [composition?.beatTimes]);

  const activeBeat = plan.beats.find((beat) => beat.id === active) ?? plan.beats[0];
  const openSuggestions = plan.suggestions.map((item, index) => ({ item, index })).filter(({ item }) => item.accepted === null);
  const blockingCount = new Set([...localProblems, ...(readiness?.blocking ?? []).map((item) => item.message)]).size;

  return <div className="beat-storyboard">
    <header className="bs-head">
      <div><h1>Storyboard</h1><p>{plan.beats.length} beats · {clock(lengthSeconds)} · {plan.canvas} · {plan.mode === "own-script" ? "your script, word for word" : "written from your brief"}. Edit any frame; nothing renders until you submit.</p></div>
      <span className={"bs-save " + saveState}>{saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : "All changes saved"}</span>
    </header>

    {(warnings.length > 0 || generalProblems.length > 0 || audioWarnings.length > 0 || readinessGeneral.length > 0) && <div className="bs-warnings" role="status"><b>Check before you submit</b><ul>{[...new Set([...readinessGeneral, ...warnings, ...audioWarnings, ...generalProblems])].map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}

    {notice && <div className="bs-notice" role="status"><span>{notice}</span><button className="text-button" onClick={() => setNotice(null)}>Dismiss</button></div>}

    {openSuggestions.length > 0 && <section className="bs-suggestions"><header><b>Suggested changes</b><span>{openSuggestions.length} to review</span></header>{openSuggestions.map(({ item, index }) => <article key={index}><div><small>Beat {item.beat.replace(/^b/, "")}</small><p className="bs-problem">{item.problem}</p><p>{item.proposal}</p></div><div className="bs-suggestion-actions"><button className="secondary-button" onClick={() => decide(index, false)}>Keep mine</button><button className="primary-button" onClick={() => decide(index, true)}>Accept</button></div></article>)}</section>}

    <div className="bs-layout">
      <div className="bs-grid">{plan.beats.map((beat, index) => {
        const problems = [...new Set([...problemsFor(beat.id).map((problem) => problem.replace(/^beat \d+ \([\w-]+\):\s*/i, "")), ...readinessFor(beat.id)])];
        return <article key={beat.id} className={(beat.id === activeBeat?.id ? "bs-beat active" : "bs-beat") + (problems.length ? " has-problems" : "")} onFocusCapture={() => { if (beat.id !== active) showBeat(beat.id); }} onClick={() => { if (beat.id !== active) showBeat(beat.id); }}>
          <FrameCard beat={beat} index={index} canvas={plan.canvas} look={look} screenshot={screenshotFor.get(beat.id)} />
          <div className="bs-meta"><span className={"bs-role " + beat.role}>{roleLabel[beat.role]}</span><span>{kindLabel[beat.kind]}{beat.ui ? ` · ${beat.ui.action} ${beat.ui.target}` : ""}</span><div className="bs-move"><button aria-label={`Move beat ${index + 1} earlier`} disabled={index === 0} onClick={(event) => { event.stopPropagation(); move(beat.id, -1); }}>↑</button><button aria-label={`Move beat ${index + 1} later`} disabled={index === plan.beats.length - 1} onClick={(event) => { event.stopPropagation(); move(beat.id, 1); }}>↓</button></div></div>
          <label className="bs-field"><span>Key phrase <Budget text={beat.keyword} chars={BEAT_LIMITS.keywordChars} max={BEAT_LIMITS.keywordWords} /></span><input value={beat.keyword} onChange={(event) => edit(beat, "keyword", event.target.value)} onBlur={flush} /></label>
          <label className="bs-field"><span>On screen <Budget text={beat.on_screen ?? ""} chars={BEAT_LIMITS.onScreenChars} /></span><input value={beat.on_screen ?? ""} onChange={(event) => edit(beat, "on_screen", event.target.value)} onBlur={flush} placeholder="Optional supporting line" /></label>
          <label className="bs-field"><span>Voiceover <Budget text={beat.line ?? ""} chars={BEAT_LIMITS.lineChars} max={BEAT_LIMITS.lineWords} /></span><textarea rows={2} value={beat.line ?? ""} onChange={(event) => edit(beat, "line", event.target.value)} onBlur={flush} placeholder="Silent beat" readOnly={plan.mode === "own-script"} title={plan.mode === "own-script" ? "Your script is kept word for word. Change it in Script & style." : undefined} /></label>
          {notesFor(beat.id).length > 0 && <ul className="bs-notes">{notesFor(beat.id).map((note) => <li key={note}>{note}</li>)}</ul>}
          {problems.length > 0 && <ul className="bs-problems">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
        </article>;
      })}</div>

      <aside className="bs-aside">
        <section className="bs-preview">
          <header><b>Quick preview</b><span>{live ? "Live · updates as you type" : "Template preview"}</span></header>
          {audio && audio.mode !== "none" && <div className={"bs-audio " + (audioBusy ? "busy" : audioError ? "error" : audio.ready ? "ready" : "stale")}>
            <span>{audioBusy === "voice" ? "Re-voicing edited lines…" : audioBusy ? "Making voice and music… (about 30 s)" : audioError ? audioError : audio.ready ? `Voice & music ready${audio.voice ? ` · ${audio.voice.voice}` : ""}` : audio.voice?.stale.length ? `${audio.voice.stale.length} ${audio.voice.stale.length === 1 ? "line needs" : "lines need"} re-voicing` : "Voice and music not made yet"}</span>
            {!audioBusy && (!audio.ready || audioError) && <button className="text-button" onClick={() => void makeAudio(audio.voice?.stale.length && audio.music?.ready ? ["voice"] : undefined)}>{audio.voice?.stale.length && audio.music?.ready ? "Re-voice" : audioError ? "Try again" : "Make audio"}</button>}
          </div>}
          <div className={"bs-player " + (plan.canvas === "9:16" ? "portrait" : plan.canvas === "1:1" ? "square" : "landscape")}>
            {playerLoaded && liveHtml ? <HyperframesPreview srcdoc={liveHtml} muted={muted} playerRef={playerRef} onReady={() => undefined} onTimeChange={() => undefined} onPlayingChange={setPlaying} onError={setPreviewError} /> : <div className="bs-player-empty">{previewError ?? "Loading the preview…"}</div>}
          </div>
          <div className="bs-player-controls"><button disabled={!previewHtml} onClick={() => {
            const player = playerRef.current;
            if (!player) return;
            if (playing) return player.pause();
            // Play is a user gesture, so sound may start now, unless the viewer chose silence.
            if (!soundChosen && audio && audio.mode !== "none") { setMuted(false); player.muted = false; }
            void player.play();
          }}>{playing ? "❚❚ Pause" : "▶ Play"}</button>{audio && audio.mode !== "none" && <button className="bs-sound" aria-pressed={!muted} aria-label={muted ? "Turn sound on" : "Turn sound off"} onClick={() => { setSoundChosen(true); setMuted((value) => { const next = !value; if (playerRef.current) playerRef.current.muted = next; return next; }); }}>{muted ? "🔇 Sound off" : "🔊 Sound on"}</button>}<small>{live ? "Select a frame to jump to it. Plays with draft timing; voiceover and music are added after Submit." : "Shows the current template while the beat-plan composition is being built. Frame cards reflect your edits."}</small></div>
        </section>
        {activeBeat && <section className="bs-detail"><header><b>Beat {plan.beats.indexOf(activeBeat) + 1} · {roleLabel[activeBeat.role]}</b><span>{activeBeat.energy} energy</span></header><dl><div><dt>Camera</dt><dd>{activeBeat.motion.camera}</dd></div>{activeBeat.motion.text_effect && <div><dt>Text effect</dt><dd>{activeBeat.motion.text_effect}</dd></div>}<div><dt>Into next</dt><dd>{activeBeat.transition_out.type}{activeBeat.transition_out.carrier ? ` · ${activeBeat.transition_out.carrier}` : ""}</dd></div>{activeBeat.sfx && <div><dt>Sound</dt><dd>{activeBeat.sfx}</dd></div>}</dl></section>}
        <div className="bs-submit">
          {blockingCount > 0 && <p className="bs-blocking">{blockingCount === 1 ? "1 frame breaks a rule." : `${blockingCount} rules are broken.`} Fix them to submit.</p>}
          <div><button className="secondary-button" onClick={back}>Back</button><button className="secondary-button" onClick={openStudio}>Open Studio</button><button className="primary-button" disabled={busy || blockingCount > 0 || saveState === "saving"} onClick={() => { flush(); submit(); }}>{busy ? "Starting render…" : "Submit video"}</button></div>
          <small>Submitting locks the script and storyboard. Rendering continues if you leave the page.</small>
        </div>
      </aside>
    </div>
  </div>;
}
