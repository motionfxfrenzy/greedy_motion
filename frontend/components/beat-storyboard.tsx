"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HyperframesPlayer } from "@hyperframes/player";
import { BEAT_LIMITS, beatPlanProblems, scenesFor, textEffects, transitionTypes, motionBlurCopy, motionBlurProblem, type Beat, type BeatPlan, type VideoProject } from "@videosaas/contracts";
import { useMediaToken } from "../lib/use-media-token";
import { rewriteFrame, editPlan, ensureMediaToken, generatePlanAudio, getComposition, PlanProblems, projectScreenshotUrl, type Composition, type PlanAudioStatus, type PlanPatch } from "../lib/api";
import { MaterialGeneration } from "./material-generation";

/** Colours and type the frame cards are drawn with: the brand kit's, or the gallery theme's. */
export type FrameLook = { bg: string; fg: string; muted: string; brand: string; font: string; /** The kit's accent colour (emphasis marks); falls back to the brand colour. */ accent?: string };

type TextField = "keyword" | "on_screen" | "line";
const roleLabel: Record<Beat["role"], string> = { hook: "Hook", problem: "Problem", reveal: "Reveal", feature: "Feature", proof: "Proof", success: "Success", cta: "Call to action", question: "Question", step: "Step", insight: "Insight", recap: "Recap", setup: "Setup", turn: "Turn", resolution: "Resolution" };
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

