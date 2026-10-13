"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getLook, heldForV2, looks, type GalleryCard, type GalleryStyleCard, type LookId } from "@videosaas/contracts";
import { galleryUseCases, normalizeSearch, type GalleryUseCase } from "@videosaas/contracts/gallery-use-cases";
import { familiesOfLook, getStyleFamily } from "@videosaas/contracts/style-families";
import { listGalleryStyles, listGalleryTemplates } from "../lib/api";
import { galleryMediaUrl } from "../lib/gallery-media";
import { GalleryCardView } from "./template-gallery";

/** What the picker lists: a look, or (for a look split into families such as Clean) each of its families. */
type Entry = { id: string; look: LookId; name: string; group: string; description: string };
const entries: Entry[] = looks.filter((look) => look.available && !heldForV2(look.id)).flatMap((look) => {
  const families = familiesOfLook(look.id);
  return families.length ? families.map((family) => ({ id: family.id, look: look.id, name: family.name, group: look.group, description: family.description })) : [{ id: look.id, look: look.id, name: look.name, group: look.group, description: look.description }];
});
const entryOf = (id: string) => entries.find((entry) => entry.id === id) ?? entries[0]!;
/** The entry a brief points at: its family, or the look's first family (Clean opens as Product UI), or the look itself. */
const currentId = (look: LookId, family?: string) => { const first = familiesOfLook(look)[0]; return family && getStyleFamily(family)?.look === look ? family : first ? first.id : look; };
const groups = ["All", ...new Set(entries.map((entry) => entry.group))];
/** The few styles shown inline; every other style is one click away in the browser. */
const featuredIds: readonly string[] = ["clean-ui", "clean-3d", "clean-type", "clean-data", "sketch", "hairline", "doodle", "vox-collage", "paper-diorama", "clay-clean", "illus-balloon", "illus-blueprint"];
const FEATURED = 6;
const PAGE = 12;

/** Until the backend answers (or if it cannot), a style shows its still. */
const fallbackStyle = (id: string): GalleryStyleCard => { const entry = entryOf(id); const look = getLook(entry.look); return { id: entry.id, look: entry.look, name: entry.name, group: entry.group, description: entry.description, examples: 0, preview: { src: look.preview.src, kind: "image", label: look.preview.label } }; };

