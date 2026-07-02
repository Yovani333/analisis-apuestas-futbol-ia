import { resolveModuleQuality } from "./module-quality.service.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = (value, digits = 2) => Number(value.toFixed(digits));
const numeric = (value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);

export function poissonProbability(lambda, goals) {
  if (!(lambda >= 0) || goals < 0 || !Number.isInteger(goals)) return 0;
  let factorial = 1;
  for (let index = 2; index <= goals; index += 1) factorial *= index;
  return Math.exp(-lambda) * (lambda ** goals) / factorial;
}

function recentAverage(form, side, type) {
  const direct = numeric(form?.[`${side}${type}Avg`]) ?? numeric(form?.[`${side}Average${type}`]);
  if (direct !== null) return direct;
  const total = numeric(form?.[`${side}${type}`]);
  const played = numeric(form?.[`${side}Played`]) || form?.[`${side}LastMatches`]?.length || 5;
  return total === null ? null : total / Math.max(1, played);
}

function calculateLambdas(dataset) {
  const research = dataset.researchData || {};
  const xg = research.xgXga || {};
  const form = research.statsForm || {};
  const xgValues = {
    homeFor: numeric(xg.homeXG), homeAgainst: numeric(xg.homeXGA),
    awayFor: numeric(xg.awayXG), awayAgainst: numeric(xg.awayXGA)
  };
  const formValues = {
    homeFor: recentAverage(form, "home", "GoalsFor"), homeAgainst: recentAverage(form, "home", "GoalsAgainst"),
    awayFor: recentAverage(form, "away", "GoalsFor"), awayAgainst: recentAverage(form, "away", "GoalsAgainst")
  };
  const homeInputs = [xgValues.homeFor, xgValues.awayAgainst].filter((value) => value !== null);
  const awayInputs = [xgValues.awayFor, xgValues.homeAgainst].filter((value) => value !== null);
  if (!homeInputs.length) [formValues.homeFor, formValues.awayAgainst].filter((value) => value !== null).forEach((value) => homeInputs.push(value));
  if (!awayInputs.length) [formValues.awayFor, formValues.homeAgainst].filter((value) => value !== null).forEach((value) => awayInputs.push(value));
  if (!homeInputs.length || !awayInputs.length) return null;
  let home = homeInputs.reduce((sum, value) => sum + value, 0) / homeInputs.length;
  let away = awayInputs.reduce((sum, value) => sum + value, 0) / awayInputs.length;
  if (!dataset.fixture?.neutralVenue) { home *= 1.06; away *= .97; }
  return {
    home: round(clamp(home, .05, 4.5)), away: round(clamp(away, .05, 4.5)),
    usedXg: homeInputs.some((value) => Object.values(xgValues).includes(value)) && awayInputs.some((value) => Object.values(xgValues).includes(value)),
    xgValues, formValues
  };
}

function marketOdds(dataset, selectionKey) {
  const row = (dataset.researchData?.odds?.markets || dataset.marketAnalysis || []).find((item) => item.selectionKey === selectionKey);
  return numeric(row?.decimalOdds);
}

function marketPick(dataset, definition, probability, quality) {
  const decimalOdds = marketOdds(dataset, definition.selectionKey);
  const impliedProbabilityPct = decimalOdds ? round(100 / decimalOdds, 1) : null;
  const expectedValuePct = decimalOdds ? round(probability * decimalOdds - 100, 1) : null;
  const confidenceScore = round(clamp(quality * .55 + probability * .45, 0, 100), 0);
  return {
    marketKey: definition.marketKey, selectionKey: definition.selectionKey,
    market: definition.market, selection: definition.selection,
    probabilityPct: round(probability, 1), modelProbabilityPct: round(probability, 1),
    decimalOdds, impliedProbabilityPct, expectedValuePct, confidenceScore,
    level: confidenceScore >= 75 ? "Confiable" : confidenceScore >= 55 ? "Conservador" : "Riesgo",
    highlightColor: expectedValuePct !== null && expectedValuePct >= 5 && confidenceScore >= 60 ? "blue" : confidenceScore >= 75 ? "green" : "orange",
    sourceModule: "poisson", supportingData: definition.supportingData,
    contradictingData: definition.contradictingData || [], isSportsPick: !decimalOdds
  };
}

