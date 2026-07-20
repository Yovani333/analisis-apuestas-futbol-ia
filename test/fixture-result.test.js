import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFixtureResult } from "../server/services/api-football.service.js";
import { settleLegResult } from "../public/parlay-store.js";

function fixtureRow({ status = "FT", goals = [2, 1], halftime = [1, 0], fulltime = goals, extratime = [null, null], penalty = [null, null] } = {}) {
  return {
    fixture: { id: 9001, date: "2026-07-19T18:00:00-07:00", status: { short: status, long: "Match Finished", elapsed: 90 } },
    teams: { home: { id: 10, name: "Home FC" }, away: { id: 20, name: "Away FC" } },
    goals: { home: goals[0], away: goals[1] },
    score: {
      halftime: { home: halftime[0], away: halftime[1] },
      fulltime: { home: fulltime[0], away: fulltime[1] },
      extratime: { home: extratime[0], away: extratime[1] },
      penalty: { home: penalty[0], away: penalty[1] }
    }
  };
}

function teamStats(team, values) {
  return { team, statistics: Object.entries(values).map(([type, value]) => ({ type, value })) };
}

test("normaliza un partido finalizado en 90 minutos sin cambiar campos existentes", () => {
  const result = normalizeFixtureResult(fixtureRow());
  assert.equal(result.fixtureId, "9001");
  assert.equal(result.status, "FT");
  assert.equal(result.finished, true);
  assert.deepEqual(result.goals, { home: 2, away: 1 });
  assert.deepEqual(result.penaltyScore, { home: null, away: null });
  assert.deepEqual(result.halftimeScore, { home: 1, away: 0 });
  assert.deepEqual(result.regulationGoals, { home: 2, away: 1 });
  assert.equal(result.advancedTeam, null);
});

test("conserva empate reglamentario y ganador separado en penales", () => {
  const result = normalizeFixtureResult(fixtureRow({ status: "PEN", goals: [1, 1], fulltime: [1, 1], extratime: [1, 1], penalty: [4, 3] }));
  assert.deepEqual(result.regulationGoals, { home: 1, away: 1 });
  assert.deepEqual(result.penaltyScore, { home: 4, away: 3 });
  assert.deepEqual(result.advancedTeam, { side: "home", id: 10, name: "Home FC" });
});

test("separa marcador reglamentario del resultado despues de prorroga", () => {
  const result = normalizeFixtureResult(fixtureRow({ status: "AET", goals: [2, 1], fulltime: [1, 1], extratime: [2, 1] }));
  assert.deepEqual(result.goals, { home: 2, away: 1 });
  assert.deepEqual(result.regulationGoals, { home: 1, away: 1 });
  assert.deepEqual(result.extraTimeScore, { home: 2, away: 1 });
  assert.deepEqual(result.advancedTeam, { side: "home", id: 10, name: "Home FC" });
});

test("expone corners oficiales disponibles y conserva ausencia como null", () => {
  const row = fixtureRow();
  const statistics = [
    teamStats(row.teams.home, { "Corner Kicks": 0 }),
    teamStats(row.teams.away, { "Corner Kicks": 7 })
  ];
  assert.deepEqual(normalizeFixtureResult(row, { statistics }).corners, { home: 0, away: 7, total: 7 });
  assert.equal(normalizeFixtureResult(row).corners, null);
});

test("expone tarjetas oficiales sin convertir campos ausentes en cero", () => {
  const row = fixtureRow();
  const complete = [
    teamStats(row.teams.home, { "Yellow Cards": 2, "Red Cards": 0 }),
    teamStats(row.teams.away, { "Yellow Cards": 1, "Red Cards": 1 })
  ];
  const result = normalizeFixtureResult(row, { statistics: complete });
  assert.equal(result.cards.home, 2);
  assert.equal(result.cards.away, 2);
  assert.equal(result.cards.total, 4);
  assert.deepEqual(result.cards.breakdown.home, { yellow: 2, red: 0, total: 2 });

  const partial = normalizeFixtureResult(row, { statistics: [teamStats(row.teams.home, { "Yellow Cards": 2 })] });
  assert.equal(partial.cards.home, null);
  assert.equal(partial.cards.breakdown.home.red, null);
  assert.equal(normalizeFixtureResult(row).cards, null);
});

test("normaliza estadisticas de jugadores solo cuando estan disponibles", () => {
  const players = [{
    team: { id: 10, name: "Home FC" },
    players: [{
      player: { id: 99, name: "Forward" },
      statistics: [{ games: { minutes: 88, position: "F", substitute: false, rating: "7.4" }, shots: { total: 4, on: 2 }, goals: { total: 1, assists: 0 }, passes: { total: 21, key: 2, accuracy: "81%" }, cards: { yellow: 0, red: 0 } }]
    }]
  }];
  const result = normalizeFixtureResult(fixtureRow(), { players });
  assert.equal(result.playerStatistics.length, 1);
  assert.equal(result.playerStatistics[0].playerId, 99);
  assert.deepEqual(result.playerStatistics[0].shots, { total: 4, onTarget: 2 });
  assert.equal(result.playerStatistics[0].passes.accuracy, 81);
  assert.equal(normalizeFixtureResult(fixtureRow()).playerStatistics, null);
});

test("mantiene compatibilidad con el consumidor actual de Mis apuestas", () => {
  const result = normalizeFixtureResult(fixtureRow());
  assert.equal(settleLegResult("home_win", result), "won");
  assert.equal(settleLegResult("over_2_5", result), "won");
});

test("la normalizacion es idempotente y no modifica la respuesta original", () => {
  const row = fixtureRow({ status: "PEN", goals: [1, 1], fulltime: [1, 1], extratime: [1, 1], penalty: [5, 4] });
  const before = structuredClone(row);
  const first = normalizeFixtureResult(row);
  const second = normalizeFixtureResult(row);
  assert.deepEqual(first, second);
  assert.deepEqual(row, before);
});
