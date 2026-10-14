-- Billing (Lemon Squeezy). A subscription row mirrors the provider's subscription so the site can show the plan and the
-- renewal date without calling the provider; entitlements (004) still decide Pro-editor access and the ledger (005)
-- still holds the tokens. Both are written from the webhook, in one transaction with the event row below.
--
-- Token amounts in app.token_ledger are millitokens from here on (1 token = 1000), so one second of video (a quarter
-- of a token) is a whole number. No row existed before this change.
create table app.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  provider text not null default 'lemonsqueezy',
  -- The provider's subscription id.
  provider_ref text not null,
  variant_id text not null,
  -- starter | pro | business; validated in code (contracts/pricing.ts).
  tier text not null,
  -- The provider's own status: on_trial, active, paused, past_due, unpaid, cancelled, expired.
  status text not null,
  renews_at timestamptz,
  ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  customer_portal_url text,
  update_payment_url text,
  -- The provider's event time, so an older event cannot overwrite a newer one.
  provider_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_ref)
);
create index subscriptions_user_idx on app.subscriptions (user_id);

-- Every webhook delivery, once. The key is the provider's event name plus the object it is about plus its update time,
-- so a redelivery is recognised and ignored. Not readable through the Data API.
create table app.billing_events (
  event_key text primary key,
  received_at timestamptz not null default now(),
  name text not null,
  user_id uuid,
  payload jsonb not null
);

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'auth') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    alter table app.subscriptions enable row level security;
    alter table app.billing_events enable row level security;
    create policy subscriptions_owner_read on app.subscriptions for select to authenticated using ((select auth.uid()) = user_id);
  end if;
end
$$;
