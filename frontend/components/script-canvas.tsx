"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { PLANS, PAID_TIERS, TOP_UP, renderCostMillitokens, scriptSeconds, tokensFromMilli, type Aspect, type BeatPlan, type Pace, type ScriptBeat } from "@videosaas/contracts";
import { getMyTokens, startCheckout, type ScriptFlag } from "../lib/api";

export type StoryboardState = { state: "waiting" | "building" | "ready" | "stale" | "failed"; plan?: BeatPlan; error?: string; /** When the storyboard job started (ms), while building. */ startedAt?: number };
/** A beat's reference frame: SVG text drawn by the backend, shown only as an image. `stale` keeps the old drawing after an edit. */
export type FrameSlot = { state: "drawing" | "ready" | "stale" | "failed"; svg?: string; error?: string };
/** Confirm script → voiceover. `takes` holds a playable URL per beat once that beat's line is voiced. */
export type VoiceState = {
  state: "idle" | "storyboard" | "voicing" | "ready" | "failed";
  takes: (string | null)[];
  progress?: number;
  busyIndices?: number[];
  errors?: Record<number, string>;
  error?: string;
};

const SUGGESTIONS = ["Make it punchier", "Shorter", "More playful", "Simpler words"];
const RATIO: Record<Aspect, string> = { "16:9": "16 / 9", "9:16": "9 / 16", "1:1": "1 / 1" };

/** Keeps an input in step with a value that streams in, without fighting the person typing in it. */
function Field({ value, onChange, readOnly, className, placeholder, caret, label }: { value: string; onChange: (next: string) => void; readOnly: boolean; className?: string; placeholder?: string; caret?: boolean; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Grow with the text so a beat never scrolls inside itself, and again when the column's width changes (wrapping changes).
  const fit = () => { const el = ref.current; if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; } };
  useEffect(fit, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let width = -1;
    const observer = new ResizeObserver(() => { if (el.clientWidth !== width) { width = el.clientWidth; fit(); } });
    observer.observe(el);
    return () => observer.disconnect();
  }, [readOnly]);
  if (readOnly) return <p className={`${className ?? ""} sc-static`}>{value || <span className="sc-placeholder">{placeholder}</span>}{caret && <i className="sc-caret" aria-hidden="true" />}</p>;
  return <textarea ref={ref} rows={1} className={className} value={value} placeholder={placeholder} aria-label={label} onChange={(event) => onChange(event.target.value.replace(/\n/g, " "))} />;
}

