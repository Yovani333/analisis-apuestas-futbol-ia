import test from "node:test";
import assert from "node:assert/strict";
import { compareTeamsWithHistoricalStats } from "../server/services/simulation-comparator.service.js";

const fixture = (id, date, home = "A", away = "B", status = "FT") => ({
  fixture: { id, date, status: { short: status } },
  teams: { home: { name: home }, away: { name: away } }
});

const stats = (teamId, values = {}) => [{
  team: { id: teamId },
  statistics: [
    ["Total Shots", values.shots],
    ["Shots on Goal", values.shotsOnGoal],
    ["Ball Possession", values.possession],
    ["Total passes", values.passes],
    ["Passes %", values.passAccuracy],
    ["Fouls", values.fouls],
    ["Yellow Cards", values.yellowCards],
    ["Red Cards", values.redCards],
    ["Offsides", values.offsides],
    ["Corner Kicks", values.corners]
  ].map(([type, value]) => ({ type, value }))
}];

test("compara promedios historicos de dos equipos con ventana comun", async () => {
  const previous = {
    1: [fixture(11, "2026-07-01T10:00:00Z"), fixture(12, "2026-06-28T10:00:00Z"), fixture(13, "2026-06-20T10:00:00Z", "A", "B", "NS")],
    2: [fixture(21, "2026-07-01T10:00:00Z"), fixture(22, "2026-06-28T10:00:00Z")]
  };
  const byFixture = {
    11: stats(1, { shots: 10, shotsOnGoal: 4, possession: "55%", passes: 400, passAccuracy: "82%", fouls: 9, yellowCards: 1, redCards: 0, offsides: 2, corners: 5 }),
    12: stats(1, { shots: 14, shotsOnGoal: 6, possession: "57%", passes: 420, passAccuracy: "84%", fouls: 11, yellowCards: 2, redCards: 0, offsides: 1, corners: 7 }),
    21: stats(2, { shots: 8, shotsOnGoal: 3, possession: "48%", passes: 350, passAccuracy: "78%", fouls: 12, yellowCards: 3, redCards: 0, offsides: 2, corners: 4 }),
    22: stats(2, { shots: 6, shotsOnGoal: 2, possession: "45%", passes: 330, passAccuracy: "76%", fouls: 13, yellowCards: 2, redCards: 1, offsides: 1, corners: 3 })
  };
  const result = await compareTeamsWithHistoricalStats({
    teamA: { id: 1, name: "Equipo A" },
    teamB: { id: 2, name: "Equipo B" },
    fixtureDate: "2026-07-10T10:00:00Z",
    windowSize: 5,
    competition: "Mundial"
  }, {
    getPreviousFixtures: async (teamId) => previous[teamId],
    getFixtureStatistics: async (fixtureId) => byFixture[fixtureId] || []
  });
  assert.equal(result.status, "available");
  assert.equal(result.teamA.matchesWithStatistics, 2);
  assert.equal(result.teamB.matchesWithStatistics, 2);
  assert.equal(result.metrics.find((row) => row.key === "shots").teamA, 12);
  assert.equal(result.metrics.find((row) => row.key === "passAccuracy").teamB, 77);
  assert.equal(result.metrics.find((row) => row.key === "corners").advantage, "Equipo A");
  assert.ok(result.warnings.length);
});

test("devuelve estado controlado si faltan IDs de equipo", async () => {
  const result = await compareTeamsWithHistoricalStats({ teamA: {}, teamB: {}, windowSize: 5 }, {
    getPreviousFixtures: async () => [],
    getFixtureStatistics: async () => []
  });
  assert.equal(result.status, "not_available");
  assert.match(result.message, /Selecciona dos equipos/);
});
