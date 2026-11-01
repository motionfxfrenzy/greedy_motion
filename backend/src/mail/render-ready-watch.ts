// Sends "your film is ready" when a render job finishes. Two paths feed the same once-per-job claim:
// - the render events: the job's `done` notification (it arrives from the worker whichever replica hears it), and
// - a slow pass that picks up finished jobs from the last day nobody was mailed about (a missed notification, a restart,
//   an email that failed). Jobs that were already finished before the table existed are marked handled by the migration.
import { query } from "../db/database.ts";
import { config } from "../config.ts";
import { renderEvents } from "../render/events.ts";
import { createMailer, MailError } from "./send.ts";
import { sendRenderReady, type ReadyDeps, type ReadyJob } from "./render-ready.ts";

const PASS_EVERY_MS = 10 * 60_000;
const LOOKBACK = "24 hours";

type Row = { id: string; owner_id: string; title: string | null; email: string | null; name: string | null };

const log = (level: "info" | "warn", event: string, fields: Record<string, unknown> = {}) =>
  console[level === "info" ? "log" : level](JSON.stringify({ level, event, ...fields }));

// A person's address and name come from Supabase's auth.users; a local Postgres has none, so no email goes out there.
// A final render started from a project has no owner of its own: the owner is the project's.
const SELECT = `select j.id, u.id as owner_id, coalesce(nullif(j.revision->>'title', ''), nullif(p.name, '')) as title, u.email, nullif(u.raw_user_meta_data->>'full_name', '') as name
  from app.render_jobs j left join app.projects p on p.id = j.project_id join auth.users u on u.id = coalesce(j.owner_id, p.owner_id)`;

async function authUsersPresent() {
  return Boolean((await query<{ present: boolean }>("select to_regclass('auth.users') is not null as present")).rows[0]?.present);
}

export function startRenderReadyEmails(overrides: { deps?: Partial<ReadyDeps> } = {}) {
  const mailer = createMailer({ resendApiKey: config.mail.resendApiKey, brevoApiKey: config.mail.brevoApiKey, from: config.mail.from });
  const deps: ReadyDeps = {
    claim: async (jobId, userId) => (await query("insert into app.render_ready_emails (job_id, user_id) values ($1, $2) on conflict do nothing returning job_id", [jobId, userId])).rowCount === 1,
    release: async (jobId) => { await query("delete from app.render_ready_emails where job_id = $1", [jobId]); },
    send: mailer,
    from: config.mail.from,
    appUrl: config.mail.appUrl,
    ...overrides.deps
  };
  const configured = Boolean(config.mail.resendApiKey || config.mail.brevoApiKey);
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let usable: boolean | null = null;

  const deliver = async (row: Row) => {
    const job: ReadyJob = { id: row.id, userId: row.owner_id, email: row.email, name: row.name, title: row.title };
    try {
      const outcome = await sendRenderReady(job, deps);
      if (outcome.status === "sent") log("info", "render_ready_email_sent", { jobId: job.id, provider: outcome.provider });
      else if (outcome.status === "no_email") log("warn", "render_ready_email_skipped", { jobId: job.id, reason: "the account has no email address" });
    } catch (error) {
      log("warn", "render_ready_email_failed", { jobId: job.id, message: error instanceof MailError ? error.message : error instanceof Error ? error.message : String(error) });
    }
  };

  const ready = async () => {
    if (!configured || stopped) return false;
    if (usable === null) {
      usable = await authUsersPresent().catch((error) => { log("warn", "render_ready_email_off", { reason: "could not look for auth.users", message: error instanceof Error ? error.message : String(error) }); return false; });
      if (!usable) log("warn", "render_ready_email_off", { reason: "this database has no auth.users, so there are no addresses to mail" });
    }
    return usable;
  };

  const onFinished = async (id: string) => {
    if (!(await ready())) return;
    const { rows } = await query<Row>(`${SELECT} where j.id = $1 and j.state = 'ready'`, [id]).catch((error) => { log("warn", "render_ready_email_lookup_failed", { jobId: id, message: error instanceof Error ? error.message : String(error) }); return { rows: [] as Row[] }; });
    if (rows[0]) await deliver(rows[0]);
  };

  const pass = async () => {
    if (!(await ready())) return;
    const { rows } = await query<Row>(
      `${SELECT} where j.state = 'ready' and j.updated_at > now() - interval '${LOOKBACK}'
         and not exists (select 1 from app.render_ready_emails e where e.job_id = j.id) order by j.updated_at limit 25`
    ).catch((error) => { log("warn", "render_ready_email_pass_failed", { message: error instanceof Error ? error.message : String(error) }); return { rows: [] as Row[] }; });
    for (const row of rows) await deliver(row);
  };

  renderEvents.observe((notice) => { if (notice.stage === "done") void onFinished(notice.id); });
  timer = setInterval(() => void pass(), PASS_EVERY_MS);
  timer.unref();
  // Once shortly after start too, so a film that finished while the backend was restarting is mailed within a minute.
  setTimeout(() => void pass(), 30_000).unref();
  if (!configured) log("warn", "render_ready_email_off", { reason: "RESEND_API_KEY and BREVO_API_KEY are not set" });

  return { pass, onFinished, stop() { stopped = true; if (timer) clearInterval(timer); } };
}
