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
  assert.equal(result.highestEvPick.pickCategory, "high_risk_value");
  assert.equal(result.highestEvPick.highlightColor, "red");
  assert.ok(result.highestEvPick.riskFlags.includes("false_value_underdog"));
  assert.match(result.highestEvPick.warning, /favorito real fuerte.*Portugal/i);
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
  assert.equal(result.highestEvPick.pickCategory, "pick_fuerte");
  assert.equal(result.highestEvPick.highlightColor, "green");
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

function profileDataset({ home, away, favoriteSide = null, favoritePercent = null, markets, homeAttack = 1.2, awayAttack = 1.2 }) {
  const fixture = {
    homeTeamId: 1, awayTeamId: 2, home, away, neutralVenue: false,
    favorite: favoriteSide ? {
      teamId: favoriteSide === "home" ? 1 : 2,
      team: favoriteSide === "home" ? home : away,
      percent: favoritePercent
    } : null
  };
  return {
    fixture,
    dataQuality: { score: 84, canSuggest: true },
    preMatch: {
      home: { played: 5, winRate: 55, nonLossRate: 75, avgGoalsFor: homeAttack, bttsRate: homeAttack >= 1.2 ? 60 : 25 },
      away: { played: 5, winRate: 45, nonLossRate: 70, avgGoalsFor: awayAttack, bttsRate: awayAttack >= 1.2 ? 60 : 25 }
    },
    researchData: {
      totalConfidenceScore: 82,
      standings: { home: { rank: 8 }, away: { rank: 18 } },
      injuriesSuspensions: { home: { injuries: [], suspensions: [] }, away: { injuries: [], suspensions: [] } },
      lineups: {},
      xgXga: { homeXG: homeAttack, homeXGA: 1.1, awayXG: awayAttack, awayXGA: 1.2 }
    },
    marketAnalysis: markets
  };
}

test("Senegal 1X es conservador e Iraq X2 es falso valor", () => {
  const input = profileDataset({
    home: "Senegal", away: "Iraq", homeAttack: 1.7, awayAttack: 0.65,
    markets: [calculation("1X", "Senegal o empate (1X)", -4, 1.04), calculation("X2", "Iraq o empate (X2)", 143, 3.4)]
  });
  const result = evaluatePickRecommendations(input);
  assert.equal(result.favoriteTeam, "Senegal");
  assert.equal(result.favoriteStrength, "strong");
  assert.equal(result.picks.find((pick) => pick.selectionKey === "1X").highlightColor, "green");
  assert.equal(result.picks.find((pick) => pick.selectionKey === "X2").highlightColor, "red");
});

test("Belgium X2 queda verde y New Zealand 1X rojo", () => {
  const input = profileDataset({
    home: "New Zealand", away: "Belgium", homeAttack: 0.7, awayAttack: 1.9,
    markets: [calculation("1X", "New Zealand o empate (1X)", 150, 3.6), calculation("X2", "Belgium o empate (X2)", -3, 1.03)]
  });
  const result = evaluatePickRecommendations(input);
  assert.equal(result.favoriteTeam, "Belgium");
  assert.equal(result.picks.find((pick) => pick.selectionKey === "X2").highlightColor, "green");
  assert.equal(result.picks.find((pick) => pick.selectionKey === "1X").colorMeaning, "Evitar");
});

test("Tunisia 1X no supera a Netherlands X2", () => {
  const input = profileDataset({
    home: "Tunisia", away: "Netherlands", homeAttack: 0.75, awayAttack: 2,
    markets: [calculation("1X", "Tunisia o empate (1X)", 120, 3.2), calculation("X2", "Netherlands o empate (X2)", -2, 1.01)]
  });
  const result = evaluatePickRecommendations(input);
  assert.equal(result.recommendedPick.selectionKey, "X2");
  assert.equal(result.discardedPicks[0].selectionKey, "1X");
});

test("perfil cerrado favorece Under 2.5 y BTTS No", () => {
  const input = profileDataset({
    home: "Paraguay", away: "Australia", homeAttack: 0.9, awayAttack: 0.8,
    markets: [
      { ...calculation("under_2_5", "Menos de 2.5", 8, 1.8), estimatedProbabilityPct: 61 },
      { ...calculation("over_2_5", "Más de 2.5", 4, 2.1), estimatedProbabilityPct: 39 },
      { ...calculation("btts_no", "BTTS No", 6, 1.75), marketKey: "btts", estimatedProbabilityPct: 60 },
      { ...calculation("btts_yes", "BTTS Sí", -5, 2.1), marketKey: "btts", estimatedProbabilityPct: 40 }
    ]
  });
  const result = evaluatePickRecommendations(input);
  assert.equal(result.matchProfile, "closed_balanced");
  assert.notEqual(result.picks.find((pick) => pick.selectionKey === "under_2_5").highlightColor, "red");
  assert.equal(result.picks.find((pick) => pick.selectionKey === "over_2_5").highlightColor, "red");
});

test("BTTS No baja en un partido competitive_open", () => {
  const input = profileDataset({
    home: "Türkiye", away: "USA", homeAttack: 1.6, awayAttack: 1.5,
    markets: [
      { ...calculation("over_2_5", "Más de 2.5", 9, 1.9), estimatedProbabilityPct: 59 },
      { ...calculation("btts_yes", "BTTS Sí", 8, 1.85), marketKey: "btts", estimatedProbabilityPct: 60 },
      { ...calculation("btts_no", "BTTS No", 6, 2.1), marketKey: "btts", estimatedProbabilityPct: 40 }
    ]
  });
  const result = evaluatePickRecommendations(input);
  assert.equal(result.matchProfile, "competitive_open");
  assert.notEqual(result.picks.find((pick) => pick.selectionKey === "btts_no").highlightColor, "green");
});

test("perfil favorite_open favorece Over y BTTS Sí", () => {
  const input = profileDataset({
    home: "Norway", away: "France", favoriteSide: "away", favoritePercent: 64, homeAttack: 1.25, awayAttack: 2,
    markets: [
      { ...calculation("over_2_5", "Más de 2.5", 10, 1.85), estimatedProbabilityPct: 61 },
      { ...calculation("under_2_5", "Menos de 2.5", -8, 2.1), estimatedProbabilityPct: 39 },
      { ...calculation("btts_yes", "BTTS Sí", 7, 1.9), marketKey: "btts", estimatedProbabilityPct: 58 }
    ]
  });
  const result = evaluatePickRecommendations(input);
  assert.equal(result.matchProfile, "favorite_open");
  assert.equal(result.picks.find((pick) => pick.selectionKey === "under_2_5").highlightColor, "red");
});

test("partido competitivo conserva BTTS Sí y Over como valor condicionado", () => {
  const input = profileDataset({
    home: "Egypt", away: "Iran", homeAttack: 1.35, awayAttack: 1.3,
    markets: [
      { ...calculation("btts_yes", "BTTS Sí", 9, 1.95), marketKey: "btts", estimatedProbabilityPct: 57 },
      { ...calculation("over_2_5", "Más de 2.5", 7, 2.05), estimatedProbabilityPct: 53 },
      calculation("X2", "Iran o empate (X2)", 5, 1.7)
    ]
  });
  const result = evaluatePickRecommendations(input);
  assert.ok(result.valueAlternative || result.conservativeAlternative);
  assert.notEqual(result.picks.find((pick) => pick.selectionKey === "btts_yes").highlightColor, "red");
});
