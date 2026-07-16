import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTeamPerformancePromptContext, calculateTeamPerformance, clearTeamPerformanceCache,
  getTeamPerformanceForFixture, selectPreviousCompleteFixtures
} from "../server/services/team-performance.service.js";
import { buildAnalysisContextFromMatchData } from "../server/services/match-research.service.js";

const fixture = (id, teamId, date, status = "FT") => ({
  fixture: { id, date, status: { short: status } },
  teams: { home: { id: teamId }, away: { id: 999 } }
});

const player = (id, minutes, values = {}) => ({
  player: { id, name: `Jugador ${id}` },
  statistics: [{
    games: { minutes }, tackles: { total: values.entradas }, shots: { total: values.tiros },
    passes: { accuracy: values.pases }, fouls: { committed: values.faltas },
    cards: { yellow: values.amarillas, red: values.rojas }
  }]
});

const response = (teamId, players) => [{ team: { id: teamId }, players }];

test("filtra solo fixtures finalizados anteriores y conserva orden cronologico descendente", () => {
  const rows = [
    fixture(1, 10, "2026-06-01T12:00:00Z"),
    fixture(2, 10, "2026-06-03T12:00:00Z", "NS"),
    fixture(3, 10, "2026-06-02T12:00:00Z"),
    fixture(4, 10, "2026-06-05T12:00:00Z")
  ];
  assert.deepEqual(
    selectPreviousCompleteFixtures(rows, "2026-06-04T12:00:00Z").map((row) => row.fixture.id),
    [3, 1]
  );
});

test("promedia por jugador sobre k y asigna cero cuando no participo", () => {
  const result = calculateTeamPerformance({
    teamId: 10, teamName: "Local", k: 2,
    fixturePlayerRows: [
      response(10, [player(1, 90, { entradas: 2, amarillas: 1, rojas: 0, tiros: 3, pases: "80%", faltas: 1 })]),
      response(10, [player(2, 45, { entradas: 4, amarillas: 0, rojas: 1, tiros: 1, pases: 60, faltas: 3 })])
    ]
  });
  assert.equal(result.jugadores, 2);
  assert.deepEqual(result.metricas, {
    entradas: 1.5,
    tarjetas: 0.75,
    tiros: 1,
    pases_acertados: 35,
    faltas: 1
  });
});

test("usa la misma k y reduce una muestra 5 contra 4 a cuatro partidos", async () => {
  clearTeamPerformanceCache();
  const current = {
    id: "500", homeTeamId: 10, awayTeamId: 20, home: "Local", away: "Visitante",
    utcDateTime: "2026-07-10T20:00:00Z"
  };
  const rowsByTeam = {
    10: Array.from({ length: 5 }, (_, index) => fixture(`h${index}`, 10, `2026-07-0${5 - index}T12:00:00Z`)),
    20: Array.from({ length: 4 }, (_, index) => fixture(`a${index}`, 20, `2026-07-0${5 - index}T12:00:00Z`))
  };
  let playerCalls = 0;
  const result = await getTeamPerformanceForFixture(current, {
    getPreviousFixtures: async (teamId) => rowsByTeam[teamId],
    getFixturePlayers: async (fixtureId) => {
      playerCalls += 1;
      const teamId = String(fixtureId).startsWith("h") ? 10 : 20;
      return response(teamId, [player(teamId, 90, { entradas: 2, amarillas: 1, tiros: 4, pases: 75, faltas: 2 })]);
    }
  }, { now: Date.parse("2026-07-09T12:00:00Z") });
  assert.equal(result.k, 4);
  assert.equal(result.fixturesUsedHome.length, 4);
  assert.equal(result.fixturesUsedAway.length, 4);
  assert.equal(result.equipo_local.metricas.entradas, 2);
  const cached = await getTeamPerformanceForFixture(current, {
    getPreviousFixtures: async () => { throw new Error("No debe consultar"); },
    getFixturePlayers: async () => { throw new Error("No debe consultar"); }
  }, { now: Date.parse("2026-07-09T12:01:00Z") });
  assert.equal(cached.cached, true);
  assert.equal(playerCalls, 9);
});

test("devuelve k cero cuando un equipo no tiene historial comparable", async () => {
  clearTeamPerformanceCache();
  const result = await getTeamPerformanceForFixture({
    id: "501", homeTeamId: 10, awayTeamId: 20, home: "Local", away: "Visitante",
    utcDateTime: "2026-07-10T20:00:00Z"
  }, {
    getPreviousFixtures: async (teamId) => teamId === 10 ? [fixture("h1", 10, "2026-07-01T12:00:00Z")] : [],
    getFixturePlayers: async () => response(10, [player(1, 90, { entradas: 1 })])
  });
  assert.equal(result.k, 0);
  assert.equal(result.status, "not_available");
});

test("inyecta el contexto de rendimiento al principio del prompt", () => {
  const performance = {
    status: "available", k: 3,
    equipo_local: { nombre: "A", metricas: { entradas: 1, tarjetas: 2, tiros: 3, pases_acertados: 75, faltas: 4 } },
    equipo_visitante: { nombre: "B", metricas: { entradas: 5, tarjetas: 1, tiros: 2, pases_acertados: 80, faltas: 3 } }
  };
  const context = buildTeamPerformancePromptContext(performance);
  const prompt = buildAnalysisContextFromMatchData({ teamPerformance: performance });
  assert.match(context, /ventana de k=3 partidos/);
  assert.ok(prompt.instructions.startsWith("CONTEXTO DE RENDIMIENTO PREVIO"));
  assert.match(prompt.instructions, /Pases Acertados=75%/);
});
