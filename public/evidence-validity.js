const INVALID_FIXTURE_STATUSES = new Set([
  "postponed", "postergado", "pospuesto", "pst",
  "cancelled", "canceled", "cancelado", "can",
  "suspended", "suspendido", "sus",
  "abandoned", "abandonado", "abd",
  "interrupted", "interrumpido", "int"
]);

const KNOWN_INVALID_EVIDENCE_FIXTURES = Object.freeze([
  {
    home: "chicago fire",
    away: "vancouver whitecaps",
    kickoffDate: "2026-07-17",
    reason: "known_postponed_fixture"
  }
]);

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizedTeam(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function knownInvalidFixtureReason(fixture = {}) {
  const kickoffTimestamp = timestamp(fixture.utcDateTime || fixture.dateTime);
  if (!kickoffTimestamp) return "";
  const kickoffDate = new Date(kickoffTimestamp).toISOString().slice(0, 10);
  const home = normalizedTeam(fixture.home);
  const away = normalizedTeam(fixture.away);
  return KNOWN_INVALID_EVIDENCE_FIXTURES.find((row) => row.home === home && row.away === away && row.kickoffDate === kickoffDate)?.reason || "";
}

export function isInvalidEvidenceFixtureStatus(value) {
  return INVALID_FIXTURE_STATUSES.has(normalizedStatus(value));
}

export function evidenceInvalidReason(snapshot, fixtureStatus = "") {
  if (!snapshot || typeof snapshot !== "object") return "invalid_snapshot";
  if (!String(snapshot.id || "").trim()) return "missing_snapshot_id";
  const capturedAt = timestamp(snapshot.capturedAt);
  if (!capturedAt) return "invalid_capture_time";
  const fixture = snapshot.fixture;
  if (!fixture || typeof fixture !== "object") return Number(snapshot.version) >= 2 ? "missing_fixture" : "";
  if (!String(fixture.id || "").trim()) return Number(snapshot.version) >= 2 ? "missing_fixture" : "";
  if (Number(snapshot.version) >= 2 && (!String(fixture.home || "").trim() || !String(fixture.away || "").trim())) return "missing_teams";
  const knownInvalidReason = knownInvalidFixtureReason(fixture);
  if (knownInvalidReason) return knownInvalidReason;
  const status = fixtureStatus || fixture.statusShort || fixture.status;
  if (isInvalidEvidenceFixtureStatus(status)) return "invalid_fixture_status";
  const kickoffAt = timestamp(fixture.utcDateTime || fixture.dateTime);
  if (!kickoffAt) return Number(snapshot.version) >= 2 ? "missing_kickoff_time" : "";
  if (capturedAt >= kickoffAt) return "captured_after_kickoff";
  if (snapshot.currentFixtureStatisticsUsed === true) return "current_fixture_statistics_used";
  return "";
}

export function isValidEvidenceSnapshot(snapshot, fixtureStatus = "") {
  return evidenceInvalidReason(snapshot, fixtureStatus) === "";
}

export function filterValidEvidenceSnapshots(rows = [], fixtureStatuses = new Map()) {
  return (Array.isArray(rows) ? rows : []).filter((snapshot) => {
    const fixtureId = String(snapshot?.fixture?.id || "");
    const override = fixtureStatuses instanceof Map
      ? fixtureStatuses.get(fixtureId)
      : fixtureStatuses?.[fixtureId];
    return isValidEvidenceSnapshot(snapshot, override || "");
  });
}

export const EVIDENCE_INVALID_FIXTURE_STATUSES = Object.freeze([...INVALID_FIXTURE_STATUSES]);
