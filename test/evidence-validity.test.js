import test from "node:test";
import assert from "node:assert/strict";
import {
  evidenceInvalidReason,
  filterValidEvidenceSnapshots,
  isInvalidEvidenceFixtureStatus,
  isValidEvidenceSnapshot
} from "../public/evidence-validity.js";

function snapshot(overrides = {}) {
  return {
    id: "evidence-1",
    capturedAt: "2026-07-01T17:00:00Z",
    fixture: {
      id: "100",
      home: "Local",
      away: "Visitante",
      status: "scheduled",
      utcDateTime: "2026-07-01T18:00:00Z"
    },
    currentFixtureStatisticsUsed: false,
    ...overrides
  };
}

test("acepta un snapshot completo capturado antes del inicio", () => {
  assert.equal(isValidEvidenceSnapshot(snapshot()), true);
  assert.equal(evidenceInvalidReason(snapshot()), "");
});

test("rechaza capturas posteriores al inicio y muestras con fuga del fixture", () => {
  assert.equal(evidenceInvalidReason(snapshot({ capturedAt: "2026-07-01T18:00:00Z" })), "captured_after_kickoff");
  assert.equal(evidenceInvalidReason(snapshot({ currentFixtureStatisticsUsed: true })), "current_fixture_statistics_used");
});

test("reconoce estados pospuestos, cancelados y suspendidos", () => {
  for (const status of ["postponed", "PST", "cancelled", "suspended", "abandoned"]) {
    assert.equal(isInvalidEvidenceFixtureStatus(status), true);
    assert.equal(isValidEvidenceSnapshot(snapshot(), status), false);
  }
});

test("filtra evidencia invalida usando el estado actual del fixture", () => {
  const valid = snapshot();
  const postponed = snapshot({ id: "evidence-2", fixture: { ...snapshot().fixture, id: "200" } });
  const statuses = new Map([["200", "postponed"]]);
  assert.deepEqual(filterValidEvidenceSnapshots([valid, postponed], statuses).map((row) => row.id), ["evidence-1"]);
});
