"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AccountMenu } from "./account-menu";

export type AppPage = "projects" | "templates" | "brand-kits" | "library" | "profile";
const pages: { id: Exclude<AppPage, "profile">; label: string; href: string }[] = [
  { id: "projects", label: "Projects", href: "/studio" },
  { id: "templates", label: "Templates", href: "/templates" },
  { id: "brand-kits", label: "Brand kits", href: "/brand-kits" },
  { id: "library", label: "Library", href: "/library" }
];

/** The workspace header. Every page is its own route, so a link, a bookmark and the back button all work. */
export function AppHeader({ active }: { active: AppPage }) {
  return <header className="relay-topbar"><Link className="gm-brand" href="/studio"><img src="/brand/gm-mark.svg" alt="" /><span><b>Greedy</b> <em>Motion</em></span></Link><nav>{pages.map((page) => <Link key={page.id} href={page.href} className={active === page.id ? "nav-active" : ""} aria-current={active === page.id ? "page" : undefined}>{page.label}</Link>)}</nav><AccountMenu /></header>;
}

/** A workspace page: the ambient background, the header, then the page. */
export function AppShell({ active, children }: { active: AppPage; children: ReactNode }) {
  return <main className="relay-shell"><div className="ambient ambient-blue" /><div className="ambient ambient-peach" /><AppHeader active={active} />{children}</main>;
}
