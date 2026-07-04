import { DATA_STATUS, MODULE_LABELS, MODULE_WEIGHTS } from "../constants/match-research.js";
import { MODULE_SOURCE_PLAN, SOURCE_DEFINITIONS } from "../constants/source-catalog.js";
import { calculateMatchConfidenceScore } from "./match-confidence.service.js";

const SOURCE = "api-football";
const nowIso = () => new Date().toISOString();
const sourceLabel = (key) => SOURCE_DEFINITIONS[key]?.label || key;
const statusForSides = (homeAvailable, awayAvailable) => {
  if (homeAvailable && awayAvailable) return DATA_STATUS.AVAILABLE;
  if (homeAvailable || awayAvailable) return DATA_STATUS.PARTIAL;
  return DATA_STATUS.NOT_AVAILABLE;
};

function moduleBase(status, updatedAt, source = SOURCE, message = "") {
  return { status, source, updatedAt, message };
}

function flattenStandings(rows = []) {
  if (!Array.isArray(rows)) throw new TypeError("La clasificación no tiene formato de arreglo.");
  return rows.flatMap((entry) => entry?.league?.standings || []).flat();
}

export function getStandingsData(dataset) {
  const rows = flattenStandings(dataset.confirmed?.standings);
  const home = rows.find((row) => row.team?.id === dataset.fixture.homeTeamId) || null;
  const away = rows.find((row) => row.team?.id === dataset.fixture.awayTeamId) || null;
  const status = statusForSides(Boolean(home), Boolean(away));
  const compact = (row) => row ? {
    rank: row.rank ?? null, points: row.points ?? null, group: row.group || "",
    played: row.all?.played ?? null, wins: row.all?.win ?? null, draws: row.all?.draw ?? null,
    losses: row.all?.lose ?? null, goalsFor: row.all?.goals?.for ?? null,
    goalsAgainst: row.all?.goals?.against ?? null, goalDifference: row.goalsDiff ?? null, form: row.form || ""
  } : null;
  const soccerway = dataset.externalSources?.soccerway;
  const external = soccerway?.data?.standings;
  if (!home && !away && (external?.home || external?.away)) {
    return {
      ...moduleBase(DATA_STATUS.PARTIAL, soccerway.updatedAt || dataset.fetchedAt, "soccerway",
        "Clasificación complementaria recuperada de Soccerway; requiere revisión."),
      home: external.home || null, away: external.away || null,
      sourceUrl: soccerway.data.competitionUrl || ""
    };
  }
  return {
    ...moduleBase(status, dataset.fetchedAt, SOURCE, status === DATA_STATUS.NOT_AVAILABLE ? "API-Football no devolvió clasificación para los equipos." : ""),
    home: compact(home), away: compact(away)
  };
}

export function getH2HData(dataset) {
  const isHistoricalDate = (value) => {
    if (!value) return false;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date(value));
    return date < dataset.fixture.date;
  };
  const rows = (dataset.confirmed?.h2h || []).filter((row) => {
    const short = row.fixture?.status?.short;
    const hasFinalScore = Number.isFinite(row.goals?.home) && Number.isFinite(row.goals?.away);
    const played = ["FT", "AET", "PEN"].includes(short) || (!short && hasFinalScore);
    return played && isHistoricalDate(row.fixture?.date)
      && String(row.fixture?.id || "") !== String(dataset.fixture.id || "");
  });
  const soccerway = dataset.externalSources?.soccerway;
  const externalMatches = (soccerway?.data?.h2h || []).filter((match) => isHistoricalDate(match.date));
  if (!rows.length && externalMatches.length) {
    const matches = externalMatches;
    let homeWins = 0; let draws = 0; let awayWins = 0;
    matches.forEach((match) => {
      if (match.homeGoals === match.awayGoals) draws += 1;
      else {
        const trackedHomeIsHome = match.homeTeam === dataset.fixture.home;
        if ((match.homeGoals > match.awayGoals) === trackedHomeIsHome) homeWins += 1;
        else awayWins += 1;
      }
    });
    return {
      ...moduleBase(DATA_STATUS.PARTIAL, soccerway.updatedAt || dataset.fetchedAt, "soccerway",
        "H2H complementario recuperado de Soccerway; requiere revisión y se usa como dato secundario."),
      matches, homeWins, draws, awayWins
    };
  }
  let homeWins = 0; let draws = 0; let awayWins = 0;
  const matches = rows.slice(0, 10).map((row) => {
    const homeGoals = row.goals?.home;
    const awayGoals = row.goals?.away;
    const trackedHomeIsHome = row.teams?.home?.id === dataset.fixture.homeTeamId;
    if (Number.isFinite(homeGoals) && Number.isFinite(awayGoals)) {
      if (homeGoals === awayGoals) draws += 1;
      else if ((homeGoals > awayGoals) === trackedHomeIsHome) homeWins += 1;
      else awayWins += 1;
    }
    return {
      fixtureId: String(row.fixture?.id || ""), date: row.fixture?.date?.slice(0, 10) || "",
      homeTeam: row.teams?.home?.name || "", awayTeam: row.teams?.away?.name || "",
      homeGoals: homeGoals ?? null, awayGoals: awayGoals ?? null
    };
  });
  const status = matches.length ? DATA_STATUS.AVAILABLE : DATA_STATUS.NOT_AVAILABLE;
  return {
    ...moduleBase(status, dataset.fetchedAt, SOURCE, matches.length ? "" : "No se encontraron enfrentamientos directos."),
    matches, homeWins: matches.length ? homeWins : null, draws: matches.length ? draws : null,
    awayWins: matches.length ? awayWins : null
  };
}

