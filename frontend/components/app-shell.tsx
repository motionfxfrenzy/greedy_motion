"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { createClient } from "../utils/supabase/client";

export type AppPage = "projects" | "templates" | "brand-kits" | "library";
const pages: { id: AppPage; label: string; href: string }[] = [
  { id: "projects", label: "Projects", href: "/studio" },
  { id: "templates", label: "Templates", href: "/templates" },
  { id: "brand-kits", label: "Brand kits", href: "/brand-kits" },
  { id: "library", label: "Library", href: "/library" }
];

/** The workspace header. Every page is its own route, so a link, a bookmark and the back button all work. */
export function AppHeader({ active }: { active: AppPage }) {
  return <header className="relay-topbar"><Link className="gm-brand" href="/studio"><img src="/brand/gm-mark.svg" alt="" /><span><b>Greedy</b> <em>Motion</em></span></Link><nav>{pages.map((page) => <Link key={page.id} href={page.href} className={active === page.id ? "nav-active" : ""} aria-current={active === page.id ? "page" : undefined}>{page.label}</Link>)}</nav><SignOutButton /></header>;
}

/** A workspace page: the ambient background, the header, then the page. */
export function AppShell({ active, children }: { active: AppPage; children: ReactNode }) {
  return <main className="relay-shell"><div className="ambient ambient-blue" /><div className="ambient ambient-peach" /><AppHeader active={active} />{children}</main>;
}

/** Sign out behind a confirmation, so a stray click does not end the session. */
function SignOutButton() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [leaving, setLeaving] = useState(false);
  const close = () => { if (!leaving) dialogRef.current?.close(); };
  const signOut = async () => {
    setLeaving(true);
    await createClient().auth.signOut().catch(() => undefined);
    window.location.href = "/auth";
  };
  return (
    <>
      <button className="sign-out" onClick={() => dialogRef.current?.showModal()}>Sign out</button>
      <dialog ref={dialogRef} className="confirm-dialog" aria-labelledby="sign-out-title" onCancel={(event) => { if (leaving) event.preventDefault(); }} onClick={(event) => { if (event.target === dialogRef.current) close(); }}>
        <h2 id="sign-out-title">Sign out of Greedy Motion?</h2>
        <p>Your projects are saved. You can sign back in at any time.</p>
        <footer>
          <button className="secondary-button" onClick={close} disabled={leaving}>Cancel</button>
          <button className="primary-button" onClick={() => void signOut()} disabled={leaving} aria-busy={leaving} autoFocus>
            {leaving && <span className="gm-spinner" aria-hidden="true" />}
            {leaving ? "Signing out…" : "Sign out"}
          </button>
        </footer>
      </dialog>
    </>
  );
}
