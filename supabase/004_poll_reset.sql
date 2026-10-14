-- Class poll — Supabase schema, part 4 (migration "poll_reset", applied 14 Oct 2026).
-- Deletes all answers to one poll; the poll itself and its settings stay.
create function public.poll_reset(p_admin text, p_poll uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform private.require_key(p_admin, array['instructor']);
  delete from private.responses where poll_id = p_poll;
  get diagnostics n = row_count;
  return jsonb_build_object('deleted', n);
end $$;

revoke all on function public.poll_reset(text, uuid) from public, authenticated;
grant execute on function public.poll_reset(text, uuid) to anon;

-- Migration "poll_reset_round", applied 14 Oct 2026:
-- a reset bumps the poll's round, so open student pages start the poll again.
alter table private.polls add column round int not null default 0;

create or replace function public.poll_reset(p_admin text, p_poll uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform private.require_key(p_admin, array['instructor']);
  delete from private.responses where poll_id = p_poll;
  get diagnostics n = row_count;
  update private.polls set round = round + 1 where id = p_poll;
  return jsonb_build_object('deleted', n);
end $$;

create or replace function public.poll_current(p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  perform private.require_key(p_key, array['student', 'instructor']);
  select jsonb_build_object('id', p.id, 'question', p.question, 'unit', p.unit,
         'min_value', p.min_value, 'max_value', p.max_value, 'integer_only', p.integer_only,
         'kind', p.kind, 'items', p.items, 'round', p.round)
    into r from private.polls p where p.is_open
    order by p.created_at desc limit 1;
  return r;  -- null when no poll is open
end $$;
