import { calculateEstimatedXG } from "./estimated-xg-calculator.js";
import { calculateEstimatedXgConfidence } from "./estimated-xg-confidence.js";
import {
  extractPenaltyCountFromEvents,
  extractTeamStatsFromApiFootball
} from "./xg-data-extractor.js";

export const HISTORICAL_MODEL_VERSION = "historical-estimated-xg-v1";
export const HISTORICAL_XG_WARNING = "xG / xGA estimado con base en partidos anteriores. No corresponde a xG oficial ni al xG del partido actual.";
export const WORLD_CUP_XG_WARNING = "Modo Mundial: muestra estadística limitada. El xG/xGA histórico estimado usa partidos anteriores de cada selección y debe interpretarse con cautela.";

const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);
const REQUIRED_FIELDS = ["totalShots", "shotsOnGoal", "shotsInsideBox", "shotsOutsideBox", "cornerKicks"];

function hasMinimumInputs(stats) {
  return stats.totalShots !== null && stats.shotsOnGoal !== null;
}

function fixtureDate(row) {
  const value = Date.parse(row?.fixture?.date || "");
  return Number.isFinite(value) ? value : 0;
}

function previousFinishedFixtures(rows, fixtureDateValue, limit) {
  const cutoff = Date.parse(fixtureDateValue || "");
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => FINISHED_STATUSES.has(row?.fixture?.status?.short))
    .filter((row) => !Number.isFinite(cutoff) || fixtureDate(row) < cutoff)
    .sort((a, b) => fixtureDate(b) - fixtureDate(a))
    .slice(0, limit);
}

function emptyTeam(team) {
  return {
    id: String(team?.id || ""),
    name: team?.name || "",
    historicalEstimatedXGAvg: null,
    historicalEstimatedXGAAvg: null,
    sampleSize: 0,
    fixturesUsed: [],
    missingFields: [],
    diagnostics: {
      attemptedFixtures: 0,
      usedFixtures: 0,
      skippedFixtures: []
    }
  };
}

