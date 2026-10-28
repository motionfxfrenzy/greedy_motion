import React from "react";
import { passwordChecks } from "../lib/password";

/** The password rules as a live checklist: each turns blue as it is met, and orange once a submit has missed it. */
export function PasswordRules({ password, tried }: { password: string; tried: boolean }) {
  return (
    <ul aria-label="Password requirements" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: "13px" }}>
      {passwordChecks(password).map((check) => (
        <li key={check.label} style={{ color: check.met ? "var(--d-tx-0a6cff)" : tried ? "var(--d-tx-c2410c)" : "var(--d-tx-93979f)" }}>
          <span aria-hidden="true">{check.met ? "✓" : "○"}</span> {check.label}
        </li>
      ))}
    </ul>
  );
}
