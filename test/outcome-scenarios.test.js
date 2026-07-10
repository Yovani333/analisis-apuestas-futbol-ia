import test from "node:test";
import assert from "node:assert/strict";
import { buildOutcomeScenarios } from "../server/services/outcome-scenarios.service.js";

function dataset(overrides = {}) {
  return {
    fixture: {
      id: 77,
      home: "Portugal",
      away: "Uzbekistan",
      favorite: { probabilities: overrides.probabilities || { home: 45, draw: 28, away: 27 } }
    },
    dataQuality: { score: overrides.quality ?? 78 },
    marketAnalysis: overrides.odds || [],
    researchData: {
      totalConfidenceScore: overrides.quality ?? 78,
      favorite: { probabilities: overrides.probabilities || { home: 45, draw: 28, away: 27 } },
      odds: { markets: overrides.odds || [] },
      xgXga: overrides.xgXga || { homeXG: 1.6, awayXG: 0.9, homeXGA: 0.8, awayXGA: 1.3, sampleSize: 5 },
      statsForm: {}
    },
    poissonModel: overrides.poissonModel || {
      status: "available",
      probabilities: { homeWin: 51, draw: 26, awayWin: 23 }
    }
  };
}

test("devuelve siempre local, empate y visitante con suma cercana a 100", () => {
  const result = buildOutcomeScenarios(dataset());
  assert.equal(result.scenarios.length, 3);
  assert.deepEqual(result.scenarios.map((row) => row.key), ["home", "draw", "away"]);
  const total = result.scenarios.reduce((sum, row) => sum + row.probabilityPct, 0);
  assert.ok(Math.abs(total - 100) <= 1);
  assert.equal(result.resultMostLikely, "Portugal gana");
});

test("partido muy parejo no fuerza apuesta aunque muestre las tres probabilidades", () => {
  const result = buildOutcomeScenarios(dataset({
    probabilities: { home: 34, draw: 33, away: 33 },
    poissonModel: { status: "available", probabilities: { homeWin: 34, draw: 32, awayWin: 34 } },
    xgXga: { homeXG: 1.1, awayXG: 1.1, homeXGA: 1.1, awayXGA: 1.1, sampleSize: 5 }
  }));
  assert.equal(result.scenarios.length, 3);
  assert.equal(result.decision, "no_bet");
});

test("EV positivo no decide solo si hay pocas fuentes o baja calidad", () => {
  const result = buildOutcomeScenarios(dataset({
    quality: 42,
    probabilities: { home: 50, draw: 25, away: 25 },
    poissonModel: { status: "not_available", probabilities: {} },
    xgXga: {},
    odds: [{ selectionKey: "home_win", decimalOdds: 2.3, bookmaker: "Casa" }]
  }));
  const home = result.scenarios.find((row) => row.key === "home");
  assert.ok(home.expectedValuePct > 0);
  assert.notEqual(home.decision, "apuesta_recomendada");
});

test("sin datos suficientes regresa estado controlado", () => {
  const result = buildOutcomeScenarios({ fixture: { id: 1, home: "A", away: "B" }, researchData: {} });
  assert.equal(result.status, "not_available");
  assert.equal(result.decision, "datos_insuficientes");
  assert.equal(result.scenarios.length, 0);
});
