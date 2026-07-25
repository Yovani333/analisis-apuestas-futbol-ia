const RECENCY_WEIGHTS = Object.freeze([1, 0.92, 0.84, 0.76, 0.68, 0.60, 0.55, 0.50]);
const MAX_SAMPLE = RECENCY_WEIGHTS.length;
const MIN_SAMPLE = 4;
const MAX_PLAUSIBLE_XG = 8;

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
  const trendDelta = recentXg === null || weightedXg === null ? 0 : recentXg - weightedXg;
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
    xgAtLeast05Pct: round(weightedRate(rows, (row) => row.xg >= 0.5) * 100, 1),
    xgAtLeast075Pct: round(weightedRate(rows, (row) => row.xg >= 0.75) * 100, 1),
    xgAtLeast10Pct: round(weightedRate(rows, (row) => row.xg >= 1) * 100, 1),
    xgaAtLeast05Pct: round(weightedRate(rows, (row) => row.xga >= 0.5) * 100, 1),
    xgaAtLeast075Pct: round(weightedRate(rows, (row) => row.xga >= 0.75) * 100, 1),
    xgaAtLeast10Pct: round(weightedRate(rows, (row) => row.xga >= 1) * 100, 1),
    nearZeroAttackPct: round(weightedRate(rows, (row) => row.xg < 0.35) * 100, 1),
    contextualMatches: rows.filter((row) => row.venueFactor === 1).length,
    recentXg: round(recentXg),
    trendDelta: round(trendDelta),
    trend: trendDelta > 0.12 ? "ascendente" : trendDelta < -0.12 ? "descendente" : "estable",
    outliers: outlierCount([...xgValues, ...xgaValues]),
    rows
  };
}

function normalizedSupport(value, low, high) {
  if (high <= low) return 0;
  return clamp(((value - low) / (high - low)) * 100);
}

