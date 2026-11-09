"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { BrandExtraction, BrandKit, SiteCapture } from "@videosaas/contracts";
import { ANIMATION_TIER_SPECS, aspects, beatCountRange, briefAspects, DEFAULT_ANIMATION_TIER, DEFAULT_LOOK, defaultScriptBrief, DURATION_MIN, durationPresets, formatDurationSeconds, NARRATOR, OWN_SCRIPT_MAX, parseScriptBrief, PREMIUM_LOCKED_COPY, PROBLEM_TEXT_MAX, resolveDurationMode, scriptSeconds, toggleBriefAspect, voiceLanguages, voices, wordBudget, type AnimationTier, type Aspect, type AudioMode, type CaptionMode, type MotionProfile, type Pace, type ScriptBrief } from "@videosaas/contracts";
import { BrandKitField } from "./brand-kit";
import { BrandedSelect } from "./branded-select";
import { ThemePicker } from "./theme-picker";
import { StylePicker } from "./style-picker";
import { VoicePickerModal } from "./voice-picker-modal";

/** How long the director usually takes (production, 2026-10-27: ~77 s with a repair round). Drives the estimate shown while writing. */
const TYPICAL_PLAN_SECONDS = 80;

export const defaultBrief: ScriptBrief = defaultScriptBrief;


const motionOptions: { id: MotionProfile; label: string; hint: string }[] = [
  { id: "snappy", label: "Snappy", hint: "Quick cuts, crisp stops" },
  { id: "smooth", label: "Smooth", hint: "Gliding, even moves" },
  { id: "springy", label: "Springy", hint: "Playful overshoot" }
];
const paceOptions: { id: Pace; label: string }[] = [{ id: "calm", label: "Calm" }, { id: "balanced", label: "Balanced" }, { id: "fast", label: "Fast" }];
const audioOptions: { id: AudioMode; label: string }[] = [{ id: "voiceover", label: "Voiceover" }, { id: "music", label: "Music" }, { id: "both", label: "Both" }, { id: "none", label: "None" }];
const captionOptions: { id: CaptionMode; label: string; hint: string }[] = [
  { id: "key-phrases", label: "Key phrases", hint: "The words that matter, on beat" },
  { id: "full", label: "Full captions", hint: "Every spoken word" },
  { id: "none", label: "Off", hint: "No captions" }
];
const templateOptions = [
  { id: "", label: "Let the director choose" },
  { id: "gm-feature-explainer", label: "Feature explainer · 30–120 s narrated demo" },
  { id: "gm-glossy-3d-reel", label: "Glossy 3D reel · 15–20 s brand sting" }
];
const aspectShape: Record<Aspect, string> = { "16:9": "landscape", "9:16": "portrait", "1:1": "square" };

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string; hint?: string }[]; onChange: (value: T) => void }) {
  return <div className="ss-segmented" role="radiogroup" aria-label={label}>{options.map((option) => <button type="button" role="radio" aria-checked={value === option.id} className={value === option.id ? "selected" : ""} key={option.id} onClick={() => onChange(option.id)}><b>{option.label}</b>{option.hint && <small>{option.hint}</small>}</button>)}</div>;
}

/** `savedBrand`: a kit already saved for the site; `autoKit`: it was selected automatically by the read. */
export type SiteState = { reading: boolean; site?: SiteCapture | null; brand?: BrandExtraction | null; savedBrand?: BrandKit | null; autoKit?: boolean; shots: number; warnings: string[]; error?: string | null };

