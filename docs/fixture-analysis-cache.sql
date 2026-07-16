-- Caché persistente de expedientes normalizados por fixture.
-- Ejecutar en Supabase SQL Editor si quieres que Render conserve datasets buenos
-- aunque el servicio reinicie o API-Football ya no devuelva cuotas/datos históricos.

create table if not exists public.fixture_analysis_cache (
  fixture_id text primary key,
  league_id integer,
  season integer,
  status text,
  quality_score numeric,
  quality_level text,
  fetched_at timestamptz,
  expires_at timestamptz,
  dataset jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists fixture_analysis_cache_league_season_idx
  on public.fixture_analysis_cache (league_id, season);

create index if not exists fixture_analysis_cache_status_idx
  on public.fixture_analysis_cache (status);

create index if not exists fixture_analysis_cache_expires_at_idx
  on public.fixture_analysis_cache (expires_at);

alter table public.fixture_analysis_cache enable row level security;

-- La app usa SUPABASE_SECRET_KEY desde el backend para leer/escribir esta tabla.
-- No se expone al navegador y no requiere policy pública.

notify pgrst, 'reload schema';
