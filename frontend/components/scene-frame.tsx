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
              {scene.headline}
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
                maxWidth: "30em"
              }}
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
                  style={{
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
                  <strong style={{ fontSize: "1.5em", color: "#C2410C", fontWeight: 700 }}>
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
            <div style={{ position: "relative", width: shotWidth }}>
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
                <div
                  style={{
                    aspectRatio: "16 / 9.4",
                    background:
                      "repeating-linear-gradient(135deg,#EEEFF2 0 10px,#F7F7F9 10px 20px)",
                    display: "grid",
                    placeItems: "center"
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'DM Mono', monospace",
                      fontSize: "calc(1.3cqw * var(--k))",
                      color: "#71717A",
                      background: "rgba(255,255,255,.85)",
                      padding: ".3em .7em",
                      borderRadius: "4px"
                    }}
                  >
                    {shotLabel}
                  </span>
                </div>
              </div>
              <div
                style={{
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
                <span
                  style={{
                    display: "block",
                    height: ".45em",
                    width: "9em",
                    borderRadius: "1em",
                    background: `linear-gradient(90deg, ${theme.accent} 0 64%, ${theme.line} 64%)`
                  }}
                />
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
              style={{
                display: "block",
                width: "calc(7cqw * var(--k))",
                height: "calc(.6cqw * var(--k))",
                background: theme.accent,
                borderRadius: "1cqw"
              }}
            />
            <span
              style={{
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
                maxWidth: "28em"
              }}
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
                fontFamily: "'DM Mono', monospace"
              }}
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
