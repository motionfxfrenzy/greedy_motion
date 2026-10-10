"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../utils/supabase/client";

export default function ResetPassword() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password.length < 8) return setError("Use at least 8 characters.");
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

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#ebf5ff", color: "#0a0d12", padding: "24px" }}>
      <form onSubmit={(e) => void submit(e)} style={{ width: "100%", maxWidth: "400px", display: "flex", flexDirection: "column", gap: "14px" }}>
        <h1 style={{ margin: 0, fontWeight: 600, fontSize: "30px", letterSpacing: "-0.03em" }}>Choose a new password</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          autoComplete="new-password"
          style={{ padding: "13px 16px", border: "1px solid #D6E4F2", borderRadius: "16px", background: "#fafdff", fontSize: "15px", outline: "none" }}
        />
        {error && <span role="alert" style={{ fontSize: "13px", color: "#C2410C" }}>{error}</span>}
        <button type="submit" disabled={busy} style={{ padding: "14px", border: 0, borderRadius: "9999px", background: "#181d27", color: "#fff", fontSize: "15px", fontWeight: 500, cursor: "pointer" }}>
          {busy ? "Saving…" : "Update password"}
        </button>
      </form>
    </main>
  );
}
