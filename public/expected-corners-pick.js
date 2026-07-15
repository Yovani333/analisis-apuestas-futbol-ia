function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildExpectedCornersPick(result = {}) {
  const projectedTotal = finiteNumber(result.totalExpectedCorners);
  if (projectedTotal === null || projectedTotal <= 0) return null;

  const quotedPick = Array.isArray(result.picks)
    ? result.picks.find((pick) => pick?.selectionKey === "over_corners")
    : null;

  if (quotedPick) {
    return {
      ...quotedPick,
      projectedTotal,
      hasOdds: finiteNumber(quotedPick.decimalOdds) !== null
    };
  }

  const line = Math.max(0, Math.floor(projectedTotal - 0.5));
  const confidenceScore = Math.max(0, Math.min(100, finiteNumber(result.confidenceScore) ?? 0));
  const isReliable = result.status === "available" && confidenceScore >= 70;

  return {
    marketKey: "corners",
    selectionKey: "over_corners",
    market: "Total de corners",
    selection: `Más de ${line} corners`,
    decimalOdds: null,
    impliedProbabilityPct: null,
    modelProbabilityPct: null,
    expectedValuePct: null,
    confidenceScore,
    level: isReliable ? "Confiable" : "Revisión",
    highlightColor: isReliable ? "green" : "orange",
    sourceModule: "corners",
    supportingData: [`Proyección del modelo: ${projectedTotal} corners`],
    contradictingData: Array.isArray(result.warnings) ? result.warnings : [],
    projectedTotal,
    hasOdds: false
  };
}
