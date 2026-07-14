create or replace function public.merge_sync_array(
  existing_rows jsonb,
  incoming_rows jsonb,
  max_items integer
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with combined as (
    select value as item, 0 as source_priority, ordinality as position
    from jsonb_array_elements(coalesce(existing_rows, '[]'::jsonb)) with ordinality
    union all
    select value as item, 1 as source_priority, ordinality as position
    from jsonb_array_elements(coalesce(incoming_rows, '[]'::jsonb)) with ordinality
  ), ranked as (
    select item, source_priority, position,
      row_number() over (
        partition by item ->> 'id'
        order by source_priority desc, position asc
      ) as item_rank
    from combined
    where jsonb_typeof(item) = 'object' and item ? 'id'
  ), limited as (
    select item, source_priority, position
    from ranked
    where item_rank = 1
    order by source_priority desc, position asc
    limit greatest(0, max_items)
  )
  select coalesce(jsonb_agg(item order by source_priority desc, position asc), '[]'::jsonb)
  from limited;
$$;

create or replace function public.merge_user_sync_state(
  p_preferences jsonb,
  p_parlay_draft jsonb,
  p_saved_picks jsonb,
  p_saved_parlays jsonb,
  p_evidence_snapshots jsonb,
  p_alerts jsonb,
  p_analysis_usage jsonb
)
returns setof public.user_sync_state
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  return query
  insert into public.user_sync_state (
    user_id, preferences, parlay_draft, saved_picks, saved_parlays,
    evidence_snapshots, alerts, analysis_usage, updated_at
  ) values (
    auth.uid(),
    coalesce(p_preferences, '{}'::jsonb),
    coalesce(p_parlay_draft, '[]'::jsonb),
    coalesce(p_saved_picks, '[]'::jsonb),
    coalesce(p_saved_parlays, '[]'::jsonb),
    coalesce(p_evidence_snapshots, '[]'::jsonb),
    coalesce(p_alerts, '[]'::jsonb),
    coalesce(p_analysis_usage, '{}'::jsonb),
    now()
  )
  on conflict (user_id) do update set
    preferences = public.user_sync_state.preferences || excluded.preferences,
    parlay_draft = public.merge_sync_array(public.user_sync_state.parlay_draft, excluded.parlay_draft, 12),
    saved_picks = public.merge_sync_array(public.user_sync_state.saved_picks, excluded.saved_picks, 500),
    saved_parlays = public.merge_sync_array(public.user_sync_state.saved_parlays, excluded.saved_parlays, 200),
    evidence_snapshots = public.merge_sync_array(public.user_sync_state.evidence_snapshots, excluded.evidence_snapshots, 50),
    alerts = public.merge_sync_array(public.user_sync_state.alerts, excluded.alerts, 500),
    analysis_usage = public.user_sync_state.analysis_usage || excluded.analysis_usage,
    updated_at = now()
  returning public.user_sync_state.*;
end;
$$;

revoke all on function public.merge_sync_array(jsonb, jsonb, integer) from public, anon;
revoke all on function public.merge_user_sync_state(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.merge_sync_array(jsonb, jsonb, integer) to authenticated;
grant execute on function public.merge_user_sync_state(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
