import { evaluateH2HRecommendation } from "../../../public/h2h-recommendation.js";
import { evaluateRecentFormRecommendation } from "../../../public/recent-form-recommendation.js";
import { evaluateXgBttsRecommendation } from "../../../public/xg-btts-recommendation.js";

const CONFIDENCE_SCORE = Object.freeze({ Alta: 80, Media: 65, Baja: 45 });
const SELECTION_CODES = Object.freeze({
  home_win: "home_win",
  away_win: "away_win",
  home_double_chance: "1X",
  away_double_chance: "X2",
  over05: "over_0_5",
  over15: "over_1_5",
  over25: "over_2_5",
  under35: "under_3_5",
  btts_yes: "btts_yes",
  btts_no: "btts_no"
});

function finite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function confidenceScore(label, fallback = null) {
  return CONFIDENCE_SCORE[String(label || "")] ?? finite(fallback);
}

function normalizedKey(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function auditPick(pick, sourceModule, modelVersion, generatedAt) {
  const selectionKey = String(pick.selectionKey || pick.selectionCode || normalizedKey(pick.selection));
  return {
    ...pick,
    selectionKey,
    auditPickKey: `${sourceModule}:${selectionKey}`,
    sourceModule,
    modelVersion: pick.modelVersion || modelVersion || "unknown",
    decision: pick.decision || "RECOMENDADO",
    decisionGroup: pick.decisionGroup || "recommended",
    generatedAt
  };
}

function researchAnalyses(dataset = {}) {
  const research = dataset.researchData || {};
  const home = research.homeTeam;
  const away = research.awayTeam;
  const analyses = { h2h: null, recentForm: null, xgBtts: null };
  if (!home || !away) return analyses;

  if (research.h2h) {
    analyses.h2h = evaluateH2HRecommendation({
      matches: research.h2h.matches || [], currentHomeTeam: home, currentAwayTeam: away,
      currentFixtureDate: research.dateTime, neutralVenue: research.venue?.neutral, source: research.h2h.source
    });
  }
  if (research.statsForm) {
    analyses.recentForm = evaluateRecentFormRecommendation({
      homeMatches: research.statsForm.homeLastMatches,
      awayMatches: research.statsForm.awayLastMatches,
      homeTeamName: home.name,
      awayTeamName: away.name,
      currentFixtureDate: research.dateTime
    });
  }
  const xg = research.xgXga;
  const historicalXg = xg && (xg.type === "historical_estimated" || xg.dataSource === "historical_api_estimate" || xg.historicalAttempted === true);
  if (historicalXg) {
    analyses.xgBtts = evaluateXgBttsRecommendation({
      homeFixtures: xg.fixturesUsed?.home || xg.fixturesUsedHome || [],
      awayFixtures: xg.fixturesUsed?.away || xg.fixturesUsedAway || [],
      homeTeam: home,
      awayTeam: away,
      currentFixtureId: research.matchId,
      currentFixtureDate: research.dateTime,
      sourceQualityScore: xg.confidenceScore
    });
  }
  return analyses;
}

function recommendationPicks(analyses, generatedAt) {
  const picks = [];
  for (const [analysis, sourceModule, modelVersion] of [
    [analyses.h2h, "h2h", "h2h-recommendation-v1"],
    [analyses.recentForm, "recent_form", "recent-form-recommendation-v1"]
  ]) {
    const winner = analysis?.calculationDetails?.winningCandidate;
    if (!analysis?.recommendedMarket || !winner?.key) continue;
    picks.push(auditPick({
      market: analysis.recommendedMarket,
      selection: analysis.recommendedSelection,
      selectionKey: SELECTION_CODES[winner.key] || winner.key,
      modelProbabilityPct: finite(analysis.weightedRate),
      confidenceScore: confidenceScore(analysis.confidence, analysis.weightedRate),
      supportingData: [analysis.explanation].filter(Boolean),
      contradictingData: analysis.warnings || []
    }, sourceModule, modelVersion, generatedAt));
  }

  const xg = analyses.xgBtts;
  if (xg?.status === "RECOMMENDED" && xg.recommendedSelection) {
    const yes = normalizedKey(xg.recommendedSelection).includes("si");
    const estimatedYes = finite(xg.estimatedBttsYes);
    picks.push(auditPick({
      market: "Ambos equipos anotan",
      selection: xg.recommendedSelection,
      selectionKey: yes ? "btts_yes" : "btts_no",
      modelProbabilityPct: estimatedYes === null ? null : yes ? estimatedYes : Number((100 - estimatedYes).toFixed(1)),
      confidenceScore: confidenceScore(xg.confidence, xg.selectedScore),
      supportingData: [xg.explanation].filter(Boolean),
      contradictingData: xg.warnings || []
    }, "xg_btts", xg.modelVersion, generatedAt));
  }
  return picks;
}

function outcomePick(module, generatedAt) {
  const accepted = new Set(["apuesta_recomendada", "apuesta_con_valor_pero_riesgo_alto"]);
  const scenario = (module?.scenarios || []).find((row) => accepted.has(row.decision));
  if (!scenario) return [];
  const selectionKey = scenario.key === "home" ? "home_win" : scenario.key === "away" ? "away_win" : "draw";
  return [auditPick({
    market: "Resultado 1X2",
    selection: scenario.label,
    selectionKey,
    decimalOdds: scenario.decimalOdds,
    impliedProbabilityPct: scenario.marketProbabilityPct,
    modelProbabilityPct: scenario.probabilityPct,
    expectedValuePct: scenario.expectedValuePct,
    confidenceScore: scenario.footballConfidenceScore,
    supportingData: scenario.supportingData || [],
    contradictingData: scenario.contradictingData || []
  }, "outcome_1x2", module.modelVersion, generatedAt)];
}

function yellowCardPick(module, generatedAt) {
  const lower = finite(String(module?.projection?.suggestedRange || "").split("-")[0]);
  if (!module?.projection || lower === null) return [];
  const line = Math.max(0.5, lower - 0.5);
  return [auditPick({
    market: "Total de tarjetas amarillas",
    selection: `Más de ${line} tarjetas amarillas`,
    selectionKey: `over_${String(line).replace(".", "_")}_yellow_cards`,
    confidenceScore: finite(module.confidenceScore),
    supportingData: [`Proyección ${module.projection.expectedTotal}; rango sugerido ${module.projection.suggestedRange}.`],
    contradictingData: module.warnings || []
  }, "yellow_cards", module.modelVersion, generatedAt)];
}

function goalHalfPick(module, generatedAt) {
  const half = module?.projection?.selectedHalf;
  if (!["Primera mitad", "Segunda mitad"].includes(half)) return [];
  const first = half === "Primera mitad";
  const support = first ? module.projection.firstHalfSupport : module.projection.secondHalfSupport;
  return [auditPick({
    market: "Gol por mitad",
    selection: `Habrá gol en la ${first ? "primera" : "segunda"} mitad`,
    selectionKey: first ? "goal_first_half" : "goal_second_half",
    modelProbabilityPct: finite(support),
    confidenceScore: finite(module.confidenceScore),
    supportingData: [`${half}: ${support}% de respaldo ponderado`],
    contradictingData: module.warnings || []
  }, "goal_half_projection", module.modelVersion, generatedAt)];
}

export function buildMultiOriginEvidence(dataset = {}, modules = {}, now = new Date()) {
  const generatedAt = now.toISOString();
  const analyses = researchAnalyses(dataset);
  const corners = (modules.corners?.picks || []).map((pick) => auditPick(
    pick, "corners", pick.modelVersion || modules.corners?.modelVersion, generatedAt
  ));
  const picks = [
    ...recommendationPicks(analyses, generatedAt),
    ...corners,
    ...outcomePick(modules.outcomeScenarios, generatedAt),
    ...yellowCardPick(modules.yellowCards, generatedAt),
    ...goalHalfPick(modules.goalHalf, generatedAt)
  ];
  const unique = [...new Map(picks.map((pick) => [pick.auditPickKey, pick])).values()];
  return {
    schemaVersion: "multi-origin-recommendations-v1",
    status: unique.length ? "available" : "not_available",
    generatedAt,
    picks: unique,
    origins: [...new Set([
      ...(modules.dataPicks?.picks?.length ? ["data_picks"] : []),
      ...unique.map((pick) => pick.sourceModule)
    ])],
    includesLegacyDataPicks: true,
    analysisSummary: {
      h2h: analyses.h2h ? { recommendedMarket: analyses.h2h.recommendedMarket, recommendedSelection: analyses.h2h.recommendedSelection, confidence: analyses.h2h.confidence, weightedRate: analyses.h2h.weightedRate, explanation: analyses.h2h.explanation } : null,
      recentForm: analyses.recentForm ? { recommendedMarket: analyses.recentForm.recommendedMarket, recommendedSelection: analyses.recentForm.recommendedSelection, confidence: analyses.recentForm.confidence, weightedRate: analyses.recentForm.weightedRate, explanation: analyses.recentForm.explanation } : null,
      xgBtts: analyses.xgBtts ? { status: analyses.xgBtts.status, recommendedSelection: analyses.xgBtts.recommendedSelection, confidence: analyses.xgBtts.confidence, selectedScore: analyses.xgBtts.selectedScore, estimatedBttsYes: analyses.xgBtts.estimatedBttsYes, explanation: analyses.xgBtts.explanation } : null
    }
  };
}

export const multiOriginEvidenceInternals = Object.freeze({ auditPick, researchAnalyses });
