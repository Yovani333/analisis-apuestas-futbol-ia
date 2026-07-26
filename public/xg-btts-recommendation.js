const RECENCY_WEIGHTS = Object.freeze([1, 0.92, 0.84, 0.76, 0.68, 0.60, 0.55, 0.50]);
const MAX_SAMPLE = RECENCY_WEIGHTS.length;
const MIN_SAMPLE = 4;
const MAX_PLAUSIBLE_XG = 8;
const MODEL_VERSION = "xg-btts-poisson-v2";

function numeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_PLAUSIBLE_XG ? parsed : null;
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 2) {
  return Number(Number(value || 0).toFixed(digits));
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, percentileValue) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * percentileValue;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function interquartileRange(values) {
  if (!values.length) return null;
  return percentile(values, 0.75) - percentile(values, 0.25);
}

function weightedMean(rows, key) {
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  return totalWeight ? rows.reduce((sum, row) => sum + row[key] * row.weight, 0) / totalWeight : null;
}

function weightedRate(rows, predicate) {
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  return totalWeight ? rows.reduce((sum, row) => sum + (predicate(row) ? row.weight : 0), 0) / totalWeight : 0;
}

function weightedDeviation(rows, key, center) {
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  if (!totalWeight || center === null) return null;
  return Math.sqrt(rows.reduce((sum, row) => sum + row.weight * ((row[key] - center) ** 2), 0) / totalWeight);
}

function normalizeRows(rows, expectedSide, { currentFixtureId, currentFixtureDate } = {}) {
  const cutoff = timestamp(currentFixtureDate);
  const targetId = String(currentFixtureId || "").trim();
  const unique = new Map();
  const discarded = [];

  for (const source of Array.isArray(rows) ? rows : []) {
    const fixtureId = String(source?.fixtureId || "").trim();
    const dateTime = timestamp(source?.date);
    const xg = numeric(source?.estimatedXG);
    const xga = numeric(source?.estimatedXGA);
    const venue = String(source?.venue || "").toLowerCase();
    let reason = "";
    if (!fixtureId) reason = "Fixture sin identificador.";
    else if (targetId && fixtureId === targetId) reason = "Se excluyó el fixture analizado.";
    else if (dateTime === null) reason = "Fecha inválida.";
    else if (cutoff !== null && dateTime >= cutoff) reason = "Fixture posterior o igual al corte temporal.";
    else if (xg === null || xga === null) reason = "xG o xGA nulo, negativo, NaN o fuera de rango.";
    else if (!new Set(["home", "away"]).has(venue)) reason = "Localía no identificada.";
    else if (unique.has(fixtureId)) reason = "Fixture duplicado.";
    if (reason) {
      discarded.push({ fixtureId: fixtureId || "Sin ID", reason });
      continue;
    }
    unique.set(fixtureId, { ...source, fixtureId, dateTime, xg, xga, venue });
  }

  const normalized = [...unique.values()]
    .sort((a, b) => b.dateTime - a.dateTime)
    .slice(0, MAX_SAMPLE)
    .map((row, index) => ({
      ...row,
      recencyWeight: RECENCY_WEIGHTS[index],
      venueFactor: row.venue === expectedSide ? 1 : 0.8,
      weight: RECENCY_WEIGHTS[index] * (row.venue === expectedSide ? 1 : 0.8)
    }));
  return { rows: normalized, discarded };
}

function outlierCount(values) {
  if (values.length < 4) return 0;
  const center = median(values);
  const deviations = values.map((value) => Math.abs(value - center));
  const mad = median(deviations);
  if (!mad) return values.filter((value) => Math.abs(value - center) > 1.25).length;
  return values.filter((value) => Math.abs(value - center) / (1.4826 * mad) > 2.8).length;
}

