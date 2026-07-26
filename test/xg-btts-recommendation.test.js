import test from "node:test";
import assert from "node:assert/strict";
import { evaluateXgBttsRecommendation, RECENCY_WEIGHTS } from "../public/xg-btts-recommendation.js";

const TARGET_DATE = "2026-08-01T18:00:00Z";

function rows(values, { prefix = "f", venue = "home", xga = 1.1, startDay = 25 } = {}) {
  return values.map((xg, index) => ({
    fixtureId: `${prefix}-${index + 1}`,
    date: `2026-07-${String(startDay - index).padStart(2, "0")}T18:00:00Z`,
    opponentId: `${prefix}-opponent-${index + 1}`,
    opponent: `Rival ${index + 1}`,
    venue: typeof venue === "function" ? venue(index) : venue,
    estimatedXG: xg,
    estimatedXGA: typeof xga === "function" ? xga(index) : xga
  }));
}

function evaluate(homeValues, awayValues, options = {}) {
  return evaluateXgBttsRecommendation({
    homeFixtures: options.homeRows || rows(homeValues, { prefix: "h", venue: options.homeVenue || "home", xga: options.homeXga ?? 1.15 }),
    awayFixtures: options.awayRows || rows(awayValues, { prefix: "a", venue: options.awayVenue || "away", xga: options.awayXga ?? 1.15 }),
    homeTeam: { id: 1, name: options.homeName || "Local" },
    awayTeam: { id: 2, name: options.awayName || "Visitante" },
    currentFixtureId: options.currentFixtureId || "target",
    currentFixtureDate: TARGET_DATE,
    sourceQualityScore: options.quality ?? 90
  });
}

test("BTTS Sí con ambos ataques fuertes y defensas frágiles", () => {
  const result = evaluate(
    [1.65, 1.55, 1.6, 1.5, 1.55, 1.6],
    [1.6, 1.5, 1.55, 1.45, 1.5, 1.55],
    { homeXga: 1.55, awayXga: 1.6 }
  );
  assert.equal(result.status, "RECOMMENDED");
  assert.equal(result.recommendedSelection, "Ambos equipos anotan: Sí");
  assert.ok(result.estimatedBttsYes >= 52);
  assert.ok(result.bttsYesScore >= 68);
  assert.ok(result.scoreDifference >= 8);
  assert.equal(result.modelVersion, "xg-btts-poisson-v2");
});

test("BTTS No por ataque local débil", () => {
  const result = evaluate([0.35, 0.45, 0.4, 0.5, 0.3, 0.45], [1.4, 1.3, 1.2, 1.4, 1.1, 1.25], { awayXga: 0.55 });
  assert.equal(result.recommendedSelection, "Ambos equipos anotan: No");
});

test("BTTS No por ataque visitante débil", () => {
  const result = evaluate([1.35, 1.2, 1.4, 1.1, 1.25, 1.3], [0.35, 0.45, 0.4, 0.3, 0.5, 0.4], { homeXga: 0.55 });
  assert.equal(result.recommendedSelection, "Ambos equipos anotan: No");
});

test("BTTS No por defensa local sólida", () => {
  const result = evaluate([1.3, 1.2, 1.1, 1.25, 1.15, 1.2], [0.75, 0.65, 0.7, 0.6, 0.68, 0.62], { homeXga: 0.45, awayXga: 1.1 });
  assert.equal(result.recommendedSelection, "Ambos equipos anotan: No");
});

test("BTTS No por defensa visitante sólida", () => {
  const result = evaluate([0.72, 0.62, 0.68, 0.65, 0.6, 0.7], [1.3, 1.2, 1.1, 1.25, 1.15, 1.2], { homeXga: 1.1, awayXga: 0.45 });
  assert.equal(result.recommendedSelection, "Ambos equipos anotan: No");
});

test("total esperado alto con un equipo muy débil no produce BTTS Sí", () => {
  const result = evaluate([2.2, 2, 1.9, 2.1, 1.8, 2], [0.3, 0.4, 0.35, 0.25, 0.45, 0.3], { homeXga: 0.55, awayXga: 1.5 });
  assert.notEqual(result.recommendedSelection, "Ambos equipos anotan: Sí");
  assert.ok(result.expectedGoalStrengthHome + result.expectedGoalStrengthAway > 2);
});

test("equipos en zona de incertidumbre terminan sin pick", () => {
  const result = evaluate([0.82, 0.78, 0.85, 0.8, 0.76], [0.8, 0.84, 0.76, 0.82, 0.79], { homeXga: 0.82, awayXga: 0.81 });
  assert.equal(result.status, "NO_BET");
  assert.equal(result.recommendedSelection, null);
});

test("muestra insuficiente no genera recomendación", () => {
  const result = evaluate([1.2, 1.1, 1.3], [1.2, 1.1, 1.3]);
  assert.equal(result.status, "INSUFFICIENT_DATA");
});

test("alta dispersión reduce la confianza y evita forzar pick", () => {
  const result = evaluate([3.2, 0.2, 2.8, 0.25, 2.5, 0.3], [3, 0.2, 2.7, 0.3, 2.4, 0.25], { homeXga: (i) => i % 2 ? 0.2 : 3, awayXga: (i) => i % 2 ? 0.2 : 3 });
  assert.equal(result.recommendedSelection, null);
  assert.ok(result.warnings.some((warning) => /dispersión/i.test(warning)));
});

test("un valor extremo no domina la recomendación", () => {
  const result = evaluate([5.5, 0.45, 0.5, 0.4, 0.55, 0.45], [1.2, 1.1, 1.15, 1.2, 1.05, 1.1], { homeXga: 0.55 });
  assert.notEqual(result.recommendedSelection, "Ambos equipos anotan: Sí");
  assert.ok(result.warnings.some((warning) => /extremos|mediana/i.test(warning)));
});

