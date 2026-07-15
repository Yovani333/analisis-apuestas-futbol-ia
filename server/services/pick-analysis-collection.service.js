const number = (value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const round = (value, digits = 1) => Number(Number(value || 0).toFixed(digits));
const metricNumber = (value) => number(typeof value === "string" ? value.replace("%", "").trim() : value);

function moduleEntry({ name, result, source, status, confidence = "No disponible", probability = null, sampleSize = null, warnings = [], feeds = [] }) {
  return {
    name,
    result: result || "No disponible",
    probability,
    sampleSize,
    source: source || "No disponible",
    quality: status || "not_available",
    confidence,
    warnings: [...new Set(warnings.filter(Boolean))],
    status: status === "available" ? "valid" : status === "partial" || status === "insufficient_data" ? "insufficient" : "not_available",
    feeds,
    updatedAt: new Date().toISOString()
  };
}

function canonicalKey(pick = {}) {
  const market = String(pick.marketKey || pick.market || "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const selection = String(pick.selectionKey || pick.playerId || pick.selection || "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return `${market}:${selection}`;
}

function candidateFromPick(fixture, pick, sourceModule, sourceLabel, sourceFamily = sourceModule) {
  const confidenceScore = number(pick.confidenceScore ?? pick.goalThreatScore ?? pick.finalPickScore) ?? 0;
  const decimalOdds = number(pick.decimalOdds ?? pick.odds);
  const modelProbability = number(pick.modelProbabilityPct ?? pick.probabilityPct ?? pick.estimatedProbabilityPct ?? pick.conservativeGoalProbability);
  const expectedValue = number(pick.expectedValuePct) ?? (decimalOdds && modelProbability !== null ? round(decimalOdds * modelProbability - 100) : null);
  const decision = String(pick.decision || pick.level || "").toLowerCase();
  const blocked = /evitar|no bet|sin valor|datos insuficientes/.test(decision) || ["red", "gray"].includes(pick.highlightColor || pick.color);
  const allowedWithoutOdds = ["player_goal_candidate", "team_average_performance"].includes(sourceModule);
  if (!pick.market || !pick.selection || confidenceScore < 45 || blocked) return null;
  if (!allowedWithoutOdds && (!decimalOdds || expectedValue === null || expectedValue < 0)) return null;
  return {
    id: `${fixture.id}:collection:${sourceModule}:${pick.selectionKey || pick.playerId || pick.selection}`,
    fixtureId: fixture.id,
    league: fixture.leagueName,
    home: fixture.home,
    away: fixture.away,
    date: fixture.date,
    market: pick.market,
    selection: pick.selection,
    marketCode: pick.marketKey || sourceModule,
    selectionCode: pick.selectionKey || pick.playerId || pick.selection,
    decimalOdds,
    originalOdds: decimalOdds,
    updatedOdds: null,
    impliedProbability: decimalOdds ? round(100 / decimalOdds) : null,
    modelProbability,
    estimatedProbability: modelProbability,
    fairOdds: modelProbability ? round(100 / modelProbability, 2) : null,
    expectedValue,
    fixtureStatus: fixture.statusLabel || fixture.status,
    kickoffAt: fixture.utcDateTime || null,
    lastUpdatedAt: new Date().toISOString(),
    confidence: pick.confidence || `${confidenceScore}/100`,
    confidenceScore,
    risk: pick.risk || pick.level || (confidenceScore >= 70 ? "Medio" : "Revisión"),
    reasoning: pick.explanation || pick.reasoning || "Selección respaldada por datos normalizados.",
    requiresReview: Boolean(pick.requiresReview) || confidenceScore < 70 || !decimalOdds,
    sourceModule: "pick_analysis_snapshot",
    originModule: sourceModule,
    source: sourceLabel,
    sourceLabel: "Picks recomendados",
    backingModels: [sourceLabel],
    independentFamilies: [sourceFamily],
    allowSingleSource: ["data_picks", "corners", "player_goal_candidate", "team_average_performance"].includes(sourceModule) && Boolean(pick.canAdd ?? true),
    supportingData: pick.supportingData || [],
    contradictingData: pick.contradictingData || [],
    modelSignals: modelProbability === null ? [] : [{ source: sourceLabel, probability: modelProbability }],
    collectionKey: canonicalKey(pick)
  };
}

export function buildPerformanceWinnerPick(fixture, teamPerformance, oddsMarkets = []) {
  const home = teamPerformance?.equipo_local;
  const away = teamPerformance?.equipo_visitante;
  const metrics = ["pases_acertados", "tiros", "entradas"];
  if (!fixture?.id || !home?.nombre || !away?.nombre || !home?.metricas || !away?.metricas) return null;
  if (metrics.some((key) => metricNumber(home.metricas[key]) === null || metricNumber(away.metricas[key]) === null)) return null;

  const homeLeads = metrics.every((key) => metricNumber(home.metricas[key]) > metricNumber(away.metricas[key]));
  const awayLeads = metrics.every((key) => metricNumber(away.metricas[key]) > metricNumber(home.metricas[key]));
  if (!homeLeads && !awayLeads) return null;

  const side = homeLeads ? "home" : "away";
  const team = homeLeads ? home : away;
  const opponent = homeLeads ? away : home;
  const selectionKey = `${side}_win`;
  const marketOdd = oddsMarkets.find((item) => item.marketKey === "match_winner" && item.selectionKey === selectionKey);
  const k = Number(teamPerformance?.k || 0);
  const confidenceScore = k >= 5 ? 65 : k >= 3 ? 58 : 50;
  const gaps = metrics.map((key) => `${key.replace("pases_acertados", "pases acertados")}: ${round(metricNumber(team.metricas[key]) - metricNumber(opponent.metricas[key]), 2)}`);

  return {
    marketKey: "match_winner",
    selectionKey,
    market: "Resultado 1X2",
    selection: marketOdd?.selection || `${team.nombre} gana`,
    decimalOdds: marketOdd?.decimalOdds ?? null,
    expectedValuePct: marketOdd?.expectedValuePct ?? null,
    modelProbabilityPct: marketOdd?.estimatedProbabilityPct ?? null,
    confidenceScore,
    confidence: k >= 5 ? "Media-alta" : "Media",
    risk: "Señal comparativa; validar con 1X2 y cuotas",
    decision: "PRECAUCIÓN",
    highlightColor: "orange",
    canAdd: true,
    requiresReview: true,
    explanation: `${team.nombre} supera a ${opponent.nombre} simultáneamente en pases acertados, tiros y entradas dentro de la muestra k=${k}. Se recomienda como posible ganador, sujeto a validación con cuotas y contexto del partido.`,
    supportingData: gaps,
    contradictingData: []
  };
}

function candidateSources(fixture, results, oddsMarkets = []) {
  const rows = [];
  const add = (picks, module, label, filter = () => true) => {
    for (const pick of picks || []) {
      if (!filter(pick)) continue;
      const candidate = candidateFromPick(fixture, pick, module, label);
      if (candidate) rows.push(candidate);
    }
  };
  add(results.dataPicks?.picks, "data_picks", "Picks basados en datos", (pick) => pick.canAdd);
  add(results.poisson?.suggestedMarkets, "poisson", "Modelo Poisson");
  add(results.teamGoals?.picks, "team_goals", "Probabilidad de gol por equipo");
  add(results.corners?.picks, "corners", "Corners");
  for (const group of results.specificMarkets?.groups || []) {
    for (const pick of group.picks || []) {
      const family = pick.sourceModule || "specific_markets";
      const label = family === "poisson" ? "Modelo Poisson" : family === "team_goals" ? "Probabilidad de gol por equipo" : family === "corners" ? "Corners" : `Catálogo: ${group.label}`;
      const candidate = candidateFromPick(fixture, pick, "specific_markets", label, family);
      if (candidate) rows.push(candidate);
    }
  }
  for (const side of ["home", "away"]) add(results.teamPerformance?.picks?.[side], "team_average_performance", "Rendimiento promedio por equipo", (pick) => pick.canAdd);
  add([buildPerformanceWinnerPick(fixture, results.teamPerformance, oddsMarkets)].filter(Boolean), "team_average_performance", "Rendimiento promedio por equipo");
  add(results.playerGoals?.candidates, "player_goal_candidate", "Jugador con posible gol");
  return rows;
}

function mergeConsensus(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const current = grouped.get(row.collectionKey) || { ...row, backingModels: [], independentFamilies: [], supportingData: [], contradictingData: [], modelSignals: [], allowSingleSource: false };
    current.backingModels = [...new Set([...current.backingModels, ...row.backingModels])];
    current.independentFamilies = [...new Set([...current.independentFamilies, ...row.independentFamilies])];
    current.allowSingleSource ||= row.allowSingleSource;
    current.supportingData = [...new Set([...current.supportingData, ...row.supportingData])];
    current.contradictingData = [...new Set([...current.contradictingData, ...row.contradictingData])];
    current.modelSignals = [...current.modelSignals, ...row.modelSignals];
    const probabilities = current.modelSignals.map((signal) => signal.probability).filter((value) => value !== null);
    if (probabilities.length >= 2 && Math.max(...probabilities) - Math.min(...probabilities) >= 15) {
      current.contradictingData = [...new Set([...current.contradictingData, `Modelos difieren ${round(Math.max(...probabilities) - Math.min(...probabilities))} puntos en esta selección.`])];
    }
    if (row.confidenceScore > current.confidenceScore || (!current.decimalOdds && row.decimalOdds)) Object.assign(current, { ...row, backingModels: current.backingModels, independentFamilies: current.independentFamilies, allowSingleSource: current.allowSingleSource, supportingData: current.supportingData, contradictingData: current.contradictingData, modelSignals: current.modelSignals });
    grouped.set(row.collectionKey, current);
  }
  return [...grouped.values()]
    .map(({ collectionKey, modelSignals, allowSingleSource, ...row }) => ({
      ...row,
      canAdd: row.contradictingData.length === 0 && (allowSingleSource || row.independentFamilies.length >= 2),
      requiresReview: row.requiresReview || row.independentFamilies.length < 2 || row.contradictingData.length > 0
    }))
    .sort((a, b) => Number(b.canAdd) - Number(a.canAdd) || b.backingModels.length - a.backingModels.length || b.confidenceScore - a.confidenceScore || (b.expectedValue ?? -Infinity) - (a.expectedValue ?? -Infinity))
    .slice(0, 8);
}

export function buildPickAnalysisCollection(dataset, results, apiUsage = {}) {
  const fixture = dataset.fixture || {};
  const outcomeLeader = results.outcome?.scenarios?.find((scenario) => scenario.label === results.outcome?.resultMostLikely);
  const modules = [
    moduleEntry({ name: "Fixture", result: `${fixture.home} vs ${fixture.away}`, source: dataset.source || "API-Football", status: fixture.id ? "available" : "not_available", confidence: `${dataset.dataQuality?.score ?? 0}/100`, feeds: ["Todos los mercados"] }),
    moduleEntry({ name: "Rendimiento reciente", result: results.teamPerformance?.status, sampleSize: results.teamPerformance?.k, source: results.teamPerformance?.source, status: results.teamPerformance?.status, confidence: results.teamPerformance?.status === "available" ? "Media" : "Baja", warnings: [results.teamPerformance?.message], feeds: ["Rendimiento", "Goles", "1X2"] }),
    moduleEntry({ name: "Selector 1X2", result: results.outcome?.resultMostLikely, probability: outcomeLeader?.probabilityPct, source: results.outcome?.source, status: results.outcome?.status, confidence: results.outcome?.confidenceLabel, warnings: [results.outcome?.warning], feeds: ["1X2", "Doble oportunidad"] }),
    moduleEntry({ name: "Poisson", result: results.poisson?.status, source: results.poisson?.source, status: results.poisson?.status, confidence: results.poisson?.quality?.label, warnings: [results.poisson?.warning], feeds: ["1X2", "Goles", "BTTS"] }),
    moduleEntry({ name: "Ataque vs Defensa", result: results.teamGoals?.status, source: results.teamGoals?.source, status: results.teamGoals?.status, confidence: results.teamGoals?.quality?.label, warnings: [results.teamGoals?.warning], feeds: ["Goles", "BTTS"] }),
    moduleEntry({ name: "Corners", result: results.corners?.status, source: results.corners?.source, status: results.corners?.status, confidence: results.corners?.quality?.label, warnings: results.corners?.warnings || [results.corners?.warning], feeds: ["Corners"] }),
    moduleEntry({ name: "Jugadores", result: results.playerGoals?.status, sampleSize: results.playerGoals?.playersEvaluated, source: results.playerGoals?.source, status: results.playerGoals?.status, confidence: results.playerGoals?.candidates?.[0]?.confidence || "No disponible", warnings: [results.playerGoals?.message], feeds: ["Jugador con posible gol", "Forma individual"] }),
    moduleEntry({ name: "Mercado y cuotas", result: `${dataset.marketAnalysis?.length || 0} mercados normalizados`, source: "API-Football", status: dataset.marketAnalysis?.length ? "available" : "not_available", confidence: dataset.marketAnalysis?.length ? "Media" : "No disponible", feeds: ["EV", "Cuotas"] })
  ];
  const candidateMarkets = mergeConsensus(candidateSources(fixture, results, dataset.marketAnalysis || []));
  const consensus = candidateMarkets.map((pick) => ({
    market: pick.market,
    selection: pick.selection,
    models: pick.backingModels,
    confidence: pick.confidenceScore,
    status: pick.contradictingData?.length ? "contradictory" : pick.canAdd ? "valid" : "single_source"
  }));
  const contradictions = [...new Set([
    ...(results.outcome?.contradictions || []),
    ...candidateMarkets.flatMap((pick) => pick.contradictingData || [])
  ])];
  const missingData = modules.filter((module) => module.status !== "valid").map((module) => module.name);
  const validModules = modules.filter((module) => module.status === "valid").length;
  const availablePct = Math.round(validModules / modules.length * 100);
  return {
    type: "pickAnalysisSnapshot",
    modelVersion: "pick-analysis-snapshot-v3",
    fixtureId: fixture.id,
    generatedAt: new Date().toISOString(),
    source: "server-orchestrated-cache-and-api",
    match: { competition: fixture.leagueName, season: fixture.season, date: fixture.date, time: fixture.time, home: fixture.home, away: fixture.away, venue: fixture.stadium, status: fixture.statusLabel || fixture.status },
    summary: {
      globalQuality: availablePct >= 70 ? "Disponible" : availablePct >= 40 ? "Parcial" : "Datos insuficientes",
      availablePct, modulesEvaluated: modules.length, validModules, contradictions: contradictions.length,
      apiRequests: apiUsage.networkRequests || 0, cacheHits: apiUsage.cacheHits || 0,
      cacheUsed: Boolean(apiUsage.cacheHits) || dataset.cacheInfo?.status === "hit"
    },
    modules,
    consensus,
    contradictions,
    missingData,
    candidateMarkets,
    warnings: candidateMarkets.length ? [] : ["No se encontró un pick recomendado: faltan calidad, cuota, consenso o coherencia suficientes."],
    audit: { formulas: ["Poisson", "Outcome 1X2 v2", "Team goals", "Corners", "Team performance", "Player goal candidates v2"], apiUsage, cacheInfo: dataset.cacheInfo || null }
  };
}
