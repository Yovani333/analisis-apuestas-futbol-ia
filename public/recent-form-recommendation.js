const RECENCY_WEIGHTS = Object.freeze([1, 0.9, 0.8, 0.7, 0.6]);
const VALID_RESULTS = new Set(["W", "D", "L"]);
const VALID_VENUES = new Set(["Local", "Visitante"]);
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);

function numeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 1) {
  return Number(Number(value || 0).toFixed(digits));
}

function percent(value) {
  return round(value * 100, 1);
}

function normalizeMatches(rows, expectedSide, cutoff) {
  const unique = new Map();
  const warnings = [];
  let invalidCount = 0;
  let duplicateCount = 0;

  for (const raw of Array.isArray(rows) ? rows : []) {
    const fixtureId = String(raw?.fixtureId || "").trim();
    const dateTime = timestamp(raw?.date);
    const goalsFor = numeric(raw?.goalsFor);
    const goalsAgainst = numeric(raw?.goalsAgainst);
    const venue = raw?.venue;
    const computedResult = goalsFor === null || goalsAgainst === null ? null
      : goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D";
    const result = String(raw?.result || computedResult || "").toUpperCase();
    const statusShort = String(raw?.statusShort || "FT").toUpperCase();
    const invalid = !fixtureId || dateTime === null || dateTime >= cutoff
      || goalsFor === null || goalsAgainst === null || !VALID_RESULTS.has(result)
      || !VALID_VENUES.has(venue) || result !== computedResult || !FINISHED_STATUSES.has(statusShort);
    if (invalid) {
      invalidCount += 1;
      continue;
    }
    if (unique.has(fixtureId)) {
      duplicateCount += 1;
      continue;
    }
    unique.set(fixtureId, {
      fixtureId,
      date: raw.date,
      dateTime,
      opponent: raw.opponent || "No disponible",
      venue,
      goalsFor,
      goalsAgainst,
      result,
      statusShort,
      competition: raw.competition || "No disponible",
      expectedSide
    });
  }

  if (invalidCount) warnings.push(`${invalidCount} partido(s) se excluyeron por fecha, marcador, localía o resultado inválido.`);
  if (duplicateCount) warnings.push(`${duplicateCount} fixture(s) duplicados se excluyeron de la muestra.`);
  const matches = [...unique.values()].sort((a, b) => b.dateTime - a.dateTime).slice(0, 5)
    .map((match, index) => ({
      ...match,
      recencyWeight: RECENCY_WEIGHTS[index],
      localityFactor: match.venue === expectedSide ? 1 : 0.75,
      weight: RECENCY_WEIGHTS[index] * (match.venue === expectedSide ? 1 : 0.75)
    }));
  return { matches, warnings, invalidCount, duplicateCount };
}

function weightedRate(matches, predicate) {
  const totalWeight = matches.reduce((total, match) => total + match.weight, 0);
  const weightedHits = matches.reduce((total, match) => total + (predicate(match) ? match.weight : 0), 0);
  const hits = matches.filter(predicate).length;
  return {
    hits,
    simpleRate: matches.length ? hits / matches.length : 0,
    weightedRate: totalWeight ? weightedHits / totalWeight : 0
  };
}

