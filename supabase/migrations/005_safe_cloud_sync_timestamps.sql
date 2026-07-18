create or replace function public.safe_sync_timestamp(value text)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
begin
  if nullif(value, '') is null then
    return '-infinity'::timestamptz;
  end if;
  return value::timestamptz;
exception when others then
  return '-infinity'::timestamptz;
end;
$$;

create or replace function public.merge_user_sync_state_v2(
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
    auth.uid(), coalesce(p_preferences, '{}'::jsonb), coalesce(p_parlay_draft, '[]'::jsonb),
    coalesce(p_saved_picks, '[]'::jsonb), coalesce(p_saved_parlays, '[]'::jsonb),
    coalesce(p_evidence_snapshots, '[]'::jsonb), coalesce(p_alerts, '[]'::jsonb),
    coalesce(p_analysis_usage, '{}'::jsonb), now()
  )
  on conflict (user_id) do update set
    parlay_draft = case
      when public.safe_sync_timestamp(excluded.preferences ->> 'parlayDraftUpdatedAt')
        >= public.safe_sync_timestamp(public.user_sync_state.preferences ->> 'parlayDraftUpdatedAt')
      then excluded.parlay_draft
      else public.user_sync_state.parlay_draft
    end,
    preferences = public.user_sync_state.preferences || excluded.preferences,
    saved_picks = public.merge_sync_array(public.user_sync_state.saved_picks, excluded.saved_picks, 500),
    saved_parlays = public.merge_sync_array(public.user_sync_state.saved_parlays, excluded.saved_parlays, 200),
    evidence_snapshots = public.merge_sync_array(public.user_sync_state.evidence_snapshots, excluded.evidence_snapshots, 50),
    alerts = public.merge_sync_array(public.user_sync_state.alerts, excluded.alerts, 500),
    analysis_usage = public.user_sync_state.analysis_usage || excluded.analysis_usage,
    updated_at = now()
  returning public.user_sync_state.*;
end;
$$;

revoke all on function public.safe_sync_timestamp(text) from public, anon;
grant execute on function public.safe_sync_timestamp(text) to authenticated;
revoke all on function public.merge_user_sync_state_v2(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.merge_user_sync_state_v2(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
