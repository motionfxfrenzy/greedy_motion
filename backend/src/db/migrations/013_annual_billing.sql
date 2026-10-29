-- Annual subscriptions (docs/PRICING.md). An annual subscription pays once a year in Lemon Squeezy (10 months' price for
-- 12 months), so only one invoice arrives for the whole year. The plan's tokens still renew every month: the paid annual
-- invoice grants month 1 and records `cycle_anchor_at`, and months 2 through 12 are granted on the anchor's monthly dates
-- through the year (tracked by `cycle_months_granted`, 1 after the invoice up to 12 for the year).
alter table app.subscriptions
  add column if not exists billing_interval text not null default 'month' check (billing_interval in ('month', 'year')),
  add column if not exists cycle_anchor_at timestamptz,
  add column if not exists cycle_months_granted integer not null default 0 check (cycle_months_granted between 0 and 12);
create index if not exists subscriptions_annual_idx on app.subscriptions (billing_interval) where billing_interval = 'year';
