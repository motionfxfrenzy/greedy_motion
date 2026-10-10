-- Entitlements: what a user may use (the Pro editor today), recorded in the database so a grant, a purchase or a
-- cancellation needs no redeploy. Usage and credits (how much) are a different concern and a different table.
-- One row is one source of access: a manual grant (at most one per user) or one provider subscription. The resolver
-- (backend/src/entitlements/evaluate.ts) reads only plan, status, valid_from and expires_at.
-- Rows are never deleted by the application: revoking or cancelling changes status and expires_at, history stays.

create table app.entitlements (
  id uuid primary key default gen_random_uuid(),
  -- Supabase auth user id. No foreign key: the local Postgres has no auth schema.
  user_id uuid not null,
  -- Validated in code (plans.ts), so adding a plan is not a migration.
  plan text not null,
  status text not null check (status in ('active', 'trialing', 'past_due', 'canceled', 'revoked')),
  -- 'manual' or a billing provider; validated in code.
  source text not null,
  -- '' for a manual grant, the provider's subscription id otherwise.
  source_ref text not null default '',
  -- Inclusive start.
  valid_from timestamptz not null default now(),
  -- Exclusive end of edit access, whatever the cause (period end, grace end, grant end). Null: never expires.
  expires_at timestamptz,
  -- Display only ("ends on ..."); the resolver never reads it.
  cancel_at_period_end boolean not null default false,
  -- The provider's event time, so an older event cannot overwrite a newer one. Null for manual grants.
  source_updated_at timestamptz,
  -- 'cli:<operator>' or 'stripe:<event id>'.
  granted_by text not null,
  note text,
  -- Provider facts (price id, first payment failure). Never read by the resolver.
  meta jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source, source_ref)
);
create index entitlements_user_idx on app.entitlements (user_id);

-- Append-only audit: who changed what, and when.
create table app.entitlement_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid not null,
  entitlement_id uuid,
  -- 'cli:alice', 'stripe'
  actor text not null,
  -- grant | extend | update | revoke | provider event type | stale_ignored
  action text not null,
  -- The provider's event id when there is one.
  event_id text,
  before jsonb,
  after jsonb
);
create index entitlement_events_user_idx on app.entitlement_events (user_id, at desc);

-- Row-level security, as for the other tables (003): a user may read only their own entitlement and write nothing; the
-- audit table is not readable through the Data API at all. The backend connects as the table owner. Supabase-only: the
-- local Docker Postgres has no auth schema or `authenticated` role.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'auth') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    alter table app.entitlements enable row level security;
    alter table app.entitlement_events enable row level security;
    create policy entitlements_owner_read on app.entitlements for select to authenticated using ((select auth.uid()) = user_id);
  end if;
end
$$;
