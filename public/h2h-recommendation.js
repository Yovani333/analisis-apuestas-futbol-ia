const RECENCY_WEIGHTS = Object.freeze([1, 0.9, 0.8, 0.7, 0.6]);
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);

function numeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits = 1) {
  return Number(Number(value || 0).toFixed(digits));
}

function weightFor(index) {
  return RECENCY_WEIGHTS[index] ?? 0.5;
}

function regulationGoals(match, side) {
  const explicit = numeric(match?.[`regulation${side === "home" ? "Home" : "Away"}Goals`]);
  if (explicit !== null) return explicit;
  const fulltime = numeric(match?.score?.fulltime?.[side]);
  if (fulltime !== null) return fulltime;
  const status = String(match?.statusShort || match?.fixture?.status?.short || "").toUpperCase();
  if (["AET", "PEN"].includes(status)) return null;
  return numeric(match?.[`${side}Goals`] ?? match?.goals?.[side]);
}

function normalizeMatch(match, currentHome, currentAway) {
  const date = match?.date || match?.fixture?.date || "";
  const homeTeamId = match?.homeTeamId ?? match?.teams?.home?.id ?? null;
  const awayTeamId = match?.awayTeamId ?? match?.teams?.away?.id ?? null;
  const homeTeam = match?.homeTeam || match?.teams?.home?.name || "";
  const awayTeam = match?.awayTeam || match?.teams?.away?.name || "";
  const homeGoals = regulationGoals(match, "home");
  const awayGoals = regulationGoals(match, "away");
  const statusShort = String(match?.statusShort || match?.fixture?.status?.short || "FT").toUpperCase();
  const idsAvailable = currentHome.id !== null && currentHome.id !== undefined
    && currentAway.id !== null && currentAway.id !== undefined
    && homeTeamId !== null && awayTeamId !== null;
  const pairMatches = idsAvailable
    ? [String(homeTeamId), String(awayTeamId)].sort().join(":") === [String(currentHome.id), String(currentAway.id)].sort().join(":")
    : [normalizedName(homeTeam), normalizedName(awayTeam)].sort().join(":")
      === [normalizedName(currentHome.name), normalizedName(currentAway.name)].sort().join(":");
  return {
    fixtureId: String(match?.fixtureId || match?.fixture?.id || ""),
    date,
    timestamp: timestamp(date),
    statusShort,
    homeTeamId,
    awayTeamId,
    homeTeam,
    awayTeam,
    homeGoals,
    awayGoals,
    pairMatches,
    idsVerified: idsAvailable,
    leagueName: match?.leagueName || match?.league?.name || ""
  };
}

function weightedSummary(matches, predicate) {
  let weightedHits = 0;
  let totalWeight = 0;
  let hits = 0;
  matches.forEach((match) => {
    totalWeight += match.weight;
    if (predicate(match)) {
      hits += 1;
      weightedHits += match.weight;
    }
  });
  return {
    hits,
    simpleRate: matches.length ? hits / matches.length : 0,
    weightedRate: totalWeight ? weightedHits / totalWeight : 0,
    totalWeight
  };
}

function sideSummary(matches, teamId, teamName) {
  let wins = 0; let draws = 0; let losses = 0; let goalsFor = 0; let goalsAgainst = 0;
  let weightedWins = 0; let weightedNonLosses = 0; let totalWeight = 0;
  for (const match of matches) {
    const isHome = teamId !== null && teamId !== undefined
      ? String(match.homeTeamId) === String(teamId)
      : normalizedName(match.homeTeam) === normalizedName(teamName);
    const scored = isHome ? match.homeGoals : match.awayGoals;
    const conceded = isHome ? match.awayGoals : match.homeGoals;
    totalWeight += match.weight;
    goalsFor += scored;
    goalsAgainst += conceded;
    if (scored > conceded) {
      wins += 1;
      weightedWins += match.weight;
      weightedNonLosses += match.weight;
    } else if (scored === conceded) {
      draws += 1;
      weightedNonLosses += match.weight;
    } else losses += 1;
  }
  return {
    matches: matches.length, wins, draws, losses, goalsFor, goalsAgainst,
    winRate: matches.length ? wins / matches.length : 0,
    nonLossRate: matches.length ? (wins + draws) / matches.length : 0,
    weightedWinRate: totalWeight ? weightedWins / totalWeight : 0,
    weightedNonLossRate: totalWeight ? weightedNonLosses / totalWeight : 0
  };
}

