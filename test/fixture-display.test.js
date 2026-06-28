import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeFavorite,
  normalizeFixture,
  searchFixtures,
  shouldLoadCurrentFixtureData
} from "../server/services/api-football.service.js";

const league = {
  slug: "world-cup", name: "Copa Mundial FIFA", countryLabel: "Mundial"
};

function providerFixture(status = "NS") {
  return {
    fixture: {
      id: 77, date: "2026-06-22T02:00:00+00:00", status: { short: status, elapsed: status === "2H" ? 73 : null },
      venue: { name: "Estadio", city: "Los Ángeles" }
    },
    league: { id: 1, season: 2026 },
    teams: {
      home: { id: 10, name: "Equipo Uno", logo: "https://media.api-sports.io/football/teams/10.png" },
      away: { id: 20, name: "Equipo Dos", logo: "https://media.api-sports.io/football/teams/20.png" }
    },
    goals: { home: 2, away: 1 }
  };
}

test("convierte fecha y hora UTC al horario del Pacífico", () => {
  const fixture = normalizeFixture(providerFixture(), league);
  assert.equal(fixture.date, "2026-06-21");
  assert.equal(fixture.time, "19:00");
  assert.equal(fixture.timezone, "America/Los_Angeles");
  assert.equal(fixture.neutralVenue, true);
  assert.match(fixture.homeLogo, /teams\/10\.png$/);
  assert.match(fixture.awayLogo, /teams\/20\.png$/);
});

test("normaliza marcador y estado en vivo", () => {
  const fixture = normalizeFixture(providerFixture("2H"), league);
  assert.equal(fixture.status, "live");
  assert.equal(fixture.statusLabel, "En vivo");
  assert.equal(fixture.elapsed, 73);
  assert.deepEqual(fixture.score, { home: 2, away: 1 });
});

test("marca como favorito únicamente al equipo identificado por API-Football", () => {
  const favorite = normalizeFavorite([{ predictions: { winner: { id: 20, name: "Equipo Dos", comment: "Win or draw" }, percent: { home: "28%", draw: "31%", away: "41%" } } }], {
    homeTeamId: 10, home: "Equipo Uno", awayTeamId: 20, away: "Equipo Dos"
  });
  assert.equal(favorite.teamId, 20);
  assert.equal(favorite.percent, 41);
  assert.deepEqual(favorite.probabilities, { home: 28, draw: 31, away: 41 });
  assert.equal(favorite.market, "1X2");
  assert.match(favorite.note, /local, empate y visitante/i);
});

test("no fuerza un favorito de equipo cuando el empate tiene la mayor probabilidad", () => {
  const favorite = normalizeFavorite([{ predictions: { winner: { id: 10, name: "Equipo Uno" }, percent: { home: "33%", draw: "38%", away: "29%" } } }], {
    homeTeamId: 10, home: "Equipo Uno", awayTeamId: 20, away: "Equipo Dos"
  });
  assert.equal(favorite, null);
});

test("la búsqueda conserva todos los partidos y respeta un rango de un día", async () => {
  const calls = [];
  const request = async (path, params) => {
    calls.push({ path, params });
    return Array.from({ length: 8 }, (_, index) => ({
      ...providerFixture(),
      fixture: { ...providerFixture().fixture, id: 100 + index, date: `2026-06-24T${String(10 + index).padStart(2, "0")}:00:00Z` }
    }));
  };
  const fixtures = await searchFixtures({
    leagues: ["world-cup"], season: "2026", dateFrom: "2026-06-24", dateTo: "2026-06-24", status: "all"
  }, {
    request,
    leagueResolver: async () => ({ ...league, apiId: 1, seasons: [] })
  });

  assert.equal(fixtures.length, 8);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/fixtures");
  assert.equal(calls[0].params.from, "2026-06-24");
  assert.equal(calls[0].params.to, "2026-06-24");
});

test("la búsqueda envía completo un rango de varios días sin usar OpenAI", async () => {
  const calls = [];
  await searchFixtures({
    leagues: ["world-cup"], season: "2026", dateFrom: "2026-06-24", dateTo: "2026-06-27", status: "scheduled"
  }, {
    request: async (path, params) => {
      calls.push({ path, params });
      return [];
    },
    leagueResolver: async () => ({ ...league, apiId: 1, seasons: [] })
  });

  assert.deepEqual(calls.map((call) => call.path), ["/fixtures"]);
  assert.equal(calls[0].params.from, "2026-06-24");
  assert.equal(calls[0].params.to, "2026-06-27");
  assert.equal(calls[0].params.status, "NS-TBD");
});

test("la búsqueda en vivo envía estados activos a API-Football", async () => {
  const calls = [];
  await searchFixtures({ leagues: ["world-cup"], season: "2026", dateFrom: "2026-06-28", dateTo: "2026-06-28", status: "live" }, {
    request: async (path, params) => { calls.push({ path, params }); return []; },
    leagueResolver: async () => ({ ...league, apiId: 1, seasons: [] })
  });
  assert.match(calls[0].params.status, /1H/);
  assert.match(calls[0].params.status, /2H/);
});

test("solo carga estadísticas del fixture actual cuando ya inició", () => {
  assert.equal(shouldLoadCurrentFixtureData("NS"), false);
  assert.equal(shouldLoadCurrentFixtureData("TBD"), false);
  assert.equal(shouldLoadCurrentFixtureData("2H"), true);
  assert.equal(shouldLoadCurrentFixtureData("FT"), true);
});
