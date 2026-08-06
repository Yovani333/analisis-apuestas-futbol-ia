import test from "node:test";
import assert from "node:assert/strict";
import { BEST_BETS_CONFIG, validateBestBetsConfig } from "../server/config/best-bets.config.js";
import { calculateOddsMetrics, historicalReliabilityFor, selectBestBets } from "../server/services/best-bets-selector.service.js";

const future = "2030-08-10T20:00:00Z";
const candidate = (overrides = {}) => ({
  id: "1:pick", fixtureId: "1", leagueId: 253, league: "MLS", home: "A", away: "B", kickoffAt: future,
  market: "Total de goles 1.5", marketCode: "over_under_1_5", selection: "Más de 1.5", selectionCode: "over_1_5",
  decimalOdds: 1.8, modelProbability: 68, confidenceScore: 78, dataQualityScore: 85,
  independentFamilies: ["goal-model", "market"], backingModels: ["Poisson", "Forma"],
  bookmaker: "Casa", lastUpdatedAt: "2030-08-10T18:00:00Z", supportingData: ["Respaldo verificable"], ...overrides
});
const history = Array.from({ length: 30 }, (_, index) => ({ leagueId: 253, marketKey: "over_under_1_5", sourceModule: "best_bets_selector", outcome: index < 23 ? "HIT" : "MISS" }));

test("los pesos del selector son explícitos y suman cien", () => {
  assert.equal(validateBestBetsConfig(), true);
  assert.equal(Object.values(BEST_BETS_CONFIG.weights).reduce((sum, value) => sum + value, 0), 100);
});

test("calcula probabilidad implícita, margen, cuota justa, edge y EV", () => {
  const result = calculateOddsMetrics({ odds: 2, modelProbabilityPct: 55, marketOdds: [2, 2.2] });
  assert.equal(result.impliedProbabilityPct, 50);
  assert.ok(result.normalizedImpliedProbabilityPct < 55);
  assert.equal(result.fairOdds, 1.82);
  assert.equal(result.expectedValuePct, 10);
});

test("excluye cuota inválida, probabilidad inválida y partido iniciado", () => {
  const report = selectBestBets({ fixturePackages: [{ fixture: { id: 1 }, dataQualityScore: 90, candidates: [candidate({ decimalOdds: 1, modelProbability: 100, kickoffAt: "2020-01-01T00:00:00Z" })] }], now: new Date("2030-08-10T19:00:00Z") });
  assert.equal(report.picks.length, 0);
  assert.equal(report.candidates[0].classification, "DESCARTADO");
  assert.ok(report.candidates[0].exclusionReasons.length >= 3);
});

test("historial insuficiente deja observar sin inventar confiabilidad", () => {
  const report = selectBestBets({ fixturePackages: [{ fixture: { id: 1 }, dataQualityScore: 85, candidates: [candidate()] }], now: new Date("2030-08-10T19:00:00Z") });
  assert.equal(report.picks.length, 0);
  assert.equal(report.candidates[0].classification, "OBSERVAR");
  assert.equal(report.candidates[0].historicalReliability.status, "insufficient");
});

test("clasifica y ordena un candidato con valor, calidad e historial suficientes", () => {
  const report = selectBestBets({ fixturePackages: [{ fixture: { id: 1 }, dataQualityScore: 85, candidates: [candidate()] }], historyRecords: history, now: new Date("2030-08-10T19:00:00Z") });
  assert.equal(report.picks.length, 1);
  assert.match(report.picks[0].classification, /^APTO/);
  assert.equal(report.bestBet.id, "1:pick");
});

test("elimina duplicados y conserva un solo pick correlacionado por partido", () => {
  const report = selectBestBets({ fixturePackages: [{ fixture: { id: 1 }, dataQualityScore: 90, candidates: [candidate(), candidate({ id: "1:second", selection: "A gana", market: "Resultado", marketCode: "match_winner", selectionCode: "home_win", modelProbability: 62, decimalOdds: 1.95 })] }], historyRecords: history, now: new Date("2030-08-10T19:00:00Z") });
  assert.ok(report.picks.length <= 1);
  assert.equal(new Set(report.candidates.map((row) => `${row.fixtureId}:${row.marketKey}:${row.selectionKey}`)).size, report.candidates.length);
});

test("la reejecución es determinista salvo el timestamp explícito", () => {
  const input = { fixturePackages: [{ fixture: { id: 1 }, dataQualityScore: 85, candidates: [candidate()] }], historyRecords: history, now: new Date("2030-08-10T19:00:00Z") };
  assert.deepEqual(selectBestBets(input), selectBestBets(input));
});

test("no mezcla silenciosamente resultados de versiones distintas", () => {
  const reliability = historicalReliabilityFor(
    { leagueId: 253, marketKey: "btts", modelVersion: "v2" },
    [
      { leagueId: 253, marketKey: "btts", modelVersion: "v1", outcome: "HIT" },
      { leagueId: 253, marketKey: "btts", modelVersion: "v2", outcome: "MISS" }
    ]
  );
  assert.equal(reliability.sampleSize, 1);
  assert.equal(reliability.excludedByVersion, 1);
});
