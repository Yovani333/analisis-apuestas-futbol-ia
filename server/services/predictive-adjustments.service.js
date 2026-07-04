const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value)));
const round = (value, digits = 2) => Number(Number(value).toFixed(digits));

export const PREDICTIVE_ADJUSTMENTS_VERSION = "predictive-adjustments-v1";

export function calculateRecencyWeightedAverage(values, decay = 0.9) {
  const cleanValues = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!cleanValues.length) return { value: null, weights: [], effectiveSampleSize: 0 };
  const safeDecay = clamp(decay, 0.5, 1);
  const weights = cleanValues.map((_, index) => safeDecay ** index);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const weightedTotal = cleanValues.reduce((sum, value, index) => sum + value * weights[index], 0);
  const squaredWeightTotal = weights.reduce((sum, weight) => sum + weight ** 2, 0);
  return {
    value: round(weightedTotal / weightTotal),
    weights: weights.map((weight) => round(weight, 4)),
    effectiveSampleSize: round((weightTotal ** 2) / squaredWeightTotal, 2)
  };
}

export function shrinkEstimate({ estimate, sampleSize, prior, priorStrength = 5 }) {
  const estimateMissing = estimate === null || estimate === undefined || estimate === "";
  const estimateValue = estimateMissing ? Number.NaN : Number(estimate);
  const priorMissing = prior === null || prior === undefined || prior === "";
  const priorValue = priorMissing ? Number.NaN : Number(prior);
  const sample = Math.max(0, Number(sampleSize) || 0);
  const strength = Math.max(0, Number(priorStrength) || 0);
  if (!Number.isFinite(estimateValue)) return { value: null, applied: false, teamWeight: 0 };
  if (!Number.isFinite(priorValue) || sample === 0 || strength === 0) {
    return { value: round(estimateValue), applied: false, teamWeight: sample > 0 ? 1 : 0 };
  }
  const teamWeight = sample / (sample + strength);
  return {
    value: round(estimateValue * teamWeight + priorValue * (1 - teamWeight)),
    applied: true,
    teamWeight: round(teamWeight, 3)
  };
}

export function calculateConservativeValue({ modelProbabilityPct, decimalOdds, sampleSize, dataQualityScore, zScore = 0.67 }) {
  const probability = Number(modelProbabilityPct);
  const odds = Number(decimalOdds);
  const sample = Math.max(0, Number(sampleSize) || 0);
  const quality = clamp(Number(dataQualityScore) || 0, 0, 100);
  if (!Number.isFinite(probability) || !Number.isFinite(odds) || odds <= 1) {
    return { probabilityPct: null, expectedValuePct: null, uncertaintyMarginPct: null, effectiveSampleSize: 0 };
  }
  if (sample === 0) {
    return { probabilityPct: null, expectedValuePct: null, uncertaintyMarginPct: null, effectiveSampleSize: 0 };
  }
  const effectiveSampleSize = Math.max(1, sample * quality / 100);
  const probabilityRatio = clamp(probability / 100, 0.01, 0.99);
  const standardError = Math.sqrt(probabilityRatio * (1 - probabilityRatio) / effectiveSampleSize);
  const uncertaintyMarginPct = Math.min(12, Math.max(2, Number(zScore) * standardError * 100));
  const conservativeProbabilityPct = clamp(probability - uncertaintyMarginPct, 1, 99);
  return {
    probabilityPct: round(conservativeProbabilityPct, 1),
    expectedValuePct: round(conservativeProbabilityPct * odds - 100, 1),
    uncertaintyMarginPct: round(uncertaintyMarginPct, 1),
    effectiveSampleSize: round(effectiveSampleSize, 2)
  };
}