function teamMetrics(matches, contextualVenue) {
  const totalWeight = matches.reduce((total, match) => total + match.weight, 0);
  const weightedAverage = (selector) => totalWeight
    ? matches.reduce((total, match) => total + selector(match) * match.weight, 0) / totalWeight
    : 0;
  const wins = weightedRate(matches, (match) => match.result === "W");
  const nonLoss = weightedRate(matches, (match) => match.result !== "L");
  const scored = weightedRate(matches, (match) => match.goalsFor > 0);
  const cleanSheets = weightedRate(matches, (match) => match.goalsAgainst === 0);
  const btts = weightedRate(matches, (match) => match.goalsFor > 0 && match.goalsAgainst > 0);
  const contextual = matches.filter((match) => match.venue === contextualVenue);
  const goalsFor = matches.reduce((total, match) => total + match.goalsFor, 0);
  const goalsAgainst = matches.reduce((total, match) => total + match.goalsAgainst, 0);
  const weightedGoalsFor = weightedAverage((match) => match.goalsFor);
  const weightedGoalsAgainst = weightedAverage((match) => match.goalsAgainst);
  return {
    sampleSize: matches.length,
    wins: matches.filter((match) => match.result === "W").length,
    draws: matches.filter((match) => match.result === "D").length,
    losses: matches.filter((match) => match.result === "L").length,
    goalsFor,
    goalsAgainst,
    simpleWinRate: wins.simpleRate,
    weightedWinRate: wins.weightedRate,
    weightedNonLossRate: nonLoss.weightedRate,
    weightedGoalsFor,
    weightedGoalsAgainst,
    weightedGoalDifference: weightedGoalsFor - weightedGoalsAgainst,
    scoredRate: scored.weightedRate,
    failedToScoreRate: 1 - scored.weightedRate,
    cleanSheetRate: cleanSheets.weightedRate,
    over15Rate: weightedRate(matches, (match) => match.goalsFor + match.goalsAgainst > 1.5).weightedRate,
    over25Rate: weightedRate(matches, (match) => match.goalsFor + match.goalsAgainst > 2.5).weightedRate,
    under35Rate: weightedRate(matches, (match) => match.goalsFor + match.goalsAgainst < 3.5).weightedRate,
    bttsRate: btts.weightedRate,
    contextualMatches: contextual.length,
    contextualWinRate: weightedRate(contextual, (match) => match.result === "W").weightedRate,
    contextualNonLossRate: weightedRate(contextual, (match) => match.result !== "L").weightedRate,
    matches
  };
}

function combinedMetric(homeMatches, awayMatches, predicate) {
  return weightedRate([...homeMatches, ...awayMatches], predicate);
}

function recentContradiction(matches, predicate) {
  const recent = matches.slice(0, 2);
  return recent.length === 2 && recent.filter(predicate).length === 0;
}

function hasExtremeDependency(matches, predicate) {
  const hits = matches.filter(predicate);
  if (hits.length <= 1) return true;
  const extreme = matches.filter((match) => match.goalsFor + match.goalsAgainst >= 6);
  return extreme.length === 1 && predicate(extreme[0]) && hits.length <= 2;
}

function candidateScore({ rate, threshold, sampleSize, recentRate, context = 0.5, consistency = 1, penalty = 0 }) {
  const sample = Math.min(1, sampleSize / 10);
  const margin = Math.max(0, Math.min(1, (rate - threshold) / Math.max(0.01, 1 - threshold)));
  return round(100 * ((0.4 * rate) + (0.15 * recentRate) + (0.15 * sample)
    + (0.1 * context) + (0.1 * consistency) + (0.1 * margin)) - penalty, 2);
}

function candidate({ key, market, selection, kind, priority, rate, threshold, sampleSize,
  recentRate, context = 0.5, consistency = 1, reasons = [], comparison = "" }) {
  const rejectionReasons = [...reasons];
  if (rate < threshold) rejectionReasons.push(`Cumplimiento ponderado inferior al ${Math.round(threshold * 100)}%.`);
  return {
    key, market, selection, kind, priority, weightedRate: rate, threshold, sampleSize,
    recentRate, context, consistency, comparison,
    score: candidateScore({ rate, threshold, sampleSize, recentRate, context, consistency,
      penalty: rejectionReasons.length * 5 }),
    eligible: rejectionReasons.length === 0,
    rejectionReasons
  };
}

function publicMetrics(metrics) {
  return {
    ...metrics,
    simpleWinRatePct: percent(metrics.simpleWinRate),
    weightedWinRatePct: percent(metrics.weightedWinRate),
    weightedNonLossRatePct: percent(metrics.weightedNonLossRate),
    weightedGoalsFor: round(metrics.weightedGoalsFor, 2),
    weightedGoalsAgainst: round(metrics.weightedGoalsAgainst, 2),
    weightedGoalDifference: round(metrics.weightedGoalDifference, 2),
    scoredRatePct: percent(metrics.scoredRate),
    failedToScoreRatePct: percent(metrics.failedToScoreRate),
    cleanSheetRatePct: percent(metrics.cleanSheetRate),
    over15RatePct: percent(metrics.over15Rate),
    over25RatePct: percent(metrics.over25Rate),
    under35RatePct: percent(metrics.under35Rate),
    bttsRatePct: percent(metrics.bttsRate),
    contextualWinRatePct: percent(metrics.contextualWinRate),
    contextualNonLossRatePct: percent(metrics.contextualNonLossRate)
  };
}

