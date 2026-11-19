"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { appHref } from "../lib/hosts";
import { startHref } from "./template-gallery";

/**
 * Homepage proof-of-output sections: a reels row and a results gallery.
 * Every clip is a real Greedy Motion render, re-encoded small and served from /showcase (no remote URLs).
 * Videos stay posters until they scroll into view; only the ones on screen play, and nothing plays under reduced motion.
 */

type Reel = { id: string; template: string; src: string; title: string; style: string };
type Result = { id: string; src: string; title: string; kind: string; prompt: string };

const REELS: Reel[] = [
  { id: "illus-balloon", template: "story-illus-balloon", src: "/showcase/reels/illus-balloon", title: "Hot-air balloon story", style: "Storybook illustration" },
  { id: "illus-blueprint", template: "story-illus-blueprint", src: "/showcase/reels/illus-blueprint", title: "How it's built", style: "Blueprint" },
  { id: "illus-coloured-pencil", template: "story-illus-coloured-pencil", src: "/showcase/reels/illus-coloured-pencil", title: "Sketchbook tale", style: "Coloured pencil" },
  { id: "illus-fox", template: "story-illus-fox", src: "/showcase/reels/illus-fox", title: "Fox in the forest", style: "Flat illustration" },
  { id: "illus-embroidery", template: "story-illus-embroidery", src: "/showcase/reels/illus-embroidery", title: "Stitched story", style: "Embroidery" },
  { id: "illus-flat-vector", template: "story-illus-flat-vector", src: "/showcase/reels/illus-flat-vector", title: "Explainer in flat vector", style: "Flat vector" }
];

const RESULTS: Result[] = [
  { id: "code-diff-reveal", src: "/showcase/reels/code-diff-reveal", title: "Code walkthrough", kind: "Dev explainer", prompt: "Show what changed in our refactor" },
  { id: "feature-spotlight", src: "/showcase/results/feature-spotlight", title: "Feature spotlight", kind: "Product demo", prompt: "Show off our new dashboard" },
  { id: "stat-highlight", src: "/showcase/results/stat-highlight", title: "Stat highlight", kind: "Data moment", prompt: "72% of launch videos are watched muted" },
  { id: "whats-new", src: "/showcase/results/whats-new", title: "What's new", kind: "Release notes", prompt: "Changelog for v2.4" },
  { id: "product-launch", src: "/showcase/results/product-launch", title: "Product launch", kind: "Launch video", prompt: "Announce auto-captions" },
  { id: "narrated-product-minute", src: "/showcase/results/narrated-product-minute", title: "Narrated explainer", kind: "Voiceover", prompt: "Who is this app for?" },
  { id: "about-us-story", src: "/showcase/results/about-us-story", title: "Brand story", kind: "About us", prompt: "Our bakery's first year" },
  { id: "timeline-infographic", src: "/showcase/results/timeline-infographic", title: "Timeline", kind: "Infographic", prompt: "Four steps forward" }
];

/** The studio opens a template from /studio?template=<id>; visitors who are not signed in go through sign-up and come back to that same URL (the auth page and callback accept only same-origin relative paths). */
const useHref = (signedIn: boolean | null, id: string) => (signedIn ? `/studio?template=${id}` : startHref(id));

