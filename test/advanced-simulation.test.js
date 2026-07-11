import test from "node:test";
import assert from "node:assert/strict";
import { runAdvancedSimulation, __advancedSimulationInternals } from "../server/services/advanced-simulation.service.js";

const fixture = (id, date, status = "FT") => ({
  fixture: { id, date, status: { short: status } },
  teams: { home: { name: "A" }, away: { name: "B" } }
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

function dependencies() {
  const previous = {
    1: [fixture(11, "2026-07-01T10:00:00Z"), fixture(12, "2026-06-28T10:00:00Z"), fixture(13, "2026-06-20T10:00:00Z")],
    2: [fixture(21, "2026-07-01T10:00:00Z"), fixture(22, "2026-06-28T10:00:00Z"), fixture(23, "2026-06-20T10:00:00Z")]
  };
  const byFixture = {
    11: stats(1, { shots: 14, shotsOnGoal: 6, possession: "58%", passes: 510, passAccuracy: "84%", fouls: 9, yellowCards: 1, redCards: 0, offsides: 2, corners: 6 }),
    12: stats(1, { shots: 13, shotsOnGoal: 5, possession: "56%", passes: 490, passAccuracy: "83%", fouls: 10, yellowCards: 1, redCards: 0, offsides: 1, corners: 5 }),
    13: stats(1, { shots: 12, shotsOnGoal: 4, possession: "55%", passes: 470, passAccuracy: "82%", fouls: 11, yellowCards: 2, redCards: 0, offsides: 2, corners: 5 }),
    21: stats(2, { shots: 8, shotsOnGoal: 2, possession: "46%", passes: 360, passAccuracy: "76%", fouls: 13, yellowCards: 2, redCards: 0, offsides: 1, corners: 3 }),
    22: stats(2, { shots: 7, shotsOnGoal: 2, possession: "44%", passes: 340, passAccuracy: "75%", fouls: 14, yellowCards: 2, redCards: 0, offsides: 1, corners: 3 }),
    23: stats(2, { shots: 9, shotsOnGoal: 3, possession: "48%", passes: 380, passAccuracy: "77%", fouls: 12, yellowCards: 3, redCards: 0, offsides: 2, corners: 4 })
  };
  return {
    getPreviousFixtures: async (teamId) => previous[teamId],
    getFixtureStatistics: async (fixtureId) => byFixture[fixtureId] || []
  };
}

test("ejecuta simulacion avanzada con Elo, Dixon-Coles, contexto y mercado", async () => {
  const result = await runAdvancedSimulation({
    teamA: { id: 1, name: "Equipo A" },
    teamB: { id: 2, name: "Equipo B" },
    fixtureDate: "2026-07-10T10:00:00Z",
    windowSize: 5,
    competition: "Mundial",
    dataset: {
      fixture: { id: 99, home: "Equipo A", away: "Equipo B", leagueName: "Copa Mundial FIFA", leagueSlug: "world-cup" },
      researchData: { odds: { markets: [{ market: "Resultado 1X2", selection: "Equipo A gana", selectionKey: "home_win", decimalOdds: 1.9 }] } },
      dataQuality: { score: 70 },
      confirmed: { lineups: [] }
    }
  }, dependencies());
  assert.equal(result.modelVersion, "advanced-simulation-v1");
  assert.ok(result.elo.teamA > result.elo.teamB);
  assert.ok(result.dixonColes.goalMatrix.length > 0);
  const total = result.finalProbabilities.homeWin + result.finalProbabilities.draw + result.finalProbabilities.awayWin;
  assert.ok(Math.abs(total - 100) < 0.2);
  assert.ok(result.marketComparison[0].selectionKey === "home_win");
  assert.ok(["apuesta_recomendada", "apuesta_con_valor_pero_riesgo_alto", "no_bet"].includes(result.summary.decision));
  assert.ok(result.warnings.some((item) => /Regresion ordinal/.test(item)));
});

test("normaliza probabilidades aunque las entradas sean cero", () => {
  const result = __advancedSimulationInternals.normalizeThree(0, 0, 0);
  assert.equal(Number((result.home + result.draw + result.away).toFixed(6)), 1);
});
