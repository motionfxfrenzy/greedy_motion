"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PLANS } from "@videosaas/contracts";
import { createClient } from "../utils/supabase/client";
import { getMySubscription, getMyTokens, type Subscription, type TokenSummary } from "../lib/api";
import { useEntitlements } from "../lib/entitlements";
import { ThemeChoicePicker } from "./theme-choice";

export type Account = { name: string; email: string; initial: string };

/** The signed-in person, read from the session. `null` until it is known. */
export function useAccount(): Account | null {
  const [account, setAccount] = useState<Account | null>(null);
  useEffect(() => {
    let live = true;
    void createClient().auth.getUser().then(({ data }) => {
      const user = data.user;
      if (!live || !user) return;
      const meta = user.user_metadata ?? {};
      const email = user.email ?? "";
      const name = String(meta.full_name ?? meta.name ?? "").trim() || email.split("@")[0] || "Account";
      setAccount({ name, email, initial: name.slice(0, 1).toUpperCase() });
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  return account;
}

export function planLabel(state: ReturnType<typeof useEntitlements>["state"]): string {
  if (state.status === "loading") return "Checking plan…";
  if (state.status === "unavailable") return "Plan unavailable";
  return state.entitlements.plan === "pro" ? "Pro" : "Free";
}

const num = (n: number) => String(Math.round(n * 100) / 100);

/** The avatar in the workspace header: name, plan, profile, theme and sign out in one dropdown. */
export function AccountMenu() {
  const account = useAccount();
  const { state } = useEntitlements();
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState<TokenSummary | null>(null);
  const [sub, setSub] = useState<Subscription | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let live = true;
    getMyTokens().then((t) => { if (live) setTokens(t); }).catch(() => undefined);
    getMySubscription().then((s) => { if (live) setSub(s); }).catch(() => undefined);
    return () => { live = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key); };
  }, [open]);

  const closeDialog = () => { if (!leaving) dialogRef.current?.close(); };
  const signOut = async () => {
    setLeaving(true);
    await createClient().auth.signOut().catch(() => undefined);
    window.location.href = "/auth";
  };

  const view = tokens?.plan ?? tokens?.free ?? null;
  const usedPct = !view || view.granted <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((view.used / view.granted) * 100)));
  const isPaid = (sub && sub.tier !== "free") || (state.status === "ready" && state.entitlements.plan === "pro");
  const chipLabel = sub ? PLANS[sub.tier].name : planLabel(state);

  return (
    <div className="account-menu" ref={root}>
      <button type="button" className="account-trigger" aria-haspopup="menu" aria-expanded={open} aria-label="Account menu" onClick={() => setOpen((v) => !v)}>
        <span className="account-avatar" aria-hidden="true">{account?.initial ?? ""}</span>
      </button>
      {open && (
        <div className="account-pop" role="menu">
          <div className="account-who">
            <span className="account-avatar large" aria-hidden="true">{account?.initial ?? ""}</span>
            <div><b>{account?.name ?? "Account"}</b><small>{account?.email}</small></div>
            <div className="account-plan-tokens">
              <div className="account-plan-row">
                <span className={`plan-chip ${isPaid ? "pro" : ""}`}>{chipLabel}</span>
                {tokens && view && (
                  <span className="account-token-text">
                    <b>{num(Math.max(tokens.remaining, 0))} left</b> · {num(view.used)}/{num(view.granted)} used ({usedPct}%)
                  </span>
                )}
              </div>
              {tokens && view && (
                <div
                  className="account-token-meter"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={usedPct}
                  aria-label="Tokens used"
                >
                  <i style={{ width: `${usedPct === 0 ? 0 : Math.max(4, usedPct)}%` }} />
                </div>
              )}
            </div>
          </div>
          <Link href="/profile" role="menuitem" className="account-item" onClick={() => setOpen(false)}>Profile &amp; settings</Link>
          <Link href="/profile#plan" role="menuitem" className="account-item" onClick={() => setOpen(false)}>Subscription &amp; tokens</Link>
          <Link href="/pricing" role="menuitem" className="account-item" onClick={() => setOpen(false)}>Plans &amp; pricing</Link>
          <div className="account-theme"><span>Theme</span><ThemeChoicePicker /></div>
          <button type="button" role="menuitem" className="account-item danger" onClick={() => { setOpen(false); dialogRef.current?.showModal(); }}>Sign out</button>
        </div>
      )}
      <dialog ref={dialogRef} className="confirm-dialog" aria-labelledby="sign-out-title" onCancel={(event) => { if (leaving) event.preventDefault(); }} onClick={(event) => { if (event.target === dialogRef.current) closeDialog(); }}>
        <h2 id="sign-out-title">Sign out of Greedy Motion?</h2>
        <p>Your projects are saved. You can sign back in at any time.</p>
        <footer>
          <button className="secondary-button" onClick={closeDialog} disabled={leaving}>Cancel</button>
          <button className="primary-button" onClick={() => void signOut()} disabled={leaving} aria-busy={leaving} autoFocus>
            {leaving && <span className="gm-spinner" aria-hidden="true" />}
            {leaving ? "Signing out…" : "Sign out"}
          </button>
        </footer>
      </dialog>
    </div>
  );
}
