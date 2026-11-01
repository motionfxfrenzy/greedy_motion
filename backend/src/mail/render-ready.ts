// The "your film is ready" email. "Once per job" is a row in app.render_ready_emails claimed before sending and given back
// if the send fails, so a retry can still deliver it. Everything it needs comes in as `deps`, so it runs under test with
// fakes; render-ready-watch.ts wires it to the database and to the render events.
import type { MailMessage, MailResult } from "./send.ts";
import { SUPPORT_EMAIL, renderReadyEmail } from "./templates.ts";

export type ReadyDeps = {
  /** True when this call is the first to claim `jobId`; false when it was already mailed (or is being mailed). */
  claim: (jobId: string, userId: string) => Promise<boolean>;
  release: (jobId: string) => Promise<void>;
  send: (message: MailMessage) => Promise<MailResult>;
  from: string;
  appUrl: string;
};

export type ReadyJob = { id: string; userId: string; email?: string | null; name?: string | null; title?: string | null };
export type ReadyOutcome = { status: "sent"; provider: MailResult["provider"] } | { status: "already_sent" | "no_email" };

export async function sendRenderReady(job: ReadyJob, deps: ReadyDeps): Promise<ReadyOutcome> {
  if (!job.email) return { status: "no_email" };
  if (!(await deps.claim(job.id, job.userId))) return { status: "already_sent" };
  try {
    const result = await deps.send({ ...renderReadyEmail({ to: job.email, name: job.name ?? undefined, title: job.title ?? undefined, appUrl: deps.appUrl }), from: deps.from, replyTo: SUPPORT_EMAIL });
    return { status: "sent", provider: result.provider };
  } catch (error) {
    await deps.release(job.id).catch(() => undefined);
    throw error;
  }
}
