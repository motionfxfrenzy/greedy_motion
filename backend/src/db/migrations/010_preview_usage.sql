-- Preview allowance (docs/PRICING.md). A preview costs us about $0.79 in model calls whether or not a film is ever rendered, so
-- each plan has a number of films a person may work on (storyboard, voice, motion, fixes) in a period: Free once for the account,
-- paid plans each calendar month (UTC). One row per person, period and project: working on a project already counted this period
-- is free of further count, and `calls` is a safety cap on how much one project may use. Period is 'lifetime' (Free) or 'YYYY-MM'.
create table app.preview_usage (
  user_id uuid not null,
  period text not null,
  project_id uuid not null,
  calls integer not null default 1,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (user_id, period, project_id)
);
create index preview_usage_user_period on app.preview_usage (user_id, period);
