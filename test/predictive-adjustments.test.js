import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateConservativeValue,
  calculateRecencyWeightedAverage,
  shrinkEstimate
} from "../server/services/predictive-adjustments.service.js";

test("pondera mas los partidos recientes y reporta muestra efectiva", () => {
  const result = calculateRecencyWeightedAverage([2, 1, 1], 0.9);
  assert.ok(result.value > 1.33);
  assert.ok(result.value < 2);
  assert.ok(result.effectiveSampleSize < 3);
});

test("shrinkage usa n/(n+k) y no se aplica sin prior real", () => {
  const adjusted = shrinkEstimate({ estimate: 2, sampleSize: 5, prior: 1, priorStrength: 5 });
  assert.equal(adjusted.value, 1.5);
  assert.equal(adjusted.teamWeight, 0.5);
  assert.equal(adjusted.applied, true);
  const untouched = shrinkEstimate({ estimate: 2, sampleSize: 5, prior: null });
  assert.equal(untouched.value, 2);
  assert.equal(untouched.applied, false);
});

test("EV conservador queda debajo del EV puntual y exige muestra", () => {
  const result = calculateConservativeValue({ modelProbabilityPct: 60, decimalOdds: 2, sampleSize: 8, dataQualityScore: 80 });
  assert.ok(result.probabilityPct < 60);
  assert.ok(result.expectedValuePct < 20);
  assert.ok(result.uncertaintyMarginPct > 0);
  assert.equal(calculateConservativeValue({ modelProbabilityPct: 60, decimalOdds: 2, sampleSize: 0, dataQualityScore: 80 }).expectedValuePct, null);
});
