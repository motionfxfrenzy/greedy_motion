"use client";

import Link from "next/link";
import { useState } from "react";
import { FREE_REVISIONS, MILLITOKENS_PER_SECOND, PAID_TIERS, PLANS, PLAN_TIERS, PREVIEW_ALLOWANCE, REVISION_TOKENS, START_FEE_MILLITOKENS, TOKEN_USD, TOP_UP, filmsFromTokens, materialCostMillitokens, renderCostMillitokens, tokensFromMilli, type PlanTier } from "@videosaas/contracts";

const LENGTHS = [15, 30, 60] as const;
const plain = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

/** Answers "which plan?" from what the person makes. Everything it says is computed from the plan list. */
export function PlanFinder() {
  const [films, setFilms] = useState(8);
  const [length, setLength] = useState<(typeof LENGTHS)[number]>(30);
  const seconds = films * length;
  const needed = films * tokensFromMilli(renderCostMillitokens(length)); // tokens a month: each film costs its start fee plus its seconds
  const plan = PAID_TIERS.find((tier) => PLANS[tier].tokens >= needed);
  const top = PLANS.business;
  const packs = plan ? 0 : Math.ceil((needed - top.tokens) / TOP_UP.tokens);
  const chosen = PLANS[plan ?? "business"];
  const monthly = chosen.priceUsd + packs * TOP_UP.priceUsd;
  const minutes = Math.round((seconds / 60) * 10) / 10;
  return (
    <section className="finder" aria-labelledby="finder-title">
      <div className="finder-inputs">
        <h2 id="finder-title">Not sure which plan?</h2>
        <p>Tell us what you make in a month.</p>
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
        <small>About {minutes} minutes of video a month</small>
        <b>{chosen.name}{packs > 0 ? ` + ${packs} token ${packs === 1 ? "pack" : "packs"}` : ""}</b>
        <span className="finder-price">${monthly}<i> / month</i></span>
        <Link className="accent-button" href="/profile#plan">{plan ? `Choose ${chosen.name}` : "Choose Business"}</Link>
      </div>
    </section>
  );
}

/** What things cost in tokens: the figures the render, the generated scenes and the changes are charged with, computed from the price list. */
export function TokenCosts() {
  const film = (seconds: number) => plain(tokensFromMilli(renderCostMillitokens(seconds)));
  const usd = (tokens: number) => `$${(Math.round(tokens * TOKEN_USD * 100) / 100).toFixed(2)}`;
  const scene = tokensFromMilli(materialCostMillitokens(0.87));
  return (
    <section aria-labelledby="token-costs-title" className="compare">
      <h2 id="token-costs-title">What a film costs in tokens</h2>
      <p className="pricing-fine">A film takes {START_FEE_MILLITOKENS / 1000} tokens to start plus {MILLITOKENS_PER_SECOND / 1000} for each second of finished video. The price is shown before you render and is exactly what is taken. At list price a token is {usd(1)}; on a plan it costs less.</p>
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
    </section>
  );
}

const rows: { label: string; value: (tier: PlanTier) => string }[] = [
  { label: "Price", value: (t) => (PLANS[t].priceUsd ? `$${PLANS[t].priceUsd} / month` : "Free") },
  { label: "Tokens", value: (t) => (t === "free" ? `${plain(PLANS[t].tokens)}, once` : `${PLANS[t].tokens.toLocaleString()} each month`) },
  { label: "Films of 30 seconds", value: (t) => String(filmsFromTokens(PLANS[t].tokens, 30)) + (t === "free" ? " in total" : " a month") },
  { label: "Watermark", value: (t) => (PLANS[t].watermark ? "Yes" : "None") },
  { label: "Pro editor", value: (t) => (PLANS[t].proEditor ? "Included" : "—") },
  { label: "Storyboard, rewrites and brand kits", value: () => "Included" }
];

export function CompareTable() {
  return (
    <section aria-labelledby="compare-title" className="compare">
      <h2 id="compare-title">Compare plans</h2>
      <div className="compare-scroll">
        <table>
          <thead><tr><th scope="col"><span className="sr-only">Feature</span></th>{PLAN_TIERS.map((t) => <th scope="col" key={t} className={t === "pro" ? "hl" : ""}>{PLANS[t].name}</th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th>{PLAN_TIERS.map((t) => <td key={t} className={t === "pro" ? "hl" : ""}>{row.value(t)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

const faq: { q: string; a: string }[] = [
  { q: "What is a token?", a: `Tokens are what you spend to make films. A film takes ${START_FEE_MILLITOKENS / 1000} tokens to start plus ${MILLITOKENS_PER_SECOND / 1000} for every second of finished video, so a 30-second film is ${plain(tokensFromMilli(renderCostMillitokens(30)))} tokens. The price is shown before you render and is the price taken. Trying a film costs nothing: your plan includes ${PREVIEW_ALLOWANCE.starter} to ${PREVIEW_ALLOWANCE.business} previews a month (Free: ${PREVIEW_ALLOWANCE.free}), with the storyboard, voice and motion, and tokens are taken only when you render.` },
  { q: "What if I change my mind after the first version?", a: `The first ${FREE_REVISIONS} changes to a film are included: rebuilding it after an edit, or applying comments in the preview. Each one after that takes ${REVISION_TOKENS} tokens, and a change that does not happen is never charged.` },
  { q: "What do generated scenes cost?", a: `Styles whose scenes are made by an image and video model (clay, paper, footage) are for paid plans and cost ${plain(tokensFromMilli(materialCostMillitokens(0.87)))} tokens a scene, shown before you generate them. They are paid when they are generated, on top of the film.` },
  { q: "What do I get for free?", a: "One finished film of up to 30 seconds for your account, with its storyboard, voice and motion. Free films carry a Greedy Motion watermark. There is no card and no trial that turns into a charge." },
  { q: "Do tokens expire?", a: "Your plan's tokens renew every month. Each renewal starts you again with the full amount, and what you did not use last month does not carry over. Token packs and your free allowance never expire, and a render uses your plan tokens first." },
  { q: "What happens when I run out?", a: `Render tells you how many tokens the film needs and how many you have. Nothing is charged automatically: add a ${TOP_UP.tokens}-token pack for $${TOP_UP.priceUsd} or move to a bigger plan.` },
  { q: "Can I cancel or change my plan?", a: "Yes, any time from billing. A cancelled plan keeps working until the end of the period you paid for, and the tokens you already have stay yours." },
  { q: "Can I get a refund?", a: "Unused prepaid tokens can be refunded within 30 days, under the refund policy. A film that has been delivered is normally not refundable for a change of mind." },
  { q: "What about taxes and payment?", a: "Prices are in US dollars and taxes are added at checkout. Payments are handled by Lemon Squeezy, which is the merchant of record." }
];

export function Faq() {
  return (
    <section aria-labelledby="faq-title" className="faq">
      <h2 id="faq-title">Questions</h2>
      {faq.map((item) => <details key={item.q}><summary>{item.q}</summary><p>{item.a}</p></details>)}
    </section>
  );
}
