import { env } from "../config/env.js";
import { ALLOWED_LEAGUES, getAllowedLeague } from "../config/leagues.js";
import { AppError } from "../errors.js";
import {
  buildAnalysisInput, calculateDataQuality, calculateMarketAnalysis,
  normalizeOdds, summarizeRecentFixtures
} from "./market-analysis.service.js";
import { normalizeMatchResearchData } from "./match-research.service.js";
import { collectExternalSourceData } from "./source-orchestrator.service.js";
import { buildEstimatedXgFromDataset } from "./xg/estimated-xg.service.js";

const leagueCache = new Map();
const requestCache = new Map();
const datasetCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const LIVE_CACHE_TTL = 60 * 1000;
const PREDICTION_CACHE_TTL = 30 * 60 * 1000;
const PACIFIC_TIME_ZONE = "America/Los_Angeles";

function getCached(key) {
  const item = requestCache.get(key);
  if (!item || item.expiresAt < Date.now()) return null;
  return item.value;
}

async function apiRequest(path, params = {}, cacheTtl = CACHE_TTL) {
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
  requestCache.set(cacheKey, { value, expiresAt: Date.now() + cacheTtl });
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
  if (["1H", "HT", "2H", "ET", "BT", "P", "INT", "LIVE"].includes(short)) return "En vivo";
  if (["PST", "CANC", "ABD", "AWD", "WO"].includes(short)) return "No disponible";
  return short || "No disponible";
}

function pacificDateParts(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PACIFIC_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

function fixtureStatus(short) {
  if (["FT", "AET", "PEN"].includes(short)) return "finished";
  if (["1H", "HT", "2H", "ET", "BT", "P", "INT", "LIVE"].includes(short)) return "live";
  return "scheduled";
}

export function normalizeFavorite(rows = [], fixture) {
  const prediction = rows[0]?.predictions;
  const winner = prediction?.winner;
  if (!winner?.id || !winner?.name) return null;
  const side = winner.id === fixture.homeTeamId ? "home" : winner.id === fixture.awayTeamId ? "away" : null;
  const rawPercent = side ? prediction.percent?.[side] : null;
  const percent = Number.parseFloat(String(rawPercent || "").replace("%", ""));
  return {
    teamId: winner.id, team: winner.name, percent: Number.isFinite(percent) ? percent : null,
    comment: winner.comment || "", source: "api-football-predictions",
    note: "Favorito estadístico del proveedor; no representa una votación pública de usuarios."
  };
}

export function normalizeFixture(item, league) {
  const date = new Date(item.fixture.date);
  const pacific = pacificDateParts(date);
  const shortStatus = item.fixture.status.short;
  const neutralVenue = league.slug === "world-cup";
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
    date: pacific.date,
    time: pacific.time,
    utcDateTime: date.toISOString(),
    timezone: PACIFIC_TIME_ZONE,
    status: fixtureStatus(shortStatus),
    statusLabel: statusLabel(shortStatus),
    statusShort: shortStatus,
    elapsed: item.fixture.status?.elapsed ?? null,
    neutralVenue,
    stadium: item.fixture.venue?.name || "No disponible",
    city: item.fixture.venue?.city || "",
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
      league: league.apiId, season, from: filters.dateFrom, to: filters.dateTo, status: providerStatus(filters.status), timezone: PACIFIC_TIME_ZONE
    }, LIVE_CACHE_TTL);
    const normalized = fixtures
      .map((item) => normalizeFixture(item, league))
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
      .slice(0, 5);
    return Promise.all(normalized.map(async (fixture) => {
      const predictions = await apiRequest("/predictions", { fixture: fixture.id }, PREDICTION_CACHE_TTL).catch(() => []);
      return { ...fixture, favorite: normalizeFavorite(predictions, fixture) };
    }));
  }));
  return groups.flat().sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
}

function availability(value) {
  return Array.isArray(value) && value.length ? "Disponible" : "No disponible";
}

export function invalidateFixtureCache(fixtureId) {
  const cachedDataset = datasetCache.get(fixtureId)?.value;
  const relatedTeamIds = new Set([cachedDataset?.fixture?.homeTeamId, cachedDataset?.fixture?.awayTeamId].filter(Boolean).map(String));
  datasetCache.delete(fixtureId);
  for (const cacheKey of requestCache.keys()) {
    const url = new URL(cacheKey);
    const sameFixture = url.searchParams.get("fixture") === String(fixtureId) || url.searchParams.get("id") === String(fixtureId);
    const sameTeam = relatedTeamIds.has(url.searchParams.get("team"));
    if (sameFixture || sameTeam) requestCache.delete(cacheKey);
  }
}

