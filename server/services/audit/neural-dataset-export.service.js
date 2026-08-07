import { createHash } from "node:crypto";
import { evidenceInvalidReason } from "../../../public/evidence-validity.js";

const DATASET_VERSION = "neural-training-dataset-v1";
const DECISIVE_OUTCOMES = new Set(["HIT", "MISS"]);

function finiteNumber(value, minimum = -Infinity, maximum = Infinity) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= minimum && numeric <= maximum ? numeric : null;
}

function normalizedText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function normalizedKey(value) {
  return normalizedText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizedOutcome(value) {
  const key = normalizedKey(value).toUpperCase();
  return ({ ACERTADO: "HIT", GANADO: "HIT", WON: "HIT", FALLADO: "MISS", PERDIDO: "MISS", LOST: "MISS", NULO: "VOID", ANULADO: "VOID", DESCARTADO: "NO_BET", NO_EVALUABLE: "DATA_INSUFFICIENT" })[key] || key;
}

function modelVersion(snapshot, pick) {
  return normalizedText(pick?.modelVersion || snapshot?.modules?.dataPicks?.modelVersion || snapshot?.auditMetadata?.dataPicksModelVersion, "unknown");
}

function pickIdentity(pick = {}) {
  const selectionKey = normalizedText(pick.selectionKey);
  if (selectionKey) return `key:${selectionKey}`;
  return `text:${normalizedKey(pick.market)}:${normalizedKey(pick.selection || pick.pick)}`;
}

function auditForSnapshot(snapshot, audits) {
  if (Array.isArray(audits)) {
    return audits.find((audit) => String(audit?.evidenceId || audit?.snapshotId || "") === String(snapshot.id))
      || audits.find((audit) => String(audit?.fixtureId || "") === String(snapshot.fixture?.id));
  }
  return audits?.[snapshot.id] || audits?.[String(snapshot.fixture?.id || "")] || null;
}

function auditRecordMap(audit = {}) {
  const rows = Array.isArray(audit?.records) ? audit.records : [];
  const map = new Map();
  for (const row of rows) {
    const identity = pickIdentity(row);
    if (!map.has(identity)) map.set(identity, row);
  }
  return map;
}

function snapshotIdentity(snapshot) {
  return `${snapshot.fixture?.id || ""}:${modelVersion(snapshot, {})}`;
}

function selectLatestSnapshots(snapshots = []) {
  const selected = new Map();
  for (const snapshot of snapshots) {
    const key = snapshotIdentity(snapshot);
    const current = selected.get(key);
    if (!current || Date.parse(snapshot.capturedAt || "") > Date.parse(current.capturedAt || "")) selected.set(key, snapshot);
  }
  return [...selected.values()];
}

function snapshotProblem(snapshot) {
  const invalid = evidenceInvalidReason(snapshot);
  if (invalid) return invalid;
  if (snapshot.fixture?.status !== "scheduled") return "snapshot_not_scheduled";
  if (snapshot.currentFixtureStatisticsUsed !== false) return "current_fixture_source_not_verified";
  if (snapshot.openAiUsed !== false) return "openai_source_not_verified";
  if (snapshot.auditMetadata?.calibrationEligible === false) return "calibration_not_eligible";
  return "";
}

function sourceFeatures(snapshot, pick) {
  const kickoff = Date.parse(snapshot.fixture?.utcDateTime || "");
  const captured = Date.parse(snapshot.capturedAt || "");
  const leadMinutes = Number.isFinite(kickoff) && Number.isFinite(captured) ? Math.max(0, (kickoff - captured) / 60_000) : null;
  const qualityScore = finiteNumber(snapshot.dataQuality?.score, 0, 100);
  const features = {
    modelProbability: finiteNumber(pick.modelProbabilityPct, 0, 100),
    impliedProbability: finiteNumber(pick.impliedProbabilityPct, 0, 100),
    decimalOdds: finiteNumber(pick.decimalOdds, 1),
    expectedValue: finiteNumber(pick.expectedValuePct),
    conservativeExpectedValue: finiteNumber(pick.conservativeExpectedValuePct),
    confidence: finiteNumber(pick.confidenceScore, 0, 100),
    statisticalConfidence: finiteNumber(pick.statisticalConfidenceScore, 0, 100),
    footballConfidence: finiteNumber(pick.footballConfidenceScore, 0, 100),
    riskScore: finiteNumber(pick.riskScore, 0, 100),
    poissonSupport: finiteNumber(pick.poissonSupportScore ?? pick.poissonSupport, 0, 100),
    teamGoalSupport: finiteNumber(pick.teamGoalSupportScore ?? pick.teamGoalSupport, 0, 100),
    dataQuality: qualityScore,
    missingFieldCount: Array.isArray(snapshot.dataQuality?.missing) ? snapshot.dataQuality.missing.length : null,
    leadMinutes,
    neutralVenue: snapshot.fixture?.neutralVenue === true ? 1 : 0
  };
  return { features, missingFeatures: Object.entries(features).filter(([, value]) => value === null).map(([key]) => key) };
}

function readiness(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.marketKey}:${row.modelVersion}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, group]) => {
    const hits = group.filter((row) => row.target === 1).length;
    const misses = group.length - hits;
    const status = group.length >= 1_000 ? "evaluation_ready" : group.length >= 300 ? "prototype_only" : group.length >= 100 ? "exploratory" : "insufficient";
    return {
      key, marketKey: group[0].marketKey, modelVersion: group[0].modelVersion,
      samples: group.length, hits, misses,
      positiveRatePct: Number((hits / group.length * 100).toFixed(2)),
      status,
      minimumForNextLevel: status === "insufficient" ? 100 : status === "exploratory" ? 300 : status === "prototype_only" ? 1_000 : null
    };
  }).sort((a, b) => b.samples - a.samples || a.key.localeCompare(b.key));
}

