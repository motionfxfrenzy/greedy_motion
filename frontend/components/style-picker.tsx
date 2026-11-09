"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_LOOK, defaultStyleExample, familyOf, findGalleryTemplate, galleryCard, galleryStyles, getLook, isFilmTemplate, looks, queryGallery, styleExamples, type GalleryCard, type GalleryScope, type GalleryStyleCard, type LookId } from "@videosaas/contracts";
import { galleryUseCases, normalizeSearch, type GalleryUseCase } from "@videosaas/contracts/gallery-use-cases";
import { familiesOfLook, getStyleFamily } from "@videosaas/contracts/style-families";
import { listGalleryStyles, listGalleryTemplates } from "../lib/api";
import { galleryMediaUrl } from "../lib/gallery-media";
import { GalleryCardView } from "./template-gallery";

/** What the picker lists: a look, or (for a look split into families such as Clean) each of its families. */
type Entry = { id: string; look: LookId; name: string; group: string; description: string };

const PAGE = 12;

const fallbackCardsByScope: Record<GalleryScope, GalleryStyleCard[]> = {
  all: galleryStyles({ scope: "all", plates: true }),
  film: (() => {
    const raw = galleryStyles({ scope: "film", plates: true });
    // In film scope, Clean · Data & diagrams (28 educational explainers) leads the Essentials group.
    const dataIdx = raw.findIndex((item) => item.id === "clean-data");
    if (dataIdx <= 0) return raw;
    const dataCard = raw[dataIdx]!;
    return [dataCard, ...raw.slice(0, dataIdx), ...raw.slice(dataIdx + 1)];
  })()
};

const fallbackMapByScope: Record<GalleryScope, Record<string, GalleryStyleCard>> = {
  all: Object.fromEntries(fallbackCardsByScope.all.map((item) => [item.id, item])),
  film: Object.fromEntries(fallbackCardsByScope.film.map((item) => [item.id, item]))
};

const searchHaystackByScope: Record<GalleryScope, Record<string, string>> = {
  all: Object.fromEntries(
    fallbackCardsByScope.all.map((item) => [
      item.id,
      [item.name, item.group, item.description, ...styleExamples(item.id, { scope: "all", plates: true }).map((ex) => `${ex.name} ${ex.group}`)].join(" ").toLowerCase()
    ])
  ),
  film: Object.fromEntries(
    fallbackCardsByScope.film.map((item) => [
      item.id,
      [item.name, item.group, item.description, ...styleExamples(item.id, { scope: "film", plates: true }).map((ex) => `${ex.name} ${ex.group}`)].join(" ").toLowerCase()
    ])
  )
};

function resolveEntryMeta(id: string): Entry {
  const family = getStyleFamily(id);
  if (family) {
    const look = getLook(family.look);
    return { id: family.id, look: look.id, name: family.name, group: look.group, description: family.description };
  }
  const foundLook = looks.find((look) => look.id === id);
  if (foundLook) {
    return { id: foundLook.id, look: foundLook.id, name: foundLook.name, group: foundLook.group, description: foundLook.description };
  }
  const def = getLook(DEFAULT_LOOK);
  const firstFamily = familiesOfLook(def.id)[0];
  return firstFamily
    ? { id: firstFamily.id, look: def.id, name: firstFamily.name, group: def.group, description: firstFamily.description }
    : { id: def.id, look: def.id, name: def.name, group: def.group, description: def.description };
}

/** The entry a brief points at: its family, or the template's family, or the look's primary family for the scope, or the look itself. */
const currentId = (look: LookId, family?: string, example?: string, scope: GalleryScope = "all"): string => {
  if (family && getStyleFamily(family)?.look === look) return family;
  const tpl = findGalleryTemplate(example);
  if (tpl && tpl.look === look && (scope !== "film" || isFilmTemplate(tpl))) return familyOf(tpl);
  const families = familiesOfLook(look);
  if (!families.length) return look;
  if (scope === "film") return families.find((item) => item.id === "clean-data")?.id ?? families[0]!.id;
  return families[0]!.id;
};

