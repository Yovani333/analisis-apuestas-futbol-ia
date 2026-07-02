import test from "node:test";
import assert from "node:assert/strict";
import { calculateAuditMetrics, createPreMatchSnapshot, runFixtureBacktest } from "../server/services/audit/backtest-engine.service.js";
import { evaluatePickOutcome } from "../server/services/audit/pick-outcome-evaluator.service.js";
import { auditPickRules } from "../server/services/audit/market-rules-audit.service.js";
import { auditTodayResults } from "../server/services/audit/audit-today-results.service.js";

const finished = (home, away) => ({ finished: true, appStatus: "finished", goals: { home, away } });
const pick = (selectionKey, extra = {}) => ({ selectionKey, highlightColor: "green", ...extra });

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
