"use client";

import {
  PLAN_TIERS,
  PLANS,
  annualMonthlyUsd,
  annualSavingsPercent,
  annualSavingsUsd,
  filmsFromTokens,
  isPaidTier,
  tokenPriceUsd,
  type BillingInterval,
  type PlanTier
} from "@videosaas/contracts";
import Link from "next/link";
import { appHref } from "../lib/hosts";
import { useEffect, useState, type ReactNode } from "react";
import { getMySubscription, getMyTokens, startCheckout, type Subscription, type TokenSummary } from "../lib/api";
import { useSignedIn } from "./site-nav";

/** How many films of `length` seconds a token balance makes. */
export const filmsFrom = (tokens: number, length = 30) => filmsFromTokens(tokens, length);

const formatUsd = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
const formatTokenUsd = (n: number) => `$${n.toFixed(3)}`;

/** The four plans side by side. Inspired by Vimeo and Calendly: clear billing cadence, prominent action, token economics, and feature checkmarks. */
export function PlanCards({
  current,
  currentInterval,
  interval = "month",
  action
}: {
  current?: PlanTier;
  currentInterval?: BillingInterval | null;
  interval?: BillingInterval;
  action: (tier: PlanTier, isCurrent: boolean) => ReactNode;
}) {
  return (
    <div className="plan-grid">
      {PLAN_TIERS.map((tier) => {
        const plan = PLANS[tier];
        const isCurrent = current === tier && (tier === "free" || !currentInterval || currentInterval === interval);
        const films30 = filmsFrom(plan.tokens, 30);
        const films60 = filmsFrom(plan.tokens, 60);
        const paid = isPaidTier(tier);
        const annual = interval === "year" && paid;
        const headlinePrice = !paid ? "$0" : annual ? formatUsd(annualMonthlyUsd(tier)) : formatUsd(plan.priceUsd);
        const perToken = paid ? formatTokenUsd(tokenPriceUsd(tier, interval)) : null;

        return (
          <article key={tier} className={`plan-card${tier === "pro" ? " featured" : ""}${isCurrent ? " current" : ""}`} aria-label={`${plan.name} plan`}>
            {isCurrent ? <span className="plan-flag mine">Your plan</span> : tier === "pro" && <span className="plan-flag">Most chosen</span>}
            <div className="plan-card-top">
              <h3>{plan.name}</h3>
              <p className="plan-blurb">{plan.blurb}</p>
            </div>
            <div className="plan-price-block">
              <p className="plan-price">
                {annual && <s className="plan-price-strike">${plan.priceUsd}</s>}
                <b>{headlinePrice}</b>
                {paid ? <span> / month</span> : <span> to start</span>}
              </p>
              <p className="plan-billing-note">
                {!paid
                  ? "No credit card required"
                  : annual
                    ? `$${plan.annualPriceUsd} billed once a year · Save $${annualSavingsUsd(tier)} (${annualSavingsPercent(tier)}%)`
                    : `Billed monthly · or $${plan.annualPriceUsd}/yr ($${annualMonthlyUsd(tier).toFixed(2)}/mo) on annual`}
              </p>
            </div>
            <div className="plan-action">{action(tier, isCurrent)}</div>
            <div className="plan-gets" aria-label="What it includes">
              <div className="plan-gets-main">
                <b>{films30} {films30 === 1 ? "film" : "films"}</b>
                <span>of 30 seconds {tier === "free" ? "in total" : "each month"}</span>
              </div>
              <small>
                {plan.tokens.toLocaleString()} tokens{tier === "free" ? ", once" : " a month"}
                {paid && films60 > 0 ? ` · about ${films60} one-minute films` : ""}
              </small>
              {perToken && <span className="plan-token-rate">{perToken} per token</span>}
            </div>
            <ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
          </article>
        );
      })}
    </div>
  );
}

