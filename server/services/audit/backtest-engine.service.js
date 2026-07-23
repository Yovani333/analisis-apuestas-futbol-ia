import { generateDataPicks } from "../data-picks.service.js";
import { calculatePoissonModel } from "../poisson-model.service.js";
import { calculateTeamGoalProbability } from "../team-goal-probability.service.js";
import { calculateCornersModel } from "../corners-model.service.js";
import { evaluateDiscardedPickCounterfactual, evaluatePickOutcome } from "./pick-outcome-evaluator.service.js";

export function resolvePendingAuditError(result = {}) {
  if (result.finished) return null;
  return {
    postponed: { message: "El partido fue postergado; la evidencia seguirá pendiente hasta que API-Football publique un resultado final.", code: "FIXTURE_POSTPONED" },
    canceled: { message: "El partido fue cancelado y no puede evaluarse con un marcador final.", code: "FIXTURE_CANCELED" },
    suspended: { message: "El partido está suspendido; la evidencia seguirá pendiente hasta que exista resultado final.", code: "FIXTURE_SUSPENDED" },
    live: { message: "El partido sigue en vivo; la evidencia se evaluará cuando finalice.", code: "FIXTURE_LIVE" }
  }[result.appStatus] || { message: "El partido todavía no ha finalizado.", code: "FIXTURE_NOT_FINISHED" };
}

function validProbability(value) {
  if (value === null || value === undefined || value === "") return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100;
}

function wilsonInterval(hits, total, z = 1.96) {
  if (!total) return { lowPct: null, highPct: null };
  const proportion = hits / total;
  const denominator = 1 + (z ** 2) / total;
  const center = (proportion + (z ** 2) / (2 * total)) / denominator;
  const margin = z * Math.sqrt((proportion * (1 - proportion) + (z ** 2) / (4 * total)) / total) / denominator;
  return {
    lowPct: Number((Math.max(0, center - margin) * 100).toFixed(2)),
    highPct: Number((Math.min(1, center + margin) * 100).toFixed(2))
  };
}

