import test from "node:test";
import assert from "node:assert/strict";
import { preserveValidFixtureDataset } from "../server/services/api-football.service.js";
import { fixtureDatasetPersistenceInternals } from "../server/services/fixture-dataset-persistence.service.js";

test("merge seguro conserva datos validos cuando llega una respuesta parcial vacia", () => {
  const previous = {
    fixture: { id: 123, leagueId: 1, season: 2026 },
    confirmed: {
      odds: [{ market: "Match Winner", values: [{ value: "Home", odd: "1.90" }] }],
      events: [{ type: "Goal" }],
      statistics: [{ team: { id: 1 }, statistics: [{ type: "Total Shots", value: 12 }] }]
    },
    preMatch: { odds: [{ market: "Double Chance" }] },
    researchData: {
      odds: { status: "available", markets: [{ market: "Match Winner" }] },
      sourceCoverage: [{ moduleKey: "odds", status: "available" }]
    },
    marketAnalysis: [{ market: "Match Winner", selection: "Home" }]
  };
  const next = {
    fixture: { id: 123, leagueId: 1, season: 2026 },
    confirmed: { odds: [], events: [], statistics: [] },
    preMatch: { odds: [] },
    researchData: {
      odds: { status: "not_available", markets: [] },
      sourceCoverage: []
    },
    marketAnalysis: []
  };

  const merged = preserveValidFixtureDataset(previous, next, { reason: "test_refresh" });

  assert.equal(merged.confirmed.odds.length, 1);
  assert.equal(merged.confirmed.events.length, 1);
  assert.equal(merged.confirmed.statistics.length, 1);
  assert.equal(merged.preMatch.odds.length, 1);
  assert.equal(merged.researchData.odds.status, "available");
  assert.equal(merged.marketAnalysis.length, 1);
  assert.equal(merged.dataPreservation.preservedFields.length > 0, true);
  assert.match(merged.qualityAlerts.at(-1), /conserva la .ltima informaci.n v.lida/i);
});

test("cache persistente compacta el expediente sin guardar estadisticas pesadas de jugadores", () => {
  const compact = fixtureDatasetPersistenceInternals.compactDataset({
    source: "api-football",
    fetchedAt: "2026-07-15T10:00:00.000Z",
    fixture: { id: "1567824", status: "finished", leagueId: 1, season: 2026 },
    confirmed: {
      odds: [{ bookmaker: { name: "10Bet" } }],
      players: [{ player: { id: 1, name: "Jugador pesado" }, statistics: Array.from({ length: 50 }, (_, index) => ({ index })) }],
      events: [{ type: "Goal" }],
      statistics: [{ team: { id: 1 }, statistics: [{ type: "Total Shots", value: 12 }] }]
    },
    dataQuality: { score: 100, level: "Alta" },
    researchData: { totalConfidenceScore: 92, sourceCoverage: [{ moduleKey: "odds", status: "available" }] }
  });

  assert.equal(compact.fixture.id, "1567824");
  assert.equal(compact.confirmed.odds.length, 1);
  assert.equal(compact.confirmed.events.length, 1);
  assert.equal(compact.confirmed.players, undefined);
  assert.equal(compact.dataQuality.score, 100);
  assert.equal(fixtureDatasetPersistenceInternals.datasetBytes(compact) > 0, true);
});

test("cache persistente trata tabla ausente como degradacion segura", () => {
  assert.equal(fixtureDatasetPersistenceInternals.isMissingSchema(new Error("Could not find the table 'public.fixture_analysis_cache' in the schema cache")), true);
});
