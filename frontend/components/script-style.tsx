"use client";

import { useState, type ReactNode } from "react";
import type { BrandExtraction, BrandKit, SiteCapture } from "@videosaas/contracts";
import { aspects, beatCountRange, DEFAULT_LOOK, looks, DURATION_MAX, DURATION_MIN, durationPresets, OWN_SCRIPT_MAX, parseScriptBrief, PROBLEM_TEXT_MAX, voices, wordBudget, type Aspect, type AudioMode, type CaptionMode, type LookId, type MotionProfile, type Pace, type ScriptBrief } from "@videosaas/contracts";
import { BrandKitField } from "./brand-kit";
import { ThemePicker } from "./theme-picker";

export const defaultBrief: ScriptBrief = {
  scriptMode: "problem",
  text: "",
  durationSeconds: 30,
  aspect: "16:9",
  motionProfile: "smooth",
  pace: "balanced",
  audio: { mode: "voiceover", voice: "Kore" },
  captions: "key-phrases",
  template: null,
  theme: "neutral"
};

// Drawing style on top of the brand; colours and fonts always stay the brand kit's (contracts looks.ts).
const lookOptions: { id: LookId; label: string; hint: string }[] = looks.filter((look) => look.available).map((look) => ({ id: look.id, label: look.name, hint: look.description }));

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

export function ScriptStyleStep({ brief, update, site, readSite, screenshots, generating, elapsed, error, generate, back }: {
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
  back: () => void;
}) {
  const own = brief.scriptMode === "own";
  const max = own ? OWN_SCRIPT_MAX : PROBLEM_TEXT_MAX;
  const custom = !(durationPresets as readonly number[]).includes(brief.durationSeconds);
  const beats = beatCountRange(brief.durationSeconds, brief.pace);
  const budget = wordBudget(brief.durationSeconds, brief.pace);
  const parsed = parseScriptBrief(brief);
  const invalid = "error" in parsed ? parsed.error : null;
  const voiced = brief.audio.mode === "voiceover" || brief.audio.mode === "both";
  const music = brief.audio.mode === "music" || brief.audio.mode === "both";
  const [urlDraft, setUrlDraft] = useState(brief.productUrl ?? "");
  const host = (value: string) => value.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  const readHost = site.site ? host(site.site.url) : null;
  const siteInUse = Boolean(readHost && brief.productUrl && host(brief.productUrl) === readHost);

  return <div className="flow-page script-style">
    <div className="flow-title"><h1>Script &amp; style</h1><p>Describe the problem or paste your script, then choose how the film should look, move, and sound. Generating writes the script and a storyboard you can edit.</p></div>
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
          <header><b>Length and shape</b><span>About {beats.min}–{beats.max} beats · up to {budget} spoken words</span></header>
          <div className="ss-field"><b>Duration</b><div className="ss-chips">{durationPresets.map((seconds) => <button type="button" key={seconds} className={brief.durationSeconds === seconds ? "selected" : ""} onClick={() => update({ durationSeconds: seconds })}>{seconds}s</button>)}<label className={custom ? "ss-custom selected" : "ss-custom"}><span>Custom</span><input type="number" min={DURATION_MIN} max={DURATION_MAX} value={brief.durationSeconds} onChange={(event) => update({ durationSeconds: Math.round(Number(event.target.value) || DURATION_MIN) })} aria-label="Custom duration in seconds" /><span>s</span></label></div></div>
          <div className="ss-field"><b>Aspect ratio</b><div className="ss-chips">{aspects.map((aspect) => <button type="button" key={aspect} className={brief.aspect === aspect ? "selected" : ""} onClick={() => update({ aspect })}><i className={"ss-shape " + aspectShape[aspect]} />{aspect}</button>)}</div>{brief.aspect === "1:1" && <small className="ss-note">Square drafts render in the landscape frame until square layouts ship.</small>}</div>
        </section>

        <section className="ss-card">
          <header><b>Look</b><span>{brief.brandId ? "Your brand kit sets colours, fonts and logo" : "Pick a theme, or use a brand kit"}</span></header>
          <div className="ss-look">
            <div className="ss-field"><b>Brand kit</b><BrandKitField value={brief.brandId} found={siteInUse && !site.savedBrand ? site.brand : null} suggested={siteInUse ? site.savedBrand : null} source={siteInUse ? readHost : null} fromSite={Boolean(site.autoKit && site.savedBrand && brief.brandId === site.savedBrand.id)} onChange={(kit) => update({ brandId: kit?.id })} /><small className="ss-note">Saved kit, website import (paste a URL), or colours and a logo.</small></div>
            <div className={brief.brandId ? "ss-field muted" : "ss-field"}><b>Theme</b><ThemePicker value={brief.theme ?? "neutral"} disabled={Boolean(brief.brandId)} onChange={(theme) => update({ theme })} /></div>
            <div className="ss-field"><b>Drawing style</b><Segmented label="Drawing style" value={brief.look ?? DEFAULT_LOOK} options={lookOptions} onChange={(look) => update({ look })} /></div>
          </div>
        </section>

        <section className="ss-card">
          <header><b>Motion and pace</b><span>Sets eases, cut rate and how fast the voice reads</span></header>
          <div className="ss-field"><b>Motion style</b><Segmented label="Motion style" value={brief.motionProfile} options={motionOptions} onChange={(motionProfile) => update({ motionProfile })} /></div>
          <div className="ss-field"><b>Pace</b><Segmented label="Pace" value={brief.pace} options={paceOptions} onChange={(pace) => update({ pace })} /></div>
          <label className="ss-field ss-select"><b>Template <em>optional</em></b><select value={brief.template ?? ""} onChange={(event) => update({ template: event.target.value || null })}>{templateOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        </section>

        <section className="ss-card">
          <header><b>Sound and captions</b><span>{voiced ? "Narration drives the timing" : "Beats drive the timing"}</span></header>
          <div className="ss-field"><b>Audio</b><Segmented label="Audio" value={brief.audio.mode} options={audioOptions} onChange={(mode) => update({ audio: { ...brief.audio, mode } })} /></div>
          {(voiced || music) && <div className="ss-inline-fields">
            {voiced && <label><span>Voice</span><select value={brief.audio.voice ?? "Kore"} onChange={(event) => update({ audio: { ...brief.audio, voice: event.target.value } })}>{voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.label} · {voice.character}</option>)}</select></label>}
            {music && <label><span>Music mood <em>optional</em></span><input value={brief.audio.musicMood ?? ""} maxLength={60} onChange={(event) => update({ audio: { ...brief.audio, musicMood: event.target.value || undefined } })} placeholder="Warm, confident, light percussion" /></label>}
          </div>}
          <div className="ss-field"><b>Captions</b><Segmented label="Captions" value={brief.captions} options={captionOptions} onChange={(captions) => update({ captions })} /></div>
        </section>
      </div>
      {screenshots}
    </div>
    <div className="flow-footer">
      {generating ? <span className="ss-progress"><i />Writing your script… {elapsed}s <small>This takes 30–60 seconds. You can stay on this page.</small></span> : <span className={invalid ? "" : "ready"}><i />{error ?? invalid ?? "Ready. Generate the script and storyboard."}</span>}
      <div><button className="secondary-button" onClick={back} disabled={generating}>Back</button><button className="primary-button" disabled={generating || Boolean(invalid)} onClick={generate}>{generating ? "Writing…" : "Generate storyboard"}</button></div>
    </div>
  </div>;
}
