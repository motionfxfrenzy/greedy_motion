-- A downgrade keeps the higher plan's features until the paid period ends. The higher plan is remembered here with the
-- moment it stops applying, and read lazily (higher of the current plan and this one while now < entitled_until), so
-- nothing has to run at the boundary.
alter table app.subscriptions add column if not exists entitled_tier text;
alter table app.subscriptions add column if not exists entitled_until timestamptz;
