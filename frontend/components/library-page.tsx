"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listLibrary, projectScreenshotUrl, type LibraryItem } from "../lib/api";
import { useMediaToken } from "../lib/use-media-token";
import { AppShell } from "./app-shell";

const PAGE = 24;

/** The Library page: screenshots from every project, newest first. The backend pages them, so the browser only ever holds
 *  the pages it has shown, however large the library grows. */
export function LibraryPage() {
  useMediaToken();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);

  const load = useCallback(async (cursor: string | null) => {
    const request = ++latest.current;
    if (cursor) setMore(true); else setLoading(true);
    try {
      const page = await listLibrary({ cursor, limit: PAGE });
      if (request !== latest.current) return;
      setItems((current) => cursor ? [...current, ...page.items.filter((item) => !current.some((known) => known.id === item.id))] : page.items);
      setTotal(page.total); setNext(page.nextCursor); setFailed(false);
    } catch { if (request === latest.current) setFailed(true); }
    finally { if (request === latest.current) { setLoading(false); setMore(false); } }
  }, []);
  useEffect(() => { void load(null); }, [load]);

  return <AppShell active="library">
    <section className="page-container">
      <div className="page-heading"><div><h1>Library</h1><p>Reusable assets for every project in this workspace.</p></div></div>
      <div className="filter-tabs"><button className="selected">Screenshots {!loading && <span>{total}</span>}</button></div>
      {failed ? <div className="workspace-error" role="alert">The library could not be loaded. <button onClick={() => void load(null)}>Try again</button></div>
        : loading ? <div className="library-grid" aria-busy="true">{Array.from({ length: 8 }, (_, index) => <article key={index} className="gallery-skeleton"><span className="asset-image" /><i /><i className="short" /></article>)}</div>
        : items.length === 0 ? <div className="empty-workspace"><b>Your library is empty.</b><p>Uploaded screenshots appear here automatically.</p></div>
        : <div className="library-grid">{items.map((item) => <article key={`${item.projectId}-${item.id}`}><img className="asset-image" src={projectScreenshotUrl(item.projectId, item.id)} alt="" loading="lazy" decoding="async" /><b>{item.name}</b><small>{item.width} × {item.height} · {item.projectName}</small></article>)}</div>}
      {next && !loading && <div className="gallery-more"><button className="secondary-button" disabled={more} onClick={() => void load(next)}>{more ? "Loading…" : `Show more (${total - items.length} left)`}</button></div>}
    </section>
  </AppShell>;
}
