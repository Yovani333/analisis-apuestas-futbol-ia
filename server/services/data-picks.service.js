import { calculatePoissonModel } from "./poisson-model.service.js";
import { calculateTeamGoalProbability } from "./team-goal-probability.service.js";

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));
const round = (value, digits = 1) => Number(Number(value).toFixed(digits));
const number = (value) => value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;

function existingMarket(dataset, selectionKey) {
  return (dataset.researchData?.odds?.markets || dataset.marketAnalysis || []).find((item) => item.selectionKey === selectionKey) || null;
}

function expectations(dataset) {
  const research = dataset.researchData || {};
  const xg = research.xgXga || {};
  const form = research.statsForm || {};
  const homeXg = number(xg.homeXG);
  const awayXg = number(xg.awayXG);
  const homeXga = number(xg.homeXGA);
  const awayXga = number(xg.awayXGA);
  const homeFallback = number(form.homeGoalsForAvg) ?? number(form.homeAverageGoals) ?? (number(form.homeGoalsFor) !== null ? number(form.homeGoalsFor) / Math.max(1, number(form.homePlayed) || 5) : null);
  const awayFallback = number(form.awayGoalsForAvg) ?? number(form.awayAverageGoals) ?? (number(form.awayGoalsFor) !== null ? number(form.awayGoalsFor) / Math.max(1, number(form.awayPlayed) || 5) : null);
  const home = homeXg !== null ? round(awayXga !== null ? (homeXg + awayXga) / 2 : homeXg, 2) : homeFallback;
  const away = awayXg !== null ? round(homeXga !== null ? (awayXg + homeXga) / 2 : awayXg, 2) : awayFallback;
  return { home, away, hasXg: homeXg !== null && awayXg !== null, xg, form };
}

function oneXtwo(dataset, expected) {
  const api = dataset.fixture?.favorite?.probabilities || dataset.researchData?.favorite?.probabilities || {};
  const apiValues = [number(api.home), number(api.draw), number(api.away)];
  if (apiValues.every((value) => value !== null)) {
    const total = apiValues.reduce((sum, value) => sum + value, 0) || 100;
    return { home: round(apiValues[0] * 100 / total), draw: round(apiValues[1] * 100 / total), away: round(apiValues[2] * 100 / total), source: "API-Football 1X2" };
  }
  if (expected.home === null || expected.away === null) return null;
  const difference = expected.home - expected.away;
  const draw = clamp(28 - Math.abs(difference) * 5, 18, 31);
  const home = clamp((100 - draw) / 2 + difference * 15, 12, 75);
  return { home: round(home), draw: round(draw), away: round(100 - home - draw), source: "modelo interno con forma/xG" };
}

function makePick(dataset, definition, probability, evidence, contradictions = []) {
  const quoted = existingMarket(dataset, definition.selectionKey);
  const odds = number(quoted?.decimalOdds);
  const implied = odds ? round(100 / odds) : null;
  const ev = odds ? round(probability * odds - 100) : null;
  const quality = clamp(dataset.researchData?.totalConfidenceScore ?? dataset.dataQuality?.score ?? 45);
  let confidence = clamp(quality * .48 + probability * .52 - contradictions.length * 9);
  if (!odds) confidence -= 3;
  if (definition.cap !== undefined) confidence = Math.min(confidence, definition.cap);
  confidence = round(clamp(confidence));
  let highlightColor = confidence >= 70 ? "green" : confidence >= 50 ? "orange" : "red";
  let level = highlightColor === "green" ? "Confiable" : highlightColor === "orange" ? "Conservador" : "Evitar";
  if (ev !== null && ev >= 5 && confidence >= 55 && contradictions.length === 0) { highlightColor = "blue"; level = "Value"; }
  if (ev !== null && ev < 0 && highlightColor === "blue") { highlightColor = "orange"; level = "Conservador"; }
  if (contradictions.length && ev !== null && ev > 0) { highlightColor = confidence >= 50 ? "orange" : "red"; level = "Riesgo"; }
  const explanation = `${definition.selection}: probabilidad estimada ${round(probability)}% con ${evidence.slice(0, 2).join("; ") || "respaldo estadístico parcial"}.${contradictions.length ? ` Precaución: ${contradictions.join("; ")}.` : ""}`;
  return {
    marketKey: definition.marketKey, selectionKey: definition.selectionKey, market: definition.market,
    selection: definition.selection, decimalOdds: odds, impliedProbabilityPct: implied,
    modelProbabilityPct: round(probability), estimatedProbabilityPct: round(probability), expectedValuePct: ev,
    confidenceScore: confidence, level, highlightColor, explanation,
    supportingData: evidence, contradictingData: contradictions,
    sourcesUsed: [...new Set([...(definition.sources || []), ...(quoted?.source ? [quoted.source] : [])])],
    sourceModule: "data_picks", status: confidence >= 50 ? "available" : "partial", isSportsPick: !odds
  };
}

