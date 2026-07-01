import test from "node:test";
import assert from "node:assert/strict";
import { applyAnalysisTiming, detectOddsMovement, resolveAnalysisTiming } from "../public/analysis-timing.js";

const now = new Date("2026-06-30T12:00:00Z");
const hoursAfter = (hours) => new Date(now.getTime() + hours * 3600000).toISOString();

test("clasifica las cinco ventanas previas al partido", () => {
  assert.equal(resolveAnalysisTiming({ kickoffAt: hoursAfter(60), lastUpdatedAt: now }, now).window, "early_value");
  assert.equal(resolveAnalysisTiming({ kickoffAt: hoursAfter(24), lastUpdatedAt: now }, now).window, "prevalidated");
  assert.equal(resolveAnalysisTiming({ kickoffAt: hoursAfter(8), lastUpdatedAt: now }, now).window, "ideal");
  assert.equal(resolveAnalysisTiming({ kickoffAt: hoursAfter(1.5), lastUpdatedAt: now }, now).window, "final_confirmation");
  assert.equal(resolveAnalysisTiming({ kickoffAt: hoursAfter(.25), lastUpdatedAt: now }, now).window, "last_review");
});

test("impide confianza alta fuera de una revisión reciente", () => {
  const result = applyAnalysisTiming({ kickoffAt: hoursAfter(8), addedAt: hoursAfter(-14), confidence: "92%" }, now);
  assert.equal(result.analysisTiming.isFresh, false);
  assert.equal(result.effectiveConfidenceScore, 79);
  assert.match(result.analysisTiming.warning, /Requiere actualización/i);
});

test("también limita etiquetas textuales de confianza alta", () => {
  const result = applyAnalysisTiming({ kickoffAt: hoursAfter(60), addedAt: now.toISOString(), confidence: "Alta" }, now);
  assert.equal(result.effectiveConfidenceScore, 59);
  assert.equal(result.analysisTiming.label, "Valor temprano / Exploratorio");
});

test("solo confirma dentro de dos horas con revisión reciente", () => {
  assert.equal(resolveAnalysisTiming({ kickoffAt: hoursAfter(1), lastUpdatedAt: hoursAfter(-1) }, now).isConfirmed, true);
  assert.equal(resolveAnalysisTiming({ kickoffAt: hoursAfter(1), lastUpdatedAt: hoursAfter(-3) }, now).isConfirmed, false);
});

test("detecta movimiento relevante de cuota", () => {
  const movement = detectOddsMovement(2, 1.8);
  assert.equal(movement.changed, true);
  assert.equal(movement.percent, -10);
  assert.match(movement.warning, /Revisar el pick/i);
});
