import test from "node:test";
import assert from "node:assert/strict";
import { calculateVenueFormSignal } from "../public/venue-form-signal.js";

const match = (id, result, venue = "Local", competitionId = 1) => ({
  fixtureId: id,
  date: `2026-09-${String(10 - Number(id)).padStart(2, "0")}`,
  competition: competitionId === 1 ? "Liga Uno" : "Copa Dos",
  competitionId,
  venue,
  result
});

const HOME = { id: 10, name: "Local FC" };
const AWAY = { id: 20, name: "Visitante FC" };
const h2h = (id, homeGoals, awayGoals, overrides = {}) => ({
  fixtureId: `h${id}`,
  date: `2026-08-${String(20 - id).padStart(2, "0")}T18:00:00Z`,
  statusShort: "FT",
  homeTeamId: HOME.id,
  homeTeam: HOME.name,
  awayTeamId: AWAY.id,
  awayTeam: AWAY.name,
  homeGoals,
  awayGoals,
  regulationHomeGoals: homeGoals,
  regulationAwayGoals: awayGoals,
  leagueId: 1,
  leagueName: "Liga Uno",
  ...overrides
});

const signalContext = (overrides = {}) => ({
  side: "home",
  leagueId: 1,
  leagueName: "Liga Uno",
  competitionType: "league",
  currentFixtureId: "target",
  currentFixtureDate: "2026-09-10T18:00:00Z",
  currentHomeTeam: HOME,
  currentAwayTeam: AWAY,
  ...overrides
});

test("marca verde una tendencia local ganadora de la misma liga", () => {
  const result = calculateVenueFormSignal([match(1, "W"), match(2, "W"), match(3, "D")], { side: "home", leagueId: 1, leagueName: "Liga Uno", competitionType: "league" });
  assert.equal(result.signal, "positive");
  assert.equal(result.sampleSize, 3);
});

test("marca rojo una tendencia visitante perdedora", () => {
  const rows = [match(1, "L", "Visitante"), match(2, "L", "Visitante"), match(3, "D", "Visitante")];
  const result = calculateVenueFormSignal(rows, { side: "away", leagueId: 1, leagueName: "Liga Uno", competitionType: "league" });
  assert.equal(result.signal, "negative");
});

test("no mezcla localía contraria ni otra competición", () => {
  const rows = [match(1, "W"), match(2, "W", "Visitante"), match(3, "W", "Local", 2), match(4, "L")];
  const result = calculateVenueFormSignal(rows, { side: "home", leagueId: 1, leagueName: "Liga Uno", competitionType: "league" });
  assert.equal(result.signal, "none");
  assert.equal(result.sampleSize, 2);
});

test("una copa exige cuatro partidos comparables", () => {
  const rows = [match(1, "W"), match(2, "W"), match(3, "W")];
  const result = calculateVenueFormSignal(rows, { side: "home", leagueId: 1, leagueName: "Liga Uno", competitionType: "cup" });
  assert.equal(result.status, "insufficient");
  assert.equal(result.minimumSample, 4);
});

test("empates frecuentes conservan una lectura neutral", () => {
  const result = calculateVenueFormSignal([match(1, "D"), match(2, "D"), match(3, "W"), match(4, "L")], { side: "home", leagueId: 1, leagueName: "Liga Uno" });
  assert.equal(result.signal, "none");
  assert.equal(result.status, "neutral");
});

test("el H2H comparable confirma la señal sin superar el 25 por ciento", () => {
  const result = calculateVenueFormSignal(
    [match(1, "W"), match(2, "W"), match(3, "D")],
    signalContext({ h2hMatches: [h2h(1, 2, 0), h2h(2, 1, 0), h2h(3, 2, 1)] })
  );
  assert.equal(result.signal, "positive");
  assert.equal(result.h2hApplied, true);
  assert.deepEqual(result.weights, { venue: 0.75, h2h: 0.25 });
  assert.equal(result.h2hEffect, "confirms");
});

test("un H2H contrario puede llevar una señal limítrofe a neutral pero no invertirla", () => {
  const result = calculateVenueFormSignal(
    [match(1, "W"), match(2, "W"), match(3, "D")],
    signalContext({ h2hMatches: [h2h(1, 0, 2), h2h(2, 0, 1), h2h(3, 1, 2)] })
  );
  assert.equal(result.h2hEffect, "contradicts");
  assert.equal(result.signal, "none");
});

test("el contexto H2H ignora otra competición, futuros, el fixture objetivo y duplicados", () => {
  const valid = h2h(1, 2, 0);
  const result = calculateVenueFormSignal(
    [match(1, "W"), match(2, "W"), match(3, "D")],
    signalContext({ h2hMatches: [
      valid,
      { ...valid },
      h2h(2, 2, 0, { leagueId: 2, leagueName: "Copa Dos" }),
      h2h(3, 2, 0, { fixtureId: "target" }),
      h2h(4, 2, 0, { date: "2026-10-01T18:00:00Z" })
    ] })
  );
  assert.equal(result.h2hApplied, false);
  assert.equal(result.h2hSampleSize, 0);
  assert.equal(result.signal, "positive");
});

test("un marcador H2H nulo se descarta y no se convierte en cero", () => {
  const result = calculateVenueFormSignal(
    [match(1, "W"), match(2, "W"), match(3, "D")],
    signalContext({ h2hMatches: [
      h2h(1, null, null, { regulationHomeGoals: null, regulationAwayGoals: null }),
      h2h(2, 2, 0),
      h2h(3, 1, 0)
    ] })
  );
  assert.equal(result.h2hApplied, false);
  assert.equal(result.signal, "positive");
});

test("el H2H exige el mismo rol visitante y los IDs exactos", () => {
  const result = calculateVenueFormSignal(
    [match(1, "L", "Visitante"), match(2, "L", "Visitante"), match(3, "D", "Visitante")],
    signalContext({ side: "away", h2hMatches: [h2h(1, 2, 0), h2h(2, 1, 0), h2h(3, 3, 1)] })
  );
  assert.equal(result.h2hApplied, true);
  assert.equal(result.h2hEffect, "confirms");
  assert.equal(result.signal, "negative");
});