export function getOddsData(dataset) {
  const apiMarkets = (dataset.marketAnalysis || []).map((market) => ({
    marketKey: market.marketKey, selectionKey: market.selectionKey, market: market.market,
    selection: market.selection, decimalOdds: market.decimalOdds, bookmaker: market.bookmaker || dataset.preMatch?.odds?.bookmaker || "",
    bookmakerId: market.bookmakerId ?? null, sourceProvider: market.sourceProvider || "api-football",
    status: market.status || "available", isPreferredBookmaker: Boolean(market.isPreferredBookmaker),
    oddsFreshnessStatus: market.oddsFreshnessStatus || "unknown",
    impliedProbabilityPct: market.impliedProbabilityPct, noVigImpliedProbabilityPct: market.noVigImpliedProbabilityPct,
    bookmakerMarginPct: market.bookmakerMarginPct, estimatedProbabilityPct: market.estimatedProbabilityPct,
    fairOdds: market.fairOdds, expectedValuePct: market.expectedValuePct, positiveValue: market.positiveValue,
    requiresReview: market.requiresReview, method: market.method,
    updatedAt: market.updatedAt || dataset.preMatch?.odds?.updatedAt || dataset.fetchedAt
  }));
  const oddspedia = dataset.externalSources?.oddspedia;
  const externalMarkets = apiMarkets.length ? [] : (oddspedia?.data?.markets || []).map((market, index) => ({
    marketKey: `oddspedia_${index}`, selectionKey: `external_${index}`,
    market: market.market, selection: market.selection, decimalOdds: market.decimalOdds,
    bookmaker: market.bookmaker || "", impliedProbabilityPct: null, noVigImpliedProbabilityPct: null,
    bookmakerMarginPct: null, estimatedProbabilityPct: null, fairOdds: null, expectedValuePct: null,
    positiveValue: false, requiresReview: true, method: "Referencia externa sin modelo probabilístico",
    sourceUrl: market.sourceUrl || "", updatedAt: oddspedia.updatedAt || dataset.fetchedAt
  }));
  const markets = apiMarkets.length ? apiMarkets : externalMarkets;
  const source = apiMarkets.length ? SOURCE : externalMarkets.length ? "oddspedia" : SOURCE;
  const status = apiMarkets.length >= 4 ? DATA_STATUS.AVAILABLE : markets.length ? DATA_STATUS.PARTIAL : DATA_STATUS.NOT_AVAILABLE;
  const message = externalMarkets.length
    ? "Cuotas complementarias de Oddspedia recuperadas mediante búsqueda web restringida; requieren revisión."
    : markets.length ? "" : "No se encontraron cuotas principales verificables.";
  return {
    ...moduleBase(status, apiMarkets.length ? dataset.preMatch?.odds?.updatedAt || dataset.fetchedAt : oddspedia?.updatedAt || dataset.fetchedAt, source, message),
    markets
  };
}

export function getContextCalendarData(dataset) {
  const homeRestDays = dataset.preMatch?.home?.restDays ?? null;
  const awayRestDays = dataset.preMatch?.away?.restDays ?? null;
  const hasRest = homeRestDays !== null || awayRestDays !== null;
  return {
    ...moduleBase(hasRest ? DATA_STATUS.PARTIAL : DATA_STATUS.NOT_AVAILABLE, dataset.fetchedAt, SOURCE,
      hasRest ? "Días de descanso disponibles; próximos partidos y presión competitiva aún no están normalizados." : "No hay contexto de calendario suficiente."),
    homeRestDays, awayRestDays, homeUpcomingMatches: [], awayUpcomingMatches: [],
    competitionPressure: "", notes: hasRest ? ["Contexto parcial basado en partidos recientes."] : []
  };
}

function cleanSheets(matches = []) {
  return matches.filter((match) => match.goalsAgainst === 0).length;
}

export function getStatsFormData(dataset) {
  const home = dataset.preMatch?.home;
  const away = dataset.preMatch?.away;
  const status = home?.played >= 3 && away?.played >= 3
    ? DATA_STATUS.AVAILABLE
    : home?.played || away?.played ? DATA_STATUS.PARTIAL : DATA_STATUS.NOT_AVAILABLE;
  return {
    ...moduleBase(status, dataset.fetchedAt, SOURCE, status === DATA_STATUS.NOT_AVAILABLE ? "No se encontraron partidos recientes suficientes." : ""),
    homeLastMatches: home?.matches || [], awayLastMatches: away?.matches || [],
    homeGoalsFor: home?.goalsFor ?? null, homeGoalsAgainst: home?.goalsAgainst ?? null,
    awayGoalsFor: away?.goalsFor ?? null, awayGoalsAgainst: away?.goalsAgainst ?? null,
    homeWinRate: home?.winRate ?? null, awayWinRate: away?.winRate ?? null,
    homeCleanSheets: home ? cleanSheets(home.matches) : null,
    awayCleanSheets: away ? cleanSheets(away.matches) : null
  };
}

function absenceKind(item) {
  const text = `${item.player?.type || ""} ${item.player?.reason || ""}`.toLowerCase();
  if (/suspend|red card|yellow card/.test(text)) return "suspensions";
  if (/doubt|questionable|uncertain/.test(text)) return "doubts";
  return "injuries";
}

