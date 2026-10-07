-- Projects and brand kits move from JSON files into Postgres. The full document stays in `data` (jsonb) so the
-- API shape is unchanged; owner, name and state are columns for filtering and listing. Binary assets
-- (screenshots, logos, fonts) are not stored here.

create table app.projects (
  id uuid primary key,
  -- Supabase auth user id. Null only for records imported from before ownership existed (see LEGACY_OWNER_ID).
  owner_id uuid,
  name text not null,
  state text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_owner_updated_idx on app.projects (owner_id, updated_at desc);

create table app.brand_kits (
  id uuid primary key,
  owner_id uuid,
  name text not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index brand_kits_owner_created_idx on app.brand_kits (owner_id, created_at desc);

-- 002 added render_jobs.owner_id as text; owners are auth uuids.
alter table app.render_jobs alter column owner_id type uuid using owner_id::uuid;
create index render_jobs_owner_idx on app.render_jobs (owner_id) where owner_id is not null;

-- Row-level security, second layer behind the backend's own checks. The backend connects as the table owner
-- (not subject to RLS); these policies govern anything reaching the tables with a user's JWT (Supabase Data
-- API, Realtime). Users may read only their own rows and write none. Supabase-only: the local Docker Postgres
-- has no auth schema or `authenticated` role, so the block is skipped there.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'auth') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    alter table app.projects enable row level security;
    alter table app.brand_kits enable row level security;
    alter table app.render_jobs enable row level security;
    create policy projects_owner_read on app.projects for select to authenticated using ((select auth.uid()) = owner_id);
    create policy brand_kits_owner_read on app.brand_kits for select to authenticated using ((select auth.uid()) = owner_id);
    create policy render_jobs_owner_read on app.render_jobs for select to authenticated
      using ((select auth.uid()) = owner_id or exists (select 1 from app.projects p where p.id = render_jobs.project_id and p.owner_id = (select auth.uid())));
  end if;
end
$$;