export function ScriptStyleStep({ brief, update, site, readSite, screenshots, generating, elapsed, error, generate, cancel, back, hasPlan, confirmRegenerate, setConfirmRegenerate, continueToStoryboard, canUsePremium = false, onLockedPremiumClick }: {
  brief: ScriptBrief;
  update: (patch: Partial<ScriptBrief>) => void;
  /** Product site read: state, and the action that reads `url`. */
  site: SiteState;
  readSite: (url: string) => void;
  /** The project's screenshot panel (upload, order, remove). */
  screenshots: ReactNode;
  generating: boolean;
  elapsed: number;
  error: string | null;
  generate: () => void;
  /** Stops the script on the server. It keeps running if the page is left, so leaving is safe; this is the way to stop it. */
  cancel: () => void;
  back: () => void;
  /** A storyboard already exists for this project: it is kept, and regenerating the script replaces it only after a confirmation. */
  hasPlan: boolean;
  confirmRegenerate: boolean;
  setConfirmRegenerate: (value: boolean) => void;
  continueToStoryboard: () => void;
  canUsePremium?: boolean;
  onLockedPremiumClick?: () => void;
}) {
  const own = brief.scriptMode === "own";
  const max = own ? OWN_SCRIPT_MAX : PROBLEM_TEXT_MAX;
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
  const beats = beatCountRange(brief.durationSeconds, brief.pace);
  const budget = wordBudget(brief.durationSeconds, brief.pace);
  const parsed = parseScriptBrief(brief);
  const invalid = customError ?? ("error" in parsed ? parsed.error : null);
  const voiced = brief.audio.mode === "voiceover" || brief.audio.mode === "both";
  const music = brief.audio.mode === "music" || brief.audio.mode === "both";
  const [urlDraft, setUrlDraft] = useState(brief.productUrl ?? "");
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const voiceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const currentVoice = voices.find((v) => v.id === (brief.audio.voice ?? "Kore")) ?? voices[0]!;
  const host = (value: string) => value.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  const readHost = site.site ? host(site.site.url) : null;
  const siteInUse = Boolean(readHost && brief.productUrl && host(brief.productUrl) === readHost);

  // Generate sits under a long form, so the progress opens at the top and the page goes there. Scrolled after the panel
  // has painted: a scroll started in the same tick was cancelled by the re-render that saves the new project.
  const writingPanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!generating) return;
    const frame = window.requestAnimationFrame(() => writingPanel.current?.scrollIntoView({ block: "center", behavior: "smooth" }));
    return () => window.cancelAnimationFrame(frame);
  }, [generating]);
  return <div className="flow-page script-style">
    <div className="flow-title"><h1>Script &amp; style</h1><p>Describe the problem or paste your script, then choose how the film should look, move, and sound. We write the script first so you can correct it, then build the storyboard from it.</p></div>
    {generating && <div className="ss-writing" ref={writingPanel} role="status" aria-live="polite">
      <div><b>Writing your script and storyboard · {elapsed}s</b><span>{elapsed < TYPICAL_PLAN_SECONDS ? "Usually about 1–1½ minutes." : "Taking a little longer than usual."} You can leave this page; it keeps going.</span></div>
      {/* Time against the usual length, never full until the plan is back: an estimate, not a claim of exact progress. */}
      <i><em style={{ width: `${Math.min(92, Math.round((elapsed / TYPICAL_PLAN_SECONDS) * 85))}%` }} /></i>
      <button className="secondary-button" onClick={cancel}>Cancel</button>
    </div>}
    <div className="ss-layout">
      <div className="ss-main">
        <section className="ss-card">
          <header><b>Script</b><span>{own ? "Kept word for word. We only suggest edits." : "We write it from your brief."}</span></header>
          <div className="source-tabs"><button type="button" className={!own ? "selected" : ""} onClick={() => update({ scriptMode: "problem" })}>Describe the problem</button><button type="button" className={own ? "selected" : ""} onClick={() => update({ scriptMode: "own" })}>Paste my script</button></div>
          <textarea className="script-prompt" value={brief.text} maxLength={max} rows={own ? 8 : 4} onChange={(event) => update({ text: event.target.value })} aria-label={own ? "Your script" : "The problem your product solves"} placeholder={own ? "Paste your script. One sentence per idea works best." : "What does the product do, who is it for, and what should viewers do next?"} />
          <div className="ss-row-meta"><span>{own ? "Lines are kept verbatim; anything we would change comes back as a suggestion." : "Approved claims only. We don't invent numbers."}</span><small>{brief.text.length}/{max}</small></div>
          {!own && <div className="ss-site">
            <label htmlFor="product-url"><span>Product website <em>optional</em></span><small>We read it for accurate copy, your brand, and real screenshots of each section.</small></label>
            <form className="ss-site-row" noValidate onSubmit={(event) => { event.preventDefault(); if (urlDraft.trim()) readSite(urlDraft.trim()); }}>
              {/* type="text": people type "acme.com" without https://, which native URL validation rejects. */}
              <input id="product-url" type="text" inputMode="url" autoComplete="url" spellCheck={false} value={urlDraft} placeholder="yourproduct.com" disabled={site.reading} onChange={(event) => { setUrlDraft(event.target.value); if (!event.target.value.trim()) update({ productUrl: undefined }); }} />
              <button type="submit" className="secondary-button" disabled={site.reading || !urlDraft.trim()}>{site.reading ? "Reading…" : siteInUse ? "Read again" : "Read site"}</button>
            </form>
            {site.reading && <p className="ss-site-status busy"><i />Reading your site… this takes 20–30 seconds.</p>}
            {!site.reading && site.error && <p className="ss-site-status error">{site.error}</p>}
            {!site.reading && site.site && siteInUse && <p className="ss-site-status ready"><i />Read {readHost}: {site.site.facts.length} facts{site.shots ? `, ${site.shots} section ${site.shots === 1 ? "screenshot" : "screenshots"}` : ""}{site.savedBrand ? `, using your ${site.savedBrand.name} kit` : site.brand ? ", brand found" : ""}. The script will use claims from the site only.{site.site.mode === "html-only" ? " Screenshots aren't available here, so upload your own." : ""}</p>}
            {!site.reading && site.warnings.length > 0 && <ul className="ss-site-warnings">{site.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          </div>}
          <div className="ss-inline-fields">
            <label><span>Product name <em>optional</em></span><input value={brief.productName ?? ""} maxLength={40} onChange={(event) => update({ productName: event.target.value || undefined })} placeholder="Acme" /></label>
            <label><span>Audience <em>optional</em></span><input value={brief.audience ?? ""} maxLength={80} onChange={(event) => update({ audience: event.target.value || undefined })} placeholder="Shopify store owners" /></label>
          </div>
        </section>

        <section className="ss-card">
          <header>
            <b>Length and shape</b>
            <span>
              {durationMode === "script"
                ? brief.scriptBeats?.length
                  ? `Length follows your script · ~${formatDurationSeconds(scriptSeconds(brief.scriptBeats, brief.pace))} from ${brief.scriptBeats.length} beats`
                  : "Length follows your script"
                : brief.lockDuration
                  ? `About ${beats.min}–${beats.max} beats · up to ${budget} spoken words`
                  : `Target ${formatDurationSeconds(brief.durationSeconds)}: the script can run longer if the idea needs it, and tells you`}
            </span>
          </header>
          <div className="ss-field">
            <b>Duration</b>
            <div className="ss-chips" role="group" aria-label="Duration">
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
                onClick={() => {
                  customEditingRef.current = false;
                  setCustomDraft(String(brief.durationSeconds));
                  update({ durationMode: "script", lockDuration: undefined });
                }}
              >
                Let script decide
              </button>
              <label
                className={`ss-custom${durationMode === "custom" ? " selected" : ""}${customError ? " invalid" : ""}`}
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
            {customError ? (
              <small className="ss-note is-error" role="alert">{customError}</small>
            ) : durationMode === "script" ? (
              <small className="ss-note">
                {brief.scriptBeats?.length
                  ? `Estimated ~${formatDurationSeconds(scriptSeconds(brief.scriptBeats, brief.pace))} from your script. Tokens are quoted from the actual measured length.`
                  : "Length follows your script. Tokens are quoted from the actual measured length."}
              </small>
            ) : (
              <small className="ss-note">Target {formatDurationSeconds(brief.durationSeconds)} (minimum {DURATION_MIN}s).</small>
            )}
          </div>
          {durationMode !== "script" && (
            <label className="ss-lock">
              <input type="checkbox" checked={Boolean(brief.lockDuration)} onChange={(event) => update({ lockDuration: event.target.checked || undefined })} />
              <span><b>Fit exactly</b> Hold the script to {brief.durationSeconds}s, cutting what doesn&apos;t fit</span>
            </label>
          )}
          <div className="ss-field">
            <div className="ss-field-head">
              <b>Aspect ratio</b>
              <small className="ss-format-hint">Select one or more{selectedAspects.length > 1 ? ` · ${brief.aspect} primary preview` : ""}</small>
            </div>
            <div className="ss-chips" role="group" aria-label="Aspect ratio">
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
            {selectedAspects.length > 1 && !(brief.look ?? DEFAULT_LOOK).startsWith("illus-") && (
              <small className="ss-note">Illustrated styles export all selected formats natively; standard template styles render {brief.aspect} as the primary MP4 while allowing multi-ratio preview in Animation.</small>
            )}
            {selectedAspects.includes("1:1") && !(brief.look ?? DEFAULT_LOOK).startsWith("illus-") && (
              <small className="ss-note">Square drafts in standard template styles render in the landscape frame until square layouts ship.</small>
            )}
          </div>
        </section>

        <section className="ss-card">
          <header><b>Look</b><span>{brief.brandId ? "Your brand kit sets colours, fonts and logo" : "Pick a theme, or use a brand kit"}</span></header>
          <div className="ss-look">
            <div className="ss-field"><b>Brand kit</b><BrandKitField value={brief.brandId} found={siteInUse && !site.savedBrand ? site.brand : null} suggested={siteInUse ? site.savedBrand : null} source={siteInUse ? readHost : null} fromSite={Boolean(site.autoKit && site.savedBrand && brief.brandId === site.savedBrand.id)} onChange={(kit) => update({ brandId: kit?.id })} /><small className="ss-note">Saved kit, website import (paste a URL), or colours and a logo.</small></div>
            <div className={brief.brandId ? "ss-field muted" : "ss-field"}><b>Theme</b><ThemePicker value={brief.theme ?? "neutral"} disabled={Boolean(brief.brandId)} onChange={(theme) => update({ theme })} /></div>
            {/* Another style drops the template as the style reference: the director would otherwise remix a film in a different style. */}
            <StylePicker value={brief.look ?? DEFAULT_LOOK} family={brief.styleFamily} example={brief.styleExample} onChange={(look, styleFamily, example) => update({ look, styleFamily, ...(example ? { styleExample: example } : styleFamily === brief.styleFamily && look === (brief.look ?? DEFAULT_LOOK) ? {} : { styleExample: undefined }) })} />
            <label className="ss-field"><b>Describe the look in your own words <em>optional</em></b><input value={brief.styleNote ?? ""} maxLength={200} onChange={(event) => update({ styleNote: event.target.value || undefined })} placeholder="soft watercolour, dreamy · bold and punchy · calm and premium" aria-label="Describe the look in your own words" /></label>
          </div>
        </section>

      </div>
      <aside className="ss-side">
        {screenshots}
        <section className="ss-card">
          <header><b>Motion and pace</b><span>Sets eases, cut rate and how fast the voice reads</span></header>
          <div className="ss-field"><b>Motion style</b><Segmented label="Motion style" value={brief.motionProfile} options={motionOptions} onChange={(motionProfile) => update({ motionProfile })} /></div>
          <div className="ss-field"><b>Pace</b><Segmented label="Pace" value={brief.pace} options={paceOptions} onChange={(pace) => update({ pace })} /></div>
          <div className="ss-field">
            <b>Animation quality</b>
            <div className="ss-chips" role="radiogroup" aria-label="Animation quality">
              {(["standard", "premium"] as AnimationTier[]).map((tierId) => {
                const activeTier: AnimationTier =
                  (brief.animationTier ?? DEFAULT_ANIMATION_TIER) === "premium" && canUsePremium ? "premium" : "standard";
                const isSelected = activeTier === tierId;
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
                      update({ animationTier: tierId });
                    }}
                  >
                    {spec.label}{locked ? " 🔒" : ""}
                  </button>
                );
              })}
            </div>
            <small className="ss-note">
              {!canUsePremium
                ? PREMIUM_LOCKED_COPY
                : (brief.animationTier ?? DEFAULT_ANIMATION_TIER) === "premium"
                  ? ANIMATION_TIER_SPECS.premium.summary
                  : ANIMATION_TIER_SPECS.standard.summary}
            </small>
          </div>
          <div className="ss-field ss-select">
            <b>Template <em>optional</em></b>
            <BrandedSelect
              size="default"
              ariaLabel="Template"
              value={brief.template ?? ""}
              options={templateOptions}
              onChange={(val) => update({ template: val || null })}
            />
          </div>
        </section>

        <section className="ss-card">
          <header><b>Sound and captions</b><span>{voiced ? "Narration drives the timing" : "Beats drive the timing"}</span></header>
          <div className="ss-field"><b>Audio</b><Segmented label="Audio" value={brief.audio.mode} options={audioOptions} onChange={(mode) => update({ audio: { ...brief.audio, mode } })} /></div>
          {voiced && (
            <div className="ss-field ss-select">
              <b>Voice language</b>
              <BrandedSelect
                size="default"
                ariaLabel="Voice language"
                value={brief.audio.language ?? "en"}
                options={voiceLanguages.map((language) => ({ id: language.id, label: language.label }))}
                onChange={(val) => update({ audio: { ...brief.audio, language: val === "en" ? undefined : val } })}
              />
            </div>
          )}
          {(voiced || music) && <div className="ss-inline-fields">
            {voiced && (
              <div className="ss-field">
                <span>Voice ({voices.length} voices)</span>
                <button
                  ref={voiceTriggerRef}
                  type="button"
                  className="gm-voice-trigger gm-voice-trigger-default"
                  aria-haspopup="dialog"
                  aria-label="Voice"
                  onClick={() => setVoiceModalOpen(true)}
                >
                  <span className="gm-voice-trigger-copy">
                    <b>{currentVoice.label}</b>
                    <small>· {currentVoice.character}</small>
                  </span>
                  <span className="gm-voice-trigger-badge">Browse {voices.length} ▾</span>
                </button>
              </div>
            )}
            {music && <label><span>Music mood <em>optional</em></span><input value={brief.audio.musicMood ?? ""} maxLength={60} onChange={(event) => update({ audio: { ...brief.audio, musicMood: event.target.value || undefined } })} placeholder="Warm, confident, light percussion" /></label>}
          </div>}
          <div className="ss-field"><b>Captions</b><Segmented label="Captions" value={brief.captions} options={captionOptions} onChange={(captions) => update({ captions })} /></div>
        </section>
      </aside>
    </div>
    <VoicePickerModal
      open={voiceModalOpen}
      targetSpeaker={NARRATOR}
      castMode="narrator"
      cast={[]}
      narratorVoice={brief.audio.voice ?? "Kore"}
      language={brief.audio.language ?? "en"}
      onSelectVoice={(_speaker, voiceId) => update({ audio: { ...brief.audio, voice: voiceId } })}
      onClose={() => setVoiceModalOpen(false)}
      returnFocusEl={voiceTriggerRef.current}
    />
    <div className="flow-footer">
      {generating ? <span className="ss-progress"><i />Writing your script… {elapsed}s <small>It keeps going if you leave this page, and your storyboard will be here when you come back.</small></span> : <span className={invalid ? "" : "ready"}><i />{error ?? invalid ?? (confirmRegenerate ? "Regenerating writes a new script and storyboard from this brief and replaces the one you have, including your edits." : hasPlan ? "Your storyboard is saved. Continue to it, or write the script again from this brief." : "Ready. Generate the script and storyboard.")}</span>}
      <div>
        <button className="secondary-button" onClick={back}>Back</button>
        {generating ? <button className="secondary-button" onClick={cancel}>Cancel</button> : null}
        {generating ? <button className="primary-button" disabled>Writing…</button>
          : !hasPlan ? <button className="primary-button" disabled={Boolean(invalid)} onClick={generate}>Generate storyboard</button>
          : confirmRegenerate ? <>
            <button className="secondary-button" onClick={() => setConfirmRegenerate(false)}>Keep my storyboard</button>
            <button className="primary-button" disabled={Boolean(invalid)} onClick={() => { setConfirmRegenerate(false); generate(); }}>Replace it</button>
          </> : <>
            <button className="secondary-button" disabled={Boolean(invalid)} onClick={() => setConfirmRegenerate(true)}>Regenerate script</button>
            <button className="primary-button" onClick={continueToStoryboard}>Continue to storyboard</button>
          </>}
      </div>
    </div>
  </div>;
}