function median(values) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function candidateScore({ weightedRate, simpleRate, sampleSize, recentRate, threshold, penalties = 0 }) {
  const sampleQuality = Math.min(1, sampleSize / 6);
  const thresholdMargin = Math.max(0, Math.min(1, (weightedRate - threshold) / Math.max(0.01, 1 - threshold)));
  return round(100 * ((0.45 * weightedRate) + (0.15 * simpleRate) + (0.15 * sampleQuality)
    + (0.15 * recentRate) + (0.10 * thresholdMargin)) - penalties, 2);
}

function buildCandidate({ key, market, selection, kind, priority, matches, predicate, threshold, minimumMatches = 3, extraReasons = [] }) {
  const summary = weightedSummary(matches, predicate);
  const recent = weightedSummary(matches.slice(0, Math.min(3, matches.length)), predicate);
  const reasons = [...extraReasons];
  if (matches.length < minimumMatches) reasons.push(`Requiere al menos ${minimumMatches} partidos comparables.`);
  if (summary.weightedRate < threshold) reasons.push(`Cumplimiento ponderado inferior al ${Math.round(threshold * 100)}%.`);
  if (recent.simpleRate < (2 / 3)) reasons.push("La tendencia se contradice en los enfrentamientos más recientes.");
  const penalties = (recent.simpleRate < (2 / 3) ? 10 : 0)
    + (matches.length >= 4 && recent.simpleRate + 0.2 < summary.simpleRate ? 8 : 0);
  return {
    key, market, selection, kind, priority, threshold,
    sampleSize: matches.length,
    hits: summary.hits,
    simpleRate: summary.simpleRate,
    weightedRate: summary.weightedRate,
    recentRate: recent.simpleRate,
    score: candidateScore({ ...summary, sampleSize: matches.length, recentRate: recent.simpleRate, threshold, penalties }),
    eligible: reasons.length === 0,
    rejectionReasons: reasons
  };
}

function percent(value) {
  return round(value * 100, 1);
}

function noRecommendation(base, warnings, rejectedCandidates, reason) {
  return {
    ...base,
    recommendedMarket: null,
    recommendedSelection: "Sin pick H2H recomendado",
    confidence: "Baja",
    weightedRate: null,
    explanation: reason,
    rejectedCandidates,
    warnings: [...warnings, reason]
  };
}

