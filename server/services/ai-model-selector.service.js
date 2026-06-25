const IMPORTANT_COMPETITION = /world cup|mundial|champions|libertadores|copa internacional|international cup/i;
const IMPORTANT_ROUND = /final|semi|quarter|knockout|eliminatoria|play-?off|decisiv/i;

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
};
const average = (total, count) => {
  const numericTotal = numberOrNull(total);
  const numericCount = numberOrNull(count);
  return numericTotal !== null && numericCount > 0 ? Number((numericTotal / numericCount).toFixed(2)) : null;
};

function compactPreviousMatches(matches = []) {
  return matches.slice(0, 5).map((match) => ({
    fixtureId: match.fixtureId || "",
    date: match.date || "",
    opponent: match.opponent || "",
    venue: match.venue || "",
    goalsFor: match.goalsFor ?? null,
    goalsAgainst: match.goalsAgainst ?? null,
    result: match.result || ""
  }));
}

function compactTeamMetrics(dataset, side) {
  const preMatch = dataset.preMatch?.[side] || {};
  const rawStats = dataset.estimatedXg?.[`${side}Team`]?.rawStats
    || dataset.researchData?.xgXga?.rawStats?.[side]
    || {};
  const played = numberOrNull(preMatch.played);
  return {
    team: preMatch.team || dataset.fixture?.[side] || "",
    previousMatches: compactPreviousMatches(preMatch.matches),
    averages: {
      goalsFor: average(preMatch.goalsFor, played),
      goalsAgainst: average(preMatch.goalsAgainst, played),
      totalShots: numberOrNull(rawStats.totalShots),
      shotsOnGoal: numberOrNull(rawStats.shotsOnGoal),
      cornerKicks: numberOrNull(rawStats.cornerKicks),
      xg: numberOrNull(dataset.researchData?.xgXga?.[`${side}XG`]),
      xga: numberOrNull(dataset.researchData?.xgXga?.[`${side}XGA`])
    }
  };
}

function analysisSignals(dataset = {}) {
  const research = dataset.researchData || {};
  const pickReview = dataset.pickRecommendation || {};
  const recommended = pickReview.recommendedPick || null;
  const highestEv = pickReview.highestEvPick || null;
  const missingCriticalData = research.criticalMissingData || [];
  const confidenceScore = numberOrNull(pickReview.confidenceScore)
    ?? numberOrNull(research.totalConfidenceScore)
    ?? numberOrNull(dataset.dataQuality?.score)
    ?? 0;
  const valueScore = numberOrNull(recommended?.valueScore)
    ?? numberOrNull(highestEv?.valueScore)
    ?? 0;
  const favoriteStrength = pickReview.favoriteStrength || "none";
  const suspiciousHighValue = favoriteStrength === "strong"
    && Boolean(highestEv?.contradictsFavorite)
    && valueScore >= 75;
  const recommendedAgainstStrongFavorite = favoriteStrength === "strong"
    && Boolean(recommended?.contradictsFavorite);
  const hasContradictions = Boolean(
    dataset.analysisOptions?.hasContradictions
    || suspiciousHighValue
    || recommendedAgainstStrongFavorite
    || ["value_sospechoso", "agresivo_stake_bajo"].includes(highestEv?.pickCategory)
  );
  const competitionName = `${dataset.fixture?.leagueName || ""} ${research.league?.name || ""}`;
  const round = `${dataset.fixture?.round || ""} ${dataset.analysisOptions?.competitionStage || ""}`;
  const competitionImportance = IMPORTANT_COMPETITION.test(competitionName) || IMPORTANT_ROUND.test(round)
    ? "high" : "normal";
  const parlaySelections = dataset.analysisOptions?.parlaySelections || [];

  return {
    confidenceScore,
    valueScore,
    favoriteStrength,
    qualityGap: pickReview.qualityGap || "low",
    pickCategory: recommended?.pickCategory || pickReview.pickCategory || "sin_pick",
    dataCompleteness: numberOrNull(research.totalConfidenceScore) ?? numberOrNull(dataset.dataQuality?.score) ?? 0,
    hasContradictions,
    isPremiumAnalysis: Boolean(dataset.analysisOptions?.isPremiumAnalysis),
    isParlay: Boolean(dataset.analysisOptions?.isParlay || parlaySelections.length >= 3),
    competitionImportance,
    missingCriticalData,
    suspiciousHighValue,
    recommendedAgainstStrongFavorite
  };
}

