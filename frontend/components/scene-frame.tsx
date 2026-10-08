"use client";

import React from "react";

export interface SceneItem {
  kind: "hook" | "problem" | "product" | "benefit" | "cta";
  headline: string;
  copy: string;
  shot?: string;
  ctaColor?: string;
  ctaFg?: string;
}

export interface SceneFrameProps {
  scene?: SceneItem;
  portrait?: boolean;
  branded?: boolean;
  logoPlace?: "open-end" | "end" | "corner";
  highlight?: boolean;
  radius?: string;
  eyebrow?: string;
  productName?: string;
}

export function SceneFrame({
  scene = { kind: "hook", headline: "", copy: "" },
  portrait = false,
  branded = true,
  logoPlace = "open-end",
  highlight = false,
  radius = "16px",
  eyebrow = "Smart Profit Dashboard",
  productName = "Your product"
}: SceneFrameProps) {
  const k = portrait ? 1.9 : 1;
  const theme = branded
    ? {
        bg: "#FFFFFF",
        fg: "#0F172A",
        muted: "#475569",
        brand: "#4F46E5",
        accent: "#14B8A6",
        surface: "#FFFFFF",
        line: "#E2E8F0",
        font: "'Plus Jakarta Sans', Inter, -apple-system, BlinkMacSystemFont, sans-serif",
        headWeight: 700,
        logoLetter: "A",
        logoName: "Acme"
      }
    : {
        bg: "#F7F7F5",
        fg: "#18181B",
        muted: "#52525B",
        brand: "#18181B",
        accent: "#4F46E5",
        surface: "#FFFFFF",
        line: "#E4E4E7",
        font: "'Instrument Serif', Georgia, serif",
        headWeight: 400,
        logoLetter: "P",
        logoName: productName || "Your product"
      };

  const corner =
    logoPlace === "corner"
      ? scene.kind !== "cta"
      : logoPlace === "open-end"
      ? scene.kind === "hook"
      : false;

  const glow = branded
    ? "radial-gradient(70% 60% at 100% 0%, #EEF2FF 0, transparent 70%), radial-gradient(50% 50% at 0% 100%, #F0FDFA 0, transparent 70%)"
    : "radial-gradient(70% 60% at 100% 0%, #EDE9FE 0, transparent 70%)";

  const isHook = scene.kind === "hook";
  const isProblem = scene.kind === "problem";
  const isProduct = scene.kind === "product";
  const isBenefit = scene.kind === "benefit";
  const isCta = scene.kind === "cta";

  const shotWidth = portrait ? "100%" : "74%";
  const shotLabel = scene.shot || "profit-dashboard.png";
  const costs = [
    { label: "Fees", value: "−$2,140" },
    { label: "Refunds", value: "−$860" },
    { label: "Shipping", value: "−$1,310" }
  ];

  return (
    <div style={{ width: "100%", containerType: "inline-size" }}>
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: portrait ? "9 / 16" : "16 / 9",
          overflow: "hidden",
          borderRadius: radius,
          background: theme.bg,
          color: theme.fg,
          fontFamily: theme.font,
          // @ts-expect-error CSS variable custom property
          "--k": k
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: glow,
            pointerEvents: "none"
          }}
        />
        <style>{SCENE_MOTION}</style>

        {/* Hook Scene */}
        {isHook && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              gap: "calc(2.2cqw * var(--k))",
              padding: "0 9cqw"
            }}
          >
            <span
              className="sf-drop"
              style={{
                fontSize: "calc(1.5cqw * var(--k))",
                fontWeight: 700,
                letterSpacing: ".14em",
                textTransform: "uppercase",
                color: theme.brand
              }}
            >
              {eyebrow}
            </span>
            <span
              style={{
                fontSize: "calc(5.4cqw * var(--k))",
                lineHeight: 1.06,
                letterSpacing: "-.03em",
                fontWeight: theme.headWeight,
                textWrap: "balance",
                maxWidth: "16em"
              }}
            >
              {scene.headline.split(" ").map((word, i) => (
                <React.Fragment key={i}>
                  <span className="sf-word" style={{ animationDelay: `${0.25 + i * 0.07}s` }}>{word}</span>{" "}
                </React.Fragment>
              ))}
            </span>
          </div>
        )}

        {/* Problem Scene */}
        {isProblem && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: "calc(2.4cqw * var(--k))",
              padding: "0 8cqw"
            }}
          >
            <span
              className="sf-rise"
              style={{
                fontSize: "calc(4.2cqw * var(--k))",
                lineHeight: 1.08,
                letterSpacing: "-.03em",
                fontWeight: theme.headWeight,
                maxWidth: "13em",
                textWrap: "balance"
              }}
            >
              {scene.headline}
            </span>
            <span
              style={{
                fontSize: "calc(1.9cqw * var(--k))",
                lineHeight: 1.4,
                color: theme.muted,
                maxWidth: "30em",
                animationDelay: ".3s"
              }}
              className="sf-fade"
            >
              {scene.copy}
            </span>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "calc(1.2cqw * var(--k))",
                marginTop: "calc(1cqw * var(--k))"
              }}
            >
              {costs.map((c, i) => (
                <div
                  key={i}
                  className="sf-pop"
                  style={{
                    animationDelay: `${0.55 + i * 0.15}s`,
                    display: "flex",
                    flexDirection: "column",
                    gap: ".3em",
                    padding: "calc(1.2cqw * var(--k)) calc(1.6cqw * var(--k))",
                    borderRadius: "calc(1cqw * var(--k))",
                    background: theme.surface,
                    border: `1px solid ${theme.line}`,
                    fontSize: "calc(1.5cqw * var(--k))"
                  }}
                >
                  <span style={{ color: theme.muted }}>{c.label}</span>
                  <strong className="sf-flash" style={{ animationDelay: `${0.9 + i * 0.15}s`, fontSize: "1.5em", color: "#C2410C", fontWeight: 700 }}>
                    {c.value}
                  </strong>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Product Scene */}
        {isProduct && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "calc(2cqw * var(--k))",
              padding: "0 7cqw"
            }}
          >
            <span
              className="sf-rise"
              style={{
                fontSize: "calc(2.6cqw * var(--k))",
                letterSpacing: "-.02em",
                fontWeight: theme.headWeight,
                textAlign: "center",
                textWrap: "balance"
              }}
            >
              {scene.headline}
            </span>
            <div className="sf-zoom" style={{ position: "relative", width: shotWidth, animationDelay: ".1s" }}>
              <div
                style={{
                  borderRadius: "calc(.9cqw * var(--k))",
                  overflow: "hidden",
                  border: `1px solid ${theme.line}`,
                  background: "#fff",
                  boxShadow: "0 2cqw 4cqw rgba(15,23,42,.10)"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: ".5cqw",
                    padding: "calc(.8cqw * var(--k))",
                    borderBottom: `1px solid ${theme.line}`,
                    background: "#F4F4F5"
                  }}
                >
                  <span
                    style={{
                      width: "calc(.8cqw * var(--k))",
                      height: "calc(.8cqw * var(--k))",
                      borderRadius: "50%",
                      background: "#D4D4D8"
                    }}
                  />
                  <span
                    style={{
                      width: "calc(.8cqw * var(--k))",
                      height: "calc(.8cqw * var(--k))",
                      borderRadius: "50%",
                      background: "#D4D4D8"
                    }}
                  />
                  <span
                    style={{
                      width: "calc(.8cqw * var(--k))",
                      height: "calc(.8cqw * var(--k))",
                      borderRadius: "50%",
                      background: "#D4D4D8"
                    }}
                  />
                </div>
                <DashboardMock theme={theme} label={shotLabel} />
              </div>
              <div
                className="sf-slide"
                style={{
                  animationDelay: "1.3s",
                  position: "absolute",
                  right: "-3cqw",
                  bottom: "-2.5cqw",
                  display: "flex",
                  flexDirection: "column",
                  gap: ".35em",
                  padding: "calc(1.4cqw * var(--k)) calc(1.8cqw * var(--k))",
                  borderRadius: "calc(1cqw * var(--k))",
                  background: theme.surface,
                  border: `1px solid ${theme.line}`,
                  boxShadow: "0 1.5cqw 3cqw rgba(15,23,42,.14)",
                  fontSize: "calc(1.3cqw * var(--k))"
                }}
              >
                <span style={{ color: theme.muted }}>Net profit · after fees</span>
                <strong style={{ fontSize: "2.1em", letterSpacing: "-.02em", fontWeight: 700 }}>
                  $18,420
                </strong>
                <span style={{ display: "block", height: ".45em", width: "9em", borderRadius: "1em", background: theme.line, overflow: "hidden" }}>
                  <span className="sf-fill" style={{ display: "block", height: "100%", width: "64%", borderRadius: "1em", background: theme.accent, animationDelay: "1.5s" }} />
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Benefit Scene */}
        {isBenefit && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: "calc(2.2cqw * var(--k))",
              padding: "0 9cqw"
            }}
          >
            <span
              className="sf-sweep"
              style={{
                display: "block",
                width: "calc(7cqw * var(--k))",
                height: "calc(.6cqw * var(--k))",
                background: theme.accent,
                borderRadius: "1cqw"
              }}
            />
            <span
              className="sf-rise"
              style={{
                animationDelay: ".2s",
                fontSize: "calc(5cqw * var(--k))",
                lineHeight: 1.06,
                letterSpacing: "-.03em",
                fontWeight: theme.headWeight,
                maxWidth: "12em",
                textWrap: "balance"
              }}
            >
              {scene.headline}
            </span>
            <span
              style={{
                fontSize: "calc(1.9cqw * var(--k))",
                lineHeight: 1.4,
                color: theme.muted,
                maxWidth: "28em",
                animationDelay: ".45s"
              }}
              className="sf-fade"
            >
              {scene.copy}
            </span>
          </div>
        )}

        {/* CTA Scene */}
        {isCta && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "calc(2.4cqw * var(--k))",
              textAlign: "center",
              padding: "0 8cqw"
            }}
          >
            <div
              className="sf-pop"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "calc(1cqw * var(--k))",
                fontSize: "calc(2.6cqw * var(--k))",
                fontWeight: 700,
                letterSpacing: "-.02em"
              }}
            >
              <span
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: "1.5em",
                  height: "1.5em",
                  borderRadius: ".35em",
                  background: theme.brand,
                  color: "#fff",
                  fontSize: ".9em"
                }}
              >
                {theme.logoLetter}
              </span>
              {theme.logoName}
            </div>
            <span
              className="sf-cta"
              style={{
                display: "inline-flex",
                padding: "calc(1.2cqw * var(--k)) calc(2.6cqw * var(--k))",
                borderRadius: "10cqw",
                background: scene.ctaColor || theme.brand,
                color: scene.ctaFg || "#fff",
                fontSize: "calc(2cqw * var(--k))",
                fontWeight: 700
              }}
            >
              {scene.headline}
            </span>
            <span
              style={{
                fontSize: "calc(1.5cqw * var(--k))",
                color: theme.muted,
                fontFamily: "'DM Mono', monospace",
                animationDelay: ".7s"
              }}
              className="sf-fade"
            >
              {scene.copy}
            </span>
          </div>
        )}

        {/* Corner Logo */}
        {corner && (
          <div
            style={{
              position: "absolute",
              left: "3cqw",
              top: "3cqw",
              display: "flex",
              alignItems: "center",
              gap: ".5em",
              fontSize: "calc(1.4cqw * var(--k))",
              fontWeight: 700
            }}
          >
            <span
              style={{
                display: "grid",
                placeItems: "center",
                width: "1.6em",
                height: "1.6em",
                borderRadius: ".4em",
                background: theme.brand,
                color: "#fff",
                fontSize: ".85em"
              }}
            >
              {theme.logoLetter}
            </span>
            {theme.logoName}
          </div>
        )}

        {/* Highlight border */}
        {highlight && (
          <div
            style={{
              position: "absolute",
              inset: "2cqw",
              border: "2px dashed #4F46E5",
              borderRadius: "1cqw",
              pointerEvents: "none"
            }}
          />
        )}
      </div>
    </div>
  );
}

