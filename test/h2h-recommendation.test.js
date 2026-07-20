import test from "node:test";
import assert from "node:assert/strict";
import { evaluateH2HRecommendation } from "../public/h2h-recommendation.js";

const HOME = { id: 10, name: "Local FC" };
const AWAY = { id: 20, name: "Visitante FC" };
const CUTOFF = "2026-01-10T18:00:00Z";

function h2h(id, day, homeGoals, awayGoals, inverted = false, overrides = {}) {
  return {
    fixtureId: String(id),
    date: `2025-12-${String(day).padStart(2, "0")}T18:00:00Z`,
    statusShort: "FT",
    homeTeamId: inverted ? AWAY.id : HOME.id,
    homeTeam: inverted ? AWAY.name : HOME.name,
    awayTeamId: inverted ? HOME.id : AWAY.id,
    awayTeam: inverted ? HOME.name : AWAY.name,
    homeGoals,
    awayGoals,
    regulationHomeGoals: homeGoals,
    regulationAwayGoals: awayGoals,
    ...overrides
  };
}

function evaluate(matches, options = {}) {
  return evaluateH2HRecommendation({
    matches,
    currentHomeTeam: HOME,
    currentAwayTeam: AWAY,
    currentFixtureDate: CUTOFF,
    ...options
  });
}

test("sugiere victoria local solo con dominio claro del local en casa", () => {
  const result = evaluate([
    h2h(1, 30, 4, 1), h2h(2, 20, 1, 0), h2h(3, 10, 3, 2), h2h(4, 1, 2, 0)
  ]);
  assert.equal(result.recommendedSelection, "Gana Local FC");
  assert.equal(result.comparableHomeMatches, 4);
  assert.equal(result.homeSummary.weightedWinRatePct, 100);
});

test("sugiere victoria visitante solo con dominio claro fuera", () => {
  const result = evaluate([
    h2h(1, 30, 1, 4), h2h(2, 20, 0, 1), h2h(3, 10, 2, 3), h2h(4, 1, 0, 2)
  ]);
  assert.equal(result.recommendedSelection, "Gana Visitante FC");
  assert.equal(result.comparableAwayMatches, 4);
  assert.equal(result.awaySummary.weightedWinRatePct, 100);
});

test("Over 1.5 desplaza una tendencia de victoria menos estable", () => {
  const result = evaluate([
    h2h(1, 30, 2, 1), h2h(2, 27, 1, 2, true), h2h(3, 24, 2, 2), h2h(4, 21, 3, 1, true),
    h2h(5, 18, 1, 1), h2h(6, 15, 2, 1, true), h2h(7, 12, 1, 2), h2h(8, 9, 2, 2, true)
  ]);
  assert.equal(result.recommendedSelection, "Más de 1.5 goles");
  assert.equal(result.weightedRate, 100);
});

test("Under 3.5 prevalece cuando es el mercado más estable", () => {
  const result = evaluate([
    h2h(1, 30, 1, 0, true), h2h(2, 25, 1, 1), h2h(3, 20, 2, 1, true),
    h2h(4, 15, 0, 0), h2h(5, 10, 1, 0, true), h2h(6, 5, 2, 0)
  ]);
  assert.equal(result.recommendedSelection, "Menos de 3.5 goles");
  assert.equal(result.generalMetrics.under35.weightedRatePct, 100);
});

test("empates frecuentes favorecen doble oportunidad en vez de victoria", () => {
  const result = evaluate([
    h2h(1, 30, 4, 1), h2h(2, 20, 0, 0), h2h(3, 10, 3, 1), h2h(4, 1, 0, 0)
  ]);
  assert.equal(result.recommendedSelection, "Local FC o empate (1X)");
  assert.equal(result.homeSummary.draws, 2);
});

test("menos de tres partidos produce Sin pick H2H recomendado", () => {
  const result = evaluate([h2h(1, 30, 2, 0), h2h(2, 20, 1, 0)]);
  assert.equal(result.recommendedMarket, null);
  assert.match(result.explanation, /Menos de 3/i);
});

test("localías invertidas aportan a goles pero no a dominio local", () => {
  const result = evaluate([
    h2h(1, 30, 2, 1, true), h2h(2, 20, 3, 1, true), h2h(3, 10, 2, 2, true), h2h(4, 1, 2, 1)
  ]);
  assert.equal(result.comparableHomeMatches, 1);
  assert.equal(result.comparableAwayMatches, 1);
  assert.equal(result.recommendedSelection, "Más de 1.5 goles");
});