export function getInjuriesSuspensionsData(dataset) {
  const rows = dataset.confirmed?.injuries || [];
  const fotmob = dataset.externalSources?.fotmob;
  const whoScored = dataset.externalSources?.whoScored;
  const sides = {
    home: { injuries: [], suspensions: [], doubts: [] },
    away: { injuries: [], suspensions: [], doubts: [] }
  };
  rows.forEach((item) => {
    const side = item.team?.id === dataset.fixture.homeTeamId ? "home" : item.team?.id === dataset.fixture.awayTeamId ? "away" : null;
    if (!side) return;
    sides[side][absenceKind(item)].push({
      playerId: item.player?.id || null, name: item.player?.name || "",
      type: item.player?.type || "", reason: item.player?.reason || ""
    });
  });
  const homeAvailable = rows.some((item) => item.team?.id === dataset.fixture.homeTeamId);
  const awayAvailable = rows.some((item) => item.team?.id === dataset.fixture.awayTeamId);
  if (!rows.length && fotmob?.data?.injuriesSuspensions) {
    const externalSides = fotmob.data.injuriesSuspensions;
    const hasExternal = [...Object.values(externalSides.home || {}), ...Object.values(externalSides.away || {})].some((items) => items?.length);
    if (hasExternal) {
      return {
        ...moduleBase(DATA_STATUS.PARTIAL, fotmob.updatedAt || dataset.fetchedAt, "fotmob",
          "Bajas complementarias recuperadas de FotMob mediante búsqueda web; requieren revisión."),
        home: externalSides.home, away: externalSides.away, sourceUrl: fotmob.data.eventUrl || ""
      };
    }
  }
  if (!rows.length && whoScored?.data?.injuriesSuspensions) {
    const externalSides = whoScored.data.injuriesSuspensions;
    const hasExternal = [...Object.values(externalSides.home || {}), ...Object.values(externalSides.away || {})].some((items) => items?.length);
    if (hasExternal) {
      return {
        ...moduleBase(DATA_STATUS.PARTIAL, whoScored.updatedAt || dataset.fetchedAt, "whoScored",
          "Bajas complementarias recuperadas de WhoScored mediante búsqueda web; requieren revisión."),
        home: externalSides.home, away: externalSides.away, sourceUrl: whoScored.data.eventUrl || ""
      };
    }
  }
  const status = statusForSides(homeAvailable, awayAvailable);
  return {
    ...moduleBase(status, dataset.fetchedAt, rows.length ? SOURCE : "", rows.length ? "" : "El endpoint no devolvió registros; no se puede confirmar que no existan bajas."),
    ...sides
  };
}

function lineupForTeam(rows, teamId) {
  return rows.find((row) => row.team?.id === teamId) || null;
}

export function getLineupsData(dataset) {
  const rows = dataset.confirmed?.lineups || [];
  const sofaScore = dataset.externalSources?.sofaScore;
  const fotmob = dataset.externalSources?.fotmob;
  const whoScored = dataset.externalSources?.whoScored;
  const home = lineupForTeam(rows, dataset.fixture.homeTeamId);
  const away = lineupForTeam(rows, dataset.fixture.awayTeamId);
  const homeConfirmed = Boolean(home?.startXI?.length);
  const awayConfirmed = Boolean(away?.startXI?.length);
  const status = statusForSides(homeConfirmed, awayConfirmed);
  const players = (items = []) => items.map((item) => ({
    id: item.player?.id || null, name: item.player?.name || "", number: item.player?.number ?? null,
    position: item.player?.pos || "", grid: item.player?.grid || ""
  }));
  if (!rows.length && sofaScore?.data?.lineups) {
    const external = sofaScore.data.lineups;
    const hasExternal = external.homeStartingXI?.length || external.awayStartingXI?.length || external.probableHomeXI?.length || external.probableAwayXI?.length;
    if (hasExternal) {
      return {
        ...moduleBase(DATA_STATUS.PARTIAL, sofaScore.updatedAt || dataset.fetchedAt, "sofaScore",
          "Alineaciones probables no confirmadas."),
        confirmed: false,
        homeFormation: external.homeFormation || "", awayFormation: external.awayFormation || "",
        homeStartingXI: external.homeStartingXI || [], awayStartingXI: external.awayStartingXI || [],
        homeSubstitutes: [], awaySubstitutes: [],
        probableHomeXI: external.probableHomeXI || [], probableAwayXI: external.probableAwayXI || [],
        sourceUrl: sofaScore.data.eventUrl || ""
      };
    }
  }
  if (!rows.length && fotmob?.data?.lineups) {
    const external = fotmob.data.lineups;
    const hasExternal = external.homeStartingXI?.length || external.awayStartingXI?.length || external.probableHomeXI?.length || external.probableAwayXI?.length;
    if (hasExternal) {
      return {
        ...moduleBase(DATA_STATUS.PARTIAL, fotmob.updatedAt || dataset.fetchedAt, "fotmob",
          "Alineaciones probables no confirmadas."),
        confirmed: false,
        homeFormation: external.homeFormation || "", awayFormation: external.awayFormation || "",
        homeStartingXI: external.homeStartingXI || [], awayStartingXI: external.awayStartingXI || [],
        homeSubstitutes: [], awaySubstitutes: [],
        probableHomeXI: external.probableHomeXI || [], probableAwayXI: external.probableAwayXI || [],
        sourceUrl: fotmob.data.eventUrl || ""
      };
    }
  }
  if (!rows.length && whoScored?.data?.lineups) {
    const external = whoScored.data.lineups;
    const hasExternal = external.probableHomeXI?.length || external.probableAwayXI?.length;
    if (hasExternal) {
      return {
        ...moduleBase(DATA_STATUS.PARTIAL, whoScored.updatedAt || dataset.fetchedAt, "whoScored",
          "Alineaciones probables no confirmadas."),
        confirmed: false,
        homeFormation: external.homeFormation || "", awayFormation: external.awayFormation || "",
        homeStartingXI: [], awayStartingXI: [], homeSubstitutes: [], awaySubstitutes: [],
        probableHomeXI: external.probableHomeXI || [], probableAwayXI: external.probableAwayXI || [],
        sourceUrl: whoScored.data.eventUrl || ""
      };
    }
  }
  return {
    ...moduleBase(status, dataset.fetchedAt, status === DATA_STATUS.NOT_AVAILABLE ? "" : SOURCE,
      status === DATA_STATUS.NOT_AVAILABLE ? "Alineaciones no disponibles todavía." : ""),
    confirmed: homeConfirmed && awayConfirmed,
    homeFormation: home?.formation || "", awayFormation: away?.formation || "",
    homeStartingXI: players(home?.startXI), awayStartingXI: players(away?.startXI),
    homeSubstitutes: players(home?.substitutes), awaySubstitutes: players(away?.substitutes),
    probableHomeXI: [], probableAwayXI: []
  };
}

