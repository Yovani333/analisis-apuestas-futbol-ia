import test from "node:test";
import assert from "node:assert/strict";
import { buildPerformanceOddsView, performanceMarketKey } from "../public/performance-odds.js";

function performanceRow(origin, category, selectionCode, marketKey) {
  return {
    origin,
    wonPicks: [{ category, market: category, selection: category, selectionKey: selectionCode, marketKey }],
    lostPicks: []
  };
}

test("muestra solo cuotas API-Football presentes en Mejores picks y excluye corners", () => {
  const performanceRows = [
    performanceRow("h2h", "Más de 1.5", "over_1_5", "over_under"),
    performanceRow("team_average_performance", "Más de 0.5", "home_over_0_5", "home_team_goals"),
    performanceRow("recent_form", "Menos de 3.5", "under_3_5", "over_under")
  ];
  const recommended = [
    { origin: "h2h", category: "Más de 1.5", won: 8, lost: 0, evaluated: 8, winRate: 100 },
    { origin: "team_average_performance", category: "Más de 0.5", won: 5, lost: 2, evaluated: 7, winRate: 71.4 },
    { origin: "recent_form", category: "Menos de 3.5", won: 2, lost: 1, evaluated: 3, winRate: 66.7 },
    { origin: "corners", category: "Más de 9 corners", won: 9, lost: 0, evaluated: 9, winRate: 100 }
  ];
  const markets = [
    { market: "Total de goles", selection: "Más de 1.5 goles", marketKey: "over_under", selectionKey: "over_1_5", decimalOdds: 1.8, sourceProvider: "api-football" },
    { market: "Goles del local", selection: "Local más de 0.5", marketKey: "home_team_goals", selectionKey: "home_over_0_5", decimalOdds: 2.2, sourceProvider: "api-football" },
    { market: "Total de goles", selection: "Menos de 3.5 goles", marketKey: "over_under", selectionKey: "under_3_5", decimalOdds: 1.4, sourceProvider: "api-football" },
    { market: "Total de corners", selection: "Más de 9 corners", selectionKey: "over_9_corners", decimalOdds: 3.1, sourceProvider: "api-football" },
    { market: "Total de goles", selection: "Más de 1.5 goles", selectionKey: "over_1_5_external", decimalOdds: 4.2, sourceProvider: "oddspedia" },
    { market: "Ambos anotan", selection: "Sí", selectionKey: "btts_yes", decimalOdds: 1.9, sourceProvider: "api-football" }
  ];

  const result = buildPerformanceOddsView(markets, performanceRows, recommended);
  assert.deepEqual(result.map((row) => row.selectionKey), ["home_over_0_5", "over_1_5", "under_3_5"]);
  assert.deepEqual(result.map((row) => row.performanceColor), ["orange", "green", "blue"]);
  assert.ok(result.every((row) => row.sourceProvider === "api-football"));
  assert.ok(result.every((row) => !/corner/i.test(`${row.market} ${row.selection}`)));
});

test("conserva una sola selección y elige la cuota API más alta", () => {
  const performanceRows = [performanceRow("h2h", "Más de 1.5", "over_1_5", "over_under")];
  const recommended = [{ origin: "h2h", category: "Más de 1.5", won: 4, lost: 1, evaluated: 5, winRate: 80 }];
  const result = buildPerformanceOddsView([
    { market: "Total", selection: "Más de 1.5", selectionKey: "over_1_5", decimalOdds: 1.6, sourceProvider: "api-football", bookmaker: "A" },
    { market: "Total", selection: "Más de 1.5", selectionKey: "over_1_5", decimalOdds: 1.9, sourceProvider: "api-football", bookmaker: "B" }
  ], performanceRows, recommended);
  assert.equal(result.length, 1);
  assert.equal(result[0].decimalOdds, 1.9);
  assert.equal(result[0].bookmaker, "B");
});

test("normaliza mercados sin confundir corners con goles", () => {
  assert.equal(performanceMarketKey({ selectionKey: "over_1_5", market: "Total de goles" }), "total_goals:over:1.5");
  assert.equal(performanceMarketKey({ selectionKey: "home_over_0_5", marketKey: "home_team_goals" }), "team_goals:home:over:0.5");
  assert.equal(performanceMarketKey({ market: "Corners", selection: "Más de 8.5" }), null);
});

test("sin coincidencia favorable no muestra cuotas", () => {
  assert.deepEqual(buildPerformanceOddsView([
    { market: "Ambos anotan", selection: "Sí", selectionKey: "btts_yes", decimalOdds: 1.9, sourceProvider: "api-football" }
  ], [], []), []);
});
