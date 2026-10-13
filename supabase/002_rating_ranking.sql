-- Class poll — Supabase schema, part 2 (migration "rating_and_ranking_polls", applied 14 Oct 2026).
-- Adds rating and ranking polls: three items per poll, answers stored as jsonb.

alter table private.polls add column kind text not null default 'number'
  check (kind in ('number', 'rating', 'ranking'));
alter table private.polls add column items jsonb;
alter table private.polls add constraint polls_items_check check (
  (kind = 'number' and items is null) or
  (kind <> 'number' and jsonb_typeof(items) = 'array' and jsonb_array_length(items) = 3));

alter table private.responses alter column value drop not null;
alter table private.responses add column answer jsonb;
alter table private.responses add constraint responses_value_or_answer
  check (value is not null or answer is not null);

-- poll_create gains a type and three items -------------------------------
drop function public.poll_create(text, text, text, numeric, numeric, boolean);
create function public.poll_create(p_admin text, p_question text, p_unit text,
  p_min numeric, p_max numeric, p_integer_only boolean,
  p_kind text default 'number', p_items jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare new_id uuid; k text := coalesce(p_kind, 'number');
begin
  perform private.require_key(p_admin, array['instructor']);
  if k not in ('number', 'rating', 'ranking') then raise exception 'Unknown poll type'; end if;
  if k = 'number' then
    insert into private.polls (question, unit, min_value, max_value, integer_only)
    values (trim(p_question), coalesce(trim(p_unit), ''), p_min, p_max, coalesce(p_integer_only, true))
    returning id into new_id;
  else
    if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) <> 3
       or exists (select 1 from jsonb_array_elements(p_items) e
                  where jsonb_typeof(e) <> 'string' or length(trim(e #>> '{}')) = 0
                     or length(e #>> '{}') > 2000) then
      raise exception 'Give three items, each 1 to 2000 characters';
    end if;
    -- Ratings are whole numbers 0–10; ranking polls do not use the range.
    insert into private.polls (question, unit, min_value, max_value, integer_only, kind, items)
    values (trim(p_question), '', 0, case when k = 'rating' then 10 else 1 end, true, k,
            (select jsonb_agg(trim(e #>> '{}')) from jsonb_array_elements(p_items) e))
    returning id into new_id;
  end if;
  return jsonb_build_object('id', new_id);
end $$;

-- Read functions return the type and the items ---------------------------
create or replace function public.poll_current(p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  perform private.require_key(p_key, array['student', 'instructor']);
  select jsonb_build_object('id', p.id, 'question', p.question, 'unit', p.unit,
         'min_value', p.min_value, 'max_value', p.max_value, 'integer_only', p.integer_only,
         'kind', p.kind, 'items', p.items)
    into r from private.polls p where p.is_open
    order by p.created_at desc limit 1;
  return r;  -- null when no poll is open
end $$;

create or replace function public.poll_list(p_admin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_key(p_admin, array['instructor']);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'question', p.question, 'unit', p.unit,
             'min_value', p.min_value, 'max_value', p.max_value, 'integer_only', p.integer_only,
             'kind', p.kind, 'items', p.items, 'is_open', p.is_open, 'created_at', p.created_at,
             'responses', (select count(*) from private.responses r where r.poll_id = p.id))
           order by p.created_at desc)
    from private.polls p), '[]'::jsonb);
end $$;

create or replace function public.poll_results(p_admin text, p_poll uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_key(p_admin, array['instructor']);
  return (select jsonb_build_object('id', p.id, 'question', p.question, 'unit', p.unit,
            'min_value', p.min_value, 'max_value', p.max_value, 'integer_only', p.integer_only,
            'kind', p.kind, 'items', p.items, 'is_open', p.is_open,
            'values', coalesce((select jsonb_agg(r.value) from private.responses r
                                where r.poll_id = p.id and r.value is not null), '[]'::jsonb),
            'answers', coalesce((select jsonb_agg(r.answer) from private.responses r
                                 where r.poll_id = p.id and r.answer is not null), '[]'::jsonb))
          from private.polls p where p.id = p_poll);
end $$;

create or replace function public.poll_my_answer(p_key text, p_poll uuid, p_voter uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v numeric; a jsonb;
begin
  perform private.require_key(p_key, array['student', 'instructor']);
  select value, answer into v, a from private.responses where poll_id = p_poll and voter_id = p_voter;
  return jsonb_build_object('value', v, 'answer', a);
end $$;

-- Number answers only through poll_submit --------------------------------
create or replace function public.poll_submit(p_key text, p_poll uuid, p_voter uuid, p_value numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p private.polls;
begin
  perform private.require_key(p_key, array['student', 'instructor']);
  select * into p from private.polls where id = p_poll;
  if not found then raise exception 'Poll not found'; end if;
  if p.kind <> 'number' then raise exception 'This poll does not take a number'; end if;
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

-- Rating and ranking answers ---------------------------------------------
-- rating:  {"ratings": [rA, rB, rC], "shown": [...]}  three different whole numbers 0–10
-- ranking: {"winners": [wAB, wAC, wBC], "shown": [...]} the better item of pairs (0,1), (0,2), (1,2)
-- "shown" records the order the student saw; it is kept only if short.
create function public.poll_submit_choice(p_key text, p_poll uuid, p_voter uuid, p_answer jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p private.polls; a jsonb; shown jsonb; r jsonb; w jsonb;
begin
  perform private.require_key(p_key, array['student', 'instructor']);
  select * into p from private.polls where id = p_poll;
  if not found then raise exception 'Poll not found'; end if;
  if p.kind = 'number' then raise exception 'This poll takes a number'; end if;
  if not p.is_open then raise exception 'This poll is closed'; end if;
  if p_voter is null or p_answer is null then raise exception 'Missing answer'; end if;
  shown := p_answer->'shown';
  if shown is not null and length(shown::text) > 200 then shown := null; end if;

  if p.kind = 'rating' then
    r := p_answer->'ratings';
    if jsonb_typeof(r) is distinct from 'array' or jsonb_array_length(r) <> 3
       or exists (select 1 from jsonb_array_elements(r) e
                  where jsonb_typeof(e) <> 'number' or (e::text)::numeric not between 0 and 10
                     or (e::text)::numeric <> trunc((e::text)::numeric)) then
      raise exception 'Ratings must be whole numbers from 0 to 10';
    end if;
    if (select count(distinct (e::text)::numeric) from jsonb_array_elements(r) e) <> 3 then
      raise exception 'Give each item a different rating';
    end if;
    a := jsonb_build_object('ratings', jsonb_build_array((r->>0)::int, (r->>1)::int, (r->>2)::int));
  else
    w := p_answer->'winners';
    if jsonb_typeof(w) is distinct from 'array' or jsonb_array_length(w) <> 3
       or (w->>0) not in ('0', '1') or (w->>1) not in ('0', '2') or (w->>2) not in ('1', '2') then
      raise exception 'Choose one item in each pair';
    end if;
    a := jsonb_build_object('winners', jsonb_build_array((w->>0)::int, (w->>1)::int, (w->>2)::int));
  end if;
  if shown is not null then a := a || jsonb_build_object('shown', shown); end if;

  if not exists (select 1 from private.responses where poll_id = p_poll and voter_id = p_voter)
     and (select count(*) from private.responses where poll_id = p_poll) >= 1000 then
    raise exception 'This poll is full';
  end if;
  insert into private.responses (poll_id, voter_id, answer) values (p_poll, p_voter, a)
  on conflict (poll_id, voter_id) do update set answer = excluded.answer, updated_at = now();
  return jsonb_build_object('answer', a);
end $$;

revoke all on function public.poll_create(text, text, text, numeric, numeric, boolean, text, jsonb),
  public.poll_submit_choice(text, uuid, uuid, jsonb) from public, authenticated;
grant execute on function public.poll_create(text, text, text, numeric, numeric, boolean, text, jsonb),
  public.poll_submit_choice(text, uuid, uuid, jsonb) to anon;
