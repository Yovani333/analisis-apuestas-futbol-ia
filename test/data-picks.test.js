import test from "node:test";
import assert from "node:assert/strict";
import { generateDataPicks } from "../server/services/data-picks.service.js";

function dataset({ homeXG = 1.6, awayXG = 1.4, odds = [], probabilities = { home: 48, draw: 28, away: 24 } } = {}) {
  return {
    fixture: { id: 10, home: "Local", away: "Visitante", favorite: { probabilities } },
    dataQuality: { score: 82 }, marketAnalysis: odds,
    researchData: {
      totalConfidenceScore: 82, odds: { markets: odds },
      xgXga: { homeXG, awayXG, homeXGA: awayXG, awayXGA: homeXG, sampleSizeHome: 5, sampleSizeAway: 5 },
      statsForm: {}, favorite: { probabilities }
    }
  };
}

test("genera los 13 picks mínimos y conserva picks deportivos sin cuota", () => {
  const result = generateDataPicks(dataset());
  assert.equal(result.picks.length, 13);
  assert.equal(result.picks.every((pick) => pick.sourceModule === "data_picks"), true);
  assert.equal(result.picks.every((pick) => pick.isSportsPick && pick.expectedValuePct === null), true);
  assert.equal(result.poisson.status, "available");
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
  assert.equal(pick.highlightColor, "red");
});

test("partido equilibrado limita la confianza de ganadores simples", () => {
  const result = generateDataPicks(dataset({ probabilities: { home: 36, draw: 30, away: 34 } }));
  for (const key of ["home_win", "draw", "away_win"]) {
    assert.ok(result.picks.find((pick) => pick.selectionKey === key).confidenceScore <= 64);
  }
});
