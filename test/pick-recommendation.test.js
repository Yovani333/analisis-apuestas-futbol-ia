import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePickRecommendations } from "../server/services/pick-recommendation.service.js";

function calculation(selectionKey, selection, expectedValuePct, decimalOdds = 1.9) {
  return {
    marketKey: selectionKey === "1X" || selectionKey === "X2" ? "double_chance" : "over_under_2_5",
    selectionKey,
    market: selectionKey === "over_2_5" ? "Total de goles 2.5" : "Doble oportunidad",
    selection,
    decimalOdds,
    estimatedProbabilityPct: 60,
    expectedValuePct,
    positiveValue: expectedValuePct >= 5,
    requiresReview: false,
    sampleSize: 10
  };
}

function baseDataset() {
  return {
    fixture: {
      homeTeamId: 1,
      awayTeamId: 2,
      neutralVenue: false,
      favorite: { teamId: 1, team: "Portugal", percent: 68 }
    },
    dataQuality: { score: 82, canSuggest: true },
    preMatch: {
      home: { played: 5, winRate: 80, nonLossRate: 100 },
      away: { played: 5, winRate: 20, nonLossRate: 40 }
    },
    researchData: {
      standings: { home: { rank: 2 }, away: { rank: 28 } },
      injuriesSuspensions: {
        home: { injuries: [], suspensions: [] },
        away: { injuries: [], suspensions: [] }
      },
      lineups: {},
      xgXga: { homeXG: 2.1, homeXGA: 0.8, awayXG: 0.9, awayXGA: 1.8 }
    },
    marketAnalysis: [
      calculation("X2", "Uzbekistan o empate (X2)", 28, 3.2),
      calculation("over_2_5", "Más de 2.5 goles", 8, 1.85)
    ]
  };
}

test("separa mayor EV de pick lógico contra favorito fuerte", () => {
  const result = evaluatePickRecommendations(baseDataset());
  assert.equal(result.favoriteTeam, "Portugal");
  assert.equal(result.favoriteStrength, "strong");
  assert.equal(result.qualityGap, "very_high");
  assert.equal(result.highestEvPick.selectionKey, "X2");
  assert.equal(result.highestEvPick.pickCategory, "value_sospechoso");
  assert.match(result.highestEvPick.warning, /favorito fuerte Portugal/i);
  assert.equal(result.recommendedPick.selectionKey, "over_2_5");
  assert.equal(result.recommendedPick.pickCategory, "pick_fuerte");
});

test("underdog contra favorito fuerte requiere tres confirmaciones para ser pick lógico", () => {
  const dataset = baseDataset();
  dataset.fixture.neutralVenue = true;
  dataset.preMatch.home = { played: 5, winRate: 20, nonLossRate: 40 };
  dataset.preMatch.away = { played: 5, winRate: 80, nonLossRate: 100 };
  dataset.researchData.standings.away.rank = 5;
  dataset.marketAnalysis = [calculation("X2", "Uzbekistan o empate (X2)", 20, 2.5)];
  const result = evaluatePickRecommendations(dataset);
  assert.ok(result.highestEvPick.confirmations.length >= 3);
  assert.equal(result.highestEvPick.pickCategory, "pick_logico");
  assert.equal(result.recommendedPick.selectionKey, "X2");
});

test("dos confirmaciones mantienen el underdog como agresivo de exposición baja", () => {
  const dataset = baseDataset();
  dataset.fixture.neutralVenue = true;
  dataset.preMatch.home = { played: 5, winRate: 20, nonLossRate: 40 };
  dataset.preMatch.away = { played: 5, winRate: 80, nonLossRate: 100 };
  dataset.marketAnalysis = [calculation("X2", "Uzbekistan o empate (X2)", 20, 2.5)];
  const result = evaluatePickRecommendations(dataset);
  assert.equal(result.highestEvPick.confirmations.length, 2);
  assert.equal(result.highestEvPick.pickCategory, "agresivo_stake_bajo");
  assert.equal(result.recommendedPick, null);
});

test("EV negativo se clasifica como evitar", () => {
  const dataset = baseDataset();
  dataset.marketAnalysis = [calculation("over_2_5", "Más de 2.5 goles", -4, 1.7)];
  const result = evaluatePickRecommendations(dataset);
  assert.equal(result.highestEvPick.pickCategory, "evitar");
  assert.equal(result.recommendedPick, null);
});

test("genera hasta cinco picks ordenados por confianza evaluada", () => {
  const dataset = baseDataset();
  dataset.marketAnalysis = [
    calculation("X2", "Uzbekistan o empate (X2)", 28, 3.2),
    calculation("over_2_5", "Más de 2.5 goles", 8, 1.85),
    calculation("under_2_5", "Menos de 2.5 goles", 2, 1.8),
    { ...calculation("btts_yes", "Ambos anotan: Sí", 7, 1.9), marketKey: "btts" },
    { ...calculation("btts_no", "Ambos anotan: No", -3, 1.9), marketKey: "btts" },
    calculation("1X", "Portugal o empate (1X)", 6, 1.3)
  ];
  const result = evaluatePickRecommendations(dataset);
  assert.equal(result.confidencePicks.length, 5);
  assert.deepEqual(result.confidencePicks.map((pick) => pick.rank), [1, 2, 3, 4, 5]);
  assert.ok(result.confidencePicks.every((pick, index, rows) =>
    index === 0 || rows[index - 1].confidencePct >= pick.confidencePct
  ));
  assert.ok(result.confidencePicks.every((pick) => Number.isFinite(pick.confidencePct)));
});
