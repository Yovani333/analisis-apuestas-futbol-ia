import test from "node:test";
import assert from "node:assert/strict";
import { calculatePoissonModel, poissonProbability } from "../server/services/poisson-model.service.js";

function dataset(overrides = {}) {
  return {
    fixture: { id: 7, home: "Local", away: "Visitante", neutralVenue: true, leagueSlug: "liga-mx", ...overrides.fixture },
    dataQuality: { score: 82 }, marketAnalysis: [],
    researchData: {
      totalConfidenceScore: 82,
      xgXga: { homeXG: 1.7, homeXGA: 1.0, awayXG: 1.2, awayXGA: 1.5, sampleSize: 6, ...overrides.xgXga },
      statsForm: overrides.statsForm || {}, odds: { markets: overrides.odds || [] }
    }
  };
}

test("calcula distribución Poisson y probabilidades coherentes", () => {
  assert.ok(Math.abs(poissonProbability(1.5, 0) - Math.exp(-1.5)) < 1e-10);
  const result = calculatePoissonModel(dataset());
  assert.equal(result.status, "available");
  assert.equal(result.quality.label, "Alta");
  assert.ok(result.lambdaHome > result.lambdaAway);
  assert.ok(Math.abs(result.probabilities.homeWin + result.probabilities.draw + result.probabilities.awayWin - 100) < .2);
  assert.equal(result.likelyScores.length, 5);
});

test("deriva mercados sin OpenAI y conserva sourceModule", () => {
  const result = calculatePoissonModel(dataset());
  assert.ok(result.suggestedMarkets.length);
  assert.equal(result.suggestedMarkets.every((pick) => pick.sourceModule === "poisson"), true);
});

test("usa forma como respaldo y reduce calidad cuando falta xG", () => {
  const input = dataset({ xgXga: { homeXG: null, homeXGA: null, awayXG: null, awayXGA: null }, statsForm: { homeGoalsFor: 8, homeGoalsAgainst: 5, awayGoalsFor: 6, awayGoalsAgainst: 7, homePlayed: 5, awayPlayed: 5 } });
  const result = calculatePoissonModel(input);
  assert.equal(result.status, "partial");
  assert.equal(result.quality.label, "Parcial");
  assert.match(result.warning, /forma goleadora/i);
});

test("no inventa lambdas cuando faltan xG y forma", () => {
  const result = calculatePoissonModel(dataset({ xgXga: { homeXG: null, homeXGA: null, awayXG: null, awayXGA: null } }));
  assert.equal(result.status, "not_available");
  assert.deepEqual(result.suggestedMarkets, []);
});

test("Mundial con muestra corta queda advertido y sin confianza fuerte", () => {
  const result = calculatePoissonModel(dataset({ fixture: { leagueSlug: "world-cup" }, xgXga: { sampleSize: 2 } }));
  assert.equal(result.status, "partial");
  assert.match(result.warning, /Mundial|torneo corto/i);
});
