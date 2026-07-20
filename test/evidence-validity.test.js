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

test("elimina solo la evidencia MLS de Chicago contra Vancouver pospuesta en julio", () => {
  const postponed = snapshot({
    id: "mls-chicago-vancouver-july",
    capturedAt: "2026-07-16T22:30:00Z",
    fixture: {
      id: "mls-postponed",
      home: "Chicago Fire",
      away: "Vancouver Whitecaps",
      status: "scheduled",
      utcDateTime: "2026-07-17T00:30:00Z"
    }
  });
  const rescheduled = snapshot({
    id: "mls-chicago-vancouver-october",
    capturedAt: "2026-10-06T21:00:00Z",
    fixture: {
      id: "mls-rescheduled",
      home: "Chicago Fire",
      away: "Vancouver Whitecaps",
      status: "scheduled",
      utcDateTime: "2026-10-07T00:30:00Z"
    }
  });

  assert.equal(evidenceInvalidReason(postponed), "known_postponed_fixture");
  assert.equal(isValidEvidenceSnapshot(rescheduled), true);
  assert.deepEqual(filterValidEvidenceSnapshots([postponed, rescheduled]).map((row) => row.id), ["mls-chicago-vancouver-october"]);
});
