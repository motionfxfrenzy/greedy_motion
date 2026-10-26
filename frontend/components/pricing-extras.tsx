"use client";

import Link from "next/link";
import { useState } from "react";
import { PAID_TIERS, PLANS, PLAN_TIERS, TOP_UP, secondsFromTokens, type PlanTier } from "@videosaas/contracts";

const LENGTHS = [15, 30, 60] as const;
const plain = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

/** Answers "which plan?" from what the person makes. Everything it says is computed from the plan list. */
export function PlanFinder() {
  const [films, setFilms] = useState(8);
  const [length, setLength] = useState<(typeof LENGTHS)[number]>(30);
  const seconds = films * length;
  const needed = seconds / 4; // tokens a month at four seconds a token
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

const rows: { label: string; value: (tier: PlanTier) => string }[] = [
  { label: "Price", value: (t) => (PLANS[t].priceUsd ? `$${PLANS[t].priceUsd} / month` : "Free") },
  { label: "Tokens", value: (t) => (t === "free" ? `${plain(PLANS[t].tokens)}, once` : `${PLANS[t].tokens.toLocaleString()} each month`) },
  { label: "Films of 30 seconds", value: (t) => String(Math.floor(secondsFromTokens(PLANS[t].tokens) / 30)) + (t === "free" ? " in total" : " a month") },
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
  { q: "What is a token?", a: "Tokens are what you spend to make films. Every plan comes with a token balance, and the length of the finished film decides how many tokens it uses. Writing the storyboard and rewriting frames cost nothing." },
  { q: "What do I get for free?", a: "30 seconds of finished video for your account, in one film or several. Free films carry a Greedy Motion watermark. There is no card and no trial that turns into a charge." },
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
