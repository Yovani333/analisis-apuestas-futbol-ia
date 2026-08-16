import test from "node:test";
import assert from "node:assert/strict";
import { calculateGoalHalfModel } from "../server/services/goal-half-model.service.js";

const targetFixture = {
  id: 900,
  utcDateTime: "2026-07-30T20:00:00Z",
  homeTeamId: 1,
  awayTeamId: 2,
  leagueId: 10,
  leagueName: "Liga Oficial",
  home: "Local",
  away: "Visitante"
};

function fixture(id, teamId, opponentId, date, home = true, status = "FT") {
  return {
    fixture: { id, date, status: { short: status } },
    league: { id: 10, name: "Liga Oficial", type: "League" },
    teams: home
      ? { home: { id: teamId, name: `Equipo ${teamId}` }, away: { id: opponentId, name: `Rival ${opponentId}` } }
      : { home: { id: opponentId, name: `Rival ${opponentId}` }, away: { id: teamId, name: `Equipo ${teamId}` } }
  };
}

function goal(teamId, elapsed, detail = "Normal Goal") {
  return { type: "Goal", detail, time: { elapsed }, team: { id: teamId } };
}

function dependencies(homeFixtures, awayFixtures, eventsByFixture) {
  return {
    getPreviousFixtures: async (teamId) => teamId === 1 ? homeFixtures : awayFixtures,
    getFixtureEvents: async (fixtureId) => eventsByFixture[String(fixtureId)] || []
  };
}

test("detecta segunda mitad como tendencia cuando concentra mas goles recientes", async () => {
  const homeFixtures = [1, 2, 3, 4, 5].map((id, index) => fixture(id, 1, 10 + id, `2026-07-${25 - index}T20:00:00Z`));
  const awayFixtures = [6, 7, 8, 9, 10].map((id, index) => fixture(id, 2, 20 + id, `2026-07-${25 - index}T20:00:00Z`, false));
  const events = Object.fromEntries([...homeFixtures, ...awayFixtures].map((row) => [String(row.fixture.id), [goal(99, 63), goal(99, 78)]]));
  const result = await calculateGoalHalfModel(targetFixture, dependencies(homeFixtures, awayFixtures, events));
  assert.equal(result.status, "available");
  assert.equal(result.projection.selectedHalf, "Segunda mitad");
  assert.equal(result.projection.secondHalfSupport, 100);
  assert.equal(result.teams.home.useful, 5);
  assert.equal(result.teams.away.useful, 5);
  assert.equal(result.intervalComparison.rows.length, 6);
});

test("compara los intervalos de gol desde la perspectiva de ambos equipos", async () => {
  const homeFixtures = [1, 2, 3, 4, 5].map((id, index) => fixture(id, 1, 10 + id, `2026-07-${25 - index}T20:00:00Z`));
  const awayFixtures = [6, 7, 8, 9, 10].map((id, index) => fixture(id, 2, 20 + id, `2026-07-${25 - index}T20:00:00Z`, false));
  const events = {};
  homeFixtures.forEach((row) => { events[row.fixture.id] = [goal(1, 12), goal(99, 55)]; });
  awayFixtures.forEach((row) => { events[row.fixture.id] = [goal(2, 68), goal(99, 82)]; });
  const result = await calculateGoalHalfModel(targetFixture, dependencies(homeFixtures, awayFixtures, events));
  const early = result.intervalComparison.rows.find((row) => row.key === "0_15");
  const late = result.intervalComparison.rows.find((row) => row.key === "61_75");
  assert.equal(early.homeGoals, 5);
  assert.equal(early.awayGoals, 0);
  assert.equal(late.homeGoals, 0);
  assert.equal(late.awayGoals, 5);
  assert.equal(early.homeWeightedRate, 100);
  assert.equal(late.awayWeightedRate, 100);
  assert.equal(result.intervalComparison.strongestHalf, "Primera mitad");
  assert.equal(result.intervalComparison.strongestHalfSelection, "Gol en el primer tiempo");
});

