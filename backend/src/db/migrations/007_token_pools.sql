-- Token pools. Plan tokens come with a subscription and reset every month: what is left at renewal expires and the full
-- allowance is granted again. Packs and the free allowance do not expire. A balance is still the sum of its rows, now per
-- pool. Nothing in the ledger existed outside local development before this change.
--   plan: granted by a paid invoice, expires at the next renewal or when the subscription ends
--   free: the one-time 30-second allowance
--   pack: bought token packs and manual grants
alter table app.token_ledger add column pool text not null default 'pack' check (pool in ('plan', 'pack', 'free'));
update app.token_ledger set pool = 'free' where ref = 'free-allowance';
create index token_ledger_pool_idx on app.token_ledger (user_id, pool, created_at desc);
