import { generateDataPicks } from "../data-picks.service.js";
import { calculatePoissonModel } from "../poisson-model.service.js";
import { calculateTeamGoalProbability } from "../team-goal-probability.service.js";
import { calculateCornersModel } from "../corners-model.service.js";
import { evaluatePickOutcome } from "./pick-outcome-evaluator.service.js";
import { auditPickRules } from "./market-rules-audit.service.js";

function historicalXg(dataset) {
  const value = dataset.historicalEstimatedXg;
  if (!value || !["available", "partial"].includes(value.status)) return { status: "not_available", type: "historical_estimated", homeXG: null, homeXGA: null, awayXG: null, awayXGA: null };
  return {
    status: value.status, type: "historical_estimated", source: value.source,
    homeXG: value.homeTeam?.historicalEstimatedXGAvg ?? null,
    homeXGA: value.homeTeam?.historicalEstimatedXGAAvg ?? null,
    awayXG: value.awayTeam?.historicalEstimatedXGAvg ?? null,
    awayXGA: value.awayTeam?.historicalEstimatedXGAAvg ?? null,
    sampleSizeHome: value.homeTeam?.sampleSize || 0, sampleSizeAway: value.awayTeam?.sampleSize || 0
  };
}

export function createPreMatchSnapshot(dataset = {}) {
  const snapshot = structuredClone(dataset);
  snapshot.fixture.status = "scheduled";
  snapshot.fixture.statusLabel = "Prepartido simulado";
  snapshot.fixture.score = { home: null, away: null };
  snapshot.fixture.elapsed = null;
  snapshot.confirmed = { ...snapshot.confirmed, statistics: [], events: [], players: [], lineups: [] };
  snapshot.estimatedXg = null;
  snapshot.researchData = { ...snapshot.researchData, xgXga: historicalXg(snapshot) };
  snapshot.poissonModel = calculatePoissonModel(snapshot);
  snapshot.teamGoalProbability = calculateTeamGoalProbability(snapshot);
  snapshot.cornersModel = calculateCornersModel(snapshot);
  snapshot.audit = { mode: "pre_match_reconstruction", currentFixtureStatisticsUsed: false };
  return snapshot;
}

function metricSummary(records = []) {
  const settled = records.filter((row) => ["HIT", "MISS", "VOID"].includes(row.outcome));
  const bettable = settled.filter((row) => Number(row.odds) > 1);
  const hits = settled.filter((row) => row.outcome === "HIT").length;
  const misses = settled.filter((row) => row.outcome === "MISS").length;
  const voids = settled.filter((row) => row.outcome === "VOID").length;
  const mean = (key) => {
    const values = records.map((row) => Number(row[key])).filter(Number.isFinite);
    return values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : null;
  };
  const profitLoss = bettable.reduce((sum, row) => row.outcome === "HIT" ? sum + Number(row.odds) - 1 : row.outcome === "MISS" ? sum - 1 : sum, 0);
  const calibration = settled.map((row) => Math.abs((Number(row.modelProbability) || 0) - (row.outcome === "HIT" ? 100 : 0)));
  return {
    totalPicks: records.length, eligiblePicks: bettable.length, hits, misses, voids,
    noBets: records.filter((row) => row.outcome === "NO_BET").length,
    hitRate: hits + misses ? Number((hits / (hits + misses) * 100).toFixed(2)) : null,
    avgConfidence: mean("confidence"), avgOdds: mean("odds"), impliedProbability: mean("impliedProbability"),
    modelProbability: mean("modelProbability"), expectedValue: mean("expectedValue"),
    profitLossFlatStake: Number(profitLoss.toFixed(2)), ROI: bettable.length ? Number((profitLoss / bettable.length * 100).toFixed(2)) : null,
    calibrationError: calibration.length ? Number((calibration.reduce((a, b) => a + b, 0) / calibration.length).toFixed(2)) : null,
    falseConfidenceRate: Number((records.filter((row) => row.outcome === "MISS" && row.confidence >= 70).length / Math.max(1, misses) * 100).toFixed(2))
  };
}