export function generateDataPicks(dataset = {}) {
  const fixture = dataset.fixture || {};
  const expected = expectations(dataset);
  const probabilities = oneXtwo(dataset, expected);
  const quality = clamp(dataset.researchData?.totalConfidenceScore ?? dataset.dataQuality?.score ?? 0);
  const picks = [];
  const warnings = [];
  const xgSample = Math.min(number(expected.xg.sampleSizeHome) ?? number(expected.xg.sampleSize) ?? 0, number(expected.xg.sampleSizeAway) ?? number(expected.xg.sampleSize) ?? 0);
  if (!expected.hasXg) warnings.push("xG/xGA no disponible: se usó forma reciente y se redujo la confianza.");
  if (expected.hasXg && xgSample > 0 && xgSample < 5) warnings.push(`Muestra xG limitada: ${xgSample} partidos útiles.`);
  if (expected.home !== null && expected.away !== null) {
    const total = expected.home + expected.away;
    const over = clamp(20 + total * 15, 18, 82);
    const goalHome = clamp(35 + expected.home * 30, 20, 92);
    const goalAway = clamp(35 + expected.away * 30, 20, 92);
    const btts = clamp(goalHome * goalAway / 100, 15, 82);
    const source = expected.hasXg ? "xG/xGA estimado" : "promedio goleador reciente";
    const baseEvidence = [`${source} local ${round(expected.home, 2)}`, `${source} visitante ${round(expected.away, 2)}`, `total esperado ${round(total, 2)}`];
    const overContradictions = total <= 2.1 ? [`total esperado ${round(total, 2)} favorece un partido corto`] : [];
    const underContradictions = total >= 3 && expected.home >= 1 && expected.away >= 1 ? [`ambos equipos superan 1.0 y el total esperado es ${round(total, 2)}`] : [];
    picks.push(makePick(dataset, { marketKey: "over_under_2_5", selectionKey: "over_2_5", market: "Total de goles 2.5", selection: "Más de 2.5 goles", cap: overContradictions.length ? 59 : 100, sources: [source] }, over, baseEvidence, overContradictions));
    picks.push(makePick(dataset, { marketKey: "over_under_2_5", selectionKey: "under_2_5", market: "Total de goles 2.5", selection: "Menos de 2.5 goles", cap: underContradictions.length ? 59 : 100, sources: [source] }, 100 - over, baseEvidence, underContradictions));
    const bttsContradictions = Math.min(expected.home, expected.away) < .8 ? [`un equipo tiene expectativa menor a 0.80 (${round(Math.min(expected.home, expected.away), 2)})`] : [];
    picks.push(makePick(dataset, { marketKey: "btts", selectionKey: "btts_yes", market: "Ambos anotan", selection: "Sí", cap: bttsContradictions.length ? 49 : 100, sources: [source] }, btts, baseEvidence, bttsContradictions));
    picks.push(makePick(dataset, { marketKey: "btts", selectionKey: "btts_no", market: "Ambos anotan", selection: "No", sources: [source] }, 100 - btts, baseEvidence));
    for (const [side, label, expectation, goalProbability] of [["home", fixture.home || "Local", expected.home, goalHome], ["away", fixture.away || "Visitante", expected.away, goalAway]]) {
      picks.push(makePick(dataset, { marketKey: `${side}_team_goals`, selectionKey: `${side}_over_0_5`, market: `Goles de ${label}`, selection: `${label} más de 0.5`, sources: [source] }, goalProbability, [`expectativa ${label} ${round(expectation, 2)}`]));
      picks.push(makePick(dataset, { marketKey: `${side}_team_goals`, selectionKey: `${side}_over_1_5`, market: `Goles de ${label}`, selection: `${label} más de 1.5`, sources: [source] }, clamp((expectation - .25) * 38, 10, 82), [`expectativa ${label} ${round(expectation, 2)}`]));
    }
  }
  if (probabilities) {
    const values = [probabilities.home, probabilities.draw, probabilities.away];
    const sorted = [...values].sort((a, b) => b - a);
    const balanced = sorted[0] - sorted[1] < 8;
    const evidence = [`1X2 ${round(probabilities.home)}%-${round(probabilities.draw)}%-${round(probabilities.away)}%`, probabilities.source];
    for (const definition of [
      { selectionKey: "home_win", selection: `${fixture.home || "Local"} gana`, probability: probabilities.home },
      { selectionKey: "draw", selection: "Empate", probability: probabilities.draw },
      { selectionKey: "away_win", selection: `${fixture.away || "Visitante"} gana`, probability: probabilities.away }
    ]) picks.push(makePick(dataset, { marketKey: "match_winner", market: "Resultado 1X2", ...definition, cap: balanced ? 64 : 100, sources: [probabilities.source] }, definition.probability, evidence, balanced ? ["partido equilibrado; la victoria simple no debe tratarse como alta confianza"] : []));
    picks.push(makePick(dataset, { marketKey: "double_chance", selectionKey: "1X", market: "Doble oportunidad", selection: `${fixture.home || "Local"} o empate (1X)`, sources: [probabilities.source] }, probabilities.home + probabilities.draw, evidence));
    picks.push(makePick(dataset, { marketKey: "double_chance", selectionKey: "X2", market: "Doble oportunidad", selection: `${fixture.away || "Visitante"} o empate (X2)`, sources: [probabilities.source] }, probabilities.away + probabilities.draw, evidence));
  }
  const poisson = calculatePoissonModel(dataset);
  const teamGoals = calculateTeamGoalProbability(dataset);
  const poissonBySelection = new Map((poisson.suggestedMarkets || []).map((pick) => [pick.selectionKey, pick]));
  const teamGoalBySelection = new Map((teamGoals.picks || []).map((pick) => [pick.selectionKey, pick]));
  const combined = picks.map((pick) => {
    const signal = poissonBySelection.get(pick.selectionKey);
    const teamSignal = teamGoalBySelection.get(pick.selectionKey);
    if (!signal && !teamSignal) return pick;
    const comparisons = [signal, teamSignal].filter(Boolean);
    const differences = comparisons.map((item) => Math.abs(pick.modelProbabilityPct - item.modelProbabilityPct));
    const contradiction = differences.some((difference) => difference >= 15) ? [`Modelos internos difieren hasta ${round(Math.max(...differences))} puntos porcentuales`] : [];
    return {
      ...pick,
      confidenceScore: contradiction.length ? Math.max(0, pick.confidenceScore - 8) : Math.min(100, pick.confidenceScore + 3),
      supportingData: [...pick.supportingData, ...(signal ? [`Poisson ${signal.modelProbabilityPct}%`] : []), ...(teamSignal ? [`Gol por equipo ${teamSignal.modelProbabilityPct}%`] : [])],
      contradictingData: [...pick.contradictingData, ...contradiction],
      sourcesUsed: [...new Set([...pick.sourcesUsed, ...(signal ? ["Modelo Poisson interno"] : []), ...(teamSignal ? ["Probabilidad de Gol por Equipo"] : [])])]
    };
  });
  const ranked = combined.sort((a, b) => b.confidenceScore - a.confidenceScore || (b.expectedValuePct ?? -999) - (a.expectedValuePct ?? -999));
  return {
    status: ranked.length ? (quality >= 70 ? "available" : "partial") : "not_available",
    source: "API-Football + modelo interno", sourceModule: "data_picks", dataQualityScore: quality,
    fixtureId: String(fixture.id || ""), picks: ranked, warnings,
    poisson: { status: poisson.status, lambdaHome: poisson.lambdaHome ?? null, lambdaAway: poisson.lambdaAway ?? null, warning: poisson.warning || "" },
    teamGoalProbability: { status: teamGoals.status, confidenceScore: teamGoals.confidenceScore ?? 0, bttsSupport: teamGoals.btts?.support || "neutral", warning: teamGoals.warning || "" },
    generatedAt: new Date().toISOString()
  };
}
