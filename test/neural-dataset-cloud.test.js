import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cloudSyncInternals } from "../server/services/cloud-sync.service.js";

const routes = readFileSync(new URL("../server/routes/api.routes.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/007_neural_audit_labels.sql", import.meta.url), "utf8");

function evidence() {
  return {
    version: 3,
    id: "snapshot-1",
    capturedAt: "2026-08-05T17:00:00Z",
    fixture: { id: "100", status: "scheduled", utcDateTime: "2026-08-05T18:00:00Z", home: "A", away: "B" },
    currentFixtureStatisticsUsed: false,
    openAiUsed: false,
    modules: { dataPicks: { modelVersion: "v3" } }
  };
}

test("construye etiquetas mínimas sin guardar marcador ni datos posteriores", () => {
  const rows = cloudSyncInternals.evidenceAuditLabelPayload("11111111-1111-1111-1111-111111111111", evidence(), {
    fixtureId: "100",
    generatedAt: "2026-08-05T20:00:00Z",
    records: [{ selectionKey: "over_2_5", market: "Total 2.5", pick: "Más de 2.5", outcome: "HIT", finalScore: "3-1", supportingData: { leaked: true } }]
  }, new Date("2026-08-05T20:01:00Z"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, "HIT");
  assert.equal(rows[0].pick_key, "key:over_2_5");
  assert.equal("final_score" in rows[0], false);
  assert.equal("supporting_data" in rows[0], false);
});

test("no persiste etiquetas si fixture y snapshot no coinciden", () => {
  assert.deepEqual(cloudSyncInternals.evidenceAuditLabelPayload("11111111-1111-1111-1111-111111111111", evidence(), { fixtureId: "999", records: [{ outcome: "HIT" }] }), []);
});

test("la migración protege etiquetas por usuario y limita estados", () => {
  assert.match(migration, /primary key \(user_id, snapshot_id, pick_key\)/);
  assert.match(migration, /auth\.uid\(\)\) = user_id/);
  assert.match(migration, /outcome in \('HIT', 'MISS', 'VOID', 'NO_BET', 'DATA_INSUFFICIENT', 'LIVE_PENDING'\)/);
  assert.match(migration, /revoke all .* from anon/);
});

test("el dataset en línea es autenticado, paginado y no devuelve filas por defecto", () => {
  assert.match(routes, /apiRouter\.get\("\/audit\/neural-dataset"/);
  assert.match(routes, /listAllCloudEvidenceSnapshots\(authorization\)/);
  assert.match(routes, /listCloudEvidenceAuditLabels\(authorization\)/);
  assert.match(routes, /includeRows \? \{ rows: dataset\.rows/);
});

test("la auditoría guarda etiquetas de forma aditiva sin cambiar su resultado", () => {
  assert.match(routes, /const audit = runSavedEvidenceBacktest\(evidence, result\)/);
  assert.match(routes, /saveEvidenceAuditLabels\(req\.headers\.authorization, evidence, audit\)/);
  assert.match(routes, /res\.json\(\{ \.\.\.audit, labelPersistence \}\)/);
});
