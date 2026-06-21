import { ANALYSIS_STATUS, CRITICAL_MODULES, DATA_STATUS, MODULE_LABELS, MODULE_WEIGHTS } from "../constants/match-research.js";

export function scoreModule(status, weight) {
  if (status === DATA_STATUS.AVAILABLE) return weight;
  if (status === DATA_STATUS.PARTIAL) return weight * 0.5;
  return 0;
}

export function detectMissingCriticalData(matchData) {
  return CRITICAL_MODULES.filter((key) => {
    const status = matchData?.[key]?.status;
    return status === DATA_STATUS.NOT_AVAILABLE || status === DATA_STATUS.FAILED;
  }).map((key) => ({ key, label: MODULE_LABELS[key], status: matchData[key].status }));
}

export function calculateMatchConfidenceScore(matchData) {
  const moduleScores = Object.fromEntries(Object.entries(MODULE_WEIGHTS).map(([key, weight]) => [
    key,
    scoreModule(matchData?.[key]?.status, weight)
  ]));
  const totalConfidenceScore = Number(Object.values(moduleScores).reduce((total, score) => total + score, 0).toFixed(1));
  const criticalMissing = detectMissingCriticalData(matchData);

  let analysisStatus = ANALYSIS_STATUS.NEEDS_REVIEW;
  if (criticalMissing.length < 3) {
    if (totalConfidenceScore >= 75) analysisStatus = ANALYSIS_STATUS.COMPLETE;
    else if (totalConfidenceScore >= 45) analysisStatus = ANALYSIS_STATUS.PARTIAL;
  }

  return { moduleScores, totalConfidenceScore, analysisStatus, criticalMissing };
}
