create table if not exists public.evidence_pick_outcomes (
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_id text not null,
  fixture_id text not null,
  pick_key text not null,
  selection_key text,
  market text not null,
  selection text not null,
  model_version text not null,
  outcome text not null check (outcome in ('HIT', 'MISS', 'VOID', 'NO_BET', 'DATA_INSUFFICIENT', 'LIVE_PENDING')),
  evaluated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, snapshot_id, pick_key)
);

create index if not exists evidence_pick_outcomes_fixture_idx
  on public.evidence_pick_outcomes (user_id, fixture_id);

create index if not exists evidence_pick_outcomes_training_idx
  on public.evidence_pick_outcomes (user_id, model_version, market, outcome);

alter table public.evidence_pick_outcomes enable row level security;

drop policy if exists "users_manage_own_evidence_pick_outcomes" on public.evidence_pick_outcomes;
create policy "users_manage_own_evidence_pick_outcomes" on public.evidence_pick_outcomes
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.evidence_pick_outcomes from anon;
grant select, insert, update on table public.evidence_pick_outcomes to authenticated;

notify pgrst, 'reload schema';
