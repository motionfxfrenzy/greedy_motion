"use client";

import { defaultVoice, findTemplate, voices, type RenderRequest } from "@videosaas/contracts";
import { BrandKitField } from "./brand-kit";
import { TemplatePicker } from "./template-picker";
import { ThemePicker } from "./theme-picker";

type PromptComposerProps = {
  request: RenderRequest;
  disabled: boolean;
  onChange: (request: RenderRequest) => void;
  onSubmit: () => void;
};

const examples = [
  "Show founders how fast they can turn a messy product update into a customer-ready launch video.",
  "Create a concise demo for an analytics product that helps ecommerce teams see profit after fees."
];

export function PromptComposer({ request, disabled, onChange, onSubmit }: PromptComposerProps) {
  const update = <Key extends keyof RenderRequest>(key: Key, value: RenderRequest[Key]) => {
    onChange({ ...request, [key]: value });
  };

  return (
    <section className="panel composer" aria-labelledby="composer-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">01 · Creative brief</span>
          <h2 id="composer-title">Describe the story.</h2>
        </div>
        <span className="keyboard-tip">⌘ ↵ to render</span>
      </div>

      <TemplatePicker
        value={request.template}
        disabled={disabled}
        onChoose={(template) => onChange({ ...request, template: template.id, theme: template.defaultTheme, prompt: template.examplePrompt })}
      />

      <BrandKitField
        value={request.brandId}
        disabled={disabled}
        onChange={(brand) => onChange({ ...request, brandId: brand?.id })}
      />

      <label className="field-label" htmlFor="prompt">Describe your product</label>
      <textarea
        id="prompt"
        value={request.prompt}
        maxLength={600}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !disabled) onSubmit();
        }}
        onChange={(event) => update("prompt", event.target.value)}
        placeholder="What is the product, who is it for, and what should viewers remember?"
      />
      <div className="input-footnote">
        <span>{request.prompt.length}/600</span>
        <button className="text-button" type="button" onClick={() => update("prompt", findTemplate(request.template)?.examplePrompt ?? examples[0])}>Use the example</button>
      </div>

      <div className="control-grid">
        <label>
          <span className="field-label">Format</span>
          <select value={request.format} onChange={(event) => update("format", event.target.value as RenderRequest["format"])}>
            <option value="landscape">Landscape · 16:9</option>
            <option value="portrait">Portrait · 9:16</option>
          </select>
        </label>
        <label>
          <span className="field-label">Motion system</span>
          <select value={request.style} onChange={(event) => update("style", event.target.value as RenderRequest["style"])}>
            <option value="clean">Clean · Calm focus</option>
            <option value="kinetic">Kinetic · Fast cuts</option>
            <option value="editorial">Editorial · Textured</option>
          </select>
        </label>
      </div>

      {request.brandId ? (
        <p className="brand-theme-note"><strong>Theme:</strong> your brand kit's colors and fonts are used. Remove the brand kit to choose a gallery theme.</p>
      ) : (
        <ThemePicker value={request.theme} disabled={disabled} onChange={(theme) => update("theme", theme)} />
      )}

      <fieldset className="sound-field" disabled={disabled}>
        <legend className="field-label">Sound</legend>
        <label className="sound-toggle">
          <input type="checkbox" checked={request.audio?.music ?? false} onChange={(event) => onChange({ ...request, audio: { music: event.target.checked, voiceover: request.audio?.voiceover ?? false, voice: request.audio?.voice ?? defaultVoice } })} />
          <span><strong>Background music</strong><small>An original track generated for this video (Google Lyria)</small></span>
        </label>
        <label className="sound-toggle">
          <input type="checkbox" checked={request.audio?.voiceover ?? false} onChange={(event) => onChange({ ...request, audio: { music: request.audio?.music ?? false, voiceover: event.target.checked, voice: request.audio?.voice ?? defaultVoice } })} />
          <span><strong>Voiceover</strong><small>Claude writes a short script; Gemini reads it</small></span>
        </label>
        {request.audio?.voiceover ? (
          <label className="sound-voice">
            <span className="field-label">Voice</span>
            <select value={request.audio.voice ?? defaultVoice} onChange={(event) => onChange({ ...request, audio: { music: request.audio?.music ?? false, voiceover: true, voice: event.target.value } })}>
              {voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.label} · {voice.character}</option>)}
            </select>
          </label>
        ) : null}
      </fieldset>

      <button className="render-button" type="button" disabled={disabled || request.prompt.trim().length < 12} onClick={onSubmit}>
        <span className="render-icon">✦</span>
        {disabled ? "Preparing render…" : "Make local preview"}
        <span className="button-arrow">↗</span>
      </button>
      <p className="local-note">Local prototype · The job lifecycle is real; custom prompt-to-MP4 rendering plugs in next.</p>
    </section>
  );
}