export function getXgXgaData(dataset) {
  const historical = dataset.historicalEstimatedXg;
  const estimated = dataset.estimatedXg;
  const canUseCurrentFixtureEstimate = dataset.fixture.status === "live" || dataset.fixture.status === "finished";
  const hasCurrentFixtureEstimate = canUseCurrentFixtureEstimate
    && [DATA_STATUS.AVAILABLE, DATA_STATUS.PARTIAL].includes(estimated?.status);
  const hasHistoricalEstimate = !hasCurrentFixtureEstimate
    && [DATA_STATUS.AVAILABLE, DATA_STATUS.PARTIAL].includes(historical?.status);
  const hasInternalEstimate = hasHistoricalEstimate || hasCurrentFixtureEstimate;
  const fotmob = dataset.externalSources?.fotmob;
  const external = fotmob?.data?.xgXga;
  const hasExternal = external && [external.homeXG, external.homeXGA, external.awayXG, external.awayXGA].some(Number.isFinite);
  if (!hasInternalEstimate && hasExternal && ["pre_match_team_aggregate", "season_average"].includes(external.scope)) {
    return {
      ...moduleBase(DATA_STATUS.PARTIAL, fotmob.updatedAt || dataset.fetchedAt, "fotmob",
        "xG/xGA prepartido recuperado de FotMob mediante búsqueda web; requiere revisión."),
      homeXG: external.homeXG, homeXGA: external.homeXGA,
      awayXG: external.awayXG, awayXGA: external.awayXGA,
      homeNPXG: null, awayNPXG: null, scope: external.scope, sourceUrl: fotmob.data.eventUrl || "",
      type: "official", modelVersion: "", confidenceScore: null, confidenceLabel: "",
      warning: "Dato reportado por una fuente estadística especializada y recuperado como referencia verificable."
    };
  }
  const fbref = dataset.externalSources?.fbref;
  const fbrefData = fbref?.data;
  const hasFbref = fbrefData?.scope === "season_per_match"
    && [fbrefData.home?.xg, fbrefData.home?.xga, fbrefData.away?.xg, fbrefData.away?.xga].some(Number.isFinite);
  if (!hasInternalEstimate && hasFbref) {
    return {
      ...moduleBase(DATA_STATUS.PARTIAL, fbref.updatedAt || dataset.fetchedAt, "fbref",
        "xG/xGA de temporada recuperado de FBref mediante búsqueda web; requiere revisión y puede tener cobertura parcial."),
      homeXG: fbrefData.home?.xg ?? null, homeXGA: fbrefData.home?.xga ?? null,
      awayXG: fbrefData.away?.xg ?? null, awayXGA: fbrefData.away?.xga ?? null,
      homeNPXG: fbrefData.home?.npxg ?? null, awayNPXG: fbrefData.away?.npxg ?? null,
      homeMatchesPlayed: fbrefData.home?.matchesPlayed ?? null,
      awayMatchesPlayed: fbrefData.away?.matchesPlayed ?? null,
      scope: fbrefData.scope,
      sourceUrls: [fbrefData.home?.sourceUrl, fbrefData.away?.sourceUrl].filter(Boolean),
      type: "official", modelVersion: "", confidenceScore: null, confidenceLabel: "",
      warning: "Dato reportado por una fuente estadística especializada y recuperado como referencia verificable."
    };
  }
  if (hasHistoricalEstimate) {
    const missingFields = [...new Set([
      ...(historical.homeTeam?.missingFields || []),
      ...(historical.awayTeam?.missingFields || [])
    ])];
    return {
      ...moduleBase(historical.status, historical.updatedAt || dataset.fetchedAt, "api-football-internal-model",
        "Calculado con partidos anteriores de cada equipo; no requiere H2H."),
      type: "historical_estimated",
      dataSource: historical.dataSource || "historical_api_estimate",
      calculationStatus: historical.calculationStatus || "estimated_from_previous_matches",
      scope: "previous_matches",
      homeXG: historical.homeTeam.historicalEstimatedXGAvg,
      homeXGA: historical.homeTeam.historicalEstimatedXGAAvg,
      awayXG: historical.awayTeam.historicalEstimatedXGAvg,
      awayXGA: historical.awayTeam.historicalEstimatedXGAAvg,
      homeNPXG: null,
      awayNPXG: null,
      modelVersion: historical.modelVersion,
      sampleSize: Math.min(historical.homeTeam.sampleSize, historical.awayTeam.sampleSize),
      homeSampleSize: historical.homeTeam.sampleSize,
      awaySampleSize: historical.awayTeam.sampleSize,
      homeTeam: {
        xGHistoricalAverage: historical.homeTeam.historicalEstimatedXGAvg,
        xGAHistoricalAverage: historical.homeTeam.historicalEstimatedXGAAvg
      },
      awayTeam: {
        xGHistoricalAverage: historical.awayTeam.historicalEstimatedXGAvg,
        xGAHistoricalAverage: historical.awayTeam.historicalEstimatedXGAAvg
      },
      sampleSizeHome: historical.homeTeam.sampleSize,
      sampleSizeAway: historical.awayTeam.sampleSize,
      fixturesUsedHome: historical.homeTeam.fixturesUsed,
      fixturesUsedAway: historical.awayTeam.fixturesUsed,
      fixturesUsed: {
        home: historical.homeTeam.fixturesUsed,
        away: historical.awayTeam.fixturesUsed
      },
      diagnostics: {
        home: historical.homeTeam.diagnostics,
        away: historical.awayTeam.diagnostics
      },
      confidenceScore: historical.confidence.score,
      confidenceLabel: historical.confidence.label,
      homeConfidence: historical.homeTeam.confidence,
      awayConfidence: historical.awayTeam.confidence,
      missingFields,
      notes: historical.confidence.notes,
      warning: historical.warning,
      analysisUse: "pre_match_context"
    };
  }
  if (hasCurrentFixtureEstimate) {
    return {
      ...moduleBase(estimated.status, estimated.updatedAt || dataset.fetchedAt, "api-football-internal-model",
        "Calculado con estadísticas del fixture actual."),
      type: "fixture_estimated",
      scope: "current_fixture",
      homeXG: estimated.homeTeam.estimatedXG,
      homeXGA: estimated.homeTeam.estimatedXGA,
      awayXG: estimated.awayTeam.estimatedXG,
      awayXGA: estimated.awayTeam.estimatedXGA,
      homeNPXG: null,
      awayNPXG: null,
      modelVersion: estimated.modelVersion,
      confidenceScore: estimated.confidence.score,
      confidenceLabel: estimated.confidence.label,
      homeConfidence: estimated.homeTeam.confidence,
      awayConfidence: estimated.awayTeam.confidence,
      missingFields: estimated.confidence.missingFields,
      notes: estimated.confidence.notes,
      diagnostics: estimated.diagnostics,
      warning: estimated.warning,
      rawStats: { home: estimated.homeTeam.rawStats, away: estimated.awayTeam.rawStats },
      analysisUse: dataset.fixture.status === "finished" ? "post_match_audit_only" : "live_match_context_only"
    };
  }
  return {
    ...moduleBase(DATA_STATUS.NOT_AVAILABLE, dataset.fetchedAt, "",
      historical?.confidence?.notes?.[0] || "Datos históricos insuficientes para calcular xG/xGA responsablemente."),
    type: "not_available", homeXG: null, homeXGA: null, awayXG: null, awayXGA: null,
    homeNPXG: null, awayNPXG: null, modelVersion: "", confidenceScore: 0,
    confidenceLabel: "not_available", warning: "No se inventaron valores de xG/xGA."
  };
}

