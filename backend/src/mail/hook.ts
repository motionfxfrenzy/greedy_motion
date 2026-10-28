// Supabase "Send Email" auth hook: Supabase stops sending its own auth emails and posts each one here instead
// (Authentication > Auth Hooks). The call is signed with the Standard Webhooks scheme, so it is verified, not signed-in.
import { createHmac, timingSafeEqual } from "node:crypto";
import { authActions, authEmail, SITE_URL, type AuthAction } from "./templates.ts";
import type { MailMessage } from "./send.ts";

const TOLERANCE_SECONDS = 300;

/** Standard Webhooks check: HMAC-SHA256 over `${id}.${timestamp}.${body}`, keyed by the base64 part of `v1,whsec_<key>`. */
export function validHookSignature(raw: Buffer, headers: Record<string, unknown>, secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signatures = headers["webhook-signature"];
  if (!secret || typeof id !== "string" || typeof timestamp !== "string" || typeof signatures !== "string") return false;
  const sent = Number.parseInt(timestamp, 10);
  if (!Number.isInteger(sent) || Math.abs(nowSeconds - sent) > TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.replace(/^v1,/, "").replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.`).update(raw).digest();
  return signatures.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export type HookPayload = {
  user?: { email?: string; user_metadata?: { full_name?: string } };
  email_data?: { token?: string; token_hash?: string; redirect_to?: string; email_action_type?: string };
};

export class HookError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Turn what Supabase posted into the email to send. `supabaseUrl` is the project URL the link verifies against. */
export function emailFromHook(payload: HookPayload, supabaseUrl: string, expiresMinutes?: number): MailMessage {
  const to = payload.user?.email;
  const data = payload.email_data;
  const action = data?.email_action_type as AuthAction | undefined;
  if (!to || !data?.token || !data.token_hash || !action) throw new HookError(400, "The hook payload is missing the address, code or action.");
  if (!authActions.includes(action)) throw new HookError(400, `No GreedyMotion email for "${action}" yet.`);
  const params = new URLSearchParams({ token: data.token_hash, type: action });
  if (data.redirect_to) params.set("redirect_to", data.redirect_to);
  const link = `${supabaseUrl}/auth/v1/verify?${params}`;
  // The copy page lives on the site the person signed up on, which Supabase gives us as the redirect target.
  const origin = (() => { try { return new URL(data.redirect_to ?? "").origin; } catch { return SITE_URL; } })();
  return authEmail({ action, to, code: data.token, link, name: payload.user?.user_metadata?.full_name, expiresMinutes, copyLink: `${origin}/auth/link?u=${encodeURIComponent(link)}` });
}
