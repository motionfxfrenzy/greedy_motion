-- Phase 5: content-addressed plate clip cache by (bundle_digest, engine_digest, font_set_digest, size),
-- idempotency key on app.render_jobs, and deprecation comment on app.plate_state.draw_aspects.

create table if not exists app.plate_clips (
  bundle_digest text not null,
  engine_digest text not null,
  font_set_digest text not null,
  size text not null,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  fps integer not null default 30 check (fps > 0),
  frames integer not null check (frames > 0),
  clip_key text not null,
  still_key text,
  clip_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (bundle_digest, engine_digest, font_set_digest, size)
);

create index if not exists plate_clips_clip_key_idx on app.plate_clips (clip_key);

alter table app.render_jobs add column if not exists idempotency_key text;

create unique index if not exists render_jobs_project_idempotency_idx
  on app.render_jobs (project_id, idempotency_key)
  where idempotency_key is not null and project_id is not null;

comment on column app.plate_state.draw_aspects is
  'Deprecated in phase 5 (unused): final renders and companion exports now draw missing clips directly from the frozen manifest; kept in schema without dropping data.';
