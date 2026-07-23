import test from "node:test";
import assert from "node:assert/strict";
import { calculateAuditMetrics, createPreMatchSnapshot, resolvePendingAuditError, runFixtureBacktest, runSavedEvidenceBacktest } from "../server/services/audit/backtest-engine.service.js";
import { evaluateDiscardedPickCounterfactual, evaluatePickOutcome } from "../server/services/audit/pick-outcome-evaluator.service.js";
import { auditPickRules } from "../server/services/audit/market-rules-audit.service.js";
import { auditTodayResults } from "../server/services/audit/audit-today-results.service.js";

const finished = (home, away) => ({ finished: true, appStatus: "finished", goals: { home, away } });
const pick = (selectionKey, extra = {}) => ({ selectionKey, highlightColor: "green", ...extra });

test("explica por qué una evidencia todavía no puede evaluarse", () => {
  assert.equal(resolvePendingAuditError({ appStatus: "postponed" }).code, "FIXTURE_POSTPONED");
  assert.equal(resolvePendingAuditError({ appStatus: "canceled" }).code, "FIXTURE_CANCELED");
  assert.equal(resolvePendingAuditError({ appStatus: "suspended" }).code, "FIXTURE_SUSPENDED");
  assert.equal(resolvePendingAuditError({ appStatus: "live" }).code, "FIXTURE_LIVE");
  assert.equal(resolvePendingAuditError({ finished: true }), null);
});

test("Under 2.5 acierta y falla con marcador final", () => {
  assert.equal(evaluatePickOutcome(pick("under_2_5"), finished(1, 0)), "HIT");
  assert.equal(evaluatePickOutcome(pick("under_2_5"), finished(2, 1)), "MISS");
});

test("Over 1.5 acierta", () => assert.equal(evaluatePickOutcome(pick("over_1_5"), finished(1, 1)), "HIT"));

test("doble oportunidad de cuota baja y EV negativo queda NO BET", () => {
  const candidate = { ...pick("1X"), impliedProbabilityPct: 85.5, modelProbabilityPct: 61.5, expectedValuePct: -28 };
  const audit = auditPickRules(candidate, { label: "Alta" });
  assert.equal(audit.noBet, true);
  assert.equal(audit.color, "red");
  assert.match(audit.errors.join(" "), /85\.5%.*61\.5%/);
  assert.equal(evaluatePickOutcome({ ...candidate, noBet: audit.noBet }, finished(2, 0)), "NO_BET");
});

test("datos insuficientes generan DATA INSUFFICIENT", () => assert.equal(evaluatePickOutcome(pick("over_2_5"), { finished: true, goals: {} }), "DATA_INSUFFICIENT"));

test("contradicciones quedan naranjas o rojas", () => {
  const audit = auditPickRules({ expectedValuePct: 4, contradictingData: ["xG contrario"] }, { label: "Media" });
  assert.ok(["orange", "red"].includes(audit.color));
});

test("corners con muestra corta se omite", () => {
  const audit = auditPickRules({ sourceModule: "corners", sampleSize: 2, expectedValuePct: 5 }, { label: "Media" });
  assert.equal(audit.noBet, true);
});

test("partido en vivo queda LIVE PENDING", () => assert.equal(evaluatePickOutcome(pick("home_win"), { finished: false, appStatus: "live" }), "LIVE_PENDING"));

test("snapshot prepartido elimina estadísticas del fixture actual", () => {
  const dataset = {
    fixture: { id: 1, status: "finished", home: "A", away: "B", score: { home: 3, away: 2 } },
    confirmed: { statistics: [{ leaked: true }], events: [{ leaked: true }], players: [{ leaked: true }] },
    historicalEstimatedXg: null,
    researchData: { totalConfidenceScore: 20, statsForm: {}, odds: { markets: [] } }, dataQuality: { score: 20 }
  };
  const snapshot = createPreMatchSnapshot(dataset);
  assert.equal(snapshot.fixture.status, "scheduled");
  assert.deepEqual(snapshot.confirmed.statistics, []);
  assert.equal(snapshot.audit.currentFixtureStatisticsUsed, false);
});