function buildScores(home, away, expectedHome, expectedAway, qualityScore) {
  const minimumExpected = Math.min(expectedHome, expectedAway);
  const maximumExpected = Math.max(expectedHome, expectedAway);
  const attackFrequency = (home.xgAtLeast075Pct + away.xgAtLeast075Pct) / 2;
  const concedeFrequency = (home.xgaAtLeast075Pct + away.xgaAtLeast075Pct) / 2;
  const medianSupport = (normalizedSupport(home.medianXg, 0.55, 1.2) + normalizedSupport(away.medianXg, 0.55, 1.2)) / 2;
  const stability = 100 - clamp(((home.xgDeviation + away.xgDeviation + home.xgaDeviation + away.xgaDeviation) / 4) * 70);
  const sampleSupport = (Math.min(home.sampleSize, away.sampleSize) / MAX_SAMPLE) * 100;
  const recentSupport = (normalizedSupport(home.recentXg, 0.55, 1.2) + normalizedSupport(away.recentXg, 0.55, 1.2)) / 2;
  const outlierPenalty = Math.min(18, (home.outliers + away.outliers) * 4);
  const zeroAttackPenalty = Math.max(home.nearZeroAttackPct, away.nearZeroAttackPct) * 0.12;
  const yesScore = clamp(
    normalizedSupport(minimumExpected, 0.6, 1.2) * 0.30
    + attackFrequency * 0.20
    + concedeFrequency * 0.15
    + medianSupport * 0.10
    + stability * 0.10
    + sampleSupport * 0.08
    + recentSupport * 0.04
    + qualityScore * 0.03
    - outlierPenalty - zeroAttackPenalty
  );

  const weakSide = expectedHome <= expectedAway ? home : away;
  const opposingDefense = expectedHome <= expectedAway ? away : home;
  const weakExpectation = 100 - normalizedSupport(minimumExpected, 0.45, 1.05);
  const weakAttack = 100 - normalizedSupport(weakSide.weightedXg, 0.45, 1.05);
  const weakMedian = 100 - normalizedSupport(weakSide.medianXg, 0.4, 1.0);
  const lowFrequency = 100 - weakSide.xgAtLeast075Pct;
  const solidDefense = 100 - normalizedSupport(opposingDefense.weightedXga, 0.45, 1.05);
  const asymmetry = normalizedSupport(maximumExpected - minimumExpected, 0.15, 1);
  const noScore = clamp(
    weakExpectation * 0.30
    + weakAttack * 0.20
    + weakMedian * 0.12
    + lowFrequency * 0.15
    + solidDefense * 0.13
    + stability * 0.04
    + sampleSupport * 0.03
    + asymmetry * 0.03
    - outlierPenalty * 0.6
  );
  return { yesScore: round(yesScore, 1), noScore: round(noScore, 1), stability: round(stability, 1), sampleSupport: round(sampleSupport, 1) };
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
    dataQuality: "Baja"
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
  const parsedQuality = Number(sourceQualityScore);
  const suppliedQuality = sourceQualityScore === null || sourceQualityScore === undefined || sourceQualityScore === "" || !Number.isFinite(parsedQuality)
    ? null
    : clamp(parsedQuality);
  const completeness = 100 - Math.min(35, (normalizedHome.discarded.length + normalizedAway.discarded.length) * 5);
  const qualityScore = suppliedQuality === null ? completeness : Math.min(suppliedQuality, completeness);
  const scores = buildScores(home, away, expectedHome, expectedAway, qualityScore);
  const yesConditions = expectedHome >= 0.9 && expectedAway >= 0.9
    && home.weightedXg >= 0.8 && away.weightedXg >= 0.8
    && home.xgAtLeast075Pct >= 60 && away.xgAtLeast075Pct >= 60
    && home.weightedXga >= 0.8 && away.weightedXga >= 0.8
    && home.nearZeroAttackPct <= 40 && away.nearZeroAttackPct <= 40;
  const weakHome = expectedHome <= 0.7;
  const weakAway = expectedAway <= 0.7;
  const weakTeam = weakHome ? home : away;
  const opposingDefense = weakHome ? away : home;
  const noSupportCondition = weakHome || weakAway
    ? weakTeam.weightedXg <= 0.75 || weakTeam.medianXg <= 0.7 || weakTeam.xgAtLeast075Pct < 45
      || opposingDefense.weightedXga <= 0.75 || weakTeam.trend === "descendente" || weakTeam.nearZeroAttackPct >= 35
    : false;
  const bothWeak = expectedHome <= 0.82 && expectedAway <= 0.82 && home.weightedXg <= 0.85 && away.weightedXg <= 0.85;
  const noConditions = ((weakHome || weakAway) && noSupportCondition) || bothWeak;
  const scoreDifference = Math.abs(scores.yesScore - scores.noScore);
  const yesWins = yesConditions && scores.yesScore >= 68 && scores.yesScore > scores.noScore && scoreDifference >= 8;
  const noWins = noConditions && scores.noScore >= 68 && scores.noScore > scores.yesScore && scoreDifference >= 8;
  const selected = yesWins ? "Ambos equipos anotan: Sí" : noWins ? "Ambos equipos anotan: No" : null;
  const selectedScore = yesWins ? scores.yesScore : noWins ? scores.noScore : null;
  const estimatedBttsYes = (1 - Math.exp(-expectedHome)) * (1 - Math.exp(-expectedAway)) * 100;
  const warnings = [...discardWarnings];
  const highDispersion = Math.max(home.xgDeviation, away.xgDeviation, home.xgaDeviation, away.xgaDeviation) > 0.85;
  if (highDispersion) warnings.push("La dispersión de xG/xGA es alta y reduce la estabilidad de la tendencia.");
  if (home.outliers + away.outliers > 0) warnings.push("Se detectaron valores extremos; permanecen visibles, pero penalizan la puntuación.");
  if ((home.medianXg < home.weightedXg - 0.35) || (away.medianXg < away.weightedXg - 0.35)) warnings.push("El promedio ofensivo supera claramente a la mediana; la muestra puede depender de valores altos aislados.");
  if ((expectedHome > 0.7 && expectedHome < 0.9) || (expectedAway > 0.7 && expectedAway < 0.9)) warnings.push("Al menos un equipo se encuentra en la zona de incertidumbre ofensiva.");
  if (home.contextualMatches < 2 || away.contextualMatches < 2) warnings.push("Hay pocos partidos con localía comparable al próximo encuentro.");
  const strongQuality = Math.min(home.sampleSize, away.sampleSize) >= 6 && qualityScore >= 80 && !highDispersion && scoreDifference >= 15;
  const confidence = selected ? (strongQuality ? "Alta" : "Media") : "Baja";
  const dataQuality = qualityScore >= 80 && Math.min(home.sampleSize, away.sampleSize) >= 6 ? "Alta"
    : qualityScore >= 55 ? "Media" : "Baja";
  const explanation = selected === "Ambos equipos anotan: Sí"
    ? "Ambos equipos mantienen fuerza ofensiva contextual suficiente y sus defensas conceden producción de manera consistente. Promedio, mediana, recencia y localía respaldan mejor BTTS Sí."
    : selected === "Ambos equipos anotan: No"
      ? `${weakHome ? homeTeam.name : weakAway ? awayTeam.name : "Al menos uno de los equipos"} presenta una producción ofensiva contextual baja y el perfil defensivo rival refuerza BTTS No.`
      : "Sin pick recomendado por xG / xGA: las condiciones absolutas, la diferencia entre candidatos o la calidad de la muestra no son suficientes.";
  const rejectedCandidates = [
    {
      selection: "Ambos equipos anotan: Sí",
      score: scores.yesScore,
      status: yesWins ? "Seleccionado" : "Descartado",
      reasons: yesWins ? ["Supera los umbrales ofensivos, defensivos y de diferencia."] : [
        !yesConditions ? "No cumple simultáneamente los mínimos de ataque y fragilidad defensiva." : "",
        scores.yesScore < 68 ? "Índice de respaldo inferior a 68/100." : "",
        scoreDifference < 8 ? "Diferencia inferior a 8 puntos frente al candidato contrario." : ""
      ].filter(Boolean)
    },
    {
      selection: "Ambos equipos anotan: No",
      score: scores.noScore,
      status: noWins ? "Seleccionado" : "Descartado",
      reasons: noWins ? ["Existe debilidad ofensiva estable con respaldo defensivo suficiente."] : [
        !noConditions ? "No existe una debilidad ofensiva suficientemente estable." : "",
        scores.noScore < 68 ? "Índice de respaldo inferior a 68/100." : "",
        scoreDifference < 8 ? "Diferencia inferior a 8 puntos frente al candidato contrario." : ""
      ].filter(Boolean)
    }
  ];

  return {
    recommendedSelection: selected,
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
      formula: "Fuerza local = media(xG ponderado local, xGA ponderado visitante); fuerza visitante = media(xG ponderado visitante, xGA ponderado local).",
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
