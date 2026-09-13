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
