"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { SceneFrame, type SceneItem } from "./scene-frame";

const SCENES: SceneItem[] = [
  { kind: "hook", headline: "Finally see what every sale is really worth.", copy: "" },
  { kind: "problem", headline: "Fees, refunds, and shipping hide your actual margin.", copy: "Most dashboards stop at revenue." },
  { kind: "product", headline: "Smart Profit Dashboard", copy: "", shot: "profit-dashboard.png" },
  { kind: "benefit", headline: "See real profitability at a glance.", copy: "Tracks fees, refunds, shipping, and margin in one dashboard." },
  { kind: "cta", headline: "See your real margins", copy: "acme.com/profit" }
];

const WORDS = ["product launches", "feature demos", "release notes", "social clips"];

const LOGOS = [
  "Northwind",
  "Acme",
  "Lumen",
  "Halcyon",
  "Brightpath",
  "Fieldnote",
  "Orbit Labs",
  "Quarry",
  "Tessellate",
  "Waypoint"
];

const QUOTES = [
  {
    quote: "We used to wait two weeks for a launch video. Now marketing ships it with the release.",
    name: "Priya N.",
    role: "Head of Product Marketing"
  },
  {
    quote: "The storyboard step is the reason our brand team trusts it.",
    name: "Marcus L.",
    role: "Brand Director"
  },
  {
    quote: "I open the same project in Studio, tweak two keyframes, and publish it as our template.",
    name: "Mara C.",
    role: "Motion Designer"
  },
  {
    quote: "Ask-to-change shows me exactly what will move. No surprises.",
    name: "Jonah R.",
    role: "Growth Lead"
  },
  {
    quote: "Render status is honest. When a screenshot fails, it tells me which one.",
    name: "Elena S.",
    role: "Content Ops"
  }
];

const FAQS = [
  {
    q: "Do I need video-editing skills?",
    a: "No. The guided flow asks for a goal, a short brief, and screenshots. Pros can open the same project in Studio."
  },
  {
    q: "Will it change my video without asking?",
    a: "Never. Every requested change comes back as a proposal with a before and after. You accept or reject it."
  },
  {
    q: "What formats can I export?",
    a: "MP4 in 16:9 and 9:16 today. Square 1:1 is coming soon."
  },
  {
    q: "Is there a free trial?",
    a: "Yes. Try it free for 14 days, no credit card required."
  }
];

const HOW_STEPS = [
  {
    n: "01",
    title: "Choose a goal",
    body: "Launch, feature spotlight, what’s new, or a stat. Length and format come recommended.",
    bg: "#F1E6FF"
  },
  {
    n: "02",
    title: "Add screenshots and copy",
    body: "A short structured brief and your real product screenshots.",
    bg: "#CCE7FF"
  },
  {
    n: "03",
    title: "Review the storyboard",
    body: "Five scenes before anything renders. Edit copy, timing, and motion safely.",
    bg: "#D3F6E3"
  },
  {
    n: "04",
    title: "Approve and download",
    body: "Render a draft, request changes, approve the final, download the MP4.",
    bg: "#FFF2BE"
  }
];

const STUDIO_TRACKS = [
  { l: "0%", w: "30%", c: "#168BFF" },
  { l: "26%", w: "40%", c: "#9ECBFF" },
  { l: "34%", w: "22%", c: "#FF5A1F" },
  { l: "60%", w: "38%", c: "#E4CCFF" }
];