function UseThis({ href, label }: { href: string; label: string }) {
  return <Link href={href} className="gm-use" aria-label={label}>Use this</Link>;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A lazy loop: the source is attached only near the viewport and the clip plays only while mostly visible. */
function LoopVideo({ src, title, aspect, fit = "cover", eager = false, threshold = 0.6 }: { src: string; title: string; aspect: string; fit?: "cover" | "contain"; eager?: boolean; threshold?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(eager);
  const [still, setStill] = useState(false);
  const [paused, setPaused] = useState(true);
  const visible = useRef(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setStill(reducedMotion());
    const load = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setNear(true); load.disconnect(); } }, { rootMargin: "300px" });
    load.observe(el);
    const play = new IntersectionObserver(([e]) => {
      const v = video.current;
      visible.current = e.isIntersecting;
      if (!v || reducedMotion()) return;
      if (e.isIntersecting) v.play().catch(() => {});
      else v.pause();
    }, { threshold });
    play.observe(el);
    return () => { load.disconnect(); play.disconnect(); };
  }, [threshold]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  };

  return (
    <div ref={wrap} style={{ position: "relative", width: "100%", aspectRatio: aspect, overflow: "hidden", background: "var(--d-bg-ebf5ff)" }}>
      <video
        ref={video}
        muted
        loop
        playsInline
        preload={eager ? "auto" : "none"}
        poster={`${src}.jpg`}
        aria-label={title}
        onLoadedData={() => { if (visible.current && !reducedMotion()) video.current?.play().catch(() => {}); }}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: fit, display: "block" }}
      >
        {near && <source src={`${src}.mp4`} type="video/mp4" />}
      </video>
      {still && (
        <button
          type="button"
          onClick={toggle}
          aria-label={paused ? `Play ${title}` : `Pause ${title}`}
          style={{ position: "absolute", right: 10, bottom: 10, width: 36, height: 36, borderRadius: "50%", border: 0, cursor: "pointer", background: "rgba(10,13,18,.72)", color: "#fff", fontSize: 13 }}
        >
          {paused ? "▶" : "❚❚"}
        </button>
      )}
    </div>
  );
}

const h2Style: React.CSSProperties = { margin: 0, fontWeight: 600, fontSize: "clamp(28px, 3.4vw, 44px)", lineHeight: 1.15, letterSpacing: "-0.03em", maxWidth: 760 };
const subStyle: React.CSSProperties = { margin: 0, fontSize: 16, color: "var(--d-tx-535862)", maxWidth: 620, lineHeight: 1.5 };

type Card = { template: string; src: string; title: string; tag: string; wide: boolean };
const r = (template: string, title: string, tag: string, wide: boolean, dir = "reels"): Card => ({ template, title, tag, wide, src: `/showcase/${dir}/${wide ? template : template.replace("story-", "")}` });

/**
 * Marquee order. The first four are the catalog's curated landing picks (featuredGalleryIds in @videosaas/contracts),
 * tagged "Featured". Production has no trending data of its own (the Trending tab exists only on the unmerged
 * trending-templates branch, with templates this build doesn't have), so nothing here is labelled "Trending".
 */
const FEATURED_CARDS: Card[] = [
  r("product-launch", "Product launch", "Featured", true, "results"),
  r("feature-walkthrough", "Feature walkthrough", "Featured", true),
  r("sketch-explainer", "Sketch explainer", "Featured", true),
  r("whats-new", "What's new", "Featured", true, "results")
];
const MORE_CARDS: Card[] = [
  r("kinetic-quote-stack", "Quote card", "Typography", true),
  r("story-illus-balloon", "Hot-air balloon story", "Crayon story", false),
  r("kinetic-type-explainer", "Kinetic type", "Typography", true),
  r("story-illus-koi", "Koi pond story", "Marker comic", false),
  r("stat-highlight", "Stat highlight", "Data moment", true, "results"),
  r("story-illus-fox", "Fox in the forest", "Cut-paper", false),
  r("story-illus-blueprint", "How it's built", "Blueprint", false),
  r("narrated-product-minute", "Narrated explainer", "Voiceover", true, "results"),
  r("story-illus-lighthouse", "Lighthouse story", "Risograph", false),
  r("bar-chart-race", "Bar chart race", "Data viz", true),
  r("story-illus-embroidery", "Stitched story", "Embroidery", false),
  r("story-illus-paper-craft", "Toy-theatre story", "Paper craft", false),
  r("api-request-flow", "API request flow", "Dev explainer", true),
  r("story-illus-coloured-pencil", "Sketchbook tale", "Coloured pencil", false),
  r("animated-map-route", "Animated map route", "Map", true),
  r("story-illus-low-poly", "Low-poly story", "Low poly", false),
  r("story-illus-flat-vector", "Flat vector explainer", "Flat vector", false)
];
// Cutout tales is staging-only (NEXT_PUBLIC_CUTOUT_TALES is inlined at build time), so its reel is added only where the look exists.
const CUTOUT_CARDS: Card[] = process.env.NEXT_PUBLIC_CUTOUT_TALES === "1" ? [r("cutout-tales-western", "Cutout tales", "New", true)] : [];
const CARDS: Card[] = [...FEATURED_CARDS, ...CUTOUT_CARDS, ...MORE_CARDS];

