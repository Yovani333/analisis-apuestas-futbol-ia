import { compareTeamsWithHistoricalStats } from "./simulation-comparator.service.js";
import { poissonProbability } from "./poisson-model.service.js";

const simulationCache = new Map();
const pendingSimulations = new Map();
const SIMULATION_CACHE_TTL_MS = 60 * 60 * 1000;
const round = (value, digits = 2) => Number(Number(value || 0).toFixed(digits));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const numeric = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number.parseFloat(String(value).replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
};

function metric(comparison, key) {
  return comparison?.metrics?.find((row) => row.key === key) || {};
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function cacheKey(input = {}) {
  const fixtureId = input.fixtureId || input.dataset?.fixture?.id || "";
  const teamAId = input.teamA?.id || input.dataset?.fixture?.homeTeamId || "";
  const teamBId = input.teamB?.id || input.dataset?.fixture?.awayTeamId || "";
  const fixtureDate = input.fixtureDate || input.dataset?.fixture?.utcDateTime || input.dataset?.fixture?.date || "";
  return [
    fixtureId || "manual",
    teamAId,
    teamBId,
    input.windowSize || 5,
    fixtureDate,
    input.competition || input.dataset?.fixture?.leagueName || ""
  ].map((value) => String(value || "").trim()).join("|");
}

function cacheInfo(status, key, expiresAt, reason) {
  return {
    status,
    source: "simulation-memory-cache",
    key,
    ttlMs: Math.max(0, (expiresAt || Date.now()) - Date.now()),
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : "",
    reason
  };
}

function normalizeThree(home, draw, away) {
  const values = [home, draw, away].map((value) => Math.max(0, Number(value) || 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!total) return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
  return { home: values[0] / total, draw: values[1] / total, away: values[2] / total };
}

function calculateElo(comparison) {
  const shots = metric(comparison, "shots");
  const shotsOnGoal = metric(comparison, "shotsOnGoal");
  const possession = metric(comparison, "possession");
  const passAccuracy = metric(comparison, "passAccuracy");
  const fouls = metric(comparison, "fouls");
  const cards = metric(comparison, "yellowCards");
  const corners = metric(comparison, "corners");
  const sample = Math.min(comparison.teamA?.matchesWithStatistics || 0, comparison.teamB?.matchesWithStatistics || 0);
  const diff =
    (numeric(shots.difference) || 0) * 7 +
    (numeric(shotsOnGoal.difference) || 0) * 14 +
    (numeric(possession.difference) || 0) * 1.2 +
    (numeric(passAccuracy.difference) || 0) * 2 +
    (numeric(corners.difference) || 0) * 4 -
    (numeric(fouls.difference) || 0) * 2.5 -
    (numeric(cards.difference) || 0) * 8;
  const homeAdvantage = 28;
  const qualityPenalty = sample < 5 ? (5 - sample) * 8 : 0;
  const teamA = round(1500 + diff / 2 + homeAdvantage / 2 - qualityPenalty / 2, 0);
  const teamB = round(1500 - diff / 2 - homeAdvantage / 2 - qualityPenalty / 2, 0);
  const difference = teamA - teamB;
  const expectedHome = 1 / (1 + 10 ** (-difference / 400));
  const draw = clamp(0.29 - Math.abs(difference) / 2200, 0.18, 0.31);
  const homeWin = expectedHome * (1 - draw);
  const awayWin = (1 - expectedHome) * (1 - draw);
  const probabilities = normalizeThree(homeWin, draw, awayWin);
  return {
    modelVersion: "elo-rule-based-v1",
    mode: "provisional_rule_based",
    teamA,
    teamB,
    difference,
    homeAdvantage,
    strengthClass: Math.abs(difference) >= 140 ? "brecha_alta" : Math.abs(difference) >= 70 ? "brecha_media" : "parejo",
    probabilities: {
      homeWin: round(probabilities.home * 100, 1),
      draw: round(probabilities.draw * 100, 1),
      awayWin: round(probabilities.away * 100, 1)
    },
    matchesUsed: sample,
    quality: sample >= 5 ? "available" : sample >= 3 ? "partial" : "low",
    notes: ["Elo provisional calculado con metricas historicas comparativas; no es rating oficial."]
  };
}

function lambdasFromComparison(comparison, dataset = {}) {
  const poisson = dataset.poissonModel;
  if (numeric(poisson?.lambdaHome) !== null && numeric(poisson?.lambdaAway) !== null) {
    return { home: numeric(poisson.lambdaHome), away: numeric(poisson.lambdaAway), source: "poisson_existente" };
  }
  const shots = metric(comparison, "shots");
  const sog = metric(comparison, "shotsOnGoal");
  const corners = metric(comparison, "corners");
  const home = 0.35 + (numeric(shots.teamA) || 0) * 0.055 + (numeric(sog.teamA) || 0) * 0.16 + (numeric(corners.teamA) || 0) * 0.025;
  const away = 0.35 + (numeric(shots.teamB) || 0) * 0.055 + (numeric(sog.teamB) || 0) * 0.16 + (numeric(corners.teamB) || 0) * 0.025;
  return { home: round(clamp(home, 0.15, 3.8)), away: round(clamp(away, 0.15, 3.8)), source: "comparador_historico" };
}

function calculateDixonColes(comparison, dataset = {}) {
  const lambdas = lambdasFromComparison(comparison, dataset);
  const rho = -0.08;
  const matrix = [];
  let total = 0;
  for (let homeGoals = 0; homeGoals <= 7; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= 7; awayGoals += 1) {
      let probability = poissonProbability(lambdas.home, homeGoals) * poissonProbability(lambdas.away, awayGoals);
      if (homeGoals === 0 && awayGoals === 0) probability *= 1 - lambdas.home * lambdas.away * rho;
      if (homeGoals === 0 && awayGoals === 1) probability *= 1 + lambdas.home * rho;
      if (homeGoals === 1 && awayGoals === 0) probability *= 1 + lambdas.away * rho;
      if (homeGoals === 1 && awayGoals === 1) probability *= 1 - rho;
      probability = Math.max(0, probability);
      total += probability;
      matrix.push({ homeGoals, awayGoals, probability });
    }
  }
  let homeWin = 0; let draw = 0; let awayWin = 0; let over25 = 0; let btts = 0;
  for (const row of matrix) {
    row.probability = total ? row.probability / total : 0;
    if (row.homeGoals > row.awayGoals) homeWin += row.probability;
    else if (row.homeGoals === row.awayGoals) draw += row.probability;
    else awayWin += row.probability;
    if (row.homeGoals + row.awayGoals > 2.5) over25 += row.probability;
    if (row.homeGoals > 0 && row.awayGoals > 0) btts += row.probability;
  }
  return {
    modelVersion: "dixon-coles-provisional-v1",
    mode: "provisional_rule_based",
    lambdaHome: lambdas.home,
    lambdaAway: lambdas.away,
    lambdaSource: lambdas.source,
    rho,
    probabilities: {
      homeWin: round(homeWin * 100, 1),
      draw: round(draw * 100, 1),
      awayWin: round(awayWin * 100, 1),
      over25: round(over25 * 100, 1),
      under25: round((1 - over25) * 100, 1),
      bttsYes: round(btts * 100, 1),
      bttsNo: round((1 - btts) * 100, 1)
    },
    likelyScores: matrix.sort((a, b) => b.probability - a.probability).slice(0, 6).map((row) => ({
      score: `${row.homeGoals}-${row.awayGoals}`,
      probabilityPct: round(row.probability * 100, 1)
    })),
    goalMatrix: matrix.map((row) => ({ ...row, probabilityPct: round(row.probability * 100, 3) })),
    comparisonWithPoisson: dataset.poissonModel?.probabilities ? {
      poissonHomeWin: dataset.poissonModel.probabilities.homeWin,
      dixonColesHomeWin: round(homeWin * 100, 1),
      note: "Dixon-Coles ajusta marcadores bajos; Poisson se conserva como referencia existente."
    } : null
  };
}

function applyContext(base, comparison, dataset = {}) {
  const warnings = [];
  const variablesAvailable = [];
  const variablesMissing = [];
  const adjustments = { home: 0, draw: 0, away: 0 };
  const sample = Math.min(comparison.teamA?.matchesWithStatistics || 0, comparison.teamB?.matchesWithStatistics || 0);
  if (sample < 5) {
    warnings.push("Muestra historica reducida.");
    variablesMissing.push("Muestra completa de 5+ partidos");
    adjustments.draw += 1.5;
  } else variablesAvailable.push("Muestra historica suficiente");
  const quality = numeric(dataset.dataQuality?.score);
  if (quality !== null) variablesAvailable.push("Calidad de datos global");
  else variablesMissing.push("Score global de calidad");
  if (dataset.fixture?.neutralVenue) {
    variablesAvailable.push("Sede neutral");
    adjustments.home -= 2;
    adjustments.away += 1;
  } else variablesMissing.push("Confirmacion de sede neutral/local");
  if (!dataset.confirmed?.lineups?.length) {
    warnings.push("Alineaciones no confirmadas.");
    variablesMissing.push("Alineaciones confirmadas");
  } else variablesAvailable.push("Alineaciones");
  if (!dataset.researchData?.xgXga || dataset.researchData.xgXga.status === "not_available") {
    warnings.push("xG/xGA no disponible o parcial.");
    variablesMissing.push("xG/xGA completo");
  } else variablesAvailable.push("xG/xGA estimado");
  if (dataset.fixture?.leagueSlug === "world-cup" || /mundial|world cup/i.test(dataset.fixture?.leagueName || comparison.competition || "")) {
    warnings.push("Torneo corto / Mundial: usar cautela adicional.");
    adjustments.draw += 1;
  }
  const before = { ...base };
  const after = normalizeThree(base.homeWin + adjustments.home, base.draw + adjustments.draw, base.awayWin + adjustments.away);
  return {
    mode: "rule_based",
    variablesAvailable,
    variablesMissing,
    positiveAdjustments: Object.entries(adjustments).filter(([, value]) => value > 0).map(([key, value]) => `${key} +${value}`),
    negativeAdjustments: Object.entries(adjustments).filter(([, value]) => value < 0).map(([key, value]) => `${key} ${value}`),
    probabilityBefore: before,
    probabilityAfter: {
      homeWin: round(after.home * 100, 1),
      draw: round(after.draw * 100, 1),
      awayWin: round(after.away * 100, 1)
    },
    warnings
  };
}

function oddsRows(dataset = {}) {
  return [...(dataset.researchData?.odds?.markets || []), ...(dataset.marketAnalysis || [])]
    .filter((row, index, list) => row?.selectionKey && numeric(row.decimalOdds) > 1 && list.findIndex((item) => item.selectionKey === row.selectionKey) === index);
}

function compareMarket(finalProbabilities, dataset = {}) {
  const probabilities = {
    home_win: finalProbabilities.homeWin,
    draw: finalProbabilities.draw,
    away_win: finalProbabilities.awayWin,
    over_2_5: finalProbabilities.over25,
    under_2_5: finalProbabilities.under25,
    btts_yes: finalProbabilities.bttsYes,
    btts_no: finalProbabilities.bttsNo
  };
  return oddsRows(dataset)
    .filter((row) => probabilities[row.selectionKey] !== undefined)
    .map((row) => {
      const probability = numeric(probabilities[row.selectionKey]);
      const decimalOdds = numeric(row.decimalOdds);
      const fairOdds = probability ? round(100 / probability) : null;
      const impliedProbabilityPct = decimalOdds ? round(100 / decimalOdds, 1) : null;
      const edgePct = impliedProbabilityPct === null ? null : round(probability - impliedProbabilityPct, 1);
      const expectedValuePct = decimalOdds ? round(probability / 100 * decimalOdds * 100 - 100, 1) : null;
      const state = expectedValuePct === null ? "sin_cuota" : expectedValuePct >= 8 && probability >= 55 ? "valor_revisar" : expectedValuePct >= 0 ? "observacion" : "sin_valor";
      return {
        market: row.market,
        selection: row.selection,
        selectionKey: row.selectionKey,
        decimalOdds,
        modelProbabilityPct: probability,
        fairOdds,
        impliedProbabilityPct,
        edgePct,
        expectedValuePct,
        status: state
      };
    })
    .sort((a, b) => (b.expectedValuePct ?? -999) - (a.expectedValuePct ?? -999));
}

function chooseDecision(marketComparison, finalProbabilities, warnings) {
  const best = marketComparison.find((row) => row.status === "valor_revisar");
  if (!best) {
    const topSide = Object.entries({ home_win: finalProbabilities.homeWin, draw: finalProbabilities.draw, away_win: finalProbabilities.awayWin }).sort((a, b) => b[1] - a[1])[0];
    return {
      pick: "No existe una apuesta recomendable",
      market: "Sin mercado",
      selectionKey: "no_bet",
      probabilityPct: round(topSide?.[1] || 0, 1),
      decimalOdds: null,
      edgePct: null,
      expectedValuePct: null,
      confidence: warnings.length ? "Media-baja" : "Media",
      risk: warnings.length ? "Alto" : "Medio",
      decision: "no_bet",
      explanation: "El modelo puede ordenar probabilidades, pero no encontro valor suficiente contra cuotas disponibles."
    };
  }
  const conservative = warnings.length || best.modelProbabilityPct < 60;
  return {
    pick: best.selection,
    market: best.market,
    selectionKey: best.selectionKey,
    probabilityPct: best.modelProbabilityPct,
    decimalOdds: best.decimalOdds,
    edgePct: best.edgePct,
    expectedValuePct: best.expectedValuePct,
    confidence: conservative ? "Media" : "Alta",
    risk: conservative ? "Medio" : "Controlado",
    decision: conservative ? "apuesta_con_valor_pero_riesgo_alto" : "apuesta_recomendada",
    explanation: conservative
      ? "Tiene valor matematico, pero requiere revision por advertencias o confianza moderada."
      : "Tiene EV positivo, probabilidad suficiente y menor contradiccion contextual."
  };
}

async function calculateAdvancedSimulation(input, dependencies, key) {
  const comparison = await compareTeamsWithHistoricalStats(input, dependencies);
  if (!comparison.metrics?.length) {
    return {
      status: "not_available",
      message: comparison.message || "No hay datos historicos suficientes para simular.",
      comparison,
      warnings: comparison.warnings || []
    };
  }
  const dataset = input.dataset || {};
  const elo = calculateElo(comparison);
  const dixonColes = calculateDixonColes(comparison, dataset);
  const base = normalizeThree(
    (elo.probabilities.homeWin + dixonColes.probabilities.homeWin) / 2,
    (elo.probabilities.draw + dixonColes.probabilities.draw) / 2,
    (elo.probabilities.awayWin + dixonColes.probabilities.awayWin) / 2
  );
  const basePct = { homeWin: base.home * 100, draw: base.draw * 100, awayWin: base.away * 100 };
  const context = applyContext(basePct, comparison, dataset);
  const finalProbabilities = {
    homeWin: context.probabilityAfter.homeWin,
    draw: context.probabilityAfter.draw,
    awayWin: context.probabilityAfter.awayWin,
    over25: dixonColes.probabilities.over25,
    under25: dixonColes.probabilities.under25,
    bttsYes: dixonColes.probabilities.bttsYes,
    bttsNo: dixonColes.probabilities.bttsNo
  };
  const marketComparison = compareMarket(finalProbabilities, dataset);
  const warnings = [...(comparison.warnings || []), ...context.warnings, "Regresion ordinal no entrenada: se usa ajuste contextual rule_based."];
  const decision = chooseDecision(marketComparison, finalProbabilities, warnings);
  const result = {
    status: comparison.status === "not_available" ? "partial" : comparison.status,
    source: "API-Football + cache interna + modelos internos",
    modelVersion: "advanced-simulation-v1",
    generatedAt: new Date().toISOString(),
    comparison,
    summary: decision,
    elo,
    dixonColes,
    context,
    finalProbabilities,
    marketComparison,
    warnings,
    audit: {
      fixtureId: input.fixtureId || dataset.fixture?.id || "",
      teams: { home: comparison.teamA?.name, away: comparison.teamB?.name },
      versions: {
        elo: elo.modelVersion,
        dixonColes: dixonColes.modelVersion,
        context: "context-rule-based-v1"
      },
      cachePolicy: "Reutiliza dataset normalizado y cache de API-Football; no recalcula datos finalizados si siguen vigentes en cache.",
      dataMissing: context.variablesMissing
    }
  };
  const expiresAt = Date.now() + SIMULATION_CACHE_TTL_MS;
  return { ...result, cached: false, cacheInfo: cacheInfo("miss", key, expiresAt, "simulation_calculada_y_guardada") };
}

export async function runAdvancedSimulation(input, dependencies, options = {}) {
  const key = cacheKey(input);
  const cached = simulationCache.get(key);
  if (!options.forceRefresh && cached?.expiresAt > Date.now()) {
    return { ...clone(cached.value), cached: true, cacheInfo: cacheInfo("hit", key, cached.expiresAt, "simulation_reutilizada_sin_nuevas_consultas") };
  }
  if (!options.forceRefresh && pendingSimulations.has(key)) {
    const value = await pendingSimulations.get(key);
    return { ...clone(value), cached: true, cacheInfo: cacheInfo("pending_hit", key, Date.now() + SIMULATION_CACHE_TTL_MS, "solicitud_en_curso_reutilizada") };
  }
  const request = calculateAdvancedSimulation(input, dependencies, key).then((value) => {
    if (value.status !== "not_available") {
      simulationCache.set(key, { value, expiresAt: Date.now() + SIMULATION_CACHE_TTL_MS });
    }
    return value;
  }).finally(() => pendingSimulations.delete(key));
  pendingSimulations.set(key, request);
  return request;
}

export const __advancedSimulationInternals = {
  calculateElo,
  calculateDixonColes,
  applyContext,
  compareMarket,
  normalizeThree,
  cacheKey,
  simulationCache
};