// Entrance motion for every scene. Each scene block mounts when its slide shows, so the animations replay
// per slide. Classes: rise/fade/drop/word (text), pop (chips, logo), zoom (product frame), slide + fill (net
// profit card), sweep (accent bar), flash (cost values), cta (rise, then a soft pulse). Off for reduced motion.
const SCENE_MOTION = `
.sf-rise,.sf-fade,.sf-drop,.sf-word,.sf-pop,.sf-zoom,.sf-slide,.sf-cta{opacity:0;animation-fill-mode:forwards;animation-timing-function:cubic-bezier(.2,.8,.2,1)}
.sf-rise{animation-name:sf-rise;animation-duration:.6s}
.sf-fade{animation-name:sf-fade;animation-duration:.6s}
.sf-drop{animation-name:sf-drop;animation-duration:.5s}
.sf-word{display:inline-block;animation-name:sf-rise;animation-duration:.55s}
.sf-pop{animation-name:sf-pop;animation-duration:.5s}
.sf-zoom{animation-name:sf-zoom;animation-duration:.7s}
.sf-slide{animation-name:sf-slide;animation-duration:.6s}
.sf-fill{transform-origin:left;transform:scaleX(0);animation:sf-sweep .8s cubic-bezier(.2,.8,.2,1) forwards}
.sf-sweep{transform-origin:left;transform:scaleX(0);animation:sf-sweep .7s cubic-bezier(.2,.8,.2,1) forwards}
.sf-flash{display:inline-block;animation:sf-flash .6s ease-out}
.sf-cta{animation:sf-rise .6s .35s cubic-bezier(.2,.8,.2,1) forwards,sf-pulse 2.4s 1.2s ease-in-out infinite}
@keyframes sf-rise{from{opacity:0;transform:translateY(.6em)}to{opacity:1;transform:none}}
@keyframes sf-fade{to{opacity:1}}
@keyframes sf-drop{from{opacity:0;transform:translateY(-.6em)}to{opacity:1;transform:none}}
@keyframes sf-pop{0%{opacity:0;transform:scale(.85)}70%{opacity:1;transform:scale(1.04)}100%{opacity:1;transform:none}}
@keyframes sf-zoom{from{opacity:0;transform:scale(.94) translateY(2%)}to{opacity:1;transform:none}}
@keyframes sf-slide{from{opacity:0;transform:translateX(30%)}to{opacity:1;transform:none}}
@keyframes sf-sweep{to{transform:scaleX(1)}}
@keyframes sf-flash{0%{transform:scale(1)}40%{transform:scale(1.12)}100%{transform:scale(1)}}
@keyframes sf-pulse{0%,100%{box-shadow:0 0 0 0 rgba(79,70,229,0)}50%{box-shadow:0 0 0 .5em rgba(79,70,229,.16)}}
@media (prefers-reduced-motion:reduce){.sf-rise,.sf-fade,.sf-drop,.sf-word,.sf-pop,.sf-zoom,.sf-slide,.sf-cta,.sf-fill,.sf-sweep,.sf-flash{animation:none;opacity:1;transform:none}}
`;