test("promedio alto y mediana baja no respaldan BTTS Sí", () => {
  const result = evaluate([2.8, 2.6, 0.4, 0.45, 0.35, 0.4], [1.2, 1.15, 1.1, 1.25, 1.05, 1.2]);
  assert.notEqual(result.recommendedSelection, "Ambos equipos anotan: Sí");
  assert.ok(result.homeMedianXg < result.homeWeightedXg);
});

test("ajuste de localía reduce el peso de partidos no comparables", () => {
  const mixed = rows([1.5, 0.5, 1.5, 0.5], { prefix: "h", venue: (index) => index % 2 ? "away" : "home", xga: 1.1 });
  const result = evaluate([], [1.2, 1.2, 1.2, 1.2], { homeRows: mixed });
  const expected = (1.5 * RECENCY_WEIGHTS[0] + 0.5 * RECENCY_WEIGHTS[1] * 0.8 + 1.5 * RECENCY_WEIGHTS[2] + 0.5 * RECENCY_WEIGHTS[3] * 0.8)
    / (RECENCY_WEIGHTS[0] + RECENCY_WEIGHTS[1] * 0.8 + RECENCY_WEIGHTS[2] + RECENCY_WEIGHTS[3] * 0.8);
  assert.equal(result.homeWeightedXg, Number(expected.toFixed(2)));
});

test("fixtures duplicados se usan una sola vez", () => {
  const homeRows = rows([1.2, 1.1, 1.3, 1.2], { prefix: "h", venue: "home", xga: 1.1 });
  homeRows.push({ ...homeRows[0] });
  const result = evaluate([], [1.2, 1.1, 1.3, 1.2], { homeRows });
  assert.equal(result.homeSampleSize, 4);
  assert.equal(result.calculationDetails.discarded.home.length, 1);
});

test("valores nulos se descartan sin convertirse en cero", () => {
  const homeRows = rows([1.2, 1.1, 1.3, 1.2], { prefix: "h", venue: "home", xga: 1.1 });
  homeRows.push({ ...homeRows[0], fixtureId: "null-xg", estimatedXG: null });
  const result = evaluate([], [1.2, 1.1, 1.3, 1.2], { homeRows });
  assert.equal(result.homeSampleSize, 4);
  assert.ok(result.calculationDetails.discarded.home.some((row) => row.fixtureId === "null-xg"));
});

test("valores negativos se descartan", () => {
  const homeRows = rows([1.2, 1.1, 1.3, 1.2], { prefix: "h", venue: "home", xga: 1.1 });
  homeRows.push({ ...homeRows[0], fixtureId: "negative", estimatedXGA: -0.2 });
  const result = evaluate([], [1.2, 1.1, 1.3, 1.2], { homeRows });
  assert.ok(result.calculationDetails.discarded.home.some((row) => row.fixtureId === "negative"));
});

test("valores NaN se descartan", () => {
  const homeRows = rows([1.2, 1.1, 1.3, 1.2], { prefix: "h", venue: "home", xga: 1.1 });
  homeRows.push({ ...homeRows[0], fixtureId: "nan", estimatedXG: Number.NaN });
  const result = evaluate([], [1.2, 1.1, 1.3, 1.2], { homeRows });
  assert.ok(result.calculationDetails.discarded.home.some((row) => row.fixtureId === "nan"));
});

test("partidos posteriores al corte se excluyen", () => {
  const homeRows = rows([1.2, 1.1, 1.3, 1.2], { prefix: "h", venue: "home", xga: 1.1 });
  homeRows.push({ ...homeRows[0], fixtureId: "future", date: "2026-08-02T18:00:00Z" });
  const result = evaluate([], [1.2, 1.1, 1.3, 1.2], { homeRows });
  assert.ok(result.calculationDetails.discarded.home.some((row) => row.fixtureId === "future"));
});

test("el propio fixture se excluye de la muestra", () => {
  const homeRows = rows([1.2, 1.1, 1.3, 1.2], { prefix: "h", venue: "home", xga: 1.1 });
  homeRows.push({ ...homeRows[0], fixtureId: "target" });
  const result = evaluate([], [1.2, 1.1, 1.3, 1.2], { homeRows });
  assert.ok(result.calculationDetails.discarded.home.some((row) => row.fixtureId === "target"));
});

test("la misma entrada produce un resultado idéntico", () => {
  const input = {
    homeFixtures: rows([1.3, 1.2, 1.1, 1.4, 1.25], { prefix: "h", venue: "home", xga: 1.1 }),
    awayFixtures: rows([1.2, 1.1, 1.25, 1.3, 1.15], { prefix: "a", venue: "away", xga: 1.2 }),
    homeTeam: { id: 1, name: "Local" }, awayTeam: { id: 2, name: "Visitante" },
    currentFixtureId: "target", currentFixtureDate: TARGET_DATE, sourceQualityScore: 90
  };
  assert.deepEqual(evaluateXgBttsRecommendation(input), evaluateXgBttsRecommendation(input));
});

test("Qingdao Jonoon vs Tianjin Teda sin expediente cargado no inventa un pick", () => {
  const result = evaluateXgBttsRecommendation({
    homeFixtures: [], awayFixtures: [],
    homeTeam: { id: 1568, name: "Qingdao Jonoon" },
    awayTeam: { id: 1561, name: "Tianjin Teda" },
    currentFixtureId: "qingdao-tianjin", currentFixtureDate: TARGET_DATE
  });
  assert.equal(result.status, "INSUFFICIENT_DATA");
  assert.equal(result.recommendedSelection, null);
});
