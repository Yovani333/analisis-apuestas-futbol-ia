import test from "node:test";
import assert from "node:assert/strict";
import { calculateCompetitionPerformance, calculateHistoryMetrics, calculateOriginPerformance, calculateOriginRecommendations, calculateParlayLegCounts, calculateParlayResult, canAutomaticallySettlePick, createSavedParlay, createSavedPick, filterParlaysByFixtureDate, filterPicksByFixtureDate, hasDuplicatePick, moveParlayToTrash, needsSettlementRefresh, normalizePickLeg, pickIdentity, resolveSelectionCode, restoreParlayFromTrash, SETTLEMENT_VERIFICATION_VERSION, settleLegResult, settlePickResult } from "../public/parlay-store.js";

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

test("resultados por origen conserva selecciones concluidas aunque el parlay se elimine", () => {
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
  assert.deepEqual({ evaluated: poisson.evaluated, won: poisson.won, lost: poisson.lost, individual: poisson.individual, parlayLegs: poisson.parlayLegs }, { evaluated: 2, won: 1, lost: 1, individual: 0, parlayLegs: 2 });
});

test("cuenta picks ganados y perdidos por competición incluyendo parlays", () => {
  const rows = calculateCompetitionPerformance(
    [
      { leagueId: 253, league: "MLS", result: "won" },
      { leagueId: 253, league: "MLS", result: "pending" },
      { leagueId: 71, league: "Brasileirão Serie A", result: "lost" }
    ],
    [
      { legs: [{ leagueId: 253, league: "Major League Soccer", result: "lost" }, { league: "Liga MX", result: "won" }] },
      { trashed: true, legs: [{ league: "Liga MX", result: "lost" }] }
    ]
  );
  const mls = rows.find((row) => row.leagueId === 253);
  const ligaMx = rows.find((row) => row.competition === "Liga MX");
  assert.deepEqual({ evaluated: mls.evaluated, won: mls.won, lost: mls.lost, individual: mls.individual, parlayLegs: mls.parlayLegs },
    { evaluated: 2, won: 1, lost: 1, individual: 1, parlayLegs: 1 });
  assert.deepEqual({ evaluated: ligaMx.evaluated, won: ligaMx.won, lost: ligaMx.lost, parlayLegs: ligaMx.parlayLegs },
    { evaluated: 2, won: 1, lost: 1, parlayLegs: 2 });
});

test("resultados por competición ignora pendientes y anulados", () => {
  assert.deepEqual(calculateCompetitionPerformance([
    { league: "MLS", result: "pending" },
    { league: "MLS", result: "void" }
  ]), []);
});

test("resultados por competición se ordenan por porcentaje descendente", () => {
  const rows = calculateCompetitionPerformance([
    { league: "Liga A", result: "won" }, { league: "Liga A", result: "lost" },
    { league: "Liga B", result: "won" }, { league: "Liga B", result: "won" },
    { league: "Liga C", result: "lost" }
  ]);
  assert.deepEqual(rows.map((row) => row.competition), ["Liga B", "Liga A", "Liga C"]);
  assert.deepEqual(rows.map((row) => row.winRate), [100, 50, 0]);
});

test("filtra picks y parlays por la fecha del partido", () => {
  const picks = [{ id: "a", date: "2026-07-20" }, { id: "b", date: "2026-07-21" }, { id: "c", date: "20/07/2026" }];
  const parlays = [
    { id: "p1", legs: [{ date: "2026-07-20" }, { date: "2026-07-22" }] },
    { id: "p2", legs: [{ date: "2026-07-21" }] }
  ];
  assert.deepEqual(filterPicksByFixtureDate(picks, "2026-07-20").map((pick) => pick.id), ["a", "c"]);
  assert.deepEqual(filterParlaysByFixtureDate(parlays, "2026-07-20").map((parlay) => parlay.id), ["p1"]);
  assert.equal(filterPicksByFixtureDate(picks, "").length, 3);
});

test("cuenta por separado picks ganados y perdidos dentro de parlays", () => {
  assert.deepEqual(calculateParlayLegCounts([
    { legs: [{ result: "won" }, { result: "lost" }, { result: "pending" }] },
    { legs: [{ result: "won" }, { result: "void" }] }
  ]), { won: 2, lost: 1 });
});

test("resultados por origen agrupa anticipacion y clasifica picks ganados", () => {
  const rows = calculateOriginPerformance([{
    id: "p1", sourceModule: "data_picks", result: "won", selection: "Más de 2.5 goles", market: "Total",
    home: "A", away: "B", kickoffAt: "2026-07-10T18:00:00Z", addedAt: "2026-07-08T17:00:00Z"
  }, {
    id: "p2", sourceModule: "data_picks", result: "won", selection: "Más de 2.5 goles", market: "Total",
    home: "C", away: "D", kickoffAt: "2026-07-10T18:00:00Z", addedAt: "2026-07-10T16:30:00Z"
  }]);
  assert.match(rows[0].addedSummary, /2 d \(1\)/);
  assert.match(rows[0].addedSummary, /1 h \(1\)/);
  assert.deepEqual(rows[0].wonCategories, [{ category: "Más de 2.5", count: 2 }]);
  assert.equal(rows[0].wonPicks.length, 2);
});

test("liquida el total H2H mas de 0.5 sin convertir datos ausentes en cero", () => {
  assert.equal(settleLegResult("over_0_5", { finished: true, goals: { home: 1, away: 0 } }), "won");
  assert.equal(settleLegResult("over_0_5", { finished: true, goals: { home: 0, away: 0 } }), "lost");
  assert.equal(settleLegResult("over_0_5", { finished: true, goals: { home: null, away: 0 } }), "pending");
});