function calibrationReadiness(sampleSize) {
  if (sampleSize >= 100) return { status: "adequate", label: "Muestra adecuada", canRecalibrate: true, minimumRequired: 100 };
  if (sampleSize >= 30) return { status: "preliminary", label: "Muestra preliminar", canRecalibrate: false, minimumRequired: 100 };
  return { status: "insufficient", label: "Muestra insuficiente", canRecalibrate: false, minimumRequired: 30 };
}

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
  const calibrationRows = records.filter((row) => ["HIT", "MISS"].includes(row.outcome) && validProbability(row.modelProbability));
  const bettable = settled.filter((row) => Number(row.odds) > 1);
  const hits = settled.filter((row) => row.outcome === "HIT").length;
  const misses = settled.filter((row) => row.outcome === "MISS").length;
  const voids = settled.filter((row) => row.outcome === "VOID").length;
  const mean = (key) => {
    const values = records.map((row) => Number(row[key])).filter(Number.isFinite);
    return values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : null;
  };
  const profitLoss = bettable.reduce((sum, row) => row.outcome === "HIT" ? sum + Number(row.odds) - 1 : row.outcome === "MISS" ? sum - 1 : sum, 0);
  const calibration = calibrationRows.map((row) => {
    const probability = Number(row.modelProbability) / 100;
    const observed = row.outcome === "HIT" ? 1 : 0;
    return {
      absoluteErrorPct: Math.abs(probability - observed) * 100,
      squaredError: (probability - observed) ** 2,
      logLoss: -(observed * Math.log(Math.max(0.001, probability)) + (1 - observed) * Math.log(Math.max(0.001, 1 - probability)))
    };
  });
  const decisiveTotal = hits + misses;
  const hitRateInterval95 = wilsonInterval(hits, decisiveTotal);
  const highConfidenceSettled = records.filter((row) => ["HIT", "MISS"].includes(row.outcome) && Number(row.confidence) >= 70);
  const discarded = records.filter((row) => row.outcome === "NO_BET");
  const counterfactual = discarded.map((row) => row.counterfactualOutcome).filter((outcome) => ["HIT", "MISS", "VOID"].includes(outcome));
  const counterfactualHits = counterfactual.filter((outcome) => outcome === "HIT").length;
  const counterfactualMisses = counterfactual.filter((outcome) => outcome === "MISS").length;
  const counterfactualVoids = counterfactual.filter((outcome) => outcome === "VOID").length;
  const counterfactualDecisive = counterfactualHits + counterfactualMisses;
  const bands = calibrationBands(records);
  const calibrationTotal = bands.reduce((sum, band) => sum + band.count, 0);
  return {
    totalPicks: records.length, eligiblePicks: bettable.length, hits, misses, voids,
    decisivePicks: decisiveTotal,
    noBets: records.filter((row) => row.outcome === "NO_BET").length,
    dataInsufficient: records.filter((row) => row.outcome === "DATA_INSUFFICIENT").length,
    livePending: records.filter((row) => row.outcome === "LIVE_PENDING").length,
    hitRate: hits + misses ? Number((hits / (hits + misses) * 100).toFixed(2)) : null,
    hitRateInterval95,
    avgConfidence: mean("confidence"), avgOdds: mean("odds"), impliedProbability: mean("impliedProbability"),
    modelProbability: mean("modelProbability"), expectedValue: mean("expectedValue"),
    profitLossFlatStake: Number(profitLoss.toFixed(2)), ROI: bettable.length ? Number((profitLoss / bettable.length * 100).toFixed(2)) : null,
    calibrationSampleSize: calibration.length,
    calibrationReadiness: calibrationReadiness(calibration.length),
    calibrationError: calibration.length ? Number((calibration.reduce((sum, row) => sum + row.absoluteErrorPct, 0) / calibration.length).toFixed(2)) : null,
    brierScore: calibration.length ? Number((calibration.reduce((sum, row) => sum + row.squaredError, 0) / calibration.length).toFixed(4)) : null,
    logLoss: calibration.length ? Number((calibration.reduce((sum, row) => sum + row.logLoss, 0) / calibration.length).toFixed(4)) : null,
    falseConfidenceRate: Number((records.filter((row) => row.outcome === "MISS" && row.confidence >= 70).length / Math.max(1, misses) * 100).toFixed(2)),
    highConfidenceErrorRate: highConfidenceSettled.length ? Number((highConfidenceSettled.filter((row) => row.outcome === "MISS").length / highConfidenceSettled.length * 100).toFixed(2)) : null,
    calibrationBands: bands,
    expectedCalibrationError: calibrationTotal
      ? Number((bands.reduce((sum, band) => sum + (band.count / calibrationTotal) * band.gapPct, 0)).toFixed(2))
      : null,
    discardAudit: {
      total: discarded.length,
      assessable: counterfactual.length,
      hits: counterfactualHits,
      misses: counterfactualMisses,
      voids: counterfactualVoids,
      unavailable: discarded.length - counterfactual.length,
      hypotheticalHitRate: counterfactualDecisive
        ? Number((counterfactualHits / counterfactualDecisive * 100).toFixed(2))
        : null
    }
  };
}

function calibrationBands(records = []) {
  const valid = records.filter((row) => ["HIT", "MISS"].includes(row.outcome) && validProbability(row.modelProbability));
  return [[0, 40, "0-39%"], [40, 50, "40-49%"], [50, 60, "50-59%"], [60, 70, "60-69%"], [70, 80, "70-79%"], [80, 100, "80-100%"]].map(([minimum, upperExclusive, label]) => {
    const rows = valid.filter((row) => Number(row.modelProbability) >= minimum && (upperExclusive === 100 ? Number(row.modelProbability) <= upperExclusive : Number(row.modelProbability) < upperExclusive));
    const predicted = rows.length ? rows.reduce((sum, row) => sum + Number(row.modelProbability), 0) / rows.length : null;
    const observed = rows.length ? rows.filter((row) => row.outcome === "HIT").length / rows.length * 100 : null;
    return {
      band: label, count: rows.length,
      predictedPct: predicted === null ? null : Number(predicted.toFixed(2)),
      observedPct: observed === null ? null : Number(observed.toFixed(2)),
      gapPct: predicted === null ? null : Number(Math.abs(predicted - observed).toFixed(2))
    };
  });
}

function normalizedDecision(pick = {}) {
  const decision = String(pick.decision || "").trim();
  if (decision) return decision;
  if (pick.decisionGroup === "discarded" || pick.noBet === true) return "NO BET";
  if (pick.decisionGroup === "recommended") return "RECOMENDADO";
  return "NO DISPONIBLE";
}

function wasDiscardedBeforeKickoff(pick = {}) {
  const decision = normalizedDecision(pick).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replaceAll("_", " ");
  return pick.noBet === true || pick.decisionGroup === "discarded" || ["EVITAR", "NO BET"].includes(decision);
}