export function evaluateH2HRecommendation({
  matches = [], currentHomeTeam = {}, currentAwayTeam = {}, currentFixtureDate = "", neutralVenue = false, source = "api-football"
} = {}) {
  const rawMatches = Array.isArray(matches) ? matches : [];
  const currentHome = { id: currentHomeTeam.id ?? null, name: currentHomeTeam.name || "" };
  const currentAway = { id: currentAwayTeam.id ?? null, name: currentAwayTeam.name || "" };
  const cutoff = timestamp(currentFixtureDate) || Number.POSITIVE_INFINITY;
  const warnings = [];
  const invalidRows = [];
  const unique = new Map();

  rawMatches.forEach((raw, index) => {
    const match = normalizeMatch(raw, currentHome, currentAway);
    const valid = match.fixtureId && match.timestamp && match.timestamp < cutoff
      && FINISHED_STATUSES.has(match.statusShort) && match.homeGoals !== null && match.awayGoals !== null
      && match.homeGoals >= 0 && match.awayGoals >= 0 && match.pairMatches;
    if (!valid) {
      invalidRows.push({ index, fixtureId: match.fixtureId, reason: match.pairMatches ? "Datos o marcador inválidos." : "Los equipos no coinciden con el fixture actual." });
      return;
    }
    const existing = unique.get(match.fixtureId);
    if (existing && (existing.homeGoals !== match.homeGoals || existing.awayGoals !== match.awayGoals)) {
      invalidRows.push({ index, fixtureId: match.fixtureId, reason: "Fixture duplicado con marcadores contradictorios." });
      unique.delete(match.fixtureId);
      return;
    }
    if (!existing) unique.set(match.fixtureId, match);
  });

  const usable = [...unique.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, 10)
    .map((match, index) => ({ ...match, weight: weightFor(index) }));
  const currentHomeAtHome = usable.filter((match) => currentHome.id !== null && match.homeTeamId !== null
    ? String(match.homeTeamId) === String(currentHome.id)
    : normalizedName(match.homeTeam) === normalizedName(currentHome.name));
  const currentAwayAway = usable.filter((match) => currentAway.id !== null && match.awayTeamId !== null
    ? String(match.awayTeamId) === String(currentAway.id)
    : normalizedName(match.awayTeam) === normalizedName(currentAway.name));
  const homeSummary = sideSummary(currentHomeAtHome, currentHome.id, currentHome.name);
  const awaySummary = sideSummary(currentAwayAway, currentAway.id, currentAway.name);
  const totals = usable.map((match) => match.homeGoals + match.awayGoals);
  const generalMetrics = {
    averageGoals: usable.length ? round(totals.reduce((sum, value) => sum + value, 0) / usable.length, 2) : null,
    medianGoals: median(totals),
    minimumGoals: totals.length ? Math.min(...totals) : null,
    maximumGoals: totals.length ? Math.max(...totals) : null,
    over05: weightedSummary(usable, (match) => match.homeGoals + match.awayGoals > 0.5),
    over15: weightedSummary(usable, (match) => match.homeGoals + match.awayGoals > 1.5),
    over25: weightedSummary(usable, (match) => match.homeGoals + match.awayGoals > 2.5),
    under35: weightedSummary(usable, (match) => match.homeGoals + match.awayGoals < 3.5),
    bttsYes: weightedSummary(usable, (match) => match.homeGoals > 0 && match.awayGoals > 0),
    bttsNo: weightedSummary(usable, (match) => !(match.homeGoals > 0 && match.awayGoals > 0))
  };
  const base = {
    sampleSize: usable.length,
    totalAvailable: rawMatches.length,
    comparableHomeMatches: currentHomeAtHome.length,
    comparableAwayMatches: currentAwayAway.length,
    homeSummary: { ...homeSummary, winRatePct: percent(homeSummary.winRate), nonLossRatePct: percent(homeSummary.nonLossRate), weightedWinRatePct: percent(homeSummary.weightedWinRate), weightedNonLossRatePct: percent(homeSummary.weightedNonLossRate) },
    awaySummary: { ...awaySummary, winRatePct: percent(awaySummary.winRate), nonLossRatePct: percent(awaySummary.nonLossRate), weightedWinRatePct: percent(awaySummary.weightedWinRate), weightedNonLossRatePct: percent(awaySummary.weightedNonLossRate) },
    generalMetrics: Object.fromEntries(Object.entries(generalMetrics).map(([key, value]) => value?.weightedRate === undefined ? [key, value] : [key, { ...value, simpleRatePct: percent(value.simpleRate), weightedRatePct: percent(value.weightedRate) }])),
    calculationDetails: {
      weights: usable.map((match) => ({ fixtureId: match.fixtureId, date: match.date, weight: match.weight })),
      invalidRows,
      neutralVenue: Boolean(neutralVenue)
    }
  };

  if (!currentHome.name || !currentAway.name || (currentHome.id === null && currentAway.id === null)) {
    return noRecommendation(base, warnings, [], "No fue posible validar correctamente la identidad de ambos equipos.");
  }
  if (String(source).toLowerCase() !== "api-football") {
    return noRecommendation(base, warnings, [], "La fuente H2H activa no es API-Football confirmado; se conserva únicamente como contexto informativo.");
  }
  if (invalidRows.length) {
    return noRecommendation(base, warnings, [], "Hay enfrentamientos duplicados, incompletos o con marcadores inválidos.");
  }
  if (usable.length < 3) return noRecommendation(base, warnings, [], "Menos de 3 enfrentamientos utilizables.");

  const newestAgeYears = (cutoff - usable[0].timestamp) / (365.25 * 86400000);
  if (Number.isFinite(newestAgeYears) && newestAgeYears > 4) {
    return noRecommendation(base, warnings, [], "La recomendación dependería excesivamente de enfrentamientos antiguos.");
  }
  if (neutralVenue) warnings.push("El próximo encuentro figura en sede neutral; la evidencia de localía se interpreta con cautela.");

  const candidates = [];
  const homeWinPredicate = (match) => match.homeGoals > match.awayGoals;
  const awayWinPredicate = (match) => match.awayGoals > match.homeGoals;
  const homeWinCandidate = buildCandidate({ key: "home_win", market: "Resultado 1X2", selection: `Gana ${currentHome.name}`, kind: "direct", priority: 3, matches: currentHomeAtHome, predicate: homeWinPredicate, threshold: 0.70,
    extraReasons: homeSummary.wins < 2 ? ["La tendencia depende de un único triunfo."] : [] });
  const awayWinCandidate = buildCandidate({ key: "away_win", market: "Resultado 1X2", selection: `Gana ${currentAway.name}`, kind: "direct", priority: 3, matches: currentAwayAway, predicate: awayWinPredicate, threshold: 0.70,
    extraReasons: awaySummary.wins < 2 ? ["La tendencia depende de un único triunfo."] : [] });
  candidates.push(homeWinCandidate, awayWinCandidate);
  candidates.push(buildCandidate({ key: "home_double_chance", market: "Doble oportunidad", selection: `${currentHome.name} o empate (1X)`, kind: "double_chance", priority: 2, matches: currentHomeAtHome, predicate: (match) => match.homeGoals >= match.awayGoals, threshold: 0.75,
    extraReasons: homeWinCandidate.eligible && homeSummary.draws === 0 ? ["La victoria directa ya presenta una tendencia estable sin empates."] : [] }));
  candidates.push(buildCandidate({ key: "away_double_chance", market: "Doble oportunidad", selection: `${currentAway.name} o empate (X2)`, kind: "double_chance", priority: 2, matches: currentAwayAway, predicate: (match) => match.awayGoals >= match.homeGoals, threshold: 0.75,
    extraReasons: awayWinCandidate.eligible && awaySummary.draws === 0 ? ["La victoria directa ya presenta una tendencia estable sin empates."] : [] }));

  const goalCandidates = [
    buildCandidate({ key: "over15", market: "Total de goles", selection: "Más de 1.5 goles", kind: "conservative_goal", priority: 1, matches: usable, predicate: (match) => match.homeGoals + match.awayGoals > 1.5, threshold: 0.75 }),
    buildCandidate({ key: "under35", market: "Total de goles", selection: "Menos de 3.5 goles", kind: "conservative_goal", priority: 1, matches: usable, predicate: (match) => match.homeGoals + match.awayGoals < 3.5, threshold: 0.75 }),
    buildCandidate({ key: "over25", market: "Total de goles", selection: "Más de 2.5 goles", kind: "aggressive_goal", priority: 4, matches: usable, predicate: (match) => match.homeGoals + match.awayGoals > 2.5, threshold: 0.70 }),
    buildCandidate({ key: "btts_yes", market: "Ambos equipos anotan", selection: "Sí", kind: "aggressive_goal", priority: 4, matches: usable, predicate: (match) => match.homeGoals > 0 && match.awayGoals > 0, threshold: 0.70 }),
    buildCandidate({ key: "btts_no", market: "Ambos equipos anotan", selection: "No", kind: "aggressive_goal", priority: 4, matches: usable, predicate: (match) => !(match.homeGoals > 0 && match.awayGoals > 0), threshold: 0.70 })
  ];
  const usefulGoalExists = goalCandidates.some((candidate) => candidate.eligible);
  const over05 = buildCandidate({ key: "over05", market: "Total de goles", selection: "Más de 0.5 goles", kind: "fallback_goal", priority: 4, matches: usable, predicate: (match) => match.homeGoals + match.awayGoals > 0.5, threshold: 0.85,
    extraReasons: usefulGoalExists ? ["Existe otro umbral de goles más útil con evidencia suficiente."] : [] });
  candidates.push(...goalCandidates, over05);

  const bestConservativeGoal = goalCandidates.filter((candidate) => candidate.eligible && candidate.kind === "conservative_goal")
    .sort((a, b) => b.score - a.score)[0];
  if (bestConservativeGoal) {
    for (const candidate of [homeWinCandidate, awayWinCandidate]) {
      const broaderStableGoalTrend = candidate.eligible
        && bestConservativeGoal.sampleSize >= candidate.sampleSize + 2
        && bestConservativeGoal.weightedRate >= candidate.weightedRate - 0.10;
      if (!broaderStableGoalTrend) continue;
      candidate.eligible = false;
      candidate.rejectionReasons.push(`${bestConservativeGoal.selection} presenta una muestra más amplia y una estabilidad ponderada comparable.`);
    }
  }

  const eligible = candidates.filter((candidate) => candidate.eligible).sort((a, b) => {
    const scoreDifference = b.score - a.score;
    return Math.abs(scoreDifference) > 3 ? scoreDifference : a.priority - b.priority || scoreDifference;
  });
  const rejectedCandidates = candidates.filter((candidate) => !candidate.eligible).map((candidate) => ({
    market: candidate.market, selection: candidate.selection, weightedRatePct: percent(candidate.weightedRate), reasons: candidate.rejectionReasons
  }));
  if (!eligible.length) return noRecommendation(base, warnings, rejectedCandidates, "Ninguna tendencia H2H alcanza los umbrales mínimos con consistencia suficiente.");
  if (eligible.length > 1 && Math.abs(eligible[0].score - eligible[1].score) < 1 && eligible[0].priority === eligible[1].priority) {
    return noRecommendation(base, warnings, rejectedCandidates, "Existe un empate técnico entre mercados sin una ventaja clara.");
  }

  const winner = eligible[0];
  const confidence = winner.sampleSize >= 6 && winner.weightedRate >= 0.80 && winner.recentRate === 1 ? "Alta" : "Media";
  const rejectedDirectComparator = winner.kind.includes("goal")
    ? candidates.filter((candidate) => candidate.kind === "direct" && !candidate.eligible)
      .sort((a, b) => b.score - a.score)[0]
    : null;
  const comparisonCandidate = rejectedDirectComparator || eligible[1];
  const comparison = comparisonCandidate
    ? `${winner.selection} superó a ${comparisonCandidate.selection} en estabilidad, muestra o prioridad conservadora.`
    : `${winner.selection} fue la única tendencia que superó todos los filtros.`;
  const localityText = winner.kind.includes("goal")
    ? "La tendencia de goles depende menos de la localía histórica."
    : `La conclusión utiliza ${winner.sampleSize} enfrentamientos con localías comparables.`;
  return {
    ...base,
    recommendedMarket: winner.market,
    recommendedSelection: winner.selection,
    confidence,
    weightedRate: percent(winner.weightedRate),
    explanation: `${comparison} ${localityText}`,
    rejectedCandidates,
    warnings: [...warnings, "El H2H es evidencia contextual y no constituye un pronóstico completo ni una apuesta segura."],
    calculationDetails: {
      ...base.calculationDetails,
      winningCandidate: winner,
      eligibleCandidates: eligible
    }
  };
}

export const H2H_RECENCY_WEIGHTS = RECENCY_WEIGHTS;
