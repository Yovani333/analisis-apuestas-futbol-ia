import test from "node:test";
import assert from "node:assert/strict";
import { loadEvidenceLibrary } from "../server/services/audit/evidence-library.service.js";

test("carga evidencias de Mundial y Superliga China sin duplicar fixtures", () => {
  const library = loadEvidenceLibrary();
  assert.equal(library.snapshots.length, 17);
  assert.equal(new Set(library.snapshots.map((snapshot) => snapshot.fixture.id)).size, 17);
  assert.equal(library.snapshots.some((snapshot) => snapshot.fixture.id === "1570714"), false);
  assert.equal(library.invalidRemoved, 1);
  assert.deepEqual(new Set(library.snapshots.map((snapshot) => snapshot.fixture.leagueName)), new Set(["Copa Mundial FIFA", "Superliga China"]));
  assert.ok(library.snapshots.some((snapshot) => snapshot.fixture.leagueSlug === "chinese-super-league"));
  for (const snapshot of library.snapshots) {
    assert.ok(snapshot.fixture.leagueName);
    assert.ok(snapshot.fixture.id);
    assert.equal(snapshot.fixture.status, "scheduled");
    assert.equal(snapshot.currentFixtureStatisticsUsed, false);
    assert.equal(snapshot.openAiUsed, false);
    assert.ok(Array.isArray(snapshot.modules.dataPicks.picks));
  }
});