test("métricas calculan ROI y falsa confianza", () => {
  const metrics = calculateAuditMetrics([
    { outcome: "HIT", odds: 2, confidence: 75, modelProbability: 60 },
    { outcome: "MISS", odds: 2, confidence: 80, modelProbability: 70 }
  ]);
  assert.equal(metrics.hitRate, 50);
  assert.equal(metrics.profitLossFlatStake, 0);
  assert.equal(metrics.falseConfidenceRate, 100);
  assert.equal(metrics.byConfidence.Alta.misses, 1);
  assert.equal(metrics.calibrationSampleSize, 2);
  assert.equal(metrics.brierScore, 0.325);
  assert.ok(metrics.logLoss > 0);
  assert.deepEqual(metrics.hitRateInterval95, { lowPct: 9.45, highPct: 90.55 });
  assert.equal(metrics.highConfidenceErrorRate, 50);
  assert.equal(metrics.calibrationReadiness.canRecalibrate, false);
});

test("calibración excluye VOID, NO BET y probabilidades ausentes", () => {
  const metrics = calculateAuditMetrics([
    { outcome: "HIT", modelProbability: 70, modelVersion: "v3" },
    { outcome: "VOID", modelProbability: 80, modelVersion: "v3" },
    { outcome: "MISS", modelProbability: null, modelVersion: "v2" },
    { outcome: "NO_BET", modelProbability: 60, modelVersion: "v2" }
  ]);
  assert.equal(metrics.calibrationSampleSize, 1);
  assert.equal(metrics.calibrationError, 30);
  assert.equal(metrics.brierScore, 0.09);
  assert.equal(metrics.calibrationBands.find((band) => band.band === "70-79%").count, 1);
  assert.equal(metrics.byModelVersion.v3.totalPicks, 2);
  assert.equal(metrics.expectedCalibrationError, 30);
});

test("solo habilita estudio de recalibración con cien resultados válidos", () => {
  const records = Array.from({ length: 100 }, (_, index) => ({ outcome: index < 65 ? "HIT" : "MISS", modelProbability: 65 }));
  const metrics = calculateAuditMetrics(records);
  assert.equal(metrics.calibrationReadiness.status, "adequate");
  assert.equal(metrics.calibrationReadiness.canRecalibrate, true);
  assert.equal(metrics.expectedCalibrationError, 0);
});

test("EV conservador no positivo bloquea un supuesto value", () => {
  const audit = auditPickRules({ expectedValuePct: 18, conservativeExpectedValuePct: -2, riskScore: 40 }, { label: "Alta" });
  assert.equal(audit.noBet, true);
  assert.match(audit.errors.join(" "), /EV conservador/);
});

test("auditoría diaria solo cierra finalizados y conserva live pending", async () => {
  const baseDataset = {
    fixture: { id: 1, status: "finished", home: "A", away: "B", leagueName: "Prueba", date: "2026-07-01" },
    confirmed: {}, historicalEstimatedXg: null, researchData: { totalConfidenceScore: 0, statsForm: {}, odds: { markets: [] } }, dataQuality: { score: 0 }, marketAnalysis: []
  };
  const result = await auditTodayResults({
    date: "2026-07-01", leagues: ["world-cup"],
    searchFixtures: async () => [{ id: 1, status: "finished" }, { id: 2, status: "live" }, { id: 3, status: "scheduled" }],
    getFixtureResult: async () => finished(1, 0), getFixtureDataset: async () => baseDataset
  });
  assert.equal(result.audited, 1);
  assert.deepEqual(result.pending, [{ fixtureId: "2", status: "LIVE_PENDING" }]);
});

test("backtest no usa el fixture actual y devuelve registros auditables", () => {
  const dataset = {
    fixture: { id: 2, status: "finished", home: "A", away: "B", leagueName: "Prueba", date: "2026-01-01" },
    confirmed: { statistics: [{ leaked: true }], events: [], players: [] },
    historicalEstimatedXg: { status: "available", source: "api-football-internal-model", homeTeam: { historicalEstimatedXGAvg: 1.4, historicalEstimatedXGAAvg: 1, sampleSize: 5 }, awayTeam: { historicalEstimatedXGAvg: 1, historicalEstimatedXGAAvg: 1.4, sampleSize: 5 } },
    researchData: { totalConfidenceScore: 75, statsForm: {}, odds: { markets: [] } }, dataQuality: { score: 75, level: "Alta" }, marketAnalysis: []
  };
  const result = runFixtureBacktest(dataset, finished(1, 1));
  assert.equal(result.currentFixtureStatisticsUsed, false);
  assert.ok(result.records.length > 0);
});

