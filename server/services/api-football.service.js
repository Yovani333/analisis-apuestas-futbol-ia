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
import { getHistoricalEstimatedXgXga } from "./xg/historical-estimated-xg.service.js";
import {
  recordApiFootballCacheHit,
  recordApiFootballCacheMiss,
  recordApiFootballFailure,
  recordApiFootballNegativeCacheHit,
  recordApiFootballPendingHit,
  recordApiFootballResponse
} from "./api-football-observability.service.js";
import { evaluatePickRecommendations } from "./pick-recommendation.service.js";
import { calculateCornersModel } from "./corners-model.service.js";
import { calculatePoissonModel } from "./poisson-model.service.js";
import { calculateTeamGoalProbability } from "./team-goal-probability.service.js";
import { resolveModuleQuality } from "./module-quality.service.js";
import { buildCompetitionContext } from "./competition-context.service.js";
import { getWeatherContextData } from "./sources/weather.service.js";

const leagueCache = new Map();
const leagueCacheExpiry = new Map();
const requestCache = new Map();
const negativeRequestCache = new Map();
const pendingApiRequests = new Map();
const datasetCache = new Map();
const pendingDatasetRequests = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const NEGATIVE_CACHE_TTL = 5 * 60 * 1000;
const LIVE_CACHE_TTL = 60 * 1000;
const PREDICTION_CACHE_TTL = 30 * 60 * 1000;
const HISTORICAL_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const SCHEDULED_DATASET_CACHE_TTL = 30 * 60 * 1000;
const FINISHED_DATASET_CACHE_TTL = 24 * 60 * 60 * 1000;
const LEAGUE_CACHE_TTL = 6 * 60 * 60 * 1000;
const PACIFIC_TIME_ZONE = "America/Los_Angeles";

export function resolveApiResponseCacheTtl(value, requestedTtl, { emptyTtl = CACHE_TTL, hasUsableData } = {}) {
  if (typeof hasUsableData !== "function") return requestedTtl;
  return hasUsableData(value) ? requestedTtl : Math.min(requestedTtl, emptyTtl);
}

function getCached(key) {
  const item = requestCache.get(key);
  if (!item || item.expiresAt < Date.now()) return null;
  return item.value;
}

function getNegativeCached(key) {
  const item = negativeRequestCache.get(key);
  if (!item) return null;
  if (item.expiresAt < Date.now()) {
    negativeRequestCache.delete(key);
    return null;
  }
  return item.error;
}

function cacheRequestError(key, error, ttlMs = NEGATIVE_CACHE_TTL) {
  negativeRequestCache.set(key, {
    error: { message: error.message, status: error.status, code: error.code, details: error.details },
    expiresAt: Date.now() + ttlMs
  });
}

function restoreCachedError(error) {
  return new AppError(error.message, error.status, error.code, error.details);
}

function cacheMeta({ status, source, ttlMs, expiresAt, reason }) {
  return {
    status,
    source,
    ttlMs,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : "",
    reason
  };
}