function teamMetrics(rows) {
  const xgValues = rows.map((row) => row.xg);
  const xgaValues = rows.map((row) => row.xga);
  const weightedXg = weightedMean(rows, "xg");
  const weightedXga = weightedMean(rows, "xga");
  const medianXg = median(xgValues);
  const medianXga = median(xgaValues);
  const recentCount = Math.min(3, rows.length);
  const recentXg = mean(rows.slice(0, recentCount).map((row) => row.xg));
  const previousXg = mean(rows.slice(recentCount).map((row) => row.xg));
  const trendDelta = recentXg === null || previousXg === null ? 0 : recentXg - previousXg;
  return {
    sampleSize: rows.length,
    simpleXg: round(mean(xgValues)),
    weightedXg: round(weightedXg),
    simpleXga: round(mean(xgaValues)),
    weightedXga: round(weightedXga),
    medianXg: round(medianXg),
    medianXga: round(medianXga),
    xgDeviation: round(weightedDeviation(rows, "xg", weightedXg)),
    xgaDeviation: round(weightedDeviation(rows, "xga", weightedXga)),
    xgIqr: round(interquartileRange(xgValues)),
    xgaIqr: round(interquartileRange(xgaValues)),
    xgAtLeast05Pct: round(weightedRate(rows, (row) => row.xg >= 0.5) * 100, 1),
    xgAtLeast075Pct: round(weightedRate(rows, (row) => row.xg >= 0.75) * 100, 1),
    xgAtLeast10Pct: round(weightedRate(rows, (row) => row.xg >= 1) * 100, 1),
    xgaAtLeast05Pct: round(weightedRate(rows, (row) => row.xga >= 0.5) * 100, 1),
    xgaAtLeast075Pct: round(weightedRate(rows, (row) => row.xga >= 0.75) * 100, 1),
    xgaAtLeast10Pct: round(weightedRate(rows, (row) => row.xga >= 1) * 100, 1),
    nearZeroAttackPct: round(weightedRate(rows, (row) => row.xg < 0.30) * 100, 1),
    contextualMatches: rows.filter((row) => row.venueFactor === 1).length,
    recentXg: round(recentXg),
    trendDelta: round(trendDelta),
    trend: trendDelta > 0.12 ? "ascendente" : trendDelta < -0.12 ? "descendente" : "estable",
    outliers: outlierCount([...xgValues, ...xgaValues]),
    rows
  };
}

function buildScores(home, away, expectedHome, expectedAway, estimatedBttsYes) {
  const lowMedianGap = Math.abs(home.weightedXg - home.medianXg) < 0.15
    && Math.abs(away.weightedXg - away.medianXg) < 0.15;
  const lowDispersion = Math.max(home.xgIqr, away.xgIqr, home.xgaIqr, away.xgaIqr) < 0.5;
  const adequateSample = home.sampleSize >= 6 && away.sampleSize >= 6;
  const favorableTrend = home.trend !== "descendente" && away.trend !== "descendente";
  const nearZeroRisk = home.nearZeroAttackPct > 30 || away.nearZeroAttackPct > 30;
  const localityRisk = home.contextualMatches < 3 || away.contextualMatches < 3;
  const outlierPenalty = Math.min(15, (home.outliers + away.outliers) * 5);
  const yesScore = clamp(
    estimatedBttsYes * 100
    + (lowMedianGap ? 5 : 0)
    + (lowDispersion ? 5 : 0)
    + (adequateSample ? 5 : 0)
    + (favorableTrend ? 5 : 0)
    - (nearZeroRisk ? 10 : 0)
    - (localityRisk ? 5 : 0)
    - outlierPenalty
  );

  const weakHome = home.weightedXg <= 0.55 && home.xgAtLeast075Pct < 40;
  const weakAway = away.weightedXg <= 0.55 && away.xgAtLeast075Pct < 40;
  const solidHomeDefense = home.weightedXga <= 0.60 && away.weightedXg <= 0.70;
  const solidAwayDefense = away.weightedXga <= 0.60 && home.weightedXg <= 0.70;
  const forceImbalance = Math.abs(expectedHome - expectedAway) > 0.50;
  const weakSideNearZero = expectedHome <= expectedAway ? home.nearZeroAttackPct : away.nearZeroAttackPct;
  const bothWeak = home.weightedXg <= 0.70 && away.weightedXg <= 0.70 && estimatedBttsYes <= 0.45;
  const exactMinimumSample = home.sampleSize === MIN_SAMPLE || away.sampleSize === MIN_SAMPLE;
  const highDispersion = Math.max(home.xgIqr, away.xgIqr, home.xgaIqr, away.xgaIqr) >= 0.75;
  const noScore = clamp(
    (1 - estimatedBttsYes) * 100
    + (weakHome || weakAway ? 10 : 0)
    + (solidHomeDefense || solidAwayDefense ? 10 : 0)
    + (forceImbalance ? 5 : 0)
    + (weakSideNearZero > 50 ? 5 : 0)
    + (bothWeak ? 5 : 0)
    - (exactMinimumSample ? 5 : 0)
    - (highDispersion ? 5 : 0)
    - outlierPenalty
  );
  return {
    yesScore: round(yesScore, 1), noScore: round(noScore, 1),
    lowMedianGap, lowDispersion, adequateSample, favorableTrend,
    highDispersion, outlierPenalty
  };
}