/**
 * Drives the reels marquee: a slow auto-scroll (one loop of the duplicated track every 140s) that the
 * viewer can grab and drag with a mouse or finger, or push with a horizontal trackpad swipe. Auto-scroll
 * pauses on hover, on keyboard focus and while dragging, and resumes afterwards. A drag never fires the
 * "Use this" link it started on. Under reduced motion it does nothing and the CSS falls back to native scrolling.
 */
function useDragMarquee() {
  const marqueeRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const wrap = marqueeRef.current;
    const track = trackRef.current;
    if (!wrap || !track || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const LOOP_SECONDS = 140;
    const DRAG_THRESHOLD = 5;
    let offset = 0;
    let last = performance.now();
    let raf = 0;
    let hovering = false;
    let focused = false;
    let drag: { id: number; startX: number; startOffset: number; moved: boolean } | null = null;
    let suppressClick = false;
    wrap.dataset.drag = "";

    const half = () => track.scrollWidth / 2;
    const apply = () => {
      const h = half();
      if (h > 0) offset = ((offset % h) - h) % h; // keep within (-h, 0] so the duplicate seam is never seen
      track.style.transform = `translate3d(${offset}px,0,0)`;
    };
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (!drag && !hovering && !focused) offset -= (half() / LOOP_SECONDS) * dt;
      apply();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      suppressClick = false;
      drag = { id: e.pointerId, startX: e.clientX, startOffset: offset, moved: false };
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.startX;
      if (!drag.moved && Math.abs(dx) > DRAG_THRESHOLD) {
        drag.moved = true;
        wrap.dataset.drag = "active";
        try { wrap.setPointerCapture(drag.id); } catch { /* pointer already released */ }
      }
      if (drag.moved) {
        offset = drag.startOffset + dx;
        apply();
      }
    };
    const endDrag = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.moved) suppressClick = true;
      drag = null;
      wrap.dataset.drag = "";
      last = performance.now();
    };
    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    };
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // vertical scrolling stays with the page
      e.preventDefault();
      offset -= e.deltaX;
      apply();
    };
    const onEnter = (e: PointerEvent) => { if (e.pointerType === "mouse") hovering = true; };
    const onLeave = () => { hovering = false; };
    const onFocusIn = () => { focused = true; };
    const onFocusOut = (e: FocusEvent) => { if (!wrap.contains(e.relatedTarget as Node | null)) focused = false; };
    const onDragStart = (e: DragEvent) => e.preventDefault();

    wrap.addEventListener("pointerdown", onPointerDown);
    wrap.addEventListener("pointermove", onPointerMove);
    wrap.addEventListener("pointerup", endDrag);
    wrap.addEventListener("pointercancel", endDrag);
    wrap.addEventListener("click", onClickCapture, true);
    wrap.addEventListener("wheel", onWheel, { passive: false });
    wrap.addEventListener("pointerenter", onEnter);
    wrap.addEventListener("pointerleave", onLeave);
    wrap.addEventListener("focusin", onFocusIn);
    wrap.addEventListener("focusout", onFocusOut);
    wrap.addEventListener("dragstart", onDragStart);
    return () => {
      cancelAnimationFrame(raf);
      wrap.removeEventListener("pointerdown", onPointerDown);
      wrap.removeEventListener("pointermove", onPointerMove);
      wrap.removeEventListener("pointerup", endDrag);
      wrap.removeEventListener("pointercancel", endDrag);
      wrap.removeEventListener("click", onClickCapture, true);
      wrap.removeEventListener("wheel", onWheel);
      wrap.removeEventListener("pointerenter", onEnter);
      wrap.removeEventListener("pointerleave", onLeave);
      wrap.removeEventListener("focusin", onFocusIn);
      wrap.removeEventListener("focusout", onFocusOut);
      wrap.removeEventListener("dragstart", onDragStart);
      delete wrap.dataset.drag;
      track.style.transform = "";
    };
  }, []);
  return { marqueeRef, trackRef };
}

