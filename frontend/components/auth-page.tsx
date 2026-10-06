"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SceneFrame, type SceneItem } from "./scene-frame";

const SCENES: SceneItem[] = [
  { kind: "hook", headline: "Finally see what every sale is really worth.", copy: "" },
  { kind: "problem", headline: "Fees, refunds, and shipping hide your actual margin.", copy: "Most dashboards stop at revenue." },
  { kind: "product", headline: "Smart Profit Dashboard", copy: "", shot: "profit-dashboard.png" },
  { kind: "benefit", headline: "See real profitability at a glance.", copy: "Tracks fees, refunds, shipping, and margin in one dashboard." },
  { kind: "cta", headline: "See your real margins", copy: "acme.com/profit" }
];

export function AuthPage() {
  const searchParams = useSearchParams();
  const initialMode = searchParams.get("mode") === "signup" ? "signup" : "signin";
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [sent, setSent] = useState(false);
  const [tried, setTried] = useState(false);
  const [sceneIdx, setSceneIdx] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setSceneIdx((s) => (s + 1) % SCENES.length);
    }, 2800);
    return () => clearInterval(timer);
  }, []);

  const isValidEmail = /.+@.+\..+/.test(email);
  const emailError = tried && !isValidEmail;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!isValidEmail) return;
    setSent(true);
  };

  const isSignup = mode === "signup";

  return (
    <div style={{ position: "relative", minHeight: "100vh", overflow: "hidden", background: "#ebf5ff", color: "#0a0d12" }}>
      {/* Ambient background blobs */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          pointerEvents: "none"
        }}
      >
        <div
          style={{
            position: "absolute",
            width: "44vw",
            height: "44vw",
            left: "-14vw",
            top: "-16vw",
            borderRadius: "50%",
            filter: "blur(60px)",
            background: "radial-gradient(circle,rgba(158,203,255,.85),rgba(158,203,255,0) 70%)"
          }}
        />
        <div
          style={{
            position: "absolute",
            width: "34vw",
            height: "34vw",
            left: "18vw",
            bottom: "-14vw",
            borderRadius: "50%",
            filter: "blur(60px)",
            background: "radial-gradient(circle,rgba(228,204,255,.7),rgba(228,204,255,0) 70%)"
          }}
        />
      </div>

      <div
        style={{
          position: "relative",
          zIndex: 1,
          minHeight: "100vh",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 460px), 1fr))"
        }}
      >
        {/* Left column: Form */}
        <section style={{ display: "flex", flexDirection: "column", padding: "28px 40px" }}>
          <Link
            href="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              alignSelf: "flex-start",
              textDecoration: "none"
            }}
          >
            <img src="/brand/gm-mark.svg" alt="" style={{ height: "24px", width: "auto" }} />
            <span style={{ display: "flex", gap: "5px", fontSize: "17px", fontWeight: 700, letterSpacing: "-.02em" }}>
              <span style={{ color: "#0B1F4D" }}>Greedy</span>
              <span style={{ color: "#0A6CFF" }}>Motion</span>
            </span>
          </Link>

          <div style={{ flex: 1, display: "grid", placeItems: "center", padding: "40px 0" }}>
            <div style={{ width: "100%", maxWidth: "400px", display: "flex", flexDirection: "column", gap: "22px" }}>
              {/* Mode switch */}
              <div
                style={{
                  display: "flex",
                  gap: "4px",
                  padding: "4px",
                  borderRadius: "9999px",
                  background: "rgba(250,253,255,.8)",
                  alignSelf: "flex-start",
                  border: "1px solid #E1EAF4"
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setMode("signin");
                    setSent(false);
                    setTried(false);
                  }}
                  style={{
                    border: 0,
                    padding: "8px 18px",
                    borderRadius: "9999px",
                    background: mode === "signin" ? "#181d27" : "transparent",
                    color: mode === "signin" ? "#fff" : "#535862",
                    fontSize: "14px",
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "all 200ms ease"
                  }}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("signup");
                    setSent(false);
                    setTried(false);
                  }}
                  style={{
                    border: 0,
                    padding: "8px 18px",
                    borderRadius: "9999px",
                    background: mode === "signup" ? "#181d27" : "transparent",
                    color: mode === "signup" ? "#fff" : "#535862",
                    fontSize: "14px",
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "all 200ms ease"
                  }}
                >
                  Create account
                </button>
              </div>

              <div>
                <h1 style={{ margin: 0, fontWeight: 600, fontSize: "34px", letterSpacing: "-0.03em", lineHeight: 1.1 }}>
                  {isSignup ? "Create your account" : "Welcome back"}
                </h1>
                <p style={{ margin: "10px 0 0", fontSize: "16px", color: "#535862" }}>
                  {isSignup ? "Create your workspace and start making product videos." : "Enter your email to open your workspace."}
                </p>
              </div>

              {sent ? (
                <div
                  style={{
                    padding: "24px",
                    borderRadius: "24px",
                    background: "#fafdff",
                    border: "1px solid #E1EAF4",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px"
                  }}
                >
                  <strong style={{ fontSize: "18px", fontWeight: 600 }}>Check your inbox</strong>
                  <span style={{ fontSize: "15px", color: "#535862", lineHeight: 1.5 }}>
                    We sent a sign-in link to <strong>{email}</strong>. It expires in 15 minutes.
                  </span>
                  <Link
                    href="/studio"
                    style={{
                      alignSelf: "flex-start",
                      marginTop: "6px",
                      padding: "11px 22px",
                      borderRadius: "9999px",
                      background: "#181d27",
                      color: "#fff",
                      fontSize: "15px",
                      fontWeight: 500,
                      textDecoration: "none",
                      boxShadow: "0 1px 2px rgba(10,13,18,.8), 0 0 0 1px #0a0d12"
                    }}
                  >
                    Open the app (demo)
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setSent(false);
                      setTried(false);
                    }}
                    style={{
                      alignSelf: "flex-start",
                      border: 0,
                      background: "transparent",
                      padding: "4px 0",
                      color: "#535862",
                      fontSize: "14px",
                      cursor: "pointer",
                      textDecoration: "underline"
                    }}
                  >
                    Use a different email
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <Link
                      href="/studio"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "10px",
                        padding: "13px",
                        borderRadius: "9999px",
                        background: "#fafdff",
                        color: "#0a0d12",
                        fontSize: "15px",
                        fontWeight: 500,
                        border: "1px solid #E1EAF4",
                        textDecoration: "none"
                      }}
                    >
                      <span
                        style={{
                          display: "grid",
                          placeItems: "center",
                          width: "20px",
                          height: "20px",
                          borderRadius: "50%",
                          background: "#ebf5ff",
                          fontSize: "12px",
                          fontWeight: 700,
                          color: "#0A6CFF"
                        }}
                      >
                        G
                      </span>
                      Continue with Google
                    </Link>
                    <Link
                      href="/studio"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "10px",
                        padding: "13px",
                        borderRadius: "9999px",
                        background: "#fafdff",
                        color: "#0a0d12",
                        fontSize: "15px",
                        fontWeight: 500,
                        border: "1px solid #E1EAF4",
                        textDecoration: "none"
                      }}
                    >
                      <span
                        style={{
                          display: "grid",
                          placeItems: "center",
                          width: "20px",
                          height: "20px",
                          borderRadius: "5px",
                          background: "#ebf5ff",
                          fontSize: "11px",
                          fontWeight: 700,
                          color: "#0A6CFF"
                        }}
                      >
                        ⌘
                      </span>
                      Continue with SSO
                    </Link>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "13px", color: "#93979f" }}>
                    <span style={{ flex: 1, height: "1px", background: "#D6E4F2" }} />
                    or with email
                    <span style={{ flex: 1, height: "1px", background: "#D6E4F2" }} />
                  </div>

                  <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {isSignup && (
                      <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <span style={{ fontSize: "14px", fontWeight: 500 }}>Full name</span>
                        <input
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Olivia Evans"
                          style={{
                            padding: "13px 16px",
                            border: "1px solid #D6E4F2",
                            borderRadius: "16px",
                            background: "#fafdff",
                            fontSize: "15px",
                            outline: "none"
                          }}
                        />
                      </label>
                    )}

                    <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <span style={{ fontSize: "14px", fontWeight: 500 }}>Email</span>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        required
                        style={{
                          padding: "13px 16px",
                          border: emailError ? "1px solid #C2410C" : "1px solid #D6E4F2",
                          borderRadius: "16px",
                          background: "#fafdff",
                          fontSize: "15px",
                          outline: "none"
                        }}
                      />
                    </label>

                    {emailError && (
                      <span style={{ fontSize: "13px", color: "#C2410C" }}>
                        Enter a valid email address.
                      </span>
                    )}

                    <button
                      type="submit"
                      style={{
                        marginTop: "4px",
                        padding: "14px",
                        border: 0,
                        borderRadius: "9999px",
                        background: "#181d27",
                        color: "#fff",
                        fontSize: "15px",
                        fontWeight: 500,
                        cursor: "pointer",
                        boxShadow: "0 1px 2px rgba(10,13,18,.8), 0 0 0 1px #0a0d12"
                      }}
                    >
                      {isSignup ? "Create account" : "Send magic link"}
                    </button>

                    <span style={{ fontSize: "13px", color: "#93979f", lineHeight: 1.5, textAlign: "center" }}>
                      By continuing, you agree to our Terms and Privacy Policy.
                    </span>
                  </form>
                </div>
              )}

              <span style={{ fontSize: "14px", color: "#535862" }}>
                {isSignup ? "Already have an account? " : "New to Greedy Motion? "}
                <button
                  type="button"
                  onClick={() => {
                    setMode(isSignup ? "signin" : "signup");
                    setSent(false);
                    setTried(false);
                  }}
                  style={{
                    border: 0,
                    background: "transparent",
                    padding: 0,
                    color: "#0A6CFF",
                    fontSize: "14px",
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                >
                  {isSignup ? "Sign in" : "Create one free"}
                </button>
              </span>
            </div>
          </div>
        </section>

        {/* Right column: Dark Stage Showcase */}
        <aside style={{ padding: "16px", display: "flex" }}>
          <div
            style={{
              position: "relative",
              flex: 1,
              overflow: "hidden",
              borderRadius: "36px",
              background: "#0a0d12",
              color: "#fff",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              padding: "44px"
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "radial-gradient(70% 60% at 100% 0%, rgba(22,139,255,.5), transparent 60%), radial-gradient(60% 60% at 0% 100%, rgba(255,90,31,.22), transparent 60%)"
              }}
            />
            <span
              style={{
                position: "relative",
                alignSelf: "flex-start",
                padding: "6px 14px",
                borderRadius: "9999px",
                background: "rgba(255,255,255,.08)",
                fontSize: "13px",
                color: "#C9D3E0"
              }}
            >
              Product motion, without the production maze
            </span>

            <div
              style={{
                position: "relative",
                width: "100%",
                maxWidth: "520px",
                alignSelf: "center",
                display: "flex",
                flexDirection: "column",
                gap: "14px"
              }}
            >
              <div style={{ padding: "10px", borderRadius: "24px", background: "rgba(255,255,255,.06)" }}>
                <SceneFrame
                  scene={SCENES[sceneIdx]}
                  branded={true}
                  logoPlace="open-end"
                  radius="16px"
                />
              </div>

              {/* Progress dots */}
              <div style={{ display: "flex", gap: "6px" }}>
                {SCENES.map((_, i) => (
                  <span
                    key={i}
                    style={{
                      flex: 1,
                      height: "4px",
                      borderRadius: "4px",
                      background: i === sceneIdx ? "#168BFF" : "rgba(255,255,255,.15)",
                      transition: "background 400ms ease"
                    }}
                  />
                ))}
              </div>
            </div>

            <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: "10px", maxWidth: "460px" }}>
              <span style={{ fontSize: "19px", lineHeight: 1.45, fontWeight: 500, letterSpacing: "-.02em" }}>
                “We ship the release and the launch video on the same day now.”
              </span>
              <span style={{ fontSize: "14px", color: "#93979f" }}>
                Priya N. · Head of Product Marketing, Northwind
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
