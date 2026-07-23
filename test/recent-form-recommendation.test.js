import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRecentFormRecommendation } from "../public/recent-form-recommendation.js";

const CUTOFF = "2026-08-01T18:00:00Z";

function match(id, day, goalsFor, goalsAgainst, venue = "Local", overrides = {}) {
  return {
    fixtureId: String(id),
    date: `2026-07-${String(day).padStart(2, "0")}T18:00:00Z`,
    statusShort: "FT",
    venue,
    goalsFor,
    goalsAgainst,
    result: goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D",
    opponent: `Rival ${id}`,
    ...overrides
  };
}

function evaluate(homeMatches, awayMatches, overrides = {}) {
  return evaluateRecentFormRecommendation({
    homeMatches,
    awayMatches,
    homeTeamName: "Local FC",
    awayTeamName: "Visitante FC",
    currentFixtureDate: CUTOFF,
    ...overrides
  });
}

const homeDominant = () => [
  match(1, 30, 4, 1, "Local"), match(2, 26, 2, 0, "Visitante"), match(3, 22, 3, 1, "Local"),
  match(4, 18, 1, 0, "Visitante"), match(5, 14, 3, 0, "Local")
];
const awayWeak = () => [
  match(11, 29, 0, 2, "Visitante"), match(12, 25, 1, 2, "Local"), match(13, 21, 0, 3, "Visitante"),
  match(14, 17, 1, 1, "Local"), match(15, 13, 0, 1, "Visitante")
];

test("detecta dominio claro del local", () => {
  const result = evaluate(homeDominant(), awayWeak());
  assert.equal(result.recommendedSelection, "Gana Local FC");
  assert.equal(result.homeWeightedWinRate, 100);
});

test("detecta dominio claro del visitante", () => {
  const result = evaluate(awayWeak().map((row) => ({ ...row, venue: row.venue === "Local" ? "Visitante" : "Local" })),
    homeDominant().map((row) => ({ ...row, fixtureId: `a${row.fixtureId}`, venue: row.venue === "Local" ? "Visitante" : "Local" })));
  assert.equal(result.recommendedSelection, "Gana Visitante FC");
  assert.equal(result.awayWeightedWinRate, 100);
});

test("prioriza doble oportunidad local con no derrota estable", () => {
  const home = [match(1, 30, 2, 2), match(2, 26, 1, 0), match(3, 22, 0, 0), match(4, 18, 2, 2), match(5, 14, 0, 1)];
  const away = [match(11, 29, 0, 0, "Visitante"), match(12, 25, 2, 2), match(13, 21, 0, 4, "Visitante"), match(14, 17, 1, 1), match(15, 13, 0, 4, "Visitante")];
  const result = evaluate(home, away);
  assert.equal(result.recommendedSelection, "Local FC o empate (1X)");
});

test("prioriza doble oportunidad visitante con no derrota estable", () => {
  const home = [match(1, 30, 0, 0), match(2, 26, 2, 2), match(3, 22, 0, 4), match(4, 18, 1, 1), match(5, 14, 0, 4)];
  const away = [match(11, 29, 2, 2, "Visitante"), match(12, 25, 1, 0), match(13, 21, 0, 0, "Visitante"), match(14, 17, 2, 2), match(15, 13, 0, 1, "Visitante")];
  const result = evaluate(home, away);
  assert.equal(result.recommendedSelection, "Visitante FC o empate (X2)");
});

test("Over 1.5 prevalece sobre una victoria inestable", () => {
  const home = [match(1, 30, 2, 1), match(2, 26, 1, 2, "Visitante"), match(3, 22, 2, 2), match(4, 18, 3, 1, "Visitante"), match(5, 14, 1, 1)];
  const away = [match(11, 29, 1, 2, "Visitante"), match(12, 25, 2, 1), match(13, 21, 2, 2, "Visitante"), match(14, 17, 1, 3), match(15, 13, 1, 1, "Visitante")];
  assert.equal(evaluate(home, away).recommendedSelection, "Más de 1.5 goles");
});

test("Over 2.5 queda como candidato con ataques fuertes", () => {
  const home = [match(1, 30, 3, 1), match(2, 26, 2, 2, "Visitante"), match(3, 22, 4, 1), match(4, 18, 2, 1, "Visitante"), match(5, 14, 3, 2)];
  const away = [match(11, 29, 2, 2, "Visitante"), match(12, 25, 3, 1), match(13, 21, 2, 1, "Visitante"), match(14, 17, 3, 2), match(15, 13, 1, 3, "Visitante")];
  const candidate = evaluate(home, away).calculationDetails.candidates.find((item) => item.key === "over25");
  assert.equal(candidate.status, "Candidato");
  assert.ok(candidate.weightedRatePct >= 70);
});

