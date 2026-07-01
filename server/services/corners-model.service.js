const number = (value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(String(value).replace("%", ""))) ? null : Number(String(value).replace("%", ""));
const round = (value, digits = 1) => Number(value.toFixed(digits));
const average = (values) => values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
const friendly = (fixture) => /friendly|amistos|exhibition/i.test(`${fixture.competition || ""} ${fixture.competitionType || ""}`);

function history(dataset, side) {
  const fixtures = dataset.historicalEstimatedXg?.[`${side}Team`]?.fixturesUsed || dataset.researchData?.xgXga?.[`fixturesUsed${side === "home" ? "Home" : "Away"}`] || [];
  const official = fixtures.filter((fixture) => !friendly(fixture));
  const useful = official.filter((fixture) => number(fixture.cornerStats?.cornersFor) !== null && number(fixture.cornerStats?.cornersAgainst) !== null);
  const excludedFriendlies = fixtures.filter(friendly).length;
  return {
    attempted: fixtures.length, excludedFriendlies, useful: useful.length,
    competitions: [...new Set(useful.map((fixture) => fixture.competition).filter(Boolean))],
    cornersForAvg: average(useful.map((fixture) => number(fixture.cornerStats.cornersFor))),
    cornersAgainstAvg: average(useful.map((fixture) => number(fixture.cornerStats.cornersAgainst))),
    possessionAvg: average(useful.map((fixture) => number(fixture.cornerStats.possession)).filter((value) => value !== null)),
    shotsAvg: average(useful.map((fixture) => number(fixture.cornerStats.totalShots)).filter((value) => value !== null)),
    blockedShotsAvg: average(useful.map((fixture) => number(fixture.cornerStats.blockedShots)).filter((value) => value !== null))
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
  const home = history(dataset, "home"); const away = history(dataset, "away");
  if (!home.useful || !away.useful) return { status: "not_available", sourceModule: "corners", source: "API-Football fixture statistics", teams: { home, away }, picks: [], warning: "Corners no disponible: faltan partidos oficiales con corners completos.", generatedAt: new Date().toISOString() };
  home.tier = tier(dataset, "home", home); away.tier = tier(dataset, "away", away);
  home.expectedCorners = round((home.cornersForAvg + away.cornersAgainstAvg) / 2);
  away.expectedCorners = round((away.cornersForAvg + home.cornersAgainstAvg) / 2);
  const totalExpected = round(home.expectedCorners + away.expectedCorners);
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
    const stats = current[favoriteSide]; const score = fixture.score || {};
    const notWinning = favoriteSide === "home" ? number(score.home) <= number(score.away) : number(score.away) <= number(score.home);
    if (notWinning && stats.possession >= 60 && stats.shots >= 10) liveAlert = "Alerta Corners Live: favorito presionando fuerte; revisar mercado de corners en vivo.";
  }
  const status = confidenceScore >= 70 ? "available" : "partial";
  const picks = [];
  const oddsMarkets = dataset.researchData?.odds?.markets || [];
  const addPick = (selectionKey, market, selection, probability) => {
    const quoted = oddsMarkets.find((item) => item.selectionKey === selectionKey);
    if (!quoted?.decimalOdds) return;
    const odds = Number(quoted.decimalOdds); const ev = round(probability * odds - 100);
    picks.push({ marketKey: "corners", selectionKey, market, selection, decimalOdds: odds, impliedProbabilityPct: round(100 / odds), modelProbabilityPct: probability, expectedValuePct: ev, confidenceScore, level: confidenceScore >= 70 ? "Confiable" : "Riesgo", highlightColor: ev >= 5 ? "blue" : confidenceScore >= 70 ? "green" : "orange", sourceModule: "corners", supportingData: [`corners esperados ${totalExpected}`, offensiveMonopoly ? "posible monopolio ofensivo" : "sin monopolio confirmado"], contradictingData: warnings });
  };
  if (favoriteSide) addPick(`${favoriteSide}_most_corners`, "Más corners", `${fixture[favoriteSide]} más corners`, Math.min(78, Math.round(52 + Math.abs(home.expectedCorners - away.expectedCorners) * 7)));
  addPick("over_corners", "Total de corners", `Más de ${Math.floor(totalExpected - .5)} corners`, 58);
  return { status, source: "API-Football fixture statistics + modelo interno", sourceModule: "corners", modelVersion: "official-history-corners-v1", fixtureId: String(fixture.id || ""), teams: { home, away }, disparity: home.tier === away.tier ? "low" : Math.abs(Number(home.tier.at(-1)) - Number(away.tier.at(-1))) >= 2 ? "high" : "medium", totalExpectedCorners: totalExpected, offensiveMonopoly, preMatchSignal: offensiveMonopoly ? `Posible monopolio ofensivo de ${fixture[favoriteSide]}.` : "Sin monopolio ofensivo confirmado.", live: { active: live, current, alert: liveAlert, competitiveNeed: "Necesidad competitiva no disponible" }, confidenceScore: Math.max(0, confidenceScore), picks, warnings, warning: warnings.join(" "), generatedAt: new Date().toISOString() };
}
