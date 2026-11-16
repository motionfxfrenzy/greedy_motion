-- The Trending tab of the template gallery: an ordered list of template ids, edited by the owner (a future admin panel, or SQL until then).
-- Unknown ids are ignored by the gallery; an empty table means an empty Trending tab (the page hides it and opens on All).
create table if not exists app.gallery_trending (
  template_id text primary key check (template_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  position    integer not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists gallery_trending_position_idx on app.gallery_trending (position);

-- Seed with the previous default list, in order. Existing rows (owner edits) are never overwritten.
insert into app.gallery_trending (template_id, position) values
  ('history-reel', 1),
  ('picture-film', 2),
  ('dark-fable', 3)
on conflict (template_id) do nothing;

-- Read and written only by the backend (service connection). No client-facing policy: with RLS on, Supabase's API roles see nothing.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'auth') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    alter table app.gallery_trending enable row level security;
  end if;
end
$$;