test("una tendencia antigua contradicha por los recientes no genera pick", () => {
  const result = evaluate([
    h2h(1, 30, 0, 0, true), h2h(2, 25, 1, 0, true), h2h(3, 20, 2, 1, true),
    h2h(4, 15, 3, 1, true), h2h(5, 10, 2, 1, true), h2h(6, 5, 4, 1, true)
  ]);
  assert.equal(result.recommendedMarket, null);
  assert.match(result.explanation, /Ninguna tendencia|empate técnico/i);
});

test("igualdad técnica entre mercados conservadores no fuerza recomendación", () => {
  const result = evaluate([
    h2h(1, 30, 1, 1, true), h2h(2, 25, 2, 0, true), h2h(3, 20, 1, 1, true),
    h2h(4, 15, 2, 0, true), h2h(5, 10, 1, 1, true), h2h(6, 5, 2, 0, true)
  ]);
  assert.equal(result.recommendedMarket, null);
  assert.match(result.explanation, /empate técnico/i);
});

test("duplicados contradictorios o marcadores inválidos bloquean el pick", () => {
  const result = evaluate([
    h2h(1, 30, 2, 0), h2h(1, 30, 0, 2), h2h(2, 20, 2, 0),
    h2h(3, 10, 2, 0), h2h(4, 1, null, 0)
  ]);
  assert.equal(result.recommendedMarket, null);
  assert.match(result.explanation, /duplicados|inválidos/i);
});

test("la misma entrada siempre produce exactamente la misma salida", () => {
  const matches = [h2h(1, 30, 2, 0), h2h(2, 20, 1, 0), h2h(3, 10, 3, 1), h2h(4, 1, 2, 0)];
  assert.deepEqual(evaluate(matches), evaluate(matches));
});

test("caso Lillestrøm vs Viking conserva IDs y distingue localías", () => {
  const lillestrøm = { id: 321, name: "Lillestrøm" };
  const viking = { id: 759, name: "Viking" };
  const matches = [
    { ...h2h(1164506, 30, 1, 4), date: "2024-09-29T15:00:00Z", homeTeamId: 321, homeTeam: "Lillestrøm", awayTeamId: 759, awayTeam: "Viking" },
    { ...h2h(1164379, 29, 1, 4, true), date: "2024-05-16T16:00:00Z", homeTeamId: 759, homeTeam: "Viking", awayTeamId: 321, awayTeam: "Lillestrøm" },
    { ...h2h(1001705, 28, 1, 3), date: "2023-08-13T15:00:00Z", homeTeamId: 321, homeTeam: "Lillestrøm", awayTeamId: 759, awayTeam: "Viking" },
    { ...h2h(1001575, 27, 2, 0, true), date: "2023-04-15T16:00:00Z", homeTeamId: 759, homeTeam: "Viking", awayTeamId: 321, awayTeam: "Lillestrøm" },
    { ...h2h(992111, 26, 2, 2, true), date: "2023-02-26T12:00:00Z", statusShort: "PEN", homeTeamId: 759, homeTeam: "Viking", awayTeamId: 321, awayTeam: "Lillestrøm" },
    { ...h2h(831203, 25, 0, 3, true), date: "2022-10-09T15:00:00Z", homeTeamId: 759, homeTeam: "Viking", awayTeamId: 321, awayTeam: "Lillestrøm" },
    { ...h2h(831101, 24, 0, 1), date: "2022-07-10T16:00:00Z", homeTeamId: 321, homeTeam: "Lillestrøm", awayTeamId: 759, awayTeam: "Viking" },
    { ...h2h(699344, 23, 5, 1, true), date: "2021-10-23T14:00:00Z", homeTeamId: 759, homeTeam: "Viking", awayTeamId: 321, awayTeam: "Lillestrøm" },
    { ...h2h(693689, 22, 1, 3), date: "2021-05-24T16:00:00Z", homeTeamId: 321, homeTeam: "Lillestrøm", awayTeamId: 759, awayTeam: "Viking" }
  ];
  const result = evaluateH2HRecommendation({ matches, currentHomeTeam: lillestrøm, currentAwayTeam: viking, currentFixtureDate: "2026-07-22T17:00:00Z" });
  assert.equal(result.sampleSize, 9);
  assert.equal(result.comparableHomeMatches, 4);
  assert.equal(result.comparableAwayMatches, 4);
  assert.equal(result.awaySummary.wins, 4);
  assert.equal(result.generalMetrics.over15.hits, 8);
  assert.equal(result.generalMetrics.over25.hits, 7);
  assert.equal(result.generalMetrics.under35.hits, 3);
  assert.equal(result.generalMetrics.bttsYes.hits, 6);
  assert.equal(result.recommendedSelection, "Más de 1.5 goles");
  assert.equal(result.weightedRate, 91.7);
  assert.match(result.explanation, /Gana Viking/);
});
