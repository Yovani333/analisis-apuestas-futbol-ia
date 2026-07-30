import test from "node:test";
import assert from "node:assert/strict";
import { calculateYellowCardsModel } from "../server/services/yellow-cards-model.service.js";

function record(id, forCards, againstCards, competition = "Liga") {
  return {
    fixtureId: String(id),
    date: `2026-07-${10 - id}`,
    opponent: `Rival ${id}`,
    venue: id % 2 ? "home" : "away",
    competition,
    competitionType: "League",
    cardStats: { yellowCardsFor: forCards, yellowCardsAgainst: againstCards }
  };
}

function dataset(homeRecords, awayRecords) {
  return {
    fixture: { id: 100, home: "Local", away: "Visitante" },
    historicalEstimatedXg: {
      homeTeam: { fixturesUsed: homeRecords },
      awayTeam: { fixturesUsed: awayRecords }
    }
  };
}

test("calcula posibles tarjetas amarillas con muestra oficial de ambos equipos", () => {
  const result = calculateYellowCardsModel(dataset(
    [record(1, 2, 3), record(2, 1, 2), record(3, 3, 2), record(4, 2, 1), record(5, 2, 2)],
    [record(6, 3, 2), record(7, 2, 2), record(8, 4, 3), record(9, 2, 1), record(10, 3, 2)]
  ));
  assert.equal(result.status, "available");
  assert.equal(result.projection.expectedTotal > 0, true);
  assert.match(result.projection.suggestedRange, /^\d+-\d+$/);
  assert.equal(result.teams.home.useful, 5);
  assert.equal(result.teams.away.useful, 5);
});

test("no inventa tarjetas cuando falta Yellow Cards completo", () => {
  const result = calculateYellowCardsModel(dataset(
    [record(1, 2, null), record(2, 1, null)],
    [record(6, null, 2), record(7, null, 2)]
  ));
  assert.equal(result.status, "not_available");
  assert.equal(result.projection, null);
  assert.match(result.warning, /faltan partidos oficiales/i);
});

test("excluye amistosos de la muestra de tarjetas", () => {
  const friendly = record(1, 5, 5, "Friendly");
  friendly.competitionType = "Friendly";
  const result = calculateYellowCardsModel(dataset(
    [friendly, record(2, 1, 2), record(3, 2, 1), record(4, 2, 2)],
    [record(5, 1, 1), record(6, 2, 2), record(7, 2, 3)]
  ));
  assert.equal(result.status, "partial");
  assert.equal(result.teams.home.excludedFriendlies, 1);
  assert.equal(result.teams.home.useful, 3);
  assert.ok(result.warnings.some((item) => /Muestra menor/.test(item)));
});
