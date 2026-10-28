import Link from "next/link";
import { CopyLink } from "../../../components/copy-link";
import { EMAIL_CODE_MINUTES } from "../../../lib/password";

export const metadata = { title: "Copy your link", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

// Opened from the "Copy link" button in the confirmation email. Only this project's own Supabase verify URL is shown,
// so the page cannot be pointed at anyone else's link.
const supabaseVerify = `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "")}/auth/v1/verify?`;

export default async function CopyLinkPage({ searchParams }: { searchParams: Promise<{ u?: string | string[] }> }) {
  const { u } = await searchParams;
  const link = typeof u === "string" && supabaseVerify.length > 20 && u.startsWith(supabaseVerify) ? u : null;

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--d-bg-ebf5ff)", color: "var(--d-tx-0a0d12)", padding: "24px" }}>
      <section style={{ width: "100%", maxWidth: "520px", display: "flex", flexDirection: "column", gap: "18px", padding: "32px", borderRadius: "24px", background: "var(--d-bg-fafdff)", border: "1px solid var(--d-bd-e1eaf4)" }}>
        <Link href="/" className="site-brand" aria-label="Greedy Motion home" style={{ alignSelf: "center", textDecoration: "none" }}><img src="/brand/gm-mark.svg" alt="" /><span><b>Greedy</b> <em>Motion</em></span></Link>
        {link ? (
          <>
            <h1 style={{ margin: 0, fontWeight: 600, fontSize: "26px", letterSpacing: "-0.03em" }}>Copy your link</h1>
            <p style={{ margin: 0, fontSize: "15px", lineHeight: 1.5, color: "var(--d-tx-535862)" }}>
              Paste it into the browser where you signed up or asked for the reset, not a mail app’s built-in browser. It stops working {EMAIL_CODE_MINUTES} minutes after the email was sent.
            </p>
            <CopyLink link={link} />
          </>
        ) : (
          <>
            <h1 style={{ margin: 0, fontWeight: 600, fontSize: "26px", letterSpacing: "-0.03em" }}>This link isn’t valid</h1>
            <p style={{ margin: 0, fontSize: "15px", lineHeight: 1.5, color: "var(--d-tx-535862)" }}>
              Open the button from the email again, or <Link href="/auth">request a new email</Link>.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
