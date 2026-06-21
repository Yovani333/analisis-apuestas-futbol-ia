import { DATA_STATUS, MODULE_LABELS, MODULE_WEIGHTS } from "../constants/match-research.js";
import { calculateMatchConfidenceScore } from "./match-confidence.service.js";

const SOURCE = "api-football";
const nowIso = () => new Date().toISOString();
const statusForSides = (homeAvailable, awayAvailable) => {
  if (homeAvailable && awayAvailable) return DATA_STATUS.AVAILABLE;
  if (homeAvailable || awayAvailable) return DATA_STATUS.PARTIAL;
  return DATA_STATUS.NOT_AVAILABLE;
};

function moduleBase(status, updatedAt, source = SOURCE, message = "") {
  return { status, source, updatedAt, message };
}

function flattenStandings(rows = []) {
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
  return {
    ...moduleBase(status, dataset.fetchedAt, SOURCE, status === DATA_STATUS.NOT_AVAILABLE ? "API-Football no devolvió clasificación para los equipos." : ""),
    home: compact(home), away: compact(away)
  };
}

export function getH2HData(dataset) {
  const rows = dataset.confirmed?.h2h || [];
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
  const markets = (dataset.marketAnalysis || []).map((market) => ({
    marketKey: market.marketKey, selectionKey: market.selectionKey, market: market.market,
    selection: market.selection, decimalOdds: market.decimalOdds, bookmaker: dataset.preMatch?.odds?.bookmaker || "",
    impliedProbabilityPct: market.impliedProbabilityPct, noVigImpliedProbabilityPct: market.noVigImpliedProbabilityPct,
    bookmakerMarginPct: market.bookmakerMarginPct, updatedAt: dataset.preMatch?.odds?.updatedAt || dataset.fetchedAt
  }));
  const status = markets.length >= 4 ? DATA_STATUS.AVAILABLE : markets.length ? DATA_STATUS.PARTIAL : DATA_STATUS.NOT_AVAILABLE;
  return {
    ...moduleBase(status, dataset.preMatch?.odds?.updatedAt || dataset.fetchedAt, SOURCE, markets.length ? "" : "No se encontraron cuotas principales verificables."),
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
  const home = lineupForTeam(rows, dataset.fixture.homeTeamId);
  const away = lineupForTeam(rows, dataset.fixture.awayTeamId);
  const homeConfirmed = Boolean(home?.startXI?.length);
  const awayConfirmed = Boolean(away?.startXI?.length);
  const status = statusForSides(homeConfirmed, awayConfirmed);
  const players = (items = []) => items.map((item) => ({
    id: item.player?.id || null, name: item.player?.name || "", number: item.player?.number ?? null,
    position: item.player?.pos || "", grid: item.player?.grid || ""
  }));
  return {
    ...moduleBase(status, dataset.fetchedAt, status === DATA_STATUS.NOT_AVAILABLE ? "" : SOURCE,
      status === DATA_STATUS.NOT_AVAILABLE ? "API-Football todavía no publicó alineaciones." : ""),
    confirmed: homeConfirmed && awayConfirmed,
    homeFormation: home?.formation || "", awayFormation: away?.formation || "",
    homeStartingXI: players(home?.startXI), awayStartingXI: players(away?.startXI),
    homeSubstitutes: players(home?.substitutes), awaySubstitutes: players(away?.substitutes),
    probableHomeXI: [], probableAwayXI: []
  };
}

export function getXgXgaData(dataset) {
  return {
    ...moduleBase(DATA_STATUS.NOT_AVAILABLE, dataset.fetchedAt, "",
      "API-Football no entregó xG/xGA acumulado prepartido normalizado; no se usan estadísticas del partido como sustituto."),
    homeXG: null, homeXGA: null, awayXG: null, awayXGA: null, homeNPXG: null, awayNPXG: null
  };
}

export function getWeatherPitchData(dataset) {
  return {
    ...moduleBase(DATA_STATUS.NOT_AVAILABLE, dataset.fetchedAt, "",
      "No hay una fuente meteorológica o de cancha configurada."),
    temperature: null, rainProbability: null, windSpeed: null, humidity: null,
    condition: "", pitchNotes: "Sin reporte reciente de estado de cancha."
  };
}

function failedModule(name, error, updatedAt) {
  console.error(`[match-research] No fue posible normalizar ${name}:`, error?.message || error);
  return { ...moduleBase(DATA_STATUS.FAILED, updatedAt, "", "El módulo no pudo procesarse."), errorCode: "MODULE_NORMALIZATION_FAILED" };
}

function safeModule(name, getter, dataset) {
  try { return getter(dataset); } catch (error) { return failedModule(name, error, dataset.fetchedAt || nowIso()); }
}

export function normalizeMatchResearchData(dataset) {
  const updatedAt = dataset.fetchedAt || nowIso();
  const normalized = {
    matchId: String(dataset.fixture.id),
    apiFootballFixtureId: String(dataset.fixture.id),
    league: { id: dataset.fixture.leagueId, name: dataset.fixture.leagueName, country: dataset.fixture.country, season: dataset.fixture.season },
    dateTime: `${dataset.fixture.date}T${dataset.fixture.time}:00Z`,
    homeTeam: { id: dataset.fixture.homeTeamId, name: dataset.fixture.home },
    awayTeam: { id: dataset.fixture.awayTeamId, name: dataset.fixture.away },
    venue: {
      stadium: dataset.fixture.stadium || "", city: dataset.fixture.city || "", country: dataset.fixture.country || "",
      surface: "", pitchCondition: "", pitchConditionStatus: DATA_STATUS.NOT_AVAILABLE, source: ""
    },
    standings: safeModule("standings", getStandingsData, dataset),
    h2h: safeModule("h2h", getH2HData, dataset),
    odds: safeModule("odds", getOddsData, dataset),
    contextCalendar: safeModule("contextCalendar", getContextCalendarData, dataset),
    statsForm: safeModule("statsForm", getStatsFormData, dataset),
    injuriesSuspensions: safeModule("injuriesSuspensions", getInjuriesSuspensionsData, dataset),
    lineups: safeModule("lineups", getLineupsData, dataset),
    xgXga: safeModule("xgXga", getXgXgaData, dataset),
    weatherPitch: safeModule("weatherPitch", getWeatherPitchData, dataset),
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
  return normalized;
}

export const OPENAI_ANALYSIS_INSTRUCTIONS = `
Actúa como analista profesional de fútbol y apuestas deportivas.
Usa únicamente la información estructurada proporcionada en matchData.
No inventes datos deportivos, lesiones, sanciones, alineaciones, xG, xGA, clima, cancha, resultados, cuotas ni noticias.
Separa datos confirmados, datos parciales o probables, inferencias y datos faltantes.
Si analysisStatus es "needs_review", advierte que el pronóstico no es fuerte.
No generes picks agresivos cuando falten datos críticos.
No presentes ningún pronóstico como garantizado, fijo, seguro o sin riesgo.
La respuesta debe mantener la advertencia de juego responsable.
`;

export function buildOpenAIPromptFromMatchData(matchData) {
  const safeData = JSON.parse(JSON.stringify(matchData, (key, value) => key === "errorCode" ? undefined : value));
  return { instructions: OPENAI_ANALYSIS_INSTRUCTIONS.trim(), input: JSON.stringify({ matchData: safeData }) };
}