export function calculatePoissonModel(dataset = {}) {
  const fixture = dataset.fixture || {};
  const lambdas = calculateLambdas(dataset);
  if (!lambdas) return {
    status: "not_available", source: "modelo-poisson-interno", sourceModule: "poisson",
    fixtureId: String(fixture.id || ""), warning: "Modelo Poisson no disponible: faltan xG/xGA y promedios recientes suficientes.",
    probabilities: {}, likelyScores: [], suggestedMarkets: [], quality: resolveModuleQuality({ status: "not_available" }), generatedAt: new Date().toISOString()
  };
  const matrix = [];
  let homeWin = 0; let draw = 0; let awayWin = 0; let over05 = 0; let over15 = 0; let over25 = 0; let under25 = 0; let under35 = 0; let bttsYes = 0;
  for (let homeGoals = 0; homeGoals <= 10; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= 10; awayGoals += 1) {
      const probability = poissonProbability(lambdas.home, homeGoals) * poissonProbability(lambdas.away, awayGoals);
      matrix.push({ homeGoals, awayGoals, probability });
      if (homeGoals > awayGoals) homeWin += probability; else if (homeGoals === awayGoals) draw += probability; else awayWin += probability;
      const total = homeGoals + awayGoals;
      if (total > .5) over05 += probability;
      if (total > 1.5) over15 += probability;
      if (total > 2.5) over25 += probability; else under25 += probability;
      if (total < 3.5) under35 += probability;
      if (homeGoals > 0 && awayGoals > 0) bttsYes += probability;
    }
  }
  const pct = (value) => round(value * 100, 1);
  const probabilities = {
    homeWin: pct(homeWin), draw: pct(draw), awayWin: pct(awayWin),
    doubleChance1X: pct(homeWin + draw), doubleChanceX2: pct(awayWin + draw),
    over05: pct(over05), over15: pct(over15), over25: pct(over25),
    under25: pct(under25), under35: pct(under35), bttsYes: pct(bttsYes), bttsNo: pct(1 - bttsYes)
  };
  const sampleSize = Math.min(numeric(dataset.researchData?.xgXga?.homeSampleSize) ?? numeric(dataset.researchData?.xgXga?.sampleSize) ?? 0, numeric(dataset.researchData?.xgXga?.awaySampleSize) ?? numeric(dataset.researchData?.xgXga?.sampleSize) ?? 0);
  let quality = numeric(dataset.researchData?.totalConfidenceScore) ?? numeric(dataset.dataQuality?.score) ?? 45;
  const warnings = [];
  if (!lambdas.usedXg) { quality -= 18; warnings.push("xG/xGA incompleto: lambdas calculadas con forma goleadora reciente."); }
  if (sampleSize > 0 && sampleSize < 5) { quality -= 15; warnings.push(`Muestra limitada: ${sampleSize} partidos útiles.`); }
  if (fixture.leagueSlug === "world-cup" && sampleSize < 5) warnings.push("Mundial o torneo corto: interpretar el modelo con cautela.");
  quality = round(clamp(quality, 0, 100), 0);
  const status = quality >= 70 ? "available" : quality >= 35 ? "partial" : "not_available";
  const baseSupport = [`λ ${fixture.home || "Local"} ${lambdas.home}`, `λ ${fixture.away || "Visitante"} ${lambdas.away}`];
  const definitions = [
    ["match_winner", "home_win", "Resultado 1X2", `${fixture.home || "Local"} gana`, probabilities.homeWin],
    ["match_winner", "draw", "Resultado 1X2", "Empate", probabilities.draw],
    ["match_winner", "away_win", "Resultado 1X2", `${fixture.away || "Visitante"} gana`, probabilities.awayWin],
    ["double_chance", "1X", "Doble oportunidad", `${fixture.home || "Local"} o empate (1X)`, probabilities.doubleChance1X],
    ["double_chance", "X2", "Doble oportunidad", `${fixture.away || "Visitante"} o empate (X2)`, probabilities.doubleChanceX2],
    ["over_under_2_5", "over_2_5", "Total de goles 2.5", "Más de 2.5 goles", probabilities.over25],
    ["over_under_2_5", "under_2_5", "Total de goles 2.5", "Menos de 2.5 goles", probabilities.under25],
    ["under_3_5", "under_3_5", "Total de goles 3.5", "Menos de 3.5 goles", probabilities.under35],
    ["btts", "btts_yes", "Ambos anotan", "Sí", probabilities.bttsYes],
    ["btts", "btts_no", "Ambos anotan", "No", probabilities.bttsNo]
  ];
  const suggestedMarkets = definitions
    .filter(([, , , , probability]) => probability >= 55 && status !== "not_available")
    .map(([marketKey, selectionKey, market, selection, probability]) => marketPick(dataset, { marketKey, selectionKey, market, selection, supportingData: [...baseSupport, `Poisson ${probability}%`] }, probability, quality))
    .sort((a, b) => b.confidenceScore - a.confidenceScore).slice(0, 6);
  const moduleQuality = resolveModuleQuality({ score: quality, status, notes: warnings });
  return {
    status, source: "API-Football + modelo Poisson interno", sourceModule: "poisson", modelVersion: "poisson-v1",
    fixtureId: String(fixture.id || ""), lambdaHome: lambdas.home, lambdaAway: lambdas.away,
    probabilities, likelyScores: matrix.sort((a, b) => b.probability - a.probability).slice(0, 5).map((row) => ({ score: `${row.homeGoals}-${row.awayGoals}`, probabilityPct: pct(row.probability) })),
    suggestedMarkets, dataQualityScore: quality, quality: moduleQuality, statusLabel: status === "available" ? "Disponible" : status === "partial" ? "Parcial" : "No disponible",
    warnings, warning: warnings.join(" "), generatedAt: new Date().toISOString()
  };
}
