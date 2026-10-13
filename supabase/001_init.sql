-- Class poll — Supabase schema, part 1 (migration "classroom_poll_init", applied 13 Oct 2026).
-- Keys are not here. After applying, insert the two bcrypt hashes:
--   insert into private.app_keys (role, key_hash) values
--     ('student',    extensions.crypt('<student key>',    extensions.gen_salt('bf', 8))),
--     ('instructor', extensions.crypt('<instructor key>', extensions.gen_salt('bf', 8)));

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.app_keys (
  role text primary key check (role in ('student', 'instructor')),
  key_hash text not null
);

create table private.polls (
  id uuid primary key default gen_random_uuid(),
  question text not null check (length(question) between 1 and 500),
  unit text not null default '' check (length(unit) <= 40),
  min_value numeric not null,
  max_value numeric not null,
  integer_only boolean not null default true,
  is_open boolean not null default false,
  created_at timestamptz not null default now(),
  check (min_value < max_value)
);

create table private.responses (
  poll_id uuid not null references private.polls(id) on delete cascade,
  voter_id uuid not null,
  value numeric not null,
  updated_at timestamptz not null default now(),
  primary key (poll_id, voter_id)
);

alter table private.app_keys enable row level security;
alter table private.polls enable row level security;
alter table private.responses enable row level security;
revoke all on all tables in schema private from public, anon, authenticated;

-- Raises unless p_key matches the hash of one of p_roles.
create function private.require_key(p_key text, p_roles text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_key is null or not exists (
    select 1 from private.app_keys k
    where k.role = any(p_roles) and k.key_hash = extensions.crypt(p_key, k.key_hash)
  ) then
    raise exception 'Invalid key' using errcode = '28000';
  end if;
end $$;
revoke all on function private.require_key(text, text[]) from public, anon, authenticated;

-- Student-facing ---------------------------------------------------------

create function public.poll_current(p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  perform private.require_key(p_key, array['student', 'instructor']);
  select jsonb_build_object('id', p.id, 'question', p.question, 'unit', p.unit,
         'min_value', p.min_value, 'max_value', p.max_value, 'integer_only', p.integer_only)
    into r from private.polls p where p.is_open
    order by p.created_at desc limit 1;
  return r;  -- null when no poll is open
end $$;

create function public.poll_submit(p_key text, p_poll uuid, p_voter uuid, p_value numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p private.polls;
begin
  perform private.require_key(p_key, array['student', 'instructor']);
  select * into p from private.polls where id = p_poll;
  if not found then raise exception 'Poll not found'; end if;
  if not p.is_open then raise exception 'This poll is closed'; end if;
  if p_voter is null or p_value is null then raise exception 'Missing answer'; end if;
  if p_value < p.min_value or p_value > p.max_value then
    raise exception 'Answer must be between % and %', p.min_value, p.max_value;
  end if;
  if p.integer_only and p_value <> trunc(p_value) then
    raise exception 'Answer must be a whole number';
  end if;
  if not exists (select 1 from private.responses where poll_id = p_poll and voter_id = p_voter)
     and (select count(*) from private.responses where poll_id = p_poll) >= 1000 then
    raise exception 'This poll is full';
  end if;
  insert into private.responses (poll_id, voter_id, value) values (p_poll, p_voter, p_value)
  on conflict (poll_id, voter_id) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('value', p_value);
end $$;

create function public.poll_my_answer(p_key text, p_poll uuid, p_voter uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v numeric;
begin
  perform private.require_key(p_key, array['student', 'instructor']);
  select value into v from private.responses where poll_id = p_poll and voter_id = p_voter;
  return jsonb_build_object('value', v);
end $$;

-- Instructor-facing ------------------------------------------------------

create function public.poll_create(p_admin text, p_question text, p_unit text,
  p_min numeric, p_max numeric, p_integer_only boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  perform private.require_key(p_admin, array['instructor']);
  insert into private.polls (question, unit, min_value, max_value, integer_only)
  values (trim(p_question), coalesce(trim(p_unit), ''), p_min, p_max, coalesce(p_integer_only, true))
  returning id into new_id;
  return jsonb_build_object('id', new_id);
end $$;

create function public.poll_set_open(p_admin text, p_poll uuid, p_open boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_key(p_admin, array['instructor']);
  if p_open then
    update private.polls set is_open = false where is_open and id <> p_poll;
  end if;
  update private.polls set is_open = p_open where id = p_poll;
end $$;

create function public.poll_list(p_admin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_key(p_admin, array['instructor']);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'question', p.question, 'unit', p.unit,
             'min_value', p.min_value, 'max_value', p.max_value, 'integer_only', p.integer_only,
             'is_open', p.is_open, 'created_at', p.created_at,
             'responses', (select count(*) from private.responses r where r.poll_id = p.id))
           order by p.created_at desc)
    from private.polls p), '[]'::jsonb);
end $$;

create function public.poll_results(p_admin text, p_poll uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_key(p_admin, array['instructor']);
  return (select jsonb_build_object('id', p.id, 'question', p.question, 'unit', p.unit,
            'min_value', p.min_value, 'max_value', p.max_value, 'integer_only', p.integer_only,
            'is_open', p.is_open,
            'values', coalesce((select jsonb_agg(r.value) from private.responses r where r.poll_id = p.id), '[]'::jsonb))
          from private.polls p where p.id = p_poll);
end $$;

create function public.poll_delete(p_admin text, p_poll uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_key(p_admin, array['instructor']);
  delete from private.polls where id = p_poll;
end $$;

create function public.poll_set_key(p_admin text, p_role text, p_new text)
returns void language plpgsql security definer set search_path = '' as $$
declare min_len int;
begin
  perform private.require_key(p_admin, array['instructor']);
  if p_role not in ('student', 'instructor') then raise exception 'Unknown role'; end if;
  min_len := 4;
  if p_role = 'instructor' then min_len := 12; end if;
  if length(coalesce(p_new, '')) < min_len then
    raise exception 'Key must be at least % characters', min_len;
  end if;
  update private.app_keys set key_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 8))
  where role = p_role;
end $$;

-- Only these RPCs are callable through the API.
revoke all on function public.poll_current(text), public.poll_submit(text, uuid, uuid, numeric),
  public.poll_my_answer(text, uuid, uuid), public.poll_create(text, text, text, numeric, numeric, boolean),
  public.poll_set_open(text, uuid, boolean), public.poll_list(text), public.poll_results(text, uuid),
  public.poll_delete(text, uuid), public.poll_set_key(text, text, text)
  from public, authenticated;
grant execute on function public.poll_current(text), public.poll_submit(text, uuid, uuid, numeric),
  public.poll_my_answer(text, uuid, uuid), public.poll_create(text, text, text, numeric, numeric, boolean),
  public.poll_set_open(text, uuid, boolean), public.poll_list(text), public.poll_results(text, uuid),
  public.poll_delete(text, uuid), public.poll_set_key(text, text, text)
  to anon;