export function ReelsShowcase({ signedIn }: { signedIn: boolean | null }) {
  const cta = signedIn ? appHref("/studio") : appHref("/auth?mode=signup");
  const { marqueeRef, trackRef } = useDragMarquee();
  const item = (c: Card, dup: boolean) => (
    <article key={`${c.template}${dup ? "-dup" : ""}`} aria-hidden={dup || undefined} className={`gm-reel ${c.wide ? "gm-reel-wide" : "gm-reel-sq"}${dup ? " gm-mq-dup" : ""}`}>
      <div className="gm-reel-frame">
        <LoopVideo src={c.src} title={c.title} aspect={c.wide ? "16 / 9" : "1 / 1"} threshold={0.3} />
        <span className={`gm-reel-tag${c.tag === "Featured" ? " gm-reel-tag-hot" : ""}`}>{c.tag}</span>
        <Link href={useHref(signedIn, c.template)} className="gm-use" aria-label={`Use this: ${c.title}`} tabIndex={dup ? -1 : undefined}>Use this</Link>
      </div>
      <strong className="gm-reel-title">{c.title}</strong>
    </article>
  );
  return (
    <section id="reels" aria-labelledby="reels-title" style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 0 24px", scrollMarginTop: 88, display: "flex", flexDirection: "column", gap: 28 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center", textAlign: "center", padding: "0 24px" }}>
        <h2 id="reels-title" style={h2Style}>Made with Greedy Motion.</h2>
        <p style={subStyle}>Motion with code, from one plain-language brief each. Story reels, explainers and ads, finished and ready to post.</p>
      </div>
      <div className="gm-marquee" ref={marqueeRef}>
        <div className="gm-marquee-track" role="list" ref={trackRef}>
          {CARDS.map((c) => item(c, false))}
          {CARDS.map((c) => item(c, true))}
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Link href={cta} className="gm-btn-primary" style={{ padding: "13px 26px", borderRadius: 9999, background: "var(--d-bg-181d27)", color: "var(--d-btn-ink)", fontSize: 15, fontWeight: 500, textDecoration: "none", boxShadow: "0 1px 2px rgba(10,13,18,.8), 0 0 0 1px #0a0d12" }}>
          Make your own
        </Link>
      </div>
      <style>{`
        .gm-marquee{--h:180px;overflow:hidden;padding:8px 0 12px;-webkit-mask-image:linear-gradient(to right,transparent 0,#000 6%,#000 94%,transparent 100%);mask-image:linear-gradient(to right,transparent 0,#000 6%,#000 94%,transparent 100%)}
        @media(max-width:640px){.gm-marquee{--h:150px}}
        .gm-marquee-track{display:flex;width:max-content;will-change:transform}
        .gm-marquee[data-drag]{cursor:grab;touch-action:pan-y;user-select:none;-webkit-user-select:none}
        .gm-marquee[data-drag="active"]{cursor:grabbing}
        .gm-marquee[data-drag] img,.gm-marquee[data-drag] video{-webkit-user-drag:none}
        .gm-reel{flex:none;margin-right:16px;display:flex;flex-direction:column;gap:10px}
        .gm-reel-sq{width:var(--h)}
        .gm-reel-wide{width:calc(var(--h)*16/9)}
        .gm-reel-frame{position:relative;border-radius:20px;overflow:hidden;background:var(--d-bg-ebf5ff);border:1px solid var(--d-bd-e1eaf4);box-shadow:0 14px 20px 4px var(--d-sh-rgba46914408)}
        .gm-reel-tag{position:absolute;left:10px;top:10px;z-index:2;padding:4px 10px;border-radius:9999px;background:var(--d-bg-ffffff);color:var(--d-tx-0a0d12);font-size:12px;font-weight:600}
        .gm-reel-tag-hot{background:var(--d-bg-d3f6e3);color:var(--d-tx-0a5c35)}
        .gm-reel-title{font-size:15px;font-weight:600;letter-spacing:-.01em;color:var(--d-tx-0a0d12)}
        @media(prefers-reduced-motion:reduce){.gm-marquee{overflow-x:auto;padding-left:24px;-webkit-mask-image:none;mask-image:none}.gm-marquee-track{animation:none}.gm-mq-dup{display:none}}
        .gm-use{position:absolute;left:50%;bottom:14px;transform:translate(-50%,6px);z-index:2;padding:10px 20px;border-radius:9999px;background:var(--d-bg-181d27);color:var(--d-btn-ink);font-size:14px;font-weight:500;text-decoration:none;white-space:nowrap;box-shadow:0 1px 2px rgba(10,13,18,.8),0 0 0 1px #0a0d12;opacity:0;transition:opacity 160ms ease,transform 160ms ease}
        .gm-reel-frame:hover .gm-use,.gm-reel-frame:focus-within .gm-use,.gm-result:hover .gm-use,.gm-result:focus-within .gm-use,.gm-use:focus-visible{opacity:1;transform:translate(-50%,0)}
        @media(hover:none){.gm-use{opacity:1;transform:translate(-50%,0)}}
        @media(prefers-reduced-motion:reduce){.gm-use{transition:none}}
      `}</style>
    </section>
  );
}

