import test from "node:test";
import assert from "node:assert/strict";
import { generateDataPicks } from "../server/services/data-picks.service.js";

function dataset({ homeXG = 1.6, awayXG = 1.4, odds = [], probabilities = { home: 48, draw: 28, away: 24 }, sampleSize = 5 } = {}) {
  return {
    fixture: { id: 10, home: "Local", away: "Visitante", favorite: { probabilities } },
    dataQuality: { score: 82 }, marketAnalysis: odds,
    researchData: {
      totalConfidenceScore: 82, odds: { markets: odds },
      xgXga: { homeXG, awayXG, homeXGA: awayXG, awayXGA: homeXG, sampleSizeHome: sampleSize, sampleSizeAway: sampleSize },
      statsForm: {}, favorite: { probabilities }
    }
  };
}

test("genera al menos los 13 picks base y clasifica sin cuota como NO BET", () => {
  const result = generateDataPicks(dataset());
  assert.ok(result.picks.length >= 13);
  assert.equal(result.modelVersion, "picks-data-engine-v3");
  assert.equal(result.picks.every((pick) => pick.isSportsPick && pick.expectedValuePct === null), true);
  assert.equal(result.picks.every((pick) => pick.decision === "NO BET" && pick.highlightColor === "gray"), true);
  assert.equal(result.poisson.status, "available");
  assert.equal(result.quality.label, "Parcial");
  assert.ok(result.picks.some((pick) => pick.sourcesUsed.includes("Modelo Poisson interno")));
  assert.ok(result.corners);
  assert.equal(result.liveContext.active, false);
});

test("un under contradicho por xG alto no queda verde aunque tenga EV positivo", () => {
  const odds = [{ selectionKey: "under_2_5", decimalOdds: 4, source: "api-football" }];
  const pick = generateDataPicks(dataset({ homeXG: 1.8, awayXG: 1.5, odds })).picks.find((item) => item.selectionKey === "under_2_5");
  assert.ok(pick.expectedValuePct > 0);
  assert.notEqual(pick.highlightColor, "green");
  assert.notEqual(pick.highlightColor, "blue");
  assert.ok(pick.contradictingData.length);
});

test("BTTS sí queda limitado cuando un equipo tiene xG menor a 0.8", () => {
  const pick = generateDataPicks(dataset({ homeXG: 1.7, awayXG: .55 })).picks.find((item) => item.selectionKey === "btts_yes");
  assert.ok(pick.confidenceScore <= 49);
  assert.equal(pick.highlightColor, "gray");
});

test("partido equilibrado limita la confianza de ganadores simples", () => {
  const result = generateDataPicks(dataset({ probabilities: { home: 36, draw: 30, away: 34 } }));
  for (const key of ["home_win", "draw", "away_win"]) {
    assert.ok(result.picks.find((pick) => pick.selectionKey === key).confidenceScore <= 64);
  }
});

test("separa EV puntual de EV conservador y no usa EV para inflar confianza", () => {
  const odds = [{ selectionKey: "home_win", decimalOdds: 2.4, source: "api-football" }];
  const pick = generateDataPicks(dataset({ odds, sampleSize: 8, probabilities: { home: 58, draw: 24, away: 18 } })).picks.find((item) => item.selectionKey === "home_win");
  assert.ok(pick.expectedValuePct > pick.conservativeExpectedValuePct);
  assert.ok(Number.isFinite(pick.statisticalConfidenceScore));
  assert.ok(Number.isFinite(pick.footballConfidenceScore));
  assert.ok(Number.isFinite(pick.riskScore));
});

test("una muestra menor a tres impide que EV alto se vuelva pick ejecutable", () => {
  const odds = [{ selectionKey: "home_win", decimalOdds: 3, source: "api-football" }];
  const pick = generateDataPicks(dataset({ odds, sampleSize: 1, probabilities: { home: 60, draw: 22, away: 18 } })).picks.find((item) => item.selectionKey === "home_win");
  assert.ok(pick.expectedValuePct > 0);
  assert.equal(pick.canAdd, false);
  assert.equal(pick.decision, "NO BET");
});
