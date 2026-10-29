"use client";

import { initializePaddle, type Paddle } from "@paddle/paddle-js";
import { useEffect, useState } from "react";
import { paddleEnv } from "../lib/paddle-env";
import { TIERS } from "../lib/paddle-tiers";

type Cycle = "month" | "year";

/** Paddle's own formatted total for each price id. Shown as returned: no maths, no re-formatting. */
type Totals = Record<string, string>;

export function PaddlePricing({ country, email, userId }: { country?: string; email?: string; userId?: string }) {
  const [paddle, setPaddle] = useState<Paddle>();
  const [totals, setTotals] = useState<Totals>();
  const [cycle, setCycle] = useState<Cycle>("month");
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { environment, token } = paddleEnv();
        const instance = await initializePaddle({ environment, token });
        if (!instance) throw new Error("Paddle.js did not load.");
        // With no country, Paddle detects the visitor's location from their IP.
        const preview = await instance.PricePreview({
          items: TIERS.flatMap((tier) => [{ priceId: tier.priceId.month, quantity: 1 }, { priceId: tier.priceId.year, quantity: 1 }]),
          ...(country ? { address: { countryCode: country } } : {})
        });
        if (cancelled) return;
        const next: Totals = {};
        for (const line of preview.data.details.lineItems) next[line.price.id] = line.formattedTotals.total;
        setPaddle(instance);
        setTotals(next);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load prices.");
      }
    })();
    return () => { cancelled = true; };
  }, [country]);

  const subscribe = (priceId: string) => {
    if (!paddle) return;
    paddle.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      ...(email ? { customer: { email } } : {}),
      ...(userId ? { customData: { user_id: userId } } : {}),
      settings: { displayMode: "overlay", variant: "one-page", successUrl: `${window.location.origin}/welcome` }
    });
  };

  return (
    <div className="paddle-pricing">
      <div className="paddle-toggle" role="group" aria-label="Billing period">
        <button type="button" aria-pressed={cycle === "month"} onClick={() => setCycle("month")}>Monthly</button>
        <button type="button" aria-pressed={cycle === "year"} onClick={() => setCycle("year")}>Yearly</button>
      </div>
      {error ? <p role="alert" className="paddle-error">{error}</p> : null}
      <div className="paddle-tiers">
        {TIERS.map((tier) => {
          const priceId = tier.priceId[cycle];
          const total = totals?.[priceId];
          return (
            <section key={tier.name} className={`paddle-tier${tier.featured ? " featured" : ""}`}>
              <h2>{tier.name}</h2>
              <p>{tier.description}</p>
              <p className="paddle-price" aria-live="polite">{total ? <>{total}<small> / {cycle === "month" ? "month" : "year"}</small></> : error ? "—" : "…"}</p>
              <ul>{tier.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
              <button type="button" className="accent-button" disabled={!paddle || !total} onClick={() => subscribe(priceId)}>Subscribe</button>
            </section>
          );
        })}
      </div>
    </div>
  );
}