export function getWeatherPitchData(dataset) {
  const weather = dataset.externalSources?.weather;
  if (weather?.data) {
    return {
      ...moduleBase(DATA_STATUS.PARTIAL, weather.updatedAt || dataset.fetchedAt, "weather",
        "Clima obtenido de Open-Meteo; la cancha es una estimación meteorológica, no una inspección oficial."),
      temperature: weather.data.temperature,
      rainProbability: weather.data.rainProbability,
      windSpeed: weather.data.windSpeed,
      humidity: weather.data.humidity,
      condition: weather.data.condition || "",
      matchedLocation: weather.data.matchedLocation || "",
      forecastTime: weather.data.forecastTime || "",
      sourceUrl: weather.data.sourceUrl || "",
      pitchNotes: weather.data.pitchNotes || "Sin reporte reciente de estado de cancha."
    };
  }
  return {
    ...moduleBase(DATA_STATUS.NOT_AVAILABLE, dataset.fetchedAt, "",
      weather?.notes?.[0] || "Clima no disponible: falta ubicación del estadio."),
    temperature: null, rainProbability: null, windSpeed: null, humidity: null,
    condition: "", pitchNotes: weather?.notes?.[0] || "Clima no disponible: falta ubicación del estadio."
  };
}

export function getFixtureEventsData(dataset) {
  if (dataset.advancedFailures?.events) {
    return { ...moduleBase(DATA_STATUS.FAILED, dataset.fetchedAt, SOURCE, "API-Football no pudo entregar los eventos del fixture."), analysisUse: "post_match_audit_only", events: [], summary: { goals: 0, cards: 0, substitutions: 0 } };
  }
  const rows = Array.isArray(dataset.confirmed?.events) ? dataset.confirmed.events : [];
  const events = rows.slice(0, 100).map((event) => ({
    elapsed: event.time?.elapsed ?? null, extra: event.time?.extra ?? null,
    teamId: event.team?.id || null, team: event.team?.name || "",
    playerId: event.player?.id || null, player: event.player?.name || "",
    assist: event.assist?.name || "", type: event.type || "", detail: event.detail || "", comments: event.comments || ""
  }));
  const count = (pattern) => events.filter((event) => pattern.test(`${event.type} ${event.detail}`)).length;
  return {
    ...moduleBase(events.length ? DATA_STATUS.AVAILABLE : DATA_STATUS.NOT_AVAILABLE, dataset.fetchedAt, SOURCE,
      events.length ? "Datos posteriores al inicio; se usan solo para auditar el resultado, nunca para predecirlo." : "No hay eventos publicados para este fixture."),
    analysisUse: "post_match_audit_only", events,
    summary: { goals: count(/goal/i), cards: count(/card/i), substitutions: count(/subst/i) }
  };
}

