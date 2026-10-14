import type { Metadata } from "next";
import Link from "next/link";
import { CompareTable, Faq, PlanFinder } from "../../components/pricing-extras";
import { PricingHero, PricingPlans } from "../../components/plan-cards";
import { PublicLinks } from "../../components/public-links";
import { SiteNav } from "../../components/site-nav";
import styles from "../../components/public-page.module.css";

export const metadata: Metadata = { title: "Pricing — Greedy Motion", description: "Start free with 30 seconds of video. Paid plans from $19 a month, priced in tokens." };

export default function Pricing() {
  return (
    <main className={styles.page}>
      <SiteNav active="pricing" />
      <div className="pricing-page">
        <section className="pricing-hero">
          <span className="pricing-kicker">Pricing</span>
          <h1>Your first 30 seconds are free.</h1>
          <p className="lead">Make a real product film with no card. When you want more, pick a plan or top up: you only pay for the seconds you make.</p>
          <PricingHero />
        </section>
        <PlanFinder />
        <div id="plans" className="plans-anchor"><PricingPlans /></div>
        <CompareTable />
        <Faq />
        <section className="closing">
          <h2>Ready to see your product in motion?</h2>
          <div className="hero-actions"><Link className="accent-button" href="/auth">Start free</Link><Link className="secondary-button" href="/profile#plan">Choose a plan</Link></div>
          <p className="pricing-fine">Prices are in US dollars. Taxes are added at checkout. Unused prepaid tokens can be refunded within 30 days under the <Link href="/refunds">refund policy</Link>.</p>
        </section>
      </div>
      <footer className={styles.footer}><small>Greedy Motion</small><PublicLinks /></footer>
    </main>
  );
}
