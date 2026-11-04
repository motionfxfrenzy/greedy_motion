-- Phase 2c: persist on-demand draw intent per aspect for live projects so scenes still queued/authoring
-- draw as soon as they are bundled, and the reconciler recovers lost plate-render messages for those aspects.

alter table app.plate_state add column if not exists draw_aspects text[] not null default '{}';
