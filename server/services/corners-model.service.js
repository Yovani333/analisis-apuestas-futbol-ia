import { resolveModuleQuality } from "./module-quality.service.js";

const number = (value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(String(value).replace("%", ""))) ? null : Number(String(value).replace("%", ""));
const round = (value, digits = 1) => Number(value.toFixed(digits));
const average = (values) => values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
const RECENCY_WEIGHTS = [1, 0.9, 0.8, 0.7, 0.6];
const friendly = (fixture) => /friendly|amistos|exhibition/i.test(`${fixture.competition || ""} ${fixture.competitionType || ""}`);

function weightedAverage(values) {
  if (!values.length) return null;
  const weights = values.map((_, index) => RECENCY_WEIGHTS[index] ?? 0.5);
  return round(values.reduce((sum, value, index) => sum + value * weights[index], 0) / weights.reduce((sum, value) => sum + value, 0));
}

function weightedRate(values, predicate) {
  if (!values.length) return null;
  const weights = values.map((_, index) => RECENCY_WEIGHTS[index] ?? 0.5);
  return round(values.reduce((sum, value, index) => sum + (predicate(value) ? weights[index] : 0), 0) / weights.reduce((sum, value) => sum + value, 0) * 100);
}

function history(dataset, side) {
  const fixtures = dataset.historicalEstimatedXg?.[`${side}Team`]?.fixturesUsed || dataset.researchData?.xgXga?.[`fixturesUsed${side === "home" ? "Home" : "Away"}`] || [];
  const official = fixtures.filter((fixture) => !friendly(fixture));
  const usefulRows = official.filter((fixture) => number(fixture.cornerStats?.cornersFor) !== null && number(fixture.cornerStats?.cornersAgainst) !== null).slice(0, 5);
  return {
    attempted: fixtures.length,
    excludedFriendlies: fixtures.filter(friendly).length,
    useful: usefulRows.length,
    competitions: [...new Set(usefulRows.map((fixture) => fixture.competition).filter(Boolean))],
    cornersForAvg: weightedAverage(usefulRows.map((fixture) => number(fixture.cornerStats.cornersFor))),
    cornersAgainstAvg: weightedAverage(usefulRows.map((fixture) => number(fixture.cornerStats.cornersAgainst))),
    possessionAvg: average(usefulRows.map((fixture) => number(fixture.cornerStats.possession)).filter((value) => value !== null)),
    shotsAvg: average(usefulRows.map((fixture) => number(fixture.cornerStats.totalShots)).filter((value) => value !== null)),
    blockedShotsAvg: average(usefulRows.map((fixture) => number(fixture.cornerStats.blockedShots)).filter((value) => value !== null)),
    totalCorners: usefulRows.map((fixture) => number(fixture.cornerStats.cornersFor) + number(fixture.cornerStats.cornersAgainst))
  };
}

function tier(dataset, side, metrics) {
  const probabilities = dataset.fixture?.favorite?.probabilities || {};
  const win = number(probabilities[side]) ?? 33;
  if (win >= 55 || (metrics.possessionAvg >= 58 && metrics.shotsAvg >= 13)) return "tier_1";
  if (win >= 32 || metrics.shotsAvg >= 9) return "tier_2";
  return "tier_3";
}

function liveStats(dataset, side) {
  const raw = dataset.researchData?.xgXga?.rawStats?.[side] || {};
  return { corners: number(raw.cornerKicks), possession: number(raw.ballPossession), shots: number(raw.totalShots), blockedShots: number(raw.blockedShots) };
}

