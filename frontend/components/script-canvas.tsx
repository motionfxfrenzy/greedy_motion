"use client";

import { Fragment, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from "react";
import { ANIMATION_TIER_SPECS, DEFAULT_ANIMATION_TIER, formatDurationSeconds, PLANS, PAID_TIERS, PREMIUM_LOCKED_COPY, PREVIEW_ALLOWANCE, SCRIPT_BEATS_MAX, SCRIPT_BEATS_MIN, TOP_UP, annualMonthlyUsd, annualSavingsPercent, filmsFromTokens, remapIndicesOnInsert, remapIndicesOnRemove, type AnimationTier, type BillingInterval, type BillingPolicyVersion, renderCostMillitokens, renderExportCostMillitokensV2, scriptSeconds, tokensFromMilli, type Aspect, type BeatPlan, type Pace, type ScriptBeat } from "@videosaas/contracts";
import Link from "next/link";
import { getMyTokens, startCheckout, type LimitError, type ScriptFlag } from "../lib/api";

export type UndoSceneBanner = {
  index: number;
  keyword: string;
  busy?: boolean;
  error?: string | null;
};

export function sceneBoundaryLabel(position: number, count: number): string {
  if (position <= 0) return "Add a scene before Scene 1";
  if (position >= count) return `Add a scene after Scene ${count}`;
  return `Add a scene between Scene ${position} and Scene ${position + 1}`;
}

export function sceneBoundaryPlaceholder(position: number, beats: readonly ScriptBeat[]): string {
  if (position <= 0) {
    const first = beats[0]?.keyword;
    return `Describe the opening scene before Scene 1${first ? ` (“${first}”)` : ""}…`;
  }
  if (position >= beats.length) {
    const last = beats[beats.length - 1]?.keyword;
    return `Describe the closing scene after Scene ${beats.length}${last ? ` (“${last}”)` : ""}…`;
  }
  const prev = beats[position - 1]?.keyword;
  const next = beats[position]?.keyword;
  return `Describe what happens between Scene ${position}${prev ? ` (“${prev}”)` : ""} and Scene ${position + 1}${next ? ` (“${next}”)` : ""}…`;
}

export type StoryboardState = { state: "waiting" | "building" | "ready" | "stale" | "failed"; plan?: BeatPlan; error?: string; /** When the storyboard job started (ms), while building. */ startedAt?: number; resuming?: boolean };
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
function Field({ value, onChange, readOnly, className, placeholder, caret, label, dataSceneKeyword }: { value: string; onChange: (next: string) => void; readOnly: boolean; className?: string; placeholder?: string; caret?: boolean; label: string; dataSceneKeyword?: number }) {
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
  return <textarea ref={ref} rows={1} className={className} value={value} placeholder={placeholder} aria-label={label} {...(dataSceneKeyword !== undefined ? { "data-scene-keyword": String(dataSceneKeyword) } : {})} onChange={(event) => onChange(event.target.value.replace(/\n/g, " "))} />;
}

/** Whether `value` is already a resolved image URL / data URI rather than raw `<svg>` markup. */
export const isImageAssetUrl = (value: string) =>
  /^(data:image\/|https?:\/\/|blob:|\/)/i.test(value.trim());

/** A frame is SVG text from the model (or a data:/static/backend image URL); as an <img> nothing in it can run or load. */
export const svgSrc = (svg: string) => {
  const trimmed = svg.trim();
  return isImageAssetUrl(trimmed)
    ? trimmed
    : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(/^<svg[^>]*\sxmlns\s*=/.test(trimmed) ? trimmed : trimmed.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"'))}`;
};

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
export function TokenModal({ cost, balance, onClose }: { cost: number; balance: number; onClose: () => void }) {
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

/** What a refusal means for the person, in words: the heading, and whether a purchase (plan or token pack) can resolve it. */
export function limitCopy(limit: LimitError) {
  const have = limit.limit ?? 0;
  if (limit.code === "preview_call_cap") return { title: "This film has had a lot of changes", plans: false, pack: false };
  if (limit.code === "insufficient_tokens") return { title: "You need more tokens for this", plans: true, pack: true };
  if (limit.code === "premium_requires_subscription") return { title: "Upgrade to access Premium animation", plans: true, pack: false };
  if (limit.tier === "free" || limit.tier === null) return { title: `You've used your ${have || 3} free previews`, plans: true, pack: false };
  return { title: "You've reached this month's film limit", plans: true, pack: false };
}

/**
 * The way forward for a refusal, shown beside the message: the plans that would continue it (each straight to checkout), a token pack
 * when only tokens are short, and an honest note when nothing can be bought (this film's changes are capped, or the top plan's
 * monthly films are used and reset on the 1st).
 */
export function PlanLimitOptions({ limit }: { limit: LimitError }) {
  const [opening, setOpening] = useState<Product | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [interval, setInterval] = useState<BillingInterval>("month");
  const copy = limitCopy(limit);
  const have = limit.limit ?? 0;
  const tokens = limit.code === "insufficient_tokens";
  // Plans that raise what is short: more films a month, or (for tokens) a bigger monthly grant than the current plan's.
  const current = PAID_TIERS.find((tier) => tier === limit.tier);
  const options = !copy.plans ? [] : PAID_TIERS.filter((tier) => tokens ? (!current || PLANS[tier].tokens > PLANS[current].tokens) : PREVIEW_ALLOWANCE[tier] > have);
  const need = tokens && limit.needed !== null && limit.remaining !== null ? Math.max(0, Math.round((limit.needed - limit.remaining) * 100) / 100) : null;
  const buy = async (product: Product) => {
    setOpening(product);
    setFailed(null);
    try { window.location.assign(await startCheckout(product, interval)); }
    catch (caught) { setFailed(caught instanceof Error ? caught.message : "Could not open checkout."); setOpening(null); }
  };
  const top = copy.plans && !tokens && options.length === 0;
  const featured = options.includes("pro") ? "pro" : options[0];
  const money = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  return <div className="lim">
    {need !== null && <p className="lim-need">This needs <b>{limit.needed} tokens</b>. You have <b>{limit.remaining}</b>, so you need <b>{need} more</b>.</p>}
    {options.length > 0 && <div className="billing-toggle" role="radiogroup" aria-label="Billing period">
      <button type="button" role="radio" aria-checked={interval === "month"} className={interval === "month" ? "on" : ""} onClick={() => setInterval("month")}>Monthly</button>
      <button type="button" role="radio" aria-checked={interval === "year"} className={interval === "year" ? "on" : ""} onClick={() => setInterval("year")}>Annual<span className="billing-save-pill">Save 17%</span></button>
    </div>}
    <div className="lim-grid" data-count={options.length + (copy.pack ? 1 : 0)}>
      {copy.pack && <article className="lim-card">
        <div className="lim-top"><h3>Token pack</h3><p>One-time, no subscription.</p></div>
        <p className="lim-price"><b>${TOP_UP.priceUsd}</b><span> once</span></p>
        <p className="lim-gets"><b>{TOP_UP.tokens} tokens</b>{need !== null && TOP_UP.tokens >= need ? " · covers this" : ""}</p>
        <button type="button" className="secondary-button" disabled={opening !== null} onClick={() => void buy("topup")}>{opening === "topup" ? "Opening…" : "Buy pack"}</button>
      </article>}
      {options.map((tier) => {
        const plan = PLANS[tier];
        const annual = interval === "year";
        const films = filmsFromTokens(plan.tokens, 30);
        return <article key={tier} className={`lim-card${tier === featured ? " featured" : ""}`} aria-label={`${plan.name} plan`}>
          {tier === featured && <span className="plan-flag">Most chosen</span>}
          <div className="lim-top"><h3>{plan.name}</h3><p>{plan.blurb}</p></div>
          <p className="lim-price"><b>${annual ? money(annualMonthlyUsd(tier)) : plan.priceUsd}</b><span> / month</span></p>
          <p className="lim-note">{annual ? `$${plan.annualPriceUsd} billed yearly · save ${annualSavingsPercent(tier)}%` : "Billed monthly"}</p>
          <ul>
            <li><b>{PREVIEW_ALLOWANCE[tier]} films</b> a month to try</li>
            <li><b>{plan.tokens.toLocaleString()} tokens</b> a month · about {films} thirty-second films</li>
            <li>No watermark{plan.proEditor ? " · Pro editor" : ""}</li>
          </ul>
          <button type="button" className={tier === featured ? "accent-button" : "secondary-button"} disabled={opening !== null} onClick={() => void buy(tier)}>{opening === tier ? "Opening…" : `Choose ${plan.name}`}</button>
        </article>;
      })}
    </div>
    {top && <p className="lim-note">You are on our top plan, so there is nothing to upgrade to. Your films reset on the 1st; until then you can keep working on the films you have started, or write to us if you need more.</p>}
    {copy.plans && <Link className="lim-compare" href="/pricing" target="_blank" rel="noreferrer">Compare all plans on the pricing page →</Link>}
    {failed && <p className="sc-modal-error" role="alert">{failed}</p>}
  </div>;
}

/** The refusal as a dialog (used away from the storyboard page). */
export function PlanLimitModal({ limit, onClose, onBack }: { limit: LimitError; onClose: () => void; onBack?: () => void }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  const capped = limit.code === "preview_call_cap";
  return <div className="sc-modal-backdrop" onClick={onClose}>
    <div className="sc-modal lim-modal" role="dialog" aria-modal="true" aria-labelledby="sc-limit-title" onClick={(event) => event.stopPropagation()}>
      <header>
        <h2 id="sc-limit-title">{limitCopy(limit).title}</h2>
        <button type="button" className="sc-modal-close" aria-label="Close" onClick={onClose}>×</button>
      </header>
      <p className="sc-modal-sum">{limit.message}</p>
      <PlanLimitOptions limit={limit} />
      <small>{capped ? "Start a new film to keep going; your other films are not affected." : "Nothing is lost: your brief and settings are saved, and you can pick up where you left off after checkout."}</small>
      <div className="sc-modal-actions">
        {onBack && <button type="button" className="secondary-button" onClick={onBack}>Back to brief</button>}
        <button type="button" className="secondary-button" onClick={onClose}>Close</button>
      </div>
    </div>
  </div>;
}

/** Render, or (when the balance does not cover the film) Add tokens, which opens the purchase modal. */
function RenderAction({ seconds, cost: costProp, pricingVersion, rendering, label, disabled, onRender }: { seconds: number; cost?: number | null; pricingVersion?: BillingPolicyVersion; rendering: boolean; label: string; disabled: boolean; onRender: () => void }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [buying, setBuying] = useState(false);
  useEffect(() => { getMyTokens().then((summary) => setBalance(summary.remaining)).catch(() => setBalance(null)); }, []);
  const cost =
    typeof costProp === "number"
      ? costProp
      : pricingVersion === "v2_step_tier"
        ? tokensFromMilli(renderExportCostMillitokensV2(seconds))
        : tokensFromMilli(renderCostMillitokens(seconds));
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
export function ScriptCanvas({ projectId, keepOverLength, onKeepOverLength, music, onRender, rendering, beats, open, writing, scoped, versions, onReimagine, onVersion, streaming, startedAt, firstAt, flags, error, limit, onTryAgain, onBackToBrief, voiced, length, onFit, onEdit, onAsk, onCancel, frames, aspect, styleName, onRedraw, voice, onConfirm, onRetryVoice, storyboard, onContinue, continuing, onInsertScene, onRemoveScene, undoScene, onUndoRemoveScene, onDismissUndoScene, animationTier = DEFAULT_ANIMATION_TIER, canUsePremium = false, onAnimationTierChange, onLockedPremiumClick, animationQuoteTokens, voiceQuoteTokens }: {
  /** Identifies the open project so duration acceptance never leaks across projects. */
  projectId?: string;
  /** Durable per-project flag indicating the user already accepted the over-length notice. */
  keepOverLength?: boolean;
  /** Persists the user's "Keep Ns" choice for this project; rejecting rolls back the dismissal and shows an error. */
  onKeepOverLength?: () => Promise<void> | void;
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
  /** Set when the failure is the plan's allowance: the empty page offers the plans. */
  limit?: LimitError | null;
  onTryAgain?: () => void;
  onBackToBrief?: () => void;
  voiced: boolean;
  /** The length the person chose and how the script is read; `locked` holds it to that length; `scriptLed` means runtime follows the script; `keepOverLength` remembers acceptance. */
  length: { seconds: number; pace: Pace; locked: boolean; scriptLed?: boolean; keepOverLength?: boolean };
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
  /** Inserts one generated scene at boundary `position` (`0..beats.length`) from `prompt`. */
  onInsertScene?: (position: number, prompt: string, signal?: AbortSignal) => Promise<void>;
  /** Removes the scene at `index` (`0..beats.length - 1`). */
  onRemoveScene?: (index: number) => Promise<void> | void;
  /** Most recently removed scene available for one-click Undo restoration. */
  undoScene?: UndoSceneBanner | null;
  /** Restores the most recently removed scene at its original index with its assets intact. */
  onUndoRemoveScene?: () => Promise<void> | void;
  /** Dismisses the Undo banner. */
  onDismissUndoScene?: () => void;
  /** Selected animation authoring quality tier ("standard" = Gemini 3.8 Flash, "premium" = Claude Opus 5.5). */
  animationTier?: AnimationTier;
  /** Whether the signed-in account has an active paid subscription eligible for Premium animation. */
  canUsePremium?: boolean;
  onAnimationTierChange?: (tier: AnimationTier) => void;
  onLockedPremiumClick?: () => void;
  animationQuoteTokens?: number | null;
  voiceQuoteTokens?: number | null;
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
  // A script may run past the target when its idea needs the time; say so once per project, with a way to keep or fit it.
  const keepKey = projectId ?? "__default__";
  const [keptByProject, setKeptByProject] = useState<Record<string, boolean>>({});
  const [savingKeep, setSavingKeep] = useState(false);
  const [keepError, setKeepError] = useState<string | null>(null);
  useEffect(() => {
    setSavingKeep(false);
    setKeepError(null);
  }, [keepKey]);

  // ---------- Scene boundary insertion & removal state ----------
  const [openBoundary, setOpenBoundary] = useState<number | null>(null);
  const [boundaryDrafts, setBoundaryDrafts] = useState<Record<number, string>>({});
  const [insertingAt, setInsertingAt] = useState<number | null>(null);
  const [insertError, setInsertError] = useState<string | null>(null);
  const [removingAt, setRemovingAt] = useState<number | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const insertStopRef = useRef<AbortController | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const docListRef = useRef<HTMLOListElement | null>(null);
  const focusSceneRef = useRef<number | null>(null);

  useEffect(() => {
    insertStopRef.current?.abort();
    insertStopRef.current = null;
    setOpenBoundary(null);
    setBoundaryDrafts({});
    setInsertingAt(null);
    setInsertError(null);
    setRemovingAt(null);
    setRemoveError(null);
  }, [keepKey]);

  useEffect(() => {
    if (openBoundary === null) return;
    const raf = window.requestAnimationFrame(() => {
      const el = composerInputRef.current;
      const box = el?.closest(".sc-insert-composer");
      box?.scrollIntoView({ block: "nearest" });
      el?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [openBoundary]);

  const undoBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!undoScene || !docListRef.current) return;
    const neighborIdx = Math.min(undoScene.index, Math.max(0, beats.length - 1));
    const row = docListRef.current.querySelector<HTMLElement>(`li[data-scene-index="${neighborIdx}"]`);
    row?.scrollIntoView({ block: "nearest" });
    const raf = window.requestAnimationFrame(() => {
      undoBtnRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [undoScene?.index, Boolean(undoScene)]);

  useEffect(() => {
    const targetIdx = focusSceneRef.current;
    if (targetIdx === null || !docListRef.current) return;
    focusSceneRef.current = null;
    const row = docListRef.current.querySelector<HTMLElement>(`li[data-scene-index="${targetIdx}"]`);
    const field = docListRef.current.querySelector<HTMLTextAreaElement>(`textarea[data-scene-keyword="${targetIdx}"]`);
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    field?.focus({ preventScroll: true });
  }, [beats]);

  const maxScenesReached = beats.length >= SCRIPT_BEATS_MAX;
  const minScenesReached = beats.length <= SCRIPT_BEATS_MIN;
  const structuralBusy = insertingAt !== null || removingAt !== null || Boolean(undoScene?.busy);

  const openComposerAt = (position: number) => {
    if (streaming || structuralBusy || maxScenesReached) return;
    setInsertError(null);
    setRemoveError(null);
    setOpenBoundary(position);
  };

  const cancelComposer = () => {
    if (insertingAt !== null) {
      insertStopRef.current?.abort();
      insertStopRef.current = null;
      setInsertingAt(null);
      return;
    }
    setInsertError(null);
    setOpenBoundary(null);
  };

  const submitInsertAt = async (position: number) => {
    if (!onInsertScene || streaming || structuralBusy) return;
    const rawPrompt = (boundaryDrafts[position] ?? "").trim().replace(/\s+/g, " ");
    if (rawPrompt.length < 3) {
      setInsertError("Describe the new scene in at least a few words.");
      composerInputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (beats.length >= SCRIPT_BEATS_MAX) {
      setInsertError(`A storyboard can have at most ${SCRIPT_BEATS_MAX} scenes.`);
      return;
    }
    setInsertError(null);
    setInsertingAt(position);
    const stop = new AbortController();
    insertStopRef.current = stop;
    try {
      await onInsertScene(position, rawPrompt, stop.signal);
      if (stop.signal.aborted) return;
      setPicked((current) => remapIndicesOnInsert(current, position));
      setBoundaryDrafts((current) => {
        const next = { ...current };
        delete next[position];
        return next;
      });
      setOpenBoundary(null);
      focusSceneRef.current = position;
    } catch (caught) {
      if (stop.signal.aborted) return;
      setInsertError(caught instanceof Error ? caught.message : "Could not add the scene. Try again.");
      composerInputRef.current?.focus({ preventScroll: true });
    } finally {
      if (insertStopRef.current === stop) insertStopRef.current = null;
      setInsertingAt(null);
    }
  };

  const handleRemoveScene = async (index: number) => {
    if (!onRemoveScene || streaming || structuralBusy) return;
    if (beats.length <= SCRIPT_BEATS_MIN) {
      setRemoveError("A storyboard needs at least one scene.");
      return;
    }
    setRemoveError(null);
    setRemovingAt(index);
    const prevPicked = picked;
    setPicked((current) => remapIndicesOnRemove(current, index));
    if (openBoundary !== null) {
      if (openBoundary === index || openBoundary === index + 1) setOpenBoundary(null);
      else if (openBoundary > index + 1) setOpenBoundary(openBoundary - 1);
    }
    try {
      await onRemoveScene(index);
    } catch (caught) {
      setPicked(prevPicked);
      setRemoveError(caught instanceof Error ? caught.message : "Could not remove the scene. Try again.");
    } finally {
      setRemovingAt(null);
    }
  };

  const handleUndoRemove = async () => {
    if (!onUndoRemoveScene || !undoScene || streaming || structuralBusy) return;
    const restoreIndex = undoScene.index;
    setRemoveError(null);
    try {
      await onUndoRemoveScene();
      setPicked((current) => remapIndicesOnInsert(current, restoreIndex));
      focusSceneRef.current = restoreIndex;
    } catch (caught) {
      setRemoveError(caught instanceof Error ? caught.message : "Could not restore the scene. Try again.");
    }
  };

  const renderBoundary = (position: number) => {
    if (streaming || !onInsertScene) return null;
    const isOpen = openBoundary === position;
    const isBusyHere = insertingAt === position;
    const title = sceneBoundaryLabel(position, beats.length);
    const beforeBeat = position > 0 ? beats[position - 1] : null;
    const afterBeat = position < beats.length ? beats[position] : null;
    const draftValue = boundaryDrafts[position] ?? "";

    if (!isOpen) {
      return (
        <li key={`boundary-${position}`} className="sc-boundary" data-boundary={position}>
          <span className="sc-boundary-line" aria-hidden="true" />
          <button
            type="button"
            className="sc-add-scene-btn"
            disabled={structuralBusy || maxScenesReached}
            aria-label={title}
            title={maxScenesReached ? `A storyboard can have at most ${SCRIPT_BEATS_MAX} scenes` : title}
            onClick={() => openComposerAt(position)}
          >
            <span className="sc-add-scene-plus" aria-hidden="true">+</span>
            <span>Add scene</span>
          </button>
          {maxScenesReached && position === beats.length && (
            <small className="sc-boundary-limit" role="note">Max {SCRIPT_BEATS_MAX} scenes</small>
          )}
          <span className="sc-boundary-line" aria-hidden="true" />
        </li>
      );
    }

    return (
      <li key={`boundary-${position}`} className="sc-boundary sc-boundary--open" data-boundary={position}>
        <div
          className="sc-insert-composer"
          role="region"
          aria-labelledby={`sc-insert-heading-${position}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sc-insert-head">
            <div className="sc-insert-title-wrap">
              <strong id={`sc-insert-heading-${position}`} className="sc-insert-title">{title}</strong>
              <span className="sc-insert-neighbors">
                {beforeBeat && <span>After Scene {position}: “{beforeBeat.keyword}”</span>}
                {beforeBeat && afterBeat && <span aria-hidden="true">·</span>}
                {afterBeat && <span>Before Scene {position + 1}: “{afterBeat.keyword}”</span>}
              </span>
            </div>
            <span className="sc-insert-runtime-note">Adding a scene may extend runtime (~+4–6s). Existing scenes stay untouched.</span>
          </div>
          <textarea
            ref={composerInputRef}
            rows={2}
            maxLength={400}
            className="sc-insert-textarea"
            aria-label={title}
            disabled={isBusyHere}
            value={draftValue}
            placeholder={sceneBoundaryPlaceholder(position, beats)}
            onChange={(event) => {
              const nextVal = event.target.value;
              setBoundaryDrafts((curr) => ({ ...curr, [position]: nextVal }));
              if (insertError) setInsertError(null);
            }}
            onKeyDown={(event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelComposer();
              } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submitInsertAt(position);
              }
            }}
          />
          {insertError && (
            <p className="sc-insert-error" role="alert">{insertError}</p>
          )}
          <div className="sc-insert-actions">
            {isBusyHere && (
              <span className="sc-insert-progress" role="status" aria-live="polite">
                <i className="sc-live" />
                Writing scene…
              </span>
            )}
            <button
              type="button"
              className="secondary-button sc-insert-cancel"
              onClick={cancelComposer}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary-button sc-insert-submit"
              disabled={isBusyHere || draftValue.trim().length < 3}
              onClick={() => void submitInsertAt(position)}
            >
              {isBusyHere ? "Adding scene…" : "Add scene"}
            </button>
          </div>
        </div>
      </li>
    );
  };
  const acceptedOverLength = Boolean(keepOverLength || length.keepOverLength || keptByProject[keepKey]);
  const overLength = !streaming && beats.length > 0 && !length.scriptLed && runs > length.seconds * 1.15 + 2 && !acceptedOverLength;
  const canvasRootRef = useRef<HTMLDivElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const dock = dockRef.current;
    const root = canvasRootRef.current;
    if (!dock || !root) return;
    const syncDockHeight = () => {
      const h = Math.ceil(dock.getBoundingClientRect().height);
      if (h > 0) root.style.setProperty("--sc-dock-height", `${h}px`);
    };
    syncDockHeight();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(syncDockHeight);
    ro.observe(dock);
    return () => ro.disconnect();
  }, [picked.length, ask, beats.length]);
  const handleKeepOverLength = async () => {
    if (savingKeep || acceptedOverLength) return;
    setKeepError(null);
    setSavingKeep(true);
    setKeptByProject((current) => ({ ...current, [keepKey]: true }));
    try {
      await onKeepOverLength?.();
    } catch (caught) {
      setKeptByProject((current) => {
        const next = { ...current };
        delete next[keepKey];
        return next;
      });
      setKeepError(caught instanceof Error ? caught.message : "Could not save your choice. Try again.");
    } finally {
      setSavingKeep(false);
    }
  };
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
    : storyboard.state === "building" && storyboard.resuming
    ? <><i className="sc-live" />{`Resuming your storyboard · ${beats.length} beats · about ${formatDurationSeconds(runs)}`}</>
    : `${beats.length} beats${voiced ? ` · ${words} spoken words` : ""} · about ${formatDurationSeconds(runs)}${drawn < beats.length ? ` · ${drawn}/${beats.length} frames drawn` : ""}${voicedCount > 0 ? ` · ${voicedCount}/${totalVoicedBeats} voiced` : ""}`;

  if (!streaming && beats.length === 0 && error) return <div className="script-canvas">
    <header className="sc-head"><div className="sc-head-title"><h1>Storyboard</h1></div></header>
    <div className="sc-scroll">
      <section className="sc-empty" role="alert">
        <h2>{limit ? limitCopy(limit).title : "We couldn't write your script"}</h2>
        <p>{error}</p>
        {limit && <PlanLimitOptions limit={limit} />}
        <p className="sc-empty-note">{limit?.code === "preview_call_cap" ? "Start a new film to keep going; your other films are not affected." : limit ? "Your brief is saved. After checkout, come back here and press Try again: the storyboard is written straight away." : "Your brief is saved. Nothing was charged."}</p>
        <div className="sc-empty-actions">
          {onTryAgain && limit?.code !== "preview_call_cap" && <button type="button" className={limit ? "secondary-button" : "primary-button"} onClick={onTryAgain}>Try again</button>}
          {onBackToBrief && <button type="button" className="secondary-button" onClick={onBackToBrief}>Back to brief</button>}
        </div>
      </section>
    </div>
  </div>;

  return <div ref={canvasRootRef} className="script-canvas">
    <header className="sc-head">
      <div className="sc-head-title">
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
                minWidth: "min(200px, 100%)",
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
              {voice.state === "failed" || hasVoiceErrors ? `Retry ${soundLabel}` : `Build ${soundLabel}`}{voiceQuoteTokens && voiceQuoteTokens > 0 ? ` · ${voiceQuoteTokens}t` : ""}
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
        {!streaming && onAnimationTierChange && (
          <div className="ss-chips sc-tier-chips" role="radiogroup" aria-label="Animation quality" title={!canUsePremium ? PREMIUM_LOCKED_COPY : "Animation quality tier"}>
            {(["standard", "premium"] as AnimationTier[]).map((tierId) => {
              const effectiveTier: AnimationTier = animationTier === "premium" && canUsePremium ? "premium" : "standard";
              const isSelected = effectiveTier === tierId;
              const locked = tierId === "premium" && !canUsePremium;
              const spec = ANIMATION_TIER_SPECS[tierId];
              return (
                <button
                  type="button"
                  key={tierId}
                  role="radio"
                  aria-checked={isSelected}
                  aria-disabled={locked || undefined}
                  className={`${isSelected ? "selected" : ""}${locked ? " is-locked" : ""}`.trim()}
                  title={locked ? PREMIUM_LOCKED_COPY : spec.summary}
                  onClick={() => {
                    if (locked) {
                      onLockedPremiumClick?.();
                      return;
                    }
                    onAnimationTierChange(tierId);
                  }}
                >
                  {spec.label}{locked ? " 🔒" : ""}
                </button>
              );
            })}
          </div>
        )}
        {!streaming && (
          <button
            type="button"
            className="primary-button"
            disabled={beats.length === 0 || rendering}
            onClick={onRender}
          >
            {rendering
              ? "Preparing animation…"
              : `Create animation${animationQuoteTokens && animationQuoteTokens > 0 ? ` (${animationQuoteTokens} tokens)` : ""} →`}
          </button>
        )}
      </div>
    </header>

    {(undoScene || removeError) && (
      <div className="sc-undo-banner" role="status" aria-live="polite">
        <div className="sc-undo-copy">
          {undoScene && (
            <span>
              Removed <b>Scene {undoScene.index + 1}</b>{undoScene.keyword ? ` (“${undoScene.keyword}”)` : ""}.
            </span>
          )}
          {(removeError || undoScene?.error) && (
            <small className="sc-length-error" role="alert">{removeError ?? undoScene?.error}</small>
          )}
        </div>
        {undoScene && onUndoRemoveScene && (
          <div className="sc-undo-actions">
            <button
              ref={undoBtnRef}
              type="button"
              className="secondary-button sc-undo-btn"
              disabled={Boolean(undoScene.busy) || streaming || structuralBusy || maxScenesReached}
              aria-label={`Undo removing Scene ${undoScene.index + 1}`}
              onClick={() => void handleUndoRemove()}
            >
              {undoScene.busy ? "Restoring…" : "Undo"}
            </button>
            {onDismissUndoScene && (
              <button
                type="button"
                className="sc-undo-dismiss"
                disabled={Boolean(undoScene.busy)}
                aria-label="Dismiss undo notice"
                onClick={onDismissUndoScene}
              >
                ×
              </button>
            )}
          </div>
        )}
      </div>
    )}

    <div className="sc-scroll">
      {(overLength || keepError) && <div className="sc-length" role="note">
        <div className="sc-length-copy">
          <p><b>Runs about {formatDurationSeconds(runs)}</b>, longer than the {formatDurationSeconds(length.seconds)} you chose{length.locked ? "" : ", because the idea needs the time"}. A longer film uses more tokens.</p>
          {keepError && <small className="sc-length-error" role="alert">{keepError}</small>}
        </div>
        <div className="sc-length-actions"><button type="button" className="secondary-button" disabled={savingKeep} onClick={() => void handleKeepOverLength()}>{savingKeep ? "Saving…" : `Keep ${runs}s`}</button><button type="button" className="primary-button" disabled={busyVoice || savingKeep} onClick={onFit}>Fit to {length.seconds}s</button></div>
      </div>}
      <div className="sc-doc-head" aria-hidden="true" style={{ gridTemplateColumns: (FRAME_BOX[aspect] ?? FRAME_BOX["16:9"]).col }}><span>Script</span><span>Reference frames{styleName ? ` · ${styleName} style` : ""}</span></div>
      <ol className="sc-doc" ref={docListRef}>
        {beats.length > 0 && renderBoundary(0)}
        {beats.map((beat, index) => {
          const locked = writingAt(index);
          const beatFlags = flags.filter((flag) => flag.beat === index);
          const take = voice.takes[index];
          const isPicked = picked.includes(index);
          // A click anywhere in a scene picks it for the prompt box (Cmd/Ctrl or Shift adds it to the ones picked); the
          // number button toggles. Buttons, inputs and the audio player keep their own clicks.
          const pickScene = (event: MouseEvent) => {
            if (streaming || (event.target as HTMLElement).closest("button, audio, a, textarea, input, .sc-insert-composer")) return;
            const add = event.metaKey || event.ctrlKey || event.shiftKey;
            setPicked((current) => add ? (current.includes(index) ? current : [...current, index].sort((a, b) => a - b)) : [index]);
          };
          return <Fragment key={beat.id ?? `beat-${index}`}>
            <li data-scene-index={index} data-scene-id={beat.id ?? `idx-${index}`} className={`sc-beat${locked ? " writing" : ""}${isPicked ? " picked" : ""}`} style={{ gridTemplateColumns: (FRAME_BOX[aspect] ?? FRAME_BOX["16:9"]).col, padding: "16px 6px", alignItems: "center" }} onClick={pickScene}>
              <div className="sc-text">
                <div className="sc-title-row">
                  <button type="button" className="sc-num" aria-pressed={isPicked} disabled={streaming} aria-label={isPicked ? `Stop referring to beat ${index + 1}` : `Refer to beat ${index + 1} in the prompt`} title={isPicked ? "Remove from the prompt" : "Refer to this beat in the prompt"} onClick={() => togglePick(index)}>{String(index + 1).padStart(2, "0")}</button>
                  <Field label={`Beat ${index + 1} key phrase`} dataSceneKeyword={index} className="sc-keyword" value={beat.keyword} placeholder="Key phrase" readOnly={locked} caret={locked && open === "keyword"} onChange={(keyword) => onEdit(index, { keyword: keyword.slice(0, 28) })} />
                  <div className="sc-beat-tools">
                    {versions[index] && <span className="sc-versions" aria-label={`Version ${versions[index]!.at + 1} of ${versions[index]!.count}`}>
                      <button type="button" disabled={streaming || versions[index]!.at === 0} aria-label={`Previous version of beat ${index + 1}`} onClick={() => onVersion(index, versions[index]!.at - 1)}>‹</button>
                      <span>{versions[index]!.at + 1}/{versions[index]!.count}</span>
                      <button type="button" disabled={streaming || versions[index]!.at === versions[index]!.count - 1} aria-label={`Next version of beat ${index + 1}`} onClick={() => onVersion(index, versions[index]!.at + 1)}>›</button>
                    </span>}
                    <button type="button" className="sc-reimagine" disabled={streaming || structuralBusy} title="A new way to show this scene. The current version is kept." aria-label={`Reimagine beat ${index + 1}`} onClick={() => onReimagine(index)}>
                      {locked ? "Reimagining…" : "Reimagine"}
                    </button>
                    {onRemoveScene && (
                      <button
                        type="button"
                        className="sc-remove"
                        disabled={streaming || structuralBusy || minScenesReached}
                        title={minScenesReached ? "A storyboard needs at least one scene" : `Remove Scene ${index + 1} (${beat.keyword || `Beat ${index + 1}`})`}
                        aria-label={`Remove Scene ${index + 1}: ${beat.keyword || `Beat ${index + 1}`}`}
                        onClick={() => void handleRemoveScene(index)}
                      >
                        {removingAt === index ? "Removing…" : "Remove"}
                      </button>
                    )}
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
            </li>
            {renderBoundary(index + 1)}
          </Fragment>;
        })}
        {streaming && !scoped && Array.from({ length: beats.length === 0 ? 3 : 1 }, (_, index) => {
          const box = FRAME_BOX[aspect] ?? FRAME_BOX["16:9"];
          return <li key={`s${index}`} className="sc-beat sc-skeleton" aria-hidden="true" style={{ gridTemplateColumns: box.col, padding: "16px 6px", alignItems: "center" }}><div className="sc-text"><i /><i className="short" /><i className="long" /></div><div className="sc-frame sc-frame-wait" style={{ width: box.width, height: box.height, aspectRatio: RATIO[aspect], borderRadius: 12, justifySelf: "end" }} /></li>;
        })}
      </ol>
      {storyboard.state === "failed" && !streaming && <p className="sc-note">{storyboard.error ?? "Could not plan the storyboard."}</p>}
    </div>

    <div ref={dockRef} className="sc-dock">
      <div className="sc-bottom-blur" aria-hidden="true" />
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
    </div>
  </div>;
}
