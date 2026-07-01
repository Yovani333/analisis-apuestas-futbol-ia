import { calculatePoissonModel } from "./poisson-model.service.js";

const round = (value, digits = 1) => Number(value.toFixed(digits));
const number = (value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(String(value).replace("%", ""))) ? null : Number(String(value).replace("%", ""));

function oddsFor(dataset, selectionKey) {
  const market = (dataset.researchData?.odds?.markets || dataset.marketAnalysis || []).find((item) => item.selectionKey === selectionKey);
  return number(market?.decimalOdds);
}

function sideData(dataset, side, lambda) {
  const opponent = side === "home" ? "away" : "home";
  const research = dataset.researchData || {};
  const xg = research.xgXga || {};
  const form = research.statsForm || {};
  const raw = xg.rawStats?.[side] || {};
  const played = form[`${side}LastMatches`]?.length || 5;
  const goalsFor = number(form[`${side}GoalsFor`]);
  const opponentGoalsAgainst = number(form[`${opponent}GoalsAgainst`]);
  const cleanSheets = number(form[`${opponent}CleanSheets`]);
  const ownXg = number(xg[`${side}XG`]);
  const opponentXga = number(xg[`${opponent}XGA`]);
  const shots = number(raw.totalShots);
  const shotsOnGoal = number(raw.shotsOnGoal);
  const possession = number(raw.ballPossession);
  const evidence = [`λ ofensiva ${lambda}`];
  const contradictions = [];
  if (ownXg !== null) evidence.push(`xG ${ownXg}`);
  if (opponentXga !== null) evidence.push(`xGA rival ${opponentXga}`);
  if (goalsFor !== null) evidence.push(`${round(goalsFor / played, 2)} goles recientes por partido`);
  if (opponentGoalsAgainst !== null) evidence.push(`rival concede ${round(opponentGoalsAgainst / played, 2)} por partido`);
  if (cleanSheets !== null && cleanSheets >= 2) contradictions.push(`rival registra ${cleanSheets} porterías a cero`);
  const live = dataset.fixture?.status === "live";
  if (live && shots !== null) evidence.push(`${shots} tiros actuales`);
  if (live && shotsOnGoal !== null) evidence.push(`${shotsOnGoal} tiros a puerta actuales`);
  if (live && possession >= 60 && (shotsOnGoal === null || shotsOnGoal <= 1)) contradictions.push(`${possession}% de posesión con poco peligro a puerta`);
  if (live && shots !== null && shots <= 2) contradictions.push("volumen de tiro en vivo bajo");
  const over05 = round((1 - Math.exp(-lambda)) * 100);
  const noGoal = round(Math.exp(-lambda) * 100);
  const over15 = round((1 - Math.exp(-lambda) * (1 + lambda)) * 100);
  let confidence = number(research.totalConfidenceScore) ?? number(dataset.dataQuality?.score) ?? 45;
  const strongSignals = [ownXg, opponentXga, goalsFor, opponentGoalsAgainst, shotsOnGoal].filter((value) => value !== null).length;
  if (strongSignals < 2) confidence -= 18;
  confidence -= contradictions.length * 8;
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));
  const status = strongSignals >= 2 && confidence >= 70 ? "available" : strongSignals || lambda ? "partial" : "not_available";
  return { side, teamId: dataset.fixture?.[`${side}TeamId`] || null, team: dataset.fixture?.[side] || side, lambda, over05Pct: over05, noGoalPct: noGoal, over15Pct: over15, confidenceScore: confidence, status, supportingData: evidence, contradictingData: contradictions, liveSignalsUsed: live && (shots !== null || shotsOnGoal !== null) };
}

function pickFromTeam(dataset, team, threshold) {
  const selectionKey = `${team.side}_over_${threshold === .5 ? "0_5" : "1_5"}`;
  const probability = threshold === .5 ? team.over05Pct : team.over15Pct;
  const decimalOdds = oddsFor(dataset, selectionKey);
  const impliedProbabilityPct = decimalOdds ? round(100 / decimalOdds) : null;
  const expectedValuePct = decimalOdds ? round(probability * decimalOdds - 100) : null;
  return {
    marketKey: `${team.side}_team_goals`, selectionKey, market: `Goles de ${team.team}`,
    selection: `${team.team} más de ${threshold}`, decimalOdds, impliedProbabilityPct,
    modelProbabilityPct: probability, expectedValuePct, confidenceScore: Math.round(team.confidenceScore * .55 + probability * .45),
    level: team.confidenceScore >= 75 && probability >= 65 ? "Confiable" : "Conservador",
    highlightColor: expectedValuePct !== null && expectedValuePct >= 5 ? "blue" : team.confidenceScore >= 75 && probability >= 65 ? "green" : "orange",
    sourceModule: "team_goal_probability", supportingData: team.supportingData, contradictingData: team.contradictingData, isSportsPick: !decimalOdds
  };
}

export function calculateTeamGoalProbability(dataset = {}) {
  const poisson = calculatePoissonModel(dataset);
  if (!["available", "partial"].includes(poisson.status)) return { status: "not_available", sourceModule: "team_goal_probability", source: "API-Football + modelo interno", teams: {}, picks: [], warning: "Probabilidad de gol no disponible: faltan datos ofensivos y defensivos suficientes.", generatedAt: new Date().toISOString() };
  const home = sideData(dataset, "home", poisson.lambdaHome);
  const away = sideData(dataset, "away", poisson.lambdaAway);
  const bttsSupport = poisson.probabilities.bttsYes >= 55 ? "supports_btts_yes" : poisson.probabilities.bttsNo >= 55 ? "supports_btts_no" : "neutral";
  const picks = [pickFromTeam(dataset, home, .5), pickFromTeam(dataset, home, 1.5), pickFromTeam(dataset, away, .5), pickFromTeam(dataset, away, 1.5)]
    .filter((pick) => pick.modelProbabilityPct >= 45 && pick.confidenceScore >= 45)
    .sort((a, b) => b.confidenceScore - a.confidenceScore);
  const confidenceScore = Math.min(home.confidenceScore, away.confidenceScore, poisson.dataQualityScore);
  const status = confidenceScore >= 70 && home.status === "available" && away.status === "available" ? "available" : "partial";
  const warnings = [...(poisson.warnings || [])];
  if (home.contradictingData.length || away.contradictingData.length) warnings.push("Existen señales ofensivas contradictorias; no usar una sola métrica como fundamento.");
  return { status, source: "API-Football + modelo interno", sourceModule: "team_goal_probability", modelVersion: "team-goal-probability-v1", fixtureId: String(dataset.fixture?.id || ""), teams: { home, away }, btts: { support: bttsSupport, yesProbabilityPct: poisson.probabilities.bttsYes, noProbabilityPct: poisson.probabilities.bttsNo }, picks, confidenceScore, warnings, warning: warnings.join(" "), generatedAt: new Date().toISOString() };
}