function groupedMetrics(records, key) {
  return Object.fromEntries([...new Set(records.map((row) => row[key] || "No disponible"))].map((value) => [value, metricSummary(records.filter((row) => (row[key] || "No disponible") === value))]));
}

export function calculateAuditMetrics(records = []) {
  return {
    ...metricSummary(records),
    byMarket: groupedMetrics(records, "market"),
    byConfidence: groupedMetrics(records.map((row) => ({ ...row, confidenceBand: row.confidence >= 70 ? "Alta" : row.confidence >= 50 ? "Media" : "Baja" })), "confidenceBand"),
    byColor: groupedMetrics(records, "color")
  };
}

function buildBacktestResult(dataset, fixtureResult, generated, metadata = {}) {
  const records = generated.picks.map((pick) => {
    const rules = auditPickRules(pick, generated.quality || dataset.dataQuality || {});
    const candidate = { ...pick, noBet: rules.noBet || pick.highlightColor === "red" };
    const outcome = evaluatePickOutcome(candidate, fixtureResult);
    return {
      fixtureId: String(dataset.fixture?.id || ""), date: dataset.fixture?.date || "", match: `${dataset.fixture?.home || "Local"} vs ${dataset.fixture?.away || "Visitante"}`,
      league: dataset.fixture?.leagueName || "", market: pick.market, pick: pick.selection, selectionKey: pick.selectionKey,
      odds: pick.decimalOdds, impliedProbability: pick.impliedProbabilityPct, modelProbability: pick.modelProbabilityPct,
      expectedValue: pick.expectedValuePct, confidence: pick.confidenceScore, dataQuality: generated.quality?.label || dataset.dataQuality?.level || "No disponible",
      finalScore: fixtureResult?.finished ? `${fixtureResult.goals?.home}-${fixtureResult.goals?.away}` : "Pendiente",
      outcome, decision: candidate.noBet ? "EVITAR" : rules.color === "green" ? "VALOR" : "RIESGO", errorDetected: rules.errors.join(" "), recommendation: rules.recommendation, color: rules.color,
      source: generated.source, sourceModule: pick.sourceModule, teamIds: { home: dataset.fixture?.homeTeamId ?? null, away: dataset.fixture?.awayTeamId ?? null },
      missingFields: generated.warnings || [], warnings: [...(generated.warnings || []), ...(pick.contradictingData || [])],
      supportingData: pick.supportingData, contradictingData: pick.contradictingData,
      explanation: pick.explanation
    };
  });
  return { status: fixtureResult?.finished ? "completed" : "pending", fixtureId: String(dataset.fixture?.id || ""), mode: metadata.mode || "pre_match_reconstruction", capturedAt: metadata.capturedAt || null, currentFixtureStatisticsUsed: false, records, metrics: calculateAuditMetrics(records), generatedAt: new Date().toISOString() };
}

export function runFixtureBacktest(dataset, fixtureResult) {
  const snapshot = createPreMatchSnapshot(dataset);
  return buildBacktestResult(snapshot, fixtureResult, generateDataPicks(snapshot));
}

export function runSavedEvidenceBacktest(evidence, fixtureResult) {
  if (!evidence?.fixture?.id || evidence.fixture.status !== "scheduled") throw new TypeError("La evidencia prepartido no es válida.");
  if (evidence.currentFixtureStatisticsUsed !== false || evidence.openAiUsed !== false) throw new TypeError("La evidencia contiene fuentes no permitidas para backtesting.");
  const generated = evidence.modules?.dataPicks;
  if (!generated || !Array.isArray(generated.picks)) throw new TypeError("La evidencia no contiene picks basados en datos.");
  const dataset = { fixture: evidence.fixture, dataQuality: evidence.dataQuality, researchData: evidence.researchData || {}, preMatch: evidence.preMatch || {}, marketAnalysis: evidence.marketAnalysis || [] };
  return buildBacktestResult(dataset, fixtureResult, generated, { mode: "saved_pre_match_evidence", capturedAt: evidence.capturedAt });
}
