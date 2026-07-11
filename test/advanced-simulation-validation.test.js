import test from "node:test";
import assert from "node:assert/strict";
import { runAdvancedSimulation } from "../server/services/advanced-simulation.service.js";
import { validateAdvancedSimulationResult } from "../server/services/advanced-simulation-validation.service.js";

const fixture = (id, date, status = "FT") => ({ fixture: { id, date, status: { short: status } }, teams: { home: { name: "A" }, away: { name: "B" } } });
const stats = (teamId, values) => [{ team: { id: teamId }, statistics: [
  ["Total Shots", values.shots], ["Shots on Goal", values.shotsOnGoal], ["Ball Possession", values.possession],
  ["Total passes", values.passes], ["Passes %", values.passAccuracy], ["Fouls", values.fouls],
  ["Yellow Cards", values.yellowCards], ["Red Cards", values.redCards], ["Offsides", values.offsides], ["Corner Kicks", values.corners]
].map(([type, value]) => ({ type, value })) }];

function scenarioDeps(homeValues, awayValues, count = 5) {
  const previous = {
    1: Array.from({ length: count }, (_, index) => fixture(100 + index, `2026-06-${25 - index}T10:00:00Z`)),
    2: Array.from({ length: count }, (_, index) => fixture(200 + index, `2026-06-${25 - index}T10:00:00Z`))
  };
  return {
    getPreviousFixtures: async (teamId) => previous[teamId] || [],
    getFixtureStatistics: async (fixtureId) => String(fixtureId).startsWith("1") ? stats(1, homeValues) : stats(2, awayValues)
  };
}

const strongHome = { shots: 16, shotsOnGoal: 7, possession: "60%", passes: 540, passAccuracy: "86%", fouls: 8, yellowCards: 1, redCards: 0, offsides: 2, corners: 7 };
const strongAway = { shots: 15, shotsOnGoal: 6, possession: "58%", passes: 520, passAccuracy: "85%", fouls: 8, yellowCards: 1, redCards: 0, offsides: 2, corners: 6 };
const weak = { shots: 6, shotsOnGoal: 1, possession: "39%", passes: 300, passAccuracy: "72%", fouls: 14, yellowCards: 3, redCards: 0, offsides: 1, corners: 2 };
const balanced = { shots: 10, shotsOnGoal: 3, possession: "50%", passes: 420, passAccuracy: "80%", fouls: 11, yellowCards: 2, redCards: 0, offsides: 1, corners: 4 };
const lowGoals = { shots: 5, shotsOnGoal: 1, possession: "50%", passes: 410, passAccuracy: "79%", fouls: 10, yellowCards: 1, redCards: 0, offsides: 1, corners: 2 };

async function simulate({ home = strongHome, away = weak, count = 5, dataset = {} } = {}) {
  return runAdvancedSimulation({
    teamA: { id: 1, name: "Local" },
    teamB: { id: 2, name: "Visitante" },
    fixtureDate: "2026-07-10T18:00:00Z",
    windowSize: 5,
    competition: dataset.fixture?.leagueName || "Copa Mundial FIFA",
    dataset: {
      fixture: { id: Math.floor(Math.random() * 1000000), home: "Local", away: "Visitante", leagueName: "Copa Mundial FIFA", leagueSlug: "world-cup", ...dataset.fixture },
      researchData: { odds: { markets: dataset.odds || [] }, xgXga: dataset.xgXga || { status: "partial" } },
      dataQuality: { score: dataset.quality ?? 68 },
      confirmed: { lineups: dataset.lineups || [] },
      poissonModel: dataset.poissonModel
    }
  }, scenarioDeps(home, away, count), { forceRefresh: true });
}

test("Fase 8 valida favorito local claro sin NaN ni probabilidades negativas", async () => {
  const result = await simulate({ home: strongHome, away: weak });
  assert.ok(result.finalProbabilities.homeWin > result.finalProbabilities.awayWin);
  assert.ok(["passed", "passed_with_warnings"].includes(result.validation.status));
  assert.equal(result.validation.checks.noNaNOrInfinity, true);
});

test("Fase 8 valida favorito visitante", async () => {
  const result = await simulate({ home: weak, away: strongAway });
  assert.ok(result.finalProbabilities.awayWin > result.finalProbabilities.homeWin);
  assert.ok(Math.abs(result.validation.checks.oneXTwoSumPct - 100) < 0.35);
});

test("Fase 8 conserva no_bet en partido equilibrado sin valor de mercado", async () => {
  const result = await simulate({ home: balanced, away: balanced });
  assert.equal(result.summary.decision, "no_bet");
  assert.ok(result.finalProbabilities.draw >= 20);
});

test("Fase 8 detecta escenario de pocos goles con lambdas bajas", async () => {
  const result = await simulate({ home: lowGoals, away: lowGoals });
  assert.ok(result.finalProbabilities.under25 > result.finalProbabilities.over25);
});

test("Fase 8 maneja datos incompletos con validacion y advertencias", async () => {
  const result = await simulate({ home: balanced, away: balanced, count: 2, dataset: { quality: 35, lineups: [] } });
  assert.ok(result.warnings.some((item) => /Muestra/.test(item)));
  assert.ok(["passed", "passed_with_warnings"].includes(result.validation.status));
});

test("Fase 8 marca torneo corto o Mundial con cautela", async () => {
  const result = await simulate({ dataset: { fixture: { leagueSlug: "world-cup", leagueName: "Copa Mundial FIFA" } } });
  assert.ok(result.warnings.some((item) => /Mundial|Torneo corto/.test(item)));
});

test("validador falla con suma 1X2 invalida y NaN", () => {
  const validation = validateAdvancedSimulationResult({
    finalProbabilities: { homeWin: 90, draw: 20, awayWin: 10 },
    dixonColes: { goalMatrix: [{ probability: Number.NaN }] },
    marketComparison: []
  });
  assert.equal(validation.status, "failed");
  assert.ok(validation.errors.length);
});