test("Under 3.5 prevalece con marcadores controlados", () => {
  const home = [match(1, 30, 1, 0), match(2, 26, 0, 0, "Visitante"), match(3, 22, 1, 1), match(4, 18, 0, 1, "Visitante"), match(5, 14, 2, 0)];
  const away = [match(11, 29, 0, 0, "Visitante"), match(12, 25, 1, 0), match(13, 21, 1, 1, "Visitante"), match(14, 17, 0, 1), match(15, 13, 2, 0, "Visitante")];
  assert.equal(evaluate(home, away).recommendedSelection, "Menos de 3.5 goles");
});

test("BTTS Sí se evalúa como candidato cuando ambos anotan y conceden", () => {
  const home = [match(1, 30, 2, 1), match(2, 26, 1, 1, "Visitante"), match(3, 22, 2, 2), match(4, 18, 1, 2, "Visitante"), match(5, 14, 3, 1)];
  const away = [match(11, 29, 1, 1, "Visitante"), match(12, 25, 2, 1), match(13, 21, 1, 2, "Visitante"), match(14, 17, 2, 2), match(15, 13, 1, 1, "Visitante")];
  const candidate = evaluate(home, away).calculationDetails.candidates.find((item) => item.key === "btts_yes");
  assert.equal(candidate.status, "Candidato");
});

test("BTTS No se evalúa cuando hay porterías a cero consistentes", () => {
  const home = [match(1, 30, 1, 0), match(2, 26, 0, 0, "Visitante"), match(3, 22, 2, 0), match(4, 18, 0, 1, "Visitante"), match(5, 14, 1, 0)];
  const away = [match(11, 29, 0, 1, "Visitante"), match(12, 25, 0, 0), match(13, 21, 0, 2, "Visitante"), match(14, 17, 1, 0), match(15, 13, 0, 1, "Visitante")];
  const candidate = evaluate(home, away).calculationDetails.candidates.find((item) => item.key === "btts_no");
  assert.equal(candidate.status, "Candidato");
});

test("muestra insuficiente no genera pick", () => {
  const result = evaluate([match(1, 30, 1, 0), match(2, 26, 1, 0)], [match(11, 29, 0, 1), match(12, 25, 0, 1)]);
  assert.equal(result.recommendedMarket, null);
  assert.match(result.explanation, /menos de 3/i);
});

test("la localía alternada aplica el factor contextual correcto", () => {
  const home = [match(1, 30, 1, 0, "Local"), match(2, 26, 1, 0, "Visitante"), match(3, 22, 1, 0, "Local")];
  const away = [match(11, 29, 0, 1, "Visitante"), match(12, 25, 0, 1, "Local"), match(13, 21, 0, 1, "Visitante")];
  const result = evaluate(home, away);
  assert.equal(result.calculationDetails.home.contextualMatches, 2);
  assert.equal(result.calculationDetails.away.contextualMatches, 2);
});

test("interpreta el marcador desde la perspectiva del equipo mostrado", () => {
  const home = [match(1, 30, 1, 0, "Visitante"), match(2, 26, 2, 0), match(3, 22, 1, 0)];
  const away = [match(11, 29, 0, 1, "Visitante"), match(12, 25, 0, 2), match(13, 21, 0, 1)];
  const result = evaluate(home, away);
  assert.equal(result.calculationDetails.home.wins, 3);
  assert.equal(result.calculationDetails.home.goalsFor, 4);
});

test("excluye fixtures duplicados sin duplicar la muestra", () => {
  const home = [...homeDominant(), { ...homeDominant()[0] }];
  const result = evaluate(home, awayWeak());
  assert.equal(result.homeSampleSize, 5);
  assert.ok(result.warnings.some((warning) => /duplicado/i.test(warning)));
});

test("un marcador inválido bloquea la recomendación", () => {
  const home = homeDominant();
  home[0] = { ...home[0], goalsFor: null };
  const result = evaluate(home, awayWeak());
  assert.equal(result.recommendedMarket, null);
  assert.match(result.explanation, /inválido/i);
});

