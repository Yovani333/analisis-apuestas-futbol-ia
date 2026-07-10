import { calculatePoissonModel } from "./poisson-model.service.js";
import { resolveModuleQuality } from "./module-quality.service.js";

const round = (value, digits = 1) => Number(Number(value || 0).toFixed(digits));
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));
const numeric = (value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);

function normalizeThree(home, draw, away) {
  const values = [numeric(home), numeric(draw), numeric(away)];
  if (!values.every((value) => value !== null && value >= 0)) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  return { home: round(values[0] * 100 / total), draw: round(values[1] * 100 / total), away: round(values[2] * 100 / total) };
}

function probabilityFromFavorite(dataset) {
  const raw = dataset.fixture?.favorite?.probabilities || dataset.researchData?.favorite?.probabilities || {};
  const probabilities = normalizeThree(raw.home, raw.draw, raw.away);
  return probabilities ? { source: "API-Football 1X2", weight: 1, probabilities } : null;
}

function probabilityFromPoisson(dataset) {
  const poisson = dataset.poissonModel || calculatePoissonModel(dataset);
  const probabilities = normalizeThree(poisson.probabilities?.homeWin, poisson.probabilities?.draw, poisson.probabilities?.awayWin);
  return probabilities ? { source: "Modelo Poisson", weight: poisson.status === "available" ? .9 : .65, probabilities, poisson } : { poisson };
}

function probabilityFromOdds(dataset) {
  const markets = [...(dataset.researchData?.odds?.markets || []), ...(dataset.marketAnalysis || [])];
  const byKey = (key) => markets.find((item) => item.selectionKey === key && numeric(item.decimalOdds) > 1);
  const home = byKey("home_win");
  const draw = byKey("draw");
  const away = byKey("away_win");
  const probabilities = normalizeThree(100 / numeric(home?.decimalOdds), 100 / numeric(draw?.decimalOdds), 100 / numeric(away?.decimalOdds));
  return probabilities ? { source: "Cuotas 1X2 sin margen", weight: .75, probabilities, odds: { home, draw, away } } : null;
}

function probabilityFromExpectedGoals(dataset) {
  const research = dataset.researchData || {};
  const xg = research.xgXga || {};
  const form = research.statsForm || {};
  const homeXg = numeric(xg.homeXG);
  const awayXg = numeric(xg.awayXG);
  const homeForm = numeric(form.homeGoalsForAvg) ?? numeric(form.homeAverageGoals);
  const awayForm = numeric(form.awayGoalsForAvg) ?? numeric(form.awayAverageGoals);
  const home = homeXg ?? homeForm;
  const away = awayXg ?? awayForm;
  if (home === null || away === null) return null;
  const diff = home - away;
  const draw = clamp(28 - Math.abs(diff) * 5, 18, 32);
  const homeWin = clamp((100 - draw) / 2 + diff * 16, 12, 76);
  const probabilities = normalizeThree(homeWin, draw, 100 - homeWin - draw);
  return probabilities ? { source: homeXg !== null && awayXg !== null ? "xG/xGA estimado" : "Forma goleadora reciente", weight: homeXg !== null && awayXg !== null ? .8 : .55, probabilities } : null;
}

function weightedAverage(sources) {
  const usable = sources.filter(Boolean).filter((item) => item.probabilities);
  if (!usable.length) return null;
  const weightTotal = usable.reduce((sum, item) => sum + item.weight, 0);
  return normalizeThree(
    usable.reduce((sum, item) => sum + item.probabilities.home * item.weight, 0) / weightTotal,
    usable.reduce((sum, item) => sum + item.probabilities.draw * item.weight, 0) / weightTotal,
    usable.reduce((sum, item) => sum + item.probabilities.away * item.weight, 0) / weightTotal
  );
}

function contradictionsFor(key, sources, modelProbability) {
  const rows = sources.filter(Boolean).filter((item) => item.probabilities);
  const values = rows.map((item) => item.probabilities[key]);
  const spread = values.length ? Math.max(...values) - Math.min(...values) : 0;
  const contradictions = [];
  if (spread >= 18) contradictions.push(`Modelos/fuentes difieren ${round(spread)} puntos en este resultado.`);
  if (modelProbability < 33 && rows.some((item) => item.probabilities[key] >= 45)) contradictions.push("Una fuente favorece el escenario, pero el consenso no lo confirma.");
  return contradictions;
}

function oddsFor(key, oddsSource, dataset) {
  const selectionKey = key === "home" ? "home_win" : key === "draw" ? "draw" : "away_win";
  const markets = [...(dataset.researchData?.odds?.markets || []), ...(dataset.marketAnalysis || [])];
  const row = oddsSource?.odds?.[key === "home" ? "home" : key === "draw" ? "draw" : "away"]
    || markets.find((item) => item.selectionKey === selectionKey && numeric(item.decimalOdds) > 1);
  const decimalOdds = numeric(row?.decimalOdds);
  return decimalOdds ? { decimalOdds, impliedProbabilityPct: round(100 / decimalOdds), bookmaker: row.bookmaker || "API-Football" } : { decimalOdds: null, impliedProbabilityPct: null, bookmaker: "" };
}