function validateEvidenceTiming(evidence = {}) {
  const capturedAt = Date.parse(evidence.capturedAt || "");
  const kickoffAt = Date.parse(evidence.fixture?.utcDateTime || "");
  if (!Number.isFinite(capturedAt) || !Number.isFinite(kickoffAt)) throw new TypeError("La evidencia no tiene timestamps suficientes para verificar que sea prepartido.");
  if (capturedAt >= kickoffAt) throw new TypeError("La evidencia fue capturada durante o despues del inicio y no es auditable como prepartido.");
}

function finalScoreLabel(result = {}) {
  const score = result.regulationGoals || result.score90 || result.fulltimeGoals || result.goals;
  return result.finished && Number.isFinite(Number(score?.home)) && Number.isFinite(Number(score?.away)) ? `${score.home}-${score.away}` : "Pendiente";
}

function groupedMetrics(records, key) {
  return Object.fromEntries([...new Set(records.map((row) => row[key] || "No disponible"))].map((value) => [value, metricSummary(records.filter((row) => (row[key] || "No disponible") === value))]));
}

export function calculateAuditMetrics(records = []) {
  return {
    ...metricSummary(records),
    byMarket: groupedMetrics(records, "market"),
    byOrigin: groupedMetrics(records, "sourceModule"),
    byConfidence: groupedMetrics(records.map((row) => ({ ...row, confidenceBand: row.confidence >= 70 ? "Alta" : row.confidence >= 50 ? "Media" : "Baja" })), "confidenceBand"),
    byColor: groupedMetrics(records, "color"),
    byModelVersion: groupedMetrics(records, "modelVersion")
  };
}

function buildBacktestResult(dataset, fixtureResult, generated, metadata = {}) {
  const records = generated.picks.map((pick) => {
    const decision = normalizedDecision(pick);
    const candidate = { ...pick, noBet: wasDiscardedBeforeKickoff(pick) };
    const outcome = evaluatePickOutcome(candidate, fixtureResult);
    const counterfactualOutcome = candidate.noBet
      ? evaluateDiscardedPickCounterfactual(candidate, fixtureResult)
      : null;
    return {
      fixtureId: String(dataset.fixture?.id || ""), date: dataset.fixture?.date || "", match: `${dataset.fixture?.home || "Local"} vs ${dataset.fixture?.away || "Visitante"}`,
      league: dataset.fixture?.leagueName || "", market: pick.market, pick: pick.selection, selectionKey: pick.selectionKey,
      odds: pick.decimalOdds, impliedProbability: pick.impliedProbabilityPct, modelProbability: pick.modelProbabilityPct,
      expectedValue: pick.expectedValuePct, conservativeExpectedValue: pick.conservativeExpectedValuePct ?? null,
      confidence: pick.confidenceScore, statisticalConfidence: pick.statisticalConfidenceScore ?? null,
      footballConfidence: pick.footballConfidenceScore ?? null, riskScore: pick.riskScore ?? null,
      dataQuality: generated.quality?.label || dataset.dataQuality?.level || "No disponible",
      finalScore: finalScoreLabel(fixtureResult),
      outcome, counterfactualOutcome, decision, errorDetected: "", recommendation: pick.recommendation || pick.explanation || "Decision historica conservada sin reinterpretacion.", color: pick.highlightColor || pick.color || "No disponible",
      source: generated.source, sourceModule: pick.sourceModule,
      modelVersion: generated.modelVersion || pick.modelVersion || "No disponible",
      adjustmentsVersion: generated.adjustmentsVersion || pick.adjustmentsVersion || null,
      teamIds: { home: dataset.fixture?.homeTeamId ?? null, away: dataset.fixture?.awayTeamId ?? null },
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
  validateEvidenceTiming(evidence);
  const generated = evidence.modules?.dataPicks;
  if (!generated || !Array.isArray(generated.picks)) throw new TypeError("La evidencia no contiene picks basados en datos.");
  const dataset = { fixture: evidence.fixture, dataQuality: evidence.dataQuality, researchData: evidence.researchData || {}, preMatch: evidence.preMatch || {}, marketAnalysis: evidence.marketAnalysis || [] };
  return buildBacktestResult(dataset, fixtureResult, generated, { mode: "saved_pre_match_evidence", capturedAt: evidence.capturedAt });
}
