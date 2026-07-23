import test from "node:test";
import assert from "node:assert/strict";
import { buildExpectedCornersPick } from "../public/expected-corners-pick.js";

test("convierte la proyeccion de corners en un pick pendiente de cuota", () => {
  const pick = buildExpectedCornersPick({ status: "available", totalExpectedCorners: 10.2, confidenceScore: 74, picks: [] });
  assert.equal(pick.selection, "Más de 9 corners");
  assert.equal(pick.selectionKey, "over_corners");
  assert.equal(pick.projectedTotal, 10.2);
  assert.equal(pick.hasOdds, false);
  assert.equal(pick.highlightColor, "green");
});

test("reutiliza la cuota compatible sin duplicar la formula del mercado", () => {
  const quoted = { selectionKey: "over_corners", selection: "Más de 8.5 corners", decimalOdds: 1.91, expectedValuePct: 7.4 };
  const pick = buildExpectedCornersPick({ totalExpectedCorners: 9.8, picks: [quoted] });
  assert.equal(pick.selection, quoted.selection);
  assert.equal(pick.decimalOdds, 1.91);
  assert.equal(pick.expectedValuePct, 7.4);
  assert.equal(pick.hasOdds, true);
});

test("no crea picks cuando la proyeccion no es valida", () => {
  assert.equal(buildExpectedCornersPick({ totalExpectedCorners: null }), null);
  assert.equal(buildExpectedCornersPick({ totalExpectedCorners: "" }), null);
  assert.equal(buildExpectedCornersPick({ totalExpectedCorners: -1 }), null);
});

test("respeta una recomendación de menos de generada por el modelo", () => {
  const recommendation = { selectionKey: "under_10_5_corners", selection: "Menos de 10.5 corners", decimalOdds: null };
  const pick = buildExpectedCornersPick({ totalExpectedCorners: 9.7, recommendation });
  assert.equal(pick.selection, "Menos de 10.5 corners");
  assert.equal(pick.selectionKey, "under_10_5_corners");
  assert.equal(pick.hasOdds, false);
});