function compactPlayerTeam(entry = {}) {
  return {
    teamId: entry.team?.id || null, team: entry.team?.name || "",
    players: (entry.players || []).slice(0, 40).map((item) => {
      const statistics = item.statistics?.[0] || {};
      const rating = Number.parseFloat(statistics.games?.rating);
      return {
        playerId: item.player?.id || null, name: item.player?.name || "",
        position: statistics.games?.position || "", minutes: statistics.games?.minutes ?? null,
        rating: Number.isFinite(rating) ? Number(rating.toFixed(1)) : null,
        captain: Boolean(statistics.games?.captain), substitute: Boolean(statistics.games?.substitute),
        shots: statistics.shots?.total ?? null, shotsOnTarget: statistics.shots?.on ?? null,
        goals: statistics.goals?.total ?? null, assists: statistics.goals?.assists ?? null,
        passes: statistics.passes?.total ?? null, keyPasses: statistics.passes?.key ?? null,
        tackles: statistics.tackles?.total ?? null, interceptions: statistics.tackles?.interceptions ?? null,
        yellowCards: statistics.cards?.yellow ?? null, redCards: statistics.cards?.red ?? null
      };
    })
  };
}

export function getPlayerPerformanceData(dataset) {
  if (dataset.advancedFailures?.players) {
    return { ...moduleBase(DATA_STATUS.FAILED, dataset.fetchedAt, SOURCE, "API-Football no pudo entregar el rendimiento de jugadores."), analysisUse: "post_match_audit_only", teams: [] };
  }
  const rows = Array.isArray(dataset.confirmed?.players) ? dataset.confirmed.players : [];
  const teams = rows.map(compactPlayerTeam).filter((entry) => entry.players.length);
  const homeAvailable = teams.some((entry) => entry.teamId === dataset.fixture.homeTeamId);
  const awayAvailable = teams.some((entry) => entry.teamId === dataset.fixture.awayTeamId);
  const status = statusForSides(homeAvailable, awayAvailable);
  return {
    ...moduleBase(status, dataset.fetchedAt, SOURCE,
      teams.length ? "Rendimiento posterior al partido; disponible solo para evaluación retrospectiva." : "No hay estadísticas de jugadores publicadas para este fixture."),
    analysisUse: "post_match_audit_only", teams
  };
}

function compactTeamSeasonStatistics(data) {
  if (!data || Array.isArray(data) || !data.team) return null;
  return {
    teamId: data.team.id || null, team: data.team.name || "", form: data.form || "",
    played: data.fixtures?.played?.total ?? null, wins: data.fixtures?.wins?.total ?? null,
    draws: data.fixtures?.draws?.total ?? null, losses: data.fixtures?.loses?.total ?? null,
    goalsFor: data.goals?.for?.total?.total ?? null, goalsAgainst: data.goals?.against?.total?.total ?? null,
    averageGoalsFor: data.goals?.for?.average?.total ?? null, averageGoalsAgainst: data.goals?.against?.average?.total ?? null,
    cleanSheets: data.clean_sheet?.total ?? null, failedToScore: data.failed_to_score?.total ?? null,
    penaltiesScored: data.penalty?.scored?.total ?? null, penaltiesMissed: data.penalty?.missed?.total ?? null,
    commonLineups: (data.lineups || []).slice(0, 3).map((lineup) => ({ formation: lineup.formation || "", played: lineup.played ?? null }))
  };
}

export function getTeamSeasonStatisticsData(dataset) {
  const failedHome = Boolean(dataset.advancedFailures?.homeTeamStatistics);
  const failedAway = Boolean(dataset.advancedFailures?.awayTeamStatistics);
  const home = compactTeamSeasonStatistics(dataset.confirmed?.teamStatistics?.home);
  const away = compactTeamSeasonStatistics(dataset.confirmed?.teamStatistics?.away);
  const homeHasSample = Number(home?.played || 0) > 0;
  const awayHasSample = Number(away?.played || 0) > 0;
  const status = failedHome && failedAway ? DATA_STATUS.FAILED : statusForSides(homeHasSample, awayHasSample);
  return {
    ...moduleBase(status, dataset.fetchedAt, SOURCE,
      status === DATA_STATUS.AVAILABLE ? "Estadísticas de temporada con corte anterior al fixture." : status === DATA_STATUS.FAILED ? "API-Football no pudo entregar estadísticas agregadas de los equipos." : status === DATA_STATUS.PARTIAL ? "Solo uno de los equipos tiene muestra previa al fixture." : "No existen partidos de temporada anteriores al corte para construir esta muestra."),
    analysisUse: "pre_match_context", cutoffDate: dataset.confirmed?.teamStatistics?.cutoffDate || "",
    home, away, failedSides: { home: failedHome, away: failedAway }
  };
}