function noRecommendation(base, explanation, warnings = [], rejectedCandidates = []) {
  return {
    ...base,
    recommendedMarket: null,
    recommendedSelection: "Sin pick recomendado por forma reciente",
    confidence: "Baja",
    weightedRate: null,
    explanation,
    warnings: [...warnings, explanation],
    rejectedCandidates
  };
}

export function evaluateRecentFormRecommendation({
  homeMatches = [], awayMatches = [], homeTeamName = "Local", awayTeamName = "Visitante",
  currentFixtureDate = ""
} = {}) {
  const cutoff = timestamp(currentFixtureDate) ?? Number.POSITIVE_INFINITY;
  const homeNormalized = normalizeMatches(homeMatches, "Local", cutoff);
  const awayNormalized = normalizeMatches(awayMatches, "Visitante", cutoff);
  const warnings = [...homeNormalized.warnings, ...awayNormalized.warnings];
  const home = teamMetrics(homeNormalized.matches, "Local");
  const away = teamMetrics(awayNormalized.matches, "Visitante");
  const base = {
    homeSampleSize: home.sampleSize,
    awaySampleSize: away.sampleSize,
    homeWeightedWinRate: percent(home.weightedWinRate),
    awayWeightedWinRate: percent(away.weightedWinRate),
    homeWeightedNonLossRate: percent(home.weightedNonLossRate),
    awayWeightedNonLossRate: percent(away.weightedNonLossRate),
    dataQuality: home.sampleSize >= 5 && away.sampleSize >= 5 ? "Alta"
      : home.sampleSize >= 3 && away.sampleSize >= 3 ? "Media" : "Baja",
    calculationDetails: { home: publicMetrics(home), away: publicMetrics(away), candidates: [] }
  };

  if (homeNormalized.invalidCount || awayNormalized.invalidCount) {
    return noRecommendation(base, "Existen partidos con fecha, marcador, localía o resultado inválido.", warnings);
  }
  if (home.sampleSize < 3 || away.sampleSize < 3) {
    return noRecommendation(base, "Algún equipo tiene menos de 3 partidos válidos.", warnings);
  }
  if (home.sampleSize !== away.sampleSize) {
    return noRecommendation(base, "La muestra es desigual entre ambos equipos y no permite una comparación estable.", warnings);
  }
  const newestHome = home.matches[0]?.dateTime;
  const newestAway = away.matches[0]?.dateTime;
  const yearMs = 365 * 86400000;
  if ((cutoff - newestHome > yearMs) || (cutoff - newestAway > yearMs)) {
    return noRecommendation(base, "Los partidos utilizados son demasiado antiguos para una recomendación reciente.", warnings);
  }
  if (Math.abs(newestHome - newestAway) > 120 * 86400000) {
    return noRecommendation(base, "Existe una diferencia de fecha anormal entre las muestras de ambos equipos.", warnings);
  }

  const combined = [...home.matches, ...away.matches];
  const combinedSize = combined.length;
  const goals = (predicate) => combinedMetric(home.matches, away.matches, predicate);
  const over05 = goals((match) => match.goalsFor + match.goalsAgainst > 0.5);
  const over15 = goals((match) => match.goalsFor + match.goalsAgainst > 1.5);
  const over25 = goals((match) => match.goalsFor + match.goalsAgainst > 2.5);
  const under35 = goals((match) => match.goalsFor + match.goalsAgainst < 3.5);
  const bttsYes = goals((match) => match.goalsFor > 0 && match.goalsAgainst > 0);
  const bttsNo = goals((match) => !(match.goalsFor > 0 && match.goalsAgainst > 0));
  const recentCombined = [...home.matches.slice(0, 2), ...away.matches.slice(0, 2)];
  const recentRateFor = (predicate) => weightedRate(recentCombined, predicate).weightedRate;
  const candidates = [];

  const homeWinReasons = [];
  if (away.weightedWinRate > 0.25) homeWinReasons.push("El visitante supera el límite de victoria permitido para respaldar al local.");
  if (home.weightedGoalDifference < 0.35) homeWinReasons.push("La diferencia ponderada de goles no favorece claramente al local.");
  if (home.contextualMatches < 2 || home.contextualWinRate < 0.5) homeWinReasons.push("La muestra del local en casa no muestra dominio suficiente.");
  if (away.contextualMatches < 2 || away.contextualWinRate > 0.35) homeWinReasons.push("El visitante no muestra debilidad suficiente fuera.");
  if (home.wins < 2) homeWinReasons.push("La tendencia dependería de una sola victoria.");
  if (recentContradiction(home.matches, (match) => match.result === "W")) homeWinReasons.push("Los dos partidos más recientes contradicen la victoria local.");
  const homeWinCandidate = candidate({ key: "home_win", market: "Resultado 1X2", selection: `Gana ${homeTeamName}`,
    kind: "direct", priority: 3, rate: home.weightedWinRate, threshold: 0.6, sampleSize: home.sampleSize,
    recentRate: weightedRate(home.matches.slice(0, 2), (match) => match.result === "W").weightedRate,
    context: home.contextualWinRate, consistency: Math.max(0, 1 - away.weightedWinRate), reasons: homeWinReasons,
    comparison: `${homeTeamName} presenta mejor balance reciente y contextual.` });
  candidates.push(homeWinCandidate);

  const awayWinReasons = [];
  if (home.weightedWinRate > 0.25) awayWinReasons.push("El local supera el límite de victoria permitido para respaldar al visitante.");
  if (away.weightedGoalDifference < 0.35) awayWinReasons.push("La diferencia ponderada de goles no favorece claramente al visitante.");
  if (away.contextualMatches < 2 || away.contextualWinRate < 0.5) awayWinReasons.push("La muestra del visitante fuera no muestra dominio suficiente.");
  if (home.contextualMatches < 2 || home.contextualWinRate > 0.35) awayWinReasons.push("El local no muestra debilidad suficiente en casa.");
  if (away.wins < 2) awayWinReasons.push("La tendencia dependería de una sola victoria.");
  if (recentContradiction(away.matches, (match) => match.result === "W")) awayWinReasons.push("Los dos partidos más recientes contradicen la victoria visitante.");
  const awayWinCandidate = candidate({ key: "away_win", market: "Resultado 1X2", selection: `Gana ${awayTeamName}`,
    kind: "direct", priority: 3, rate: away.weightedWinRate, threshold: 0.6, sampleSize: away.sampleSize,
    recentRate: weightedRate(away.matches.slice(0, 2), (match) => match.result === "W").weightedRate,
    context: away.contextualWinRate, consistency: Math.max(0, 1 - home.weightedWinRate), reasons: awayWinReasons,
    comparison: `${awayTeamName} presenta mejor balance reciente y contextual.` });
  candidates.push(awayWinCandidate);

  candidates.push(candidate({ key: "home_double_chance", market: "Doble oportunidad", selection: `${homeTeamName} o empate (1X)`,
    kind: "double_chance", priority: 2, rate: home.weightedNonLossRate, threshold: 0.7, sampleSize: home.sampleSize,
    recentRate: weightedRate(home.matches.slice(0, 2), (match) => match.result !== "L").weightedRate,
    context: home.contextualNonLossRate, consistency: 1 - away.weightedWinRate,
    reasons: away.weightedWinRate >= 0.6 ? ["El visitante muestra dominio suficiente para contradecir la doble oportunidad local."]
      : homeWinCandidate.eligible && home.draws === 0 ? ["La victoria local ya presenta dominio estable sin empates recientes."] : [],
    comparison: `${homeTeamName} mantiene una tasa ponderada de no derrota de ${percent(home.weightedNonLossRate)}%.` }));
  candidates.push(candidate({ key: "away_double_chance", market: "Doble oportunidad", selection: `${awayTeamName} o empate (X2)`,
    kind: "double_chance", priority: 2, rate: away.weightedNonLossRate, threshold: 0.7, sampleSize: away.sampleSize,
    recentRate: weightedRate(away.matches.slice(0, 2), (match) => match.result !== "L").weightedRate,
    context: away.contextualNonLossRate, consistency: 1 - home.weightedWinRate,
    reasons: home.weightedWinRate >= 0.6 ? ["El local muestra dominio suficiente para contradecir la doble oportunidad visitante."]
      : awayWinCandidate.eligible && away.draws === 0 ? ["La victoria visitante ya presenta dominio estable sin empates recientes."] : [],
    comparison: `${awayTeamName} mantiene una tasa ponderada de no derrota de ${percent(away.weightedNonLossRate)}%.` }));

  const goalCandidate = (config) => candidates.push(candidate({ ...config, sampleSize: combinedSize }));
  goalCandidate({ key: "over15", market: "Total de goles", selection: "Más de 1.5 goles", kind: "conservative_goal", priority: 1,
    rate: over15.weightedRate, threshold: 0.75, recentRate: recentRateFor((match) => match.goalsFor + match.goalsAgainst > 1.5),
    context: Math.max(home.scoredRate, away.scoredRate), consistency: 1 - Math.abs(home.over15Rate - away.over15Rate),
    reasons: Math.max(home.weightedGoalsFor, away.weightedGoalsFor) < 1 || Math.max(home.weightedGoalsAgainst, away.weightedGoalsAgainst) < 1
      ? ["No coincide un ataque consistente con una defensa que conceda con frecuencia."] : [],
    comparison: "La frecuencia de más de 1.5 goles es más estable que los mercados de resultado." });
  goalCandidate({ key: "under35", market: "Total de goles", selection: "Menos de 3.5 goles", kind: "conservative_goal", priority: 1,
    rate: under35.weightedRate, threshold: 0.75, recentRate: recentRateFor((match) => match.goalsFor + match.goalsAgainst < 3.5),
    context: 1 - Math.min(1, (home.weightedGoalsFor + away.weightedGoalsFor) / 5), consistency: 1 - Math.abs(home.under35Rate - away.under35Rate),
    reasons: combined.filter((match) => match.goalsFor + match.goalsAgainst >= 5).length > 1 ? ["Existen varios marcadores extremos recientes."] : [],
    comparison: "Los marcadores recientes se concentran con mayor estabilidad por debajo de 3.5 goles." });
  goalCandidate({ key: "over25", market: "Total de goles", selection: "Más de 2.5 goles", kind: "aggressive_goal", priority: 4,
    rate: over25.weightedRate, threshold: 0.7, recentRate: recentRateFor((match) => match.goalsFor + match.goalsAgainst > 2.5),
    context: Math.min(1, (home.weightedGoalsFor + away.weightedGoalsFor) / 3), consistency: 1 - Math.abs(home.over25Rate - away.over25Rate),
    reasons: (home.weightedGoalsFor + away.weightedGoalsFor < 2.4) ? ["La producción ofensiva combinada no es suficientemente alta."] : [],
    comparison: "Ambas muestras sostienen una producción elevada de goles." });
  goalCandidate({ key: "btts_yes", market: "Ambos equipos anotan", selection: "Ambos equipos anotan: Sí", kind: "aggressive_goal", priority: 4,
    rate: bttsYes.weightedRate, threshold: 0.7, recentRate: recentRateFor((match) => match.goalsFor > 0 && match.goalsAgainst > 0),
    context: Math.min(home.scoredRate, away.scoredRate), consistency: 1 - Math.abs(home.bttsRate - away.bttsRate),
    reasons: home.scoredRate < 0.65 || away.scoredRate < 0.65 || home.cleanSheetRate > 0.4 || away.cleanSheetRate > 0.4
      ? ["Ambos equipos no combinan anotación regular con defensas que concedan suficientemente."] : [],
    comparison: "Ambos equipos anotan y conceden de manera reciente y consistente." });
  goalCandidate({ key: "btts_no", market: "Ambos equipos anotan", selection: "Ambos equipos anotan: No", kind: "aggressive_goal", priority: 4,
    rate: bttsNo.weightedRate, threshold: 0.7, recentRate: recentRateFor((match) => !(match.goalsFor > 0 && match.goalsAgainst > 0)),
    context: Math.max(home.failedToScoreRate, away.failedToScoreRate, home.cleanSheetRate, away.cleanSheetRate),
    consistency: 1 - Math.abs((1 - home.bttsRate) - (1 - away.bttsRate)),
    reasons: Math.max(home.failedToScoreRate, away.failedToScoreRate, home.cleanSheetRate, away.cleanSheetRate) < 0.4
      ? ["No existe suficiente frecuencia de partidos sin anotar o porterías a cero."] : [],
    comparison: "La falta de gol o las porterías a cero sostienen la tendencia de BTTS No." });

  const usefulGoal = candidates.some((item) => item.eligible && ["over15", "under35", "over25", "btts_yes", "btts_no"].includes(item.key));
  goalCandidate({ key: "over05", market: "Total de goles", selection: "Más de 0.5 goles", kind: "fallback_goal", priority: 4,
    rate: over05.weightedRate, threshold: 0.9, recentRate: recentRateFor((match) => match.goalsFor + match.goalsAgainst > 0.5),
    context: Math.max(home.scoredRate, away.scoredRate), consistency: 1 - Math.abs(home.scoredRate - away.scoredRate),
    reasons: usefulGoal ? ["Existe un mercado de goles más útil con evidencia suficiente."] : [],
    comparison: "Al menos un gol es la única tendencia conservadora suficientemente estable." });

  for (const item of candidates.filter((entry) => entry.eligible && ["over25", "btts_yes"].includes(entry.key))) {
    const predicate = item.key === "over25"
      ? (match) => match.goalsFor + match.goalsAgainst > 2.5
      : (match) => match.goalsFor > 0 && match.goalsAgainst > 0;
    if (hasExtremeDependency(combined, predicate)) {
      item.eligible = false;
      item.rejectionReasons.push("La tendencia depende excesivamente de un único marcador extremo.");
    }
  }

  const eligible = candidates.filter((item) => item.eligible).sort((a, b) => {
    const difference = b.score - a.score;
    return Math.abs(difference) > 3 ? difference : a.priority - b.priority || difference;
  });
  const rejectedCandidates = candidates.filter((item) => !item.eligible).map((item) => ({
    market: item.market,
    selection: item.selection,
    weightedRatePct: percent(item.weightedRate),
    score: item.score,
    reasons: item.rejectionReasons
  }));
  base.calculationDetails.candidates = candidates.map((item) => ({
    key: item.key,
    market: item.market,
    selection: item.selection,
    weightedRatePct: percent(item.weightedRate),
    score: item.score,
    status: item.eligible ? "Candidato" : "Descartado",
    reasons: item.rejectionReasons
  }));

  if (!eligible.length) {
    return noRecommendation(base, "Ningún mercado supera sus umbrales con consistencia suficiente.", warnings, rejectedCandidates);
  }
  if (eligible.length > 1 && Math.abs(eligible[0].score - eligible[1].score) < 1.5
    && eligible[0].priority === eligible[1].priority) {
    return noRecommendation(base, "Existe un empate técnico entre mercados sin ventaja clara.", warnings, rejectedCandidates);
  }

  const winner = eligible[0];
  const confidence = home.sampleSize === 5 && away.sampleSize === 5 && winner.weightedRate >= 0.8
    && winner.recentRate >= 0.75 && warnings.length === 0 ? "Alta" : "Media";
  return {
    ...base,
    recommendedMarket: winner.market,
    recommendedSelection: winner.selection,
    confidence,
    weightedRate: percent(winner.weightedRate),
    explanation: `${winner.comparison} Supera los filtros de recencia, localía y consistencia sin combinar mercados.`,
    warnings: [...warnings, "La forma reciente es evidencia contextual y no constituye una probabilidad completa del partido."],
    rejectedCandidates,
    calculationDetails: { ...base.calculationDetails, winningCandidate: winner }
  };
}

export const RECENT_FORM_RECENCY_WEIGHTS = RECENCY_WEIGHTS;