async function apiRequest(path, params = {}, cacheTtl = CACHE_TTL, cachePolicy = {}) {
  if (!env.apiFootballKey) throw new AppError("API-Football no está configurada.", 503, "API_FOOTBALL_NOT_CONFIGURED");
  const url = new URL(path, env.apiFootballBaseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  const cacheKey = url.toString();
  const cached = getCached(cacheKey);
  if (cached) {
    recordApiFootballCacheHit({ endpoint: url.pathname });
    return cached;
  }
  const negativeCached = getNegativeCached(cacheKey);
  if (negativeCached) {
    recordApiFootballNegativeCacheHit({ endpoint: url.pathname });
    throw restoreCachedError(negativeCached);
  }
  if (pendingApiRequests.has(cacheKey)) {
    recordApiFootballPendingHit({ endpoint: url.pathname });
    return pendingApiRequests.get(cacheKey);
  }
  recordApiFootballCacheMiss({ endpoint: url.pathname });

  const request = (async () => {
  let response;
  try {
    response = await fetch(url, {
      headers: { "x-apisports-key": env.apiFootballKey },
      signal: AbortSignal.timeout(12000)
    });
  } catch {
    recordApiFootballFailure({ endpoint: url.pathname, code: "API_FOOTBALL_NETWORK_ERROR" });
    throw new AppError("No fue posible conectar con API-Football.", 502, "API_FOOTBALL_NETWORK_ERROR");
  }
  recordApiFootballResponse({ endpoint: url.pathname, headers: response.headers });
  if (!response.ok) {
    const rateLimited = response.status === 429;
    const code = rateLimited ? "API_FOOTBALL_RATE_LIMIT" : "API_FOOTBALL_HTTP_ERROR";
    recordApiFootballFailure({ endpoint: url.pathname, code, headers: response.headers });
    throw new AppError(
      rateLimited ? "API-Football alcanzó temporalmente su límite de solicitudes." : "API-Football no respondió correctamente.",
      rateLimited ? 429 : 502,
      code,
      { status: response.status }
    );
  }
  const payload = await response.json();
  const providerErrors = payload.errors && (Array.isArray(payload.errors) ? payload.errors : Object.values(payload.errors));
  if (providerErrors?.length) {
    recordApiFootballFailure({ endpoint: url.pathname, code: "API_FOOTBALL_PROVIDER_ERROR", headers: response.headers });
    throw new AppError("API-Football rechazó la consulta.", 502, "API_FOOTBALL_PROVIDER_ERROR");
  }
  const value = payload.response || [];
  const responseCacheTtl = resolveApiResponseCacheTtl(value, cacheTtl, cachePolicy);
  requestCache.set(cacheKey, { value, expiresAt: Date.now() + responseCacheTtl });
  negativeRequestCache.delete(cacheKey);
  return value;
  })().catch((error) => {
    if (error instanceof AppError) {
      const ttlMs = error.code === "API_FOOTBALL_RATE_LIMIT" || error.code === "API_FOOTBALL_NETWORK_ERROR"
        ? 30 * 1000
        : NEGATIVE_CACHE_TTL;
      cacheRequestError(cacheKey, error, ttlMs);
    }
    throw error;
  }).finally(() => pendingApiRequests.delete(cacheKey));
  pendingApiRequests.set(cacheKey, request);
  return request;
}

export async function getPreviousFixturesForTeam(teamId, limit = 5) {
  return apiRequest("/fixtures", { team: teamId, last: limit, timezone: "UTC" }, SCHEDULED_DATASET_CACHE_TTL);
}

export async function getFixtureStatistics(fixtureId) {
  return apiRequest("/fixtures/statistics", { fixture: fixtureId }, HISTORICAL_CACHE_TTL, {
    emptyTtl: CACHE_TTL,
    hasUsableData: (rows) => Array.isArray(rows) && rows.some((row) =>
      Array.isArray(row?.statistics) && row.statistics.some((stat) => stat?.value !== null && stat?.value !== undefined && stat?.value !== "")
    )
  });
}

export async function getFixtureEvents(fixtureId) {
  return apiRequest("/fixtures/events", { fixture: fixtureId }, HISTORICAL_CACHE_TTL, {
    emptyTtl: CACHE_TTL,
    hasUsableData: (rows) => Array.isArray(rows) && rows.length > 0
  });
}

export async function getFixturePlayers(fixtureId) {
  return apiRequest("/fixtures/players", { fixture: fixtureId }, HISTORICAL_CACHE_TTL);
}

export async function getFixtureLineups(fixtureId) {
  return apiRequest("/fixtures/lineups", { fixture: fixtureId }, HISTORICAL_CACHE_TTL);
}

export function chooseSeason(seasons, requestedSeason, targetDate) {
  if (requestedSeason !== "auto") return requestedSeason;
  const byDate = seasons.find((season) => season.start <= targetDate && season.end >= targetDate);
  const current = seasons.find((season) => season.current);
  const latest = [...seasons].sort((a, b) => b.year - a.year)[0];
  return byDate?.year || current?.year || latest?.year;
}

function cachedLeague(slug) {
  if ((leagueCacheExpiry.get(slug) || 0) <= Date.now()) {
    leagueCache.delete(slug);
    leagueCacheExpiry.delete(slug);
    return null;
  }
  return leagueCache.get(slug) || null;
}

function cacheLeague(slug, value) {
  leagueCache.set(slug, value);
  leagueCacheExpiry.set(slug, Date.now() + LEAGUE_CACHE_TTL);
  return value;
}

export async function resolveLeague(slug, includeSeasons = false) {
  const cached = cachedLeague(slug);
  if (cached && (!includeSeasons || cached.seasons?.length)) return cached;
  const config = getAllowedLeague(slug);
  if (!config) throw new AppError("Liga no permitida.", 400, "INVALID_LEAGUE");

  if (config.apiId && !includeSeasons) {
    const resolved = { ...config, seasons: [] };
    return cacheLeague(slug, resolved);
  }

  if (config.apiId && includeSeasons) {
    const [match] = await apiRequest("/leagues", { id: config.apiId });
    if (match) {
      const resolved = { ...config, seasons: match.seasons || [] };
      return cacheLeague(slug, resolved);
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
      return cacheLeague(slug, resolved);
    }
  }
  throw new AppError(`No se pudo verificar ${config.name} en API-Football.`, 502, "LEAGUE_NOT_RESOLVED");
}

function providerStatus(status) {
  if (status === "scheduled") return "NS-TBD";
  if (status === "live") return "1H-HT-2H-ET-BT-P-INT-LIVE";
  if (status === "finished") return "FT-AET-PEN";
  return undefined;
}

function statusLabel(short) {
  if (["NS", "TBD"].includes(short)) return "Programado";
  if (["FT", "AET", "PEN"].includes(short)) return "Completo";
  if (["1H", "HT", "2H", "ET", "BT", "P", "LIVE"].includes(short)) return "En vivo";
  if (short === "PST") return "Postergado";
  if (short === "CANC") return "Cancelado";
  if (["SUSP", "ABD", "INT"].includes(short)) return "Suspendido";
  if (["AWD", "WO"].includes(short)) return "Finalizado";
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
  const parsePercent = (value) => {
    const parsed = Number.parseFloat(String(value ?? "").replace("%", ""));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const probabilities = {
    home: parsePercent(prediction?.percent?.home),
    draw: parsePercent(prediction?.percent?.draw),
    away: parsePercent(prediction?.percent?.away)
  };
  const highestSide = Object.entries(probabilities)
    .filter(([, value]) => value !== null)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  if (highestSide === "draw") return null;
  const side = highestSide || (
    winner?.id === fixture.homeTeamId ? "home" :
      winner?.id === fixture.awayTeamId ? "away" : null
  );
  if (!side) return null;
  const teamId = side === "home" ? fixture.homeTeamId : fixture.awayTeamId;
  const team = side === "home" ? fixture.home : fixture.away;
  if (!teamId || !team) return null;

  return {
    teamId, team, side, market: "1X2", percent: probabilities[side], probabilities,
    comment: winner?.comment || "", source: "api-football-predictions",
    note: "Probabilidades 1X2 del proveedor: local, empate y visitante se muestran por separado."
  };
}

export function normalizeFixture(item, league) {
  const date = new Date(item.fixture.date);
  const pacific = pacificDateParts(date);
  const shortStatus = item.fixture.status.short;
  const neutralVenue = Boolean(league.neutralVenue || league.slug === "world-cup");
  const round = item.league?.round || "";
  const competitionType = league.competitionType || (item.league?.type === "Cup" ? "cup" : "league");
  const isQualifyingRound = competitionType === "qualifying" || /qualifying/i.test(round);
  const isKnockoutRound = isQualifyingRound || /round of|quarter|semi|final/i.test(round);
  const apiCoverage = league.seasons?.find((season) => Number(season.year) === Number(item.league?.season))?.coverage || null;
  return {
    id: String(item.fixture.id),
    leagueSlug: league.slug,
    leagueName: league.name,
    leagueId: item.league.id,
    season: item.league.season,
    round,
    competitionType,
    competitionScope: isQualifyingRound ? "qualifying" : competitionType,
    region: league.region || "",
    confederation: league.confederation || "",
    isQualifyingRound,
    isKnockoutRound,
    coverageLevel: league.coverageLevel || "standard",
    apiCoverage,
    home: item.teams.home.name,
    away: item.teams.away.name,
    homeLogo: item.teams.home.logo || "",
    awayLogo: item.teams.away.logo || "",
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
    venueId: item.fixture.venue?.id ?? null,
    stadium: item.fixture.venue?.name || "No disponible",
    city: item.fixture.venue?.city || "",
    stadiumSource: item.fixture.venue?.name ? (item.fixture.venue?._hydrated ? "api-football-venues" : "api-football-fixture") : "not_available",
    latitude: item.fixture.venue?.latitude ?? item.fixture.venue?.lat ?? null,
    longitude: item.fixture.venue?.longitude ?? item.fixture.venue?.lng ?? item.fixture.venue?.lon ?? null,
    country: league.countryLabel,
    score: { home: item.goals?.home ?? null, away: item.goals?.away ?? null },
    penaltyScore: { home: item.score?.penalty?.home ?? null, away: item.score?.penalty?.away ?? null },
    dataAvailability: {
      standings: "No disponible", statistics: "No disponible", h2h: "No disponible",
      injuries: "No disponible", lineups: "No disponible", odds: "No disponible",
      xg: "No disponible", context: "No disponible", weather: "No disponible"
    }
  };
}

function matchesConfiguredRound(item, league) {
  if (!league.roundIncludes?.length) return true;
  const round = String(item.league?.round || "").toLowerCase();
  return league.roundIncludes.some((value) => round.includes(String(value).toLowerCase()));
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function searchFixtures(filters, { request = apiRequest, leagueResolver = resolveLeague, onLeagueError = () => {} } = {}) {
  const groups = await mapWithConcurrency(filters.leagues, 4, async (slug) => {
    try {
      const league = await leagueResolver(slug, filters.season === "auto");
      const season = chooseSeason(league.seasons, filters.season, filters.dateFrom);
      if (!season) throw new AppError(`No se encontró temporada válida para ${league.name}.`, 422, "SEASON_NOT_RESOLVED");
      const fixtures = await request("/fixtures", {
        league: league.apiId, season, from: filters.dateFrom, to: filters.dateTo, status: providerStatus(filters.status), timezone: PACIFIC_TIME_ZONE
      }, LIVE_CACHE_TTL);
      return fixtures
        .filter((item) => matchesConfiguredRound(item, league))
        .map((item) => normalizeFixture(item, league))
        .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
    } catch (error) {
      onLeagueError({ slug, code: error.code || "LEAGUE_SEARCH_FAILED", message: error.message || "API-Football no devolvió datos." });
      return [];
    }
  });
  const unique = new Map(groups.flat().map((fixture) => [fixture.id, fixture]));
  return [...unique.values()].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
}

export function shouldLoadCurrentFixtureData(status) {
  return fixtureStatus(status) !== "scheduled";
}

export function isCoverageAvailable(coverage, path, fallback = true) {
  if (!coverage) return fallback;
  let value = coverage;
  for (const key of String(path).split(".")) value = value?.[key];
  return value !== false;
}

function availability(value) {
  return Array.isArray(value) && value.length ? "Disponible" : "No disponible";
}

export function invalidateFixtureCache(fixtureId) {
  const key = String(fixtureId);
  const cachedDataset = datasetCache.get(key)?.value || datasetCache.get(fixtureId)?.value;
  const relatedTeamIds = new Set([cachedDataset?.fixture?.homeTeamId, cachedDataset?.fixture?.awayTeamId].filter(Boolean).map(String));
  datasetCache.delete(key);
  datasetCache.delete(fixtureId);
  for (const cache of [requestCache, negativeRequestCache]) {
    for (const cacheKey of cache.keys()) {
      const url = new URL(cacheKey);
      const sameFixture = url.searchParams.get("fixture") === String(fixtureId) || url.searchParams.get("id") === String(fixtureId);
      const sameTeam = relatedTeamIds.has(url.searchParams.get("team"));
      if (sameFixture || sameTeam) cache.delete(cacheKey);
    }
  }
}

export function getCachedFixtureDataset(fixtureId) {
  const cached = datasetCache.get(String(fixtureId)) || datasetCache.get(Number(fixtureId));
  return cached?.expiresAt > Date.now() ? cached.value : null;
}

export async function getPlayerGoalFixtureDataset(fixtureId) {
  const cached = getCachedFixtureDataset(fixtureId);
  if (cached) return cached;
  const fixtureRows = await apiRequest("/fixtures", { id: fixtureId, timezone: PACIFIC_TIME_ZONE }, LIVE_CACHE_TTL);
  const base = fixtureRows[0];
  if (!base) throw new AppError("Fixture no encontrado.", 404, "FIXTURE_NOT_FOUND");
  const leagueConfigBase = ALLOWED_LEAGUES.find((league) => league.apiId === base.league?.id || league.apiNames.some((name) => name.toLowerCase() === base.league?.name?.toLowerCase()));
  const resolvedLeague = leagueConfigBase ? cachedLeague(leagueConfigBase.slug) : null;
  const leagueConfig = leagueConfigBase ? { ...leagueConfigBase, seasons: resolvedLeague?.seasons || [] } : null;
  if (!leagueConfig) throw new AppError("El fixture no pertenece a una liga permitida.", 403, "FIXTURE_LEAGUE_NOT_ALLOWED");
  const coverage = leagueConfig.seasons?.find((item) => Number(item.year) === Number(base.league?.season))?.coverage || null;
  const [injuries, odds] = await Promise.all([
    isCoverageAvailable(coverage, "injuries") ? apiRequest("/injuries", { fixture: fixtureId }).catch(() => []) : Promise.resolve([]),
    isCoverageAvailable(coverage, "odds") ? apiRequest("/odds", { fixture: fixtureId }).catch(() => []) : Promise.resolve([])
  ]);
  return {
    fixture: normalizeFixture(base, { ...leagueConfig, name: base.league.name, countryLabel: base.league.country || leagueConfig.countryLabel }),
    confirmed: { injuries, odds }
  };
}

async function buildFixtureDataset(fixtureId, { forceRefresh = false, includeHistorical = false } = {}) {
  const fixtureRows = await apiRequest("/fixtures", { id: fixtureId, timezone: PACIFIC_TIME_ZONE }, LIVE_CACHE_TTL);
  const base = fixtureRows[0];
  if (!base) throw new AppError("Fixture no encontrado.", 404, "FIXTURE_NOT_FOUND");

  const venueId = base.fixture?.venue?.id;
  if (venueId && (!base.fixture.venue?.name || !base.fixture.venue?.city)) {
    const venue = (await apiRequest("/venues", { id: venueId }, HISTORICAL_CACHE_TTL).catch(() => []))[0];
    if (venue) base.fixture.venue = {
      ...base.fixture.venue,
      name: base.fixture.venue?.name || venue.name || null,
      city: base.fixture.venue?.city || venue.city || null,
      latitude: base.fixture.venue?.latitude ?? venue.latitude ?? null,
      longitude: base.fixture.venue?.longitude ?? venue.longitude ?? null,
      _hydrated: true
    };
  }

  const leagueConfigBase = ALLOWED_LEAGUES.find((league) =>
    league.country.toLowerCase() === base.league.country?.toLowerCase() &&
    league.apiNames.some((name) => name.toLowerCase() === base.league.name?.toLowerCase())
  );
  const resolvedLeague = leagueConfigBase ? cachedLeague(leagueConfigBase.slug) : null;
  const leagueConfig = leagueConfigBase ? { ...leagueConfigBase, apiId: base.league.id, seasons: resolvedLeague?.seasons || [] } : null;
  if (!leagueConfig) throw new AppError("El fixture no pertenece a una liga permitida.", 403, "FIXTURE_LEAGUE_NOT_ALLOWED");

  const homeId = base.teams.home.id;
  const awayId = base.teams.away.id;
  const season = base.league.season;
  const loadCurrentFixtureData = shouldLoadCurrentFixtureData(base.fixture.status?.short);
  const coverage = leagueConfig.seasons?.find((item) => Number(item.year) === Number(season))?.coverage || null;
  const allows = (path, fallback = true) => isCoverageAvailable(coverage, path, fallback);
  const unavailableByCoverage = [
    ["Clasificación", "standings"], ["Lesiones", "injuries"], ["Alineaciones", "fixtures.lineups"],
    ["Cuotas", "odds"], ["Estadísticas de fixture", "fixtures.statistics_fixtures"],
    ["Estadísticas de jugadores", "fixtures.statistics_players"], ["Jugadores", "players"]
  ].filter(([, path]) => !allows(path)).map(([label]) => label);
  const statisticsCutoffDate = new Date(Date.parse(base.fixture.date) - 86400000).toISOString().slice(0, 10);
  const safe = (promise) => promise.catch(() => []);
  const safeAdvanced = (promise) => promise.then((data) => ({ data, failed: false })).catch(() => ({ data: null, failed: true }));
  const [statistics, standings, h2h, injuries, lineups, odds, homeRecentRows, awayRecentRows, predictions, eventsResult, playersResult, homeTeamStatsResult, awayTeamStatsResult] = await Promise.all([
    loadCurrentFixtureData && allows("fixtures.statistics_fixtures") ? safe(apiRequest("/fixtures/statistics", { fixture: fixtureId })) : Promise.resolve([]),
    allows("standings") ? safe(apiRequest("/standings", { league: base.league.id, season })) : Promise.resolve([]),
    safe(apiRequest("/fixtures/headtohead", { h2h: `${homeId}-${awayId}`, last: 10 })),
    allows("injuries") ? safe(apiRequest("/injuries", { fixture: fixtureId })) : Promise.resolve([]),
    allows("fixtures.lineups") ? safe(apiRequest("/fixtures/lineups", { fixture: fixtureId })) : Promise.resolve([]),
    allows("odds") ? safe(apiRequest("/odds", { fixture: fixtureId })) : Promise.resolve([]),
    safe(apiRequest("/fixtures", { team: homeId, last: 10, timezone: "UTC" })),
    safe(apiRequest("/fixtures", { team: awayId, last: 10, timezone: "UTC" })),
    allows("predictions") ? safe(apiRequest("/predictions", { fixture: fixtureId }, PREDICTION_CACHE_TTL)) : Promise.resolve([]),
    loadCurrentFixtureData && allows("fixtures.events") ? safeAdvanced(apiRequest("/fixtures/events", { fixture: fixtureId })) : Promise.resolve({ data: [], failed: false }),
    loadCurrentFixtureData && allows("fixtures.statistics_players") ? safeAdvanced(apiRequest("/fixtures/players", { fixture: fixtureId })) : Promise.resolve({ data: [], failed: false }),
    allows("fixtures.statistics_fixtures") ? safeAdvanced(apiRequest("/teams/statistics", { league: base.league.id, season, team: homeId, date: statisticsCutoffDate })) : Promise.resolve({ data: null, failed: false }),
    allows("fixtures.statistics_fixtures") ? safeAdvanced(apiRequest("/teams/statistics", { league: base.league.id, season, team: awayId, date: statisticsCutoffDate })) : Promise.resolve({ data: null, failed: false })
  ]);

  const fixture = normalizeFixture(base, leagueConfig);
  fixture.favorite = normalizeFavorite(predictions, fixture);
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
  const competitionContext = buildCompetitionContext(fixture, [...homeRecentRows, ...awayRecentRows]);
  preMatch.context = { ...(preMatch.context || {}), competition: competitionContext };
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
    competitionContext,
    unavailable: ["news", "referee_details", "travel", "sidelined_not_verified", ...unavailableByCoverage.map((item) => `api_no_coverage:${item}`)],
    qualityAlerts: [
      "Los datos vacíos se conservan como no disponibles; no se completan por inferencia.",
      unavailableByCoverage.length ? `Datos no disponibles en la API para esta temporada: ${unavailableByCoverage.join(", ")}.` : ""
    ].filter(Boolean)
  };
  dataset.estimatedXg = buildEstimatedXgFromDataset(dataset);
  const currentFixtureXgAvailable = ["available", "partial"].includes(dataset.estimatedXg?.status);
  const historicalXgMode = includeHistorical || fixture.status === "scheduled" || !currentFixtureXgAvailable;
  const retainOfficialHistoryForCorners = fixture.leagueSlug === "world-cup";
  console.info("[xg-mode]", {
    fixtureId: fixture.id,
    fixtureStatus: fixture.status,
    providerStatus: base.fixture.status?.short || "",
    mode: historicalXgMode ? "historical" : "current_fixture",
    homePreviousFixturesFound: homeRecentRows.length,
    awayPreviousFixturesFound: awayRecentRows.length
  });
  dataset.historicalEstimatedXg = historicalXgMode || retainOfficialHistoryForCorners
    ? await getHistoricalEstimatedXgXga({
      fixtureId: fixture.id,
      fixtureDate: base.fixture.date,
      homeTeam: { id: homeId, name: fixture.home },
      awayTeam: { id: awayId, name: fixture.away },
      homePreviousFixtures: homeRecentRows,
      awayPreviousFixtures: awayRecentRows,
      getFixtureStatistics,
      getFixtureEvents,
      limit: 10,
      worldCup: fixture.leagueSlug === "world-cup",
      updatedAt: dataset.fetchedAt
    })
    : null;
  if (dataset.historicalEstimatedXg) {
    const historical = dataset.historicalEstimatedXg;
    console.info("[xg-historical-result]", {
      fixtureId: fixture.id,
      status: historical.status,
      homeValidFixtures: historical.homeTeam?.sampleSize || 0,
      awayValidFixtures: historical.awayTeam?.sampleSize || 0,
      homeXG: historical.homeTeam?.historicalEstimatedXGAvg ?? null,
      homeXGA: historical.homeTeam?.historicalEstimatedXGAAvg ?? null,
      awayXG: historical.awayTeam?.historicalEstimatedXGAvg ?? null,
      awayXGA: historical.awayTeam?.historicalEstimatedXGAAvg ?? null,
      reason: historical.confidence?.notes?.join(" ") || ""
    });
  }
  dataset.externalSources = await collectExternalSourceData(dataset, { forceRefresh });
  const activeInternalXg = currentFixtureXgAvailable ? dataset.estimatedXg : dataset.historicalEstimatedXg;
  fixture.dataAvailability.xg = activeInternalXg?.status === "available"
    ? "Disponible" : activeInternalXg?.status === "partial" ? "Necesita revisión" : fixture.dataAvailability.xg;
  dataset.researchData = normalizeMatchResearchData(dataset);
  dataset.poissonModel = calculatePoissonModel(dataset);
  dataset.teamGoalProbability = calculateTeamGoalProbability({ ...dataset, poissonModel: dataset.poissonModel });
  dataset.cornersModel = calculateCornersModel(dataset);
  dataset.researchData.corners = dataset.cornersModel;
  dataset.researchData.sourceCoverage.push({
    module: "corners", moduleKey: "corners", label: "Corners Mundial / Torneos Cortos",
    primarySources: ["API-Football fixtures", "API-Football fixture statistics"],
    secondarySources: [], activeSources: dataset.cornersModel.status === "not_available" ? [] : ["API-Football + modelo interno"],
    status: dataset.cornersModel.status, quality: dataset.cornersModel.quality, updatedAt: dataset.cornersModel.generatedAt,
    observation: dataset.cornersModel.status === "not_available" ? dataset.cornersModel.warning : `Calidad ${dataset.cornersModel.quality.label} (${dataset.cornersModel.quality.score}/100). Calculado con ${Math.min(dataset.cornersModel.teams.home.useful, dataset.cornersModel.teams.away.useful)} partidos oficiales por selección; amistosos excluidos.`
  });
  const engineQuality = resolveModuleQuality({ score: dataset.researchData.totalConfidenceScore, status: dataset.dataQuality.canSuggest ? "available" : "partial", notes: dataset.qualityAlerts });
  const advancedRows = [
    { module: "dataPicks", label: "Ver Picks / Picks generados por datos", source: "Motor de reglas + datos normalizados", quality: engineQuality },
    { module: "ruleEngine", label: "Motor de Reglas", source: "Datos normalizados internos", quality: engineQuality },
    { module: "poisson", label: "Modelo Poisson", source: "Poisson interno", quality: dataset.poissonModel.quality },
    { module: "teamGoalProbability", label: "Probabilidad de Gol por Equipo", source: "Modelo interno ataque vs defensa", quality: dataset.teamGoalProbability.quality }
  ];
  advancedRows.forEach((row) => dataset.researchData.sourceCoverage.push({
    module: row.module, moduleKey: row.module, label: row.label,
    primarySources: ["API-Football statistics", "Datos normalizados internos"], secondarySources: [],
    activeSources: row.quality.status === "not_available" ? [] : [row.source], status: row.quality.status,
    quality: row.quality, updatedAt: dataset.fetchedAt,
    observation: `Calidad ${row.quality.label} (${row.quality.score}/100). ${row.quality.notes[0] || "Sin observaciones adicionales."}`
  }));
  dataset.pickRecommendation = evaluatePickRecommendations(dataset);
  dataset.researchData.pickDecision = dataset.pickRecommendation;
  dataset.researchData.odds.markets = (dataset.researchData.odds.markets || []).map((market) => {
    const reviewed = dataset.pickRecommendation.reviewedPicks.find((pick) =>
      pick.marketKey === market.marketKey && pick.selectionKey === market.selectionKey
    );
    return reviewed ? { ...market, ...reviewed } : market;
  });
  dataset.analysisInput = buildAnalysisInput(dataset);
  return dataset;
}

function datasetCacheTtl(fixture) {
  if (fixture?.status === "live") return LIVE_CACHE_TTL;
  if (fixture?.status === "finished") return FINISHED_DATASET_CACHE_TTL;
  return SCHEDULED_DATASET_CACHE_TTL;
}

function withCacheInfo(dataset, info) {
  return {
    ...dataset,
    cacheInfo: info,
    researchData: dataset.researchData ? { ...dataset.researchData, cacheInfo: info } : dataset.researchData
  };
}

export async function getFixtureDataset(fixtureId, { forceRefresh = false, includeHistorical = false } = {}) {
  const key = String(fixtureId);
  if (forceRefresh) invalidateFixtureCache(key);
  const cachedDataset = datasetCache.get(key);
  if (cachedDataset?.expiresAt > Date.now() && (!includeHistorical || cachedDataset.value.historicalEstimatedXg)) {
    return withCacheInfo(cachedDataset.value, cacheMeta({
      status: "hit",
      source: "memory-dataset-cache",
      ttlMs: Math.max(0, cachedDataset.expiresAt - Date.now()),
      expiresAt: cachedDataset.expiresAt,
      reason: "Se reutilizo el dataset normalizado del fixture; no se recalcularon historicos."
    }));
  }
  if (!forceRefresh && pendingDatasetRequests.has(key)) {
    recordApiFootballPendingHit();
    return pendingDatasetRequests.get(key);
  }
  const request = (async () => {
    const updateReason = forceRefresh ? "refresh_forzado_por_usuario" : cachedDataset ? "cache_expirado" : "primera_carga";
    const dataset = await buildFixtureDataset(key, { forceRefresh, includeHistorical });
    const ttlMs = datasetCacheTtl(dataset.fixture);
    const expiresAt = Date.now() + ttlMs;
    const value = withCacheInfo(dataset, cacheMeta({
      status: "miss",
      source: "api-football",
      ttlMs,
      expiresAt,
      reason: updateReason
    }));
    datasetCache.set(key, { value, expiresAt });
    return value;
  })().finally(() => pendingDatasetRequests.delete(key));
  pendingDatasetRequests.set(key, request);
  return request;
}

export async function refreshFixtureWeather(fixtureId, { forceRefresh = true } = {}) {
  const key = String(fixtureId);
  const cachedEntry = datasetCache.get(key) || datasetCache.get(Number(fixtureId));
  const dataset = cachedEntry?.value || await getFixtureDataset(key);
  const weather = await getWeatherContextData(dataset, {
    accessMode: env.weatherAccessMode,
    forceRefresh
  });
  dataset.externalSources = { ...(dataset.externalSources || {}), weather };

  const normalized = normalizeMatchResearchData(dataset);
  const weatherCoverage = normalized.sourceCoverage.find((row) => row.moduleKey === "weatherPitch") || null;
  const previousCoverage = dataset.researchData?.sourceCoverage || [];
  const researchData = {
    ...(dataset.researchData || normalized),
    weatherPitch: normalized.weatherPitch,
    sources: { ...(dataset.researchData?.sources || normalized.sources), weather: normalized.sources.weather },
    sourceCoverage: [
      ...previousCoverage.filter((row) => row.moduleKey !== "weatherPitch"),
      ...(weatherCoverage ? [weatherCoverage] : [])
    ],
    lastUpdated: weather.updatedAt || new Date().toISOString()
  };
  dataset.researchData = researchData;
  dataset.fixture.dataAvailability.weather = weather.data ? "Necesita revisiÃ³n" : "No disponible";

  if (cachedEntry) cachedEntry.value = dataset;
  return {
    source: "open-meteo",
    fixtureId: dataset.fixture.id,
    weatherPitch: researchData.weatherPitch,
    weatherSource: weather,
    researchData,
    updatedAt: weather.updatedAt || new Date().toISOString()
  };
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
    penaltyScore: { home: row.score?.penalty?.home ?? null, away: row.score?.penalty?.away ?? null },
    date: row.fixture.date,
    home: row.teams?.home?.name,
    away: row.teams?.away?.name
  };
}
