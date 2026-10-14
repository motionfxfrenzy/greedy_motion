"use client";

import { PLAN_TIERS, PLANS, TOP_UP, secondsFromTokens, type PlanTier } from "@videosaas/contracts";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { getMySubscription, getMyTokens, startCheckout, type Subscription, type TokenSummary } from "../lib/api";
import { useSignedIn } from "./site-nav";

const minutes = (tokens: number) => {
  const m = secondsFromTokens(tokens) / 60;
  return m < 1 ? `${Math.round(secondsFromTokens(tokens))} seconds` : m >= 100 ? `${Math.round(m / 60)} hours` : `${Math.round(m)} minutes`;
};

/** How many films of `length` seconds a token balance makes. */
export const filmsFrom = (tokens: number, length = 30) => Math.floor(secondsFromTokens(tokens) / length);
const plain = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

/** The four plans side by side. `action` renders each card's button, so the same cards serve the pricing page and the profile. */
export function PlanCards({ current, action }: { current?: PlanTier; action: (tier: PlanTier, isCurrent: boolean) => ReactNode }) {
  return (
    <div className="plan-grid">
      {PLAN_TIERS.map((tier) => {
        const plan = PLANS[tier];
        const isCurrent = current === tier;
        const films = filmsFrom(plan.tokens);
        return (
          <article key={tier} className={`plan-card${tier === "pro" ? " featured" : ""}${isCurrent ? " current" : ""}`} aria-label={`${plan.name} plan`}>
            {isCurrent ? <span className="plan-flag mine">Your plan</span> : tier === "pro" && <span className="plan-flag">Most chosen</span>}
            <h3>{plan.name}</h3>
            <p className="plan-price"><b>${plan.priceUsd}</b>{plan.priceUsd > 0 ? <span> / month</span> : <span> to start</span>}</p>
            <p className="plan-blurb">{plan.blurb}</p>
            <div className="plan-gets" aria-label="What it includes">
              <b>{films} {films === 1 ? "film" : "films"}</b>
              <span>of 30 seconds {tier === "free" ? "in total" : "each month"}</span>
              <small>{plan.tokens.toLocaleString()} tokens{tier === "free" ? "" : " a month"}</small>
            </div>
            <ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
            <div className="plan-action">{action(tier, isCurrent)}</div>
          </article>
        );
      })}
    </div>
  );
}

/** The public pricing page's plans. Signed out the buttons lead into sign-up; signed in they open checkout, and the card of the plan you are on says so. */
export function PricingPlans() {
  const signedIn = useSignedIn();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (signedIn) void getMySubscription().then(setSub).catch(() => undefined); }, [signedIn]);
  const buy = async (tier: "starter" | "pro" | "business") => {
    setBuying(tier); setError(null);
    try { window.location.assign(await startCheckout(tier)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not open checkout."); setBuying(null); }
  };
  return (
    <>
      <PlanCards current={signedIn ? sub?.tier : undefined} action={(tier, isCurrent) => {
        if (isCurrent) return <Link className="secondary-button here-btn" href="/profile#plan">Your plan · manage</Link>;
        if (tier === "free") return signedIn ? <span className="here">Free to start</span> : <Link className="secondary-button" href="/auth">Start free</Link>;
        const cls = tier === "pro" ? "accent-button" : "secondary-button";
        if (!signedIn) return <Link className={cls} href="/auth?next=/pricing">Choose {PLANS[tier].name}</Link>;
        if (sub && sub.tier !== "free") return sub.portalUrl ? <a className="secondary-button" href={sub.portalUrl} target="_blank" rel="noreferrer">Change in billing</a> : <span className="here">Change in billing</span>;
        return <button className={cls} disabled={buying !== null || sub === null} onClick={() => void buy(tier)}>{buying === tier ? "Opening…" : `Choose ${PLANS[tier].name}`}</button>;
      }} />
      {error && <p className="profile-note bad" role="alert">{error}</p>}
    </>
  );
}

/** The hero's buttons and, for someone signed in, a line saying which plan they are on and what is left. */
export function PricingHero() {
  const signedIn = useSignedIn();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [tokens, setTokens] = useState<TokenSummary | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    void getMySubscription().then(setSub).catch(() => undefined);
    void getMyTokens().then(setTokens).catch(() => undefined);
  }, [signedIn]);
  return (
    <>
      {signedIn && sub && (
        <div className="your-plan" role="status">
          <span className="plan-chip pro">{PLANS[sub.tier].name} plan</span>
          {tokens && <span>{Math.round(Math.max(tokens.remaining, 0) * 100) / 100} tokens left</span>}
          <Link href="/profile#plan">Manage</Link>
        </div>
      )}
      <div className="hero-actions">
        {signedIn ? <Link className="accent-button" href="/studio">Open Studio</Link> : <Link className="accent-button" href="/auth">Start free</Link>}
        <a className="secondary-button" href="#plans">See plans</a>
      </div>
    </>
  );
}
