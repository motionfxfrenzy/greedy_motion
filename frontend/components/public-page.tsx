import type { ReactNode } from "react";
import Link from "next/link";
import { businessProfile, missingBusinessFacts } from "../lib/business-profile";
import { PublicLinks } from "./public-links";
import styles from "./public-page.module.css";

export function PublicPage({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const isDraft = businessProfile.publicationStatus === "draft";
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Greedy Motion home">
          <img src="/brand/gm-mark.svg" alt="" />
          <span>Greedy <em>Motion</em></span>
        </Link>
        <Link href="/" className={styles.back}>Back to home</Link>
      </header>
      <div className={styles.content}>
        <div className={styles.intro}>
          <span className={styles.eyebrow}>Greedy Motion</span>
          <h1>{title}</h1>
          <p>{description}</p>
          <p>Last updated: October 7, 2026</p>
        </div>
        {isDraft && (
          <aside className={styles.draft} aria-label="Draft notice">
            <strong>Draft for owner review — not published terms.</strong>
            <p>Awaiting confirmation: {missingBusinessFacts().join(", ")}.</p>
          </aside>
        )}
        <article className={styles.article}>
          {businessProfile.operatorName && (
            <div className={styles.operator}>
              <p>Greedy Motion is operated by {businessProfile.operatorName}, {businessProfile.operatorCountry}.</p>
              {businessProfile.supportEmail && <a href={`mailto:${businessProfile.supportEmail}`}>{businessProfile.supportEmail}</a>}
            </div>
          )}
          {children}
        </article>
      </div>
      <footer className={styles.footer}>
        <small>Greedy Motion</small>
        <PublicLinks />
      </footer>
    </main>
  );
}
