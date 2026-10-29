"use client";

import Link from "next/link";
import { appHref } from "../lib/hosts";
import { useState } from "react";
import {
  FREE_REVISIONS,
  MILLITOKENS_PER_SECOND,
  PAID_TIERS,
  PLANS,
  PLAN_TIERS,
  PREVIEW_ALLOWANCE,
  REVISION_TOKENS,
  START_FEE_MILLITOKENS,
  TOKEN_USD,
  TOP_UP,
  annualMonthlyUsd,
  annualSavingsPercent,
  annualSavingsUsd,
  filmsFromTokens,
  isPaidTier,
  materialCostMillitokens,
  renderCostMillitokens,
  tokenPriceUsd,
  tokensFromMilli,
  type PlanTier
} from "@videosaas/contracts";
import { startCheckout } from "../lib/api";
import { useSignedIn } from "./site-nav";

const LENGTHS = [15, 30, 60] as const;
const plain = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

/** Answers "which plan fits?" from what the person makes. Everything it says is computed from the plan list. */
export function PlanFinder() {
  const [films, setFilms] = useState(8);
  const [length, setLength] = useState<(typeof LENGTHS)[number]>(30);
  const seconds = films * length;
  const needed = films * tokensFromMilli(renderCostMillitokens(length)); // tokens a month: each film costs its start fee plus its seconds
  const plan = PAID_TIERS.find((tier) => PLANS[tier].tokens >= needed);
  const top = PLANS.business;
  const packs = plan ? 0 : Math.ceil((needed - top.tokens) / TOP_UP.tokens);
  const chosenTier = plan ?? "business";
  const chosen = PLANS[chosenTier];
  const monthly = chosen.priceUsd + packs * TOP_UP.priceUsd;
  const annualPerMonth = Math.round((annualMonthlyUsd(chosenTier) + packs * TOP_UP.priceUsd) * 100) / 100;
  const minutes = Math.round((seconds / 60) * 10) / 10;
  return (
    <section className="finder" aria-labelledby="finder-title">
      <div className="finder-inputs">
        <h2 id="finder-title">Which plan fits?</h2>
        <p>Tell us what you make and we&apos;ll pick the plan.</p>
        <label className="finder-range">
          <span>Films a month <b>{films}</b></span>
          <input type="range" min={1} max={120} value={films} onChange={(event) => setFilms(Number(event.target.value))} />
        </label>
        <div className="finder-length" role="radiogroup" aria-label="Length of each film">
          <span>Each film</span>
          {LENGTHS.map((l) => <button key={l} type="button" role="radio" aria-checked={length === l} className={length === l ? "on" : ""} onClick={() => setLength(l)}>{l} sec</button>)}
        </div>
      </div>
      <div className="finder-result" aria-live="polite">
        <small>About {minutes} minutes of video a month · {plain(needed)} tokens</small>
        <b>{chosen.name}{packs > 0 ? ` + ${packs} token ${packs === 1 ? "pack" : "packs"}` : ""}</b>
        <span className="finder-price">${monthly}<i> / month</i></span>
        <span className="finder-annual-note">or ${annualPerMonth.toFixed(2)} / month billed annually</span>
        <a className="accent-button" href="#plans">{plan ? `Choose ${chosen.name}` : `Choose ${PLANS.business.name}`}</a>
      </div>
    </section>
  );
}