test("resultados por origen conserva el detalle y categorias de picks perdidos", () => {
  const rows = calculateOriginPerformance([{
    id: "lost-1", sourceModule: "poisson", result: "lost", selection: "Menos de 2.5 goles", market: "Total",
    home: "A", away: "B", league: "Liga de prueba", originalOdds: 1.8
  }]);
  assert.equal(rows[0].lostPicks.length, 1);
  assert.equal(rows[0].lostPicks[0].selection, "Menos de 2.5 goles");
  assert.deepEqual(rows[0].lostCategories, [{ category: "Menos de 2.5", count: 1 }]);
});

test("mejores picks exige muestra minima y separa historiales desfavorables", () => {
  const rows = calculateOriginPerformance([
    ...Array.from({ length: 3 }, (_, index) => ({ id: `good-${index}`, sourceModule: "data_picks", result: "won", selection: "Local 1X", market: "Doble oportunidad" })),
    ...Array.from({ length: 3 }, (_, index) => ({ id: `bad-${index}`, sourceModule: "poisson", result: "lost", selection: "Más de 2.5 goles", market: "Total" })),
    { id: "small-1", sourceModule: "corners", result: "won", selection: "Más de 8.5 corners", market: "Corners" }
  ]);
  const result = calculateOriginRecommendations(rows);
  assert.equal(result.recommended[0].origin, "data_picks");
  assert.equal(result.notRecommended[0].origin, "poisson");
  assert.equal(result.observing[0].origin, "corners");
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
  assert.equal(settleLegResult("over_1_5", result), "won");
  assert.equal(settleLegResult("12", result), "won");
});

test("recupera el código de picks antiguos y los liquida con el marcador final", () => {
  const result = { finished: true, goals: { home: 2, away: 0 } };
  assert.equal(resolveSelectionCode({ home: "Argentina", away: "Egypt", market: "Resultado 1X2", selection: "Argentina gana" }), "home_win");
  assert.equal(settlePickResult({ home: "Argentina", away: "Egypt", market: "Resultado 1X2", selection: "Argentina gana" }, result), "won");
  assert.equal(settlePickResult({ market: "Total de goles 1.5", selection: "Más de 1.5 goles" }, result), "won");
  assert.equal(settlePickResult({ market: "Ambos equipos anotan", selection: "Sí" }, result), "lost");
});

test("liquida corners cuando las estadísticas finales están disponibles", () => {
  const result = { finished: true, goals: { home: 1, away: 0 }, corners: { home: 7, away: 3 } };
  assert.equal(settlePickResult({ home: "A", away: "B", market: "Total de corners", selection: "Más de 8.5 corners" }, result), "won");
  assert.equal(settlePickResult({ home: "A", away: "B", market: "Más corners", selection: "A más corners" }, result), "won");
  assert.equal(settlePickResult({ home: "A", away: "B", market: "Total de corners", selection: "Más de 8.5 corners" }, { ...result, corners: null }), "pending");
  assert.equal(settlePickResult({ home: "A", away: "B", market: "Total de corners", selection: "Más de 8.5 corners" }, { ...result, corners: { home: null, away: null } }), "pending");
});

test("liquida una línea entera de corners como ganada, perdida o anulada", () => {
  const leg = { market: "Total de corners", selection: "Más de 11 corners" };
  assert.equal(settlePickResult(leg, { finished: true, corners: { home: 5, away: 7 } }), "won");
  assert.equal(settlePickResult(leg, { finished: true, corners: { home: 5, away: 5 } }), "lost");
  assert.equal(settlePickResult(leg, { finished: true, corners: { home: 5, away: 6 } }), "void");
});

test("no liquida corners de prórroga como si fueran exclusivamente de 90 minutos", () => {
  const result = {
    finished: true,
    regulationGoals: { home: 1, away: 1 },
    extraTimeScore: { home: 2, away: 1 },
    corners: { home: 7, away: 3 }
  };
  assert.equal(settlePickResult({ market: "Total de corners", selection: "Más de 8.5 corners" }, result), "pending");
});

test("liquida 1X2 con 90 minutos y no con prórroga o penales", () => {
  const result = { finished: true, goals: { home: 2, away: 1 }, regulationGoals: { home: 1, away: 1 } };
  assert.equal(settlePickResult({ selectionCode: "draw" }, result), "won");
  assert.equal(settlePickResult({ selectionCode: "home_win" }, result), "lost");
});

test("verifica una sola vez el historial y después consulta solo picks pendientes", () => {
  const historical = { fixtureId: 10, selectionCode: "home_win", result: "won" };
  assert.equal(canAutomaticallySettlePick(historical), true);
  assert.equal(needsSettlementRefresh(historical), true);
  historical.settlementVerificationVersion = SETTLEMENT_VERIFICATION_VERSION;
  assert.equal(needsSettlementRefresh(historical), false);
  historical.result = "pending";
  assert.equal(needsSettlementRefresh(historical), true);
  historical.result = "lost";
  historical.settlementVerificationVersion = "regulation-score-v2";
  assert.equal(needsSettlementRefresh(historical), true);
  historical.resultSource = "manual";
  assert.equal(needsSettlementRefresh(historical), false);
});

test("no consulta repetidamente mercados de jugador que el resultado del fixture no puede liquidar", () => {
  const scorer = { fixtureId: 10, selectionCode: "player_goal_9", result: "pending" };
  assert.equal(canAutomaticallySettlePick(scorer), false);
  assert.equal(needsSettlementRefresh(scorer), false);
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
