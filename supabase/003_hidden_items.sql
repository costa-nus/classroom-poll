-- Class poll — Supabase schema, part 3 (migrations "hidden_items" and
-- "poll_list_hidden_items", applied 14 Oct 2026).
-- Items a rating poll leaves out of the "averages" view in present mode.

alter table private.polls add column hidden_items jsonb not null default '[]'::jsonb;

create function public.poll_set_hidden(p_admin text, p_poll uuid, p_hidden jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_key(p_admin, array['instructor']);
  if jsonb_typeof(p_hidden) is distinct from 'array' or exists (
       select 1 from jsonb_array_elements(p_hidden) e where (e #>> '{}') not in ('0', '1', '2')) then
    raise exception 'Hidden items must be a list of 0, 1, 2';
  end if;
  update private.polls set hidden_items = (
    select coalesce(jsonb_agg(distinct (e #>> '{}')::int), '[]'::jsonb) from jsonb_array_elements(p_hidden) e)
  where id = p_poll;
end $$;

create or replace function public.poll_results(p_admin text, p_poll uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_key(p_admin, array['instructor']);
  return (select jsonb_build_object('id', p.id, 'question', p.question, 'unit', p.unit,
            'min_value', p.min_value, 'max_value', p.max_value, 'integer_only', p.integer_only,
            'kind', p.kind, 'items', p.items, 'hidden_items', p.hidden_items, 'is_open', p.is_open,
            'values', coalesce((select jsonb_agg(r.value) from private.responses r
                                where r.poll_id = p.id and r.value is not null), '[]'::jsonb),
            'answers', coalesce((select jsonb_agg(r.answer) from private.responses r
                                 where r.poll_id = p.id and r.answer is not null), '[]'::jsonb))
          from private.polls p where p.id = p_poll);
end $$;

create or replace function public.poll_list(p_admin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_key(p_admin, array['instructor']);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'question', p.question, 'unit', p.unit,
             'min_value', p.min_value, 'max_value', p.max_value, 'integer_only', p.integer_only,
             'kind', p.kind, 'items', p.items, 'hidden_items', p.hidden_items,
             'is_open', p.is_open, 'created_at', p.created_at,
             'responses', (select count(*) from private.responses r where r.poll_id = p.id))
           order by p.created_at desc)
    from private.polls p), '[]'::jsonb);
end $$;

revoke all on function public.poll_set_hidden(text, uuid, jsonb) from public, authenticated;
grant execute on function public.poll_set_hidden(text, uuid, jsonb) to anon;