test("excluye partidos cancelados o aplazados", () => {
  const home = homeDominant();
  home[0] = { ...home[0], statusShort: "PST" };
  const result = evaluate(home, awayWeak());
  assert.equal(result.recommendedMarket, null);
  assert.match(result.explanation, /inválido/i);
});

test("un resultado extremo aislado no domina la muestra", () => {
  const home = [match(1, 30, 8, 0), match(2, 26, 0, 0, "Visitante"), match(3, 22, 0, 1), match(4, 18, 1, 0, "Visitante"), match(5, 14, 0, 0)];
  const away = [match(11, 29, 0, 0, "Visitante"), match(12, 25, 1, 0), match(13, 21, 0, 1, "Visitante"), match(14, 17, 0, 0), match(15, 13, 1, 0, "Visitante")];
  const result = evaluate(home, away);
  assert.notEqual(result.recommendedSelection, "Más de 2.5 goles");
});

test("la contradicción entre forma general y contextual evita victoria directa", () => {
  const home = [match(1, 30, 2, 0, "Visitante"), match(2, 26, 2, 0, "Visitante"), match(3, 22, 0, 1, "Local"), match(4, 18, 3, 1, "Visitante"), match(5, 14, 0, 2, "Local")];
  const away = awayWeak();
  assert.notEqual(evaluate(home, away).recommendedSelection, "Gana Local FC");
});

test("un empate técnico entre mercados equivalentes no fuerza pick", () => {
  const home = [match(1, 30, 1, 1), match(2, 26, 1, 1, "Visitante"), match(3, 22, 1, 1), match(4, 18, 1, 1, "Visitante"), match(5, 14, 1, 1)];
  const away = [match(11, 29, 1, 1, "Visitante"), match(12, 25, 1, 1), match(13, 21, 1, 1, "Visitante"), match(14, 17, 1, 1), match(15, 13, 1, 1, "Visitante")];
  const result = evaluate(home, away);
  assert.ok(result.recommendedMarket === null || ["Más de 1.5 goles", "Local FC o empate (1X)", "Visitante FC o empate (X2)"].includes(result.recommendedSelection));
});

test("la ejecución es determinística con la misma entrada", () => {
  const first = evaluate(homeDominant(), awayWeak());
  const second = evaluate(homeDominant(), awayWeak());
  assert.deepEqual(second, first);
});

test("caso real New England Revolution vs Toronto FC conserva y evalúa las muestras API-Football", () => {
  const home = [
    match(1490312, 23, 0, 1, "Visitante", { date: "2026-05-23" }),
    match(1490300, 16, 2, 1, "Local", { date: "2026-05-16" }),
    match(1490285, 13, 0, 3, "Local", { date: "2026-05-13" }),
    match(1490271, 9, 2, 1, "Local", { date: "2026-05-09" }),
    match(1490259, 2, 1, 0, "Local", { date: "2026-05-02" })
  ];
  const away = [
    match(1490325, 16, 0, 0, "Visitante", { date: "2026-07-16" }),
    match(1490315, 24, 1, 2, "Visitante", { date: "2026-05-24" }),
    match(1490298, 16, 1, 3, "Visitante", { date: "2026-05-16" }),
    match(1490267, 9, 2, 4, "Local", { date: "2026-05-09" }),
    match(1543072, 5, 1, 3, "Local", { date: "2026-05-05" })
  ];
  const result = evaluate(home, away, {
    homeTeamName: "New England Revolution",
    awayTeamName: "Toronto FC",
    currentFixtureDate: "2026-07-22T23:30:00.000Z"
  });
  assert.equal(result.homeSampleSize, 5);
  assert.equal(result.awaySampleSize, 5);
  assert.equal(result.calculationDetails.home.wins, 3);
  assert.equal(result.calculationDetails.home.goalsFor, 5);
  assert.equal(result.calculationDetails.home.goalsAgainst, 6);
  assert.equal(result.calculationDetails.home.cleanSheetRatePct, 16);
  assert.equal(result.calculationDetails.away.wins, 0);
  assert.equal(result.calculationDetails.away.draws, 1);
  assert.equal(result.calculationDetails.away.losses, 4);
  assert.equal(result.calculationDetails.away.goalsFor, 5);
  assert.equal(result.calculationDetails.away.goalsAgainst, 12);
  assert.equal(result.recommendedSelection, "Menos de 3.5 goles");
  assert.equal(result.weightedRate, 76.1);
});
