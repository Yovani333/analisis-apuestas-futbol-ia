import test from "node:test";
import assert from "node:assert/strict";
import { calculateHistoryMetrics, calculateParlayResult, createSavedParlay, settleLegResult } from "../public/parlay-store.js";

test("mantiene el parlay pendiente mientras falte un resultado", () => {
  assert.equal(calculateParlayResult([{ result: "won" }, { result: "pending" }]), "pending");
});

test("marca perdido si cualquier selección pierde", () => {
  assert.equal(calculateParlayResult([{ result: "won" }, { result: "lost" }]), "lost");
  assert.equal(calculateParlayResult([{ result: "pending" }, { result: "lost" }]), "lost");
});

test("marca ganado cuando todas las selecciones activas ganan", () => {
  assert.equal(calculateParlayResult([{ result: "won" }, { result: "void" }]), "won");
});

test("crea un registro sin alterar el borrador original", () => {
  const draft = [{ id: "leg-1", selection: "Ejemplo" }];
  const saved = createSavedParlay("Prueba", draft, new Date("2026-06-20T12:00:00Z"));
  assert.equal(saved.name, "Prueba");
  assert.equal(saved.legs[0].result, "pending");
  assert.equal(draft[0].result, undefined);
});

test("liquida automáticamente los tres mercados permitidos", () => {
  const result = { finished: true, goals: { home: 2, away: 1 } };
  assert.equal(settleLegResult("1X", result), "won");
  assert.equal(settleLegResult("over_2_5", result), "won");
  assert.equal(settleLegResult("btts_no", result), "lost");
});

test("calcula rendimiento teórico con una unidad por parlay", () => {
  const metrics = calculateHistoryMetrics([{ legs: [{ result: "won", decimalOdds: 1.5 }, { result: "won", decimalOdds: 2 }] }, { legs: [{ result: "lost", decimalOdds: 1.8 }] }]);
  assert.equal(metrics.won, 1);
  assert.equal(metrics.lost, 1);
  assert.equal(metrics.theoreticalUnits, 1);
});
