// The welcome email: sent once per person, from hello@, right after an account is confirmed. "Once" is a row in
// app.welcome_emails claimed before sending and given back if the send fails, so a retry can still deliver it.
import type { MailMessage, MailResult } from "./send.ts";
import { SUPPORT_EMAIL, welcomeEmail } from "./templates.ts";

export type WelcomeDeps = {
  /** True when this call is the first to claim `userId`; false when a welcome was already sent (or is being sent). */
  claim: (userId: string) => Promise<boolean>;
  release: (userId: string) => Promise<void>;
  send: (message: MailMessage) => Promise<MailResult>;
  from: string;
  appUrl: string;
};

export type WelcomeOutcome = { status: "sent"; provider: MailResult["provider"] } | { status: "already_sent" | "no_email" };

export async function sendWelcome(user: { id: string; email?: string; name?: string }, deps: WelcomeDeps): Promise<WelcomeOutcome> {
  if (!user.email) return { status: "no_email" };
  if (!(await deps.claim(user.id))) return { status: "already_sent" };
  try {
    const result = await deps.send({ ...welcomeEmail({ to: user.email, name: user.name, appUrl: deps.appUrl }), from: deps.from, replyTo: SUPPORT_EMAIL });
    return { status: "sent", provider: result.provider };
  } catch (error) {
    await deps.release(user.id).catch(() => undefined);
    throw error;
  }
}
