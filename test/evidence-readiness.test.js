import test from "node:test";
import assert from "node:assert/strict";
import { EVIDENCE_READINESS_THRESHOLDS, pendingEvidenceForCompetition, summarizeEvidenceByCompetition } from "../public/evidence-readiness.js";

function snapshot(index, { leagueId = 1, leagueName = "Copa Mundial FIFA", audited = true, capturedAt } = {}) {
  return {
    id: `evidence-${index}`,
    capturedAt: capturedAt || `2026-07-01T${String(index % 24).padStart(2, "0")}:00:00Z`,
    fixture: { id: String(index), leagueId, leagueName, utcDateTime: "2026-08-01T18:00:00Z" },
    currentFixtureStatisticsUsed: false,
    auditMetadata: audited ? { auditedAt: "2026-08-02T10:00:00Z" } : {},
    auditSummary: audited ? { completed: true, evaluablePicks: 2 } : null
  };
}

test("agrupa evidencia unica por competición y separa pendientes", () => {
  const rows = summarizeEvidenceByCompetition([
    snapshot(1),
    { ...snapshot(1), id: "new-copy", capturedAt: "2026-07-02T10:00:00Z", auditMetadata: {}, auditSummary: null },
    snapshot(2, { audited: false }),
    snapshot(3, { leagueId: 169, leagueName: "Superliga China" })
  ]);
  const worldCup = rows.find((row) => row.leagueId === 1);
  assert.equal(worldCup.competitionKey, "league:1");
  assert.equal(worldCup.key, "low");
  assert.equal(worldCup.collected, 2);
  assert.equal(worldCup.evaluated, 1);
  assert.equal(worldCup.pendingEvaluation, 1);
  assert.equal(rows.find((row) => row.leagueId === 169).evaluated, 1);
});

test("usa semáforo bajo, medio y suficiente con umbrales prudentes", () => {
  const low = summarizeEvidenceByCompetition(Array.from({ length: 29 }, (_, index) => snapshot(index + 1)))[0];
  const medium = summarizeEvidenceByCompetition(Array.from({ length: 30 }, (_, index) => snapshot(index + 1)))[0];
  const sufficient = summarizeEvidenceByCompetition(Array.from({ length: 100 }, (_, index) => snapshot(index + 1)))[0];
  assert.equal(low.key, "low");
  assert.equal(medium.key, "medium");
  assert.equal(sufficient.key, "sufficient");
  assert.deepEqual(EVIDENCE_READINESS_THRESHOLDS, { preliminary: 30, sufficient: 100 });
});

test("excluye capturas posteriores al inicio y datos del fixture actual", () => {
  const future = snapshot(1, { capturedAt: "2026-09-01T10:00:00Z" });
  const leaked = { ...snapshot(2), currentFixtureStatisticsUsed: true };
  assert.deepEqual(summarizeEvidenceByCompetition([future, leaked]), []);
});

test("excluye evidencias de fixtures pospuestos", () => {
  const postponed = snapshot(4);
  postponed.fixture.status = "postponed";
  assert.deepEqual(summarizeEvidenceByCompetition([postponed]), []);
});

test("selecciona solo pendientes finalizadas de la competicion solicitada", () => {
  const rows = [
    snapshot(1, { audited: false, capturedAt: "2026-07-01T10:00:00Z" }),
    snapshot(2, { audited: false, capturedAt: "2026-07-01T11:00:00Z" }),
    snapshot(3, { leagueId: 169, leagueName: "Superliga China", audited: false })
  ];
  rows[0].fixture.utcDateTime = "2026-07-02T18:00:00Z";
  rows[1].fixture.utcDateTime = "2026-09-02T18:00:00Z";
  rows[2].fixture.utcDateTime = "2026-07-02T18:00:00Z";
  const pending = pendingEvidenceForCompetition(rows, "league:1", new Date("2026-07-18T12:00:00Z"));
  assert.deepEqual(pending.ready.map((row) => row.fixture.id), ["1"]);
  assert.deepEqual(pending.waiting.map((row) => row.fixture.id), ["2"]);
});

test("aplaza temporalmente una evidencia cuyo resultado oficial aun no esta disponible", () => {
  const row = snapshot(1, { audited: false, capturedAt: "2026-07-01T10:00:00Z" });
  row.fixture.utcDateTime = "2026-07-18T08:00:00Z";
  row.auditMetadata.nextEvaluationAt = "2026-07-18T13:00:00Z";

  const beforeRetry = pendingEvidenceForCompetition([row], "league:1", new Date("2026-07-18T12:00:00Z"));
  assert.deepEqual(beforeRetry.ready, []);
  assert.deepEqual(beforeRetry.waiting.map((item) => item.fixture.id), ["1"]);
  assert.equal(summarizeEvidenceByCompetition([row], new Date("2026-07-18T12:00:00Z"))[0].readyToEvaluate, 0);

  const afterRetry = pendingEvidenceForCompetition([row], "league:1", new Date("2026-07-18T13:01:00Z"));
  assert.deepEqual(afterRetry.ready.map((item) => item.fixture.id), ["1"]);
});

test("MLS excluye la evidencia pospuesta de Chicago contra Vancouver del conteo", () => {
  const validRows = Array.from({ length: 5 }, (_, index) => snapshot(index + 1, {
    leagueId: 253,
    leagueName: "MLS"
  }));
  const postponed = snapshot(99, { leagueId: 253, leagueName: "MLS" });
  postponed.fixture = {
    ...postponed.fixture,
    id: "mls-postponed",
    home: "Chicago Fire",
    away: "Vancouver Whitecaps",
    utcDateTime: "2026-07-17T00:30:00Z"
  };
  postponed.capturedAt = "2026-07-16T22:30:00Z";

  const [mls] = summarizeEvidenceByCompetition([...validRows, postponed]);
  assert.equal(mls.collected, 5);
  assert.equal(mls.evaluated, 5);
  assert.equal(mls.pendingEvaluation, 0);
});
