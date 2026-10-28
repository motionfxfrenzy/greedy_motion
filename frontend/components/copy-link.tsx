"use client";

import React, { useRef, useState } from "react";

/** The confirmation link in a one-line box with a Copy button (the email cannot copy for you) and an Open button. */
export function CopyLink({ link }: { link: string }) {
  const [state, setState] = useState<"idle" | "copied" | "select">("idle");
  const box = useRef<HTMLDivElement>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setState("copied");
    } catch {
      // Clipboard blocked (older browser, insecure context): select the link so Cmd/Ctrl+C finishes the job.
      const selection = window.getSelection();
      if (box.current && selection) {
        const range = document.createRange();
        range.selectNodeContents(box.current);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setState("select");
    }
    window.setTimeout(() => setState("idle"), 3000);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div
        ref={box}
        title={link}
        style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", padding: "13px 16px", border: "1px solid var(--d-bd-e1eaf4)", borderRadius: "14px", background: "var(--d-bg-fafdff)", color: "var(--d-tx-0a6cff)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "13px" }}
      >
        {link}
      </div>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <button className="primary-button" type="button" onClick={() => void copy()} style={{ flex: "1 1 160px" }}>
          {state === "copied" ? "Copied ✓" : "Copy link"}
        </button>
        <a className="secondary-button" href={link} rel="noreferrer" style={{ flex: "1 1 160px", textAlign: "center", textDecoration: "none", color: "var(--d-tx-0a0d12)" }}>
          Open link
        </a>
      </div>
      <span role="status" style={{ minHeight: "18px", fontSize: "13px", color: "var(--d-tx-535862)" }}>
        {state === "copied" && "Link copied. Paste it into the browser where you signed up or asked for the reset."}
        {state === "select" && "Press Cmd+C (Ctrl+C on Windows) to copy the selected link."}
      </span>
    </div>
  );
}
