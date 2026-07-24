import { isValidEvidenceSnapshot } from "./evidence-validity.js";

const PRELIMINARY_MINIMUM = 30;
const SUFFICIENT_MINIMUM = 100;

function timestamp(value) {
  return Date.parse(value || "") || 0;
}

function competitionKey(snapshot) {
  const fixture = snapshot?.fixture || {};
  return fixture.leagueId ? `league:${fixture.leagueId}` : `name:${fixture.leagueName || "No disponible"}`;
}

function isEvaluated(snapshot) {
  return Boolean(snapshot?.auditMetadata?.auditedAt && snapshot?.auditSummary?.completed === true);
}

function isReadyForEvaluation(snapshot, cutoff) {
  const kickoffAt = timestamp(snapshot?.fixture?.utcDateTime || snapshot?.fixture?.date);
  const nextEvaluationAt = timestamp(snapshot?.auditMetadata?.nextEvaluationAt);
  return (!kickoffAt || kickoffAt <= cutoff) && (!nextEvaluationAt || nextEvaluationAt <= cutoff);
}

function latestByFixture(snapshots = []) {
  const rows = new Map();
  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    if (!isValidEvidenceSnapshot(snapshot)) continue;
    const fixtureId = String(snapshot.fixture.id);
    const current = rows.get(fixtureId);
    if (!current || (isEvaluated(snapshot) && !isEvaluated(current)) || (isEvaluated(snapshot) === isEvaluated(current) && timestamp(snapshot.capturedAt) > timestamp(current.capturedAt))) rows.set(fixtureId, snapshot);
  }
  return [...rows.values()];
}

function readiness(evaluated) {
  if (evaluated >= SUFFICIENT_MINIMUM) return {
    key: "sufficient", label: "Evidencia suficiente", color: "green", nextTarget: null,
    recommendation: "Volumen adecuado para estudiar mejoras por competición, mercado y versión con validación estadística."
  };
  if (evaluated >= PRELIMINARY_MINIMUM) return {
    key: "medium", label: "Evidencia media", color: "orange", nextTarget: SUFFICIENT_MINIMUM,
    recommendation: "Útil para diagnóstico preliminar. Todavía no conviene recalibrar fórmulas definitivas."
  };
  return {
    key: "low", label: "Evidencia baja", color: "red", nextTarget: PRELIMINARY_MINIMUM,
    recommendation: "Continúa recopilando y auditando resultados antes de modificar el sistema."
  };
}

export function summarizeEvidenceByCompetition(snapshots = [], now = new Date()) {
  const cutoff = now instanceof Date ? now.getTime() : timestamp(now);
  const groups = new Map();
  for (const snapshot of latestByFixture(snapshots)) {
    const fixture = snapshot.fixture || {};
    const key = competitionKey(snapshot);
    const group = groups.get(key) || {
      key,
      leagueId: fixture.leagueId ?? null,
      competition: fixture.leagueName || "Competición no disponible",
      collected: 0,
      evaluated: 0,
      decisivePicks: 0,
      discardedPicks: 0,
      counterfactualAssessable: 0,
      pendingEvaluation: 0,
      readyToEvaluate: 0,
      qualityScores: [],
      schemaVersions: {},
      fixtures: []
    };
    const evaluated = isEvaluated(snapshot);
    const readyToEvaluate = !evaluated && isReadyForEvaluation(snapshot, cutoff);
    group.collected += 1;
    group.evaluated += evaluated ? 1 : 0;
    group.decisivePicks += evaluated ? Number(snapshot.auditSummary?.decisivePicks ?? 0) : 0;
    group.discardedPicks += evaluated ? Number(snapshot.auditSummary?.discardedPicks ?? 0) : 0;
    group.counterfactualAssessable += evaluated ? Number(snapshot.auditSummary?.counterfactualAssessable ?? 0) : 0;
    group.pendingEvaluation += evaluated ? 0 : 1;
    group.readyToEvaluate += readyToEvaluate ? 1 : 0;
    const rawQualityScore = snapshot.captureManifest?.qualityScore ?? snapshot.dataQuality?.score;
    const qualityScore = rawQualityScore === null || rawQualityScore === undefined || rawQualityScore === "" ? null : Number(rawQualityScore);
    if (Number.isFinite(qualityScore)) group.qualityScores.push(qualityScore);
    const schemaVersion = snapshot.captureManifest?.schemaVersion || `legacy-v${snapshot.version || 1}`;
    group.schemaVersions[schemaVersion] = (group.schemaVersions[schemaVersion] || 0) + 1;
    group.fixtures.push(String(fixture.id));
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const level = readiness(group.evaluated);
    return {
      ...group,
      competitionKey: group.key,
      ...level,
      averageQualityScore: group.qualityScores.length ? Number((group.qualityScores.reduce((sum, value) => sum + value, 0) / group.qualityScores.length).toFixed(1)) : null,
      schemaVersionSummary: Object.entries(group.schemaVersions).map(([version, count]) => `${version}: ${count}`).join(" · "),
      remaining: level.nextTarget === null ? 0 : Math.max(0, level.nextTarget - group.evaluated),
      progressPct: Math.min(100, Number((group.evaluated / SUFFICIENT_MINIMUM * 100).toFixed(1)))
    };
  }).sort((a, b) => b.evaluated - a.evaluated || b.collected - a.collected || a.competition.localeCompare(b.competition, "es"));
}

export function pendingEvidenceForCompetition(snapshots = [], key, now = new Date()) {
  const cutoff = now instanceof Date ? now.getTime() : timestamp(now);
  const pending = latestByFixture(snapshots).filter((snapshot) => competitionKey(snapshot) === key && !isEvaluated(snapshot));
  return {
    ready: pending.filter((snapshot) => isReadyForEvaluation(snapshot, cutoff)),
    waiting: pending.filter((snapshot) => !isReadyForEvaluation(snapshot, cutoff))
  };
}

export const EVIDENCE_READINESS_THRESHOLDS = Object.freeze({ preliminary: PRELIMINARY_MINIMUM, sufficient: SUFFICIENT_MINIMUM });
