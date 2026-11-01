-- "Your film is ready" emails: one row per render job, claimed before the email is sent so a job is mailed once, however
-- many backend replicas hear that it finished. The row is given back when the send fails, so a later pass can retry it.
create table if not exists app.render_ready_emails (
  job_id uuid primary key,
  user_id uuid not null,
  claimed_at timestamptz not null default now()
);

-- Jobs that were already finished when this shipped are marked as handled: nobody gets an email about an old film.
insert into app.render_ready_emails (job_id, user_id)
  select id, owner_id from app.render_jobs where state = 'ready' and owner_id is not null
  on conflict do nothing;
