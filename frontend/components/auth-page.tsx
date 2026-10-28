"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "../utils/supabase/client";
import { sendWelcomeEmail } from "../lib/api";
import { ThemeToggle } from "./theme-toggle";
import { SceneFrame, type SceneItem } from "./scene-frame";
import { PasswordRules } from "./password-rules";
import { EMAIL_CODE_MINUTES, MIN_PASSWORD_LENGTH, passwordProblem } from "../lib/password";

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
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [forgot, setForgot] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState(
    searchParams.get("error") === "reset" ? "That reset link expired, or was opened in a different browser from the one you asked in. Choose Forgot password to get a new one."
      : searchParams.get("error") ? "Sign-in failed. Please try again." : ""
  );
  const [sceneIdx, setSceneIdx] = useState(0);
  const router = useRouter();
  // Only same-origin relative paths are honoured, so ?next= can't redirect off-site.
  const requestedNext = searchParams.get("next") ?? "";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/studio";
  const callbackUrl = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  useEffect(() => {
    const timer = setInterval(() => {
      setSceneIdx((s) => (s + 1) % SCENES.length);
      // Long enough for each scene's entrance motion (scene-frame.tsx) to finish and be read.
    }, 3600);
    return () => clearInterval(timer);
  }, []);

  const isValidEmail = /.+@.+\..+/.test(email);
  const emailError = tried && !isValidEmail;
  // Creating an account must meet the project's password rules; signing in only needs the password to be plausible.
  const weakPassword = mode === "signup" ? passwordProblem(password) !== null : password.length < MIN_PASSWORD_LENGTH;
  const passwordError = tried && weakPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setTried(true);
    setAuthError("");
    if (!isValidEmail || weakPassword) return;
    setBusy(true);
    try {
      const supabase = createClient();
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name }, emailRedirectTo: callbackUrl() }
        });
        setBusy(false);
        if (error) return setAuthError(error.message);
        // Supabase returns an obfuscated user with no identities when the email is already registered.
        if (data.user && data.user.identities?.length === 0) return setAuthError("An account with this email already exists. Sign in instead.");
        if (data.session) {
          void sendWelcomeEmail();
          return router.replace(next);
        }
        setSent(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        // On success the button keeps its spinner until the workspace replaces this page.
        if (error) {
          setBusy(false);
          return setAuthError(error.message);
        }
        router.replace(next);
        router.refresh();
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not connect. Please try again.");
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    if (busy) return;
    setBusy(true);
    setAuthError("");
    try {
      const { error } = await createClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: callbackUrl() } });
      if (error) throw error;
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not connect. Please try again.");
      setBusy(false);
    }
  };

  const handleForgot = async () => {
    if (busy) return;
    setTried(true);
    setAuthError("");
    if (!isValidEmail) return;
    setBusy(true);
    try {
      const { error } = await createClient().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset` });
      if (error) throw error;
      setForgot(false);
      setSent(true);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not send the reset link. Please try again.");
    } finally { setBusy(false); }
  };

  // The confirmation and reset emails carry a code as well as a link; entering it works the same as opening the link.
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const token = code.replace(/\s/g, "");
    if (!/^\d{6,10}$/.test(token)) return setAuthError("Enter the code from the email.");
    setBusy(true);
    setAuthError("");
    try {
      const signup = mode === "signup";
      const { error } = await createClient().auth.verifyOtp({ email, token, type: signup ? "signup" : "recovery" });
      if (error) throw error;
      if (signup) void sendWelcomeEmail();
      router.replace(signup ? next : "/auth/reset");
      router.refresh();
    } catch {
      setAuthError(`That code is wrong or has expired. Codes last ${EMAIL_CODE_MINUTES} minutes; check the email or use a different email to start again.`);
      setBusy(false);
    }
  };

  const isSignup = mode === "signup";

  return (
    <div style={{ position: "relative", minHeight: "100vh", overflow: "hidden", background: "var(--d-bg-ebf5ff)", color: "var(--d-tx-0a0d12)" }}>
      {/* Hide the showcase when the columns wrap (both need 460px), so it doesn't drop below the form */}
      <style>{"@media (max-width: 919px) { .auth-showcase { display: none !important; } }"}</style>
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
            background: "radial-gradient(circle,var(--d-bg-rgba15820325585),var(--d-bg-rgba1582032550) 70%)"
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
            background: "radial-gradient(circle,var(--d-bg-rgba2282042557),var(--d-bg-rgba2282042550) 70%)"
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
        <section style={{ position: "relative", display: "flex", flexDirection: "column", padding: "28px 40px" }}>
          <div style={{ position: "absolute", top: 24, right: 24 }}><ThemeToggle /></div>
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
              <span style={{ color: "var(--d-tx-0b1f4d)" }}>Greedy</span>
              <span style={{ color: "var(--d-tx-0a6cff)" }}>Motion</span>
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
                  background: "var(--d-bg-rgba2502532558)",
                  alignSelf: "flex-start",
                  border: "1px solid var(--d-bd-e1eaf4)"
                }}
              >
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setForgot(false);
                    setAuthError("");
                    setMode("signin");
                    setAuthError("");
                    setSent(false);
                    setTried(false);
                  }}
                  style={{
                    border: 0,
                    padding: "8px 18px",
                    borderRadius: "9999px",
                    background: mode === "signin" ? "var(--d-bg-181d27)" : "transparent",
                    color: mode === "signin" ? "var(--d-btn-ink)" : "var(--d-tx-535862)",
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
                  disabled={busy}
                  onClick={() => {
                    setForgot(false);
                    setAuthError("");
                    setMode("signup");
                    setSent(false);
                    setTried(false);
                  }}
                  style={{
                    border: 0,
                    padding: "8px 18px",
                    borderRadius: "9999px",
                    background: mode === "signup" ? "var(--d-bg-181d27)" : "transparent",
                    color: mode === "signup" ? "var(--d-btn-ink)" : "var(--d-tx-535862)",
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
                <p style={{ margin: "10px 0 0", fontSize: "16px", color: "var(--d-tx-535862)" }}>
                  {isSignup ? "Create your workspace and start making product videos." : "Sign in to open your workspace."}
                </p>
              </div>

              {forgot ? (
                <form onSubmit={(event) => { event.preventDefault(); void handleForgot(); }} style={{ display: "grid", gap: 16 }}>
                  <h2 style={{ margin: 0, fontWeight: 600, fontSize: "20px", letterSpacing: "-0.02em" }}>Reset your password</h2>
                  <p style={{ margin: 0, fontSize: "15px", lineHeight: 1.5, color: "var(--d-tx-535862)" }}>Enter your email and we’ll send you a reset link and a code.</p>
                  <label htmlFor="reset-email" style={{ fontSize: "14px", fontWeight: 500, marginBottom: -8 }}>Email address</label>
                  <input style={{ padding: "13px 16px", border: "1px solid var(--d-bd-d6e4f2)", borderRadius: 16, background: "var(--d-bg-ffffff)", color: "var(--d-tx-0a0d12)", fontSize: 15 }} id="reset-email" type="email" autoComplete="email" autoFocus required value={email} onChange={(event) => setEmail(event.target.value)} />
                  {authError && <span role="alert" style={{ fontSize: "13px", color: "var(--d-tx-c2410c)" }}>{authError}</span>}
                  <button className="primary-button" type="submit" disabled={busy} aria-busy={busy}>{busy ? "Sending…" : "Send reset email"}</button>
                  <button type="button" disabled={busy} onClick={() => { setForgot(false); setTried(false); setAuthError(""); }} style={{ alignSelf: "center", border: 0, background: "transparent", padding: "4px 0", color: "var(--d-tx-535862)", fontSize: "14px", cursor: "pointer", textDecoration: "underline" }}>Back to sign in</button>
                </form>
              ) : sent ? (
                <div
                  style={{
                    padding: "24px",
                    borderRadius: "24px",
                    background: "var(--d-bg-fafdff)",
                    border: "1px solid var(--d-bd-e1eaf4)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px"
                  }}
                >
                  <strong style={{ fontSize: "18px", fontWeight: 600 }}>Check your inbox</strong>
                  <span style={{ fontSize: "15px", color: "var(--d-tx-535862)", lineHeight: 1.5 }}>
                    We sent {isSignup ? "a confirmation email" : "a reset email"} to <strong>{email}</strong>. Open the link in it, or enter the code below. Both expire in {EMAIL_CODE_MINUTES} minutes.
                  </span>
                  <form onSubmit={(e) => void handleVerify(e)} style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <input
                      aria-label="Code from the email"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="Code from the email"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      style={{ flex: "1 1 160px", minWidth: 0, padding: "13px 16px", border: "1px solid var(--d-bd-d6e4f2)", borderRadius: "16px", background: "var(--d-bg-ffffff)", fontSize: "15px", letterSpacing: "0.12em", outline: "none" }}
                    />
                    <button className="primary-button" type="submit" disabled={busy} aria-busy={busy}>
                      {busy ? "Checking…" : isSignup ? "Confirm" : "Continue"}
                    </button>
                  </form>
                  {authError && <span role="alert" style={{ fontSize: "13px", color: "var(--d-tx-c2410c)" }}>{authError}</span>}
                  <button
                    type="button"
                    onClick={() => {
                      setSent(false);
                      setTried(false);
                      setCode("");
                      setAuthError("");
                    }}
                    style={{
                      alignSelf: "flex-start",
                      border: 0,
                      background: "transparent",
                      padding: "4px 0",
                      color: "var(--d-tx-535862)",
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
                    <button
                      type="button"
                      onClick={() => void handleGoogle()}
                      disabled={busy}
                      aria-busy={busy}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "10px",
                        padding: "13px",
                        borderRadius: "9999px",
                        background: "var(--d-bg-fafdff)",
                        color: "var(--d-tx-0a0d12)",
                        fontSize: "15px",
                        fontWeight: 500,
                        border: "1px solid var(--d-bd-e1eaf4)",
                        cursor: "pointer"
                      }}
                    >
                      <span
                        style={{
                          display: "grid",
                          placeItems: "center",
                          width: "20px",
                          height: "20px",
                          borderRadius: "50%",
                          background: "var(--d-bg-ebf5ff)",
                          fontSize: "12px",
                          fontWeight: 700,
                          color: "var(--d-tx-0a6cff)"
                        }}
                      >
                        G
                      </span>
                      Continue with Google
                    </button>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "13px", color: "var(--d-tx-93979f)" }}>
                    <span style={{ flex: 1, height: "1px", background: "var(--d-bg-d6e4f2)" }} />
                    or with email
                    <span style={{ flex: 1, height: "1px", background: "var(--d-bg-d6e4f2)" }} />
                  </div>

                  <form onSubmit={(e) => void handleSubmit(e)} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
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
                            border: "1px solid var(--d-bd-d6e4f2)",
                            borderRadius: "16px",
                            background: "var(--d-bg-fafdff)",
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
                          border: emailError ? "1px solid #C2410C" : "1px solid var(--d-bd-d6e4f2)",
                          borderRadius: "16px",
                          background: "var(--d-bg-fafdff)",
                          fontSize: "15px",
                          outline: "none"
                        }}
                      />
                    </label>

                    {emailError && (
                      <span style={{ fontSize: "13px", color: "var(--d-tx-c2410c)" }}>
                        Enter a valid email address.
                      </span>
                    )}

                    <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <span style={{ fontSize: "14px", fontWeight: 500 }}>Password</span>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={isSignup ? "Create a password" : "Your password"}
                        autoComplete={isSignup ? "new-password" : "current-password"}
                        style={{
                          padding: "13px 16px",
                          border: passwordError ? "1px solid #C2410C" : "1px solid var(--d-bd-d6e4f2)",
                          borderRadius: "16px",
                          background: "var(--d-bg-fafdff)",
                          fontSize: "15px",
                          outline: "none"
                        }}
                      />
                    </label>

                    {isSignup ? (
                      <PasswordRules password={password} tried={tried} />
                    ) : (
                      passwordError && <span style={{ fontSize: "13px", color: "var(--d-tx-c2410c)" }}>Use at least {MIN_PASSWORD_LENGTH} characters.</span>
                    )}

                    {authError && (
                      <span role="alert" style={{ fontSize: "13px", color: "var(--d-tx-c2410c)" }}>{authError}</span>
                    )}

                    {!isSignup && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => { setForgot(true); setTried(false); setAuthError(""); }}
                        style={{ alignSelf: "flex-end", border: 0, background: "transparent", padding: 0, color: "var(--d-tx-535862)", fontSize: "13px", cursor: "pointer", textDecoration: "underline" }}
                      >
                        Forgot password?
                      </button>
                    )}

                    <button
                      type="submit"
                      disabled={busy}
                      aria-busy={busy}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "10px",
                        marginTop: "4px",
                        padding: "14px",
                        border: 0,
                        borderRadius: "9999px",
                        background: "var(--d-bg-181d27)",
                        color: "var(--d-btn-ink)",
                        fontSize: "15px",
                        fontWeight: 500,
                        cursor: busy ? "progress" : "pointer",
                        opacity: busy ? 0.85 : 1,
                        boxShadow: "0 1px 2px rgba(10,13,18,.8), 0 0 0 1px #0a0d12"
                      }}
                    >
                      {busy && <span className="gm-spinner" aria-hidden="true" />}
                      {busy ? (isSignup ? "Creating account…" : "Signing in…") : isSignup ? "Create account" : "Sign in"}
                    </button>

                    <span style={{ fontSize: "13px", color: "var(--d-tx-93979f)", lineHeight: 1.5, textAlign: "center" }}>
                      By continuing, you agree to our <Link href="/terms">Terms</Link> and acknowledge our <Link href="/privacy">Privacy Policy</Link>.
                    </span>
                  </form>
                </div>
              )}

              <span style={{ fontSize: "14px", color: "var(--d-tx-535862)" }}>
                {isSignup ? "Already have an account? " : "New to Greedy Motion? "}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setForgot(false);
                    setAuthError("");
                    setMode(isSignup ? "signin" : "signup");
                    setSent(false);
                    setTried(false);
                  }}
                  style={{
                    border: 0,
                    background: "transparent",
                    padding: 0,
                    color: "var(--d-tx-0a6cff)",
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
        <aside className="auth-showcase" style={{ padding: "16px", display: "flex" }}>
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
                Plan your story. Review the motion. Refine the result.
              </span>
              <span style={{ fontSize: "14px", color: "var(--d-tx-93979f)" }}>
                Illustrative product demo · Not a customer endorsement
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
