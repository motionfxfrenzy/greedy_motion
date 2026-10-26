"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { brandLogoVariants, deriveBrandTheme, type BrandExtraction, type BrandKit, type BrandLogoVariant } from "@videosaas/contracts";
import { ColorField, FontField, draftFrom, emptyDraft, inputFrom, previewFont, type Draft } from "./brand-kit";
import { brandLogoUrl, extractBrandFromUrl, saveBrandKit, stagedLogoUrl, updateBrandKit, uploadBrandAsset } from "../lib/api";
import { useMediaToken } from "../lib/use-media-token";

/** A kit as the editor's draft: everything the kit has, and an empty field for anything it does not. */
function draftOf(kit: BrandKit): Draft {
  return {
    ...emptyDraft,
    name: kit.name, url: kit.url ?? "", description: kit.description ?? "",
    primary: kit.colors.primary, accent: kit.colors.accent ?? "", background: kit.colors.background ?? "", text: kit.colors.text ?? "",
    mode: kit.mode ?? "auto", heading: kit.fonts.heading, body: kit.fonts.body
  };
}

const variantInfo: Record<BrandLogoVariant, { label: string; hint: string }> = {
  mark: { label: "Logo mark", hint: "The symbol alone, for corners and small spaces." },
  wordmark: { label: "Wordmark", hint: "The name in its lettering, no symbol." },
  silhouette: { label: "Silhouette", hint: "A one-colour shape, for busy or tinted backgrounds." }
};

