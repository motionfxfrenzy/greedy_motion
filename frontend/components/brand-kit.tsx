"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { bundledFonts, deriveBrandTheme, parseColor, uploadedFamily, type BrandExtraction, type BrandFont, type BrandKit, type BrandKitInput } from "@videosaas/contracts";
import { brandLogoUrl, extractBrandFromUrl, listBrandKits, saveBrandKit, stagedLogoUrl, uploadBrandAsset } from "../lib/api";

type BrandKitFieldProps = {
  value?: string;
  disabled?: boolean;
  onChange: (brand: BrandKit | null) => void;
  /** A brand read from the product's website elsewhere (not saved): shown filled in, saved on one click. */
  found?: BrandExtraction | null;
  /** A kit already saved for the same site, offered when the user picked a different one. */
  suggested?: BrandKit | null;
  /** Host the site brand came from, e.g. "linear.app". */
  source?: string | null;
  /** True when `value` was chosen automatically from the site (shows "From <source> · Change"). */
  fromSite?: boolean;
};

type Draft = {
  name: string;
  url: string;
  description: string;
  primary: string;
  accent: string;
  background: string;
  text: string;
  mode: "auto" | "light" | "dark";
  heading: BrandFont;
  body: BrandFont;
  logoAssetId?: string;
  logoTone?: "dark" | "light" | "color";
};

const emptyDraft: Draft = {
  name: "", url: "", description: "", primary: "#4f46e5", accent: "", background: "", text: "", mode: "auto",
  heading: { source: "bundled", family: "Inter" }, body: { source: "bundled", family: "Inter" }
};

/** Extraction → editor draft. */
function draftFrom(result: BrandExtraction): Draft {
  return {
    ...emptyDraft,
    name: result.name ?? "",
    url: result.url,
    description: result.description ?? "",
    primary: result.colors.primary || emptyDraft.primary,
    accent: result.colors.accent ?? "",
    background: result.colors.background ?? "",
    text: result.colors.text ?? "",
    heading: result.fonts.heading ?? emptyDraft.heading,
    body: result.fonts.body ?? emptyDraft.body,
    logoAssetId: result.logo?.assetId,
    logoTone: result.logo?.tone
  };
}

/** Editor draft → the kit the API saves, or null while the primary colour is invalid. */
function inputFrom(draft: Draft): BrandKitInput | null {
  const primary = parseColor(draft.primary);
  if (!primary) return null;
  return {
    name: draft.name.trim() || "Your brand",
    ...(draft.url.trim() ? { url: draft.url.trim() } : {}),
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    colors: { primary, accent: parseColor(draft.accent), background: parseColor(draft.background), text: parseColor(draft.text) },
    fonts: { heading: draft.heading, body: draft.body },
    ...(draft.logoAssetId ? { logoAssetId: draft.logoAssetId } : {}),
    ...(draft.mode !== "auto" ? { mode: draft.mode } : {})
  };
}

