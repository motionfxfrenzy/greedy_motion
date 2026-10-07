import Link from "next/link";

export function PublicLinks() {
  return (
    <nav aria-label="Business and policies" style={{ display: "flex", flexWrap: "wrap", gap: "12px 20px", fontSize: "14px" }}>
      <Link href="/about">About</Link>
      <Link href="/privacy">Privacy</Link>
      <Link href="/terms">Terms</Link>
      <Link href="/refunds">Refunds &amp; cancellation</Link>
      <Link href="/contact">Contact</Link>
    </nav>
  );
}
