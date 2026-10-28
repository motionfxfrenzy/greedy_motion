// Transactional email: Resend first, Brevo when Resend fails (rate limit, daily or monthly quota, outage, timeout, anything).
// Takes its keys as arguments so it can be tested with a fake `fetch` and no environment.

/** `from` overrides the mailer's default sender (account emails use noreply@, the welcome email hello@); `replyTo` is where replies go. */
export type MailMessage = { to: string; subject: string; html: string; text: string; from?: string; replyTo?: string };
export type MailResult = { provider: "resend" | "brevo"; id: string; fellBackFrom?: string };
type Attempt = { provider: "resend" | "brevo"; reason: string };

export class MailError extends Error {
  attempts: Attempt[];
  constructor(attempts: Attempt[]) {
    super(attempts.length ? `Email not sent: ${attempts.map((a) => `${a.provider}: ${a.reason}`).join("; ")}` : "Email is not configured: set RESEND_API_KEY and/or BREVO_API_KEY.");
    this.attempts = attempts;
  }
}

export type MailerOptions = { resendApiKey: string; brevoApiKey: string; from: string; fetch?: typeof fetch; timeoutMs?: number };

/** "GreedyMotion <hello@greedymotion.com>" -> { name, email }; a bare address has no name. */
export function parseFrom(from: string) {
  const match = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(from);
  return match ? { name: match[1]?.trim() || undefined, email: match[2].trim() } : { name: undefined, email: from.trim() };
}

const reasonOf = async (response: Response) => {
  const body = (await response.text().catch(() => "")).slice(0, 200).replace(/\s+/g, " ");
  return `HTTP ${response.status}${body ? ` ${body}` : ""}`;
};

export function createMailer(options: MailerOptions) {
  const doFetch = options.fetch ?? fetch;
  const timeout = () => AbortSignal.timeout(options.timeoutMs ?? 10_000);

  const viaResend = async (message: MailMessage): Promise<string> => {
    const response = await doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${options.resendApiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: message.from ?? options.from, to: [message.to], subject: message.subject, html: message.html, text: message.text, ...(message.replyTo ? { reply_to: message.replyTo } : {}) }),
      signal: timeout()
    });
    if (!response.ok) throw new Error(await reasonOf(response));
    return String(((await response.json()) as { id?: string }).id ?? "");
  };

  const viaBrevo = async (message: MailMessage): Promise<string> => {
    const response = await doFetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": options.brevoApiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender: parseFrom(message.from ?? options.from), to: [{ email: message.to }], subject: message.subject, htmlContent: message.html, textContent: message.text, ...(message.replyTo ? { replyTo: { email: message.replyTo } } : {}) }),
      signal: timeout()
    });
    if (!response.ok) throw new Error(await reasonOf(response));
    return String(((await response.json()) as { messageId?: string }).messageId ?? "");
  };

  /** Send through Resend; if it fails for any reason, send the same message through Brevo. Throws MailError when nothing could send. */
  return async function send(message: MailMessage): Promise<MailResult> {
    const attempts: Attempt[] = [];
    const providers = [
      ...(options.resendApiKey ? [{ provider: "resend" as const, run: viaResend }] : []),
      ...(options.brevoApiKey ? [{ provider: "brevo" as const, run: viaBrevo }] : [])
    ];
    for (const { provider, run } of providers) {
      try {
        const id = await run(message);
        return { provider, id, ...(attempts.length ? { fellBackFrom: attempts.map((a) => `${a.provider} (${a.reason})`).join("; ") } : {}) };
      } catch (error) {
        attempts.push({ provider, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    throw new MailError(attempts);
  };
}
