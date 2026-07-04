const number = (value) => value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;

export function auditPickRules(pick = {}, dataQuality = {}) {
  const errors = [];
  const ev = number(pick.expectedValuePct ?? pick.expectedValue);
  const conservativeEv = number(pick.conservativeExpectedValuePct ?? pick.conservativeExpectedValue);
  const implied = number(pick.impliedProbabilityPct ?? pick.impliedProbability);
  const model = number(pick.modelProbabilityPct ?? pick.estimatedProbabilityPct ?? pick.modelProbability);
  if (ev !== null && ev < 0) errors.push("EV negativo: no debe presentarse como pick seguro ni principal.");
  if (ev !== null && ev >= 0 && conservativeEv !== null && conservativeEv <= 0) errors.push("EV conservador no positivo: el valor desaparece al considerar la incertidumbre.");
  if (implied !== null && model !== null && model < implied) errors.push(`La cuota exige ${implied}% y el modelo estima ${model}%.`);
  if (["Baja", "Insuficiente", "No disponible"].includes(dataQuality.label || dataQuality.level)) errors.push("Calidad de datos insuficiente para recomendación fuerte.");
  if ((pick.contradictingData || []).length) errors.push("Existen datos que contradicen el pick.");
  if (number(pick.riskScore) !== null && number(pick.riskScore) >= 70) errors.push("Riesgo alto: no debe habilitarse como pick principal.");
  if (pick.sourceModule === "corners" && Number(pick.sampleSize || 0) < 5) errors.push("Corners omitido: muestra histórica menor a cinco partidos oficiales.");
  const severe = errors.some((item) => /EV negativo|EV conservador|exige|insuficiente|Riesgo alto|Corners omitido/.test(item));
  return {
    errors,
    color: severe ? "red" : errors.length ? "orange" : ev !== null && ev >= 0 ? "green" : "orange",
    recommendation: severe ? "EVITAR / NO BET" : errors.length ? "Revisar antes de considerar" : "Fundamento consistente",
    noBet: severe
  };
}