/** A frame is SVG text from the model (or a data:/static image URL for painted story films); as an <img> nothing in it can run or load. */
export const svgSrc = (svg: string) =>
  svg.startsWith("data:image/") || svg.startsWith("/")
    ? svg
    : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(/^<svg[^>]*\sxmlns\s*=/.test(svg) ? svg : svg.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"'))}`;

const FRAME_BOX: Record<Aspect, { width: number; height: number; col: string }> = {
  "9:16": { width: 156, height: 277, col: "minmax(0, 1fr) 172px" },
  "1:1": { width: 210, height: 210, col: "minmax(0, 1fr) 224px" },
  "16:9": { width: 300, height: 169, col: "minmax(0, 1fr) 312px" }
};

function Frame({ slot, aspect, index, writing, onRedraw, onPick, picked }: { slot: FrameSlot | undefined; aspect: Aspect; index: number; writing: boolean; onRedraw: () => void; onPick?: (add: boolean) => void; picked: boolean }) {
  const box = FRAME_BOX[aspect] ?? FRAME_BOX["16:9"];
  const frameStyle = { width: box.width, height: box.height, aspectRatio: RATIO[aspect], borderRadius: 12, justifySelf: "end" as const };
  if (!slot || (slot.state === "drawing" && !slot.svg)) return <div className="sc-frame sc-frame-wait" style={frameStyle}><span>{writing || !slot ? "Frame follows the beat" : "Drawing…"}</span></div>;
  if (slot.state === "failed" && !slot.svg) return <div className="sc-frame sc-frame-wait" style={frameStyle}><span>{slot.error ?? "Could not draw this frame."}</span><button type="button" onClick={onRedraw}>Try again</button></div>;
  return <figure className={`sc-frame ${slot.state}`} style={frameStyle}>
    {onPick ? <button type="button" className="sc-frame-pick" aria-pressed={picked} aria-label={picked ? `Stop referring to beat ${index + 1}` : `Refer to beat ${index + 1} in the prompt`} onClick={(event) => onPick(event.metaKey || event.ctrlKey || event.shiftKey)}><img src={svgSrc(slot.svg!)} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain" }} /></button>
      : <img src={svgSrc(slot.svg!)} alt={`Reference frame for beat ${index + 1}`} draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain" }} />}
    {slot.state === "stale" && <button type="button" onClick={onRedraw}>Redraw</button>}
    {slot.state === "drawing" && <span className="sc-frame-busy">Redrawing…</span>}
  </figure>;
}

type Product = "starter" | "pro" | "business" | "topup";

/** Buying tokens without leaving the film: the shortfall, the one-time pack and the plans, each going to checkout. */
function TokenModal({ cost, balance, onClose }: { cost: number; balance: number; onClose: () => void }) {
  const [opening, setOpening] = useState<Product | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const need = Math.max(0, Math.round((cost - balance) * 100) / 100);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  const buy = async (product: Product) => {
    setOpening(product);
    setFailed(null);
    try { window.location.assign(await startCheckout(product)); }
    catch (caught) { setFailed(caught instanceof Error ? caught.message : "Could not open checkout."); setOpening(null); }
  };
  return <div className="sc-modal-backdrop" onClick={onClose}>
    <div className="sc-modal" role="dialog" aria-modal="true" aria-labelledby="sc-modal-title" onClick={(event) => event.stopPropagation()}>
      <header>
        <h2 id="sc-modal-title">Add tokens to render</h2>
        <button type="button" className="sc-modal-close" aria-label="Close" onClick={onClose}>×</button>
      </header>
      <p className="sc-modal-sum">This film costs <b>{cost} tokens</b>. You have <b>{balance}</b>, so you need <b>{need} more</b>.</p>
      <div className="sc-modal-options">
        <div className="sc-option">
          <div><b>{TOP_UP.tokens} tokens</b><span>One-time pack · ${TOP_UP.priceUsd}</span>{TOP_UP.tokens >= need && <em>Covers this film</em>}</div>
          <button type="button" className="primary-button" disabled={opening !== null} onClick={() => void buy("topup")}>{opening === "topup" ? "Opening…" : "Buy pack"}</button>
        </div>
        {PAID_TIERS.map((tier) => <div className="sc-option" key={tier}>
          <div><b>{PLANS[tier].name} · {PLANS[tier].tokens} tokens a month</b><span>${PLANS[tier].priceUsd}/month · {PLANS[tier].blurb}</span></div>
          <button type="button" className="secondary-button" disabled={opening !== null} onClick={() => void buy(tier)}>{opening === tier ? "Opening…" : `Choose ${PLANS[tier].name}`}</button>
        </div>)}
      </div>
      {failed && <p className="sc-modal-error" role="alert">{failed}</p>}
      <small>Your storyboard is saved. Come back after checkout and render.</small>
    </div>
  </div>;
}

/** Render, or (when the balance does not cover the film) Add tokens, which opens the purchase modal. */
function RenderAction({ seconds, rendering, label, disabled, onRender }: { seconds: number; rendering: boolean; label: string; disabled: boolean; onRender: () => void }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [buying, setBuying] = useState(false);
  useEffect(() => { getMyTokens().then((summary) => setBalance(summary.remaining)).catch(() => setBalance(null)); }, []);
  const cost = tokensFromMilli(renderCostMillitokens(seconds));
  const short = balance !== null && balance < cost && !rendering;
  return <div className="sc-render">
    {short
      ? <button className="primary-button sc-add-tokens" disabled={disabled} onClick={() => setBuying(true)}>Add tokens to render</button>
      : <button className="primary-button" disabled={disabled || rendering} onClick={onRender}>{label}</button>}
    <span className={short ? "sc-cost short" : "sc-cost"}>{cost} tokens{balance !== null ? ` · you have ${balance}` : ""}</span>
    {buying && balance !== null && <TokenModal cost={cost} balance={balance} onClose={() => setBuying(false)} />}
  </div>;
}

/**
 * The script canvas: one document. Each beat reads as what is seen, what is read and what is heard, with its reference frame
 * beside it; a single prompt bar at the bottom asks the AI for changes. Confirming the script voices it; the storyboard is
 * built from it in the background.
 */
export function ScriptCanvas({ music, onRender, rendering, beats, open, writing, scoped, versions, onReimagine, onVersion, streaming, startedAt, firstAt, flags, error, voiced, length, onFit, onEdit, onAsk, onCancel, frames, aspect, styleName, onRedraw, voice, onConfirm, onRetryVoice, storyboard, onContinue, continuing }: {
  beats: ScriptBeat[];
  /** The field being written, and the beat it is written into, while streaming. */
  open: keyof ScriptBeat | null;
  writing: number | null;
  /** A change to picked beats: nothing new is appended while it streams. */
  scoped: boolean;
  /** Kept AI versions per beat (null until a beat has been changed), and the one on screen. */
  versions: ({ count: number; at: number } | null)[];
  onReimagine: (index: number) => void;
  onVersion: (index: number, at: number) => void;
  streaming: boolean;
  startedAt: number;
  firstAt?: number;
  flags: ScriptFlag[];
  error: string | null;
  voiced: boolean;
  /** The length the person chose and how the script is read; `locked` holds it to that length. */
  length: { seconds: number; pace: Pace; locked: boolean };
  /** Rewrites the script to the chosen length. */
  onFit: () => void;
  onEdit: (index: number, patch: Partial<ScriptBeat>) => void;
  /** `only`: the picked beats; just those are rewritten. */
  onAsk: (instruction: string, only?: number[]) => void;
  onCancel: () => void;
  frames: (FrameSlot | undefined)[];
  aspect: Aspect;
  /** The template the frames are drawn in, when one was chosen. */
  styleName?: string;
  onRedraw: (index: number) => void;
  voice: VoiceState;
  onConfirm: () => void;
  onRetryVoice?: (index?: number) => void;
  /** The brief has a music bed, made with the voiceover. */
  music: boolean;
  /** Renders the film; offered only once its sound is made. */
  onRender: () => void;
  rendering: boolean;
  storyboard: StoryboardState;
  onContinue: () => void;
  continuing: boolean;
}) {
  const [ask, setAsk] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const busyVoice = voice.state === "storyboard" || voice.state === "voicing";
  useEffect(() => {
    if (!streaming && !busyVoice) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [streaming, busyVoice]);
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
  const words = beats.reduce((total, beat) => total + (beat.line ? beat.line.split(/\s+/).filter(Boolean).length : 0), 0);
  const writingAt = (index: number) => streaming && index === writing;
  // Beats picked in the document become chips in the prompt box; a request then names them, so "shorter" means those beats.
  const [picked, setPicked] = useState<number[]>([]);
  useEffect(() => setPicked((current) => current.filter((index) => index < beats.length)), [beats.length]);
  const togglePick = (index: number) => setPicked((current) => current.includes(index) ? current.filter((i) => i !== index) : [...current, index].sort((a, b) => a - b));
  const send = (instruction: string) => { if (instruction.length >= 3 && !streaming) { onAsk(instruction, picked.length ? picked : undefined); setAsk(""); setPicked([]); } };
  const submitAsk = () => send(ask.trim());
  const drawn = frames.filter((slot) => slot?.svg).length;
  const runs = scriptSeconds(beats, length.pace);
  // A script may run past the target when its idea needs the time; say so, once it is written, with a way to fit it.
  const [keptLong, setKeptLong] = useState<number | null>(null);
  const overLength = !streaming && beats.length > 0 && runs > length.seconds * 1.15 + 2 && keptLong !== runs;
  // Nothing renders without its sound: a voiced (or scored) film needs its takes first; a silent one can render at once.
  const confirmed = (!voiced && !music) || voice.state === "ready";
  const soundLabel = voiced && music ? "voiceover and music" : voiced ? "voiceover" : "music";
  const voicePct = Math.max(0, Math.min(100, Math.round(voice.progress ?? 0)));
  const voicedCount = voice.takes.filter(Boolean).length;
  const totalVoicedBeats = beats.filter((b) => b.line?.trim()).length;
  const hasVoiceErrors = Boolean(voice.errors && Object.keys(voice.errors).length > 0);
  const status = streaming
    ? <><i className="sc-live" />{firstAt ? `Writing · ${beats.length} ${beats.length === 1 ? "beat" : "beats"} so far · ${seconds}s` : `Writing your script… ${seconds}s`}</>
    : error ? error
    : voice.state === "storyboard" || voice.state === "voicing"
    ? <><i className="sc-live" />{`Recording ${soundLabel} in parallel · ${voicedCount}/${totalVoicedBeats} scenes ready · ${voicePct}%`}</>
    : voice.state === "failed" ? voice.error ?? `Could not make the ${soundLabel}.`
    : `${beats.length} beats${voiced ? ` · ${words} spoken words` : ""} · about ${runs}s${drawn < beats.length ? ` · ${drawn}/${beats.length} frames drawn` : ""}${voicedCount > 0 ? ` · ${voicedCount}/${totalVoicedBeats} voiced` : ""}`;

  return <div className="script-canvas">
    <header className="sc-head">
      <div>
        <h1>Storyboard</h1>
        <p role="status" aria-live="polite">{status}</p>
      </div>
      <div className="sc-actions">
        {streaming && <button className="secondary-button" onClick={onCancel}>Stop</button>}
        {/* Hearing the voice first is optional: Render makes any missing sound itself. */}
        {!streaming && (voiced || music) && !rendering && (
          busyVoice ? (
            <button
              type="button"
              className="secondary-button"
              disabled
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={voicePct}
              style={{
                position: "relative",
                overflow: "hidden",
                minWidth: 230,
                fontVariantNumeric: "tabular-nums"
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: `${voicePct}%`,
                  background: "linear-gradient(90deg, rgba(22, 139, 255, 0.25), rgba(22, 139, 255, 0.42))",
                  transition: "width 0.28s ease",
                  pointerEvents: "none"
                }}
              />
              <span style={{ position: "relative", zIndex: 1, display: "inline-flex", alignItems: "center", gap: 8 }}>
                <i className="sc-live" />
                Building {soundLabel}… {voicePct}%
              </span>
            </button>
          ) : !confirmed || voice.state === "failed" || hasVoiceErrors ? (
            <button
              type="button"
              className="secondary-button"
              disabled={streaming || beats.length === 0}
              title={`Make the ${soundLabel} now to listen before rendering`}
              onClick={() => (voice.state === "failed" || hasVoiceErrors ? (onRetryVoice ? onRetryVoice() : onConfirm()) : onConfirm())}
            >
              {voice.state === "failed" || hasVoiceErrors ? `Retry ${soundLabel}` : `Build ${soundLabel}`}
            </button>
          ) : (
            <button
              type="button"
              className="secondary-button"
              disabled={streaming || beats.length === 0}
              title={`Rebuild ${soundLabel}`}
              onClick={() => (onRetryVoice ? onRetryVoice() : onConfirm())}
            >
              ↻ Rebuild {soundLabel}
            </button>
          )
        )}
        {!streaming && <RenderAction seconds={runs} rendering={rendering} disabled={beats.length === 0} onRender={onRender}
          label={rendering ? (busyVoice ? `Making ${soundLabel} (${voicePct}%), then rendering…` : "Directing motion, then rendering…") : "Render video"} />}
      </div>
    </header>

    {overLength && <div className="sc-length" role="note">
      <p><b>Runs about {runs}s</b>, longer than the {length.seconds}s you chose{length.locked ? "" : ", because the idea needs the time"}. A longer film uses more tokens.</p>
      <div><button className="secondary-button" onClick={() => setKeptLong(runs)}>Keep {runs}s</button><button className="primary-button" disabled={busyVoice} onClick={onFit}>Fit to {length.seconds}s</button></div>
    </div>}
    <div className="sc-doc-head" aria-hidden="true" style={{ gridTemplateColumns: (FRAME_BOX[aspect] ?? FRAME_BOX["16:9"]).col }}><span>Script</span><span>Reference frames{styleName ? ` · ${styleName} style` : ""}</span></div>
    <ol className="sc-doc">
      {beats.map((beat, index) => {
        const locked = writingAt(index);
        const beatFlags = flags.filter((flag) => flag.beat === index);
        const take = voice.takes[index];
        const isPicked = picked.includes(index);
        // A click anywhere in a scene picks it for the prompt box (Cmd/Ctrl or Shift adds it to the ones picked); the
        // number button toggles. Buttons and the audio player keep their own clicks.
        const pickScene = (event: MouseEvent) => {
          if (streaming || (event.target as HTMLElement).closest("button, audio, a")) return;
          const add = event.metaKey || event.ctrlKey || event.shiftKey;
          setPicked((current) => add ? (current.includes(index) ? current : [...current, index].sort((a, b) => a - b)) : [index]);
        };
        return <li key={index} className={`sc-beat${locked ? " writing" : ""}${isPicked ? " picked" : ""}`} style={{ gridTemplateColumns: (FRAME_BOX[aspect] ?? FRAME_BOX["16:9"]).col, padding: "16px 6px", alignItems: "center" }} onClick={pickScene}>
          <div className="sc-text">
            <div className="sc-title-row">
              <button type="button" className="sc-num" aria-pressed={isPicked} disabled={streaming} aria-label={isPicked ? `Stop referring to beat ${index + 1}` : `Refer to beat ${index + 1} in the prompt`} title={isPicked ? "Remove from the prompt" : "Refer to this beat in the prompt"} onClick={() => togglePick(index)}>{String(index + 1).padStart(2, "0")}</button>
              <Field label={`Beat ${index + 1} key phrase`} className="sc-keyword" value={beat.keyword} placeholder="Key phrase" readOnly={locked} caret={locked && open === "keyword"} onChange={(keyword) => onEdit(index, { keyword: keyword.slice(0, 28) })} />
              <div className="sc-beat-tools">
                {versions[index] && <span className="sc-versions" aria-label={`Version ${versions[index]!.at + 1} of ${versions[index]!.count}`}>
                  <button type="button" disabled={streaming || versions[index]!.at === 0} aria-label={`Previous version of beat ${index + 1}`} onClick={() => onVersion(index, versions[index]!.at - 1)}>‹</button>
                  <span>{versions[index]!.at + 1}/{versions[index]!.count}</span>
                  <button type="button" disabled={streaming || versions[index]!.at === versions[index]!.count - 1} aria-label={`Next version of beat ${index + 1}`} onClick={() => onVersion(index, versions[index]!.at + 1)}>›</button>
                </span>}
                <button type="button" className="sc-reimagine" disabled={streaming} title="A new way to show this scene. The current version is kept." aria-label={`Reimagine beat ${index + 1}`} onClick={() => onReimagine(index)}>
                  {locked ? "Reimagining…" : "Reimagine"}
                </button>
              </div>
            </div>
            <dl>
              <div><dt>Visual</dt><dd><Field label={`Beat ${index + 1} visual`} className="sc-visual" value={beat.visual ?? ""} placeholder="What the viewer sees" readOnly={locked} caret={locked && open === "visual"} onChange={(visual) => onEdit(index, { visual: visual.slice(0, 200) || null })} /></dd></div>
              <div><dt>On screen</dt><dd><Field label={`Beat ${index + 1} on-screen text`} className="sc-screen" value={beat.onScreen ?? ""} placeholder="Only the key phrase" readOnly={locked} caret={locked && open === "onScreen"} onChange={(onScreen) => onEdit(index, { onScreen: onScreen.slice(0, 60) || null })} /></dd></div>
              {voiced && <div><dt>Voiceover</dt><dd>
                <Field label={`Beat ${index + 1} voiceover`} className="sc-line" value={beat.line ?? ""} placeholder="Voiceover" readOnly={locked} caret={locked && open === "line"} onChange={(line) => onEdit(index, { line: line || null })} />
                {voice.busyIndices?.includes(index) && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
                    <i className="sc-live" />
                    <span>Recording scene {index + 1} voiceover…</span>
                  </div>
                )}
                {take && !voice.busyIndices?.includes(index) && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                    <audio key={take} className="sc-take" controls preload="metadata" src={take} aria-label={`Voiceover for beat ${index + 1}`} style={{ marginTop: 0, flex: "1 1 220px" }} />
                    {onRetryVoice && (
                      <button
                        type="button"
                        className="sc-reimagine"
                        disabled={busyVoice || streaming}
                        title="Record a fresh take for this scene"
                        onClick={() => onRetryVoice(index)}
                      >
                        ↻ Retry voice
                      </button>
                    )}
                  </div>
                )}
                {!take && !voice.busyIndices?.includes(index) && voice.errors?.[index] && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                    <small className="sc-flag" style={{ margin: 0 }}>{voice.errors[index]}</small>
                    {onRetryVoice && (
                      <button
                        type="button"
                        className="sc-reimagine"
                        disabled={busyVoice || streaming}
                        onClick={() => onRetryVoice(index)}
                      >
                        ↻ Retry scene voice
                      </button>
                    )}
                  </div>
                )}
              </dd></div>}
            </dl>
            {beatFlags.map((flag) => <small className="sc-flag" key={flag.message}>{flag.message} Edit it, or keep it if it is right.</small>)}
          </div>
          <Frame onPick={streaming ? undefined : (add: boolean) => setPicked((current) => add ? (current.includes(index) ? current : [...current, index].sort((x, y) => x - y)) : [index])} picked={isPicked} slot={frames[index]} aspect={aspect} index={index} writing={locked} onRedraw={() => onRedraw(index)} />
        </li>;
      })}
      {streaming && !scoped && Array.from({ length: beats.length === 0 ? 3 : 1 }, (_, index) => {
        const box = FRAME_BOX[aspect] ?? FRAME_BOX["16:9"];
        return <li key={`s${index}`} className="sc-beat sc-skeleton" aria-hidden="true" style={{ gridTemplateColumns: box.col, padding: "16px 6px", alignItems: "center" }}><div className="sc-text"><i /><i className="short" /><i className="long" /></div><div className="sc-frame sc-frame-wait" style={{ width: box.width, height: box.height, aspectRatio: RATIO[aspect], borderRadius: 12, justifySelf: "end" }} /></li>;
      })}
    </ol>
    {storyboard.state === "failed" && !streaming && <p className="sc-note">{storyboard.error ?? "Could not plan the storyboard."}</p>}

    <form className="sc-ask" onSubmit={(event) => { event.preventDefault(); submitAsk(); }}>
      {(picked.length > 0 || !ask) && <div className="sc-chips">
        {picked.map((index) => <span className="sc-chip" key={index}>Beat {index + 1} · {beats[index]?.keyword}<button type="button" aria-label={`Stop referring to beat ${index + 1}`} onClick={() => togglePick(index)}>×</button></span>)}
        {!ask && SUGGESTIONS.map((label) => <button type="button" className="sc-suggest" key={label} disabled={streaming || beats.length === 0} onClick={() => send(label)}>{label}</button>)}
      </div>}
      <div className="sc-ask-row">
        <input value={ask} onChange={(event) => setAsk(event.target.value)} disabled={streaming || beats.length === 0} maxLength={400} aria-label="Ask the AI to change the script"
          placeholder={streaming ? "Writing…" : picked.length ? `What should change in ${picked.length === 1 ? `beat ${picked[0]! + 1}` : "these beats"}?` : "Ask for a change, or click a scene to refer to it"} />
        <button className="sc-send" type="submit" aria-label="Send" disabled={streaming || ask.trim().length < 3}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 15V5M5 10l5-5 5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
      </div>
    </form>
  </div>;
}