/** Black or white, whichever reads on this colour. */
function inkOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#fff";
  const c = (i: number) => { const v = parseInt(m[1]!.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(0) + 0.7152 * c(2) + 0.0722 * c(4) > 0.45 ? "#0a0d12" : "#fff";
}
function luminanceOf(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const c = (i: number) => { const v = parseInt(m[1]!.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(0) + 0.7152 * c(2) + 0.0722 * c(4);
}
const contrastOf = (a: string, b: string) => { const x = luminanceOf(a), y = luminanceOf(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** The emphasis colour on a given ground, as the film chooses it: the kit's primary (brand) colour where it stays readable, else the ink. */
function accentOn(look: FrameLook, ground: string, ink: string): string {
  return [look.brand].find((colour) => colour && /^#/.test(colour) && contrastOf(colour, ground) >= 3) ?? ink;
}
/** The typography showreel's scenes as stills: the same colours the film uses for each scene. */
function typeStill(index: number, look: FrameLook, sceneId?: string | null): { background: string; color: string; scene: string } {
  const scene = sceneId || ["wall", "glitch", "stack", "outline", "marquee", "counter"][index % 6]!;
  if (scene === "glitch" || scene === "marquee") return { background: look.fg, color: look.bg, scene };
  if (scene === "stack" || scene === "counter") return { background: look.brand, color: inkOn(look.brand), scene };
  return { background: look.bg, color: look.fg, scene };
}
export function FrameCard({ beat, index, canvas, look, lookId, screenshot, family }: { beat: Beat; index: number; canvas: string; look: FrameLook; lookId: string; screenshot?: string; family?: string }) {
  if (family === "clean-type" && !(beat.kind === "ui" && screenshot)) {
    const t = typeStill(index, look, beat.scene), words = plain(beat.keyword).trim(), accent = accentOn(look, t.background, t.color);
    const parts = words.split(/\s+/), last = parts.pop() ?? "";
    const outline = t.scene === "outline" ? { WebkitTextStroke: "1.5px " + t.color, color: "transparent", backgroundImage: `linear-gradient(90deg, ${accent} 58%, transparent 58%)`, WebkitBackgroundClip: "text", backgroundClip: "text" } as React.CSSProperties : undefined;
    return <div className={"frame-card frame-type frame-type-" + t.scene + " " + (canvas === "9:16" ? "portrait" : canvas === "1:1" ? "square" : "landscape")} style={{ background: t.background, color: t.color, fontFamily: look.font }}>
      <span className="frame-index" style={{ color: t.color, opacity: 0.7 }}>{String(index + 1).padStart(2, "0")}</span>
      {t.scene === "wall" && <span className="frame-wall" aria-hidden="true" style={{ color: t.color }}>{Array.from({ length: 5 }, () => words.toUpperCase() + " • ").join("")}</span>}
      <div className="frame-copy">
        <strong style={outline}>{t.scene === "stack" || t.scene === "wall" || t.scene === "marquee" ? <>{parts.join(" ")}{parts.length ? " " : ""}<em style={{ color: accent, fontStyle: "normal" }}>{last}</em></> : words}</strong>
        {t.scene === "glitch" && <i className="frame-bar" style={{ background: accent }} />}
        {beat.on_screen && <small style={{ color: t.color, opacity: 0.75 }}>{plain(beat.on_screen)}</small>}
      </div>
      {t.scene === "glitch" && <i className="frame-dot" style={{ background: accent }} />}
    </div>;
  }
  const parts = plain(beat.keyword).trim().split(/\s+/);
  const accent = parts.pop() ?? "";
  const generated = beat.kind === "3d" || beat.kind === "footage";
  return <div className={"frame-card frame-look-" + (lookId.startsWith("doodle") ? "doodle" : lookId) + " " + (canvas === "9:16" ? "portrait" : canvas === "1:1" ? "square" : "landscape")} style={{ background: look.bg, color: look.fg, fontFamily: look.font }}>
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

export function BeatStoryboardStep({ project, look, warnings, busy, onSaved, back, submit, openStudio, regenerate, motionBlur, setMotionBlur }: {
  project: VideoProject & { beatPlan: BeatPlan };
  look: FrameLook;
  /** Non-blocking warnings from the last plan generation. */
  warnings: string[];
  busy: boolean;
  onSaved: (project: VideoProject) => void;
  back: () => void;
  submit: () => void;
  /** The classic Studio edits a template composition, not this storyboard, so it is only offered for projects that have no storyboard. */
  openStudio?: () => void;
  /** Sends the person to Script & style with the "replace your storyboard?" question open, to write the script again. */
  regenerate?: () => void;
  /** Final-render option, chosen here at submission. The player above is always a fast draft. */
  motionBlur: boolean;
  setMotionBlur: (on: boolean) => void;
}) {
  const [plan, setPlan] = useState<BeatPlan>(project.beatPlan);
  const [active, setActive] = useState(project.beatPlan.beats[0]?.id ?? "");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [serverProblems, setServerProblems] = useState<string[]>([]);
  const [rewriteText, setRewriteText] = useState("");
  const [rewriting, setRewriting] = useState(false);
  const [rewriteError, setRewriteError] = useState<string | null>(null);
  const [composition, setComposition] = useState<Composition | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [audio, setAudio] = useState<PlanAudioStatus | null>(null);
  const [audioBusy, setAudioBusy] = useState<false | "all" | "voice">(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  /** Timing notes from a successful audio run (e.g. "b1: the hook runs 4.3s…"). About the script, never a failure. */
  const [audioWarnings, setAudioWarnings] = useState<string[]>([]);
  const autoAudio = useRef(false);
  const revoiceTimer = useRef<number | null>(null);
  // flush() is declared before makeAudio(); it reaches it through this ref.
  const makeAudioRef = useRef<(parts?: ("voice" | "music")[]) => Promise<void>>(async () => undefined);
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
  const localProblems = useMemo(() => beatPlanProblems(plan, project.brief, { editing: true }), [plan, project.brief]);
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
    const blocking = beatPlanProblems(next, project.brief, { editing: true }).some((problem) => problem.includes(`(${beat.id})`));
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

  const live = composition?.engine === "beat-plan";
  const lengthSeconds = live && composition ? composition.durationSeconds : totalSeconds;
  const rewriteActive = async () => {
    const target = plan.beats.find((beat) => beat.id === active) ?? plan.beats[0];
    if (!target || rewriteText.trim().length < 3 || rewriting) return;
    setRewriting(true); setRewriteError(null);
    try { onSaved(await rewriteFrame(project.id, target.id, rewriteText.trim())); setRewriteText(""); }
    catch (error) { setRewriteError(error instanceof Error ? error.message : "Could not rewrite the frame."); }
    finally { setRewriting(false); }
  };
  const showBeat = useCallback((beatId: string) => setActive(beatId), []);

  const activeBeat = plan.beats.find((beat) => beat.id === active) ?? plan.beats[0];
  const openSuggestions = plan.suggestions.map((item, index) => ({ item, index })).filter(({ item }) => item.accepted === null);
  const blockingCount = new Set([...localProblems, ...(readiness?.blocking ?? []).map((item) => item.message)]).size;

  return <div className="beat-storyboard">
    <MaterialGeneration project={project} onReady={loadComposition} />
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
          <FrameCard family={project.brief?.styleFamily} beat={beat} index={index} canvas={plan.canvas} look={look} lookId={project.brief?.look ?? "clean"} screenshot={screenshotFor.get(beat.id)} />
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
          <header><b>Frame {plan.beats.indexOf(activeBeat) + 1} of {plan.beats.length}</b><span>Still · animates after Submit</span></header>
          {audio && audio.mode !== "none" && <div className={"bs-audio " + (audioBusy ? "busy" : audioError ? "error" : audio.ready ? "ready" : "stale")}>
            <span>{audioBusy === "voice" ? "Re-voicing edited lines…" : audioBusy ? "Making voice and music… (about 30 s)" : audioError ? audioError : audio.ready ? `Voice & music ready${audio.voice ? ` · ${audio.voice.voice}` : ""}` : audio.voice?.stale.length ? `${audio.voice.stale.length} ${audio.voice.stale.length === 1 ? "line needs" : "lines need"} re-voicing` : "Voice and music not made yet"}</span>
            {!audioBusy && (!audio.ready || audioError) && <button className="text-button" onClick={() => void makeAudio(audio.voice?.stale.length && audio.music?.ready ? ["voice"] : undefined)}>{audio.voice?.stale.length && audio.music?.ready ? "Re-voice" : audioError ? "Try again" : "Make audio"}</button>}
          </div>}
          {activeBeat && <div className="bs-still"><FrameCard family={project.brief?.styleFamily} beat={activeBeat} index={plan.beats.indexOf(activeBeat)} canvas={plan.canvas} look={look} lookId={project.brief?.look ?? "clean"} screenshot={screenshotFor.get(activeBeat.id)} /></div>}
          <form className="bs-rewrite" onSubmit={(event) => { event.preventDefault(); void rewriteActive(); }}>
            <textarea rows={3} value={rewriteText} maxLength={300} placeholder="Change this frame: “punchier”, “mention the warranty”…" aria-label="Rewrite this frame" disabled={rewriting}
              onChange={(event) => { setRewriteText(event.target.value); event.currentTarget.style.height = "auto"; event.currentTarget.style.height = event.currentTarget.scrollHeight + "px"; }}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void rewriteActive(); } }} />
            <div className="bs-rewrite-row"><span className="bs-frame-nav"><button type="button" disabled={plan.beats.indexOf(activeBeat) <= 0} onClick={() => setActive(plan.beats[Math.max(0, plan.beats.indexOf(activeBeat) - 1)].id)}>← Previous</button><button type="button" disabled={plan.beats.indexOf(activeBeat) >= plan.beats.length - 1} onClick={() => setActive(plan.beats[Math.min(plan.beats.length - 1, plan.beats.indexOf(activeBeat) + 1)].id)}>Next →</button></span><button type="submit" disabled={rewriting || rewriteText.trim().length < 3} aria-label="Rewrite frame">{rewriting ? "Rewriting…" : "Rewrite ↵"}</button></div>
          </form>
          {rewriteError && <p className="bs-blocking" role="alert">{rewriteError}</p>}
          
          <p className="bs-still-note">Frames are stills while you write. Edit any frame, reorder, or rewrite the script; the film is animated only after you submit.</p>
        </section>
        {activeBeat && <section className="bs-detail"><header><b>Beat {plan.beats.indexOf(activeBeat) + 1} · {roleLabel[activeBeat.role]}</b><span>{activeBeat.energy} energy</span></header>
          <div className="bs-direction" key={activeBeat.id}>
            {scenesFor(project.brief?.look, project.brief?.styleFamily).length > 0 && <label><span>Scene</span><select value={activeBeat.scene ?? ""} onChange={(event) => void send({ beats: [{ id: activeBeat.id, scene: event.target.value || null }] })}><option value="">Automatic</option>{scenesFor(project.brief?.look, project.brief?.styleFamily).map((scene) => <option key={scene.id} value={scene.id}>{scene.label}</option>)}</select></label>}
            <label><span>Camera</span><textarea rows={2} defaultValue={activeBeat.motion.camera} maxLength={200} onBlur={(event) => { const value = event.target.value.trim(); if (value && value !== activeBeat.motion.camera) void send({ beats: [{ id: activeBeat.id, camera: value }] }); }} /></label>
            {activeBeat.kind !== "ui" && <label><span>Text effect</span><select value={activeBeat.motion.text_effect ?? ""} onChange={(event) => void send({ beats: [{ id: activeBeat.id, text_effect: event.target.value || null }] })}><option value="">Automatic</option>{textEffects.map((effect) => <option key={effect} value={effect}>{effect.replace(/-/g, " ")}</option>)}</select></label>}
            {activeBeat.transition_out.type !== "end" && <label><span>Into next</span><select value={activeBeat.transition_out.type} onChange={(event) => void send({ beats: [{ id: activeBeat.id, transition: event.target.value }] })}>{transitionTypes.filter((type) => type !== "end").map((type) => <option key={type} value={type}>{type.replace(/-/g, " ")}</option>)}</select></label>}
            <label><span>Sound</span><textarea rows={2} defaultValue={activeBeat.sfx ?? ""} maxLength={200} placeholder="e.g. soft whoosh on the cut" onBlur={(event) => { const value = event.target.value.trim(); if (value !== (activeBeat.sfx ?? "")) void send({ beats: [{ id: activeBeat.id, sfx: value || null }] }); }} /></label>
          </div></section>}
        <div className="bs-submit">
          {blockingCount > 0 && <div className="bs-blocking" role="alert"><p>{blockingCount === 1 ? "1 rule is broken." : `${blockingCount} rules are broken.`} Fix {blockingCount === 1 ? "it" : "them"} to submit:</p><ul>{[...new Set([...localProblems, ...(readiness?.blocking ?? []).map((item) => item.message.replace(NOTE_BEAT, ""))])].map((message) => <li key={message}>{message}</li>)}</ul></div>}
          {(() => { const tooLong = motionBlurProblem(lengthSeconds); return (
            <label className="bs-blur"><input type="checkbox" checked={motionBlur && !tooLong} disabled={busy || Boolean(tooLong)} onChange={(event) => setMotionBlur(event.target.checked)} /><span><b>{motionBlurCopy.label}</b><small>{tooLong ?? motionBlurCopy.help}</small></span></label>
          ); })()}
          <div><button className="secondary-button" onClick={back}>Back</button>{regenerate ? <button className="secondary-button" onClick={regenerate}>Regenerate script</button> : null}{openStudio ? <button className="secondary-button" onClick={openStudio}>Open Studio</button> : null}<button className="primary-button" disabled={busy || blockingCount > 0 || saveState === "saving"} onClick={() => { flush(); submit(); }}>{busy ? "Starting render…" : "Submit video"}</button></div>
          <small>Submitting locks the script and storyboard. Rendering continues if you leave the page.</small>
        </div>
      </aside>
    </div>
  </div>;
}