function scenarioDecision({ key, probability, leaderKey, gap, quality, ev, contradictions, missingCriticalData }) {
  if (missingCriticalData) return "datos_insuficientes";
  if (contradictions.length >= 2) return "modelos_contradictorios";
  if (key !== leaderKey) return "solo_observacion";
  if (gap < 6) return "no_bet";
  if (contradictions.length) return "modelos_contradictorios";
  if (ev !== null && ev > 4 && quality >= 60 && probability >= 42) return "apuesta_recomendada";
  if (ev !== null && ev > 0 && probability >= 38) return "apuesta_con_valor_pero_riesgo_alto";
  if (ev !== null && ev <= 0) return "sin_valor";
  return quality >= 55 && probability >= 42 ? "solo_observacion" : "no_bet";
}

function decisionLabel(decision) {
  return {
    apuesta_recomendada: "Apuesta recomendada",
    apuesta_con_valor_pero_riesgo_alto: "Valor con riesgo alto",
    solo_observacion: "Solo observacion",
    datos_insuficientes: "Datos insuficientes",
    modelos_contradictorios: "Modelos contradictorios",
    sin_valor: "Sin valor",
    no_bet: "No bet"
  }[decision] || "No bet";
}

export function buildOutcomeScenarios(dataset = {}) {
  const fixture = dataset.fixture || {};
  const favoriteSource = probabilityFromFavorite(dataset);
  const poissonSource = probabilityFromPoisson(dataset);
  const oddsSource = probabilityFromOdds(dataset);
  const expectedSource = probabilityFromExpectedGoals(dataset);
  const sources = [favoriteSource, poissonSource, oddsSource, expectedSource].filter((item) => item?.probabilities);
  const probabilities = weightedAverage(sources);
  const missingData = [];
  if (!favoriteSource) missingData.push("Probabilidades API-Football 1X2");
  if (!poissonSource?.probabilities) missingData.push("Modelo Poisson");
  if (!oddsSource) missingData.push("Cuotas 1X2 completas");
  if (!expectedSource) missingData.push("xG/forma goleadora");
  if (!probabilities) {
    return {
      status: "not_available", fixtureId: String(fixture.id || ""), source: "API-Football + modelos internos",
      scenarios: [], decision: "datos_insuficientes", decisionLabel: decisionLabel("datos_insuficientes"),
      missingData, supportingData: [], contradictions: [], generatedAt: new Date().toISOString(),
      quality: resolveModuleQuality({ status: "not_available", score: 0, notes: missingData })
    };
  }
  const quality = clamp(dataset.researchData?.totalConfidenceScore ?? dataset.dataQuality?.score ?? 45);
  const entries = [
    ["home", `${fixture.home || "Local"} gana`],
    ["draw", "Empate"],
    ["away", `${fixture.away || "Visitante"} gana`]
  ];
  const ordered = [...entries].sort((a, b) => probabilities[b[0]] - probabilities[a[0]]);
  const leaderKey = ordered[0][0];
  const gap = probabilities[ordered[0][0]] - probabilities[ordered[1][0]];
  const missingCriticalData = sources.length < 2;
  const scenarios = entries.map(([key, label]) => {
    const market = oddsFor(key, oddsSource, dataset);
    const probability = probabilities[key];
    const ev = market.decimalOdds ? round(probability * market.decimalOdds - 100) : null;
    const contradictions = contradictionsFor(key, sources, probability);
    const decision = scenarioDecision({ key, probability, leaderKey, gap, quality, ev, contradictions, missingCriticalData });
    const confidenceScore = round(clamp(quality * .45 + probability * .35 + Math.max(0, gap) * .2 - contradictions.length * 12), 0);
    return {
      key, label, probabilityPct: round(probability), marketProbabilityPct: market.impliedProbabilityPct,
      decimalOdds: market.decimalOdds, bookmaker: market.bookmaker, expectedValuePct: ev,
      footballConfidenceScore: confidenceScore, risk: contradictions.length ? "medium" : gap < 6 ? "high" : confidenceScore >= 65 ? "low" : "medium",
      decision, decisionLabel: decisionLabel(decision), supportingData: sources.map((item) => `${item.source}: ${round(item.probabilities[key])}%`),
      contradictingData: contradictions, missingData
    };
  });
  const leader = scenarios.find((item) => item.key === leaderKey);
  const globalDecision = leader?.decision || "no_bet";
  const status = sources.length >= 3 && quality >= 60 ? "available" : "partial";
  return {
    status, fixtureId: String(fixture.id || ""), source: "API-Football + modelos internos",
    modelVersion: "outcome-scenarios-v1", probabilities, scenarios, resultMostLikely: leader?.label || "",
    confidenceScore: leader?.footballConfidenceScore || 0, risk: leader?.risk || "high",
    decision: globalDecision, decisionLabel: decisionLabel(globalDecision),
    supportingData: sources.map((item) => item.source), contradictions: [...new Set(scenarios.flatMap((item) => item.contradictingData))],
    missingData, warning: "Se muestran siempre las tres posibilidades 1X2. EV positivo no decide por si solo; si hay paridad o contradiccion, el resultado queda como observacion o no bet.",
    quality: resolveModuleQuality({ status, score: sources.length >= 2 ? quality : 0, notes: missingData }),
    generatedAt: new Date().toISOString()
  };
}