function failedModule(name, error, updatedAt) {
  console.error(`[match-research] No fue posible normalizar ${name}:`, error?.message || error);
  return { ...moduleBase(DATA_STATUS.FAILED, updatedAt, "", "El módulo no pudo procesarse."), errorCode: "MODULE_NORMALIZATION_FAILED" };
}

function safeModule(name, getter, dataset) {
  try { return getter(dataset); } catch (error) { return failedModule(name, error, dataset.fetchedAt || nowIso()); }
}

function buildSourceRegistry(dataset) {
  return Object.fromEntries(Object.entries(SOURCE_DEFINITIONS).map(([key, definition]) => {
    const adapterResult = key === "apiFootballInternalModel"
      ? dataset.historicalEstimatedXg || dataset.estimatedXg
      : dataset.externalSources?.[key];
    return [key, {
      status: key === "apiFootball" ? "available" : adapterResult?.status || definition.defaultStatus,
      label: definition.label,
      role: definition.role,
      updatedAt: key === "apiFootball" ? dataset.fetchedAt : adapterResult?.updatedAt || "",
      notes: adapterResult?.notes?.length
        ? [...adapterResult.notes]
        : key === "apiFootballInternalModel" && adapterResult?.warning ? [adapterResult.warning] : [...definition.notes]
    }];
  }));
}

function buildSourceCoverage(normalized) {
  return MODULE_SOURCE_PLAN.map((plan) => {
    const moduleData = plan.module === "calendar"
      ? { status: DATA_STATUS.AVAILABLE, source: SOURCE, updatedAt: normalized.lastUpdated, message: "Fixture confirmado por API-Football." }
      : normalized[plan.module] || { status: DATA_STATUS.NOT_AVAILABLE, source: "", updatedAt: "", message: "Módulo no disponible." };
    const activeSources = moduleData.source === SOURCE
      ? [sourceLabel("apiFootball")]
      : moduleData.source === "oddspedia" ? [sourceLabel("oddspedia")]
        : moduleData.source === "fotmob" ? [sourceLabel("fotmob")]
          : moduleData.source === "whoScored" ? [sourceLabel("whoScored")]
            : moduleData.source === "fbref" ? [sourceLabel("fbref")]
              : moduleData.source === "weather" ? [sourceLabel("weather")]
                : moduleData.source === "soccerway" ? [sourceLabel("soccerway")]
                  : moduleData.source === "sofaScore" ? [sourceLabel("sofaScore")] : [];
    if (moduleData.source === "api-football-internal-model") activeSources.push(sourceLabel("apiFootballInternalModel"));
    const unavailablePrimary = plan.primary.filter((key) => normalized.sources[key]?.status !== "available").map(sourceLabel);
    const observation = moduleData.message || (activeSources.length
      ? `Datos activos desde ${activeSources.join(", ")}.`
      : unavailablePrimary.length ? `Fuentes principales sin integrar: ${unavailablePrimary.join(", ")}.` : "Sin fuente activa para este módulo.");
    return {
      module: plan.module,
      label: plan.label,
      primarySources: plan.primary.map(sourceLabel),
      secondarySources: plan.secondary.map(sourceLabel),
      activeSources,
      status: moduleData.status,
      updatedAt: moduleData.updatedAt || "",
      observation
    };
  });
}

