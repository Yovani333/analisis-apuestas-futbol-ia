const REQUIRED_FIELDS = Object.freeze([
  "totalShots", "shotsOnGoal", "shotsInsideBox", "shotsOutsideBox", "cornerKicks"
]);

const OPTIONAL_FIELDS = Object.freeze([
  "shotsOffGoal", "blockedShots", "ballPossession", "goalkeeperSaves", "dangerousAttacks"
]);

export function calculateEstimatedXgConfidence(stats = {}, { eventsAvailable = false } = {}) {
  const available = REQUIRED_FIELDS.filter((key) => stats[key] !== null && stats[key] !== undefined);
  const missingFields = REQUIRED_FIELDS
    .filter((key) => stats[key] === null || stats[key] === undefined);
  const optionalMissingFields = OPTIONAL_FIELDS
    .filter((key) => stats[key] === null || stats[key] === undefined);
  const score = Math.round((available.length / REQUIRED_FIELDS.length) * 100);
  let label = "low";
  if (score >= 80 && eventsAvailable) label = "high";
  else if (score >= 50) label = "medium";
  else if (score === 0) label = "not_available";
  const notes = [];
  if (!eventsAvailable) notes.push("No se pudo confirmar la cobertura completa de eventos de penal.");
  if (stats.dangerousAttacks === null || stats.dangerousAttacks === undefined) {
    notes.push("Dangerous Attacks no fue proporcionado y aporta 0 al cálculo.");
  }
  return { score, label, missingFields, optionalMissingFields, notes };
}
