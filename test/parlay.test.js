import test from "node:test";
import assert from "node:assert/strict";
import { calculateHistoryMetrics, calculateOriginPerformance, calculateParlayResult, createSavedParlay, createSavedPick, hasDuplicatePick, moveParlayToTrash, normalizePickLeg, pickIdentity, restoreParlayFromTrash, settleLegResult } from "../public/parlay-store.js";

test("mantiene el parlay pendiente mientras falte un resultado", () => {
  assert.equal(calculateParlayResult([{ result: "won" }, { result: "pending" }]), "pending");
});

test("ordena el rendimiento de picks concluidos por origen", () => {
  const rows = calculateOriginPerformance([
    { sourceModule: "poisson", result: "won" }, { sourceModule: "poisson", result: "lost" },
    { sourceModule: "data_picks", result: "won" }, { sourceModule: "data_picks", result: "pending" }
  ]);
  assert.deepEqual(rows.map((row) => row.origin), ["data_picks", "poisson"]);
  assert.equal(rows[0].winRate, 100);
  assert.equal(rows[1].winRate, 50);
});

test("resultados por origen incluye selecciones concluidas de parlays activos", () => {
  const rows = calculateOriginPerformance(
    [{ sourceModule: "data_picks", result: "won" }, { sourceModule: "data_picks", result: "pending" }],
    [
      { id: "active", legs: [{ sourceModule: "data_picks", result: "lost" }, { sourceModule: "poisson", result: "won" }, { sourceModule: "poisson", result: "pending" }] },
      { id: "trash", trashed: true, legs: [{ sourceModule: "poisson", result: "lost" }] }
    ]
  );
  const data = rows.find((row) => row.origin === "data_picks");
  const poisson = rows.find((row) => row.origin === "poisson");
  assert.deepEqual({ evaluated: data.evaluated, won: data.won, lost: data.lost, individual: data.individual, parlayLegs: data.parlayLegs }, { evaluated: 2, won: 1, lost: 1, individual: 1, parlayLegs: 1 });
  assert.deepEqual({ evaluated: poisson.evaluated, won: poisson.won, lost: poisson.lost, individual: poisson.individual, parlayLegs: poisson.parlayLegs }, { evaluated: 1, won: 1, lost: 0, individual: 0, parlayLegs: 1 });
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

test("un candidato de jugador sin cuota conserva su origen y no rompe el parlay", () => {
  const input = { fixtureId: 1567307, market: "Jugador anota en cualquier momento", selection: "Harry Kane anota", decimalOdds: null, sourceModule: "player_goal_candidate" };
  const pick = createSavedPick(input, new Date("2026-07-05T12:00:00Z"));
  const parlay = createSavedParlay("Goleador pendiente", [input], new Date("2026-07-05T12:00:00Z"));
  assert.equal(pick.originalOdds, null);
  assert.equal(pick.sourceModule, "player_goal_candidate");
  assert.equal(parlay.legs[0].decimalOdds, null);
  assert.equal(calculateParlayResult(parlay.legs), "pending");
});

test("liquida automáticamente los tres mercados permitidos", () => {
  const result = { finished: true, goals: { home: 2, away: 1 } };
  assert.equal(settleLegResult("1X", result), "won");
  assert.equal(settleLegResult("over_2_5", result), "won");
  assert.equal(settleLegResult("btts_no", result), "lost");
  assert.equal(settleLegResult("home_win", result), "won");
  assert.equal(settleLegResult("away_over_0_5", result), "won");
  assert.equal(settleLegResult("home_over_1_5", result), "won");
});

test("liquida DNB como ganado, perdido o anulado", () => {
  assert.equal(settleLegResult("home_dnb", { finished: true, goals: { home: 2, away: 1 } }), "won");
  assert.equal(settleLegResult("home_dnb", { finished: true, goals: { home: 0, away: 1 } }), "lost");
  assert.equal(settleLegResult("away_dnb", { finished: true, goals: { home: 1, away: 1 } }), "void");
});

test("detecta duplicados exactos entre módulos por fixture, mercado y selección", () => {
  const odds = { fixtureId: 77, marketCode: "btts", selectionCode: "btts_yes", sourceModule: "odds" };
  const poisson = { ...odds, sourceModule: "poisson" };
  assert.equal(hasDuplicatePick([odds], poisson), true);
  assert.equal(hasDuplicatePick([odds], poisson, { includeSource: true }), false);
  assert.equal(pickIdentity(odds), pickIdentity(poisson));
});

test("usa nombres normalizados cuando faltan códigos de mercado", () => {
  const existing = { fixtureId: "9", market: "Ambos anotan", selection: "Sí" };
  assert.equal(hasDuplicatePick([existing], { fixtureId: 9, market: " ambos  anotan ", selection: "Si" }), true);
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
