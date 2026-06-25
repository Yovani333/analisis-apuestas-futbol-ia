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
  "big chances": "bigChances",
  "big chances created": "bigChances",
  "dangerous attacks": "dangerousAttacks"
});

function normalizeType(value) {
  return String(value || "").trim().toLocaleLowerCase("en");
}

export function extractTeamStatsFromApiFootball(statisticsResponse, teamId) {
  const rows = Array.isArray(statisticsResponse) ? statisticsResponse : [];
  const row = rows.find((item) => String(item?.team?.id) === String(teamId));
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

export function extractPenaltyCountFromEvents(eventsResponse, teamId) {
  if (!Array.isArray(eventsResponse)) return 0;
  return eventsResponse.filter((event) =>
    String(event?.team?.id) === String(teamId) && isPenaltyAttempt(event)
  ).length;
}

export function extractEstimatedXgInputs(dataset) {
  const fixture = dataset?.fixture || {};
  const rows = Array.isArray(dataset?.confirmed?.statistics) ? dataset.confirmed.statistics : [];
  const findTeam = (teamId) => rows.find((row) => String(row?.team?.id) === String(teamId));
  const buildTeam = (teamId, fallbackName) => {
    const row = findTeam(teamId);
    const rawStats = extractTeamStatsFromApiFootball(rows, teamId);
    rawStats.penalties = extractPenaltyCountFromEvents(dataset?.confirmed?.events, teamId);
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