test("audita los picks exactos de una evidencia prepartido guardada", () => {
  const evidence = {
    capturedAt: "2026-07-02T18:00:00.000Z", currentFixtureStatisticsUsed: false, openAiUsed: false,
    fixture: { id: 4, status: "scheduled", home: "A", away: "B", leagueName: "Prueba", utcDateTime: "2026-07-02T20:00:00.000Z" }, dataQuality: { level: "Alta" }, researchData: {},
    modules: { dataPicks: { source: "API-Football + modelo interno", modelVersion: "picks-data-engine-v3", adjustmentsVersion: "predictive-adjustments-v1", quality: { label: "Alta" }, warnings: [], picks: [{ market: "Total", selection: "Más de 2.5", selectionKey: "over_2_5", decimalOdds: 2, impliedProbabilityPct: 50, modelProbabilityPct: 60, expectedValuePct: 20, conservativeExpectedValuePct: 8, confidenceScore: 70, statisticalConfidenceScore: 68, footballConfidenceScore: 72, riskScore: 25, highlightColor: "green", sourceModule: "data_picks", contradictingData: [] }] } }
  };
  const result = runSavedEvidenceBacktest(evidence, finished(2, 1));
  assert.equal(result.mode, "saved_pre_match_evidence");
  assert.equal(result.records[0].outcome, "HIT");
  assert.equal(result.capturedAt, evidence.capturedAt);
  assert.equal(result.records[0].modelVersion, "picks-data-engine-v3");
  assert.equal(result.records[0].conservativeExpectedValue, 8);
});

test("liquida doble oportunidad 12 y lineas totales", () => {
  assert.equal(evaluatePickOutcome(pick("12"), finished(1, 1)), "MISS");
  assert.equal(evaluatePickOutcome(pick("12"), finished(2, 1)), "HIT");
  assert.equal(evaluatePickOutcome(pick("under_3_5"), finished(2, 1)), "HIT");
  assert.equal(evaluatePickOutcome(pick("over_3"), finished(2, 1)), "VOID");
  assert.equal(evaluatePickOutcome(pick("over_2_25"), finished(3, 0)), "HIT");
  assert.equal(evaluatePickOutcome(pick("over_2_25"), finished(1, 1)), "DATA_INSUFFICIENT");
});

test("liquida corners solo cuando existe resultado oficial", () => {
  const result = { ...finished(1, 0), corners: { home: 6, away: 4 } };
  assert.equal(evaluatePickOutcome(pick("over_8_5_corners", { selection: "Mas de 8.5 corners" }), result), "HIT");
  assert.equal(evaluatePickOutcome(pick("home_most_corners"), result), "HIT");
  assert.equal(evaluatePickOutcome(pick("over_8_5_corners", { selection: "Mas de 8.5 corners" }), finished(1, 0)), "DATA_INSUFFICIENT");
});

test("prefiere marcador reglamentario sobre el total tras prorroga", () => {
  const result = { finished: true, regulationGoals: { home: 1, away: 1 }, goals: { home: 2, away: 1 } };
  assert.equal(evaluatePickOutcome(pick("draw"), result), "HIT");
  assert.equal(evaluatePickOutcome(pick("home_win"), result), "MISS");
});

test("ECE incluye probabilidades decimales sin huecos entre bins", () => {
  const records = [39.5, 49.5, 59.5, 69.5, 79.5].map((modelProbability, index) => ({ outcome: index % 2 ? "MISS" : "HIT", modelProbability }));
  const metrics = calculateAuditMetrics(records);
  assert.equal(metrics.calibrationSampleSize, 5);
  assert.equal(metrics.calibrationBands.reduce((sum, band) => sum + band.count, 0), 5);
  assert.ok(Number.isFinite(metrics.expectedCalibrationError));
});

