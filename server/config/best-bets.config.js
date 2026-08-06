export const BEST_BETS_CONFIG_VERSION = "best-bets-config-v1";

// Pesos explícitos del selector. No modifican la probabilidad de ningún modelo:
// ordenan candidatos ya calculados y suman exactamente 100 puntos.
export const BEST_BETS_WEIGHTS = Object.freeze({
  modelProbability: 18,
  edge: 18,
  expectedValue: 14,
  dataQuality: 20,
  evidence: 12,
  historicalReliability: 12,
  modelConsistency: 6
});

export const BEST_BETS_THRESHOLDS = Object.freeze({
  minimumOdds: 1.01,
  minimumExpectedValuePct: 2,
  minimumEdgePct: 2,
  minimumDataQuality: 55,
  minimumEvidenceScore: 45,
  minimumAptScore: 75,
  minimumCautionScore: 65,
  maximumAptRisk: 35,
  maximumCautionRisk: 55,
  maximumOddsAgeMinutes: 360,
  minimumHistoricalSample: 10,
  adequateHistoricalSample: 30,
  minimumScoreDifferenceForCorrelation: 4,
  maximumFixturesPerRun: 10,
  maximumGeneralPicks: 3,
  maximumPerMarket: 5,
  maximumPerLeague: 2,
  onePickPerFixture: true
});

export const BEST_BETS_CONFIG = Object.freeze({
  version: BEST_BETS_CONFIG_VERSION,
  modelVersion: "best-bets-selector-v1",
  weights: BEST_BETS_WEIGHTS,
  thresholds: BEST_BETS_THRESHOLDS,
  supportedMarketKeys: Object.freeze([
    "match_winner", "double_chance", "draw_no_bet",
    "over_under_1_5", "over_under_2_5", "over_under_3_5", "under_3_5",
    "btts", "home_team_goals", "away_team_goals"
  ])
});

export function validateBestBetsConfig(config = BEST_BETS_CONFIG) {
  const weightTotal = Object.values(config.weights || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  if (weightTotal !== 100) throw new TypeError(`Los pesos de mejores apuestas deben sumar 100; suman ${weightTotal}.`);
  if (!Array.isArray(config.supportedMarketKeys) || !config.supportedMarketKeys.length) throw new TypeError("El selector requiere mercados soportados.");
  return true;
}

validateBestBetsConfig();