/** A real example clip: still until it is hovered (or `live`, which plays it all the time). */
function Clip({ style, live }: { style: GalleryStyleCard; live?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const src = style.preview.video;
  const play = () => { void video.current?.play().catch(() => undefined); };
  const stop = () => { const node = video.current; if (node && !live) { node.pause(); node.currentTime = 0; } };
  return <span className="sp-media" onMouseEnter={play} onMouseLeave={stop} onFocus={play} onBlur={stop}>
    {src
      ? <video ref={video} src={galleryMediaUrl(src)} poster={galleryMediaUrl(style.preview.src)} muted loop playsInline autoPlay={live} preload={live ? "auto" : "none"} aria-hidden="true" />
      : <img src={galleryMediaUrl(style.preview.src)} alt="" loading="lazy" width={480} height={270} />}
  </span>;
}

/** The look of the film. The chosen style is shown first with a real example playing; a few popular ones sit beside it;
 *  "Browse" opens every style, and a style opens to all of its examples across use cases (the SaaS version, the story
 *  version, starters and remakes), so people see what they are choosing before they choose it. */
export function StylePicker({ value, family, onChange }: { value: LookId; family?: string; onChange: (look: LookId, family?: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [styles, setStyles] = useState<Record<string, GalleryStyleCard>>({});
  const [group, setGroup] = useState("All");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<string | null>(null);
  const selected = getLook(value);
  const current = currentId(value, family);
  const style = (id: string) => styles[id] ?? fallbackStyle(id);
  const chosen = style(current);
  const pick = (id: string) => { const entry = entryOf(id); onChange(entry.look, familiesOfLook(entry.look).length ? entry.id : undefined); };
  const [shown, setShown] = useState<GalleryCard[]>([]);
  const [playing, setPlaying] = useState<GalleryCard | null>(null);
  // A few real examples made in the chosen style, so the choice is never abstract.
  useEffect(() => {
    const abort = new AbortController();
    listGalleryTemplates({ look: current, limit: 4 }, abort.signal).then((page) => setShown(page.items)).catch(() => setShown([]));
    return () => abort.abort();
  }, [current]);

  useEffect(() => { setPlaying(null); }, [current]);

  useEffect(() => {
    const abort = new AbortController();
    listGalleryStyles(abort.signal).then((items) => setStyles(Object.fromEntries(items.map((item) => [item.id, item])))).catch(() => undefined);
    return () => abort.abort();
  }, []);

  const quick = featuredIds.filter((id) => id !== current && entries.some((entry) => entry.id === id)).slice(0, FEATURED);
  const needle = normalizeSearch(query).toLowerCase();
  const visible = entries.filter((entry) => (group === "All" || entry.group === group) && (!needle || `${entry.name} ${entry.group} ${entry.description}`.toLowerCase().includes(needle)));

  const open = (id: string | null) => { setGroup("All"); setQuery(""); setDetail(id); if (!dialog.current?.open) dialog.current?.showModal(); };
  const close = () => dialog.current?.close();
  const choose = (id: string) => { pick(id); close(); };

  return <div className="style-library sp">
    <div className="sp-head"><b>Visual style</b><button type="button" className="sp-browse" onClick={() => open(null)} aria-haspopup="dialog">Browse all {entries.length} styles →</button></div>

    <div className="sp-current" aria-live="polite">
      <div className="sp-current-thumb"><Clip key={playing?.id ?? chosen.id} style={playing ? { ...chosen, preview: playing.preview } : chosen} live />{playing && <span className="sp-now">{playing.name}</span>}</div>
      <div className="sp-current-body">
        <span className="sp-tag">Selected · {selected.group}</span>
        <h3>{chosen.name}</h3>
        <p>{chosen.description} Your brand sets the colors and fonts.</p>
        {shown.length > 0 && <div className="sp-mini" aria-label="Examples in this style">
          {shown.map((item) => <button type="button" key={item.id} className={"sp-mini-card" + (playing?.id === item.id ? " playing" : "")} aria-pressed={playing?.id === item.id} onClick={() => setPlaying(playing?.id === item.id ? null : item)} aria-label={`${item.name}, an example in this style`}>
            <span className="sp-thumb"><Clip style={{ ...chosen, preview: item.preview }} /></span><small>{item.name}</small>
          </button>)}
        </div>}
        {chosen.examples > 0 && <button type="button" className="sp-link" onClick={() => open(current)}>See all {chosen.examples} {chosen.examples === 1 ? "example" : "examples"} in this style →</button>}
        {selected.renderMode === "generated" && <p className="sp-note">Generating material scenes on the storyboard produces this style. The preview is a layout draft, and generation needs a confirmed budget. Product screenshots and text stay crisp.</p>}
        <details><summary>Style direction &amp; references</summary>
          <p>{selected.instructions.image}</p><p>{selected.instructions.motion}</p>
          {selected.referenceAssets.map((asset) => <a key={asset} href={`/previews/looks/references/${asset}`} target="_blank" rel="noreferrer"><img src={`/previews/looks/references/${asset}`} alt={`${selected.group} source style reference sheet`} loading="lazy" /><span>Open reference image</span></a>)}
        </details>
      </div>
    </div>

    <div className="sp-quick" role="group" aria-label="Popular styles">
      {quick.map((id) => <button type="button" className="sp-card" key={id} onClick={() => pick(id)} aria-label={`Use ${style(id).name}`}>
        <span className="sp-thumb"><Clip style={style(id)} />{style(id).examples > 0 && <i className="sp-pill">{style(id).examples} examples</i>}<i className="sp-play" aria-hidden="true">▶</i></span><b>{style(id).name}</b>
      </button>)}
      <button type="button" className="sp-card sp-more" onClick={() => open(null)}><span className="sp-more-plus" aria-hidden="true">+{Math.max(entries.length - quick.length - 1, 0)}</span><b>More styles</b></button>
    </div>

    <dialog ref={dialog} className="theme-dialog" aria-labelledby="style-dialog-title" onClose={() => setDetail(null)} onClick={(event) => { if (event.target === dialog.current) close(); }}>
      {detail
        ? <StyleDetail key={detail} style={style(detail)} current={detail === current} back={() => setDetail(null)} close={close} choose={choose} />
        : <div className="theme-dialog-inner">
          <header className="theme-dialog-header">
            <div><span className="eyebrow">{entries.length} styles</span><h2 id="style-dialog-title">Choose a visual style</h2><p>Open a style to see every example made in it. Your brand still sets the colours and fonts.</p></div>
            <button type="button" className="theme-close" onClick={close} aria-label="Close style browser">✕</button>
          </header>
          <div className="sp-tools">
            <input className="gallery-search" type="search" value={query} placeholder="Search styles" aria-label="Search styles" onChange={(event) => setQuery(event.target.value)} />
            <div className="style-filters" aria-label="Filter visual styles">{groups.map((name) => <button type="button" key={name} aria-pressed={group === name} onClick={() => setGroup(name)}>{name}</button>)}</div>
          </div>
          {visible.length === 0 ? <p className="sp-empty" role="status">No style matches "{normalizeSearch(query)}".</p> : <div className="sp-grid" role="group" aria-label="Visual styles">
            {visible.map((item) => { const entry = style(item.id); return <button type="button" className={`sp-card${item.id === current ? " is-current" : ""}`} key={item.id} onClick={() => open(item.id)}>
              <span className="sp-thumb"><Clip style={entry} />{item.id === current && <i className="sp-check" aria-hidden="true">✓</i>}<i className="sp-play" aria-hidden="true">▶</i></span>
              <b>{item.name}</b><small>{entry.examples > 0 ? `${entry.examples} ${entry.examples === 1 ? "example" : "examples"}` : item.group}</small>
            </button>; })}
          </div>}
        </div>}
    </dialog>
  </div>;
}

/** One style opened up: its real examples, filtered by what the video is for. Choosing any of them picks the style. */
function StyleDetail({ style, current, back, close, choose }: { style: GalleryStyleCard; current: boolean; back: () => void; close: () => void; choose: (id: string) => void }) {
  const [useCase, setUseCase] = useState<GalleryUseCase | "all">("all");
  const [items, setItems] = useState<GalleryCard[]>([]);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);
  const load = useCallback(async (cursor: string | null) => {
    const request = ++latest.current;
    setLoading(true);
    try {
      const page = await listGalleryTemplates({ look: style.id, useCase, cursor, limit: PAGE });
      if (request !== latest.current) return;
      setItems((known) => cursor ? [...known, ...page.items.filter((item) => !known.some((have) => have.id === item.id))] : page.items);
      setNext(page.nextCursor); setCounts(page.counts); setTotal(page.total); setFailed(false);
    } catch { if (request === latest.current) setFailed(true); }
    finally { if (request === latest.current) setLoading(false); }
  }, [style.id, useCase]);
  useEffect(() => { void load(null); }, [load]);
  // The next page loads by itself as the end of the list scrolls into view (the button stays as a fallback), so nothing
  // jumps: the list keeps its place, skeleton cards hold the space, and the dialog never changes height.
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  useEffect(() => { busy.current = loading; }, [loading]);
  useEffect(() => {
    const end = sentinel.current, root = scroller.current;
    if (!end || !root || !next) return;
    const watch = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting && !busy.current) { busy.current = true; void load(next); } }, { root, rootMargin: "0px 0px 240px 0px" });
    watch.observe(end);
    return () => watch.disconnect();
  }, [next, load, items.length]);
  const tabs = galleryUseCases.filter((entry) => (counts?.[entry.id] ?? 0) > 0);

  return <div className="theme-dialog-inner sp-detail-inner">
    <header className="theme-dialog-header">
      <div><button type="button" className="sp-back" onClick={back}>← All styles</button><span className="eyebrow">{style.group}</span><h2 id="style-dialog-title">{style.name}</h2><p>{style.description}</p></div>
      <button type="button" className="theme-close" onClick={close} aria-label="Close style browser">✕</button>
    </header>
    <div className="sp-detail-bar">
      <button type="button" className="primary-button" onClick={() => choose(style.id)}>{current ? "Keep this style" : "Use this style"}</button>
      {counts && tabs.length > 1 && <div className="filter-tabs" role="group" aria-label="What the video is for">
        <button className={useCase === "all" ? "selected" : ""} aria-pressed={useCase === "all"} onClick={() => setUseCase("all")}>All <span>{counts.all}</span></button>
        {tabs.map((entry) => <button key={entry.id} className={useCase === entry.id ? "selected" : ""} aria-pressed={useCase === entry.id} onClick={() => setUseCase(entry.id)}>{entry.label} <span>{counts[entry.id]}</span></button>)}
      </div>}
    </div>
    {failed ? <p className="sp-empty" role="alert">Examples could not be loaded. <button type="button" className="secondary-button" onClick={() => void load(null)}>Try again</button></p>
      : !loading && total === 0 ? <p className="sp-empty" role="status">No examples in this style yet. You can still use it: your video is created in this style.</p>
      : <div ref={scroller} className={`sp-examples${loading && items.length ? " is-loading" : ""}`} aria-busy={loading || undefined}>
        {items.map((item) => <GalleryCardView key={item.id} item={item} action="Use this style" onUse={() => choose(style.id)} />)}
        {loading && Array.from({ length: items.length ? 4 : 8 }, (_, index) => <article className="gallery-card gallery-skeleton" key={`s${index}`} aria-hidden="true"><span className="gallery-media" /><div className="gallery-body"><i /><i /><i className="short" /></div></article>)}
        {next && <div ref={sentinel} className="sp-sentinel"><button type="button" className="secondary-button" disabled={loading} onClick={() => void load(next)}>{loading ? "Loading…" : `Show more (${total - items.length} left)`}</button></div>}
      </div>}
  </div>;
}
