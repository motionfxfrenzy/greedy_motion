"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "../../../utils/supabase/client";
import { PasswordRules } from "../../../components/password-rules";
import { passwordProblem } from "../../../lib/password";

export default function ResetPassword() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The reset link or code signs the person in for this one step; without that session there is nothing to update.
  const [session, setSession] = useState<"checking" | "ready" | "missing">("checking");

  useEffect(() => {
    void createClient().auth.getSession().then(({ data }) => setSession(data.session ? "ready" : "missing"));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    setBusy(true);
    setError("");
    try {
      const { error } = await createClient().auth.updateUser({ password });
      if (error) throw error;
      router.replace("/studio");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not connect. Please try again.");
    } finally { setBusy(false); }
  };

  const shell = (children: React.ReactNode) => (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--d-bg-ebf5ff)", color: "var(--d-tx-0a0d12)", padding: "24px" }}>
      {children}
    </main>
  );

  if (session === "checking") return shell(<span style={{ fontSize: "15px", color: "var(--d-tx-535862)" }}>Checking your reset link…</span>);
  if (session === "missing") {
    return shell(
      <div style={{ width: "100%", maxWidth: "400px", display: "flex", flexDirection: "column", gap: "14px" }}>
        <h1 style={{ margin: 0, fontWeight: 600, fontSize: "30px", letterSpacing: "-0.03em" }}>This reset link has expired</h1>
        <p style={{ margin: 0, fontSize: "15px", lineHeight: 1.5, color: "var(--d-tx-535862)" }}>
          Reset links and codes last a few minutes and work in the browser you asked from. <Link href="/auth">Go back to sign in</Link> and choose Forgot password to get a new one.
        </p>
      </div>
    );
  }

  return shell(
    <form onSubmit={(e) => void submit(e)} style={{ width: "100%", maxWidth: "400px", display: "flex", flexDirection: "column", gap: "14px" }}>
      <h1 style={{ margin: 0, fontWeight: 600, fontSize: "30px", letterSpacing: "-0.03em" }}>Choose a new password</h1>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Create a new password"
        autoComplete="new-password"
        style={{ padding: "13px 16px", border: "1px solid var(--d-bd-d6e4f2)", borderRadius: "16px", background: "var(--d-bg-fafdff)", fontSize: "15px", outline: "none" }}
      />
      <PasswordRules password={password} tried={Boolean(error)} />
      {error && <span role="alert" style={{ fontSize: "13px", color: "var(--d-tx-c2410c)" }}>{error}</span>}
      <button type="submit" disabled={busy} style={{ padding: "14px", border: 0, borderRadius: "9999px", background: "var(--d-bg-181d27)", color: "var(--d-btn-ink)", fontSize: "15px", fontWeight: 500, cursor: "pointer" }}>
        {busy ? "Saving…" : "Update password"}
      </button>
    </form>
  );
}