export function calculateCornersModel(dataset = {}) {
  const fixture = dataset.fixture || {};
  const home = history(dataset, "home");
  const away = history(dataset, "away");
  if (!home.useful || !away.useful) return { status: "not_available", sourceModule: "corners", source: "API-Football fixture statistics", teams: { home, away }, picks: [], quality: resolveModuleQuality({ status: "not_available" }), warning: "Corners no disponible: faltan partidos oficiales con corners completos.", generatedAt: new Date().toISOString() };

  home.tier = tier(dataset, "home", home);
  away.tier = tier(dataset, "away", away);
  home.expectedCorners = round(home.cornersForAvg * 0.6 + away.cornersAgainstAvg * 0.4);
  away.expectedCorners = round(away.cornersForAvg * 0.6 + home.cornersAgainstAvg * 0.4);
  const matchupExpected = home.expectedCorners + away.expectedCorners;
  const observedExpected = weightedAverage([...home.totalCorners, ...away.totalCorners]);
  const totalExpected = round(matchupExpected * 0.7 + observedExpected * 0.3);
  const favoriteSide = home.tier === "tier_1" && away.tier !== "tier_1" ? "home" : away.tier === "tier_1" && home.tier !== "tier_1" ? "away" : null;
  const favorite = favoriteSide ? (favoriteSide === "home" ? home : away) : null;
  const underdog = favoriteSide ? (favoriteSide === "home" ? away : home) : null;
  const offensiveMonopoly = Boolean(favorite && favorite.possessionAvg >= 58 && favorite.shotsAvg >= 13 && underdog.cornersAgainstAvg >= 5);
  let confidenceScore = Math.min(home.useful, away.useful) >= 5 ? 76 : 49;
  const warnings = [];
  if (Math.min(home.useful, away.useful) < 5) warnings.push("Muestra menor a 5 partidos oficiales; no se permite recomendación fuerte.");
  if (home.possessionAvg === null || away.possessionAvg === null) { confidenceScore -= 10; warnings.push("Posesión histórica incompleta."); }

  const live = fixture.status === "live";
  const current = { home: liveStats(dataset, "home"), away: liveStats(dataset, "away") };
  let liveAlert = "";
  if (live && favoriteSide && number(fixture.elapsed) >= 55 && number(fixture.elapsed) <= 75) {
    const stats = current[favoriteSide];
    const score = fixture.score || {};
    const notWinning = favoriteSide === "home" ? number(score.home) <= number(score.away) : number(score.away) <= number(score.home);
    if (notWinning && stats.possession >= 60 && stats.shots >= 10) liveAlert = "Alerta Corners Live: favorito presionando fuerte; revisar mercado de corners en vivo.";
  }

  const line = Math.max(0.5, Math.floor(totalExpected) + 0.5);
  const totals = [...home.totalCorners, ...away.totalCorners];
  const overRate = weightedRate(totals, (value) => value > line);
  const underRate = weightedRate(totals, (value) => value < line);
  const direction = overRate >= underRate ? "over" : "under";
  const empiricalRate = Math.max(overRate, underRate);
  const projectionRate = direction === "over"
    ? Math.max(35, Math.min(75, 50 + (totalExpected - line) * 8))
    : Math.max(35, Math.min(75, 50 + (line - totalExpected) * 8));
  const probability = round(empiricalRate * 0.7 + projectionRate * 0.3);
  confidenceScore = Math.max(0, Math.min(90, Math.round(confidenceScore + (probability - 55) * 0.6)));
  const status = confidenceScore >= 70 ? "available" : "partial";
  const selectionKey = `${direction}_${String(line).replace(".", "_")}_corners`;
  const selection = `${direction === "over" ? "Más" : "Menos"} de ${line} corners`;
  const oddsMarkets = dataset.researchData?.odds?.markets || [];
  const quoted = oddsMarkets.find((item) => item.selectionKey === selectionKey) || oddsMarkets.find((item) => item.selectionKey === `${direction}_corners`);
  const odds = number(quoted?.decimalOdds);
  const expectedValuePct = odds ? round(probability * odds - 100) : null;
  const recommendation = {
    marketKey: "corners", selectionKey, market: "Total de corners", selection,
    decimalOdds: odds, impliedProbabilityPct: odds ? round(100 / odds) : null,
    modelProbabilityPct: probability, expectedValuePct, confidenceScore,
    level: confidenceScore >= 70 ? "Confiable" : "Revisión", highlightColor: confidenceScore >= 70 ? "green" : "orange",
    sourceModule: "corners", supportingData: [`proyección ponderada ${totalExpected}`, `frecuencia reciente ${empiricalRate}%`, `línea ${line}`], contradictingData: warnings
  };
  const disparity = home.tier === away.tier ? "low" : Math.abs(Number(home.tier.at(-1)) - Number(away.tier.at(-1))) >= 2 ? "high" : "medium";
  return {
    status, source: "API-Football fixture statistics + modelo interno", sourceModule: "corners", modelVersion: "official-history-corners-v2",
    fixtureId: String(fixture.id || ""), teams: { home, away }, disparity, totalExpectedCorners: totalExpected, recommendation,
    offensiveMonopoly, preMatchSignal: offensiveMonopoly ? `Posible monopolio ofensivo de ${fixture[favoriteSide]}.` : "Sin monopolio ofensivo confirmado.",
    live: { active: live, current, alert: liveAlert, competitiveNeed: "Necesidad competitiva no disponible" },
    confidenceScore, quality: resolveModuleQuality({ score: confidenceScore, status, notes: warnings }), picks: odds ? [recommendation] : [], warnings,
    warning: warnings.join(" "), generatedAt: new Date().toISOString()
  };
}