/** Loads a font into the page for the live preview: Google/bundled via the CSS API, uploads from the local file. */
const loadedFonts = new Set<string>();
function previewFont(font: BrandFont, file?: File) {
  if (typeof document === "undefined") return;
  if (font.source === "upload") {
    if (!file || loadedFonts.has(uploadedFamily(font))) return;
    loadedFonts.add(uploadedFamily(font));
    void file.arrayBuffer().then((buffer) => new FontFace(uploadedFamily(font), buffer).load()).then((face) => document.fonts.add(face)).catch(() => {});
    return;
  }
  if (!font.family || loadedFonts.has(font.family)) return;
  loadedFonts.add(font.family);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.family).replace(/%20/g, "+")}:wght@400;700&display=swap`;
  document.head.appendChild(link);
}

function ColorField({ label, value, onChange, optional, candidates }: { label: string; value: string; onChange: (v: string) => void; optional?: boolean; candidates: string[] }) {
  const parsed = parseColor(value);
  return (
    <div className="brand-color">
      <span className="field-label">{label}{optional ? <em> optional</em> : null}</span>
      <div className="brand-color-row">
        <input type="color" aria-label={`${label} color picker`} value={parsed ?? "#ffffff"} onChange={(event) => onChange(event.target.value)} />
        <input type="text" aria-label={`${label} hex value`} value={value} placeholder={optional ? "Auto" : "#4f46e5"} maxLength={9} onChange={(event) => onChange(event.target.value)} />
        {optional && value ? <button type="button" className="text-button" onClick={() => onChange("")}>Auto</button> : null}
      </div>
      {candidates.length ? (
        <div className="brand-chips" aria-label={`Colors found for ${label}`}>
          {candidates.map((color) => <button key={color} type="button" title={color} aria-label={`Use ${color}`} style={{ background: color }} onClick={() => onChange(color)} />)}
        </div>
      ) : null}
      {value && !parsed ? <small className="brand-error">Use a hex color like #4f46e5.</small> : null}
    </div>
  );
}

function FontField({ label, value, onChange, candidates, onFile }: { label: string; value: BrandFont; onChange: (font: BrandFont) => void; candidates: string[]; onFile: (file: File) => Promise<void> }) {
  const [uploading, setUploading] = useState(false);
  return (
    <div className="brand-font">
      <span className="field-label">{label}</span>
      <div className="brand-font-row">
        <select aria-label={`${label} source`} value={value.source} onChange={(event) => {
          const source = event.target.value as BrandFont["source"];
          onChange(source === "bundled" ? { source, family: "Inter" } : source === "google" ? { source, family: "" } : { source, family: value.family || label });
        }}>
          <option value="bundled">Built-in font</option>
          <option value="google">Google font</option>
          <option value="upload">Upload font file</option>
        </select>
        {value.source === "bundled" ? (
          <select aria-label={`${label} font`} value={value.family} onChange={(event) => onChange({ source: "bundled", family: event.target.value })}>
            {bundledFonts.map((family) => <option key={family} value={family}>{family}</option>)}
          </select>
        ) : value.source === "google" ? (
          <input type="text" aria-label={`${label} Google font name`} placeholder="e.g. Manrope" value={value.family} maxLength={40} onChange={(event) => onChange({ source: "google", family: event.target.value })} />
        ) : (
          <label className="brand-file">
            <input type="file" accept=".woff2,.woff,.ttf,.otf" onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setUploading(true);
              try { await onFile(file); } finally { setUploading(false); }
            }} />
            <span>{uploading ? "Uploading…" : value.assetId ? "Replace file" : "Choose WOFF2, WOFF, TTF, or OTF"}</span>
          </label>
        )}
      </div>
      {candidates.length ? <small className="brand-hint">Found on the site: {candidates.join(", ")}</small> : null}
    </div>
  );
}

export function BrandKitField({ value, disabled, onChange, found, suggested, source, fromSite }: BrandKitFieldProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [view, setView] = useState<"list" | "edit">("list");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [extraction, setExtraction] = useState<BrandExtraction | null>(null);
  const [importUrl, setImportUrl] = useState("");
  const [busy, setBusy] = useState<"" | "import" | "logo" | "save">("");
  const [error, setError] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, File>>({});
  const selected = kits.find((kit) => kit.id === value);

  useEffect(() => { listBrandKits().then(setKits).catch(() => setKits([])); }, []);

  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const open = () => {
    setError(null);
    setView(kits.length ? "list" : "edit");
    dialogRef.current?.showModal();
  };
  const close = () => dialogRef.current?.close();

  const input: BrandKitInput | null = useMemo(() => inputFrom(draft), [draft]);
  const derived = useMemo(() => (input ? deriveBrandTheme(input) : null), [input]);

  useEffect(() => {
    previewFont(draft.heading, draft.heading.assetId ? uploadedFiles[draft.heading.assetId] : undefined);
    previewFont(draft.body, draft.body.assetId ? uploadedFiles[draft.body.assetId] : undefined);
  }, [draft.heading, draft.body, uploadedFiles]);

  /** Fills the editor from an extraction; nothing is saved until the user presses Save. */
  const applyExtraction = (result: BrandExtraction) => {
    setExtraction(result);
    setDraft(draftFrom(result));
  };
  // A kit saved for this site may be newer than the list loaded on mount.
  useEffect(() => {
    if (suggested && !kits.some((kit) => kit.id === suggested.id)) setKits((current) => [suggested, ...current]);
  }, [kits, suggested]);
  /** Saves the site brand as found, in one click. Anything the API rejects opens the prefilled editor. */
  const saveFound = async () => {
    if (!found) return;
    const foundDraft = draftFrom(found);
    const foundInput = inputFrom(foundDraft);
    if (!foundInput || !foundDraft.name.trim()) return reviewFound();
    setBusy("save");
    setError(null);
    try {
      const kit = await saveBrandKit({ ...foundInput, name: foundDraft.name.trim() });
      setKits((current) => [kit, ...current]);
      onChange(kit);
    } catch (caught) {
      reviewFound();
      setError(caught instanceof Error ? caught.message : "Could not save the brand kit.");
    } finally {
      setBusy("");
    }
  };
  const reviewFound = () => {
    if (!found) return;
    applyExtraction(found);
    setImportUrl(found.url);
    setError(null);
    setView("edit");
    dialogRef.current?.showModal();
  };
  const runImport = async () => {
    setBusy("import");
    setError(null);
    try {
      applyExtraction(await extractBrandFromUrl(importUrl));
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
      setUploadedFiles((files) => ({ ...files, [asset.assetId]: file }));
      update({ [role]: { source: "upload", family: file.name.replace(/\.[^.]+$/, "").slice(0, 40), assetId: asset.assetId } } as Partial<Draft>);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not upload that font.");
    }
  };

  const save = async () => {
    if (!input) return;
    if (!draft.name.trim()) { setError("Give the brand a name."); return; }
    setBusy("save");
    setError(null);
    try {
      const kit = await saveBrandKit({ ...input, name: draft.name.trim() });
      setKits((current) => [kit, ...current]);
      onChange(kit);
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the brand kit.");
    } finally {
      setBusy("");
    }
  };

  const t = derived?.theme.tokens;
  // Mirrors the backend: a one-color logo that matches the background is shown inverted.
  const invertLogo = Boolean(derived && ((draft.logoTone === "dark" && derived.theme.mode === "dark") || (draft.logoTone === "light" && derived.theme.mode === "light")));
  const previewStyle = t ? ({ "--p-bg": t.bg, "--p-fg": t.fg, "--p-brand": t.brand, "--p-accent": t.accent, "--p-surface": t.surface, "--p-border": t.border, "--p-muted": t.muted, "--p-display": t.fontDisplay, "--p-body": t.fontBody } as React.CSSProperties) : undefined;

  return (
    <div className="brand-field">
      <span className="field-label" id="brand-label">Brand</span>
      {/* While a site brand waits to be saved, its card replaces the empty "No brand kit" row. */}
      <div className="brand-current-row" hidden={Boolean(found && !selected)}>
        <button type="button" className="theme-current brand-current" onClick={open} disabled={disabled} aria-labelledby="brand-label brand-current-name" aria-haspopup="dialog">
          <span className="brand-logo-box">{selected?.hasLogo ? <img src={brandLogoUrl(selected.id)} alt="" /> : <span aria-hidden="true">＋</span>}</span>
          <span className="theme-current-meta">
            <strong id="brand-current-name">{selected ? selected.name : "No brand kit"}</strong>
            {selected ? (
              <span className="theme-swatches" aria-hidden="true">{[selected.colors.primary, selected.colors.accent, selected.colors.background].filter(Boolean).map((c) => <span key={c} style={{ background: c }} />)}</span>
            ) : <span className="template-meta">Logo, colors, and fonts from your site or files</span>}
            <span className="theme-change">{selected ? "Change brand →" : "Add your brand →"}</span>
          </span>
        </button>
        {selected ? <button type="button" className="text-button" onClick={() => onChange(null)} disabled={disabled}>Remove</button> : null}
      </div>
      {found && !selected ? <div className="brand-draft">
        <span className="brand-logo-box">{found.logo?.assetId ? <img src={stagedLogoUrl(found.logo.assetId)} alt="" /> : <span aria-hidden="true">{(found.name ?? "B")[0]}</span>}</span>
        <span className="brand-draft-meta"><strong>{found.name ?? "Your brand"}</strong><span className="theme-swatches" aria-hidden="true">{[found.colors.primary, found.colors.accent, found.colors.background].filter(Boolean).map((color) => <span key={color} style={{ background: color as string }} />)}</span><small>From {source ?? found.url} · not saved yet</small></span>
        <span className="brand-draft-actions"><span><button type="button" className="text-button" onClick={reviewFound} disabled={disabled || busy === "save"}>Review</button><button type="button" className="text-button" onClick={open} disabled={disabled || busy === "save"}>Other kit</button></span><button type="button" className="brand-save" onClick={() => void saveFound()} disabled={disabled || busy === "save"}>{busy === "save" ? "Saving…" : "Save and use"}</button></span>
      </div> : null}
      {selected && fromSite && source ? <small className="brand-site-note">From {source} · <button type="button" className="text-button" onClick={open} disabled={disabled}>Change</button></small> : null}
      {selected && suggested && suggested.id !== selected.id ? <small className="brand-site-note">{source ?? "This site"} has a different kit, {suggested.name}. <button type="button" className="text-button" onClick={() => onChange(suggested)} disabled={disabled}>Use it</button></small> : null}

      <dialog ref={dialogRef} className="theme-dialog" aria-labelledby="brand-dialog-title" onClick={(event) => { if (event.target === dialogRef.current) close(); }}>
        <div className="theme-dialog-inner">
          <header className="theme-dialog-header">
            <div>
              <span className="eyebrow">Brand kit</span>
              <h2 id="brand-dialog-title">{view === "list" ? "Choose a brand kit" : "Make videos on brand"}</h2>
              <p>{view === "list" ? "Videos use the kit's logo, name, website, colors, and fonts." : "Import from your website, upload your logo and fonts, or set colors by hand. You review everything before saving."}</p>
            </div>
            <button type="button" className="theme-close" onClick={close} aria-label="Close brand kit">✕</button>
          </header>

          {view === "list" ? (
            <div className="brand-list">
              {kits.map((kit) => (
                <button key={kit.id} type="button" className={`brand-list-item ${kit.id === value ? "is-current" : ""}`} onClick={() => { onChange(kit); close(); }}>
                  <span className="brand-logo-box">{kit.hasLogo ? <img src={brandLogoUrl(kit.id)} alt="" /> : <span aria-hidden="true">{kit.name[0]}</span>}</span>
                  <span><strong>{kit.name}</strong><small>{kit.url ?? "No website"}</small></span>
                  <span className="theme-swatches" aria-hidden="true">{[kit.colors.primary, kit.colors.accent, kit.colors.background].filter(Boolean).map((c) => <span key={c} style={{ background: c }} />)}</span>
                </button>
              ))}
              <button type="button" className="template-use" onClick={() => { setDraft(emptyDraft); setExtraction(null); setImportUrl(""); setView("edit"); }}>New brand kit</button>
            </div>
          ) : (
            <div className="brand-editor">
              <div className="brand-form">
                <section className="brand-import" aria-labelledby="brand-import-title">
                  <h3 id="brand-import-title">Import from website</h3>
                  {/* noValidate + type="text": people type "acme.com" without https://, which native URL validation rejects silently. */}
                  <form className="brand-import-row" noValidate onSubmit={(event) => { event.preventDefault(); if (importUrl.trim()) void runImport(); }}>
                    <input type="text" inputMode="url" autoComplete="url" spellCheck={false} aria-label="Product website" placeholder="yourproduct.com" value={importUrl} onChange={(event) => setImportUrl(event.target.value)} />
                    <button type="submit" className="template-use" disabled={busy === "import" || !importUrl.trim()}>{busy === "import" ? "Reading site…" : "Fetch brand"}</button>
                  </form>
                  {extraction?.notes.length ? <ul className="brand-notes">{extraction.notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
                </section>

                <div className="brand-grid">
                  <label><span className="field-label">Brand name</span><input type="text" value={draft.name} maxLength={28} onChange={(event) => update({ name: event.target.value })} placeholder="Acme" /></label>
                  <label><span className="field-label">Website</span><input type="text" value={draft.url} maxLength={200} onChange={(event) => update({ url: event.target.value })} placeholder="acme.com" /></label>
                </div>

                <div className="brand-logo-field">
                  <span className="field-label">Logo</span>
                  <div className="brand-logo-row">
                    <span className="brand-logo-box large">{draft.logoAssetId ? <img src={stagedLogoUrl(draft.logoAssetId)} alt="Logo preview" /> : <span aria-hidden="true">No logo</span>}</span>
                    <label className="brand-file">
                      <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadLogo(file); }} />
                      <span>{busy === "logo" ? "Uploading…" : draft.logoAssetId ? "Replace logo" : "Upload logo"}</span>
                    </label>
                    {draft.logoAssetId ? <button type="button" className="text-button" onClick={() => update({ logoAssetId: undefined })}>Remove</button> : null}
                  </div>
                  {extraction?.logo ? <small className="brand-hint">Found: {extraction.logo.source}</small> : <small className="brand-hint">PNG, JPEG, WebP, or SVG. A version that shows on a light background works best.</small>}
                </div>

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
                {extraction?.fonts.selfHosted.length ? <small className="brand-hint">Self-hosted fonts are never downloaded from your site: upload your licensed files or choose a Google font.</small> : null}
              </div>

              <aside className="brand-preview" aria-label="Brand preview">
                <span className="field-label">Preview</span>
                <div className="brand-preview-frame" style={previewStyle}>
                  {draft.logoAssetId ? <img className="brand-preview-logo" src={stagedLogoUrl(draft.logoAssetId)} alt="" style={invertLogo ? { filter: "invert(1)" } : undefined} /> : <span className="brand-preview-eyebrow">{draft.name || "Your brand"}</span>}
                  <strong className="brand-preview-title">Ship the update and the video the same day.</strong>
                  <span className="brand-preview-body">Every scene uses your colors and fonts.</span>
                  <span className="brand-preview-card"><span className="brand-preview-dot">01</span> Feature card</span>
                  <span className="brand-preview-cta">Start free</span>
                  <span className="brand-preview-bar" />
                </div>
                {derived?.adjustments.length || invertLogo ? <ul className="brand-notes">{[...(derived?.adjustments ?? []), ...(invertLogo ? [`Your ${draft.logoTone} logo will be inverted so it shows on the ${derived?.theme.mode} background.`] : [])].map((note) => <li key={note}>{note}</li>)}</ul> : <small className="brand-hint">All text colors meet WCAG AA contrast.</small>}
              </aside>

              {error ? <p className="error-message" role="alert">{error}</p> : null}
              <div className="brand-actions">
                {kits.length ? <button type="button" className="text-button" onClick={() => setView("list")}>← Saved kits</button> : <span />}
                <button type="button" className="brand-save" onClick={() => void save()} disabled={!input || busy === "save"}>{busy === "save" ? "Saving…" : "Save brand kit"}</button>
              </div>
            </div>
          )}
          {view === "list" && error ? <p className="error-message" role="alert">{error}</p> : null}
        </div>
      </dialog>
    </div>
  );
}