/** Opens a saved kit (or a new one, when `kit` is null) for editing: logo, name, website, language, colours, fonts. */
export function BrandKitDialog({ kit, onClose, onSaved }: { kit: BrandKit | null; onClose: () => void; onSaved: (kit: BrandKit) => void }) {
  useMediaToken();
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Draft>(kit ? draftOf(kit) : emptyDraft);
  const [logoRemoved, setLogoRemoved] = useState(false);
  // Extra logo versions: newly uploaded (staged) ones, and saved ones the person removed.
  const [variantUploads, setVariantUploads] = useState<Partial<Record<BrandLogoVariant, string>>>({});
  const [variantsRemoved, setVariantsRemoved] = useState<BrandLogoVariant[]>([]);
  const [variantBusy, setVariantBusy] = useState<BrandLogoVariant | null>(null);
  const [extraction, setExtraction] = useState<BrandExtraction | null>(null);
  const [importUrl, setImportUrl] = useState(kit?.url ?? "");
  const [busy, setBusy] = useState<"" | "import" | "logo" | "save">("");
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, File>>({});
  useEffect(() => { const node = dialog.current; if (node && !node.open) node.showModal(); }, []);

  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const input = useMemo(() => inputFrom(draft), [draft]);
  const derived = useMemo(() => (input ? deriveBrandTheme(input) : null), [input]);
  useEffect(() => {
    previewFont(draft.heading, draft.heading.assetId ? files[draft.heading.assetId] : undefined);
    previewFont(draft.body, draft.body.assetId ? files[draft.body.assetId] : undefined);
  }, [draft.heading, draft.body, files]);

  // The logo shown: a newly uploaded one, else the saved one (unless removed).
  const savedLogo = kit?.hasLogo && !logoRemoved ? brandLogoUrl(kit.id) : null;
  const logoSrc = draft.logoAssetId ? stagedLogoUrl(draft.logoAssetId) : savedLogo;

  const runImport = async () => {
    setBusy("import");
    setError(null);
    try {
      const result = await extractBrandFromUrl(importUrl);
      setExtraction(result);
      const fetched = draftFrom(result);
      // Fetched values fill the form; anything the site did not give keeps what is there.
      setDraft((current) => ({
        ...current,
        name: fetched.name || current.name, url: fetched.url || current.url, description: fetched.description || current.description,
        primary: result.colors.primary || current.primary, accent: fetched.accent || current.accent, background: fetched.background || current.background, text: fetched.text || current.text,
        heading: result.fonts.heading ?? current.heading, body: result.fonts.body ?? current.body,
        ...(fetched.logoAssetId ? { logoAssetId: fetched.logoAssetId, logoTone: fetched.logoTone } : {})
      }));
      if (fetched.logoAssetId) setLogoRemoved(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read that website.");
    } finally {
      setBusy("");
    }
  };
  const uploadLogo = async (file: File) => {
    setBusy("logo");
    setError(null);
    try {
      const asset = await uploadBrandAsset("logo", file);
      update({ logoAssetId: asset.assetId, logoTone: asset.tone });
      setLogoRemoved(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not upload that logo.");
    } finally {
      setBusy("");
    }
  };
  const uploadFont = (role: "heading" | "body") => async (file: File) => {
    setError(null);
    try {
      const asset = await uploadBrandAsset("font", file);
      setFiles((current) => ({ ...current, [asset.assetId]: file }));
      update({ [role]: { source: "upload", family: file.name.replace(/\.[^.]+$/, "").slice(0, 40), assetId: asset.assetId } } as Partial<Draft>);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not upload that font.");
    }
  };
  const variantSrc = (variant: BrandLogoVariant) => variantUploads[variant] ? stagedLogoUrl(variantUploads[variant]!) : kit?.logoVariants?.includes(variant) && !variantsRemoved.includes(variant) ? brandLogoUrl(kit.id, variant) : null;
  const uploadVariant = async (variant: BrandLogoVariant, file: File) => {
    setVariantBusy(variant);
    setError(null);
    try {
      const asset = await uploadBrandAsset("logo", file);
      setVariantUploads((current) => ({ ...current, [variant]: asset.assetId }));
      setVariantsRemoved((current) => current.filter((name) => name !== variant));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not upload that logo.");
    } finally {
      setVariantBusy(null);
    }
  };
  const removeVariant = (variant: BrandLogoVariant) => {
    setVariantUploads((current) => { const next = { ...current }; delete next[variant]; return next; });
    if (kit?.logoVariants?.includes(variant)) setVariantsRemoved((current) => [...current, variant]);
  };
  const removeLogo = () => { update({ logoAssetId: undefined, logoTone: undefined }); setLogoRemoved(true); };
  const save = async () => {
    if (!input) return;
    if (!draft.name.trim()) { setError("Give the brand a name."); return; }
    setBusy("save");
    setError(null);
    try {
      const body = { ...input, name: draft.name.trim(), ...(Object.keys(variantUploads).length ? { variantAssets: variantUploads } : {}) };
      const saved = kit ? await updateBrandKit(kit.id, body, { removeLogo: logoRemoved && !draft.logoAssetId, removeVariants: variantsRemoved }) : await saveBrandKit(body);
      onSaved(saved);
      dialog.current?.close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the brand kit.");
    } finally {
      setBusy("");
    }
  };

  const t = derived?.theme.tokens;
  const previewStyle = t ? ({ "--p-bg": t.bg, "--p-fg": t.fg, "--p-brand": t.brand, "--p-accent": t.accent, "--p-surface": t.surface, "--p-border": t.border, "--p-muted": t.muted, "--p-display": t.fontDisplay, "--p-body": t.fontBody } as React.CSSProperties) : undefined;
  return <dialog ref={dialog} className="theme-dialog" aria-labelledby="kit-dialog-title" onClose={onClose} onClick={(event) => { if (event.target === dialog.current) dialog.current?.close(); }}>
    <div className="theme-dialog-inner">
      <header className="theme-dialog-header">
        <div>
          <span className="eyebrow">Brand kit</span>
          <h2 id="kit-dialog-title">{kit ? kit.name : "New brand kit"}</h2>
          <p>{kit ? "Everything fetched for this kit is filled in. Change anything, add what is missing, then save." : "Import from your website, upload your logo and fonts, or set everything by hand."}</p>
        </div>
        <button type="button" className="theme-close" onClick={() => dialog.current?.close()} aria-label="Close brand kit">✕</button>
      </header>
      <div className="brand-editor">
        <div className="brand-form">
          <section className="brand-import" aria-labelledby="kit-import-title">
            <h3 id="kit-import-title">{kit ? "Fetch again from website" : "Import from website"}</h3>
            <form className="brand-import-row" noValidate onSubmit={(event) => { event.preventDefault(); if (importUrl.trim()) void runImport(); }}>
              <input type="text" inputMode="url" autoComplete="url" spellCheck={false} aria-label="Product website" placeholder="yourproduct.com" value={importUrl} onChange={(event) => setImportUrl(event.target.value)} />
              <button type="submit" className="template-use" disabled={busy === "import" || !importUrl.trim()}>{busy === "import" ? "Reading site…" : "Fetch brand"}</button>
            </form>
            {extraction?.notes.length ? <ul className="brand-notes">{extraction.notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
          </section>

          <div className="brand-logo-field">
            <span className="field-label">Logo</span>
            <div className="brand-logo-row">
              <span className="brand-logo-box large">{logoSrc ? <img src={logoSrc} alt="Logo preview" /> : <span aria-hidden="true">No logo</span>}</span>
              <label className="brand-file">
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadLogo(file); event.target.value = ""; }} />
                <span>{busy === "logo" ? "Uploading…" : logoSrc ? "Replace logo" : "Upload logo"}</span>
              </label>
              {logoSrc ? <button type="button" className="text-button" onClick={removeLogo}>Remove</button> : null}
            </div>
            <small className="brand-hint">{extraction?.logo ? `Found: ${extraction.logo.source}` : "PNG, JPEG, WebP, SVG or GIF. The original is kept; a version that shows on a light background works best."}</small>
          </div>

          <div className="brand-variants">
            <span className="field-label">More logo versions <em>optional</em></span>
            <div className="brand-variant-grid">
              {brandLogoVariants.map((variant) => {
                const src = variantSrc(variant);
                return <div className="brand-variant" key={variant}>
                  <span className="brand-logo-box">{src ? <img src={src} alt={variantInfo[variant].label} /> : <span aria-hidden="true">—</span>}</span>
                  <span className="brand-variant-meta"><b>{variantInfo[variant].label}</b><small>{variantInfo[variant].hint}</small>
                    <span className="brand-variant-actions">
                      <label className="brand-file"><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadVariant(variant, file); event.target.value = ""; }} /><span>{variantBusy === variant ? "Uploading…" : src ? "Replace" : "Upload"}</span></label>
                      {src ? <button type="button" className="text-button" onClick={() => removeVariant(variant)}>Remove</button> : null}
                    </span>
                  </span>
                </div>;
              })}
            </div>
          </div>

          <div className="brand-grid">
            <label><span className="field-label">Brand name</span><input type="text" value={draft.name} maxLength={28} onChange={(event) => update({ name: event.target.value })} placeholder="Acme" /></label>
            <label><span className="field-label">Website</span><input type="text" value={draft.url} maxLength={200} onChange={(event) => update({ url: event.target.value })} placeholder="acme.com" /></label>
          </div>
          <label><span className="field-label">Approved language <em>optional</em></span><textarea rows={3} maxLength={300} value={draft.description} onChange={(event) => update({ description: event.target.value })} placeholder="How the brand describes itself: the claims and tone videos may use." className="brand-textarea" /></label>

          <div className="brand-grid">
            <ColorField label="Primary" value={draft.primary} onChange={(v) => update({ primary: v })} candidates={extraction?.colors.candidates ?? []} />
            <ColorField label="Accent" optional value={draft.accent} onChange={(v) => update({ accent: v })} candidates={extraction?.colors.candidates ?? []} />
            <ColorField label="Background" optional value={draft.background} onChange={(v) => update({ background: v })} candidates={[]} />
            <ColorField label="Text" optional value={draft.text} onChange={(v) => update({ text: v })} candidates={[]} />
          </div>

          <label className="brand-mode"><span className="field-label">Look</span>
            <select value={draft.mode} onChange={(event) => update({ mode: event.target.value as Draft["mode"] })}>
              <option value="auto">Automatic</option><option value="light">Light</option><option value="dark">Dark</option>
            </select>
          </label>

          <div className="brand-grid">
            <FontField label="Heading font" value={draft.heading} onChange={(font) => update({ heading: font })} candidates={extraction?.fonts.candidates ?? []} onFile={uploadFont("heading")} />
            <FontField label="Body font" value={draft.body} onChange={(font) => update({ body: font })} candidates={[]} onFile={uploadFont("body")} />
          </div>
          {extraction?.fonts.selfHosted.length ? <small className="brand-hint">Self-hosted fonts are never downloaded from the site: upload your licensed files or choose a Google font.</small> : null}
        </div>

        <aside className="brand-preview" aria-label="Brand preview">
          <span className="field-label">Preview</span>
          <div className="brand-preview-frame" style={previewStyle}>
            {logoSrc ? <img className="brand-preview-logo" src={logoSrc} alt="" /> : <span className="brand-preview-eyebrow">{draft.name || "Your brand"}</span>}
            <strong className="brand-preview-title">Ship the update and the video the same day.</strong>
            <span className="brand-preview-body">Every scene uses your colors and fonts.</span>
            <span className="brand-preview-card"><span className="brand-preview-dot">01</span> Feature card</span>
            <span className="brand-preview-cta">Start free</span>
            <span className="brand-preview-bar" />
          </div>
          {derived?.adjustments.length ? <ul className="brand-notes">{derived.adjustments.map((note) => <li key={note}>{note}</li>)}</ul> : <small className="brand-hint">All text colors meet WCAG AA contrast.</small>}
        </aside>

        {error ? <p className="error-message" role="alert">{error}</p> : null}
        <div className="brand-actions">
          <button type="button" className="text-button" onClick={() => dialog.current?.close()}>Cancel</button>
          <button type="button" className="brand-save" onClick={() => void save()} disabled={!input || busy === "save"}>{busy === "save" ? "Saving…" : kit ? "Save changes" : "Save brand kit"}</button>
        </div>
      </div>
    </div>
  </dialog>;
}