/** Until the backend answers (or if it cannot), a style shows its catalog preview. */
const fallbackStyle = (id: string, scope: GalleryScope = "all"): GalleryStyleCard => {
  const fromScoped = fallbackMapByScope[scope][id] ?? fallbackMapByScope.all[id];
  if (fromScoped) return fromScoped;
  const entry = resolveEntryMeta(id);
  const look = getLook(entry.look);
  return {
    id: entry.id,
    look: entry.look,
    name: entry.name,
    group: entry.group,
    description: entry.description,
    examples: 0,
    preview: {
      src: look.preview.src,
      kind: look.preview.kind === "video" ? "video" : "image",
      label: look.preview.label,
      ...(look.preview.kind === "video" ? { video: look.preview.src } : {})
    }
  };
};

/** A real example clip: still until it is hovered (or `live`, which plays it all the time). Falls back to the look's static preview if the gallery asset is unavailable locally. */
function Clip({ style, live }: { style: GalleryStyleCard; live?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const src = style.preview.video;
  const primaryPoster = galleryMediaUrl(style.preview.src);
  const fallbackPoster = getLook(style.look).preview.src;
  const [poster, setPoster] = useState(primaryPoster);
  const [videoReady, setVideoReady] = useState(false);
  useEffect(() => {
    setPoster(primaryPoster);
    setVideoReady(false);
  }, [primaryPoster, src]);
  const play = () => { void video.current?.play().catch(() => undefined); };
  const stop = () => { const node = video.current; if (node && !live) { node.pause(); node.currentTime = 0; } };
  return <span className="sp-media" onMouseEnter={play} onMouseLeave={stop} onFocus={play} onBlur={stop}>
    <img
      src={poster}
      alt=""
      loading="lazy"
      width={480}
      height={270}
      onError={() => { if (poster !== fallbackPoster) setPoster(fallbackPoster); }}
      style={videoReady ? { display: "none" } : undefined}
    />
    {src && <video
      ref={video}
      src={galleryMediaUrl(src)}
      poster={poster}
      muted
      loop
      playsInline
      autoPlay={live}
      preload={live ? "auto" : "none"}
      aria-hidden="true"
      onPlaying={() => setVideoReady(true)}
      style={videoReady ? undefined : { display: "none" }}
    />}
  </span>;
}

/** The look of the film. The chosen style is shown first with a real example playing; a few popular ones sit beside it;
 *  "Browse" opens every style, and a style opens to all of its examples across use cases (the SaaS version, the story
 *  version, starters and remakes), so people see what they are choosing before they choose it. */
export function StylePicker({
  value,
  family,
  example,
  onChange,
  compact = false,
  scope = "all"
}: {
  value: LookId;
  family?: string;
  /** The gallery template the brief started from: shown as the selected style's example. */
  example?: string;
  onChange: (look: LookId, family?: string, example?: string) => void;
  /** One row (preview, name, Change) instead of the full card: the film brief. Same style library dialog. */
  compact?: boolean;
  /** Compatibility scope: "film" shows only educational explainers and narrative/illustrated story styles compatible with FilmBrief. */
  scope?: GalleryScope;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [serverEntries, setServerEntries] = useState<GalleryStyleCard[] | null>(null);
  const [group, setGroup] = useState("All");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<string | null>(null);
  const selected = getLook(value);
  const current = currentId(value, family, example, scope);

  useEffect(() => {
    const abort = new AbortController();
    setServerEntries(null);
    listGalleryStyles({ scope }, abort.signal)
      .then((items) => {
        if (abort.signal.aborted) return;
        if (scope === "film") {
          const scopedMap = fallbackMapByScope.film;
          const hasIllus = items.some((item) => item.id.startsWith("illus-"));
          const baseList = hasIllus ? items.filter((item) => item.id in scopedMap) : fallbackCardsByScope.film;
          const filtered = baseList.map((item) => {
            const ref = scopedMap[item.id]!;
            return item.examples > ref.examples ? ref : { ...ref, ...item, examples: ref.examples, preview: ref.preview, defaultExample: ref.defaultExample };
          });
          const dataIdx = filtered.findIndex((item) => item.id === "clean-data");
          const ordered = dataIdx > 0 ? [filtered[dataIdx]!, ...filtered.slice(0, dataIdx), ...filtered.slice(dataIdx + 1)] : filtered;
          setServerEntries(ordered);
        } else {
          const hasIllus = items.some((item) => item.id.startsWith("illus-"));
          setServerEntries(hasIllus ? items : fallbackCardsByScope.all);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setServerEntries(null);
      });
    return () => abort.abort();
  }, [scope]);

  const activeEntries = serverEntries ?? fallbackCardsByScope[scope];
  const styles = useMemo(
    () => ({ ...fallbackMapByScope[scope], ...Object.fromEntries(activeEntries.map((item) => [item.id, item])) }),
    [scope, activeEntries]
  );
  const style = (id: string) => styles[id] ?? fallbackStyle(id, scope);
  const chosen = style(current);

  const pick = (id: string, template?: string) => {
    const entry = resolveEntryMeta(id);
    const nextFamily = familiesOfLook(entry.look).length ? entry.id : undefined;
    let nextTemplate = template;
    if (!nextTemplate && scope === "film") {
      const currentTpl = findGalleryTemplate(example);
      const keepCurrent = id === current && currentTpl && isFilmTemplate(currentTpl) && (currentTpl.look === id || familyOf(currentTpl) === id);
      nextTemplate = keepCurrent
        ? currentTpl.id
        : (styles[id]?.defaultExample ?? defaultStyleExample(id, { scope: "film", plates: true }));
    }
    onChange(entry.look, nextFamily, nextTemplate);
  };

  const [playing, setPlaying] = useState<GalleryCard | null>(null);
  const localPinned = useMemo<GalleryCard | null>(() => {
    if (!example) return null;
    const tpl = findGalleryTemplate(example);
    if (!tpl) return null;
    if (tpl.look !== value || (tpl.look !== current && familyOf(tpl) !== current)) return null;
    if (scope === "film" && !isFilmTemplate(tpl)) return null;
    return galleryCard(tpl);
  }, [example, value, current, scope]);

  // The template the person picked, when it belongs to this style: it is what they chose, so it leads.
  const [pinned, setPinned] = useState<GalleryCard | null>(localPinned);
  // The template the brief started from, when it belongs to this style, is shown as the selected example.
  useEffect(() => {
    setPinned(localPinned);
    const abort = new AbortController();
    listGalleryTemplates({ look: current, scope, limit: example ? 48 : 1 }, abort.signal).then((page) => {
      if (abort.signal.aborted) return;
      const mine = example ? page.items.find((item) => item.id === example) ?? localPinned : null;
      setPinned(mine);
    }).catch(() => {
      if (!abort.signal.aborted) setPinned(localPinned);
    });
    return () => abort.abort();
  }, [current, example, scope, localPinned]);

  const activePinned = pinned?.id === example ? pinned : localPinned;
  const featured = playing ?? activePinned;

  useEffect(() => { setPlaying(null); }, [current]);

  const groups = useMemo(() => ["All", ...new Set(activeEntries.map((entry) => entry.group))], [activeEntries]);
  const activeGroup = groups.includes(group) ? group : "All";
  const needle = normalizeSearch(query).toLowerCase();
  const visible = useMemo(() => {
    const haystacks = searchHaystackByScope[scope];
    const filtered = activeEntries.filter((entry) => {
      if (activeGroup !== "All" && entry.group !== activeGroup) return false;
      if (!needle) return true;
      const haystack = haystacks[entry.id] ?? `${entry.name} ${entry.group} ${entry.description}`.toLowerCase();
      return haystack.includes(needle);
    });
    const currentIdx = filtered.findIndex((entry) => entry.id === current);
    if (currentIdx > 0) {
      return [filtered[currentIdx]!, ...filtered.slice(0, currentIdx), ...filtered.slice(currentIdx + 1)];
    }
    return filtered;
  }, [activeEntries, activeGroup, needle, scope, current]);

  const open = (id: string | null) => { setGroup("All"); setQuery(""); setDetail(id); if (!dialog.current?.open) dialog.current?.showModal(); };
  const close = () => dialog.current?.close();
  const choose = (id: string, template?: string) => { pick(id, template); close(); };

  return <div className={compact ? "style-library sp sp-compact" : "style-library sp"}>
    {compact ? <div className="sp-row" aria-live="polite">
      <span className="sp-row-thumb"><Clip key={featured?.id ?? chosen.id} style={featured ? { ...chosen, preview: featured.preview } : chosen} live /></span>
      <span className="sp-row-name"><small>Visual style</small><b>{activePinned?.name ?? featured?.name ?? chosen.name}</b></span>
      <button type="button" className="sp-browse" onClick={() => open(scope === "film" ? null : current)} aria-haspopup="dialog">Change</button>
    </div> : <>
    <div className="sp-head"><b>Visual style</b><button type="button" className="sp-browse" onClick={() => open(scope === "film" ? null : current)} aria-haspopup="dialog">Change style →</button></div>

    <div className="sp-current" aria-live="polite">
      <div className="sp-current-thumb"><Clip key={featured?.id ?? chosen.id} style={featured ? { ...chosen, preview: featured.preview } : chosen} live />{featured && <span className="sp-now">{featured.id === activePinned?.id ? `Your template · ${featured.name}` : featured.name}</span>}</div>
      <div className="sp-current-body">
        <span className="sp-tag">{activePinned ? `Selected · from ${activePinned.name}` : `Selected · ${selected.group}`}</span>
        <h3>{chosen.name}</h3>
        <p>{scope === "film" ? chosen.description : `${chosen.description} Your brand sets the colors and fonts.`}</p>
        {selected.renderMode === "generated" && scope !== "film" && <p className="sp-note">Generating material scenes on the storyboard produces this style. The preview is a layout draft, and generation needs a confirmed budget. Product screenshots and text stay crisp.</p>}
        <details><summary>Style direction &amp; references</summary>
          <p>{selected.instructions.image}</p><p>{selected.instructions.motion}</p>
          {selected.referenceAssets.map((asset) => <a key={asset} href={`/previews/looks/references/${asset}`} target="_blank" rel="noreferrer"><img src={`/previews/looks/references/${asset}`} alt={`${selected.group} source style reference sheet`} loading="lazy" /><span>Open reference image</span></a>)}
        </details>
      </div>
    </div>
    </>}

    <dialog ref={dialog} className="theme-dialog" aria-labelledby="style-dialog-title" onClose={() => setDetail(null)} onClick={(event) => { if (event.target === dialog.current) close(); }}>
      {detail
        ? <StyleDetail key={`${scope}:${detail}`} style={style(detail)} current={detail === current} scope={scope} back={() => setDetail(null)} close={close} choose={choose} />
        : <div className="theme-dialog-inner">
          <header className="theme-dialog-header">
            <div>
              <span className="eyebrow">{activeEntries.length} {activeEntries.length === 1 ? "style" : "styles"}</span>
              <h2 id="style-dialog-title">Choose a visual style</h2>
              <p>{scope === "film" ? "Choose an educational explainer or illustrated story style for your film. Open any style to see examples made in it." : "Open a style to see every example made in it. Your brand still sets the colours and fonts."}</p>
            </div>
            <button type="button" className="theme-close" onClick={close} aria-label="Close style browser">✕</button>
          </header>
          <div className="sp-tools">
            <input className="gallery-search" type="search" value={query} placeholder="Search styles" aria-label="Search styles" onChange={(event) => setQuery(event.target.value)} />
            <div className="style-filters" aria-label="Filter visual styles">{groups.map((name) => <button type="button" key={name} aria-pressed={activeGroup === name} style={activeGroup === name ? { background: "var(--blue, #168bff)", borderColor: "var(--blue, #168bff)", color: "#fff" } : undefined} onClick={() => setGroup(name)}>{name}</button>)}</div>
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
function StyleDetail({ style, current, scope = "all", back, close, choose }: { style: GalleryStyleCard; current: boolean; scope?: GalleryScope; back: () => void; close: () => void; choose: (id: string, template?: string) => void }) {
  const [useCase, setUseCase] = useState<GalleryUseCase | "all">("all");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<GalleryCard[]>([]);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);
  const activeAbort = useRef<AbortController | null>(null);

  const load = useCallback(async (cursor: string | null) => {
    const request = ++latest.current;
    activeAbort.current?.abort();
    const abort = new AbortController();
    activeAbort.current = abort;
    if (!cursor) {
      setItems([]);
      setNext(null);
    }
    setLoading(true);
    setFailed(false);
    try {
      let page = await listGalleryTemplates({ look: style.id, useCase, q: query, cursor, limit: PAGE, scope }, abort.signal);
      if (request !== latest.current || abort.signal.aborted) return;
      if (
        scope === "film" &&
        ((page.counts.saas ?? 0) > 0 ||
          (page.counts.brand ?? 0) > 0 ||
          (page.counts.colour ?? 0) > 0 ||
          page.items.some((item) => item.useCase !== "explain" && item.useCase !== "story"))
      ) {
        page = queryGallery({
          look: style.id,
          useCase: useCase === "all" ? undefined : useCase,
          q: query,
          cursor: cursor ?? undefined,
          limit: PAGE,
          scope: "film",
          plates: true
        });
      }
      setItems((known) => cursor ? [...known, ...page.items.filter((item) => !known.some((have) => have.id === item.id))] : page.items);
      setNext(page.nextCursor); setCounts(page.counts); setTotal(page.total); setFailed(false);
    } catch {
      if (request === latest.current && !abort.signal.aborted) setFailed(true);
    } finally {
      if (request === latest.current && !abort.signal.aborted) setLoading(false);
    }
  }, [style.id, useCase, query, scope]);

  useEffect(() => {
    void load(null);
    return () => activeAbort.current?.abort();
  }, [load]);

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
  const showDetailSearch = style.examples > 1 || (counts?.all ?? 0) > 1 || Boolean(query);

  return <div className="theme-dialog-inner sp-detail-inner">
    <header className="theme-dialog-header">
      <div><button type="button" className="sp-back" onClick={back}>← All styles</button><span className="eyebrow">{style.group}</span><h2 id="style-dialog-title">{style.name}</h2><p>{style.description}</p></div>
      <button type="button" className="theme-close" onClick={close} aria-label="Close style browser">✕</button>
    </header>
    <div className="sp-detail-bar">
      <button type="button" className="primary-button" onClick={() => choose(style.id, current ? undefined : (items[0]?.id ?? style.defaultExample))}>{current ? "Keep this style" : "Use this style"}</button>
      {counts && tabs.length > 0 && <div className="filter-tabs" role="group" aria-label="What the video is for">
        <button type="button" className={useCase === "all" ? "selected" : ""} aria-pressed={useCase === "all"} onClick={() => setUseCase("all")}>All <span>{counts.all}</span></button>
        {tabs.map((entry) => <button type="button" key={entry.id} className={useCase === entry.id ? "selected" : ""} aria-pressed={useCase === entry.id} onClick={() => setUseCase(entry.id)}>{entry.label} <span>{counts[entry.id]}</span></button>)}
      </div>}
      {showDetailSearch && <input className="gallery-search" style={{ margin: 0, marginLeft: "auto" }} type="search" value={query} placeholder="Search examples" aria-label="Search examples" onChange={(event) => setQuery(event.target.value)} />}
    </div>
    {failed ? <p className="sp-empty" role="alert">Examples could not be loaded. <button type="button" className="secondary-button" onClick={() => void load(null)}>Try again</button></p>
      : !loading && total === 0 ? <p className="sp-empty" role="status">{normalizeSearch(query) ? `No example matches "${normalizeSearch(query)}".` : scope === "film" ? "No compatible film examples in this style yet." : "No examples in this style yet. You can still use it: your video is created in this style."}</p>
      : <div ref={scroller} className={`sp-examples${loading && items.length ? " is-loading" : ""}`} aria-busy={loading || undefined}>
        {items.map((item) => <GalleryCardView key={item.id} item={item} action="Use this style" onUse={() => choose(style.id, item.id)} />)}
        {loading && Array.from({ length: items.length ? 4 : 8 }, (_, index) => <article className="gallery-card gallery-skeleton" key={`s${index}`} aria-hidden="true"><span className="gallery-media" /><div className="gallery-body"><i /><i /><i className="short" /></div></article>)}
        {next && <div ref={sentinel} className="sp-sentinel"><button type="button" className="secondary-button" disabled={loading} onClick={() => void load(next)}>{loading ? "Loading…" : `Show more (${total - items.length} left)`}</button></div>}
      </div>}
  </div>;
}
