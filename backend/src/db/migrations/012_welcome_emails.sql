-- The welcome email goes out once per person (mail/welcome.ts). A row is claimed before the send and deleted if the send
-- fails, so a person is never welcomed twice and a failed send can be tried again.
create table app.welcome_emails (
  user_id uuid primary key,
  sent_at timestamptz not null default now()
);
