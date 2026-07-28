create table if not exists public.bandwidth_observability_windows (
  window_key text primary key,
  window_start timestamptz not null,
  window_end timestamptz not null,
  http_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(http_summary) = 'object'),
  service_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(service_summary) = 'object'),
  alerts jsonb not null default '[]'::jsonb check (jsonb_typeof(alerts) = 'array'),
  daily_rollup_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (window_end >= window_start)
);

create index if not exists bandwidth_observability_windows_start_idx
  on public.bandwidth_observability_windows (window_start desc);

create index if not exists bandwidth_observability_windows_daily_idx
  on public.bandwidth_observability_windows (daily_rollup_key);

alter table public.bandwidth_observability_windows enable row level security;

revoke all on table public.bandwidth_observability_windows from anon;
revoke all on table public.bandwidth_observability_windows from authenticated;

notify pgrst, 'reload schema';
