-- Supabase "Before User Created" Auth Hook (`pg-functions://postgres/app/before_user_created_hook`).
-- Enforces the shared email local-part rules at the provider boundary before `auth.users` insertion:
-- 1. Surrounding whitespace is trimmed; internal whitespace or invalid `local@domain.tld` syntax is rejected.
-- 2. Any '+' in the local part (before '@') is rejected.
-- 3. At most 2 dots ('.') are allowed in the local part; 3 or more dots are rejected.
-- 4. Domain dots (after '@') do not count toward the local-part dot limit.
-- Does not strip dots or rewrite aliases.

create schema if not exists app;

create or replace function app.before_user_created_hook(event jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  raw_email text;
  trimmed text;
  at_pos int;
  local_part text;
  domain_part text;
  local_dots int;
begin
  if event is null or jsonb_typeof(event) <> 'object' or jsonb_typeof(event->'user') is distinct from 'object' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 400,
        'message', 'Invalid hook payload.'
      )
    );
  end if;

  raw_email := event->'user'->>'email';
  if raw_email is null then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 400,
        'message', 'Enter a valid email address.'
      )
    );
  end if;

  -- Trim surrounding whitespace (spaces, tabs, newlines, carriage returns).
  trimmed := regexp_replace(raw_email, E'^[\\s]+|[\\s]+$', '', 'g');

  -- Basic syntax check: local@domain.tld with no internal whitespace and exactly one '@'.
  if trimmed !~ E'^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 400,
        'message', 'Enter a valid email address.'
      )
    );
  end if;

  at_pos := strpos(trimmed, '@');
  local_part := substr(trimmed, 1, at_pos - 1);
  domain_part := substr(trimmed, at_pos + 1);

  if local_part = '' or domain_part = '' or strpos(domain_part, '@') > 0 or strpos(domain_part, '.') = 0 then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 400,
        'message', 'Enter a valid email address.'
      )
    );
  end if;

  if strpos(local_part, '+') > 0 then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 400,
        'message', 'Email addresses with ''+'' before ''@'' are not supported.'
      )
    );
  end if;

  local_dots := char_length(local_part) - char_length(replace(local_part, '.', ''));
  if local_dots > 2 then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 400,
        'message', 'Email addresses with more than 2 dots before ''@'' are not supported.'
      )
    );
  end if;

  return '{}'::jsonb;
end;
$$;

revoke all on function app.before_user_created_hook(jsonb) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function app.before_user_created_hook(jsonb) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function app.before_user_created_hook(jsonb) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema app to supabase_auth_admin;
    grant execute on function app.before_user_created_hook(jsonb) to supabase_auth_admin;
  end if;
end
$$;
