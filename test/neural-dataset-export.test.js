import test from "node:test";
import assert from "node:assert/strict";
import { exportNeuralTrainingDataset } from "../server/services/audit/neural-dataset-export.service.js";

function snapshot(overrides = {}) {
  return {
    version: 3,
    id: "snapshot-1",
    capturedAt: "2026-08-05T17:00:00.000Z",
    fixture: {
      id: "100", status: "scheduled", utcDateTime: "2026-08-05T18:00:00.000Z",
      leagueId: 253, leagueName: "MLS", country: "USA", season: 2026,
      home: "A", away: "B", homeTeamId: 1, awayTeamId: 2
    },
    dataQuality: { score: 84, missing: ["lineups"] },
    auditMetadata: { captureMode: "automatic_one_hour", dataPicksModelVersion: "data-picks-v3", calibrationEligible: true },
    currentFixtureStatisticsUsed: false,
    openAiUsed: false,
    modules: {
      dataPicks: {
        modelVersion: "data-picks-v3",
        picks: [{
          market: "Total de goles 2.5", selection: "Mas de 2.5", selectionKey: "over_2_5",
          modelProbabilityPct: 64, impliedProbabilityPct: 55, decimalOdds: 1.82,
          expectedValuePct: 16.5, confidenceScore: 76, riskScore: 31,
          sourceModule: "data_picks", generatedAt: "2026-08-05T17:00:00.000Z"
        }]
      }
    },
    ...overrides
  };
}

function audit(outcome = "HIT") {
  return { fixtureId: "100", records: [{ selectionKey: "over_2_5", outcome, finalScore: "3-1" }] };
}

test("exporta solamente features prepartido y etiqueta HIT sin copiar el marcador", () => {
  const evidence = snapshot();
  const before = structuredClone(evidence);
  const result = exportNeuralTrainingDataset({ snapshots: [evidence], audits: { "snapshot-1": audit() } });
  assert.equal(result.summary.trainableRows, 1);
  assert.equal(result.rows[0].target, 1);
  assert.equal(result.rows[0].features.leadMinutes, 60);
  assert.equal("finalScore" in result.rows[0], false);
  assert.deepEqual(evidence, before);
  assert.equal(result.policy.historicalPicksRecalculated, false);
});

test("rechaza captura posterior al inicio y fuentes no verificadas", () => {
  const late = snapshot({ id: "late", capturedAt: "2026-08-05T18:00:01.000Z" });
  const leaked = snapshot({ id: "leaked", fixture: { ...snapshot().fixture, id: "101" }, currentFixtureStatisticsUsed: true });
  const result = exportNeuralTrainingDataset({ snapshots: [late, leaked], audits: { late: audit(), leaked: audit() } });
  assert.equal(result.summary.trainableRows, 0);
  assert.deepEqual(result.exclusions.map((row) => row.reason).sort(), ["captured_after_kickoff", "current_fixture_statistics_used"]);
});

test("excluye NO BET, VOID y evaluaciones ausentes del objetivo neuronal", () => {
  const noBet = exportNeuralTrainingDataset({ snapshots: [snapshot()], audits: { "snapshot-1": audit("NO_BET") } });
  const voided = exportNeuralTrainingDataset({ snapshots: [snapshot()], audits: { "snapshot-1": audit("VOID") } });
  const missing = exportNeuralTrainingDataset({ snapshots: [snapshot()], audits: {} });
  assert.equal(noBet.summary.trainableRows, 0);
  assert.equal(voided.summary.trainableRows, 0);
  assert.equal(missing.summary.trainableRows, 0);
  assert.match(noBet.exclusions[0].reason, /non_decisive/);
  assert.match(voided.exclusions[0].reason, /non_decisive/);
  assert.equal(missing.exclusions[0].reason, "missing_audit");
});

test("conserva la version y separa la suficiencia por mercado y modelo", () => {
  const snapshots = Array.from({ length: 100 }, (_, index) => snapshot({
    id: `snapshot-${index}`,
    fixture: { ...snapshot().fixture, id: String(1000 + index), utcDateTime: new Date(Date.UTC(2026, 7, 5 + index, 18)).toISOString() },
    capturedAt: new Date(Date.UTC(2026, 7, 5 + index, 17)).toISOString(),
    modules: { dataPicks: { ...snapshot().modules.dataPicks, picks: [{ ...snapshot().modules.dataPicks.picks[0], generatedAt: new Date(Date.UTC(2026, 7, 5 + index, 17)).toISOString() }] } }
  }));
  const audits = Object.fromEntries(snapshots.map((row, index) => [row.id, { fixtureId: row.fixture.id, records: [{ selectionKey: "over_2_5", outcome: index % 2 ? "MISS" : "HIT" }] }]));
  const result = exportNeuralTrainingDataset({ snapshots, audits });
  assert.equal(result.summary.trainableRows, 100);
  assert.equal(result.readiness[0].status, "exploratory");
  assert.equal(result.readiness[0].modelVersion, "data-picks-v3");
});

test("es determinista y elimina snapshots duplicados del mismo fixture y version", () => {
  const older = snapshot({ id: "older", capturedAt: "2026-08-05T16:30:00.000Z" });
  const newer = snapshot({ id: "newer" });
  const audits = { older: audit("MISS"), newer: audit("HIT") };
  const first = exportNeuralTrainingDataset({ snapshots: [older, newer], audits });
  const second = exportNeuralTrainingDataset({ snapshots: [newer, older], audits });
  assert.equal(first.summary.duplicateSnapshotsIgnored, 1);
  assert.equal(first.rows[0].snapshotId, "newer");
  assert.equal(first.fingerprint, second.fingerprint);
  assert.deepEqual(first.rows, second.rows);
});
