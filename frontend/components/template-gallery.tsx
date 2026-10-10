"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GalleryCard, GalleryPage } from "@videosaas/contracts";
import { galleryUseCases, type GalleryUseCase } from "@videosaas/contracts/gallery-use-cases";
import { listGalleryTemplates } from "../lib/api";
import { galleryMediaUrl } from "../lib/gallery-media";

/** Where a signed-out visitor goes to start from a template: sign-up, then straight into the prefilled brief. */
export const startHref = (id: string) => `/auth?mode=signup&next=${encodeURIComponent(`/studio?template=${id}`)}`;

/** The preview: a muted clip that plays on hover or focus (and while visible on touch screens), else its still. */
function Preview({ item, onOpen }: { item: GalleryCard; onOpen: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  const src = item.preview.video;
  useEffect(() => {
    const node = video.current;
    const frame = box.current;
    if (!node || !frame || !window.matchMedia("(hover: none)").matches) return;
    const watch = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) void node.play().catch(() => undefined); else node.pause(); }, { threshold: 0.7 });
    watch.observe(frame);
    return () => watch.disconnect();
  }, [src]);
  const play = () => { void video.current?.play().catch(() => undefined); };
  const stop = () => { const node = video.current; if (!node) return; node.pause(); node.currentTime = 0; };
  const square = item.aspect === "1:1" || item.preview.src.includes("/illus-");
  // A vertical film gets a taller frame and is shown whole on a dark ground, never cropped.
  const tall = item.aspect === "9:16";
  return <span ref={box} className={square ? "gallery-media square" : tall ? "gallery-media tall" : "gallery-media"} role="button" tabIndex={0} aria-label={`Open the ${item.name} preview`} onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }} onMouseEnter={play} onMouseLeave={stop} onFocus={play} onBlur={stop}>
    {src
      ? <video ref={video} src={galleryMediaUrl(src)} poster={galleryMediaUrl(item.preview.src)} muted loop playsInline preload="none" aria-label={`${item.name}: ${item.preview.label.toLowerCase()}`} />
      : <img src={galleryMediaUrl(item.preview.src)} alt={`${item.name}: ${item.preview.label.toLowerCase()}`} loading="lazy" decoding="async" width={480} height={270} />}
    <span className="gallery-group">{item.group}</span>
    {src && <span className="gallery-time" aria-hidden="true">▶ Preview</span>}
  </span>;
}

