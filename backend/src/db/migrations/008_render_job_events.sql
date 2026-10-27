-- Render job events. Every change a person would see (state, stage, progress, frames, attempt, error) raises
-- pg_notify('render_jobs', …) whichever service wrote it (backend, worker, dead-letter handlers), so the backend pushes
-- updates to open pages instead of the page polling. The payload carries the fields that change often (progress,
-- frames, attempt), so a progress tick reaches the page with no read at all; listeners reload the row only when the
-- state, stage or error changed. `was` is the stage before the change, so a job leaving the render queue also refreshes
-- the queue position of the jobs behind it. The payload stays near 200 bytes (NOTIFY allows 8 KB) and holds nothing private.
--
-- `prep` holds what a storyboard film needs prepared on the backend before it reaches the render queue (motion
-- directing, the composition build, the upload): { kind: 'beat-plan', watermark, motionBlur, ownerId, spendEvent }.
alter table app.render_jobs add column if not exists prep jsonb;

create or replace function app.notify_render_job() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and new.state is not distinct from old.state
     and new.stage is not distinct from old.stage
     and new.progress is not distinct from old.progress
     and new.frames_done is not distinct from old.frames_done
     and new.attempt is not distinct from old.attempt
     and new.error is not distinct from old.error then
    return null;
  end if;
  perform pg_notify('render_jobs', json_build_object(
    'id', new.id, 'state', new.state, 'stage', new.stage, 'progress', new.progress,
    'framesDone', new.frames_done, 'framesTotal', new.frames_total, 'attempt', new.attempt,
    'was', case when tg_op = 'UPDATE' then old.stage end,
    'reload', tg_op = 'INSERT' or new.state is distinct from old.state or new.stage is distinct from old.stage or new.error is distinct from old.error
  )::text);
  return null;
end
$$;

drop trigger if exists render_jobs_notify on app.render_jobs;
create trigger render_jobs_notify after insert or update on app.render_jobs
  for each row execute function app.notify_render_job();
