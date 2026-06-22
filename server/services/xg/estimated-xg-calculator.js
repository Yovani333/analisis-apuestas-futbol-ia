const MODEL_VERSION = "estimated-xg-v1";

function value(stats, key) {
  return Number.isFinite(stats?.[key]) ? stats[key] : 0;
}

export function calculateEstimatedXG(stats = {}) {
  const totalShots = value(stats, "totalShots");
  const penalties = value(stats, "penalties");
  if (stats.totalShots === 0 && penalties === 0) return 0;
  const estimatedXG =
    totalShots * 0.025 +
    value(stats, "shotsOnGoal") * 0.12 +
    value(stats, "shotsInsideBox") * 0.09 +
    value(stats, "shotsOutsideBox") * 0.025 +
    value(stats, "blockedShots") * 0.015 +
    value(stats, "cornerKicks") * 0.02 +
    penalties * 0.76 +
    value(stats, "dangerousAttacks") * 0.003;
  return Number(estimatedXG.toFixed(2));
}

export { MODEL_VERSION };