test("conserva NO BET historico aunque el resultado cumpla el mercado", () => {
  const evidence = {
    capturedAt: "2026-07-02T18:00:00.000Z", currentFixtureStatisticsUsed: false, openAiUsed: false,
    fixture: { id: 5, status: "scheduled", home: "A", away: "B", leagueName: "Prueba", utcDateTime: "2026-07-02T20:00:00.000Z" },
    dataQuality: { level: "Alta" }, researchData: {},
    modules: { dataPicks: { quality: { label: "Alta" }, warnings: [], picks: [{ market: "Total", selection: "Mas de 2.5", selectionKey: "over_2_5", decision: "NO BET", decisionGroup: "discarded", expectedValuePct: 20, modelProbabilityPct: 70, highlightColor: "green" }] } }
  };
  const result = runSavedEvidenceBacktest(evidence, finished(2, 1));
  assert.equal(result.records[0].decision, "NO BET");
  assert.equal(result.records[0].outcome, "NO_BET");
  assert.equal(result.records[0].counterfactualOutcome, "HIT");
  assert.equal(result.metrics.hits, 0);
  assert.equal(result.metrics.misses, 0);
  assert.equal(result.metrics.decisivePicks, 0);
  assert.deepEqual(result.metrics.discardAudit, { total: 1, assessable: 1, hits: 1, misses: 0, voids: 0, unavailable: 0, hypotheticalHitRate: 100 });
});

test("audita descartes por separado sin contaminar hit rate ni ROI", () => {
  const records = [
    { outcome: "NO_BET", counterfactualOutcome: "HIT", odds: 2, modelProbability: 70, sourceModule: "data_picks" },
    { outcome: "NO_BET", counterfactualOutcome: "MISS", odds: 2, modelProbability: 60, sourceModule: "data_picks" }
  ];
  const metrics = calculateAuditMetrics(records);
  assert.equal(metrics.hitRate, null);
  assert.equal(metrics.ROI, null);
  assert.equal(metrics.calibrationSampleSize, 0);
  assert.equal(metrics.discardAudit.hypotheticalHitRate, 50);
  assert.equal(metrics.byOrigin.data_picks.discardAudit.assessable, 2);
  assert.equal(metrics.byOrigin.data_picks.expectedCalibrationError, null);
});

test("la evaluacion contrafactual no modifica el pick descartado", () => {
  const discarded = { selectionKey: "over_1_5", noBet: true };
  const before = structuredClone(discarded);
  assert.equal(evaluateDiscardedPickCounterfactual(discarded, finished(1, 1)), "HIT");
  assert.deepEqual(discarded, before);
  assert.equal(evaluatePickOutcome(discarded, finished(1, 1)), "NO_BET");
});

test("rechaza evidencia capturada durante o despues del partido", () => {
  const evidence = {
    capturedAt: "2026-07-02T20:00:00.000Z", currentFixtureStatisticsUsed: false, openAiUsed: false,
    fixture: { id: 6, status: "scheduled", home: "A", away: "B", utcDateTime: "2026-07-02T20:00:00.000Z" },
    modules: { dataPicks: { picks: [] } }
  };
  assert.throws(() => runSavedEvidenceBacktest(evidence, finished(1, 0)), /durante o despues/);
  assert.throws(() => runSavedEvidenceBacktest({ ...evidence, capturedAt: "2026-07-02T18:00:00.000Z", fixture: { ...evidence.fixture, utcDateTime: null } }, finished(1, 0)), /timestamps suficientes/);
});

test("reevaluar es idempotente y no modifica el snapshot congelado", () => {
  const evidence = {
    capturedAt: "2026-07-02T18:00:00.000Z", currentFixtureStatisticsUsed: false, openAiUsed: false,
    fixture: { id: 7, status: "scheduled", home: "A", away: "B", utcDateTime: "2026-07-02T20:00:00.000Z" },
    dataQuality: {}, researchData: {},
    modules: { dataPicks: { picks: [{ market: "1X2", selection: "A gana", selectionKey: "home_win", decision: "PRECAUCION", decisionGroup: "recommended", modelProbabilityPct: 55 }] } }
  };
  const frozenBefore = structuredClone(evidence);
  const first = runSavedEvidenceBacktest(evidence, finished(1, 0));
  const second = runSavedEvidenceBacktest(evidence, finished(1, 0));
  assert.deepEqual(evidence, frozenBefore);
  assert.deepEqual(first.records, second.records);
  assert.deepEqual(first.metrics, second.metrics);
});