type MockTheme = { fg: string; muted: string; brand: string; accent: string; surface: string; line: string };

// Revenue bars and the net-profit line for the mock chart (arbitrary but plausible: net tracks revenue minus costs).
const revenue = [42, 55, 48, 63, 58, 71, 66, 79, 74, 88, 83, 95];
const net = [28, 37, 31, 44, 40, 51, 46, 58, 54, 66, 61, 72];

/**
 * A small, believable product UI for the "product" scene: sidebar, KPI cards and a profit chart whose bars
 * grow and line draws in. Pure markup in the scene's own colours, so it reads as the product, not a placeholder.
 */
function DashboardMock({ theme, label }: { theme: MockTheme; label: string }) {
  const u = (n: number) => `calc(${n}cqw * var(--k))`;
  const tint = (hex: string, alpha: string) => `${hex}${alpha}`;
  const points = net.map((value, i) => `${(i + 0.5) * (100 / net.length)},${40 - value * 0.38}`).join(" ");
  const kpis = [
    { label: "Revenue", value: "$24,730", delta: "+12%", tone: theme.fg },
    { label: "Fees & refunds", value: "−$4,310", delta: "−3%", tone: "#C2410C" },
    { label: "Net profit", value: "$18,420", delta: "+18%", tone: theme.accent }
  ];
  return (
    <div
      role="img"
      aria-label={`Product screen: ${label.replace(/\.[a-z]+$/, "").replace(/-/g, " ")}`}
      className="sf-dash"
      style={{ aspectRatio: "16 / 9.4", display: "grid", gridTemplateColumns: "13% 1fr", background: "#F8FAFC", fontSize: u(0.95) }}
    >
      <style>{`
        .sf-dash .sf-bar{transform-origin:bottom;transform:scaleY(0);animation:sf-grow .7s cubic-bezier(.2,.8,.2,1) forwards}
        .sf-dash .sf-line{stroke-dasharray:160;stroke-dashoffset:160;animation:sf-draw 1.1s .45s ease-out forwards}
        .sf-dash .sf-dot{opacity:0;animation:sf-pop .3s 1.5s ease-out forwards}
        .sf-dash .sf-kpi{opacity:0;transform:translateY(6px);animation:sf-rise .45s ease-out forwards}
        @keyframes sf-grow{to{transform:scaleY(1)}}@keyframes sf-draw{to{stroke-dashoffset:0}}
        @keyframes sf-pop{to{opacity:1}}@keyframes sf-rise{to{opacity:1;transform:none}}
        @media (prefers-reduced-motion:reduce){.sf-dash .sf-bar,.sf-dash .sf-line,.sf-dash .sf-dot,.sf-dash .sf-kpi{animation:none;transform:none;opacity:1;stroke-dashoffset:0}}
      `}</style>
      <aside style={{ display: "flex", flexDirection: "column", gap: u(0.7), padding: u(0.9), background: theme.surface, borderRight: `1px solid ${theme.line}` }}>
        <span style={{ width: u(1.7), height: u(1.7), borderRadius: u(0.45), background: theme.brand, marginBottom: u(0.4) }} />
        {[1, 0.55, 0.7, 0.5, 0.62].map((width, i) => (
          <span key={i} style={{ height: u(0.75), width: `${width * 100}%`, borderRadius: u(0.4), background: i === 0 ? tint(theme.brand, "33") : theme.line }} />
        ))}
      </aside>
      <div style={{ display: "flex", flexDirection: "column", gap: u(0.9), padding: u(1.2), minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ fontSize: "1.25em", letterSpacing: "-.01em", color: theme.fg }}>Profit overview</strong>
          <span style={{ padding: ".25em .7em", borderRadius: "1em", border: `1px solid ${theme.line}`, background: theme.surface, color: theme.muted }}>Last 30 days</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: u(0.8) }}>
          {kpis.map((kpi, i) => (
            <div key={kpi.label} className="sf-kpi" style={{ animationDelay: `${0.1 + i * 0.12}s`, display: "flex", flexDirection: "column", gap: ".2em", padding: u(0.8), borderRadius: u(0.6), background: theme.surface, border: `1px solid ${theme.line}` }}>
              <span style={{ color: theme.muted }}>{kpi.label}</span>
              <span style={{ display: "flex", alignItems: "baseline", gap: ".4em" }}>
                <strong style={{ fontSize: "1.45em", letterSpacing: "-.02em", color: kpi.tone }}>{kpi.value}</strong>
                <em style={{ fontStyle: "normal", fontSize: ".85em", color: kpi.delta.startsWith("+") ? "#15803D" : "#C2410C" }}>{kpi.delta}</em>
              </span>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: u(0.5), padding: u(0.8), borderRadius: u(0.6), background: theme.surface, border: `1px solid ${theme.line}` }}>
          <div style={{ display: "flex", gap: "1.2em", color: theme.muted }}>
            <span><i style={{ display: "inline-block", width: ".7em", height: ".7em", marginRight: ".35em", borderRadius: ".15em", background: tint(theme.brand, "40") }} />Revenue</span>
            <span><i style={{ display: "inline-block", width: ".9em", height: ".2em", marginRight: ".35em", verticalAlign: "middle", borderRadius: ".1em", background: theme.accent }} />Net profit</span>
          </div>
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ flex: 1, width: "100%", minHeight: 0, overflow: "visible" }} aria-hidden="true">
            {[10, 20, 30].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} stroke={theme.line} strokeWidth=".3" />)}
            {revenue.map((value, i) => {
              const w = 100 / revenue.length;
              return <rect key={i} className="sf-bar" style={{ animationDelay: `${0.2 + i * 0.04}s` }} x={i * w + w * 0.2} y={40 - value * 0.38} width={w * 0.6} height={value * 0.38} rx=".8" fill={tint(theme.brand, "40")} />;
            })}
            <polyline className="sf-line" points={points} fill="none" stroke={theme.accent} strokeWidth="1.1" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <circle className="sf-dot" cx={(net.length - 0.5) * (100 / net.length)} cy={40 - net[net.length - 1] * 0.38} r="1.4" fill={theme.accent} />
          </svg>
        </div>
      </div>
    </div>
  );
}
