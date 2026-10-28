import { cookies } from "next/headers";
import { after, NextResponse, type NextRequest } from "next/server";
import { createClient } from "../../../utils/supabase/server";

const backendOrigin = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
// An account created within this long counts as "just signed up" for the welcome email.
const NEW_ACCOUNT_MS = 15 * 60_000;

// Landing point for Google OAuth, email confirmation and password-reset links (PKCE code exchange).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const requestedNext = searchParams.get("next") ?? "";
  // Same-origin relative paths only, so ?next= can't be used as an open redirect.
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/studio";

  if (code) {
    const supabase = createClient(await cookies());
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // A brand-new account (confirmed by email link, or created with Google) gets the one-time welcome email. Returning
      // sign-ins and password resets do not; the backend also sends it only once per person.
      const created = data.user ? Date.parse(data.user.created_at) : 0;
      if (next !== "/auth/reset" && data.session && Date.now() - created < NEW_ACCOUNT_MS) {
        const token = data.session.access_token;
        after(async () => {
          try {
            await fetch(`${backendOrigin}/v1/me/welcome`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
          } catch {
            // The welcome email is a nicety; the account is already confirmed.
          }
        });
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }
  return NextResponse.redirect(`${origin}/auth?error=${next === "/auth/reset" ? "reset" : "callback"}`);
}