/** What things cost in tokens: the figures the render, the generated scenes and the changes are charged with, computed from the price list. */
export function TokenCosts() {
  const signedIn = useSignedIn();
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const film = (seconds: number) => plain(tokensFromMilli(renderCostMillitokens(seconds)));
  const usd = (tokens: number) => `$${(Math.round(tokens * TOKEN_USD * 100) / 100).toFixed(2)}`;
  const scene = tokensFromMilli(materialCostMillitokens(0.87));
  const buyPack = async () => {
    setBuying(true); setError(null);
    try { window.location.assign(await startCheckout("topup")); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not open checkout."); setBuying(false); }
  };
  return (
    <section aria-labelledby="token-costs-title" className="compare">
      <div className="section-head">
        <h2 id="token-costs-title">What a film costs in tokens</h2>
        <p className="pricing-fine">A film takes {START_FEE_MILLITOKENS / 1000} tokens to start plus {MILLITOKENS_PER_SECOND / 1000} for each second of finished video. The price is shown before you render and is exactly what is taken. At list price a token is {usd(1)}; on a plan it costs less.</p>
      </div>
      <div className="compare-scroll">
        <table>
          <thead><tr><th scope="col">What</th><th scope="col">Tokens</th><th scope="col">At list price</th></tr></thead>
          <tbody>
            {[15, 30, 60, 90].map((seconds) => <tr key={seconds}><th scope="row">A {seconds}-second film</th><td>{film(seconds)}</td><td>{usd(Number(film(seconds)))}</td></tr>)}
            <tr><th scope="row">Trying a film (storyboard, voice, motion, preview)</th><td>0</td><td>up to {PREVIEW_ALLOWANCE.free} on Free, {PREVIEW_ALLOWANCE.starter} to {PREVIEW_ALLOWANCE.business} a month on plans</td></tr>
            <tr><th scope="row">Changes after the first version</th><td>{FREE_REVISIONS} included, then {REVISION_TOKENS} each</td><td>{usd(REVISION_TOKENS)} each</td></tr>
            <tr><th scope="row">A generated scene (clay, paper, footage), paid plans</th><td>{plain(scene)}</td><td>{usd(scene)}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="token-pack-callout">
        <div>
          <b>Need more? {TOP_UP.tokens} tokens for ${TOP_UP.priceUsd}, once.</b>
          <p>They never expire. A render uses your monthly plan tokens first and keeps your pack for whenever you need extra.</p>
        </div>
        {signedIn ? (
          <button type="button" className="secondary-button" disabled={buying} onClick={() => void buyPack()}>{buying ? "Opening…" : `Buy ${TOP_UP.tokens}-token pack · $${TOP_UP.priceUsd}`}</button>
        ) : (
          <Link className="secondary-button" href={appHref("/auth?next=/pricing")}>Buy {TOP_UP.tokens} tokens · ${TOP_UP.priceUsd}</Link>
        )}
      </div>
      {error && <p className="profile-note bad" role="alert">{error}</p>}
    </section>
  );
}

const sceneTokens = plain(tokensFromMilli(materialCostMillitokens(0.87)));

const rows: { label: string; value: (tier: PlanTier) => string }[] = [
  { label: "Monthly", value: (t) => (PLANS[t].priceUsd ? `$${PLANS[t].priceUsd}` : "Free") },
  { label: "Annual (paid once)", value: (t) => (isPaidTier(t) ? `$${PLANS[t].annualPriceUsd}` : "-") },
  { label: "Annual per month", value: (t) => (isPaidTier(t) ? `$${annualMonthlyUsd(t).toFixed(2)}` : "-") },
  { label: "You save a year", value: (t) => (isPaidTier(t) ? `$${annualSavingsUsd(t)} (${annualSavingsPercent(t)}%)` : "-") },
  { label: "Per token, monthly", value: (t) => (isPaidTier(t) ? `$${tokenPriceUsd(t, "month").toFixed(3)}` : "-") },
  { label: "Per token, annual", value: (t) => (isPaidTier(t) ? `$${tokenPriceUsd(t, "year").toFixed(3)}` : "-") },
  { label: "Tokens", value: (t) => (t === "free" ? `${plain(PLANS[t].tokens)}, once` : `${PLANS[t].tokens.toLocaleString()} each month`) },
  { label: "Films of 30 seconds", value: (t) => (t === "free" ? "Up to 90 sec, in total" : `${filmsFromTokens(PLANS[t].tokens, 30)} a month`) },
  { label: "Films of 60 seconds", value: (t) => (t === "free" ? "Up to 90 sec" : `${filmsFromTokens(PLANS[t].tokens, 60)} a month`) },
  { label: "Films to try (storyboard, voice, motion)", value: (t) => `${PREVIEW_ALLOWANCE[t]} ${t === "free" ? "in total" : "a month"}` },
  { label: "Changes after the first version", value: () => `${FREE_REVISIONS} included per film, then ${REVISION_TOKENS} tokens each` },
  { label: "Generated scenes (clay, paper, footage)", value: (t) => (t === "free" ? "Paid plans only" : `${sceneTokens} tokens a scene`) },
  { label: "Watermark", value: (t) => (PLANS[t].watermark ? "Yes" : "None") },
  { label: "Storyboard, rewrites and brand kits", value: () => "Included" },
  { label: "Seats", value: () => "1" }
];

export function CompareTable() {
  return (
    <section aria-labelledby="compare-title" className="compare">
      <div className="section-head">
        <h2 id="compare-title">Compare plans</h2>
        <p className="pricing-fine">Annual billing is two months free: pay for 10 months, get 12. Every plan is for one person with one token balance and one brand library.</p>
      </div>
      <div className="compare-scroll">
        <table className="compare-table">
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">Feature</span></th>
              {PLAN_TIERS.map((t) => {
                const plan = PLANS[t];
                return (
                  <th scope="col" key={t} className={t === "pro" ? "hl" : ""}>
                    <div className="compare-col-head">
                      {t === "pro" && <em className="compare-badge">Most chosen</em>}
                      <strong>{plan.name}</strong>
                      <span>{isPaidTier(t) ? `$${plan.priceUsd}/mo · $${annualMonthlyUsd(t).toFixed(2)}/mo annual` : "Free to start"}</span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {PLAN_TIERS.map((t) => <td key={t} className={t === "pro" ? "hl" : ""}>{row.value(t)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const faq: { q: string; a: string }[] = [
  { q: "What is a token?", a: `Tokens are what you spend to make films. A film takes ${START_FEE_MILLITOKENS / 1000} tokens to start plus ${MILLITOKENS_PER_SECOND / 1000} for every second of finished video, so a 30-second film is ${plain(tokensFromMilli(renderCostMillitokens(30)))} tokens. The price is shown before you render and is the price taken. Trying a film costs nothing: your plan includes ${PREVIEW_ALLOWANCE.starter} to ${PREVIEW_ALLOWANCE.business} films to try a month (Free: ${PREVIEW_ALLOWANCE.free}), with the storyboard, voice and motion, and tokens are taken only when you render.` },
  { q: "What do I get for free?", a: `One finished film of up to 90 seconds for your account, with its storyboard, voice and motion, and ${PREVIEW_ALLOWANCE.free} films to try. Free films carry a Greedy Motion watermark. There is no card and no trial that turns into a charge.` },
  { q: "What if I change my mind after the first version?", a: `The first ${FREE_REVISIONS} changes to a film are included: rebuilding it after an edit, or applying comments in the preview. Each one after that takes ${REVISION_TOKENS} tokens, and a change that does not happen is never charged.` },
  { q: "What do generated scenes cost?", a: `Styles whose scenes are made by an image and video model (clay, paper, footage) are for paid plans and cost ${sceneTokens} tokens a scene, shown before you generate them. They are paid when they are generated, on top of the film.` },
  { q: "Do tokens expire?", a: "Your plan's tokens renew every month. Each renewal starts you again with the full amount, and what you did not use last month does not carry over. On an annual plan, your monthly tokens are granted on the same date each month through the year. Token packs and your free allowance never expire, and a render uses your plan tokens first." },
  { q: "What happens when I run out?", a: `Render tells you how many tokens the film needs and how many you have. Nothing is charged automatically: add a ${TOP_UP.tokens}-token pack for $${TOP_UP.priceUsd} or move to a bigger plan.` },
  { q: "Is it for teams?", a: "Each account is for one person: one token balance, one brand library, no seats. Plans differ by how many films you make a month." },
  { q: "Can I cancel or change my plan?", a: "Yes, any time from billing. A cancelled plan keeps working until the end of the period you paid for, and the tokens you already have stay yours." },
  { q: "Can I get a refund?", a: "Unused prepaid tokens can be refunded within 30 days, under the refund policy. A film that has been delivered is normally not refundable for a change of mind. If a film cannot be started, its tokens are returned automatically." },
  { q: "What about taxes and payment?", a: "Prices are in US dollars and taxes are added at checkout. Payments are handled by Lemon Squeezy, which is the merchant of record." }
];

export function Faq() {
  return (
    <section aria-labelledby="faq-title" className="faq-section">
      <div className="faq-intro">
        <span className="pricing-kicker">FAQ</span>
        <h2 id="faq-title">Questions</h2>
        <p>Everything about how tokens, monthly resets, annual billing and refunds work.</p>
        <Link className="secondary-button" href="/contact">Contact support</Link>
      </div>
      <div className="faq">
        {faq.map((item, idx) => <details key={item.q} open={idx === 0}><summary>{item.q}</summary><p>{item.a}</p></details>)}
      </div>
    </section>
  );
}
