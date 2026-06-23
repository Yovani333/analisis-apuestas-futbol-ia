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
  assert.equal(result.modelVersion, "fixture-estimated-xg-v1");
  assert.equal(result.homeTeam.estimatedXGA, result.awayTeam.estimatedXG);
  assert.equal(result.awayTeam.estimatedXGA, result.homeTeam.estimatedXG);
  assert.equal(result.confidence.label, "high");
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

test("marca parcial cuando faltan tiros dentro y fuera del área", () => {
  const partial = { totalShots: 10, shotsOnGoal: 4, cornerKicks: 5 };
  const result = buildEstimatedXgFromDataset(dataset(partial, partial));
  assert.equal(result.status, "partial");
  assert.equal(result.confidence.label, "medium");
  assert.ok(result.confidence.missingFields.includes("shotsInsideBox"));
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

test("suma 0.76 por un penal detectado", () => {
  const base = calculateEstimatedXG({ totalShots: 10, shotsOnGoal: 4, penalties: 0 });
  const result = buildEstimatedXgFromDataset(dataset(
    { totalShots: 10, shotsOnGoal: 4 }, { totalShots: 10, shotsOnGoal: 4 },
    [{ team: { id: 1 }, type: "Goal", detail: "Penalty" }]
  ));
  assert.equal(result.homeTeam.rawStats.penalties, 1);
  assert.equal(result.homeTeam.estimatedXG, Number((base + 0.76).toFixed(2)));
});

test("un penal fallado también suma 0.76 al xG estimado", () => {
  const base = calculateEstimatedXG({ totalShots: 10, shotsOnGoal: 4, penalties: 0 });
  const result = buildEstimatedXgFromDataset(dataset(
    { totalShots: 10, shotsOnGoal: 4 }, { totalShots: 10, shotsOnGoal: 4 },
    [{ team: { id: 1 }, type: "Goal", detail: "Missed Penalty" }]
  ));
  assert.equal(result.homeTeam.rawStats.penalties, 1);
  assert.equal(result.homeTeam.estimatedXG, Number((base + 0.76).toFixed(2)));
});

test("sin eventos de penal agrega la nota obligatoria", () => {
  const result = buildEstimatedXgFromDataset(dataset(complete, complete, []));
  assert.equal(result.homeTeam.rawStats.penalties, 0);
  assert.match(result.confidence.notes.join(" "), /No se detectaron eventos de penal/);
});

test("solo tiros totales y a puerta produce confianza baja", () => {
  const sparse = { totalShots: 8, shotsOnGoal: 3 };
  const result = buildEstimatedXgFromDataset(dataset(sparse, sparse));
  assert.equal(result.status, "partial");
  assert.equal(result.confidence.label, "low");
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
  assert.match(result.confidence.notes.join(" "), /superior a 6\.00/);
});

test("la función principal devuelve failed sin propagar detalles técnicos", async () => {
  const result = await getEstimatedXgForFixture(999, { loadFixtureDataset: async () => { throw new Error("secreto"); } });
  assert.equal(result.status, "failed");
  assert.doesNotMatch(JSON.stringify(result), /secreto/);
});
