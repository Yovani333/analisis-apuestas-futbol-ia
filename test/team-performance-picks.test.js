import test from "node:test";
import assert from "node:assert/strict";
import { buildTeamPerformancePicks, TEAM_PERFORMANCE_PICK_WEIGHTS } from "../server/services/team-performance-picks.service.js";

const match = { id: "900", home: "Brazil", away: "Norway" };
const team = (nombre, overrides = {}) => ({
  nombre,
  jugadores: 25,
  metricas: { entradas: 0.6, tarjetas: 0.02, tiros: 0.30, pases_acertados: 15.15, faltas: 0.43, ...overrides }
});

test("los pesos del motor suman uno y mantienen la prioridad solicitada", () => {
  const totalWeight = Object.values(TEAM_PERFORMANCE_PICK_WEIGHTS).reduce((total, value) => total + value, 0);
  assert.ok(Math.abs(totalWeight - 1) < Number.EPSILON);
  assert.equal(TEAM_PERFORMANCE_PICK_WEIGHTS.shots, 0.35);
  assert.equal(TEAM_PERFORMANCE_PICK_WEIGHTS.accuratePasses, 0.30);
  assert.equal(TEAM_PERFORMANCE_PICK_WEIGHTS.tacklesContext, 0.10);
});

test("genera DNB y gol de equipo para un local que domina tiros y pases", () => {
  const home = team("Brazil", { tiros: "0.42", pases_acertados: "19.21%", faltas: 0.41, tarjetas: 0.04 });
  const result = buildTeamPerformancePicks(match, home, team("Norway"), {
    now: "2026-07-05T12:00:00.000Z",
    odds: [
      { selectionKey: "home_dnb", decimalOdds: 1.42, bookmaker: "Casa" },
      { selectionKey: "home_over_0_5", decimalOdds: 1.25, bookmaker: "Casa" }
    ]
  });
  assert.deepEqual(result.home.map((pick) => pick.selectionKey), ["home_dnb", "home_over_0_5"]);
  assert.equal(result.home.every((pick) => pick.color === "green"), true);
  assert.equal(result.home[0].odds, 1.42);
  assert.equal(result.home[0].origin, "team_average_performance");
  assert.equal(result.away.length, 0);
});

test("coloca los picks debajo del visitante cuando el visitante domina", () => {
  const result = buildTeamPerformancePicks(match,
    team("Brazil"),
    team("Norway", { tiros: 0.43, pases_acertados: 19, faltas: 0.39, tarjetas: 0.01, entradas: 0.5 })
  );
  assert.equal(result.home.length, 0);
  assert.deepEqual(result.away.map((pick) => pick.selectionKey), ["away_dnb", "away_over_0_5"]);
  assert.equal(result.away.every((pick) => pick.side === "away"), true);
});

test("no genera picks con datos principales divididos", () => {
  const result = buildTeamPerformancePicks(match,
    team("Brazil", { tiros: 0.45, pases_acertados: 12 }),
    team("Norway", { tiros: 0.30, pases_acertados: 18 })
  );
  assert.equal(result.home.length, 0);
  assert.equal(result.away.length, 0);
});

test("no genera picks si faltan tiros, pases o identidad del partido", () => {
  assert.equal(buildTeamPerformancePicks(match, team("Brazil", { tiros: null }), team("Norway")).home.length, 0);
  assert.equal(buildTeamPerformancePicks(match, team("Brazil", { pases_acertados: "" }), team("Norway")).home.length, 0);
  assert.equal(buildTeamPerformancePicks({ home: "Brazil", away: "Norway" }, team("Brazil"), team("Norway")).home.length, 0);
});

test("entradas aisladas nunca generan picks", () => {
  const result = buildTeamPerformancePicks(match,
    team("Brazil", { entradas: 4, tiros: 0.30, pases_acertados: 15.15 }),
    team("Norway", { entradas: 0.1, tiros: 0.30, pases_acertados: 15.15 })
  );
  assert.deepEqual(result, { home: [], away: [], match: [] });
});

test("una muestra debil bloquea una ventaja que no es fuerte en ambas señales", () => {
  const result = buildTeamPerformancePicks(match,
    { ...team("Brazil", { tiros: 0.37, pases_acertados: 16.8 }), jugadores: 18 },
    team("Norway")
  );
  assert.equal(result.home.length, 0);
});

test("un pick sin cuota permanece disponible como pendiente de cuota", () => {
  const result = buildTeamPerformancePicks(match,
    team("Brazil", { tiros: 0.42, pases_acertados: 19.21, faltas: 0.41, tarjetas: 0.04 }),
    team("Norway")
  );
  assert.equal(result.home[0].odds, null);
  assert.equal(result.home[0].canAdd, true);
});

test("el riesgo disciplinario degrada la recomendacion y bloquea rojo", () => {
  const result = buildTeamPerformancePicks(match,
    team("Brazil", { tiros: 0.42, pases_acertados: 19.21, faltas: 0.75, tarjetas: 0.18 }),
    team("Norway")
  );
  assert.equal(result.home.length > 0, true);
  assert.equal(result.home.every((pick) => pick.color === "red" && pick.canAdd === false), true);
});
