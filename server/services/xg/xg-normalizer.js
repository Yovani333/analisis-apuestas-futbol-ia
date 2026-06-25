export function normalizeNonNegativeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = typeof value === "string" ? value.trim().replace("%", "").replace(",", ".") : value;
  if (normalized === "") return null;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function emptyEstimatedXgStats() {
  return {
    totalShots: null,
    shotsOnGoal: null,
    shotsOffGoal: null,
    shotsInsideBox: null,
    shotsOutsideBox: null,
    blockedShots: null,
    cornerKicks: null,
    ballPossession: null,
    goalkeeperSaves: null,
    penalties: 0,
    bigChances: null,
    dangerousAttacks: null
  };
}
