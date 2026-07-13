create table if not exists public.evidence_watchlist (
  user_id uuid not null references auth.users(id) on delete cascade,
  fixture_id text not null,
  fixture_date timestamptz not null,
  capture_due_at timestamptz not null,
  fixture jsonb not null default '{}'::jsonb check (jsonb_typeof(fixture) = 'object'),
  status text not null default 'scheduled' check (status in ('scheduled', 'captured', 'skipped', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, fixture_id)
);

create index if not exists evidence_watchlist_due_idx
  on public.evidence_watchlist (status, capture_due_at);

create table if not exists public.automatic_evidence_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  fixture_id text not null,
  captured_at timestamptz not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now(),
  primary key (user_id, fixture_id)
);

alter table public.evidence_watchlist enable row level security;
alter table public.automatic_evidence_snapshots enable row level security;

drop policy if exists "users_manage_own_evidence_watchlist" on public.evidence_watchlist;
create policy "users_manage_own_evidence_watchlist" on public.evidence_watchlist
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "users_read_own_automatic_evidence" on public.automatic_evidence_snapshots;
create policy "users_read_own_automatic_evidence" on public.automatic_evidence_snapshots
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.evidence_watchlist from anon;
revoke all on table public.automatic_evidence_snapshots from anon;
grant select, insert, update, delete on table public.evidence_watchlist to authenticated;
grant select on table public.automatic_evidence_snapshots to authenticated;

notify pgrst, 'reload schema';
