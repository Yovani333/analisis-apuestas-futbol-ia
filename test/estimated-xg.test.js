import test from "node:test";
import assert from "node:assert/strict";
import { normalizeNonNegativeNumber } from "../server/services/xg/xg-normalizer.js";
import { calculateEstimatedXG } from "../server/services/xg/estimated-xg-calculator.js";
import { buildEstimatedXgFromDataset, getEstimatedXgForFixture } from "../server/services/xg/estimated-xg.service.js";

function stats(teamId, name, values = {}) {
  const labels = {
    totalShots: "Total Shots", shotsOnGoal: "Shots on Goal", shotsOffGoal: "Shots off Goal",
    shotsInsideBox: "Shots insidebox", shotsOutsideBox: "Shots outsidebox", blockedShots: "Blocked Shots",
    cornerKicks: "Corner Kicks", ballPossession: "Ball Possession", goalkeeperSaves: "Goalkeeper Saves",
    dangerousAttacks: "Dangerous Attacks"
  };
  return { team: { id: teamId, name }, statistics: Object.entries(values).map(([key, value]) => ({ type: labels[key], value })) };
}

function dataset(homeValues, awayValues, events = []) {
  return {
    fetchedAt: "2026-06-22T12:00:00Z",
    fixture: { id: 100, homeTeamId: 1, awayTeamId: 2, home: "A", away: "B" },
    confirmed: { statistics: [stats(1, "A", homeValues), stats(2, "B", awayValues)], events },
    advancedFailures: { events: false }
  };
}

const complete = {
  totalShots: 12, shotsOnGoal: 5, shotsOffGoal: 4, shotsInsideBox: 8,
  shotsOutsideBox: 4, blockedShots: 3, cornerKicks: 6, ballPossession: "55%",
  goalkeeperSaves: 2, dangerousAttacks: 30
};

test("normaliza porcentajes, vacíos y rechaza valores negativos", () => {
  assert.equal(normalizeNonNegativeNumber("55%"), 55);
  assert.equal(normalizeNonNegativeNumber(""), null);
  assert.equal(normalizeNonNegativeNumber(-1), null);
});

test("partido en vivo con estadísticas completas calcula xG/xGA del fixture", () => {
  const live = dataset(complete, { ...complete, totalShots: 10, shotsOnGoal: 4 });
  live.fixture.status = "live";
  const result = buildEstimatedXgFromDataset(live);
  assert.equal(result.status, "available");
  assert.equal(result.type, "fixture_estimated");
  assert.equal(result.scope, "current_fixture");
  assert.equal(result.modelVersion, "fixture-estimated-xg-v2-shots-on-target");
  assert.equal(result.calculation.formula, "xG_est = shotsOnGoal * 0.30 + penalties * 0.46");
  assert.equal(result.homeTeam.estimatedXGA, result.awayTeam.estimatedXG);
  assert.equal(result.awayTeam.estimatedXGA, result.homeTeam.estimatedXG);
  assert.equal(result.confidence.label, "high");
  assert.deepEqual(result.diagnostics.statisticsAvailable, { home: true, away: true });
  assert.equal(result.diagnostics.eventsAvailable, true);
  assert.deepEqual(result.diagnostics.detectedPenalties, { home: 0, away: 0 });
  assert.match(result.warning, /No corresponde a xG oficial/);
});

test("partido finalizado con estadísticas completas conserva el cálculo del fixture", () => {
  const finished = dataset(complete, { ...complete, totalShots: 9, shotsOnGoal: 3 });
  finished.fixture.status = "finished";
  const result = buildEstimatedXgFromDataset(finished);
  assert.equal(result.status, "available");
  assert.equal(result.type, "fixture_estimated");
  assert.equal(result.scope, "current_fixture");
  assert.ok(Number.isFinite(result.awayTeam.estimatedXG));
});

test("mantiene disponible el cálculo cuando faltan variables descartadas por la nueva fórmula", () => {
  const partial = { totalShots: 10, shotsOnGoal: 4, cornerKicks: 5 };
  const result = buildEstimatedXgFromDataset(dataset(partial, partial));
  assert.equal(result.status, "available");
  assert.equal(result.confidence.label, "high");
  assert.ok(!result.confidence.missingFields.includes("shotsInsideBox"));
  assert.ok(result.confidence.optionalMissingFields.includes("shotsInsideBox"));
  assert.ok(result.confidence.optionalMissingFields.includes("dangerousAttacks"));
  assert.ok(!result.confidence.missingFields.includes("dangerousAttacks"));
});