test("traduce el rango conjunto tardio a gol en el segundo tiempo", async () => {
  const homeFixtures = [1, 2, 3, 4, 5].map((id, index) => fixture(id, 1, 10 + id, `2026-07-${25 - index}T20:00:00Z`));
  const awayFixtures = [6, 7, 8, 9, 10].map((id, index) => fixture(id, 2, 20 + id, `2026-07-${25 - index}T20:00:00Z`, false));
  const events = {};
  homeFixtures.forEach((row) => { events[row.fixture.id] = [goal(1, 78)]; });
  awayFixtures.forEach((row) => { events[row.fixture.id] = [goal(2, 82)]; });

  const result = await calculateGoalHalfModel(targetFixture, dependencies(homeFixtures, awayFixtures, events));

  assert.equal(result.intervalComparison.strongestInterval, "76-90+");
  assert.equal(result.intervalComparison.strongestHalf, "Segunda mitad");
  assert.equal(result.intervalComparison.strongestHalfSelection, "Gol en el segundo tiempo");
});

test("no recomienda cuando algun equipo tiene menos de tres partidos previos oficiales", async () => {
  const homeFixtures = [fixture(1, 1, 11, "2026-07-25T20:00:00Z"), fixture(2, 1, 12, "2026-07-24T20:00:00Z")];
  const awayFixtures = [fixture(6, 2, 21, "2026-07-25T20:00:00Z"), fixture(7, 2, 22, "2026-07-24T20:00:00Z"), fixture(8, 2, 23, "2026-07-23T20:00:00Z")];
  const result = await calculateGoalHalfModel(targetFixture, dependencies(homeFixtures, awayFixtures, {}));
  assert.equal(result.status, "not_available");
  assert.match(result.warning, /al menos 3 partidos/i);
});

test("gol por mitad excluye fixtures de otra competicion", async () => {
  const other = fixture(99, 1, 90, "2026-07-26T20:00:00Z");
  other.league = { id: 20, name: "Otra Copa", type: "Cup" };
  const homeFixtures = [other, fixture(1, 1, 11, "2026-07-25T20:00:00Z"), fixture(2, 1, 12, "2026-07-24T20:00:00Z"), fixture(3, 1, 13, "2026-07-23T20:00:00Z")];
  const awayFixtures = [6, 7, 8].map((id, index) => fixture(id, 2, 20 + id, `2026-07-${25 - index}T20:00:00Z`, false));
  const events = Object.fromEntries([...homeFixtures, ...awayFixtures].map((row) => [String(row.fixture.id), [goal(99, 70)]]));
  const result = await calculateGoalHalfModel(targetFixture, dependencies(homeFixtures, awayFixtures, events));
  assert.equal(result.teams.home.useful, 3);
  assert.equal(result.teams.home.excludedOtherCompetitions, 1);
  assert.ok(result.warnings.some((item) => /otras competiciones/.test(item)));
});

test("ignora prorroga, penales y el fixture objetivo dentro de la muestra", async () => {
  const homeFixtures = [
    fixture(900, 1, 99, "2026-07-29T20:00:00Z"),
    fixture(1, 1, 11, "2026-07-25T20:00:00Z", true, "AET"),
    fixture(2, 1, 12, "2026-07-24T20:00:00Z"),
    fixture(3, 1, 13, "2026-07-23T20:00:00Z")
  ];
  const awayFixtures = [6, 7, 8].map((id, index) => fixture(id, 2, 20 + id, `2026-07-${25 - index}T20:00:00Z`, false));
  const events = {
    1: [goal(1, 44), goal(1, 105), goal(1, 120, "Penalty Shootout")],
    2: [goal(1, 50)],
    3: [goal(1, 46)],
    6: [goal(2, 70)],
    7: [goal(2, 72)],
    8: [goal(2, 75)]
  };
  const result = await calculateGoalHalfModel(targetFixture, dependencies(homeFixtures, awayFixtures, events));
  assert.equal(result.teams.home.useful, 3);
  assert.equal(result.teams.home.fixturesUsed.some((row) => row.fixtureId === "900"), false);
  assert.equal(result.teams.home.firstHalfGoals, 1);
  assert.equal(result.teams.home.secondHalfGoals, 2);
});
