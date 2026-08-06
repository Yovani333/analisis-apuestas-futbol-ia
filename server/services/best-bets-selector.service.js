import { BEST_BETS_CONFIG, validateBestBetsConfig } from "../config/best-bets.config.js";

const clamp = (value, minimum = 0, maximum = 100) => Math.max(minimum, Math.min(maximum, Number(value) || 0));
const round = (value, digits = 2) => Number(Number(value).toFixed(digits));
const numeric = (value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const normalized = (value) => String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

const EXPECTED_MARKET_SIDES = Object.freeze({ match_winner: 3, btts: 2, over_under_1_5: 2, over_under_2_5: 2, over_under_3_5: 2 });

export function calculateOddsMetrics({ odds, modelProbabilityPct, marketOdds = [] } = {}) {
  const decimalOdds = numeric(odds);
  const probabilityPct = numeric(modelProbabilityPct);
  if (!(decimalOdds > 1) || !(probabilityPct > 0 && probabilityPct < 100)) {
    return { impliedProbabilityPct: null, normalizedImpliedProbabilityPct: null, fairOdds: null, edgePct: null, expectedValuePct: null, overroundPct: null };
  }
  const rawImplied = 100 / decimalOdds;
  const validMarketOdds = marketOdds.map(numeric).filter((value) => value > 1);
  const overround = validMarketOdds.length >= 2 ? validMarketOdds.reduce((sum, value) => sum + (1 / value), 0) : null;
  const normalizedImplied = overround && overround >= 1 ? rawImplied / overround : rawImplied;
  return {
    impliedProbabilityPct: round(rawImplied),
    normalizedImpliedProbabilityPct: round(normalizedImplied),
    fairOdds: round(100 / probabilityPct),
    edgePct: round(probabilityPct - normalizedImplied),
    expectedValuePct: round((probabilityPct / 100 * decimalOdds - 1) * 100),
    overroundPct: overround ? round((overround - 1) * 100) : null
  };
}

function wilsonLowerBound(hits, total, z = 1.96) {
  if (!total) return null;
  const proportion = hits / total;
  const denominator = 1 + (z ** 2) / total;
  const center = proportion + (z ** 2) / (2 * total);
  const margin = z * Math.sqrt((proportion * (1 - proportion) + (z ** 2) / (4 * total)) / total);
  return clamp((center - margin) / denominator * 100);
}

export function historicalReliabilityFor(candidate = {}, records = [], config = BEST_BETS_CONFIG) {
  const leagueId = String(candidate.leagueId || "");
  const marketKey = normalized(candidate.marketKey || candidate.market);
  const source = normalized(candidate.originModule || candidate.sourceModule || candidate.origin);
  const modelVersion = normalized(candidate.modelVersion);
  const matchingContext = (Array.isArray(records) ? records : []).filter((row) => {
    const outcome = String(row.outcome || row.result || "").toUpperCase();
    if (!["HIT", "MISS", "WON", "LOST"].includes(outcome)) return false;
    const rowLeague = String(row.leagueId || "");
    const rowMarket = normalized(row.marketKey || row.marketCode || row.market);
    const rowSource = normalized(row.originModule || row.sourceModule || row.origin);
    return (!leagueId || !rowLeague || rowLeague === leagueId)
      && (!marketKey || !rowMarket || rowMarket === marketKey)
      && (!source || !rowSource || rowSource === source);
  });
  const eligible = modelVersion
    ? matchingContext.filter((row) => normalized(row.modelVersion) === modelVersion)
    : matchingContext;
  const hits = eligible.filter((row) => ["HIT", "WON"].includes(String(row.outcome || row.result || "").toUpperCase())).length;
  const total = eligible.length;
  const hitRatePct = total ? round(hits / total * 100) : null;
  const lowerBoundPct = wilsonLowerBound(hits, total);
  const status = total >= config.thresholds.adequateHistoricalSample ? "adequate"
    : total >= config.thresholds.minimumHistoricalSample ? "provisional" : "insufficient";
  const score = status === "adequate" ? round(lowerBoundPct) : status === "provisional" ? round((lowerBoundPct + 50) / 2) : 35;
  return {
    sampleSize: total, hits, misses: total - hits, hitRatePct,
    lowerBoundPct: lowerBoundPct === null ? null : round(lowerBoundPct), score, status,
    modelVersion: candidate.modelVersion || null,
    excludedByVersion: Math.max(0, matchingContext.length - eligible.length)
  };
}

function oddsAgeMinutes(candidate, now) {
  const updatedAt = Date.parse(candidate.oddsUpdatedAt || "");
  return Number.isFinite(updatedAt) ? Math.max(0, (now.getTime() - updatedAt) / 60000) : null;
}

function marketOddsFor(candidate, oddsMarkets = []) {
  const marketKey = candidate.marketKey || candidate.marketCode;
  const marketRows = oddsMarkets.filter((row) => row.marketKey === marketKey && numeric(row.decimalOdds) > 1);
  const rows = candidate.bookmaker
    ? marketRows.filter((row) => row.bookmaker === candidate.bookmaker)
    : marketRows.length && marketRows.every((row) => row.bookmaker === marketRows[0].bookmaker) ? marketRows : [];
  const expected = EXPECTED_MARKET_SIDES[marketKey];
  return expected && rows.length === expected ? rows.map((row) => row.decimalOdds) : [];
}

function evidenceScore(candidate = {}) {
  const families = new Set(candidate.independentFamilies || candidate.backingModels || []);
  const sample = numeric(candidate.sampleSize) || 0;
  const sourceScore = families.size >= 3 ? 85 : families.size === 2 ? 70 : 45;
  return clamp(sourceScore + (sample >= 8 ? 10 : sample >= 5 ? 5 : sample > 0 && sample < 3 ? -15 : 0));
}

function consistencyScore(candidate = {}) {
  const contradictions = (candidate.contradictingData || []).length;
  const families = new Set(candidate.independentFamilies || candidate.backingModels || []);
  return clamp(55 + Math.min(30, families.size * 10) - contradictions * 25);
}

function scoreCandidate(parts, config) {
  const { weights } = config;
  return round(
    clamp(parts.modelProbabilityPct) * weights.modelProbability / 100
    + clamp(50 + parts.edgePct * 4) * weights.edge / 100
    + clamp(50 + parts.expectedValuePct * 2.5) * weights.expectedValue / 100
    + parts.dataQualityScore * weights.dataQuality / 100
    + parts.evidenceScore * weights.evidence / 100
    + parts.historicalReliability.score * weights.historicalReliability / 100
    + parts.modelConsistencyScore * weights.modelConsistency / 100
  );
}

function riskScoreFor(parts) {
  let risk = 15;
  if (parts.dataQualityScore < 70) risk += 15;
  if (parts.evidenceScore < 60) risk += 12;
  if (parts.historicalReliability.status === "insufficient") risk += 18;
  if (parts.oddsAgeMinutes === null) risk += 10;
  if (parts.oddsAgeMinutes > 180) risk += 10;
  risk += Math.min(30, parts.contradictions.length * 15);
  return clamp(risk);
}

function adaptCandidate(candidate = {}, fixturePackage = {}, historyRecords = [], config = BEST_BETS_CONFIG, now = new Date()) {
  const fixture = fixturePackage.fixture || {};
  const odds = numeric(candidate.decimalOdds ?? candidate.odds);
  const modelProbabilityPct = numeric(candidate.modelProbability ?? candidate.modelProbabilityPct ?? candidate.estimatedProbability);
  const oddsMetrics = calculateOddsMetrics({ odds, modelProbabilityPct, marketOdds: marketOddsFor(candidate, fixturePackage.oddsMarkets || []) });
  const dataQualityScore = clamp(numeric(candidate.dataQualityScore) ?? numeric(fixturePackage.dataQualityScore) ?? numeric(fixturePackage.summary?.availablePct) ?? 0);
  const adapted = {
    id: candidate.id || `${fixture.id || candidate.fixtureId}:${candidate.marketCode || candidate.marketKey}:${candidate.selectionCode || candidate.selectionKey}`,
    fixtureId: String(candidate.fixtureId || fixture.id || ""), leagueId: candidate.leagueId ?? fixture.leagueId ?? null,
    leagueName: candidate.league || candidate.leagueName || fixture.leagueName || "No disponible",
    country: candidate.country || fixture.country || null, season: candidate.season ?? fixture.season ?? null,
    competitionType: candidate.competitionType || fixture.competitionType || null,
    kickoffTime: candidate.kickoffAt || fixture.utcDateTime || null,
    homeTeam: candidate.home || fixture.home || "Local", awayTeam: candidate.away || fixture.away || "Visitante",
    market: candidate.market, marketKey: candidate.marketCode || candidate.marketKey,
    selection: candidate.selection, selectionKey: candidate.selectionCode || candidate.selectionKey,
    line: numeric(candidate.line), bookmaker: candidate.bookmaker || null, odds,
    oddsUpdatedAt: candidate.oddsUpdatedAt || null,
    modelProbabilityPct, ...oddsMetrics,
    confidenceScore: numeric(candidate.confidenceScore) ?? 0, dataQualityScore,
    evidenceScore: evidenceScore(candidate), modelConsistencyScore: consistencyScore(candidate),
    reasons: [...new Set([...(candidate.supportingData || []), candidate.reasoning].filter(Boolean))],
    warnings: [...new Set(candidate.contradictingData || [])], missingData: [],
    modelVersion: candidate.modelVersion || fixturePackage.modelVersion || null,
    configVersion: config.version, generatedAt: now.toISOString(),
    originModule: candidate.originModule || candidate.sourceModule || null,
    sourceModule: "best_bets_selector", backingModels: candidate.backingModels || [],
    independentFamilies: candidate.independentFamilies || candidate.backingModels || []
  };
  adapted.historicalReliability = historicalReliabilityFor(adapted, historyRecords, config);
  adapted.oddsAgeMinutes = oddsAgeMinutes(candidate, now);
  adapted.riskScore = riskScoreFor({ ...adapted, contradictions: adapted.warnings });
  adapted.selectorScore = scoreCandidate(adapted, config);
  return adapted;
}

function classifyCandidate(candidate, config, now) {
  const exclusions = [];
  const kickoff = Date.parse(candidate.kickoffTime || "");
  if (!(candidate.odds > config.thresholds.minimumOdds)) exclusions.push("Cuota decimal ausente o inválida.");
  if (!(candidate.modelProbabilityPct > 0 && candidate.modelProbabilityPct < 100)) exclusions.push("Probabilidad del modelo fuera de rango.");
  if (candidate.expectedValuePct === null || candidate.expectedValuePct <= config.thresholds.minimumExpectedValuePct) exclusions.push("EV inferior al mínimo configurable.");
  if (candidate.edgePct === null || candidate.edgePct <= config.thresholds.minimumEdgePct) exclusions.push("Edge inferior al mínimo configurable.");
  if (candidate.dataQualityScore < config.thresholds.minimumDataQuality) exclusions.push("Calidad de datos insuficiente.");
  if (candidate.evidenceScore < config.thresholds.minimumEvidenceScore) exclusions.push("Evidencia insuficiente o de una sola familia.");
  if (Number.isFinite(kickoff) && kickoff <= now.getTime()) exclusions.push("El partido ya inició o finalizó.");
  if (candidate.oddsAgeMinutes !== null && candidate.oddsAgeMinutes > config.thresholds.maximumOddsAgeMinutes) exclusions.push("Cuota demasiado antigua.");
  if (candidate.warnings.length >= 2) exclusions.push("Inconsistencias críticas entre señales.");
  if (!config.supportedMarketKeys.includes(candidate.marketKey)) exclusions.push("Mercado sin liquidación aprobada para este selector.");
  if (exclusions.length) return { ...candidate, classification: "DESCARTADO", exclusionReasons: exclusions, inclusionReason: null };
  let classification = "OBSERVAR";
  if (candidate.historicalReliability.status === "adequate" && candidate.selectorScore >= config.thresholds.minimumAptScore && candidate.riskScore <= config.thresholds.maximumAptRisk) classification = "APTO";
  else if (candidate.historicalReliability.status !== "insufficient" && candidate.selectorScore >= config.thresholds.minimumCautionScore && candidate.riskScore <= config.thresholds.maximumCautionRisk) classification = "APTO CON PRECAUCIÓN";
  const inclusionReason = classification === "OBSERVAR"
    ? "Cumple valor y calidad básica, pero todavía no tiene respaldo histórico suficiente para clasificarse como mejor apuesta."
    : `Supera calidad, valor y respaldo histórico para la categoría ${classification}.`;
  return { ...candidate, classification, exclusionReasons: [], inclusionReason };
}

function correlated(a, b) {
  if (a.fixtureId !== b.fixtureId) return false;
  if (a.marketKey === b.marketKey) return true;
  const keys = new Set([a.selectionKey, b.selectionKey]);
  if ((keys.has("home_win") && keys.has("1X")) || (keys.has("away_win") && keys.has("X2"))) return true;
  if ([a.marketKey, b.marketKey].some((key) => /team_goals/.test(String(key))) && [a.selectionKey, b.selectionKey].some((key) => /home_win|away_win/.test(String(key)))) return true;
  return ([a.selectionKey, b.selectionKey].some((key) => /over_2_5/.test(String(key))) && [a.selectionKey, b.selectionKey].some((key) => /btts_yes/.test(String(key))));
}

function applyCorrelation(ranked, config) {
  const selected = [];
  return ranked.map((candidate) => {
    const conflict = selected.find((row) => correlated(candidate, row));
    if (conflict && (config.thresholds.onePickPerFixture || conflict.selectorScore - candidate.selectorScore >= config.thresholds.minimumScoreDifferenceForCorrelation)) {
      return { ...candidate, classification: "DESCARTADO", exclusionReasons: [...candidate.exclusionReasons, `Correlacionado con ${conflict.selection}; se conserva el candidato mejor clasificado.`] };
    }
    if (candidate.classification !== "DESCARTADO") selected.push(candidate);
    return candidate;
  });
}

export function selectBestBets({ fixturePackages = [], historyRecords = [], now = new Date(), config = BEST_BETS_CONFIG } = {}) {
  validateBestBetsConfig(config);
  const candidates = fixturePackages.flatMap((fixturePackage) => (fixturePackage.candidates || []).map((candidate) => classifyCandidate(adaptCandidate(candidate, fixturePackage, historyRecords, config, now), config, now)));
  const unique = new Map();
  for (const candidate of candidates.sort((a, b) => b.selectorScore - a.selectorScore)) {
    const key = `${candidate.fixtureId}:${candidate.marketKey}:${candidate.selectionKey}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  const deduplicated = [...unique.values()];
  const ranked = applyCorrelation(deduplicated.sort((a, b) => b.selectorScore - a.selectorScore || b.dataQualityScore - a.dataQualityScore), config);
  const approved = ranked.filter((candidate) => ["APTO", "APTO CON PRECAUCIÓN"].includes(candidate.classification)).slice(0, config.thresholds.maximumGeneralPicks);
  const byMarket = Object.groupBy ? Object.groupBy(approved, (item) => item.marketKey) : approved.reduce((groups, item) => ({ ...groups, [item.marketKey]: [...(groups[item.marketKey] || []), item] }), {});
  const byLeague = Object.groupBy ? Object.groupBy(approved, (item) => item.leagueName) : approved.reduce((groups, item) => ({ ...groups, [item.leagueName]: [...(groups[item.leagueName] || []), item] }), {});
  return {
    type: "bestBetsReport", modelVersion: config.modelVersion, configVersion: config.version, generatedAt: now.toISOString(),
    summary: { fixturesEvaluated: fixturePackages.length, candidatesEvaluated: candidates.length, approved: approved.length, observed: ranked.filter((item) => item.classification === "OBSERVAR").length, discarded: ranked.filter((item) => item.classification === "DESCARTADO").length },
    bestBet: approved[0] || null, picks: approved, candidates: ranked,
    byMarket: Object.fromEntries(Object.entries(byMarket).map(([key, rows]) => [key, rows.slice(0, config.thresholds.maximumPerMarket)])),
    byLeague: Object.fromEntries(Object.entries(byLeague).map(([key, rows]) => [key, rows.slice(0, config.thresholds.maximumPerLeague)])),
    warnings: approved.length ? [] : ["No existe una mejor apuesta que cumpla simultáneamente valor, calidad, riesgo e historial mínimo."],
    audit: { existingModelFormulasModified: false, historicalRecordsUsed: historyRecords.length, onePickPerFixture: config.thresholds.onePickPerFixture }
  };
}
