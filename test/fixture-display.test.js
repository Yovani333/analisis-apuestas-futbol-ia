import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFavorite, normalizeFixture } from "../server/services/api-football.service.js";

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
    teams: { home: { id: 10, name: "Equipo Uno" }, away: { id: 20, name: "Equipo Dos" } },
    goals: { home: 2, away: 1 }
  };
}

test("convierte fecha y hora UTC al horario del Pacífico", () => {
  const fixture = normalizeFixture(providerFixture(), league);
  assert.equal(fixture.date, "2026-06-21");
  assert.equal(fixture.time, "19:00");
  assert.equal(fixture.timezone, "America/Los_Angeles");
  assert.equal(fixture.neutralVenue, true);
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
    homeTeamId: 10, awayTeamId: 20
  });
  assert.equal(favorite.teamId, 20);
  assert.equal(favorite.percent, 41);
  assert.match(favorite.note, /no representa una votación pública/i);
});
