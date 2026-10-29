import type { Metadata } from "next";
import Link from "next/link";
import { appHref } from "../../lib/hosts";
import { CompareTable, Faq, PlanFinder, TokenCosts } from "../../components/pricing-extras";
import { PricingHero, PricingPlans } from "../../components/plan-cards";
import { PublicLinks } from "../../components/public-links";
import { SiteNav } from "../../components/site-nav";
import styles from "../../components/public-page.module.css";

export const metadata: Metadata = { title: "Pricing · Greedy Motion", description: "Start free with a 30-second film. Paid plans from $19 a month ($15.83/mo billed annually), priced in tokens." };

export default function Pricing() {
  return (
    <main className={styles.page}>
      <SiteNav active="pricing" />
      <div className="pricing-page">
        <section className="pricing-hero">
          <span className="pricing-kicker">Pricing</span>
          <h1>Your first film is free.</h1>
          <PricingHero />
        </section>
        <div id="plans" className="plans-anchor"><PricingPlans /></div>
        <PlanFinder />
        <TokenCosts />
        <CompareTable />
        <Faq />
        <section className="closing">
          <h2>Ready to see your product in motion?</h2>
          <div className="hero-actions"><Link className="accent-button" href={appHref("/auth")}>Start free</Link><a className="secondary-button" href="#plans">Choose a plan</a></div>
          <p className="pricing-fine">Prices are in US dollars. Taxes are added at checkout. Unused prepaid tokens can be refunded within 30 days under the <Link href="/refunds">refund policy</Link>.</p>
        </section>
      </div>
      <footer className={styles.footer}><small>Greedy Motion</small><PublicLinks /></footer>
    </main>
  );
}
