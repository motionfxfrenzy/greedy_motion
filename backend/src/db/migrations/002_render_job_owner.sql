-- Owner of standalone render jobs (those with no project). Project-linked jobs are owned through
-- their project, so this stays null for them. Holds the Supabase user id (a uuid string).
alter table app.render_jobs add column owner_id text;
