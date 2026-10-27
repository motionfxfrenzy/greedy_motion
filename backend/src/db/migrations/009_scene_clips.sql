-- Scene clips: each scene of a storyboard film drawn ahead of the final render, while the person is still in the Preview.
-- A clip is a time range of the film page itself (same frames, motion, feel and clock), so the final render only joins the
-- clips and adds the soundtrack (kind 'soundtrack', mixed ahead too). A clip is keyed by its signature: everything that
-- can change its pixels (render/scenes.ts sceneSignatures). An unchanged scene keeps its clip; a changed one gets a new row.
--
-- `current` marks the clips the project's film is made of right now; a clip that stops being current is dropped by the
-- worker if it is still drawing (fenced by `attempt`, like app.render_jobs). `thumb` is a small JPEG of the latest frame
-- drawn, overwritten as the scene draws. Rows of projects untouched for a while are swept with their files.
create table if not exists app.scene_clips (
  id uuid primary key,
  project_id uuid not null,
  kind text not null default 'scene' check (kind in ('scene', 'soundtrack')),
  scene_index integer not null,
  signature text not null,
  current boolean not null default true,
  state text not null default 'queued' check (state in ('queued', 'drawing', 'drawn', 'failed')),
  attempt integer not null default 0,
  frames_done integer,
  frames_total integer not null,
  -- { page, from, to, fps } for a scene, { page, fps } for the soundtrack; `page` is the prepared folder (or its R2 prefix).
  render_input jsonb not null,
  -- { file } under the shared renders dir, or { key } in the outputs bucket.
  output jsonb,
  thumb bytea,
  thumb_frame integer,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  drawn_at timestamptz,
  used_at timestamptz not null default now(),
  unique (project_id, signature)
);

create index if not exists scene_clips_current_idx on app.scene_clips (project_id, scene_index) where current;
create index if not exists scene_clips_used_idx on app.scene_clips (used_at);

-- Same pattern as render_jobs (008): a change a person would see raises one small notification; the thumbnail itself
-- never rides in it (the listener reads it once per new frame for the pages watching).
create or replace function app.notify_scene_clip() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and new.state is not distinct from old.state
     and new.current is not distinct from old.current
     and new.frames_done is not distinct from old.frames_done
     and new.thumb_frame is not distinct from old.thumb_frame
     and new.error is not distinct from old.error then
    return null;
  end if;
  perform pg_notify('scene_clips', json_build_object(
    'id', new.id, 'projectId', new.project_id, 'kind', new.kind, 'index', new.scene_index, 'state', new.state,
    'current', new.current, 'framesDone', new.frames_done, 'framesTotal', new.frames_total, 'thumbFrame', new.thumb_frame,
    'reload', tg_op = 'INSERT' or new.state is distinct from old.state or new.current is distinct from old.current or new.error is distinct from old.error
  )::text);
  return null;
end
$$;

drop trigger if exists scene_clips_notify on app.scene_clips;
create trigger scene_clips_notify after insert or update on app.scene_clips
  for each row execute function app.notify_scene_clip();