function average(values) {
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function historicalConfidence(records, attemptedCount, { worldCup = false } = {}) {
  if (!records.length) {
    return {
      score: 0,
      label: "not_available",
      notes: ["No hay partidos anteriores con estadísticas suficientes."]
    };
  }
  const availableFields = records.reduce((total, record) =>
    total + REQUIRED_FIELDS.filter((key) => record.rawStats[key] !== null).length, 0);
  const availableFieldsRatio = availableFields / (records.length * REQUIRED_FIELDS.length);
  let score = Math.round(availableFieldsRatio * 100);
  if (records.length >= 6) score += 10;
  if (records.length < 3) score -= 25;
  score = Math.max(1, Math.min(100, score));

  let label = score >= 80 ? "high" : score >= 50 ? "medium" : "low";
  if (records.length < 3) {
    score = Math.min(score, 49);
    label = "low";
  } else if (records.length < 6) {
    score = Math.min(score, 79);
    label = score >= 50 ? "medium" : "low";
  }
  if (worldCup && records.length <= 2) {
    score = Math.min(score, 39);
    label = "low";
  }

  const notes = [];
  if (records.length < 3) notes.push("Con menos de 3 partidos útiles, la confiabilidad histórica es baja.");
  else if (records.length <= 5) notes.push("Con 3 a 5 partidos útiles, la confiabilidad histórica es media.");
  else notes.push("Con 6 o más partidos útiles, la muestra histórica es aceptable.");
  if (attemptedCount > records.length) notes.push(`${attemptedCount - records.length} partido(s) se omitieron por datos insuficientes.`);
  if (records.some((record) => !record.eventsAvailable) || !records.some((record) => record.rawStats.penalties > 0)) {
    notes.push("No se detectaron eventos de penal o la fuente no los proporcionó.");
  }
  if (worldCup) notes.push(WORLD_CUP_XG_WARNING);
  return { score, label, notes };
}

function statusFromScore(score) {
  if (score >= 80) return "available";
  if (score > 0) return "partial";
  return "not_available";
}

async function buildTeamHistory({
  team,
  fixtureRows,
  fixtureDate: currentFixtureDate,
  limit,
  getFixtureStatistics,
  getFixtureEvents,
  worldCup
}) {
  const fixtures = previousFinishedFixtures(fixtureRows, currentFixtureDate, limit);
  const outcomes = await Promise.all(fixtures.map(async (fixture) => {
    const fixtureId = String(fixture?.fixture?.id || "");
    const homeId = fixture?.teams?.home?.id;
    const awayId = fixture?.teams?.away?.id;
    const opponentId = String(homeId) === String(team.id) ? awayId : homeId;
    if (!fixtureId || opponentId === null || opponentId === undefined) {
      return { record: null, skipped: { fixtureId, reason: "invalid_fixture" } };
    }

    const [statisticsResult, eventsResult] = await Promise.all([
      getFixtureStatistics(fixtureId).then((data) => ({ data, failed: false })).catch(() => ({ data: [], failed: true })),
      getFixtureEvents(fixtureId).then((data) => ({ data, failed: false })).catch(() => ({ data: [], failed: true }))
    ]);
    const teamStats = extractTeamStatsFromApiFootball(statisticsResult.data, team.id);
    const opponentStats = extractTeamStatsFromApiFootball(statisticsResult.data, opponentId);
    if (statisticsResult.failed) {
      return { record: null, skipped: { fixtureId, reason: "statistics_request_failed" } };
    }
    if (!hasMinimumInputs(teamStats) || !hasMinimumInputs(opponentStats)) {
      return { record: null, skipped: { fixtureId, reason: "insufficient_statistics" } };
    }

    teamStats.penalties = extractPenaltyCountFromEvents(eventsResult.data, team.id);
    opponentStats.penalties = extractPenaltyCountFromEvents(eventsResult.data, opponentId);
    const estimatedXG = calculateEstimatedXG(teamStats);
    const estimatedXGA = calculateEstimatedXG(opponentStats);
    const confidence = calculateEstimatedXgConfidence(teamStats, { eventsAvailable: !eventsResult.failed });
    return { record: {
      fixtureId,
      date: fixture?.fixture?.date?.slice(0, 10) || "",
      opponentId: String(opponentId),
      opponent: String(homeId) === String(team.id) ? fixture?.teams?.away?.name || "" : fixture?.teams?.home?.name || "",
      venue: String(homeId) === String(team.id) ? "home" : "away",
      competition: fixture?.league?.name || "",
      competitionType: fixture?.league?.type || "",
      estimatedXG,
      estimatedXGA,
      rawStats: teamStats,
      cornerStats: {
        cornersFor: teamStats.cornerKicks,
        cornersAgainst: opponentStats.cornerKicks,
        possession: teamStats.ballPossession,
        totalShots: teamStats.totalShots,
        shotsOnGoal: teamStats.shotsOnGoal,
        blockedShots: teamStats.blockedShots
      },
      missingFields: confidence.missingFields,
      eventsAvailable: !eventsResult.failed
    }, skipped: null };
  }));
  const records = outcomes.map((outcome) => outcome.record).filter(Boolean);
  const skippedFixtures = outcomes.map((outcome) => outcome.skipped).filter(Boolean);

  const confidence = historicalConfidence(records, fixtures.length, { worldCup });
  const missingFields = [...new Set(records.flatMap((record) => record.missingFields))];
  const notes = [...confidence.notes];
  if (records.some((record) => record.estimatedXG > 6 || record.estimatedXGA > 6)) {
    notes.push("Un resultado histórico fue superior a 6.00; revisar posibles datos inflados o inconsistentes.");
  }
  return {
    ...emptyTeam(team),
    historicalEstimatedXGAvg: average(records.map((record) => record.estimatedXG)),
    historicalEstimatedXGAAvg: average(records.map((record) => record.estimatedXGA)),
    sampleSize: records.length,
    fixturesUsed: records.map(({ rawStats, eventsAvailable, ...record }) => record),
    missingFields,
    diagnostics: {
      attemptedFixtures: fixtures.length,
      usedFixtures: records.length,
      skippedFixtures
    },
    confidence: { ...confidence, notes }
  };
}

export async function getHistoricalEstimatedXgXga({
  fixtureId,
  fixtureDate,
  homeTeam,
  awayTeam,
  homePreviousFixtures = [],
  awayPreviousFixtures = [],
  getFixtureStatistics,
  getFixtureEvents,
  limit = 5,
  worldCup = false,
  updatedAt = new Date().toISOString()
}) {
  if (typeof getFixtureStatistics !== "function" || typeof getFixtureEvents !== "function") {
    throw new TypeError("El cálculo histórico requiere cargadores de estadísticas y eventos.");
  }
  try {
    const [home, away] = await Promise.all([
      buildTeamHistory({
        team: homeTeam, fixtureRows: homePreviousFixtures, fixtureDate, limit,
        getFixtureStatistics, getFixtureEvents, worldCup
      }),
      buildTeamHistory({
        team: awayTeam, fixtureRows: awayPreviousFixtures, fixtureDate, limit,
        getFixtureStatistics, getFixtureEvents, worldCup
      })
    ]);
    const score = Math.min(home.confidence.score, away.confidence.score);
    const notes = [...new Set([...home.confidence.notes, ...away.confidence.notes])];
    return {
      status: statusFromScore(score),
      type: "historical_estimated",
      source: "api-football-internal-model",
      dataSource: "historical_api_estimate",
      calculationStatus: "estimated_from_previous_matches",
      modelVersion: HISTORICAL_MODEL_VERSION,
      scope: "previous_matches",
      fixtureId: String(fixtureId || ""),
      homeTeam: home,
      awayTeam: away,
      homeXGHistoricalAverage: home.historicalEstimatedXGAvg,
      homeXGAHistoricalAverage: home.historicalEstimatedXGAAvg,
      awayXGHistoricalAverage: away.historicalEstimatedXGAvg,
      awayXGAHistoricalAverage: away.historicalEstimatedXGAAvg,
      sampleSizeHome: home.sampleSize,
      sampleSizeAway: away.sampleSize,
      fixturesUsedHome: home.fixturesUsed,
      fixturesUsedAway: away.fixturesUsed,
      confidence: {
        score,
        label: score >= 80 ? "high" : score >= 50 ? "medium" : score > 0 ? "low" : "not_available",
        notes
      },
      warning: [HISTORICAL_XG_WARNING, worldCup ? WORLD_CUP_XG_WARNING : ""].filter(Boolean).join(" "),
      updatedAt
    };
  } catch {
    return {
      status: "failed",
      type: "historical_estimated",
      source: "api-football-internal-model",
      dataSource: "historical_api_estimate",
      calculationStatus: "failed",
      modelVersion: HISTORICAL_MODEL_VERSION,
      scope: "previous_matches",
      fixtureId: String(fixtureId || ""),
      homeTeam: emptyTeam(homeTeam),
      awayTeam: emptyTeam(awayTeam),
      confidence: { score: 0, label: "not_available", notes: ["No fue posible procesar la muestra histórica."] },
      warning: HISTORICAL_XG_WARNING,
      updatedAt
    };
  }
}
