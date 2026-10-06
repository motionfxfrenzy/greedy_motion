-- Durable render jobs. The backend owns planning and writes this row; the render worker
-- (a separate service) claims it by attempt number and reports progress into it.
-- pg-boss keeps its own tables in schema "pgboss"; this table holds the product-facing job view.
create schema if not exists app;

create table app.render_jobs (
  id uuid primary key,
  project_id uuid,
  state text not null check (state in ('queued', 'planning', 'rendering', 'ready', 'failed')),
  stage text not null default 'queued',
  progress integer not null default 0 check (progress between 0 and 100),
  -- Fencing token: the render attempt that currently owns the job. Only a worker holding
  -- this attempt may write progress or the result, so a stale or crashed attempt cannot
  -- overwrite a newer one.
  attempt integer not null default 0,
  frames_done integer,
  frames_total integer,
  -- Inputs, persisted so planning and rendering survive a restart of either service.
  request jsonb not null,
  planned_revision jsonb,
  -- The job view returned to the browser (title, scenes, template, values, audio, planner).
  revision jsonb not null,
  -- Everything the worker needs; written by the backend after planning. Never contains secrets.
  render_input jsonb,
  -- { url, format, durationSeconds, file } where file is the attempt's MP4 under the shared renders dir.
  output jsonb,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- When the job entered the render queue; orders the queue position shown to the user.
  render_queued_at timestamptz,
  render_started_at timestamptz,
  finished_at timestamptz
);

create index render_jobs_project_idx on app.render_jobs (project_id, created_at desc);
-- Queue position lookups: renders waiting for a worker, oldest first.
create index render_jobs_waiting_idx on app.render_jobs (render_queued_at) where state = 'rendering' and stage = 'waiting';