export function normalizeMatchResearchData(dataset) {
  const updatedAt = dataset.fetchedAt || nowIso();
  const normalized = {
    matchId: String(dataset.fixture.id),
    apiFootballFixtureId: String(dataset.fixture.id),
    league: { id: dataset.fixture.leagueId, name: dataset.fixture.leagueName, country: dataset.fixture.country, season: dataset.fixture.season },
    dateTime: dataset.fixture.utcDateTime || `${dataset.fixture.date}T${dataset.fixture.time}:00`,
    displayTimeZone: dataset.fixture.timezone || "America/Los_Angeles",
    homeTeam: { id: dataset.fixture.homeTeamId, name: dataset.fixture.home },
    awayTeam: { id: dataset.fixture.awayTeamId, name: dataset.fixture.away },
    favorite: dataset.fixture.favorite ? {
      teamId: dataset.fixture.favorite.teamId,
      team: dataset.fixture.favorite.team,
      percent: dataset.fixture.favorite.percent,
      market: dataset.fixture.favorite.market,
      probabilities: dataset.fixture.favorite.probabilities,
      source: dataset.fixture.favorite.source,
      note: dataset.fixture.favorite.note
    } : null,
    venue: {
      stadium: dataset.fixture.stadium || "", city: dataset.fixture.city || "", country: dataset.fixture.country || "",
      surface: "", pitchCondition: "", pitchConditionStatus: DATA_STATUS.NOT_AVAILABLE, source: "",
      neutral: Boolean(dataset.fixture.neutralVenue),
      terminology: dataset.fixture.neutralVenue ? "equipo_1_equipo_2" : "local_visitante"
    },
    sources: buildSourceRegistry(dataset),
    standings: safeModule("standings", getStandingsData, dataset),
    h2h: safeModule("h2h", getH2HData, dataset),
    odds: safeModule("odds", getOddsData, dataset),
    contextCalendar: safeModule("contextCalendar", getContextCalendarData, dataset),
    statsForm: safeModule("statsForm", getStatsFormData, dataset),
    injuriesSuspensions: safeModule("injuriesSuspensions", getInjuriesSuspensionsData, dataset),
    lineups: safeModule("lineups", getLineupsData, dataset),
    xgXga: safeModule("xgXga", getXgXgaData, dataset),
    weatherPitch: safeModule("weatherPitch", getWeatherPitchData, dataset),
    supportingData: {
      fixtureEvents: safeModule("fixtureEvents", getFixtureEventsData, dataset),
      playerPerformance: safeModule("playerPerformance", getPlayerPerformanceData, dataset),
      teamSeasonStatistics: safeModule("teamSeasonStatistics", getTeamSeasonStatisticsData, dataset)
    },
    missingData: [], moduleScores: {}, totalConfidenceScore: 0,
    analysisStatus: "needs_review", lastUpdated: updatedAt
  };
  const confidence = calculateMatchConfidenceScore(normalized);
  normalized.moduleScores = confidence.moduleScores;
  normalized.totalConfidenceScore = confidence.totalConfidenceScore;
  normalized.analysisStatus = confidence.analysisStatus;
  normalized.criticalMissingData = confidence.criticalMissing;
  normalized.missingData = Object.keys(MODULE_WEIGHTS)
    .filter((key) => normalized[key].status !== DATA_STATUS.AVAILABLE)
    .map((key) => ({ module: key, label: MODULE_LABELS[key], status: normalized[key].status, message: normalized[key].message || "" }));
  normalized.sourceCoverage = buildSourceCoverage(normalized);
  return normalized;
}

export const OPENAI_ANALYSIS_INSTRUCTIONS = `
Actúa como analista profesional de fútbol y apuestas deportivas.
Usa únicamente la información estructurada proporcionada en matchData.
No inventes datos deportivos, lesiones, sanciones, alineaciones, xG, xGA, clima, cancha, resultados, cuotas ni noticias.
Separa datos confirmados, datos parciales o probables, inferencias y datos faltantes.
Si analysisStatus es "needs_review", advierte que el pronóstico no es fuerte.
Si matchData.venue.neutral es true, usa los nombres de los equipos o "equipo 1/equipo 2"; nunca los describas como local o visitante.
No generes picks agresivos cuando falten datos críticos.
Los datos marcados como post_match_audit_only no deben usarse para justificar predicciones prepartido.
No presentes ningún pronóstico como garantizado, fijo, seguro o sin riesgo.
La respuesta debe mantener la advertencia de juego responsable.
`;

export const XG_ANALYSIS_RULES = `
El módulo xG/xGA puede contener datos oficiales, históricos estimados, estimados del fixture actual o no disponibles.
Si type es official, atribuye el dato a la fuente indicada sin aumentar su nivel de confianza.
Solo usa la palabra "oficial" cuando type es official y conserva la atribución a source.
Si type es historical_estimated, llámalo siempre "xG/xGA histórico estimado".
Explica que se calculó con partidos anteriores de cada equipo y que no requiere que los equipos hayan jugado entre sí.
Nunca lo presentes como xG oficial ni como xG del partido actual.
Si type es fixture_estimated, llámalo siempre "xG/xGA estimado del partido".
Indica que fue calculado internamente con estadísticas del fixture disponibles en API-Football. Nunca lo presentes como xG oficial.
Si confidenceLabel es low, úsalo únicamente como referencia secundaria y nunca como base principal del pronóstico.
Si confidenceLabel es medium, reconoce expresamente sus limitaciones.
Si confidenceLabel es high, no lo describas como seguro, exacto ni suficiente por sí solo.
No generes picks fuertes basándote únicamente en el xG/xGA estimado, cualquiera que sea su confianza.
Si analysisUse es live_match_context_only, no describas el dato como información prepartido.
Si analysisUse es post_match_audit_only, no lo uses para justificar una predicción prepartido.
Si status es not_available, indica que no existe información suficiente y no infieras valores desde goles u otros resultados.
Si warning contiene "Modo Mundial", menciona que la muestra es limitada, reduce el peso de H2H y usa el histórico estimado solo como referencia parcial.
No inventes valores, no completes campos faltantes y no redondees de forma engañosa.
`;

export function buildOpenAIPromptFromMatchData(matchData) {
  const safeData = JSON.parse(JSON.stringify(matchData, (key, value) => key === "errorCode" ? undefined : value));
  for (const key of ["fixtureEvents", "playerPerformance"]) {
    const module = safeData.supportingData?.[key];
    if (!module) continue;
    safeData.supportingData[key] = {
      status: module.status, source: module.source, updatedAt: module.updatedAt,
      analysisUse: "post_match_audit_only",
      message: "Detalle excluido del análisis prepartido para evitar fuga de información posterior al inicio."
    };
  }
  return { instructions: `${OPENAI_ANALYSIS_INSTRUCTIONS.trim()}\n${XG_ANALYSIS_RULES.trim()}`, input: JSON.stringify({ matchData: safeData }) };
}
