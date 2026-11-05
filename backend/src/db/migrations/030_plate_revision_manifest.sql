-- Phase 3: Store bundle_manifest on app.plate_revisions so every revision row is self-contained for instant SQL rollback.
alter table app.plate_revisions add column if not exists bundle_manifest jsonb;