export function LandingPage() {
  const [t, setT] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [activeFaq, setActiveFaq] = useState<number | null>(0);
  const [proposalState, setProposalState] = useState<"pending" | "accepted" | "rejected">("pending");

  // Timer loop for auto-playing scenes and word rotation
  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      setT((prev) => prev + 1);
    }, 250);
    return () => clearInterval(timer);
  }, [isPlaying]);

  const sceneIndex = Math.floor(t / 10) % 5;
  const wordIndex = Math.floor(t / 24) % WORDS.length;
  const currentWord = WORDS[wordIndex];
  const heroPct = `${((t % 10) / 10) * 100}%`;
  const activeScene = SCENES[sceneIndex];

  return (
    <div style={{ position: "relative", minHeight: "100vh", overflowX: "clip", background: "#ebf5ff", color: "#0a0d12" }}>
      {/* Dynamic Keyframe & Hover Styles */}
      <style>{`
        @keyframes gmDriftA {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(-10vw, 6vh) scale(1.12); }
        }
        @keyframes gmDriftB {
          0% { transform: translate(0, 0) scale(1.08); }
          100% { transform: translate(8vw, -5vh) scale(.94); }
        }
        @keyframes gmDriftC {
          0% { transform: translate(0, 0); }
          100% { transform: translate(5vw, 8vh); }
        }
        @keyframes gmFloat {
          0%, 100% { transform: translateY(0) rotate(var(--r, 0deg)); }
          50% { transform: translateY(-12px) rotate(var(--r, 0deg)); }
        }
        @keyframes gmMarquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes gmWord {
          0% { opacity: 0; transform: translateY(.35em); filter: blur(6px); }
          100% { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
        .gm-hover-card {
          transition: transform 380ms cubic-bezier(.16, 1, .3, 1), box-shadow 380ms cubic-bezier(.16, 1, .3, 1);
        }
        .gm-hover-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 16px 28px -4px rgba(4, 69, 144, .12);
        }
        .gm-btn-primary {
          transition: all 200ms ease;
        }
        .gm-btn-primary:hover {
          background: #2a3142 !important;
          transform: translateY(-1px);
        }
        .gm-btn-light {
          transition: all 200ms ease;
        }
        .gm-btn-light:hover {
          background: #eef5fc !important;
          transform: translateY(-1px);
        }
      `}</style>

      {/* Ambient drifting background blobs */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          pointerEvents: "none",
          overflow: "hidden"
        }}
      >
        <div
          style={{
            position: "absolute",
            width: "52vw",
            height: "52vw",
            right: "-14vw",
            top: "-20vw",
            borderRadius: "50%",
            filter: "blur(60px)",
            background: "radial-gradient(circle, rgba(158,203,255,.85), rgba(158,203,255,0) 70%)",
            animation: "gmDriftA 24s ease-in-out infinite alternate"
          }}
        />
        <div
          style={{
            position: "absolute",
            width: "40vw",
            height: "40vw",
            left: "-14vw",
            top: "20vh",
            borderRadius: "50%",
            filter: "blur(60px)",
            background: "radial-gradient(circle, rgba(228,204,255,.7), rgba(228,204,255,0) 70%)",
            animation: "gmDriftB 30s ease-in-out infinite alternate"
          }}
        />
        <div
          style={{
            position: "absolute",
            width: "34vw",
            height: "34vw",
            right: "12vw",
            bottom: "-18vw",
            borderRadius: "50%",
            filter: "blur(60px)",
            background: "radial-gradient(circle, rgba(255,209,184,.6), rgba(255,209,184,0) 70%)",
            animation: "gmDriftC 34s ease-in-out infinite alternate"
          }}
        />
        <div
          style={{
            position: "absolute",
            width: "26vw",
            height: "26vw",
            left: "30vw",
            top: "45vh",
            borderRadius: "50%",
            filter: "blur(60px)",
            background: "radial-gradient(circle, rgba(211,246,227,.7), rgba(211,246,227,0) 70%)",
            animation: "gmDriftA 40s ease-in-out infinite alternate-reverse"
          }}
        />
      </div>

      <div style={{ position: "relative", zIndex: 1 }}>
        {/* Sticky Header Navigation */}
        <header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 30,
            display: "flex",
            justifyContent: "center",
            padding: "14px 20px"
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "1200px",
              display: "flex",
              alignItems: "center",
              gap: "24px",
              padding: "10px 14px 10px 18px",
              borderRadius: "9999px",
              background: "rgba(250,253,255,.78)",
              backdropFilter: "blur(18px) saturate(1.3)",
              WebkitBackdropFilter: "blur(18px) saturate(1.3)",
              boxShadow: "0 14px 24px 4px rgba(4,69,144,.07)",
              border: "1px solid rgba(225,234,244,.7)"
            }}
          >
            <Link
              href="#top"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "9px",
                textDecoration: "none"
              }}
            >
              <img
                src="/brand/gm-mark.svg"
                alt="Greedy Motion"
                style={{ height: "26px", width: "auto", display: "block" }}
              />
              <span
                style={{
                  display: "flex",
                  gap: "5px",
                  fontSize: "17px",
                  fontWeight: 700,
                  letterSpacing: "-.02em",
                  whiteSpace: "nowrap"
                }}
              >
                <span style={{ color: "#0B1F4D" }}>Greedy</span>
                <span style={{ color: "#0A6CFF" }}>Motion</span>
              </span>
            </Link>

            <nav
              style={{
                display: "flex",
                gap: "22px",
                marginLeft: "12px"
              }}
            >
              <a
                href="#how"
                style={{
                  color: "#535862",
                  fontSize: "15px",
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  textDecoration: "none",
                  transition: "color 180ms ease"
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#0a0d12")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#535862")}
              >
                How it works
              </a>
              <a
                href="#features"
                style={{
                  color: "#535862",
                  fontSize: "15px",
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  textDecoration: "none",
                  transition: "color 180ms ease"
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#0a0d12")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#535862")}
              >
                Features
              </a>
              <a
                href="#pricing"
                style={{
                  color: "#535862",
                  fontSize: "15px",
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  textDecoration: "none",
                  transition: "color 180ms ease"
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#0a0d12")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#535862")}
              >
                Pricing
              </a>
              <Link
                href="/coming-soon"
                style={{
                  color: "#0A6CFF",
                  fontSize: "15px",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  textDecoration: "none"
                }}
              >
                Coming soon
              </Link>
            </nav>

            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "10px" }}>
              <Link
                href="/coming-soon"
                style={{
                  padding: "9px 16px",
                  color: "#0a0d12",
                  fontSize: "15px",
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  textDecoration: "none"
                }}
              >
                Coming soon
              </Link>
              <Link
                href="/coming-soon"
                className="gm-btn-primary"
                style={{
                  padding: "9px 20px",
                  borderRadius: "9999px",
                  background: "#181d27",
                  color: "#fff",
                  fontSize: "15px",
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  textDecoration: "none",
                  boxShadow: "0 1px 2px rgba(10,13,18,.8), 0 0 0 1px #0a0d12"
                }}
              >
                View coming soon
              </Link>
            </div>
          </div>
        </header>

        {/* Hero Section */}
        <section
          id="top"
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            padding: "96px 24px 56px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: "22px"
          }}
        >
          {/* Badge */}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "6px 14px 6px 8px",
              borderRadius: "9999px",
              background: "rgba(250,253,255,.88)",
              border: "1px solid rgba(225,234,244,.8)",
              boxShadow: "0 4px 12px rgba(4,69,144,.04)",
              fontSize: "13px",
              fontWeight: 500,
              color: "#535862"
            }}
          >
            <span
              style={{
                padding: "2px 8px",
                borderRadius: "9999px",
                background: "#D3F6E3",
                color: "#0a5c35",
                fontSize: "12px",
                fontWeight: 600
              }}
            >
              New
            </span>
            Ask to change any moment in plain language
          </span>

          {/* Heading with cycling word */}
          <h1
            style={{
              margin: 0,
              fontWeight: 600,
              fontSize: "clamp(38px, 5.2vw, 68px)",
              lineHeight: 1.08,
              letterSpacing: "-0.035em",
              maxWidth: "840px",
              textWrap: "balance"
            }}
          >
            Your{" "}
            <span
              key={currentWord}
              style={{
                display: "inline-block",
                background: "linear-gradient(180deg,#168BFF 11%,#0A6CFF 78%)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
                animation: "gmWord 600ms cubic-bezier(.16,1,.3,1)"
              }}
            >
              {currentWord}
            </span>
            <br />
            don’t need an editor.
          </h1>

          {/* Subtitle */}
          <p
            style={{
              margin: 0,
              fontSize: "17px",
              lineHeight: 1.6,
              color: "#535862",
              maxWidth: "550px",
              textWrap: "pretty"
            }}
          >
            Turn approved screenshots and product messaging into on-brand motion videos.
            Review a storyboard, ask for changes, approve, download.
          </p>

          {/* CTA Buttons */}
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}>
            <Link
              href="/coming-soon"
              className="gm-btn-primary"
              style={{
                padding: "13px 26px",
                borderRadius: "9999px",
                background: "#181d27",
                color: "#fff",
                fontSize: "15px",
                fontWeight: 500,
                textDecoration: "none",
                boxShadow: "0 1px 2px rgba(10,13,18,.8), 0 0 0 1px #0a0d12"
              }}
            >
              See what’s coming
            </Link>
            <a
              href="#how"
              className="gm-btn-light"
              style={{
                padding: "13px 24px",
                borderRadius: "9999px",
                background: "#fafdff",
                color: "#0a0d12",
                fontSize: "15px",
                fontWeight: 500,
                textDecoration: "none",
                border: "1px solid #E1EAF4",
                boxShadow: "0 2px 8px rgba(4,69,144,.05)"
              }}
            >
              See how it works
            </a>
          </div>

          <span style={{ fontSize: "13px", color: "#93979f" }}>
            Free for 14 days · No credit card
          </span>

          {/* Interactive Hero Video Preview Showcase */}
          <div style={{ position: "relative", width: "100%", maxWidth: "880px", marginTop: "44px" }}>
            {/* Floating Tag 1: Brand Kit (Purple) */}
            <div
              style={{
                position: "absolute",
                left: "max(-6%, calc(12px - (100vw - 100%) / 2))",
                top: "10%",
                zIndex: 4,
                padding: "12px 18px",
                borderRadius: "20px",
                background: "#F1E6FF",
                textAlign: "left",
                fontSize: "13px",
                // @ts-expect-error custom prop
                "--r": "-4deg",
                animation: "gmFloat 6s ease-in-out infinite",
                boxShadow: "0 14px 20px 4px rgba(4,69,144,.08)",
                border: "1px solid rgba(201,167,255,.4)"
              }}
            >
              <strong style={{ display: "block", fontSize: "14px", fontWeight: 600, color: "#2B164D" }}>
                Brand kit found
              </strong>
              <span style={{ color: "#535862" }}>Logo · #4F46E5 · Inter</span>
            </div>

            {/* Floating Tag 2: Storyboard Ready (Green) */}
            <div
              style={{
                position: "absolute",
                right: "max(-5%, calc(12px - (100vw - 100%) / 2))",
                top: "6%",
                zIndex: 4,
                padding: "12px 18px",
                borderRadius: "20px",
                background: "#D3F6E3",
                textAlign: "left",
                fontSize: "13px",
                // @ts-expect-error custom prop
                "--r": "3deg",
                animation: "gmFloat 7s ease-in-out 1s infinite",
                boxShadow: "0 14px 20px 4px rgba(4,69,144,.08)",
                border: "1px solid rgba(160,230,190,.5)"
              }}
            >
              <strong style={{ display: "block", fontSize: "14px", fontWeight: 600, color: "#0B4D2C" }}>
                Storyboard ready
              </strong>
              <span style={{ color: "#535862" }}>5 scenes · 0:30</span>
            </div>

            {/* Floating Tag 3: Revision Comment (White) */}
            <div
              style={{
                position: "absolute",
                right: "max(-3%, calc(12px - (100vw - 100%) / 2))",
                bottom: "10%",
                zIndex: 4,
                maxWidth: "250px",
                padding: "12px 18px",
                borderRadius: "20px",
                background: "#fafdff",
                textAlign: "left",
                fontSize: "13px",
                // @ts-expect-error custom prop
                "--r": "-2deg",
                animation: "gmFloat 8s ease-in-out .5s infinite",
                boxShadow: "0 14px 20px 4px rgba(4,69,144,.10)",
                border: "1px solid #E1EAF4"
              }}
            >
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "11px", color: "#0A6CFF", fontWeight: 600 }}>
                0:11 · Scene 3
              </span>
              <span style={{ display: "block", marginTop: "4px", color: "#0a0d12" }}>
                “Show the dashboard for longer.”
              </span>
            </div>

            {/* Floating Tag 4: Approved (Yellow) */}
            <div
              style={{
                position: "absolute",
                left: "max(-3%, calc(12px - (100vw - 100%) / 2))",
                bottom: "14%",
                zIndex: 4,
                padding: "12px 18px",
                borderRadius: "20px",
                background: "#FFF2BE",
                textAlign: "left",
                fontSize: "13px",
                // @ts-expect-error custom prop
                "--r": "4deg",
                animation: "gmFloat 6.5s ease-in-out 2s infinite",
                boxShadow: "0 14px 20px 4px rgba(4,69,144,.08)",
                border: "1px solid rgba(240,210,120,.5)"
              }}
            >
              <strong style={{ display: "block", fontSize: "14px", fontWeight: 600, color: "#6B5200" }}>
                Approved · Revision 4
              </strong>
              <span style={{ color: "#535862" }}>MP4 · 1920 × 1080</span>
            </div>

            {/* Video Bezel Container */}
            <div
              style={{
                padding: "3px",
                borderRadius: "36px",
                background: "linear-gradient(180deg,#168BFF 11%,#0A6CFF 78%)",
                boxShadow: "0 30px 60px -20px rgba(4,69,144,.35)"
              }}
            >
              <div
                style={{
                  padding: "14px",
                  borderRadius: "33px",
                  background: "#0a0d12"
                }}
              >
                {/* Scene Render Frame */}
                <SceneFrame
                  scene={activeScene}
                  branded={true}
                  logoPlace="open-end"
                  radius="20px"
                  eyebrow="Smart Profit Dashboard"
                  productName="Acme"
                />

                {/* Player Controls Bar */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "12px 8px 4px"
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setIsPlaying(!isPlaying)}
                    aria-label={isPlaying ? "Pause preview" : "Play preview"}
                    style={{
                      display: "grid",
                      placeItems: "center",
                      width: "30px",
                      height: "30px",
                      borderRadius: "50%",
                      background: "#fff",
                      color: "#0a0d12",
                      border: 0,
                      cursor: "pointer",
                      fontSize: "11px",
                      flexShrink: 0
                    }}
                  >
                    {isPlaying ? "❚❚" : "▶"}
                  </button>

                  {/* Progress track */}
                  <div
                    style={{
                      flex: 1,
                      height: "4px",
                      borderRadius: "4px",
                      background: "rgba(255,255,255,.14)",
                      overflow: "hidden",
                      position: "relative"
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: heroPct,
                        background: "linear-gradient(90deg,#168BFF,#0A6CFF)",
                        transition: "width 250ms linear"
                      }}
                    />
                  </div>

                  {/* Scene Counter & Nav */}
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      style={{
                        fontFamily: "'DM Mono', monospace",
                        fontSize: "12px",
                        color: "#93979f",
                        whiteSpace: "nowrap"
                      }}
                    >
                      Scene {sceneIndex + 1} of 5
                    </span>
                    <div style={{ display: "flex", gap: "3px" }}>
                      {SCENES.map((_, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setT(idx * 10);
                          }}
                          aria-label={`Jump to scene ${idx + 1}`}
                          style={{
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            border: 0,
                            padding: 0,
                            cursor: "pointer",
                            background: idx === sceneIndex ? "#168BFF" : "rgba(255,255,255,.2)",
                            transition: "background 200ms ease"
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Logo Marquee Section */}
        <section
          style={{
            padding: "48px 0 24px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "20px"
          }}
        >
          <span style={{ fontSize: "14px", fontWeight: 500, color: "#93979f" }}>
            SaaS teams shipping updates with Greedy Motion
          </span>

          <div
            style={{
              width: "100%",
              overflow: "hidden",
              maskImage: "linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)",
              WebkitMaskImage: "linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)"
            }}
          >
            <div
              style={{
                display: "flex",
                gap: "20px",
                width: "max-content",
                animation: "gmMarquee 40s linear infinite"
              }}
            >
              {[...LOGOS, ...LOGOS].map((name, i) => (
                <span
                  key={i}
                  style={{
                    padding: "0 28px",
                    fontSize: "22px",
                    fontWeight: 600,
                    letterSpacing: "-.02em",
                    color: "#93979f",
                    whiteSpace: "nowrap"
                  }}
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section
          id="how"
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            padding: "120px 24px 48px",
            display: "flex",
            flexDirection: "column",
            gap: "40px"
          }}
        >
          <div
            style={{
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              alignItems: "center"
            }}
          >
            <h2
              style={{
                margin: 0,
                fontWeight: 600,
                fontSize: "clamp(28px, 3.4vw, 44px)",
                lineHeight: 1.15,
                letterSpacing: "-0.03em",
                maxWidth: "760px"
              }}
            >
              From screenshots to an approved MP4.
            </h2>
            <p style={{ margin: 0, fontSize: "16px", color: "#535862" }}>
              Four steps. You stay in control of every one.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "16px"
            }}
          >
            {HOW_STEPS.map((s, idx) => (
              <div
                key={idx}
                className="gm-hover-card"
                style={{
                  padding: "28px",
                  borderRadius: "28px",
                  background: s.bg,
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px",
                  minHeight: "280px",
                  border: "1px solid rgba(0,0,0,.04)"
                }}
              >
                <span
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#535862"
                  }}
                >
                  {s.n}
                </span>
                <strong
                  style={{
                    fontSize: "20px",
                    fontWeight: 600,
                    letterSpacing: "-.02em",
                    lineHeight: 1.15,
                    color: "#0a0d12"
                  }}
                >
                  {s.title}
                </strong>
                <span
                  style={{
                    fontSize: "16px",
                    lineHeight: 1.45,
                    color: "#535862",
                    marginTop: "auto"
                  }}
                >
                  {s.body}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Features Section */}
        <section
          id="features"
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            padding: "112px 24px 48px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
            gap: "16px"
          }}
        >
          <div
            style={{
              gridColumn: "1 / -1",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              marginBottom: "20px"
            }}
          >
            <h2
              style={{
                margin: 0,
                fontWeight: 600,
                fontSize: "clamp(28px, 3.4vw, 44px)",
                lineHeight: 1.15,
                letterSpacing: "-0.03em",
                maxWidth: "760px"
              }}
            >
              Guardrails for everyone. Control for pros.
            </h2>
            <p style={{ margin: 0, fontSize: "16px", color: "#535862", maxWidth: "560px" }}>
              Marketers move through a guided flow. Designers open the exact same project in Studio.
            </p>
          </div>

          {/* Feature 1: Ask to change this */}
          <div
            className="gm-hover-card"
            style={{
              padding: "36px",
              borderRadius: "28px",
              background: "#fafdff",
              border: "1px solid #E1EAF4",
              display: "flex",
              flexDirection: "column",
              gap: "20px"
            }}
          >
            <strong style={{ fontSize: "21px", fontWeight: 600, letterSpacing: "-.02em" }}>
              Ask to change this
            </strong>
            <span style={{ fontSize: "16px", color: "#535862", lineHeight: 1.5 }}>
              Pause anywhere and describe the change. You see a before and after, and nothing
              changes until you accept.
            </span>

            {/* Interactive diff box */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                padding: "18px",
                borderRadius: "20px",
                background: "#ebf5ff",
                border: "1px solid #d6e4f2"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span
                  style={{
                    padding: "3px 10px",
                    borderRadius: "9999px",
                    background: "#fff",
                    fontFamily: "'DM Mono', monospace",
                    fontSize: "12px",
                    color: "#0A6CFF",
                    fontWeight: 600
                  }}
                >
                  Proposed · Scene 3 only
                </span>
                {proposalState !== "pending" && (
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: proposalState === "accepted" ? "#16803C" : "#C2410C"
                    }}
                  >
                    {proposalState === "accepted" ? "✓ Accepted" : "✕ Rejected"}
                  </span>
                )}
              </div>
              <span style={{ fontSize: "15px", color: "#0a0d12" }}>
                Scene 3 duration:{" "}
                <span style={{ color: "#93979f", textDecoration: "line-through" }}>8s</span> → 10s
              </span>
              <span style={{ fontSize: "15px", color: "#0a0d12" }}>
                Scene 4 duration:{" "}
                <span style={{ color: "#93979f", textDecoration: "line-through" }}>8s</span> → 6s
              </span>
              <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                <button
                  type="button"
                  onClick={() => setProposalState("accepted")}
                  style={{
                    padding: "7px 16px",
                    borderRadius: "9999px",
                    background: proposalState === "accepted" ? "#16803C" : "#181d27",
                    color: "#fff",
                    fontSize: "13px",
                    fontWeight: 500,
                    border: 0,
                    cursor: "pointer",
                    transition: "all 180ms ease"
                  }}
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={() => setProposalState("rejected")}
                  style={{
                    padding: "7px 16px",
                    borderRadius: "9999px",
                    background: proposalState === "rejected" ? "#fee2e2" : "#fff",
                    color: proposalState === "rejected" ? "#b91c1c" : "#0a0d12",
                    fontSize: "13px",
                    fontWeight: 500,
                    border: "1px solid #D6E4F2",
                    cursor: "pointer",
                    transition: "all 180ms ease"
                  }}
                >
                  Reject
                </button>
              </div>
            </div>
          </div>

          {/* Feature 2: Studio for the details */}
          <div
            className="gm-hover-card"
            style={{
              padding: "36px",
              borderRadius: "28px",
              background: "#0a0d12",
              color: "#fff",
              display: "flex",
              flexDirection: "column",
              gap: "20px"
            }}
          >
            <strong style={{ fontSize: "21px", fontWeight: 600, letterSpacing: "-.02em" }}>
              Studio for the details
            </strong>
            <span style={{ fontSize: "16px", color: "#93979f", lineHeight: 1.5 }}>
              Timeline, layers, keyframes, and scoped AI comments. Publish a composition as a
              locked template for your team.
            </span>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                padding: "16px",
                borderRadius: "20px",
                background: "#181d27"
              }}
            >
              {STUDIO_TRACKS.map((t, i) => (
                <div
                  key={i}
                  style={{
                    position: "relative",
                    height: "22px",
                    borderRadius: "6px",
                    background: "rgba(255,255,255,.04)"
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      left: t.l,
                      width: t.w,
                      top: "3px",
                      bottom: "3px",
                      borderRadius: "5px",
                      background: t.c
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Feature 3: Brand kits in a minute */}
          <div
            className="gm-hover-card"
            style={{
              padding: "36px",
              borderRadius: "28px",
              background: "linear-gradient(180deg,#F4EBFF,#E4CCFF)",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              border: "1px solid rgba(200,160,255,.3)"
            }}
          >
            <strong style={{ fontSize: "21px", fontWeight: 600, letterSpacing: "-.02em", color: "#2B164D" }}>
              Brand kits in a minute
            </strong>
            <span style={{ fontSize: "16px", color: "#535862", lineHeight: 1.5 }}>
              Import from your website. Every suggestion is editable before you save.
            </span>
          </div>

          {/* Feature 4: Honest render status */}
          <div
            className="gm-hover-card"
            style={{
              padding: "36px",
              borderRadius: "28px",
              background: "linear-gradient(180deg,#E5F6FF,#C2E9FF)",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              border: "1px solid rgba(160,210,255,.4)"
            }}
          >
            <strong style={{ fontSize: "21px", fontWeight: 600, letterSpacing: "-.02em", color: "#06377B" }}>
              Honest render status
            </strong>
            <span style={{ fontSize: "16px", color: "#535862", lineHeight: 1.5 }}>
              Real stages and frame counts. If a scene fails, you see why and how to fix it.
            </span>
          </div>
        </section>

        {/* Pricing Section */}
        <section
          id="pricing"
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            padding: "120px 24px 48px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "36px"
          }}
        >
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: "8px" }}>
            <h2
              style={{
                margin: 0,
                fontWeight: 600,
                fontSize: "clamp(28px, 3.4vw, 44px)",
                lineHeight: 1.15,
                letterSpacing: "-0.03em"
              }}
            >
              Simple pricing
            </h2>
            <p style={{ margin: 0, color: "#535862", fontSize: "16px" }}>
              Start free for 14 days. Scale as your team produces more.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: "20px",
              width: "100%",
              maxWidth: "860px"
            }}
          >
            {/* Creator Plan */}
            <div
              className="gm-hover-card"
              style={{
                padding: "36px",
                borderRadius: "28px",
                background: "#fafdff",
                border: "1px solid #E1EAF4",
                display: "flex",
                flexDirection: "column",
                gap: "18px"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong style={{ fontSize: "20px", fontWeight: 600 }}>Creator</strong>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                <span style={{ fontSize: "44px", fontWeight: 700, letterSpacing: "-.03em" }}>$29</span>
                <span style={{ color: "#535862" }}>per month</span>
              </div>
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  fontSize: "15px",
                  color: "#535862"
                }}
              >
                {[
                  "40 render minutes",
                  "1 brand kit",
                  "Guided editor",
                  "1080p MP4 export"
                ].map((item, i) => (
                  <li key={i} style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <span style={{ color: "#0A6CFF", fontWeight: 700 }}>✓</span>
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                href="/coming-soon"
                className="gm-btn-light"
                style={{
                  marginTop: "auto",
                  textAlign: "center",
                  padding: "13px",
                  borderRadius: "9999px",
                  background: "#fff",
                  color: "#0a0d12",
                  fontSize: "15px",
                  fontWeight: 600,
                  textDecoration: "none",
                  border: "1px solid #E1EAF4"
                }}
              >
                Coming soon
              </Link>
            </div>

            {/* Team Plan */}
            <div
              className="gm-hover-card"
              style={{
                padding: "36px",
                borderRadius: "28px",
                background: "linear-gradient(180deg,#E5F6FF,#C2E9FF)",
                border: "1px solid rgba(22,139,255,.3)",
                display: "flex",
                flexDirection: "column",
                gap: "18px",
                position: "relative"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong style={{ fontSize: "20px", fontWeight: 600 }}>Team</strong>
                <span
                  style={{
                    padding: "3px 10px",
                    borderRadius: "9999px",
                    background: "#D3F6E3",
                    color: "#0a5c35",
                    fontSize: "12px",
                    fontWeight: 600
                  }}
                >
                  Most teams
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                <span style={{ fontSize: "44px", fontWeight: 700, letterSpacing: "-.03em" }}>$99</span>
                <span style={{ color: "#535862" }}>per month</span>
              </div>
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  fontSize: "15px",
                  color: "#535862"
                }}
              >
                {[
                  "200 render minutes",
                  "Unlimited brand kits",
                  "Studio + scoped AI comments",
                  "Publish team templates"
                ].map((item, i) => (
                  <li key={i} style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <span style={{ color: "#0A6CFF", fontWeight: 700 }}>✓</span>
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                href="/coming-soon"
                className="gm-btn-primary"
                style={{
                  marginTop: "auto",
                  textAlign: "center",
                  padding: "13px",
                  borderRadius: "9999px",
                  background: "#181d27",
                  color: "#fff",
                  fontSize: "15px",
                  fontWeight: 600,
                  textDecoration: "none",
                  boxShadow: "0 1px 2px rgba(10,13,18,.8), 0 0 0 1px #0a0d12"
                }}
              >
                Coming soon
              </Link>
            </div>
          </div>
        </section>

        {/* Quotes Marquee Section */}
        <section
          style={{
            padding: "80px 0 40px",
            display: "flex",
            flexDirection: "column",
            gap: "28px"
          }}
        >
          <h2
            style={{
              margin: 0,
              fontWeight: 600,
              fontSize: "clamp(26px, 3vw, 38px)",
              letterSpacing: "-0.03em",
              textAlign: "center",
              padding: "0 24px"
            }}
          >
            Teams ship the update and the video the same day
          </h2>

          <div
            style={{
              width: "100%",
              overflow: "hidden",
              maskImage: "linear-gradient(90deg,transparent,#000 10%,#000 90%,transparent)",
              WebkitMaskImage: "linear-gradient(90deg,transparent,#000 10%,#000 90%,transparent)"
            }}
          >
            <div
              style={{
                display: "flex",
                gap: "20px",
                width: "max-content",
                animation: "gmMarquee 55s linear infinite"
              }}
            >
              {[...QUOTES, ...QUOTES].map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    width: "380px",
                    flex: "none",
                    padding: "32px",
                    borderRadius: "32px",
                    background: "#fafdff",
                    border: "1px solid #E1EAF4",
                    boxShadow: "0 8px 18px rgba(4,69,144,.04)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "20px"
                  }}
                >
                  <span style={{ fontSize: "16px", lineHeight: 1.55, color: "#535862" }}>
                    “{item.quote}”
                  </span>
                  <span
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "2px",
                      borderTop: "1px solid #E1EAF4",
                      paddingTop: "16px"
                    }}
                  >
                    <strong style={{ fontSize: "16px", fontWeight: 600, color: "#0a0d12" }}>
                      {item.name}
                    </strong>
                    <span style={{ fontSize: "14px", color: "#93979f" }}>{item.role}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQs Accordion */}
        <section
          style={{
            maxWidth: "820px",
            margin: "0 auto",
            padding: "112px 24px 48px",
            display: "flex",
            flexDirection: "column",
            gap: "12px"
          }}
        >
          <h2
            style={{
              margin: "0 0 16px",
              fontWeight: 600,
              fontSize: "clamp(26px, 3vw, 38px)",
              letterSpacing: "-0.03em",
              textAlign: "center"
            }}
          >
            FAQs
          </h2>

          {FAQS.map((faq, idx) => {
            const isOpen = activeFaq === idx;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => setActiveFaq(isOpen ? null : idx)}
                style={{
                  textAlign: "left",
                  border: "1px solid #E1EAF4",
                  padding: "26px 30px",
                  borderRadius: "28px",
                  background: "#fafdff",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 0,
                  transition: "background 200ms ease, box-shadow 200ms ease"
                }}
              >
                <span
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "16px",
                    fontSize: "17px",
                    fontWeight: 600,
                    color: "#0a0d12"
                  }}
                >
                  {faq.q}
                  <span
                    style={{
                      color: "#93979f",
                      fontSize: "20px",
                      lineHeight: 1,
                      transition: "transform 300ms ease",
                      transform: isOpen ? "rotate(45deg)" : "none"
                    }}
                  >
                    +
                  </span>
                </span>
                <span
                  style={{
                    display: "grid",
                    gridTemplateRows: isOpen ? "1fr" : "0fr",
                    transition: "grid-template-rows 500ms cubic-bezier(.16,1,.3,1)"
                  }}
                >
                  <span style={{ overflow: "hidden", fontSize: "16px", lineHeight: 1.5, color: "#535862" }}>
                    <span style={{ display: "block", paddingTop: "14px" }}>{faq.a}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </section>

        {/* Final Call to Action */}
        <section
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            padding: "80px 24px 60px"
          }}
        >
          <div
            style={{
              position: "relative",
              overflow: "hidden",
              padding: "84px 32px",
              borderRadius: "40px",
              background: "#0a0d12",
              color: "#fff",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              gap: "24px",
              boxShadow: "0 24px 48px -12px rgba(4,69,144,.28)"
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "radial-gradient(60% 80% at 20% 0%, rgba(22,139,255,.45), transparent 60%), radial-gradient(50% 70% at 90% 100%, rgba(255,90,31,.25), transparent 60%)"
              }}
            />
            <img
              src="/brand/gm-mark.svg"
              alt=""
              style={{ position: "relative", height: "46px", width: "auto" }}
            />
            <h2
              style={{
                position: "relative",
                margin: 0,
                fontWeight: 600,
                fontSize: "clamp(28px, 3.4vw, 44px)",
                letterSpacing: "-0.03em",
                lineHeight: 1.12
              }}
            >
              Ship your next update
              <br />
              with a video.
            </h2>
            <Link
              href="/coming-soon"
              className="gm-btn-light"
              style={{
                position: "relative",
                padding: "14px 32px",
                borderRadius: "9999px",
                background: "#fff",
                color: "#0a0d12",
                fontSize: "16px",
                fontWeight: 600,
                textDecoration: "none",
                boxShadow: "0 4px 14px rgba(0,0,0,.3)"
              }}
            >
              View coming soon
            </Link>
          </div>

          {/* Footer */}
          <footer
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "16px",
              flexWrap: "wrap",
              padding: "36px 8px 0",
              fontSize: "14px",
              color: "#93979f"
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <img src="/brand/gm-mark.svg" alt="" style={{ height: "18px", width: "auto" }} />
              © Greedy Motion 2026
            </span>
            <span style={{ display: "flex", gap: "22px" }}>
              <a href="#pricing" style={{ color: "#535862", textDecoration: "none" }}>
                Pricing
              </a>
              <a href="#" style={{ color: "#535862", textDecoration: "none" }}>
                Privacy
              </a>
              <a href="#" style={{ color: "#535862", textDecoration: "none" }}>
                Terms
              </a>
              <a href="#" style={{ color: "#535862", textDecoration: "none" }}>
                Contact
              </a>
              <Link href="/coming-soon" style={{ color: "#0A6CFF", textDecoration: "none", fontWeight: 600 }}>
                Coming soon
              </Link>
            </span>
          </footer>
        </section>
      </div>
    </div>
  );
}
