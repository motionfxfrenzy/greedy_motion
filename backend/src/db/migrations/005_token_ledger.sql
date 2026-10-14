-- Tokens: what a user may generate with, and what they have used. Append-only: a balance is the sum of the rows, so
-- every number can be explained by the rows behind it. A grant is positive, a spend negative. Entitlements (004) say
-- what a plan unlocks; this table says how much generation is left.
create table app.token_ledger (
  id bigserial primary key,
  -- Supabase auth user id. No foreign key: the local Postgres has no auth schema.
  user_id uuid not null,
  -- Positive grants tokens, negative spends them. Never zero.
  amount integer not null check (amount <> 0),
  -- grant | spend | refund. Validated in code (tokens/store.ts).
  kind text not null,
  -- What it was for: 'storyboard', 'frame_rewrite', 'render', or the grant's note.
  reason text not null,
  project_id uuid,
  -- Makes a spend idempotent: the same event recorded twice (a retry) is stored once. Null for grants.
  ref text,
  -- 'cli:<operator>' for a grant, 'system' for a spend.
  actor text not null default 'system',
  created_at timestamptz not null default now()
);
create index token_ledger_user_idx on app.token_ledger (user_id, created_at desc);
create unique index token_ledger_ref_idx on app.token_ledger (user_id, ref) where ref is not null;

-- As for the other tables: a user may read only their own rows and write nothing. Supabase-only (the local Postgres has
-- no auth schema or `authenticated` role); the backend connects as the table owner.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'auth') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    alter table app.token_ledger enable row level security;
    create policy token_ledger_owner_read on app.token_ledger for select to authenticated using ((select auth.uid()) = user_id);
  end if;
end
$$;
