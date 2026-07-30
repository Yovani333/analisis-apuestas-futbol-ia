import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("auditoria no muestra biblioteca global sin sesion de nube", () => {
  assert.match(appSource, /async function loadEvidenceLibrary\(\) \{/);
  assert.match(appSource, /if \(!cloudSyncClient\.session\?\.accessToken\) \{/);
  assert.match(appSource, /state\.evidenceLibrary = \[\];/);
  assert.match(appSource, /renderAuditFixtureOptions\(\);/);
});

test("selector de auditoria solo lista snapshots prepartido existentes", () => {
  assert.doesNotMatch(appSource, /Sin snapshot/);
  assert.match(appSource, /const snapshots = allEvidenceSnapshots\(\);/);
  assert.match(appSource, /for \(const id of evidenceFixtureIds\) \{/);
  assert.doesNotMatch(appSource, /state\.fixtures\.filter\(\(item\) => item\.status === "finished"\)/);
});

test("sincronizacion compacta no borra evidencias locales", () => {
  assert.match(appSource, /const compactRemoteEvidence = remoteState\?\.evidence_sync_summary\?\.compacted === true;/);
  assert.match(appSource, /compactRemoteEvidence\s*\?\s*filterValidEvidenceSnapshots\(state\.evidenceSnapshots\)/);
});

test("sincronizacion de cuenta solo muestra resumen y no hidrata snapshots completos", () => {
  assert.doesNotMatch(appSource, /cloudSyncClient\.loadEvidenceSnapshots\(/);
  assert.match(appSource, /state\.cloud\.evidenceSummary/);
  assert.match(appSource, /Resumen liviano de Supabase/);
});
