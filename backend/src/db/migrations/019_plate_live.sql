-- Phase 2a: live browser-drawn plate scenes, revision history, and fenced check reports.
--
-- How to roll back by hand:
--   1. Set PLATE_LIVE_FORCE_OFF=1 on the backend and let the reconciler drain `checked` variants into `bundled` + `plate-render`,
--      or run manually:
--        update app.plate_state set live_mode = 'clip', updated_at = now() where live_mode = 'live';
--        update app.plate_variants set state = 'bundled', stage = 'queued for rendering', updated_at = now() where state = 'checked';
--   2. Once no rows have `state = 'checked'`, restore the 018 state constraint and remove the 019 schema additions if desired:
--        alter table app.plate_variants drop constraint if exists plate_variants_state_check;
--        alter table app.plate_variants add constraint plate_variants_state_check
--          check (state in ('queued', 'authoring', 'bundled', 'rendering', 'drawn', 'failed'));
--        drop table if exists app.plate_check_reports;
--        drop table if exists app.plate_revisions;
--        alter table app.plate_variants
--          drop column if exists checked_at,
--          drop column if exists check_report,
--          drop column if exists bundle_digest,
--          drop column if exists host;
--        alter table app.plate_state
--          drop constraint if exists plate_state_live_mode_check,
--          drop column if exists live_mode,
--          drop column if exists live_mode_set_at;
--        delete from app.schema_migrations where name = '019_plate_live.sql';

alter table app.plate_variants add column if not exists checked_at timestamptz;
alter table app.plate_variants add column if not exists check_report jsonb;
alter table app.plate_variants add column if not exists bundle_digest text;
alter table app.plate_variants add column if not exists host text;

do $$
declare
  cname text;
begin
  for cname in
    select c.conname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'app.plate_variants'::regclass
      and c.contype = 'c'
      and a.attname = 'state'
  loop
    execute format('alter table app.plate_variants drop constraint %I', cname);
  end loop;
  alter table app.plate_variants
    add constraint plate_variants_state_check
    check (state in ('queued', 'authoring', 'bundled', 'checked', 'rendering', 'drawn', 'failed'));
end $$;

alter table app.plate_state add column if not exists live_mode text;
alter table app.plate_state add column if not exists live_mode_set_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app.plate_state'::regclass
      and conname = 'plate_state_live_mode_check'
  ) then
    alter table app.plate_state
      add constraint plate_state_live_mode_check
      check (live_mode in ('live', 'clip'));
  end if;
end $$;

create table if not exists app.plate_revisions (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references app.plate_variants(id) on delete cascade,
  rev integer not null,
  bundle_digest text not null,
  source_key text,
  bundle_key text,
  params jsonb not null default '{}'::jsonb,
  params_digest text not null,
  author text,
  created_at timestamptz not null default now(),
  unique (variant_id, rev)
);
create index if not exists plate_revisions_variant_idx on app.plate_revisions (variant_id);

create table if not exists app.plate_check_reports (
  variant_id uuid not null references app.plate_variants(id) on delete cascade,
  gen integer not null,
  bundle_digest text not null,
  host text not null,
  report jsonb not null,
  created_at timestamptz not null default now(),
  primary key (variant_id, gen, bundle_digest, host)
);