export async function getFixtureDataset(fixtureId, { forceRefresh = false } = {}) {
  if (forceRefresh) invalidateFixtureCache(fixtureId);
  const cachedDataset = datasetCache.get(fixtureId);
  if (cachedDataset?.expiresAt > Date.now()) return cachedDataset.value;
  const fixtureRows = await apiRequest("/fixtures", { id: fixtureId, timezone: PACIFIC_TIME_ZONE }, LIVE_CACHE_TTL);
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
  const statisticsCutoffDate = new Date(Date.parse(base.fixture.date) - 86400000).toISOString().slice(0, 10);
  const safe = (promise) => promise.catch(() => []);
  const safeAdvanced = (promise) => promise.then((data) => ({ data, failed: false })).catch(() => ({ data: null, failed: true }));
  const [statistics, standings, h2h, injuries, lineups, odds, homeRecentRows, awayRecentRows, eventsResult, playersResult, homeTeamStatsResult, awayTeamStatsResult] = await Promise.all([
    safe(apiRequest("/fixtures/statistics", { fixture: fixtureId })),
    safe(apiRequest("/standings", { league: base.league.id, season })),
    safe(apiRequest("/fixtures/headtohead", { h2h: `${homeId}-${awayId}`, last: 10 })),
    safe(apiRequest("/injuries", { fixture: fixtureId })),
    safe(apiRequest("/fixtures/lineups", { fixture: fixtureId })),
    safe(apiRequest("/odds", { fixture: fixtureId })),
    safe(apiRequest("/fixtures", { team: homeId, last: 8, timezone: "UTC" })),
    safe(apiRequest("/fixtures", { team: awayId, last: 8, timezone: "UTC" })),
    safeAdvanced(apiRequest("/fixtures/events", { fixture: fixtureId })),
    safeAdvanced(apiRequest("/fixtures/players", { fixture: fixtureId })),
    safeAdvanced(apiRequest("/teams/statistics", { league: base.league.id, season, team: homeId, date: statisticsCutoffDate })),
    safeAdvanced(apiRequest("/teams/statistics", { league: base.league.id, season, team: awayId, date: statisticsCutoffDate }))
  ]);

  const fixture = normalizeFixture(base, leagueConfig);
  const homeForm = summarizeRecentFixtures(homeRecentRows, homeId, base.fixture.date);
  const awayForm = summarizeRecentFixtures(awayRecentRows, awayId, base.fixture.date);
  const oddsSummary = normalizeOdds(odds, { homeName: fixture.home, awayName: fixture.away });
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
    confirmed: {
      statistics, standings, h2h, injuries, lineups, odds,
      events: eventsResult.data || [], players: playersResult.data || [],
      teamStatistics: { home: homeTeamStatsResult.data || null, away: awayTeamStatsResult.data || null, cutoffDate: statisticsCutoffDate }
    },
    advancedFailures: {
      events: eventsResult.failed, players: playersResult.failed,
      homeTeamStatistics: homeTeamStatsResult.failed, awayTeamStatistics: awayTeamStatsResult.failed
    },
    preMatch,
    marketAnalysis,
    dataQuality,
    unavailable: ["weather", "news", "referee_details", "travel", "sidelined_not_verified"],
    qualityAlerts: ["Los datos vacíos se conservan como no disponibles; no se completan por inferencia."]
  };
  dataset.estimatedXg = buildEstimatedXgFromDataset(dataset);
  dataset.externalSources = await collectExternalSourceData(dataset, { forceRefresh });
  fixture.dataAvailability.xg = dataset.estimatedXg.status === "available"
    ? "Disponible" : dataset.estimatedXg.status === "partial" ? "Necesita revisión" : fixture.dataAvailability.xg;
  dataset.researchData = normalizeMatchResearchData(dataset);
  dataset.analysisInput = buildAnalysisInput(dataset);
  datasetCache.set(fixtureId, { value: dataset, expiresAt: Date.now() + CACHE_TTL });
  return dataset;
}

export async function getFixtureResult(fixtureId) {
  const fixtureRows = await apiRequest("/fixtures", { id: fixtureId, timezone: PACIFIC_TIME_ZONE }, LIVE_CACHE_TTL);
  const row = fixtureRows[0];
  if (!row) throw new AppError("Fixture no encontrado.", 404, "FIXTURE_NOT_FOUND");
  const shortStatus = row.fixture.status?.short || "TBD";
  return {
    fixtureId: String(row.fixture.id),
    status: shortStatus,
    statusLabel: statusLabel(shortStatus),
    appStatus: fixtureStatus(shortStatus),
    elapsed: row.fixture.status?.elapsed ?? null,
    finished: ["FT", "AET", "PEN"].includes(shortStatus),
    goals: { home: row.goals?.home ?? null, away: row.goals?.away ?? null },
    date: row.fixture.date,
    home: row.teams?.home?.name,
    away: row.teams?.away?.name
  };
}
