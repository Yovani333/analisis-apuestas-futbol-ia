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

function fixtureWithStatus(id, teamId, opponentId, day, status) {
  const fixture = previousFixture(id, teamId, opponentId, day);
  fixture.fixture.status.short = status;
  return fixture;
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

test("partido programado con cinco partidos útiles produce histórico parcial de confianza media", async () => {
  const result = await getHistoricalEstimatedXgXga(input(5, 5));
  assert.equal(result.status, "partial");
  assert.equal(result.type, "historical_estimated");
  assert.equal(result.dataSource, "historical_api_estimate");
  assert.equal(result.calculationStatus, "estimated_from_previous_matches");
  assert.equal(result.modelVersion, HISTORICAL_MODEL_VERSION);
  assert.equal(result.homeTeam.sampleSize, 5);
  assert.equal(result.awayTeam.sampleSize, 5);
  assert.equal(result.homeTeam.diagnostics.attemptedFixtures, 5);
  assert.equal(result.homeTeam.diagnostics.usedFixtures, 5);
  assert.deepEqual(result.homeTeam.diagnostics.skippedFixtures, []);
  assert.ok(Number.isFinite(result.homeTeam.historicalEstimatedXGAvg));
  assert.ok(Number.isFinite(result.homeTeam.historicalEstimatedXGAAvg));
  assert.equal(result.confidence.label, "medium");
  assert.equal(result.sampleSizeHome, 5);
  assert.equal(result.sampleSizeAway, 5);
  assert.equal(result.homeXGHistoricalAverage, result.homeTeam.historicalEstimatedXGAvg);
  assert.equal(result.fixturesUsedHome.length, 5);
  assert.equal(result.homeTeam.calculation.recencyWeightingApplied, true);
  assert.ok(result.homeTeam.effectiveSampleSize < result.homeTeam.sampleSize);
  assert.equal(result.calculation.shrinkageApplied, false);
  assert.ok(result.homeTeam.optionalMissingFields.includes("dangerousAttacks"));
  assert.ok(!result.homeTeam.missingFields.includes("dangerousAttacks"));
  assert.match(result.confidence.notes.join(" "), /confiabilidad histórica es media/i);
  assert.match(result.warning, /No corresponde a xG oficial/);
});

test("aplica shrinkage solo cuando recibe una media de liga verificable", async () => {
  const result = await getHistoricalEstimatedXgXga(input(5, 5, { leagueBaseline: { xg: 1, xga: 1 }, priorStrength: 5 }));
  assert.equal(result.calculation.shrinkageApplied, true);
  assert.equal(result.homeTeam.calculation.shrinkageApplied, true);
  assert.ok(result.homeTeam.historicalEstimatedXGAvg < result.homeTeam.historicalEstimatedXGSimpleAvg);
});

test("seis partidos útiles producen una muestra histórica aceptable", async () => {
  const result = await getHistoricalEstimatedXgXga(input(6, 6, { limit: 10 }));
  assert.equal(result.status, "available");
  assert.equal(result.confidence.label, "high");
  assert.match(result.confidence.notes.join(" "), /muestra histórica es aceptable/i);
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
  assert.match(result.confidence.notes.join(" "), /No hay partidos anteriores/i);
});

test("ignora fixtures programados, pospuestos y cancelados del historial", async () => {
  const base = input(0, 0, { limit: 10 });
  base.homePreviousFixtures = [
    previousFixture(101, 1, 1101, 1),
    fixtureWithStatus(102, 1, 1102, 2, "NS"),
    fixtureWithStatus(103, 1, 1103, 3, "PST"),
    fixtureWithStatus(104, 1, 1104, 4, "CANC")
  ];
  base.awayPreviousFixtures = [
    previousFixture(201, 2, 1201, 1),
    fixtureWithStatus(202, 2, 1202, 2, "TBD")
  ];
  const result = await getHistoricalEstimatedXgXga(base);
  assert.equal(result.homeTeam.diagnostics.attemptedFixtures, 1);
  assert.equal(result.awayTeam.diagnostics.attemptedFixtures, 1);
  assert.equal(result.homeTeam.sampleSize, 1);
  assert.equal(result.awayTeam.sampleSize, 1);
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

test("limita la concurrencia al recopilar estadisticas y eventos historicos", async () => {
  let active = 0;
  let maximum = 0;
  const wrap = (loader) => async (fixtureId) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 3));
    try { return await loader(fixtureId); }
    finally { active -= 1; }
  };
  const loaders = createLoaders();
  const result = await getHistoricalEstimatedXgXga(input(6, 6, {
    limit: 10,
    getFixtureStatistics: wrap(loaders.getFixtureStatistics),
    getFixtureEvents: wrap(loaders.getFixtureEvents)
  }));
  assert.equal(result.homeTeam.sampleSize, 6);
  assert.equal(result.awayTeam.sampleSize, 6);
  assert.ok(maximum <= 8, `Se observaron ${maximum} solicitudes simultaneas`);
});

test("registra fallos de eventos sin descartar estadisticas utilizables", async () => {
  const result = await getHistoricalEstimatedXgXga(input(1, 1, {
    getFixtureEvents: async () => { const error = new Error("temporal"); error.code = "API_FOOTBALL_NETWORK_ERROR"; throw error; }
  }));
  assert.equal(result.homeTeam.sampleSize, 1);
  assert.equal(result.awayTeam.sampleSize, 1);
  assert.equal(result.homeTeam.diagnostics.eventsRequestFailures, 1);
  assert.equal(result.awayTeam.diagnostics.eventsRequestFailures, 1);
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
