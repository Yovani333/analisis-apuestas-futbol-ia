import test from "node:test";
import assert from "node:assert/strict";
import { activeFavoriteTeams, isFavoriteTeam, mergeFavoriteTeams, toggleFavoriteTeam } from "../public/favorite-teams.js";
import { getTeamHistoricalStats } from "../server/services/simulation-comparator.service.js";

test("agrega y quita un equipo favorito conservando una marca sincronizable", () => {
  const added = toggleFavoriteTeam([], { id: 10, name: "Equipo Uno", logo: "logo.png" }, new Date("2026-07-18T10:00:00Z"));
  assert.equal(isFavoriteTeam(added, 10), true);
  const removed = toggleFavoriteTeam(added, { id: 10, name: "Equipo Uno" }, new Date("2026-07-18T11:00:00Z"));
  assert.equal(isFavoriteTeam(removed, 10), false);
  assert.equal(removed[0].active, false);
});

test("la revision mas reciente decide el favorito entre dispositivos", () => {
  const merged = mergeFavoriteTeams(
    [{ id: "10", name: "Equipo Uno", active: true, updatedAt: "2026-07-18T10:00:00Z" }],
    [{ id: "10", name: "Equipo Uno", active: false, updatedAt: "2026-07-18T11:00:00Z" }, { id: "20", name: "Equipo Dos", active: true }]
  );
  assert.deepEqual(activeFavoriteTeams(merged).map((team) => team.id), ["20"]);
});

test("genera resumen histórico para la gráfica sin inventar métricas ausentes", async () => {
  const fixtures = [{
    fixture: { id: 100, date: "2026-07-10T10:00:00Z", status: { short: "FT" } },
    teams: { home: { id: 10, name: "Equipo Uno" }, away: { id: 20, name: "Rival" } }
  }];
  const result = await getTeamHistoricalStats({ team: { id: 10, name: "Equipo Uno" }, cutoffDate: "2026-07-18T10:00:00Z", windowSize: 5 }, {
    getPreviousFixtures: async () => fixtures,
    getFixtureStatistics: async () => [{ team: { id: 10 }, statistics: [
      { type: "Total Shots", value: "12" },
      { type: "Shots on Goal", value: "5" },
      { type: "Ball Possession", value: "55%" }
    ] }]
  });
  assert.equal(result.status, "partial");
  assert.equal(result.team.metrics.shots, 12);
  assert.equal(result.team.metrics.possession, 55);
  assert.equal(result.team.metrics.corners, null);
  assert.equal(result.team.matchesWithStatistics, 1);
});
