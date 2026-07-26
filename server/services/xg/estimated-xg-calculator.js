const MODEL_VERSION = "fixture-estimated-xg-v2-shots-on-target";
const MODEL_FORMULA = "xG_est = shotsOnGoal * 0.30 + penalties * 0.46";

function value(stats, key) {
  return Number.isFinite(stats?.[key]) ? stats[key] : 0;
}

export function calculateEstimatedXG(stats = {}) {
  const shotsOnGoal = value(stats, "shotsOnGoal");
  const penalties = value(stats, "penalties");
  if (shotsOnGoal === 0 && penalties === 0) return 0;
  // API-Football no permite separar de forma fiable todos los penales que ya
  // fueron contabilizados como tiro a puerta. El ajuste 0.46 completa su valor
  // hasta 0.76 sin volver a sumar los 0.30 incluidos en shotsOnGoal.
  const estimatedXG = shotsOnGoal * 0.30 + penalties * 0.46;
  return Number(estimatedXG.toFixed(2));
}

export { MODEL_FORMULA, MODEL_VERSION };
