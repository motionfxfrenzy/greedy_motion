"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { appHref } from "../lib/hosts";

/**
 * Homepage proof-of-output sections: a reels row and a results gallery.
 * Every clip is a real Greedy Motion render, re-encoded small and served from /showcase (no remote URLs).
 * Videos stay posters until they scroll into view; only the ones on screen play, and nothing plays under reduced motion.
 */

type Reel = { id: string; src: string; title: string; style: string };
type Result = { id: string; src: string; title: string; kind: string; prompt: string };

const REELS: Reel[] = [
  { id: "illus-balloon", src: "/showcase/reels/illus-balloon", title: "Hot-air balloon story", style: "Storybook illustration" },
  { id: "illus-blueprint", src: "/showcase/reels/illus-blueprint", title: "How it's built", style: "Blueprint" },
  { id: "illus-coloured-pencil", src: "/showcase/reels/illus-coloured-pencil", title: "Sketchbook tale", style: "Coloured pencil" },
  { id: "illus-fox", src: "/showcase/reels/illus-fox", title: "Fox in the forest", style: "Flat illustration" },
  { id: "illus-embroidery", src: "/showcase/reels/illus-embroidery", title: "Stitched story", style: "Embroidery" },
  { id: "illus-flat-vector", src: "/showcase/reels/illus-flat-vector", title: "Explainer in flat vector", style: "Flat vector" }
];

const RESULTS: Result[] = [
  { id: "product-spin-ad", src: "/showcase/results/product-spin-ad", title: "Product ad", kind: "Social ad", prompt: "Launch ad for our sparkling drink" },
  { id: "feature-spotlight", src: "/showcase/results/feature-spotlight", title: "Feature spotlight", kind: "Product demo", prompt: "Show off our new dashboard" },
  { id: "stat-highlight", src: "/showcase/results/stat-highlight", title: "Stat highlight", kind: "Data moment", prompt: "72% of launch videos are watched muted" },
  { id: "whats-new", src: "/showcase/results/whats-new", title: "What's new", kind: "Release notes", prompt: "Changelog for v2.4" },
  { id: "product-launch", src: "/showcase/results/product-launch", title: "Product launch", kind: "Launch video", prompt: "Announce auto-captions" },
  { id: "narrated-product-minute", src: "/showcase/results/narrated-product-minute", title: "Narrated explainer", kind: "Voiceover", prompt: "Who is this app for?" },
  { id: "about-us-story", src: "/showcase/results/about-us-story", title: "Brand story", kind: "About us", prompt: "Our bakery's first year" },
  { id: "timeline-infographic", src: "/showcase/results/timeline-infographic", title: "Timeline", kind: "Infographic", prompt: "Four steps forward" }
];

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

export function ReelsShowcase({ signedIn }: { signedIn: boolean | null }) {
  const cta = signedIn ? appHref("/studio") : appHref("/auth?mode=signup");
  return (
    <section id="reels" aria-labelledby="reels-title" style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 24px 24px", scrollMarginTop: 88, display: "flex", flexDirection: "column", gap: 28 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center", textAlign: "center" }}>
        <h2 id="reels-title" style={h2Style}>Made with Greedy Motion.</h2>
        <p style={subStyle}>Real renders from one brief each. Story reels, explainers and ads, finished and ready to post.</p>
      </div>
      <div className="gm-reels" role="list">
        {REELS.map((r, i) => (
          <article key={r.id} role="listitem" className="gm-reel">
            <div className="gm-reel-frame">
              {/* Blurred poster fills the 9:16 frame; the clip sits uncropped in the middle. */}
              <div aria-hidden className="gm-reel-bg" style={{ backgroundImage: `url(${r.src}.jpg)` }} />
              <div style={{ position: "absolute", left: 0, right: 0, top: "50%", transform: "translateY(-50%)" }}>
                <LoopVideo src={r.src} title={r.title} aspect="1 / 1" eager={i < 2} />
              </div>
              <span className="gm-reel-tag">{r.style}</span>
            </div>
            <strong className="gm-reel-title">{r.title}</strong>
          </article>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Link href={cta} className="gm-btn-primary" style={{ padding: "13px 26px", borderRadius: 9999, background: "var(--d-bg-181d27)", color: "var(--d-btn-ink)", fontSize: 15, fontWeight: 500, textDecoration: "none", boxShadow: "0 1px 2px rgba(10,13,18,.8), 0 0 0 1px #0a0d12" }}>
          Make your own
        </Link>
      </div>
      <style>{`
        .gm-reels{display:flex;gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;padding:4px 2px 12px;scrollbar-width:thin}
        .gm-reel{flex:0 0 clamp(170px,22vw,230px);scroll-snap-align:start;display:flex;flex-direction:column;gap:10px}
        .gm-reel-frame{position:relative;aspect-ratio:9/16;border-radius:28px;overflow:hidden;background:var(--d-bg-ebf5ff);border:1px solid var(--d-bd-e1eaf4);box-shadow:0 14px 20px 4px var(--d-sh-rgba46914408)}
        .gm-reel-bg{position:absolute;inset:-20px;background-size:cover;background-position:center;filter:blur(22px) saturate(1.1);opacity:.85}
        .gm-reel-tag{position:absolute;left:10px;top:10px;padding:4px 10px;border-radius:9999px;background:var(--d-bg-ffffff);color:var(--d-tx-0a0d12);font-size:12px;font-weight:600}
        .gm-reel-title{font-size:15px;font-weight:600;letter-spacing:-.01em;color:var(--d-tx-0a0d12)}
        @media(min-width:1100px){.gm-reels{justify-content:center;overflow-x:visible;flex-wrap:nowrap}.gm-reel{flex:1 1 0;min-width:0}}
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
            <LoopVideo src={r.src} title={r.title} aspect="16 / 9" />
            <div className="gm-result-body">
              <span className="gm-result-kind">{r.kind}</span>
              <strong>{r.title}</strong>
              <small>“{r.prompt}”</small>
              <Link href={cta}>{signedIn ? "Use this style" : "Try this style"} →</Link>
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
