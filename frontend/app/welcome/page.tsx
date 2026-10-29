import type { Metadata } from "next";
import Link from "next/link";
import { appHref } from "../../lib/hosts";
import { PublicLinks } from "../../components/public-links";
import { SiteNav } from "../../components/site-nav";
import styles from "../../components/public-page.module.css";

export const metadata: Metadata = { title: "Welcome · Greedy Motion", robots: { index: false } };

export default function Welcome() {
  return (
    <main className={styles.page}>
      <SiteNav active="pricing" />
      <div className="pricing-page">
        <h1>Welcome to Greedy Motion</h1>
        <p>Your subscription is being set up. It can take a moment to show on your account.</p>
        <Link className="accent-button" href={appHref("/studio")}>Open the Studio</Link>
      </div>
      <footer className={styles.footer}><small>Greedy Motion</small><PublicLinks /></footer>
    </main>
  );
}
