import test from "node:test";
import assert from "node:assert/strict";
import { createEvidenceSnapshot, evidenceSnapshotToText, latestEvidenceForFixture, loadEvidenceSnapshots, saveEvidenceSnapshot } from "../public/evidence-store.js";

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
}

test("crea evidencia compacta prepartido sin proveedor externo ni estadísticas actuales", () => {
  const fixture = { id: 12, status: "scheduled", utcDateTime: "2026-08-03T18:00:00Z", home: "A", away: "B", confirmedData: { statistics: [{ leaked: true }] }, researchData: { odds: { markets: [] } } };
  const snapshot = createEvidenceSnapshot({ fixture, dataPicks: { status: "available", picks: [{ selection: "1X" }] } }, new Date("2026-07-02T18:00:00Z"));
  assert.equal(snapshot.fixture.id, 12);
  assert.equal(snapshot.openAiUsed, false);
  assert.equal(snapshot.currentFixtureStatisticsUsed, false);
  assert.equal(snapshot.version, 3);
  assert.equal(snapshot.captureManifest.schemaVersion, "pre-match-evidence-v3");
  assert.equal("confirmedData" in snapshot.fixture, false);
});

test("rechaza evidencia de partidos iniciados o finalizados", () => {
  assert.throws(() => createEvidenceSnapshot({ fixture: { id: 1, status: "live" } }), /antes del inicio/);
  assert.throws(() => createEvidenceSnapshot({ fixture: { id: 1, status: "finished" } }), /antes del inicio/);
});

test("guarda y recupera la evidencia más reciente por fixture", () => {
  const store = storage();
  const fixture = { id: 7, status: "scheduled", utcDateTime: "2026-08-03T18:00:00Z", home: "A", away: "B" };
  const first = createEvidenceSnapshot({ fixture }, new Date("2026-07-02T10:00:00Z"));
  const latest = createEvidenceSnapshot({ fixture }, new Date("2026-07-02T12:00:00Z"));
  saveEvidenceSnapshot(first, store);
  saveEvidenceSnapshot(latest, store);
  const loaded = loadEvidenceSnapshots(store);
  assert.equal(loaded.length, 2);
  assert.equal(latestEvidenceForFixture(loaded, 7).id, latest.id);
});

test("genera evidencia textual con modelos, picks y campos de auditoría", () => {
  const fixture = { id: 9, status: "scheduled", utcDateTime: "2026-08-03T18:00:00Z", home: "México", away: "Japón", leagueName: "Mundial" };
  const snapshot = createEvidenceSnapshot({ fixture,
    dataPicks: { modelVersion: "picks-data-engine-v3", adjustmentsVersion: "predictive-adjustments-v1", finalDecision: "PRECAUCIÓN", picks: [{ market: "Total", selection: "Over 1.5", decision: "PRECAUCIÓN", decimalOdds: 1.5, expectedValuePct: 5, conservativeExpectedValuePct: 1, confidenceScore: 60, statisticalConfidenceScore: 58, footballConfidenceScore: 62, riskScore: 40 }] },
    poisson: { lambdaHome: 1.4, lambdaAway: 1.1, probabilities: { over15: 71 } },
    teamGoals: { homeGoalProbability: 75, awayGoalProbability: 65, btts: { yesProbabilityPct: 54 } }
  });
  const text = evidenceSnapshotToText(snapshot);
  assert.match(text, /EVIDENCIA PREPARTIDO AUDITABLE/);
  assert.match(text, /Lambda local: 1.4/);
  assert.match(text, /Decisión: PRECAUCIÓN/);
  assert.match(text, /Motor de picks: picks-data-engine-v3/);
  assert.match(text, /EV conservador: 1%/);
  assert.match(text, /Resultado final del partido: Pendiente/);
});

test("elimina del almacenamiento evidencias invalidas al cargarlas", () => {
  const store = storage();
  const valid = createEvidenceSnapshot({ fixture: { id: 20, status: "scheduled", utcDateTime: "2026-07-03T18:00:00Z", home: "A", away: "B" } }, new Date("2026-07-03T17:00:00Z"));
  const invalid = { ...valid, id: "invalid", capturedAt: "2026-07-03T18:01:00Z" };
  store.setItem("football-ai.evidence-snapshots.v1", JSON.stringify([invalid, valid]));
  const loaded = loadEvidenceSnapshots(store);
  assert.deepEqual(loaded.map((row) => row.id), [valid.id]);
  assert.deepEqual(JSON.parse(store.getItem("football-ai.evidence-snapshots.v1")).map((row) => row.id), [valid.id]);
});
