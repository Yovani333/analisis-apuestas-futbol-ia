import test from "node:test";
import assert from "node:assert/strict";
import { loadEvidenceLibrary } from "../server/services/audit/evidence-library.service.js";

test("carga las nueve evidencias existentes con liga y contrato auditable", () => {
  const library = loadEvidenceLibrary();
  assert.equal(library.snapshots.length, 9);
  for (const snapshot of library.snapshots) {
    assert.ok(snapshot.fixture.leagueName);
    assert.ok(snapshot.fixture.id);
    assert.equal(snapshot.fixture.status, "scheduled");
    assert.equal(snapshot.currentFixtureStatisticsUsed, false);
    assert.equal(snapshot.openAiUsed, false);
    assert.ok(Array.isArray(snapshot.modules.dataPicks.picks));
  }
});

