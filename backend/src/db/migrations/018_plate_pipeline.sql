-- Plate scenes (code-drawn illustration styles) as durable, worker-rendered state.
--
-- Until now a project's scenes lived in a JSON array plus files on the API's disk, drawn by a detached async task in the
-- API process. Now each (scene, aspect ratio) is one row here, its artifacts live in object storage, authoring runs on
-- the `plate-author` queue (backend) and verification/rendering on `plate-render` (worker). Every worker write is fenced:
--   gen            raised each time the row is reset (inputs changed); late writes of an older gen affect zero rows
--   author_owner   the authoring lease holder (backend)
--   render_attempt raised on each worker claim; publication is conditional on it
create table if not exists app.plate_state (
  project_id uuid primary key,
  scenes jsonb not null default '[]'::jsonb,
  comments jsonb not null default '[]'::jsonb,
  lease_owner text,
  running_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table app.plate_state add column if not exists lease_owner text;
alter table app.plate_state add column if not exists subtitles jsonb;
-- Postgres is authoritative: the legacy JSON `scenes` stays only as a record of what existed before this migration.
alter table app.plate_state add column if not exists legacy_scenes jsonb;
update app.plate_state set legacy_scenes = scenes where legacy_scenes is null and scenes <> '[]'::jsonb;

create table if not exists app.plate_variants (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  scene_index integer not null check (scene_index >= 0),
  aspect text not null check (aspect in ('16:9', '9:16', '1:1')),
  signature text not null,
  gen integer not null default 1,
  rev integer not null default 0,
  keyword text not null default '',
  frames integer not null check (frames > 0),
  fps integer not null default 30,
  width integer not null,
  height integer not null,
  state text not null default 'queued' check (state in ('queued', 'authoring', 'bundled', 'rendering', 'drawn', 'failed')),
  stage text,
  frames_done integer,
  author_owner text,
  author_until timestamptz,
  authored integer not null default 0,
  repairs integer not null default 0,
  repair jsonb,
  revise jsonb,
  -- A module the model wrote and that bundled, kept only while storage or the queue is failing: the retry reuses it instead of paying for another model call.
  draft_source text,
  render_attempt integer not null default 0,
  source_key text,
  bundle_key text,
  bundle_manifest jsonb,
  still_key text,
  clip_key text,
  clip_meta jsonb,
  error jsonb,
  timings jsonb not null default '{}'::jsonb,
  enqueued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  drawn_at timestamptz,
  unique (project_id, scene_index, aspect)
);
create index if not exists plate_variants_project_idx on app.plate_variants (project_id);
create index if not exists plate_variants_open_idx on app.plate_variants (state, updated_at) where state <> 'drawn' and state <> 'failed';

-- Companion (free) exports of one aspect ratio. The signature covers every drawn clip and every audio/subtitle setting,
-- so asking again for an unchanged film returns the finished file. The billed final render does not use this table: it
-- is a normal render job (kind 'plate-film') whose worker runs the same assembler.
create table if not exists app.plate_exports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  aspect text not null check (aspect in ('16:9', '9:16', '1:1')),
  signature text not null,
  state text not null default 'queued' check (state in ('queued', 'assembling', 'ready', 'failed')),
  attempt integer not null default 0,
  stage text,
  progress integer not null default 0,
  manifest_key text not null,
  output_key text,
  duration_seconds numeric,
  error jsonb,
  enqueued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (project_id, aspect, signature)
);

-- Keys prefixes that a superseded generation may have left behind; swept in two passes (backend plates/reconcile.ts).
create table if not exists app.plate_garbage (
  prefix text primary key,
  project_id uuid not null,
  sweeps integer not null default 0,
  created_at timestamptz not null default now(),
  next_sweep_at timestamptz not null default now() + interval '1 hour'
);