/** One starting point: a real preview, what it is, and the action. With `href` it is a link, otherwise a button. */
export function GalleryCardView({ item, onUse, href, action = "Use this", busy }: { item: GalleryCard; onUse?: (item: GalleryCard) => void; href?: string; action?: string; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  const use = href
    ? <Link className="primary-button gallery-action" href={href}>{action}</Link>
    : <button type="button" className="primary-button gallery-action" disabled={busy} aria-busy={busy} onClick={() => onUse?.(item)}>{action}</button>;
  return <article className="gallery-card">
    <Preview item={item} onOpen={() => setOpen(true)} />
    <div className="gallery-body">
      <h3>{item.name}</h3>
      <p>{item.summary}</p>
      {item.generated && <small className="gallery-note">The preview is a reference. Your video is created in this style.</small>}
      {item.source && <a className="gallery-source" href={item.source.url} target="_blank" rel="noreferrer">{item.source.label}</a>}
      {use}
    </div>
    {open && <PreviewDialog item={item} onClose={() => setOpen(false)}>{use}</PreviewDialog>}
  </article>;
}

/** The preview at a larger size, in a modal: the clip plays with controls, with the same action as the card.
 *  Closes with the button, a click outside, or Escape. */
function PreviewDialog({ item, onClose, children }: { item: GalleryCard; onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = item.preview.video;
  const shape = item.aspect === "9:16" ? "tall" : item.aspect === "1:1" || item.preview.src.includes("/illus-") ? "square" : "wide";
  useEffect(() => { const node = dialog.current; if (node && !node.open) node.showModal(); }, []);
  return <dialog ref={dialog} className="gallery-dialog" aria-label={`${item.name} preview`} onClose={onClose} onClick={(event) => { if (event.target === dialog.current) dialog.current?.close(); }}>
    <button type="button" className="gallery-dialog-close" aria-label="Close preview" onClick={() => dialog.current?.close()}><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /></svg></button>
    <div className={`gallery-dialog-media ${shape}`}>
      {video
        ? <video src={galleryMediaUrl(video)} poster={galleryMediaUrl(item.preview.src)} controls autoPlay loop muted playsInline aria-label={`${item.name}: ${item.preview.label.toLowerCase()}`} />
        : <img src={galleryMediaUrl(item.preview.src)} alt={`${item.name}: ${item.preview.label.toLowerCase()}`} />}
    </div>
    <div className="gallery-dialog-body">
      <div><h3>{item.name}</h3><p>{item.summary}</p>{item.source && <a className="gallery-source" href={item.source.url} target="_blank" rel="noreferrer">{item.source.label}</a>}</div>
      {children}
    </div>
  </dialog>;
}

/** Placeholder cards with the real card's proportions, so the page does not jump while a page loads. */
function Skeletons({ count }: { count: number }) {
  return <>{Array.from({ length: count }, (_, index) => <article className="gallery-card gallery-skeleton" key={index} aria-hidden="true"><span className="gallery-media" /><div className="gallery-body"><i /><i /><i className="short" /></div></article>)}</>;
}

/** A grid of starting points. Used by the Templates page, the Projects empty state and the landing page.
 *  With `row`, it is one line that scrolls sideways and fades out on the right, so it reads as part of a bigger library.
 *  Round arrows scroll it; at the end, the right arrow calls `onMore` (open the full Templates page). */
export function GalleryGrid({ items, onUse, hrefFor, action, busy, loading, skeletons = 0, row, onMore }: { items: readonly GalleryCard[]; onUse?: (item: GalleryCard) => void; hrefFor?: (item: GalleryCard) => string; action?: string; busy?: boolean; loading?: boolean; skeletons?: number; row?: boolean; onMore?: () => void }) {
  const [edge, setEdge] = useState({ start: true, end: false });
  const track = useRef<HTMLDivElement>(null);
  const update = () => { const node = track.current; if (node) setEdge({ start: node.scrollLeft <= 8, end: node.scrollLeft + node.clientWidth >= node.scrollWidth - 8 }); };
  useEffect(() => { if (row) update(); }, [row, items.length, loading]);
  const scroll = (direction: 1 | -1) => { const node = track.current; if (node) node.scrollBy({ left: direction * node.clientWidth * 0.8, behavior: "smooth" }); };
  const grid = <div ref={track} className={row ? `gallery-grid gallery-row${edge.end ? " at-end" : ""}` : "gallery-grid"} aria-busy={loading || undefined} onScroll={row ? update : undefined}>{items.map((item) => <GalleryCardView key={item.id} item={item} onUse={onUse} href={hrefFor?.(item)} action={action} busy={busy} />)}{loading && <Skeletons count={skeletons} />}</div>;
  if (!row) return grid;
  return <div className="gallery-rowwrap">
    {grid}
    {!edge.start && <button type="button" className="gallery-arrow left" aria-label="Show earlier templates" onClick={() => scroll(-1)}>←</button>}
    {(!edge.end || onMore) && <button type="button" className="gallery-arrow right" aria-label={edge.end ? "Explore all templates" : "Explore more templates"} onClick={() => edge.end ? onMore?.() : scroll(1)}><span>Explore more</span><b aria-hidden="true">→</b></button>}
  </div>;
}

/** The first page of starting points, fetched from the backend. `featured` is the landing page's curated set. */
export function useGalleryShelf({ featured, limit }: { featured?: boolean; limit: number }) {
  const [items, setItems] = useState<GalleryCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    listGalleryTemplates({ featured, limit }, abort.signal)
      .then((page) => { setItems(page.items); setFailed(false); })
      .catch((error: unknown) => { if ((error as { name?: string }).name !== "AbortError") setFailed(true); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [featured, limit]);
  return { items, loading, failed };
}

const PAGE = 24;
type Counts = GalleryPage["counts"];

/** The Templates page: every starting point in one grid, browsed by what the video is for. Paging, filtering and search
 *  are done by the backend; the browser holds only the pages it has shown. */
export function TemplatesPage({ onUse, busy }: { onUse: (item: GalleryCard) => void; busy?: boolean }) {
  // The tab and the search live in the URL (/templates?use=saas&q=...), so a reload or a shared link opens the same view.
  const params = useSearchParams();
  const asked = params.get("use");
  const [useCase, setUseCase] = useState<GalleryUseCase | "all">(galleryUseCases.some((entry) => entry.id === asked) ? (asked as GalleryUseCase) : "all");
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [items, setItems] = useState<GalleryCard[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const next = new URLSearchParams(window.location.search);
    if (useCase === "all") next.delete("use"); else next.set("use", useCase);
    if (search) next.set("q", search); else next.delete("q");
    const text = next.toString();
    if (text !== window.location.search.replace(/^\?/, "")) window.history.replaceState(window.history.state, "", `${window.location.pathname}${text ? `?${text}` : ""}`);
  }, [useCase, search]);

  // Search waits for a pause in typing, then asks the backend.
  useEffect(() => { const timer = window.setTimeout(() => setSearch(query), 250); return () => window.clearTimeout(timer); }, [query]);

  const load = useCallback(async (cursor: string | null) => {
    const request = ++latest.current;
    if (cursor) setMore(true); else setLoading(true);
    try {
      const page = await listGalleryTemplates({ useCase, q: search, cursor, limit: PAGE });
      if (request !== latest.current) return;
      setItems((current) => cursor ? [...current, ...page.items.filter((item) => !current.some((known) => known.id === item.id))] : page.items);
      setNext(page.nextCursor); setCounts(page.counts); setTotal(page.total); setFailed(false);
    } catch { if (request === latest.current) setFailed(true); }
    finally { if (request === latest.current) { setLoading(false); setMore(false); } }
  }, [useCase, search]);
  useEffect(() => { void load(null); }, [load]);

  const blurb = galleryUseCases.find((entry) => entry.id === useCase)?.blurb;
  return <section className="page-container">
    <div className="page-heading"><div><h1>Templates</h1><p>{counts ? `${counts.all} starting points. ` : ""}Pick one and the script prompt, structure, look and sound are filled in. Change anything before you generate.</p></div></div>
    <div className="gallery-tools">
      <div className="filter-tabs" role="group" aria-label="What the video is for">
        <button className={useCase === "all" ? "selected" : ""} aria-pressed={useCase === "all"} onClick={() => setUseCase("all")}>All {counts && <span>{counts.all}</span>}</button>
        {galleryUseCases.map((entry) => <button key={entry.id} className={useCase === entry.id ? "selected" : ""} aria-pressed={useCase === entry.id} onClick={() => setUseCase(entry.id)}>{entry.label} {counts && <span>{counts[entry.id]}</span>}</button>)}
      </div>
      <input className="gallery-search" type="search" value={query} placeholder="Search templates" aria-label="Search templates" onChange={(event) => setQuery(event.target.value)} />
    </div>
    {blurb && <p className="gallery-blurb">Good for: {blurb}</p>}
    {failed
      ? <div className="workspace-message" role="alert">Templates could not be loaded. <button className="secondary-button" onClick={() => void load(null)}>Try again</button></div>
      : !loading && total === 0
        ? <div className="workspace-message" role="status">Nothing matches "{search}". Try another word or clear the search.</div>
        : <GalleryGrid items={items} onUse={onUse} busy={busy} loading={loading} skeletons={8} />}
    {next && !loading && <div className="gallery-more"><button className="secondary-button" disabled={more} onClick={() => void load(next)}>{more ? "Loading…" : `Show more (${total - items.length} left)`}</button></div>}
  </section>;
}