function unavailableResult(status, explanation, warnings, home, away, details = {}) {
  return {
    recommendedSelection: null,
    status,
    confidence: "Baja",
    homeSampleSize: home?.sampleSize || 0,
    awaySampleSize: away?.sampleSize || 0,
    homeWeightedXg: home?.weightedXg ?? null,
    awayWeightedXg: away?.weightedXg ?? null,
    homeWeightedXga: home?.weightedXga ?? null,
    awayWeightedXga: away?.weightedXga ?? null,
    homeMedianXg: home?.medianXg ?? null,
    awayMedianXg: away?.medianXg ?? null,
    expectedGoalStrengthHome: null,
    expectedGoalStrengthAway: null,
    bttsYesScore: 0,
    bttsNoScore: 0,
    estimatedBttsYes: null,
    selectedScore: null,
    scoreDifference: 0,
    explanation,
    warnings,
    rejectedCandidates: [],
    calculationDetails: details,
    dataQuality: "Baja",
    modelVersion: MODEL_VERSION
  };
}

export function evaluateXgBttsRecommendation({
  homeFixtures = [],
  awayFixtures = [],
  homeTeam = {},
  awayTeam = {},
  currentFixtureId = "",
  currentFixtureDate = "",
  sourceQualityScore = null
} = {}) {
  const homeId = String(homeTeam?.id || "").trim();
  const awayId = String(awayTeam?.id || "").trim();
  if (!homeId || !awayId || homeId === awayId || timestamp(currentFixtureDate) === null) {
    return unavailableResult("INSUFFICIENT_DATA", "No fue posible identificar de forma segura el fixture y sus equipos.", ["Identificadores o fecha de corte inválidos."]);
  }

  const normalizedHome = normalizeRows(homeFixtures, "home", { currentFixtureId, currentFixtureDate });
  const normalizedAway = normalizeRows(awayFixtures, "away", { currentFixtureId, currentFixtureDate });
  const home = teamMetrics(normalizedHome.rows);
  const away = teamMetrics(normalizedAway.rows);
  const discardWarnings = [];
  if (normalizedHome.discarded.length) discardWarnings.push(`${homeTeam.name || "Local"}: ${normalizedHome.discarded.length} fila(s) descartada(s).`);
  if (normalizedAway.discarded.length) discardWarnings.push(`${awayTeam.name || "Visitante"}: ${normalizedAway.discarded.length} fila(s) descartada(s).`);
  if (home.sampleSize < MIN_SAMPLE || away.sampleSize < MIN_SAMPLE) {
    return unavailableResult(
      "INSUFFICIENT_DATA",
      "Sin pick recomendado por xG / xGA: se requieren al menos cuatro partidos válidos por equipo.",
      discardWarnings,
      home,
      away,
      { home, away, discarded: { home: normalizedHome.discarded, away: normalizedAway.discarded } }
    );
  }

  const expectedHome = (home.weightedXg + away.weightedXga) / 2;
  const expectedAway = (away.weightedXg + home.weightedXga) / 2;
  const estimatedBttsYesRatio = (1 - Math.exp(-expectedHome)) * (1 - Math.exp(-expectedAway));
  const parsedQuality = Number(sourceQualityScore);
  const suppliedQuality = sourceQualityScore === null || sourceQualityScore === undefined || sourceQualityScore === "" || !Number.isFinite(parsedQuality)
    ? null
    : clamp(parsedQuality);
  const completeness = 100 - Math.min(35, (normalizedHome.discarded.length + normalizedAway.discarded.length) * 5);
  const qualityScore = suppliedQuality === null ? completeness : Math.min(suppliedQuality, completeness);
  const scores = buildScores(home, away, expectedHome, expectedAway, estimatedBttsYesRatio);
  const yesConditions = estimatedBttsYesRatio >= 0.52
    && home.weightedXg >= 0.60 && away.weightedXg >= 0.60
    && home.xgAtLeast075Pct >= 50 && away.xgAtLeast075Pct >= 50
    && home.nearZeroAttackPct <= 35 && away.nearZeroAttackPct <= 35;
  const weakHome = home.weightedXg <= 0.55 && home.xgAtLeast075Pct < 40;
  const weakAway = away.weightedXg <= 0.55 && away.xgAtLeast075Pct < 40;
  const solidHomeDefense = home.weightedXga <= 0.60 && away.weightedXg <= 0.70;
  const solidAwayDefense = away.weightedXga <= 0.60 && home.weightedXg <= 0.70;
  const nearZeroNo = home.nearZeroAttackPct > 60 || away.nearZeroAttackPct > 60;
  const noConditions = estimatedBttsYesRatio <= 0.40 || weakHome || weakAway
    || solidHomeDefense || solidAwayDefense || nearZeroNo;
  const scoreDifference = Math.abs(scores.yesScore - scores.noScore);
  const severeMedianContradiction = Math.abs(home.weightedXg - home.medianXg) >= 0.40
    || Math.abs(away.weightedXg - away.medianXg) >= 0.40;
  const excessiveDispersion = Math.max(home.xgIqr, away.xgIqr, home.xgaIqr, away.xgaIqr) >= 1;
  const comparableEnough = home.contextualMatches > 0 && away.contextualMatches > 0;
  const uncertaintyBlocksPick = severeMedianContradiction || excessiveDispersion || !comparableEnough;
  const yesWins = yesConditions && !uncertaintyBlocksPick
    && scores.yesScore >= 68 && scores.yesScore > scores.noScore && scoreDifference >= 8;
  const noWins = noConditions && !uncertaintyBlocksPick
    && scores.noScore >= 68 && scores.noScore > scores.yesScore && scoreDifference >= 8;
  const selected = yesWins ? "Ambos equipos anotan: Sí" : noWins ? "Ambos equipos anotan: No" : null;
  const selectedScore = yesWins ? scores.yesScore : noWins ? scores.noScore : null;
  const estimatedBttsYes = estimatedBttsYesRatio * 100;
  const warnings = [...discardWarnings];
  const highDispersion = scores.highDispersion;
  if (highDispersion) warnings.push("La dispersión de xG/xGA es alta y reduce la estabilidad de la tendencia.");
  if (home.outliers + away.outliers > 0) warnings.push("Se detectaron valores extremos; permanecen visibles, pero penalizan la puntuación.");
  if ((home.medianXg < home.weightedXg - 0.35) || (away.medianXg < away.weightedXg - 0.35)) warnings.push("El promedio ofensivo supera claramente a la mediana; la muestra puede depender de valores altos aislados.");
  if (estimatedBttsYesRatio > 0.40 && estimatedBttsYesRatio < 0.52) warnings.push("La probabilidad auxiliar se encuentra en la zona de incertidumbre BTTS.");
  if (home.contextualMatches < 2 || away.contextualMatches < 2) warnings.push("Hay pocos partidos con localía comparable al próximo encuentro.");
  const strongQuality = Math.min(home.sampleSize, away.sampleSize) >= 6 && qualityScore >= 80 && !highDispersion && scoreDifference >= 15;
  const confidence = selected ? (strongQuality ? "Alta" : "Media") : "Baja";
  const dataQuality = qualityScore >= 80 && Math.min(home.sampleSize, away.sampleSize) >= 6 ? "Alta"
    : qualityScore >= 55 ? "Media" : "Baja";
  const explanation = selected === "Ambos equipos anotan: Sí"
    ? "La probabilidad Poisson auxiliar supera el mínimo para BTTS Sí y ambos equipos sostienen producción ofensiva reciente suficiente, con respaldo de recencia y localía."
    : selected === "Ambos equipos anotan: No"
      ? `${weakHome ? homeTeam.name : weakAway ? awayTeam.name : "Al menos uno de los equipos"} presenta debilidad ofensiva o enfrenta una defensa suficientemente sólida; la probabilidad Poisson auxiliar respalda BTTS No.`
      : "Sin pick recomendado por xG / xGA: las condiciones absolutas, la diferencia entre candidatos o la calidad de la muestra no son suficientes.";
  const rejectedCandidates = [
    {
      selection: "Ambos equipos anotan: Sí",
      score: scores.yesScore,
      status: yesWins ? "Seleccionado" : "Descartado",
      reasons: yesWins ? ["Supera los umbrales ofensivos, defensivos y de diferencia."] : [
        !yesConditions ? "No cumple simultáneamente P_BTTS ≥ 0.52 y los mínimos ofensivos." : "",
        scores.yesScore < 68 ? "Índice de respaldo inferior a 68/100." : "",
        scoreDifference < 8 ? "Diferencia inferior a 8 puntos frente al candidato contrario." : ""
      ].filter(Boolean)
    },
    {
      selection: "Ambos equipos anotan: No",
      score: scores.noScore,
      status: noWins ? "Seleccionado" : "Descartado",
      reasons: noWins ? ["Existe debilidad ofensiva estable con respaldo defensivo suficiente."] : [
        !noConditions ? "No cumple ninguna condición absoluta para BTTS No." : "",
        scores.noScore < 68 ? "Índice de respaldo inferior a 68/100." : "",
        scoreDifference < 8 ? "Diferencia inferior a 8 puntos frente al candidato contrario." : ""
      ].filter(Boolean)
    }
  ];

  return {
    recommendedSelection: selected,
    modelVersion: MODEL_VERSION,
    status: selected ? "RECOMMENDED" : "NO_BET",
    confidence,
    homeSampleSize: home.sampleSize,
    awaySampleSize: away.sampleSize,
    homeWeightedXg: home.weightedXg,
    awayWeightedXg: away.weightedXg,
    homeWeightedXga: home.weightedXga,
    awayWeightedXga: away.weightedXga,
    homeMedianXg: home.medianXg,
    awayMedianXg: away.medianXg,
    expectedGoalStrengthHome: round(expectedHome),
    expectedGoalStrengthAway: round(expectedAway),
    bttsYesScore: scores.yesScore,
    bttsNoScore: scores.noScore,
    estimatedBttsYes: round(estimatedBttsYes, 1),
    selectedScore,
    scoreDifference: round(scoreDifference, 1),
    explanation,
    warnings,
    rejectedCandidates,
    calculationDetails: {
      formula: "Fuerza local = media(xG ponderado local, xGA ponderado visitante); fuerza visitante = media(xG ponderado visitante, xGA ponderado local); P_BTTS = (1 - exp(-fuerza local)) × (1 - exp(-fuerza visitante)).",
      home,
      away,
      scores,
      qualityScore: round(qualityScore, 1),
      discarded: { home: normalizedHome.discarded, away: normalizedAway.discarded }
    },
    dataQuality
  };
}

export { RECENCY_WEIGHTS };
