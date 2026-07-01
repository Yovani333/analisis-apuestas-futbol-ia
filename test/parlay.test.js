import test from "node:test";
import assert from "node:assert/strict";
import { calculateHistoryMetrics, calculateParlayResult, createSavedParlay, createSavedPick, moveParlayToTrash, normalizePickLeg, restoreParlayFromTrash, settleLegResult } from "../public/parlay-store.js";

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

test("congela la cuota original y mantiene una sola cuota actualizada", () => {
  const pick = createSavedPick({ id: "pick-1", decimalOdds: 1.65, updatedOdds: 1.58, fixtureStatus: "En vivo" }, new Date("2026-06-28T12:00:00Z"));
  assert.equal(pick.originalOdds, 1.65);
  assert.equal(pick.updatedOdds, 1.58);
  assert.equal(pick.fixtureStatus, "En vivo");
});

test("normaliza picks de cualquier módulo con un contrato común", () => {
  const now = new Date("2026-06-30T18:00:00Z");
  const leg = normalizePickLeg({
    fixtureId: 25, market: "Ambos anotan", selection: "Sí", decimalOdds: 1.9,
    modelProbability: 58, expectedValue: 10.2, sourceModule: "data_picks",
    supportingData: ["xG combinado 3.1"], contradictingData: ["muestra limitada"]
  }, now);
  assert.equal(leg.originalOdds, 1.9);
  assert.equal(leg.sourceModule, "data_picks");
  assert.deepEqual(leg.supportingData, ["xG combinado 3.1"]);
  assert.deepEqual(leg.contradictingData, ["muestra limitada"]);
  assert.equal(leg.addedAt, now.toISOString());
});

test("pick individual y parlay conservan fuente y evidencias", () => {
  const now = new Date("2026-06-30T18:00:00Z");
  const input = { fixtureId: 25, market: "Total", selection: "Over 2.5", sourceModule: "poisson", supportingData: ["lambda 3.2"] };
  const pick = createSavedPick(input, now);
  const parlay = createSavedParlay("Prueba", [input, { ...input, selection: "BTTS", sourceModule: "team_goal_probability" }], now);
  assert.equal(pick.sourceModule, "poisson");
  assert.deepEqual(pick.supportingData, ["lambda 3.2"]);
  assert.equal(parlay.legs[1].sourceModule, "team_goal_probability");
  assert.equal(parlay.legs.every((leg) => Boolean(leg.addedAt)), true);
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

test("mueve un parlay a papelera conservando sus datos e identificador", () => {
  const original = createSavedParlay("Mundial", [{ id: "leg", selection: "1X" }], new Date("2026-07-01T10:00:00Z"));
  const trashed = moveParlayToTrash(original, new Date("2026-07-01T12:00:00Z"));
  assert.equal(trashed.id, original.id);
  assert.equal(trashed.trashed, true);
  assert.equal(trashed.deletedAt, "2026-07-01T12:00:00.000Z");
  assert.deepEqual(trashed.legs, original.legs);
});

test("recupera un parlay sin duplicarlo ni cambiar su identificador", () => {
  const restored = restoreParlayFromTrash({ id: "p-1", trashed: true, deletedAt: "2026-07-01T12:00:00Z", legs: [] });
  assert.equal(restored.id, "p-1");
  assert.equal(restored.trashed, false);
  assert.equal("deletedAt" in restored, false);
});
