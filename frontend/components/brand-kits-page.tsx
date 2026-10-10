"use client";

import { useCallback, useEffect, useState } from "react";
import { bundledFonts, type BrandKit } from "@videosaas/contracts";
import { listBrandKits, saveBrandKit } from "../lib/api";
import { AppShell } from "./app-shell";

function BrandKits({ brands, refresh }: { brands: BrandKit[]; refresh: () => Promise<void> }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [primary, setPrimary] = useState("");
  const [heading, setHeading] = useState("Inter");
  const [body, setBody] = useState("Inter");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const create = async () => {
    setSaving(true);
    setFormError(null);
    try {
      await saveBrandKit({ name, colors: { primary }, fonts: { heading: { source: "bundled", family: heading }, body: { source: "bundled", family: body } } });
      await refresh();
      setCreating(false);
      setName("");
      setPrimary("");
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "Could not save the brand kit.");
    } finally {
      setSaving(false);
    }
  };
  return <section className="page-container brand-page"><div className="page-heading"><div><h1>Brand kits</h1><p>Logos, colors, fonts, and approved language your videos follow.</p></div><button className="primary-button" onClick={() => setCreating((visible) => !visible)}>{creating ? "Cancel" : "New brand kit"}</button></div>{creating && <form className="brand-form" onSubmit={(event) => { event.preventDefault(); void create(); }}><label>Brand name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your company" required maxLength={28} /></label><label>Primary color<input value={primary} onChange={(event) => setPrimary(event.target.value)} placeholder="#635BFF" required /></label><label>Heading font<select value={heading} onChange={(event) => setHeading(event.target.value)}>{bundledFonts.map((font) => <option key={font} value={font}>{font}</option>)}</select></label><label>Body font<select value={body} onChange={(event) => setBody(event.target.value)}>{bundledFonts.map((font) => <option key={font} value={font}>{font}</option>)}</select></label>{formError && <p>{formError}</p>}<button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save brand kit"}</button></form>}{brands.length === 0 ? <div className="empty-workspace"><b>No brand kits yet.</b><p>Add a brand kit above to make it available in the creation flow.</p></div> : brands.map((brand) => <article className="brand-kit-detail" key={brand.id}><div className="kit-logo"><b>{brand.name.slice(0, 1).toUpperCase()}</b>{brand.name}</div><dl><div><dt>Primary color</dt><dd>{brand.colors.primary}</dd></div><div><dt>Fonts</dt><dd>{brand.fonts.heading.family} · {brand.fonts.body.family}</dd></div><div><dt>Website</dt><dd>{brand.url || "Not set"}</dd></div><div><dt>Approved language</dt><dd>{brand.description || "Not set"}</dd></div></dl></article>)}</section>;
}

/** The Brand kits page: it loads only the kits. */
export function BrandKitsPage() {
  const [brands, setBrands] = useState<BrandKit[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setBrands(await listBrandKits()); setError(null); setLoaded(true); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load brand kits."); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return <AppShell active="brand-kits">
    {error && <div className="workspace-error" role="alert">{error} <button onClick={() => void refresh()}>Try again</button></div>}
    {loaded || error ? <BrandKits brands={brands} refresh={refresh} /> : <section className="page-container"><div className="workspace-message" role="status" aria-busy="true">Loading your brand kits…</div></section>}
  </AppShell>;
}
