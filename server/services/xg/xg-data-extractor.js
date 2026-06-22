import { emptyEstimatedXgStats, normalizeNonNegativeNumber } from "./xg-normalizer.js";

const STAT_KEYS = Object.freeze({
  "total shots": "totalShots",
  "shots on goal": "shotsOnGoal",
  "shots off goal": "shotsOffGoal",
  "shots insidebox": "shotsInsideBox",
  "shots inside box": "shotsInsideBox",
  "shots outsidebox": "shotsOutsideBox",
  "shots outside box": "shotsOutsideBox",
  "blocked shots": "blockedShots",
  "corner kicks": "cornerKicks",
  "ball possession": "ballPossession",
  "goalkeeper saves": "goalkeeperSaves",
  "dangerous attacks": "dangerousAttacks"
});

function normalizeType(value) {
  return String(value || "").trim().toLocaleLowerCase("en");
}

function teamStatistics(row) {
  const stats = emptyEstimatedXgStats();
  for (const entry of Array.isArray(row?.statistics) ? row.statistics : []) {
    const key = STAT_KEYS[normalizeType(entry?.type)];
    if (key) stats[key] = normalizeNonNegativeNumber(entry?.value);
  }
  return stats;
}

function isPenaltyAttempt(event) {
  const type = String(event?.type || "").toLowerCase();
  const detail = String(event?.detail || "").toLowerCase();
  if (/shoot.?out/.test(detail)) return false;
  return detail.includes("penalty") && (type === "goal" || detail.includes("missed"));
}

function penaltiesByTeam(events = []) {
  const totals = new Map();
  if (!Array.isArray(events)) return totals;
  events.filter(isPenaltyAttempt).forEach((event) => {
    const teamId = event?.team?.id;
    if (teamId !== null && teamId !== undefined) totals.set(String(teamId), (totals.get(String(teamId)) || 0) + 1);
  });
  return totals;
}

export function extractEstimatedXgInputs(dataset) {
  const fixture = dataset?.fixture || {};
  const rows = Array.isArray(dataset?.confirmed?.statistics) ? dataset.confirmed.statistics : [];
  const penalties = penaltiesByTeam(dataset?.confirmed?.events);
  const findTeam = (teamId) => rows.find((row) => String(row?.team?.id) === String(teamId));
  const buildTeam = (teamId, fallbackName) => {
    const row = findTeam(teamId);
    const rawStats = teamStatistics(row);
    rawStats.penalties = penalties.get(String(teamId)) || 0;
    return {
      id: teamId === null || teamId === undefined ? "" : String(teamId),
      name: row?.team?.name || fallbackName || "",
      rawStats,
      statisticsFound: Boolean(row),
      eventsAvailable: Array.isArray(dataset?.confirmed?.events) && !dataset?.advancedFailures?.events
    };
  };
  return {
    fixtureId: fixture.id === null || fixture.id === undefined ? "" : String(fixture.id),
    homeTeam: buildTeam(fixture.homeTeamId, fixture.home),
    awayTeam: buildTeam(fixture.awayTeamId, fixture.away)
  };
}
