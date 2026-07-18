import test from "node:test";
import assert from "node:assert/strict";
import {
  automaticEvidenceInternals,
  createAutomaticEvidenceSnapshot,
  createServerEvidenceSnapshot,
  evidenceWindowStatus,
  runAutomaticEvidenceCycle
} from "../server/services/automatic-evidence.service.js";
import { cloudSyncInternals } from "../server/services/cloud-sync.service.js";

const NOW = new Date("2026-07-12T18:00:00.000Z");

function dataset() {
  return {
    source: "api-football",
    fixture: {
      id: "12345",
      status: "scheduled",
      statusLabel: "Programado",
      utcDateTime: "2026-07-12T19:00:00.000Z",
      date: "2026-07-12",
      time: "12:00",
      home: "Local",
      away: "Visitante",
      homeTeamId: 1,
      awayTeamId: 2,
      favorite: { probabilities: { home: 45, draw: 30, away: 25 } }
    },
    dataQuality: { score: 70 },
    marketAnalysis: [],
    researchData: {
      totalConfidenceScore: 70,
      odds: { markets: [] },
      favorite: { probabilities: { home: 45, draw: 30, away: 25 } },
      xgXga: { homeXG: 1.4, awayXG: 1.1, homeXGA: 1.1, awayXGA: 1.4, sampleSizeHome: 5, sampleSizeAway: 5 }
    }
  };
}

test("identifica la ventana de una hora sin usar partidos iniciados", () => {
  assert.equal(evidenceWindowStatus("2026-07-12T19:00:00.000Z", NOW), "due");
  assert.equal(evidenceWindowStatus("2026-07-12T20:00:01.000Z", NOW), "waiting");
  assert.equal(evidenceWindowStatus("2026-07-12T17:59:59.000Z", NOW), "started");
});

test("crea evidencia automatica auditable sin proveedor externo ni datos actuales", () => {
  const snapshot = createAutomaticEvidenceSnapshot(dataset(), NOW);
  assert.equal(snapshot.fixture.id, "12345");
  assert.equal(snapshot.auditMetadata.captureMode, "automatic_one_hour");
  assert.equal(snapshot.currentFixtureStatisticsUsed, false);
  assert.equal(snapshot.openAiUsed, false);
  assert.ok(snapshot.modules.dataPicks);
});

test("evidencia manual y automatica comparten el mismo constructor y datos deportivos", () => {
  const automatic = createAutomaticEvidenceSnapshot(dataset(), NOW);
  const manual = createServerEvidenceSnapshot(dataset(), NOW, { captureMode: "manual_server", targetLeadMinutes: null });
  assert.deepEqual(Object.keys(manual.modules), Object.keys(automatic.modules));
  assert.deepEqual(manual.modules.dataPicks.picks.map((pick) => [pick.market, pick.selection, pick.decision]), automatic.modules.dataPicks.picks.map((pick) => [pick.market, pick.selection, pick.decision]));
  assert.deepEqual(manual.fixture, automatic.fixture);
  assert.equal(manual.auditMetadata.captureMode, "manual_server");
  assert.equal(manual.auditMetadata.dataSource, "api-football");
});

test("registra solo fixtures programados futuros y calcula la hora objetivo", () => {
  const normalized = cloudSyncInternals.normalizeWatchedFixture(dataset().fixture, "123e4567-e89b-12d3-a456-426614174000", NOW);
  assert.equal(normalized.fixture_id, "12345");
  assert.equal(normalized.capture_due_at, "2026-07-12T18:00:00.000Z");
  assert.equal(cloudSyncInternals.normalizeWatchedFixture({ ...dataset().fixture, status: "live" }, normalized.user_id, NOW), null);
});

test("captura una fila debida una sola vez mediante las dependencias del backend", async () => {
  let saved = null;
  let updated = null;
  const row = { user_id: "u1", fixture_id: "12345", fixture_date: "2026-07-12T19:00:00.000Z", attempts: 0 };
  const result = await automaticEvidenceInternals.processWatchRow(row, NOW, {
    getDataset: async () => dataset(),
    saveEvidence: async (watch, snapshot) => { saved = { watch, snapshot }; },
    updateWatch: async (watch, changes) => { updated = { watch, changes }; }
  });
  assert.equal(result.status, "captured");
  assert.equal(saved.snapshot.auditMetadata.captureMode, "automatic_one_hour");
  assert.equal(updated, null);
});

test("omite una captura si el encuentro ya inicio", async () => {
  let updated = null;
  const row = { user_id: "u1", fixture_id: "12345", fixture_date: "2026-07-12T17:00:00.000Z", attempts: 0 };
  const result = await automaticEvidenceInternals.processWatchRow(row, NOW, {
    getDataset: async () => { throw new Error("no debe consultarse"); },
    saveEvidence: async () => {},
    updateWatch: async (watch, changes) => { updated = { watch, changes }; }
  });
  assert.equal(result.status, "skipped");
  assert.equal(updated.changes.status, "skipped");
});

test("reintenta fallos temporales y falla de forma controlada al tercer intento", async () => {
  const row = { user_id: "u1", fixture_id: "88", fixture_date: "2026-07-12T19:00:00.000Z", attempts: 0 };
  let updated = null;
  const dependencies = {
    getDataset: async () => { throw new Error("API temporalmente no disponible"); },
    saveEvidence: async () => {},
    updateWatch: async (watch, changes) => { updated = { watch, changes }; }
  };

  const first = await automaticEvidenceInternals.processWatchRow(row, NOW, dependencies);
  assert.equal(first.status, "retry");
  assert.equal(updated.changes.status, "scheduled");

  row.attempts = 2;
  const third = await automaticEvidenceInternals.processWatchRow(row, NOW, dependencies);
  assert.equal(third.status, "failed");
  assert.equal(updated.changes.status, "failed");
});

test("comparte una sola consulta API cuando varias cuentas vigilan el mismo fixture", async () => {
  let datasetCalls = 0;
  let requestedOptions = null;
  let requestedLimit = null;
  let saved = 0;
  const result = await runAutomaticEvidenceCycle({
    now: NOW,
    listDue: async (now, limit) => {
      requestedLimit = limit;
      return [
      { user_id: "u1", fixture_id: "12345", fixture_date: "2026-07-12T19:00:00.000Z", attempts: 0 },
      { user_id: "u2", fixture_id: "12345", fixture_date: "2026-07-12T19:00:00.000Z", attempts: 0 }
      ];
    },
    getDataset: async (fixtureId, options) => { datasetCalls += 1; requestedOptions = options; return dataset(); },
    saveEvidence: async () => { saved += 1; },
    updateWatch: async () => {}
  });
  assert.equal(datasetCalls, 1);
  assert.deepEqual(requestedOptions, { forceRefresh: false, includeHistorical: true });
  assert.equal(requestedLimit, 2);
  assert.equal(saved, 2);
  assert.equal(result.captured, 2);
});