test("no calcula si uno de los equipos no tiene estadísticas básicas", () => {
  const result = buildEstimatedXgFromDataset(dataset(complete, {}));
  assert.equal(result.status, "not_available");
  assert.equal(result.homeTeam.estimatedXG, null);
  assert.equal(result.awayTeam.estimatedXG, null);
});

test("no calcula estadísticas del mismo fixture antes del inicio", () => {
  const scheduled = dataset(complete, complete);
  scheduled.fixture.status = "scheduled";
  const result = buildEstimatedXgFromDataset(scheduled);
  assert.equal(result.status, "not_available");
  assert.equal(result.homeTeam.estimatedXG, null);
  assert.match(result.confidence.notes.join(" "), /antes de que comience/);
});

test("agrega solo 0.46 por penal para no duplicar el tiro a puerta ya contabilizado", () => {
  const base = calculateEstimatedXG({ totalShots: 10, shotsOnGoal: 4, penalties: 0 });
  const result = buildEstimatedXgFromDataset(dataset(
    { totalShots: 10, shotsOnGoal: 4 }, { totalShots: 10, shotsOnGoal: 4 },
    [{ team: { id: 1 }, type: "Goal", detail: "Penalty" }]
  ));
  assert.equal(result.homeTeam.rawStats.penalties, 1);
  assert.equal(result.diagnostics.detectedPenalties.home, 1);
  assert.equal(result.homeTeam.estimatedXG, Number((base + 0.46).toFixed(2)));
});

test("grandes ocasiones, corners y tiros totales no alteran el nuevo xG", () => {
  const base = calculateEstimatedXG({ totalShots: 10, shotsOnGoal: 4, bigChances: 0 });
  const withDiscardedVariables = calculateEstimatedXG({
    totalShots: 30, shotsOnGoal: 4, shotsInsideBox: 20, shotsOutsideBox: 10,
    blockedShots: 8, cornerKicks: 14, bigChances: 7, dangerousAttacks: 120
  });
  assert.equal(withDiscardedVariables, base);
  assert.equal(base, 1.2);
});

test("un penal fallado detectado aplica el ajuste conservador de 0.46", () => {
  const base = calculateEstimatedXG({ totalShots: 10, shotsOnGoal: 4, penalties: 0 });
  const result = buildEstimatedXgFromDataset(dataset(
    { totalShots: 10, shotsOnGoal: 4 }, { totalShots: 10, shotsOnGoal: 4 },
    [{ team: { id: 1 }, type: "Goal", detail: "Missed Penalty" }]
  ));
  assert.equal(result.homeTeam.rawStats.penalties, 1);
  assert.equal(result.homeTeam.estimatedXG, Number((base + 0.46).toFixed(2)));
});

test("sin eventos de penal agrega la nota obligatoria", () => {
  const result = buildEstimatedXgFromDataset(dataset(complete, complete, []));
  assert.equal(result.homeTeam.rawStats.penalties, 0);
  assert.match(result.confidence.notes.join(" "), /No se detectaron eventos de penal/);
});

test("tiros a puerta es el único campo estadístico obligatorio", () => {
  const sparse = { totalShots: 8, shotsOnGoal: 3 };
  const result = buildEstimatedXgFromDataset(dataset(sparse, sparse));
  assert.equal(result.status, "available");
  assert.equal(result.confidence.label, "high");
  assert.deepEqual(result.confidence.missingFields, []);
});

test("0 tiros produce xG 0 cuando no existen penales", () => {
  assert.equal(calculateEstimatedXG({ totalShots: 0, shotsOnGoal: 0, penalties: 0 }), 0);
});

test("no calcula usando únicamente goles cuando faltan tiros", () => {
  const result = buildEstimatedXgFromDataset(dataset({}, {}));
  assert.equal(result.status, "not_available");
  assert.equal(result.homeTeam.estimatedXG, null);
  assert.equal(result.awayTeam.estimatedXG, null);
});

test("estadísticas infladas generan una nota de revisión", () => {
  const inflated = { ...complete, totalShots: 100, shotsOnGoal: 50, shotsInsideBox: 70, dangerousAttacks: 200 };
  const result = buildEstimatedXgFromDataset(dataset(inflated, complete));
  assert.ok(result.homeTeam.estimatedXG > 6);
  assert.match(result.confidence.notes.join(" "), /superior a 4\.00/);
});

test("la función principal devuelve failed sin propagar detalles técnicos", async () => {
  const result = await getEstimatedXgForFixture(999, { loadFixtureDataset: async () => { throw new Error("secreto"); } });
  assert.equal(result.status, "failed");
  assert.doesNotMatch(JSON.stringify(result), /secreto/);
});