export function selectAiModelForMatch(dataset = {}, {
  defaultModel = AI_MODEL_DEFAULT,
  premiumModel = AI_MODEL_PREMIUM
} = {}) {
  const signals = analysisSignals(dataset);
  const premium = (modelReason) => ({
    selectedModel: premiumModel,
    modelReason,
    costOptimizationApplied: true,
    signals
  });
  const economical = (modelReason) => ({
    selectedModel: defaultModel,
    modelReason,
    costOptimizationApplied: true,
    signals
  });

  if (signals.isPremiumAnalysis) return premium("Modo premium o análisis profundo solicitado.");
  if (signals.isParlay) return premium("Parlay importante con tres o más selecciones.");
  if (signals.competitionImportance === "high") return premium("Competición o fase de alta importancia.");
  if (signals.suspiciousHighValue) return premium("Value alto contra un favorito fuerte.");
  if (signals.recommendedAgainstStrongFavorite) return premium("El pick recomendado contradice a un favorito fuerte.");
  if (signals.hasContradictions) return premium("Existen contradicciones relevantes entre las señales deportivas.");
  if (signals.missingCriticalData.length) {
    return economical("Faltan datos críticos y no se solicitó modo premium; el resultado debe marcarse para revisión.");
  }
  if (signals.confidenceScore < 60) return premium("Confianza inferior a 60 sin faltantes críticos que bloqueen el análisis.");
  return economical("Análisis normal con datos suficientes, confianza mínima de 60 y sin contradicciones fuertes.");
}

export function buildCompactAiMatchData(dataset = {}) {
  const research = dataset.researchData || {};
  const pickReview = dataset.pickRecommendation || {};
  const signals = analysisSignals(dataset);
  return {
    matchId: String(dataset.fixture?.id || research.matchId || ""),
    partido: {
      home: dataset.fixture?.home || research.homeTeam?.name || "",
      away: dataset.fixture?.away || research.awayTeam?.name || "",
      date: dataset.fixture?.utcDateTime || research.dateTime || "",
      status: dataset.fixture?.status || "",
      venue: dataset.fixture?.stadium || research.venue?.stadium || "",
      neutralVenue: Boolean(dataset.fixture?.neutralVenue || research.venue?.neutral)
    },
    liga: dataset.fixture?.leagueName || research.league?.name || "",
    pais: dataset.fixture?.country || research.league?.country || "",
    teams: {
      home: compactTeamMetrics(dataset, "home"),
      away: compactTeamMetrics(dataset, "away")
    },
    odds: {
      markets: (research.odds?.markets || dataset.marketAnalysis || []).slice(0, 12).map((market) => ({
        marketKey: market.marketKey,
        selectionKey: market.selectionKey,
        market: market.market,
        selection: market.selection,
        decimalOdds: market.decimalOdds,
        estimatedProbabilityPct: market.estimatedProbabilityPct,
        expectedValuePct: market.expectedValuePct,
        positiveValue: market.positiveValue,
        requiresReview: market.requiresReview
      }))
    },
    favorite: research.favorite || dataset.fixture?.favorite || null,
    pickReview: {
      favoriteTeam: pickReview.favoriteTeam || "",
      favoriteStrength: signals.favoriteStrength,
      qualityGap: signals.qualityGap,
      confidenceScore: signals.confidenceScore,
      valueScore: signals.valueScore,
      pickCategory: signals.pickCategory,
      highestEvPick: pickReview.highestEvPick || null,
      recommendedPick: pickReview.recommendedPick || null
    },
    xgXga: research.xgXga ? {
      status: research.xgXga.status,
      type: research.xgXga.type,
      source: research.xgXga.source,
      homeXG: research.xgXga.homeXG,
      homeXGA: research.xgXga.homeXGA,
      awayXG: research.xgXga.awayXG,
      awayXGA: research.xgXga.awayXGA,
      confidenceScore: research.xgXga.confidenceScore,
      confidenceLabel: research.xgXga.confidenceLabel,
      sampleSize: research.xgXga.sampleSize,
      warning: research.xgXga.warning
    } : null,
    analysisStatus: signals.missingCriticalData.length ? "needs_review" : research.analysisStatus || "needs_review",
    dataCompleteness: signals.dataCompleteness,
    risks: [
      pickReview.warning,
      ...(dataset.qualityAlerts || []),
      ...(research.xgXga?.notes || [])
    ].filter(Boolean),
    missingCriticalData: signals.missingCriticalData.map((item) => item.label || item.module || String(item)),
    missingData: (research.missingData || []).map((item) => ({
      label: item.label,
      status: item.status,
      message: item.message
    }))
  };
}
import { AI_MODEL_DEFAULT, AI_MODEL_PREMIUM } from "../config/ai-models.js";
