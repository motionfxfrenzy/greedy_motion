"use client";

import React, { useState, type CSSProperties, type InputHTMLAttributes } from "react";

/** A password field with a show/hide button. Same look as the other auth inputs; the button sits inside the field's right edge. */
export function PasswordInput({ style, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "style"> & { style?: CSSProperties }) {
  const [shown, setShown] = useState(false);
  return (
    <span style={{ position: "relative", display: "block" }}>
      <input {...props} type={shown ? "text" : "password"} style={{ ...style, width: "100%", boxSizing: "border-box", paddingRight: "48px" }} />
      <button
        type="button"
        onClick={() => setShown((value) => !value)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        title={shown ? "Hide password" : "Show password"}
        style={{ position: "absolute", top: "50%", right: "10px", transform: "translateY(-50%)", display: "grid", placeItems: "center", width: "32px", height: "32px", border: 0, borderRadius: "9999px", background: "transparent", color: "inherit", opacity: 0.7, cursor: "pointer" }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {shown && <path d="M3 3l18 18" />}
        </svg>
      </button>
    </span>
  );
}