function fingerprint(rows) {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

export function exportNeuralTrainingDataset({ snapshots = [], audits = {} } = {}) {
  const originalSnapshots = Array.isArray(snapshots) ? snapshots : [];
  const selectedSnapshots = selectLatestSnapshots(originalSnapshots);
  const rows = [];
  const exclusions = [];

  for (const snapshot of selectedSnapshots) {
    const problem = snapshotProblem(snapshot);
    if (problem) {
      exclusions.push({ snapshotId: snapshot?.id || null, fixtureId: snapshot?.fixture?.id || null, reason: problem });
      continue;
    }
    const audit = auditForSnapshot(snapshot, audits);
    if (!audit) {
      exclusions.push({ snapshotId: snapshot.id, fixtureId: snapshot.fixture.id, reason: "missing_audit" });
      continue;
    }
    if (String(audit.fixtureId || snapshot.fixture.id) !== String(snapshot.fixture.id)) {
      exclusions.push({ snapshotId: snapshot.id, fixtureId: snapshot.fixture.id, reason: "audit_fixture_mismatch" });
      continue;
    }
    const records = auditRecordMap(audit);
    const picks = Array.isArray(snapshot.modules?.dataPicks?.picks) ? snapshot.modules.dataPicks.picks : [];
    for (const pick of picks) {
      const record = records.get(pickIdentity(pick));
      if (!record) {
        exclusions.push({ snapshotId: snapshot.id, fixtureId: snapshot.fixture.id, pick: pickIdentity(pick), reason: "missing_pick_evaluation" });
        continue;
      }
      const outcome = normalizedOutcome(record.outcome ?? record.evaluation?.status ?? record.status);
      if (!DECISIVE_OUTCOMES.has(outcome)) {
        exclusions.push({ snapshotId: snapshot.id, fixtureId: snapshot.fixture.id, pick: pickIdentity(pick), reason: `non_decisive_${normalizedKey(outcome || "unknown")}` });
        continue;
      }
      const generatedAt = Date.parse(pick.generatedAt || pick.timestamp || snapshot.capturedAt || "");
      const kickoffAt = Date.parse(snapshot.fixture.utcDateTime || "");
      if (!Number.isFinite(generatedAt) || generatedAt >= kickoffAt) {
        exclusions.push({ snapshotId: snapshot.id, fixtureId: snapshot.fixture.id, pick: pickIdentity(pick), reason: "pick_generated_after_kickoff" });
        continue;
      }
      const { features, missingFeatures } = sourceFeatures(snapshot, pick);
      if (features.modelProbability === null || features.modelProbability <= 0 || features.modelProbability >= 100) {
        exclusions.push({ snapshotId: snapshot.id, fixtureId: snapshot.fixture.id, pick: pickIdentity(pick), reason: "invalid_model_probability" });
        continue;
      }
      rows.push({
        rowId: `${snapshot.id}:${pickIdentity(pick)}`,
        snapshotId: snapshot.id,
        fixtureId: String(snapshot.fixture.id),
        capturedAt: snapshot.capturedAt,
        kickoffAt: snapshot.fixture.utcDateTime,
        leagueId: snapshot.fixture.leagueId ?? null,
        leagueName: normalizedText(snapshot.fixture.leagueName, "unknown"),
        country: normalizedText(snapshot.fixture.country, "unknown"),
        season: snapshot.fixture.season ?? null,
        homeTeamId: snapshot.fixture.homeTeamId ?? null,
        awayTeamId: snapshot.fixture.awayTeamId ?? null,
        market: normalizedText(pick.market, "unknown"),
        marketKey: normalizedKey(pick.market || pick.selectionKey || "unknown"),
        selection: normalizedText(pick.selection || pick.pick, "unknown"),
        selectionKey: normalizedText(pick.selectionKey),
        sourceModule: normalizedText(pick.sourceModule, "unknown"),
        modelVersion: modelVersion(snapshot, pick),
        captureMode: normalizedText(snapshot.auditMetadata?.captureMode, "unknown"),
        features,
        missingFeatures,
        target: outcome === "HIT" ? 1 : 0,
        targetLabel: outcome
      });
    }
  }

  rows.sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt) || a.fixtureId.localeCompare(b.fixtureId) || a.rowId.localeCompare(b.rowId));
  const uniqueRows = [...new Map(rows.map((row) => [row.rowId, row])).values()];
  return {
    schemaVersion: DATASET_VERSION,
    generatedAt: new Date().toISOString(),
    fingerprint: fingerprint(uniqueRows),
    policy: {
      target: "HIT=1, MISS=0",
      excludedOutcomes: ["VOID", "NO_BET", "DATA_INSUFFICIENT", "LIVE_PENDING"],
      source: "frozen_pre_match_snapshots_and_saved_audits",
      currentFixtureStatisticsUsed: false,
      historicalPicksRecalculated: false
    },
    summary: {
      snapshotsReceived: originalSnapshots.length,
      snapshotsSelected: selectedSnapshots.length,
      duplicateSnapshotsIgnored: originalSnapshots.length - selectedSnapshots.length,
      trainableRows: uniqueRows.length,
      hits: uniqueRows.filter((row) => row.target === 1).length,
      misses: uniqueRows.filter((row) => row.target === 0).length,
      exclusions: exclusions.length
    },
    readiness: readiness(uniqueRows),
    exclusions,
    rows: uniqueRows
  };
}

export const neuralDatasetExportInternals = Object.freeze({ normalizedOutcome, pickIdentity, selectLatestSnapshots, sourceFeatures });
