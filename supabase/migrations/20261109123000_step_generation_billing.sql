-- Per-step generation quotes and atomic credit reservations (v2_step_tier).

create table if not exists app.generation_quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null,
  stage text not null,
  pricing_version text not null check (pricing_version in ('v1_render_only', 'v2_step_tier')),
  animation_tier text not null default 'standard' check (animation_tier in ('standard', 'premium')),
  revision_digest text not null default '',
  work_fingerprint text not null,
  milli integer not null check (milli >= 0),
  breakdown jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists generation_quotes_user_project_idx
  on app.generation_quotes (user_id, project_id, stage, created_at desc);

create index if not exists generation_quotes_expires_idx
  on app.generation_quotes (expires_at);

create table if not exists app.generation_reservations (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid,
  user_id uuid not null,
  project_id uuid not null,
  stage text not null,
  pricing_version text not null check (pricing_version in ('v1_render_only', 'v2_step_tier')),
  animation_tier text not null default 'standard' check (animation_tier in ('standard', 'premium')),
  route_snapshot jsonb not null default '{}'::jsonb,
  work_fingerprint text not null,
  reserved_milli integer not null check (reserved_milli >= 0),
  settled_milli integer not null default 0 check (settled_milli >= 0),
  refunded_milli integer not null default 0 check (refunded_milli >= 0),
  units_total integer not null default 1 check (units_total >= 1),
  units_delivered integer not null default 0 check (units_delivered >= 0),
  status text not null default 'reserved' check (status in ('reserved', 'settled', 'partial_refunded', 'refunded', 'free')),
  spend_event text,
  breakdown jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (settled_milli + refunded_milli <= reserved_milli)
);

create index if not exists generation_reservations_project_idx
  on app.generation_reservations (project_id, created_at desc);

create index if not exists generation_reservations_user_idx
  on app.generation_reservations (user_id, created_at desc);

create unique index if not exists generation_reservations_active_work_idx
  on app.generation_reservations (user_id, project_id, stage, work_fingerprint)
  where status in ('reserved', 'settled', 'partial_refunded') and work_fingerprint <> '';

create index if not exists generation_reservations_open_expires_idx
  on app.generation_reservations (expires_at)
  where status = 'reserved';

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'auth') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    alter table app.generation_quotes enable row level security;
    if not exists (
      select 1 from pg_policies where schemaname = 'app' and tablename = 'generation_quotes' and policyname = 'generation_quotes_owner_read'
    ) then
      create policy generation_quotes_owner_read on app.generation_quotes for select to authenticated using ((select auth.uid()) = user_id);
    end if;

    alter table app.generation_reservations enable row level security;
    if not exists (
      select 1 from pg_policies where schemaname = 'app' and tablename = 'generation_reservations' and policyname = 'generation_reservations_owner_read'
    ) then
      create policy generation_reservations_owner_read on app.generation_reservations for select to authenticated using ((select auth.uid()) = user_id);
    end if;
  end if;
end
$$;
