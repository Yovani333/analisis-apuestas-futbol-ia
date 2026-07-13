create table if not exists public.user_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object'),
  parlay_draft jsonb not null default '[]'::jsonb check (jsonb_typeof(parlay_draft) = 'array'),
  saved_picks jsonb not null default '[]'::jsonb check (jsonb_typeof(saved_picks) = 'array'),
  saved_parlays jsonb not null default '[]'::jsonb check (jsonb_typeof(saved_parlays) = 'array'),
  evidence_snapshots jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_snapshots) = 'array'),
  alerts jsonb not null default '[]'::jsonb check (jsonb_typeof(alerts) = 'array'),
  analysis_usage jsonb not null default '{}'::jsonb check (jsonb_typeof(analysis_usage) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.user_sync_state enable row level security;

drop policy if exists "users_select_own_sync_state" on public.user_sync_state;
create policy "users_select_own_sync_state" on public.user_sync_state
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "users_insert_own_sync_state" on public.user_sync_state;
create policy "users_insert_own_sync_state" on public.user_sync_state
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "users_update_own_sync_state" on public.user_sync_state;
create policy "users_update_own_sync_state" on public.user_sync_state
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "users_delete_own_sync_state" on public.user_sync_state;
create policy "users_delete_own_sync_state" on public.user_sync_state
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.user_sync_state from anon;
grant select, insert, update, delete on table public.user_sync_state to authenticated;
