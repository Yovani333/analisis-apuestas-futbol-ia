import { env } from "../config/env.js";
import { ALLOWED_LEAGUES, getAllowedLeague } from "../config/leagues.js";
import { AppError } from "../errors.js";
import {
  buildAnalysisInput, calculateDataQuality, calculateMarketAnalysis,
  normalizeOdds, summarizeRecentFixtures
} from "./market-analysis.service.js";

const leagueCache = new Map();
const requestCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key) {
  const item = requestCache.get(key);
  if (!item || item.expiresAt < Date.now()) return null;
  return item.value;
}

async function apiRequest(path, params = {}) {
  if (!env.apiFootballKey) throw new AppError("API-Football no está configurada.", 503, "API_FOOTBALL_NOT_CONFIGURED");
  const url = new URL(path, env.apiFootballBaseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  const cacheKey = url.toString();
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const response = await fetch(url, {
    headers: { "x-apisports-key": env.apiFootballKey },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new AppError("API-Football no respondió correctamente.", 502, "API_FOOTBALL_HTTP_ERROR", { status: response.status });
  const payload = await response.json();
  const providerErrors = payload.errors && (Array.isArray(payload.errors) ? payload.errors : Object.values(payload.errors));
  if (providerErrors?.length) throw new AppError("API-Football rechazó la consulta.", 502, "API_FOOTBALL_PROVIDER_ERROR", providerErrors);
  const value = payload.response || [];
  requestCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL });
  return value;
}

function chooseSeason(seasons, requestedSeason, targetDate) {
  if (requestedSeason !== "auto") return requestedSeason;
  const byDate = seasons.find((season) => season.start <= targetDate && season.end >= targetDate);
  const current = seasons.find((season) => season.current);
  const latest = [...seasons].sort((a, b) => b.year - a.year)[0];
  return byDate?.year || current?.year || latest?.year;
}

export async function resolveLeague(slug, includeSeasons = false) {
  if (leagueCache.has(slug) && (!includeSeasons || leagueCache.get(slug).seasons?.length)) return leagueCache.get(slug);
  const config = getAllowedLeague(slug);
  if (!config) throw new AppError("Liga no permitida.", 400, "INVALID_LEAGUE");

  if (config.apiId && !includeSeasons) {
    const resolved = { ...config, seasons: [] };
    leagueCache.set(slug, resolved);
    return resolved;
  }

  if (config.apiId && includeSeasons) {
    const [match] = await apiRequest("/leagues", { id: config.apiId });
    if (match) {
      const resolved = { ...config, seasons: match.seasons || [] };
      leagueCache.set(slug, resolved);
      return resolved;
    }
  }

  for (const apiName of config.apiNames) {
    const candidates = await apiRequest("/leagues", { search: apiName });
    const match = candidates.find(({ league, country }) =>
      config.apiNames.some((name) => name.toLowerCase() === league?.name?.toLowerCase()) &&
      country?.name?.toLowerCase() === config.country.toLowerCase()
    );
    if (match) {
      const resolved = { ...config, apiId: match.league.id, seasons: match.seasons || [] };
      leagueCache.set(slug, resolved);
      return resolved;
    }
  }
  throw new AppError(`No se pudo verificar ${config.name} en API-Football.`, 502, "LEAGUE_NOT_RESOLVED");
}

function providerStatus(status) {
  if (status === "scheduled") return "NS-TBD";
  if (status === "finished") return "FT-AET-PEN";
  return undefined;
}

function statusLabel(short) {
  if (["NS", "TBD"].includes(short)) return "Programado";
  if (["FT", "AET", "PEN"].includes(short)) return "Completo";
  return short || "No disponible";
}

function normalizeFixture(item, league) {
  const date = new Date(item.fixture.date);
  const iso = date.toISOString();
  return {
    id: String(item.fixture.id),
    leagueSlug: league.slug,
    leagueName: league.name,
    leagueId: item.league.id,
    season: item.league.season,
    home: item.teams.home.name,
    away: item.teams.away.name,
    homeTeamId: item.teams.home.id,
    awayTeamId: item.teams.away.id,
    date: iso.slice(0, 10),
    time: iso.slice(11, 16),
    status: ["FT", "AET", "PEN"].includes(item.fixture.status.short) ? "finished" : "scheduled",
    statusLabel: statusLabel(item.fixture.status.short),
    stadium: item.fixture.venue?.name || "No disponible",
    country: league.countryLabel,
    score: { home: item.goals?.home ?? null, away: item.goals?.away ?? null },
    dataAvailability: {
      standings: "No disponible", statistics: "No disponible", h2h: "No disponible",
      injuries: "No disponible", lineups: "No disponible", odds: "No disponible",
      xg: "No disponible", context: "No disponible", weather: "No disponible"
    }
  };
}

export async function searchFixtures(filters) {
  const groups = await Promise.all(filters.leagues.map(async (slug) => {
    const league = await resolveLeague(slug, filters.season === "auto");
    const season = chooseSeason(league.seasons, filters.season, filters.dateFrom);
    if (!season) throw new AppError(`No se encontró temporada válida para ${league.name}.`, 422, "SEASON_NOT_RESOLVED");
    const fixtures = await apiRequest("/fixtures", {
      league: league.apiId, season, from: filters.dateFrom, to: filters.dateTo, status: providerStatus(filters.status), timezone: "UTC"
    });
    return fixtures
      .map((item) => normalizeFixture(item, league))
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
      .slice(0, 5);
  }));
  return groups.flat().sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
}

function availability(value) {
  return Array.isArray(value) && value.length ? "Disponible" : "No disponible";
}

export async function getFixtureDataset(fixtureId) {
  const fixtureRows = await apiRequest("/fixtures", { id: fixtureId, timezone: "UTC" });
  const base = fixtureRows[0];
  if (!base) throw new AppError("Fixture no encontrado.", 404, "FIXTURE_NOT_FOUND");

  const leagueConfigBase = ALLOWED_LEAGUES.find((league) =>
    league.country.toLowerCase() === base.league.country?.toLowerCase() &&
    league.apiNames.some((name) => name.toLowerCase() === base.league.name?.toLowerCase())
  );
  const leagueConfig = leagueConfigBase ? { ...leagueConfigBase, apiId: base.league.id } : null;
  if (!leagueConfig) throw new AppError("El fixture no pertenece a una liga permitida.", 403, "FIXTURE_LEAGUE_NOT_ALLOWED");

  const homeId = base.teams.home.id;
  const awayId = base.teams.away.id;
  const season = base.league.season;
  const safe = (promise) => promise.catch(() => []);
  const [statistics, standings, h2h, injuries, lineups, odds, homeRecentRows, awayRecentRows] = await Promise.all([
    safe(apiRequest("/fixtures/statistics", { fixture: fixtureId })),
    safe(apiRequest("/standings", { league: base.league.id, season })),
    safe(apiRequest("/fixtures/headtohead", { h2h: `${homeId}-${awayId}`, last: 10 })),
    safe(apiRequest("/injuries", { fixture: fixtureId })),
    safe(apiRequest("/fixtures/lineups", { fixture: fixtureId })),
    safe(apiRequest("/odds", { fixture: fixtureId })),
    safe(apiRequest("/fixtures", { team: homeId, last: 8, timezone: "UTC" })),
    safe(apiRequest("/fixtures", { team: awayId, last: 8, timezone: "UTC" }))
  ]);

  const fixture = normalizeFixture(base, leagueConfig);
  const homeForm = summarizeRecentFixtures(homeRecentRows, homeId, base.fixture.date);
  const awayForm = summarizeRecentFixtures(awayRecentRows, awayId, base.fixture.date);
  const oddsSummary = normalizeOdds(odds);
  const dataQuality = calculateDataQuality({ homeForm, awayForm, odds: oddsSummary, standings, injuries, lineups, h2h });
  const marketAnalysis = calculateMarketAnalysis(homeForm, awayForm, oddsSummary).map((market) => ({
    ...market,
    requiresReview: !dataQuality.canSuggest || market.sampleSize < 6
  }));
  const preMatch = {
    home: { team: fixture.home, ...homeForm },
    away: { team: fixture.away, ...awayForm },
    odds: oddsSummary,
    note: "Las frecuencias recientes son descriptivas, no garantizan resultados y no sustituyen una muestra histórica amplia."
  };
  fixture.dataAvailability = {
    standings: availability(standings), statistics: availability(statistics), h2h: availability(h2h),
    injuries: availability(injuries), lineups: availability(lineups), odds: availability(odds),
    xg: statistics.some((team) => team.statistics?.some((stat) => /expected goals|xg/i.test(stat.type))) ? "Disponible" : "No disponible",
    context: homeForm.played && awayForm.played ? "Disponible" : "Necesita revisión", weather: "No disponible"
  };

  const dataset = {
    source: "api-football",
    fetchedAt: new Date().toISOString(),
    fixture,
    confirmed: { statistics, standings, h2h, injuries, lineups, odds },
    preMatch,
    marketAnalysis,
    dataQuality,
    unavailable: ["weather", "news", "referee_details", "travel", "sidelined_not_verified"],
    qualityAlerts: ["Los datos vacíos se conservan como no disponibles; no se completan por inferencia."]
  };
  dataset.analysisInput = buildAnalysisInput(dataset);
  return dataset;
}

export async function getFixtureResult(fixtureId) {
  const fixtureRows = await apiRequest("/fixtures", { id: fixtureId, timezone: "UTC" });
  const row = fixtureRows[0];
  if (!row) throw new AppError("Fixture no encontrado.", 404, "FIXTURE_NOT_FOUND");
  return {
    fixtureId: String(row.fixture.id),
    status: row.fixture.status?.short || "TBD",
    finished: ["FT", "AET", "PEN"].includes(row.fixture.status?.short),
    goals: { home: row.goals?.home ?? null, away: row.goals?.away ?? null },
    date: row.fixture.date,
    home: row.teams?.home?.name,
    away: row.teams?.away?.name
  };
}