export function ResultsGallery({ signedIn }: { signedIn: boolean | null }) {
  const cta = signedIn ? appHref("/studio") : appHref("/auth?mode=signup");
  return (
    <section id="results" aria-labelledby="results-title" style={{ maxWidth: 1200, margin: "0 auto", padding: "96px 24px 24px", scrollMarginTop: 40, display: "flex", flexDirection: "column", gap: 36 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center", textAlign: "center" }}>
        <h2 id="results-title" style={h2Style}>Say what you need. Get a finished video.</h2>
        <p style={subStyle}>Describe it, pick a template, and Greedy Motion builds the scenes, motion, music and captions.</p>
      </div>

      <ol className="gm-flow" aria-label="How a video is made">
        <li><span>1</span><div><strong>Your input</strong><small>A brief, URL or screenshots</small></div></li>
        <li aria-hidden className="gm-flow-arrow">→</li>
        <li><span>2</span><div><strong>A template</strong><small>Structure, pacing and style</small></div></li>
        <li aria-hidden className="gm-flow-arrow">→</li>
        <li><span>3</span><div><strong>A finished video</strong><small>1080p MP4, 16:9 or 9:16</small></div></li>
      </ol>

      <div className="gm-results">
        {RESULTS.map((r) => (
          <article key={r.id} className="gm-hover-card gm-result">
            <div style={{ position: "relative" }}>
              <LoopVideo src={r.src} title={r.title} aspect="16 / 9" />
              <UseThis href={useHref(signedIn, r.id)} label={`Use this: ${r.title}`} />
            </div>
            <div className="gm-result-body">
              <span className="gm-result-kind">{r.kind}</span>
              <strong>{r.title}</strong>
              <small>“{r.prompt}”</small>
              <Link href={useHref(signedIn, r.id)}>{signedIn ? "Use this style" : "Try this style"} →</Link>
            </div>
          </article>
        ))}
      </div>
      <style>{`
        .gm-flow{list-style:none;margin:0;padding:0;display:flex;gap:12px;align-items:stretch;justify-content:center;flex-wrap:wrap}
        .gm-flow li:not(.gm-flow-arrow){display:flex;gap:12px;align-items:center;padding:14px 20px;border-radius:9999px;background:var(--d-bg-fafdff);border:1px solid var(--d-bd-e1eaf4);min-width:0}
        .gm-flow li span{flex:none;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:var(--d-bg-cce7ff);color:var(--d-tx-0a0d12);font:600 13px 'DM Mono',monospace}
        .gm-flow strong{display:block;font-size:15px;font-weight:600;color:var(--d-tx-0a0d12)}
        .gm-flow small{display:block;font-size:13px;color:var(--d-tx-535862)}
        .gm-flow-arrow{align-self:center;color:var(--d-tx-535862);font-size:20px}
        @media(max-width:760px){.gm-flow{flex-direction:column;align-items:stretch}.gm-flow-arrow{display:none}.gm-flow li:not(.gm-flow-arrow){border-radius:20px}}
        .gm-results{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px}
        .gm-result{border-radius:28px;overflow:hidden;background:var(--d-bg-fafdff);border:1px solid var(--d-bd-e1eaf4);display:flex;flex-direction:column}
        .gm-result-body{padding:16px 18px 18px;display:flex;flex-direction:column;gap:4px}
        .gm-result-kind{font:600 12px 'DM Mono',monospace;color:var(--d-tx-535862);text-transform:uppercase;letter-spacing:.04em}
        .gm-result-body strong{font-size:18px;font-weight:600;letter-spacing:-.02em;color:var(--d-tx-0a0d12)}
        .gm-result-body small{font-size:14px;color:var(--d-tx-535862);line-height:1.4}
        .gm-result-body a{margin-top:8px;font-size:14px;font-weight:600;color:var(--d-tx-0a6cff);text-decoration:none}
        .gm-result-body a:hover{text-decoration:underline}
      `}</style>
    </section>
  );
}

/** Hero: one finished render in a rounded frame, replacing the old mock player. */
export function HeroVideo() {
  return (
    <div style={{ width: "100%", maxWidth: 880, marginTop: 44, borderRadius: 28, overflow: "hidden", border: "1px solid var(--d-bd-e1eaf4)", boxShadow: "0 24px 48px var(--d-sh-rgba46914408)" }}>
      <LoopVideo src="/showcase/hero/brand-showreel" title="A Greedy Motion showreel made from a single brief" aspect="16 / 9" eager threshold={0.2} />
    </div>
  );
}

const WALKTHROUGH_ID = "Loa3mTbpLF4";

/** A click-to-load YouTube facade: just a poster until clicked, so the page doesn't pull the player's scripts up front. */
export function Walkthrough() {
  const [play, setPlay] = useState(false);
  return (
    <section id="walkthrough" aria-labelledby="walkthrough-title" style={{ maxWidth: 880, margin: "0 auto", padding: "72px 24px 24px", scrollMarginTop: 88, display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", textAlign: "center" }}>
        <h2 id="walkthrough-title" style={{ ...h2Style, fontSize: "clamp(24px, 2.8vw, 34px)" }}>See it in action</h2>
        <p style={subStyle}>A quick walkthrough: brief in, finished video out.</p>
      </div>
      <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", borderRadius: 28, overflow: "hidden", border: "1px solid var(--d-bd-e1eaf4)", background: "var(--d-bg-181d27)", boxShadow: "0 14px 20px 4px var(--d-sh-rgba46914408)" }}>
        {play ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${WALKTHROUGH_ID}?autoplay=1&rel=0`}
            title="Greedy Motion walkthrough: how to make a video"
            loading="lazy"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
          />
        ) : (
          <button type="button" onClick={() => setPlay(true)} aria-label="Play the Greedy Motion walkthrough video" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", padding: 0, border: 0, cursor: "pointer", background: "transparent" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`https://i.ytimg.com/vi/${WALKTHROUGH_ID}/maxresdefault.jpg`} alt="" loading="lazy" width={1280} height={720} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
            <span aria-hidden style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: 72, height: 72, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--d-bg-181d27)", color: "var(--d-btn-ink)", fontSize: 24, boxShadow: "0 1px 2px rgba(10,13,18,.8), 0 0 0 1px #0a0d12, 0 14px 28px rgba(10,13,18,.35)" }}>▶</span>
          </button>
        )}
      </div>
    </section>
  );
}

type Clip = { template: string; src: string; title: string; ratio: string };
const COLLAGE: Clip[] = [
  ...REELS.map((r) => ({ template: r.template, src: r.src, title: r.title, ratio: "4 / 5" })),
  ...RESULTS.map((r) => ({ template: r.id, src: r.src, title: r.title, ratio: "16 / 10" }))
];
const COLUMN_ORDER = [
  ["story-illus-balloon", "code-diff-reveal", "story-illus-fox", "stat-highlight"],
  ["feature-spotlight", "story-illus-blueprint", "whats-new", "story-illus-embroidery"]
];

/**
 * Sign-in side panel: two columns of real renders drifting in opposite directions, a seamless loop (each list is
 * rendered twice and the track moves by exactly half). Fills its positioned parent and never sizes it. A template the
 * visitor picked on the homepage leads the first column. Reduced motion: a static set of posters.
 */
export function AuthCollage({ featured }: { featured?: string }) {
  const byId = new Map(COLLAGE.map((c) => [c.template, c]));
  const lead = featured ? byId.get(featured) : undefined;
  const cols = COLUMN_ORDER.map((ids, ci) => {
    const list = ids.filter((id) => id !== lead?.template).map((id) => byId.get(id)).filter((c): c is Clip => !!c);
    return ci === 0 && lead ? [lead, ...list.slice(0, 3)] : list;
  });
  const card = (c: Clip, key: string, dup: boolean) => (
    <div key={key} aria-hidden={dup || undefined} className={dup ? "gm-mq-dup" : undefined} style={{ marginBottom: 14, borderRadius: 20, overflow: "hidden", boxShadow: "0 18px 36px rgba(0,0,0,.45)", border: "1px solid rgba(255,255,255,.1)" }}>
      <LoopVideo src={c.src} title={c.title} aspect={c === lead ? "1 / 1" : c.ratio} />
    </div>
  );
  return (
    <div className="gm-collage" aria-hidden style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      {cols.map((col, ci) => (
        <div key={ci} style={{ minHeight: 0, overflow: "hidden" }}>
          <div className={`gm-mq ${ci ? "gm-mq-down" : "gm-mq-up"}`} style={{ animationDuration: ci ? "48s" : "58s", willChange: "transform" }}>
            {col.map((c) => card(c, c.template, false))}
            {col.map((c) => card(c, `${c.template}-dup`, true))}
          </div>
        </div>
      ))}
      <style>{`
        .gm-collage{-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 14%,#000 86%,transparent 100%);mask-image:linear-gradient(to bottom,transparent 0,#000 14%,#000 86%,transparent 100%)}
        .gm-mq{animation:gm-mq-up linear infinite}
        .gm-mq-down{animation-name:gm-mq-down}
        .gm-mq-up{animation-name:gm-mq-up}
        .gm-collage:hover .gm-mq{animation-play-state:paused}
        @keyframes gm-mq-up{from{transform:translate3d(0,0,0)}to{transform:translate3d(0,-50%,0)}}
        @keyframes gm-mq-down{from{transform:translate3d(0,-50%,0)}to{transform:translate3d(0,0,0)}}
        @media(prefers-reduced-motion:reduce){.gm-mq{animation:none}.gm-mq-dup{display:none}}
      `}</style>
    </div>
  );
}