/** The public pricing page's plans with the Monthly / Annual switch. */
export function PricingPlans() {
  const signedIn = useSignedIn();
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [sub, setSub] = useState<Subscription | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    void getMySubscription().then((s) => {
      setSub(s);
      if (s.interval === "year") setInterval("year");
    }).catch(() => undefined);
  }, [signedIn]);

  const buy = async (tier: "starter" | "pro" | "business") => {
    setBuying(tier); setError(null);
    try { window.location.assign(await startCheckout(tier, interval)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not open checkout."); setBuying(null); }
  };

  return (
    <section className="pricing-plans-section" aria-label="Plans">
      <div className="billing-toggle-wrap">
        <div className="billing-toggle" role="radiogroup" aria-label="Billing period">
          <button
            type="button"
            role="radio"
            aria-checked={interval === "month"}
            className={interval === "month" ? "on" : ""}
            onClick={() => setInterval("month")}
          >
            Monthly
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={interval === "year"}
            className={interval === "year" ? "on" : ""}
            onClick={() => setInterval("year")}
          >
            Annual
            <span className="billing-save-pill">2 months free · Save 17%</span>
          </button>
        </div>
        <p className="billing-toggle-note">Annual plans give the same tokens every month. You pay for 10 months and get 12.</p>
      </div>
      <PlanCards
        current={signedIn ? sub?.tier : undefined}
        currentInterval={signedIn ? (sub?.interval ?? "month") : undefined}
        interval={interval}
        action={(tier, isCurrent) => {
          if (isCurrent) return <Link className="secondary-button here-btn" href={appHref("/profile#plan")}>Your plan · manage</Link>;
          if (tier === "free") return signedIn ? <span className="here">Free to start</span> : <Link className="secondary-button" href={appHref("/auth")}>Start free</Link>;
          const cls = tier === "pro" ? "accent-button" : "secondary-button";
          if (!signedIn) return <Link className={cls} href={appHref("/auth?next=/pricing")}>Choose {PLANS[tier].name}</Link>;
          if (sub && sub.tier !== "free") return sub.portalUrl ? <a className="secondary-button" href={sub.portalUrl} target="_blank" rel="noreferrer">Change in billing</a> : <span className="here">Change in billing</span>;
          return <button className={cls} disabled={buying !== null || sub === null} onClick={() => void buy(tier)}>{buying === tier ? "Opening…" : `Choose ${PLANS[tier].name}`}</button>;
        }}
      />
      {error && <p className="profile-note bad" role="alert">{error}</p>}
    </section>
  );
}

/** The hero's lead/status line and buttons. Signed in, it shows the user's current plan, remaining tokens and next reset date. */
export function PricingHero() {
  const signedIn = useSignedIn();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [tokens, setTokens] = useState<TokenSummary | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    void getMySubscription().then(setSub).catch(() => undefined);
    void getMyTokens().then(setTokens).catch(() => undefined);
  }, [signedIn]);
  const resetIso = sub?.tokensResetAt ?? sub?.renewsAt ?? null;
  const resetText = resetIso ? new Date(resetIso).toLocaleDateString(undefined, { month: "long", day: "numeric" }) : null;
  return (
    <>
      {signedIn && sub ? (
        <div className="your-plan" role="status">
          <span className={`plan-chip${sub.tier !== "free" ? " pro" : ""}`}>You&apos;re on the {PLANS[sub.tier].name} plan</span>
          {tokens && <span>{Math.round(Math.max(tokens.remaining, 0) * 100) / 100} tokens left</span>}
          {resetText && <span>resets {resetText}</span>}
          <Link href={appHref("/profile#plan")}>Manage</Link>
        </div>
      ) : (
        <p className="lead">Make a real product film with no card. When you want more, pick a plan or top up: a film takes a few tokens to start and a few more for every second you make, and you see the price before you render.</p>
      )}
      <div className="hero-actions">
        {signedIn ? <Link className="accent-button" href={appHref("/studio")}>Open Studio</Link> : <Link className="accent-button" href={appHref("/auth")}>Start free</Link>}
        <a className="secondary-button" href="#plans">See plans</a>
      </div>
    </>
  );
}
