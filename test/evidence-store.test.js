import test from "node:test";
import assert from "node:assert/strict";
import { createEvidenceSnapshot, latestEvidenceForFixture, loadEvidenceSnapshots, saveEvidenceSnapshot } from "../public/evidence-store.js";

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
}

test("crea evidencia compacta prepartido sin OpenAI ni estadísticas actuales", () => {
  const fixture = { id: 12, status: "scheduled", home: "A", away: "B", confirmedData: { statistics: [{ leaked: true }] }, researchData: { odds: { markets: [] } } };
  const snapshot = createEvidenceSnapshot({ fixture, dataPicks: { status: "available", picks: [{ selection: "1X" }] } }, new Date("2026-07-02T18:00:00Z"));
  assert.equal(snapshot.fixture.id, 12);
  assert.equal(snapshot.openAiUsed, false);
  assert.equal(snapshot.currentFixtureStatisticsUsed, false);
  assert.equal("confirmedData" in snapshot.fixture, false);
});

test("rechaza evidencia de partidos iniciados o finalizados", () => {
  assert.throws(() => createEvidenceSnapshot({ fixture: { id: 1, status: "live" } }), /antes del inicio/);
  assert.throws(() => createEvidenceSnapshot({ fixture: { id: 1, status: "finished" } }), /antes del inicio/);
});

test("guarda y recupera la evidencia más reciente por fixture", () => {
  const store = storage();
  const fixture = { id: 7, status: "scheduled", home: "A", away: "B" };
  const first = createEvidenceSnapshot({ fixture }, new Date("2026-07-02T10:00:00Z"));
  const latest = createEvidenceSnapshot({ fixture }, new Date("2026-07-02T12:00:00Z"));
  saveEvidenceSnapshot(first, store);
  saveEvidenceSnapshot(latest, store);
  const loaded = loadEvidenceSnapshots(store);
  assert.equal(loaded.length, 2);
  assert.equal(latestEvidenceForFixture(loaded, 7).id, latest.id);
});
