"use client";

import { useCallback, useEffect, useState } from "react";
import { type BrandKit } from "@videosaas/contracts";
import { brandLogoUrl, listBrandKits } from "../lib/api";
import { BrandKitDialog } from "./brand-kit-dialog";
import { useMediaToken } from "../lib/use-media-token";
import { AppShell } from "./app-shell";

function BrandKits({ brands, refresh }: { brands: BrandKit[]; refresh: () => Promise<void> }) {
  // Re-renders the logos when the media token arrives or renews.
  useMediaToken();
  // `undefined`: closed. `null`: a new kit. A kit: edit it.
  const [editing, setEditing] = useState<BrandKit | null | undefined>(undefined);
  const [version, setVersion] = useState(0);
  // `version` busts the browser's copy of a logo after it was replaced.
  const logo = (brand: BrandKit) => { const url = brandLogoUrl(brand.id); return `${url}${url.includes("?") ? "&" : "?"}v=${version}`; };
  return <section className="page-container brand-page"><div className="page-heading"><div><h1>Brand kits</h1><p>Logos, colors, fonts, and approved language your videos follow.</p></div><button className="primary-button" onClick={() => setEditing(null)}>New brand kit</button></div>{brands.length === 0 ? <div className="empty-workspace"><b>No brand kits yet.</b><p>Add a brand kit to make it available in the creation flow.</p></div> : brands.map((brand) => <article className="brand-kit-detail brand-kit-open" key={brand.id} role="button" tabIndex={0} aria-label={"Edit " + brand.name} onClick={() => setEditing(brand)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setEditing(brand); } }}><div className={brand.hasLogo ? "kit-logo has-logo" : "kit-logo"}>{brand.hasLogo ? <img src={logo(brand)} alt={brand.name + " logo"} /> : <><b>{brand.name.slice(0, 1).toUpperCase()}</b>{brand.name}</>}</div><dl><div><dt>Primary color</dt><dd>{brand.colors.primary}</dd></div><div><dt>Fonts</dt><dd>{brand.fonts.heading.family} · {brand.fonts.body.family}</dd></div><div><dt>Website</dt><dd>{brand.url || "Not set"}</dd></div><div><dt>Approved language</dt><dd>{brand.description || "Not set"}</dd></div></dl></article>)}{editing !== undefined && <BrandKitDialog kit={editing} onClose={() => setEditing(undefined)} onSaved={() => { setVersion((current) => current + 1); void refresh(); }} />}</section>;
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
