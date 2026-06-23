import test from "node:test";
import assert from "node:assert/strict";
import {
  getHistoricalEstimatedXgXga,
  HISTORICAL_MODEL_VERSION,
  WORLD_CUP_XG_WARNING
} from "../server/services/xg/historical-estimated-xg.service.js";

const completeStats = {
  totalShots: 12,
  shotsOnGoal: 5,
  shotsOffGoal: 4,
  shotsInsideBox: 8,
  shotsOutsideBox: 4,
  blockedShots: 3,
  cornerKicks: 6,
  ballPossession: "55%",
  goalkeeperSaves: 2
};

const labels = {
  totalShots: "Total Shots",
  shotsOnGoal: "Shots on Goal",
  shotsOffGoal: "Shots off Goal",
  shotsInsideBox: "Shots insidebox",
  shotsOutsideBox: "Shots outsidebox",
  blockedShots: "Blocked Shots",
  cornerKicks: "Corner Kicks",
  ballPossession: "Ball Possession",
  goalkeeperSaves: "Goalkeeper Saves"
};

function statistics(teamId, name, values = completeStats) {
  return {
    team: { id: teamId, name },
    statistics: Object.entries(values).map(([key, value]) => ({ type: labels[key], value }))
  };
}

function previousFixture(id, teamId, opponentId, day) {
  return {
    fixture: { id, date: `2026-05-${String(day).padStart(2, "0")}T20:00:00Z`, status: { short: "FT" } },
    teams: {
      home: { id: teamId, name: `Equipo ${teamId}` },
      away: { id: opponentId, name: `Rival ${opponentId}` }
    }
  };
}

function createLoaders() {
  return {
    getFixtureStatistics: async (fixtureId) => {
      const trackedId = Number(fixtureId) < 200 ? 1 : 2;
      const opponentId = Number(fixtureId) + 1000;
      return [
        statistics(trackedId, `Equipo ${trackedId}`),
        statistics(opponentId, `Rival ${opponentId}`, { ...completeStats, totalShots: 9, shotsOnGoal: 3 })
      ];
    },
    getFixtureEvents: async () => []
  };
}

function input(homeCount, awayCount, options = {}) {
  const loaders = createLoaders();
  return {
    fixtureId: "999",
    fixtureDate: "2026-06-20T20:00:00Z",
    homeTeam: { id: 1, name: "Equipo 1" },
    awayTeam: { id: 2, name: "Equipo 2" },
    homePreviousFixtures: Array.from({ length: homeCount }, (_, index) => previousFixture(100 + index, 1, 1100 + index, index + 1)),
    awayPreviousFixtures: Array.from({ length: awayCount }, (_, index) => previousFixture(200 + index, 2, 1200 + index, index + 1)),
    ...loaders,
    ...options
  };
}

test("partido programado con cinco partidos útiles produce histórico disponible", async () => {
  const result = await getHistoricalEstimatedXgXga(input(5, 5));
  assert.equal(result.status, "available");
  assert.equal(result.type, "historical_estimated");
  assert.equal(result.modelVersion, HISTORICAL_MODEL_VERSION);
  assert.equal(result.homeTeam.sampleSize, 5);
  assert.equal(result.awayTeam.sampleSize, 5);
  assert.equal(result.homeTeam.diagnostics.attemptedFixtures, 5);
  assert.equal(result.homeTeam.diagnostics.usedFixtures, 5);
  assert.deepEqual(result.homeTeam.diagnostics.skippedFixtures, []);
  assert.ok(Number.isFinite(result.homeTeam.historicalEstimatedXGAvg));
  assert.ok(Number.isFinite(result.homeTeam.historicalEstimatedXGAAvg));
  assert.equal(result.confidence.label, "high");
  assert.match(result.warning, /No corresponde a xG oficial/);
});

test("una sola observación útil conserva confianza baja", async () => {
  const result = await getHistoricalEstimatedXgXga(input(1, 1));
  assert.equal(result.status, "partial");
  assert.equal(result.confidence.label, "low");
  assert.ok(result.confidence.score < 50);
  assert.equal(result.homeTeam.sampleSize, 1);
});

test("sin estadísticas anteriores no calcula valores", async () => {
  const result = await getHistoricalEstimatedXgXga(input(0, 0));
  assert.equal(result.status, "not_available");
  assert.equal(result.homeTeam.historicalEstimatedXGAvg, null);
  assert.equal(result.awayTeam.historicalEstimatedXGAAvg, null);
  assert.equal(result.confidence.label, "not_available");
});

test("conserva el motivo cuando falla una consulta histórica", async () => {
  const result = await getHistoricalEstimatedXgXga(input(1, 1, {
    getFixtureStatistics: async () => { throw new Error("límite"); }
  }));
  assert.equal(result.status, "not_available");
  assert.equal(result.homeTeam.diagnostics.attemptedFixtures, 1);
  assert.equal(result.homeTeam.diagnostics.usedFixtures, 0);
  assert.equal(result.homeTeam.diagnostics.skippedFixtures[0].reason, "statistics_request_failed");
  assert.equal(result.awayTeam.diagnostics.skippedFixtures[0].reason, "statistics_request_failed");
  assert.doesNotMatch(JSON.stringify(result), /límite/);
});

test("los porcentajes string se normalizan dentro de la muestra", async () => {
  const result = await getHistoricalEstimatedXgXga(input(1, 1));
  assert.equal(result.homeTeam.fixturesUsed.length, 1);
  assert.ok(Number.isFinite(result.homeTeam.historicalEstimatedXGAvg));
});

test("Mundial con muestra limitada agrega advertencia y mantiene confianza baja", async () => {
  const result = await getHistoricalEstimatedXgXga(input(2, 2, { worldCup: true }));
  assert.equal(result.confidence.label, "low");
  assert.ok(result.confidence.score < 40);
  assert.match(result.warning, new RegExp(WORLD_CUP_XG_WARNING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
