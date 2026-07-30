import { resolveModuleQuality } from "./module-quality.service.js";

const RECENCY_WEIGHTS = [1, 0.9, 0.8, 0.7, 0.6];

const number = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace("%", ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const round = (value, digits = 1) => Number(Number(value || 0).toFixed(digits));
const friendly = (fixture) => /friendly|amistos|exhibition/i.test(`${fixture?.competition || ""} ${fixture?.competitionType || ""}`);

function weightedAverage(values) {
  if (!values.length) return null;
  const weights = values.map((_, index) => RECENCY_WEIGHTS[index] ?? 0.5);
  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  return round(values.reduce((sum, value, index) => sum + value * weights[index], 0) / weightSum);
}

function history(dataset, side) {
  const fixtures = dataset.historicalEstimatedXg?.[`${side}Team`]?.fixturesUsed
    || dataset.researchData?.xgXga?.[`fixturesUsed${side === "home" ? "Home" : "Away"}`]
    || [];
  const official = fixtures.filter((fixture) => !friendly(fixture));
  const usefulRows = official
    .filter((fixture) => number(fixture.cardStats?.yellowCardsFor) !== null && number(fixture.cardStats?.yellowCardsAgainst) !== null)
    .slice(0, 5);
  const cardsFor = usefulRows.map((fixture) => number(fixture.cardStats.yellowCardsFor));
  const cardsAgainst = usefulRows.map((fixture) => number(fixture.cardStats.yellowCardsAgainst));
  return {
    attempted: fixtures.length,
    excludedFriendlies: fixtures.filter(friendly).length,
    useful: usefulRows.length,
    competitions: [...new Set(usefulRows.map((fixture) => fixture.competition).filter(Boolean))],
    yellowCardsForAvg: weightedAverage(cardsFor),
    yellowCardsAgainstAvg: weightedAverage(cardsAgainst),
    totalYellowCards: usefulRows.map((fixture) => number(fixture.cardStats.yellowCardsFor) + number(fixture.cardStats.yellowCardsAgainst)),
    fixturesUsed: usefulRows.map((fixture) => ({
      fixtureId: fixture.fixtureId,
      date: fixture.date,
      opponent: fixture.opponent,
      venue: fixture.venue,
      competition: fixture.competition,
      yellowCardsFor: fixture.cardStats.yellowCardsFor,
      yellowCardsAgainst: fixture.cardStats.yellowCardsAgainst
    }))
  };
}

export function calculateYellowCardsModel(dataset = {}) {
  const fixture = dataset.fixture || {};
  const home = history(dataset, "home");
  const away = history(dataset, "away");
  const warnings = [];
  if (!home.useful || !away.useful) {
    return {
      status: "not_available",
      sourceModule: "yellow_cards",
      source: "API-Football fixture statistics",
      modelVersion: "official-history-yellow-cards-v1",
      fixtureId: String(fixture.id || ""),
      teams: { home, away },
      projection: null,
      quality: resolveModuleQuality({ status: "not_available" }),
      warning: "Tarjetas amarillas no disponible: faltan partidos oficiales con Yellow Cards completos.",
      generatedAt: new Date().toISOString()
    };
  }
  if (Math.min(home.useful, away.useful) < 5) warnings.push("Muestra menor a 5 partidos oficiales; interpretar con precaucion.");
  const matchupExpected = (home.yellowCardsForAvg * 0.6 + away.yellowCardsAgainstAvg * 0.4)
    + (away.yellowCardsForAvg * 0.6 + home.yellowCardsAgainstAvg * 0.4);
  const observedExpected = weightedAverage([...home.totalYellowCards, ...away.totalYellowCards]);
  const expectedTotal = round(matchupExpected * 0.65 + observedExpected * 0.35);
  const lower = Math.max(0, Math.floor(expectedTotal - 1));
  const upper = Math.max(lower + 1, Math.ceil(expectedTotal + 1));
  const confidenceScore = Math.min(home.useful, away.useful) >= 5 ? 72 : 48;
  const status = confidenceScore >= 70 ? "available" : "partial";
  return {
    status,
    source: "API-Football fixture statistics + modelo interno",
    sourceModule: "yellow_cards",
    modelVersion: "official-history-yellow-cards-v1",
    fixtureId: String(fixture.id || ""),
    teams: { home, away },
    projection: {
      expectedTotal,
      suggestedRange: `${lower}-${upper}`,
      homeExpected: round(home.yellowCardsForAvg * 0.6 + away.yellowCardsAgainstAvg * 0.4),
      awayExpected: round(away.yellowCardsForAvg * 0.6 + home.yellowCardsAgainstAvg * 0.4)
    },
    confidenceScore,
    quality: resolveModuleQuality({ score: confidenceScore, status, notes: warnings }),
    warnings,
    warning: warnings.join(" "),
    generatedAt: new Date().toISOString()
  };
}
