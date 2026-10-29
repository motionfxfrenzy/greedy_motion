import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { PaddlePricing } from "../../components/paddle-pricing";
import { PublicLinks } from "../../components/public-links";
import { SiteNav } from "../../components/site-nav";
import { createClient } from "../../utils/supabase/server";
import styles from "../../components/public-page.module.css";

export const metadata: Metadata = { title: "Plans · Greedy Motion" };

// Per request: the visitor's country (from the host's geo header) and, when signed in, their email.
export default async function Plans() {
  // Absent or non-country values (Vercel sends no header locally; some CDNs send XX or T1) are left out so Paddle auto-detects.
  const raw = (await headers()).get("x-vercel-ip-country") ?? "";
  const country = /^[A-Z]{2}$/.test(raw) && raw !== "XX" && raw !== "T1" ? raw : undefined;

  let email: string | undefined;
  let userId: string | undefined;
  try {
    const { data } = await createClient(await cookies()).auth.getUser();
    email = data.user?.email ?? undefined;
    userId = data.user?.id;
  } catch {
    // Signed out, or Supabase not configured here: checkout simply asks for the email.
  }

  return (
    <main className={styles.page}>
      <SiteNav active="pricing" />
      <div className="pricing-page">
        <h1>Choose a plan</h1>
        <PaddlePricing country={country} email={email} userId={userId} />
        <p className="paddle-fine">
          Prices are shown in your local currency where available; taxes are added at checkout. Plans renew automatically until cancelled. By subscribing you agree to our <Link href="/terms">Terms of service</Link>; see our <Link href="/privacy">Privacy notice</Link> and <Link href="/refunds">Refund &amp; cancellation policy</Link>.
        </p>
      </div>
      <footer className={styles.footer}><small>Greedy Motion</small><PublicLinks /></footer>
    </main>
  );
}
