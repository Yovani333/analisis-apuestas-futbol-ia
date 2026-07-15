import { calculateEstimatedXG, MODEL_VERSION } from "./estimated-xg-calculator.js";
import { calculateEstimatedXgConfidence } from "./estimated-xg-confidence.js";
import { extractEstimatedXgInputs } from "./xg-data-extractor.js";

const WARNING = "xG/xGA estimado calculado internamente con estadísticas del partido desde API-Football. No corresponde a xG oficial.";

function hasMinimumInputs(team) {
  return team.statisticsFound
    && (team.rawStats.totalShots !== null || team.rawStats.shotsOnGoal !== null);
}

function statusFromConfidence(score) {
  if (score >= 80) return "available";
  if (score > 0) return "partial";
  return "not_available";
}

function hasRecordedValue(value) {
  return value !== null && value !== undefined;
}

function emptyResult(fixtureId, homeTeam, awayTeam, updatedAt, note = "No hay estadísticas suficientes para ambos equipos.") {
  return {
    status: "not_available", type: "fixture_estimated", source: "api-football-internal-model",
    modelVersion: MODEL_VERSION, scope: "current_fixture", fixtureId,
    homeTeam: { ...homeTeam, estimatedXG: null, estimatedXGA: null },
    awayTeam: { ...awayTeam, estimatedXG: null, estimatedXGA: null },
    confidence: { score: 0, label: "not_available", missingFields: [], optionalMissingFields: [], notes: [note] },
    diagnostics: {
      statisticsAvailable: {
        home: hasRecordedValue(homeTeam?.rawStats?.totalShots) || hasRecordedValue(homeTeam?.rawStats?.shotsOnGoal),
        away: hasRecordedValue(awayTeam?.rawStats?.totalShots) || hasRecordedValue(awayTeam?.rawStats?.shotsOnGoal)
      },
      eventsAvailable: false,
      detectedPenalties: { home: 0, away: 0 }
    },
    warning: WARNING, updatedAt
  };
}

export function buildEstimatedXgFromDataset(dataset) {
  const extracted = extractEstimatedXgInputs(dataset);
  const updatedAt = dataset?.fetchedAt || new Date().toISOString();
  const baseTeam = (team) => ({ id: team.id, name: team.name, rawStats: team.rawStats });
  if (dataset?.fixture?.status === "scheduled") {
    return emptyResult(
      extracted.fixtureId, baseTeam(extracted.homeTeam), baseTeam(extracted.awayTeam), updatedAt,
      "No se calcula xG estimado con estadísticas del mismo fixture antes de que comience el partido."
    );
  }
  if (!hasMinimumInputs(extracted.homeTeam) || !hasMinimumInputs(extracted.awayTeam)) {
    return emptyResult(extracted.fixtureId, baseTeam(extracted.homeTeam), baseTeam(extracted.awayTeam), updatedAt);
  }

  const homeConfidence = calculateEstimatedXgConfidence(extracted.homeTeam.rawStats, { eventsAvailable: extracted.homeTeam.eventsAvailable });
  const awayConfidence = calculateEstimatedXgConfidence(extracted.awayTeam.rawStats, { eventsAvailable: extracted.awayTeam.eventsAvailable });
  const homeEstimatedXG = calculateEstimatedXG(extracted.homeTeam.rawStats);
  const awayEstimatedXG = calculateEstimatedXG(extracted.awayTeam.rawStats);
  const score = Math.min(homeConfidence.score, awayConfidence.score);
  const label = score >= 80 && homeConfidence.label === "high" && awayConfidence.label === "high"
    ? "high" : score >= 50 ? "medium" : "low";
  const missingFields = [...new Set([...homeConfidence.missingFields, ...awayConfidence.missingFields])];
  const optionalMissingFields = [...new Set([
    ...homeConfidence.optionalMissingFields,
    ...awayConfidence.optionalMissingFields
  ])];
  const notes = [...new Set([...homeConfidence.notes, ...awayConfidence.notes])];
  const penaltyCount = extracted.homeTeam.rawStats.penalties + extracted.awayTeam.rawStats.penalties;
  if (penaltyCount === 0) notes.push("No se detectaron eventos de penal o la fuente no los proporcionó.");
  if (homeEstimatedXG > 6 || awayEstimatedXG > 6) notes.push("Resultado superior a 6.00; revisar posibles datos inflados o inconsistentes.");

  return {
    status: statusFromConfidence(score), type: "fixture_estimated", source: "api-football-internal-model",
    modelVersion: MODEL_VERSION, scope: "current_fixture", fixtureId: extracted.fixtureId,
    homeTeam: {
      ...baseTeam(extracted.homeTeam), estimatedXG: homeEstimatedXG, estimatedXGA: awayEstimatedXG,
      confidence: homeConfidence
    },
    awayTeam: {
      ...baseTeam(extracted.awayTeam), estimatedXG: awayEstimatedXG, estimatedXGA: homeEstimatedXG,
      confidence: awayConfidence
    },
    confidence: { score, label, missingFields, optionalMissingFields, notes },
    diagnostics: {
      statisticsAvailable: { home: true, away: true },
      eventsAvailable: extracted.homeTeam.eventsAvailable && extracted.awayTeam.eventsAvailable,
      detectedPenalties: {
        home: extracted.homeTeam.rawStats.penalties,
        away: extracted.awayTeam.rawStats.penalties
      }
    },
    warning: WARNING, updatedAt
  };
}

export async function getEstimatedXgForFixture(fixtureId, { loadFixtureDataset } = {}) {
  if (typeof loadFixtureDataset !== "function") {
    throw new TypeError("getEstimatedXgForFixture requiere un cargador seguro del dataset del fixture.");
  }
  try {
    const dataset = await loadFixtureDataset(String(fixtureId));
    return buildEstimatedXgFromDataset(dataset);
  } catch {
    return {
      status: "failed", type: "fixture_estimated", source: "api-football-internal-model",
      modelVersion: MODEL_VERSION, scope: "current_fixture", fixtureId: String(fixtureId), homeTeam: null, awayTeam: null,
      confidence: { score: 0, label: "not_available", missingFields: [], optionalMissingFields: [], notes: ["No fue posible procesar las estadísticas del fixture."] },
      diagnostics: {
        statisticsAvailable: { home: false, away: false },
        eventsAvailable: false,
        detectedPenalties: { home: 0, away: 0 }
      },
      warning: WARNING, updatedAt: new Date().toISOString()
    };
  }
}

export const getCurrentFixtureEstimatedXgXga = getEstimatedXgForFixture;
export { WARNING as ESTIMATED_XG_WARNING };
