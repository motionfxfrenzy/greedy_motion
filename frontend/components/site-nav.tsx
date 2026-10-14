"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "../utils/supabase/client";
import { AccountMenu } from "./account-menu";
import { ThemeToggle } from "./theme-toggle";

/** Whether someone is signed in: `null` until the browser has asked, so the page never flashes the wrong buttons. */
export function useSignedIn(): boolean | null {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void createClient().auth.getSession().then(({ data }) => { if (live) setSignedIn(Boolean(data.session)); }).catch(() => { if (live) setSignedIn(false); });
    return () => { live = false; };
  }, []);
  return signedIn;
}

/**
 * The top bar of every public page (pricing, about, policies): the same floating bar as the home page, so moving between
 * them feels like one site. Signed out it offers sign in; signed in it shows the workspace links and the account menu.
 */
export function SiteNav({ active }: { active?: "pricing" }) {
  const signedIn = useSignedIn();
  return (
    <header className="site-nav-wrap">
      <div className="site-nav">
        <Link href="/" className="site-brand" aria-label="Greedy Motion home"><img src="/brand/gm-mark.svg" alt="" /><span><b>Greedy</b> <em>Motion</em></span></Link>
        <nav className="site-links" aria-label="Main">
          {signedIn === true ? <Link href="/studio">Projects</Link> : <><Link href="/#how">How it works</Link><Link href="/#features">Features</Link></>}
          <Link href="/pricing" aria-current={active === "pricing" ? "page" : undefined} className={active === "pricing" ? "on" : ""}>Pricing</Link>
        </nav>
        <div className="site-right">
          {signedIn === true ? <AccountMenu /> : (
            <>
              <ThemeToggle />
              <span className="site-auth" style={{ visibility: signedIn === null ? "hidden" : "visible" }}>
                <Link href="/auth" className="site-signin">Sign in</Link>
                <Link href="/auth" className="primary-button">Create account</Link>
              </span>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
