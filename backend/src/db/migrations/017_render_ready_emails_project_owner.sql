-- A finished render is owned by its project: a final render started from a project has no owner_id of its own. 016 only
-- marked jobs that had one, so mark the project-owned jobs that were already finished too. Nobody is mailed about an old film.
insert into app.render_ready_emails (job_id, user_id)
  select j.id, p.owner_id from app.render_jobs j join app.projects p on p.id = j.project_id
  where j.state = 'ready' and j.owner_id is null and p.owner_id is not null
  on conflict do nothing;
