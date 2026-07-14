import test from "node:test";
import assert from "node:assert/strict";
import { mergeCloudState } from "../public/cloud-sync.js";
import { cloudSyncInternals } from "../server/services/cloud-sync.service.js";

function token(payload) {
  return `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.x`;
}

test("combina datos locales y remotos sin duplicar identificadores", () => {
  const merged = mergeCloudState(
    { savedPicks: [{ id: "local" }, { id: "same", value: 1 }], savedParlays: [{ id: "p1" }] },
    { saved_picks: [{ id: "remote" }, { id: "same", value: 2 }], saved_parlays: [{ id: "p2" }] }
  );
  assert.deepEqual(merged.savedPicks.map((row) => row.id), ["local", "same", "remote"]);
  assert.equal(merged.savedPicks.find((row) => row.id === "same").value, 2);
  assert.equal(merged.savedParlays.length, 2);
});

test("sincronizar conserva parlays locales aunque la copia remota este vacia", () => {
  const merged = mergeCloudState(
    { savedParlays: [{ id: "local-only", name: "Parlay local", updatedAt: "2026-07-13T02:00:00Z" }] },
    { saved_parlays: [] }
  );
  assert.deepEqual(merged.savedParlays.map((row) => row.id), ["local-only"]);
});

test("combina cambios del mismo parlay y conserva selecciones de ambos dispositivos", () => {
  const merged = mergeCloudState(
    { savedParlays: [{ id: "shared", notes: "Nota nueva", updatedAt: "2026-07-13T03:00:00Z", legs: [{ id: "leg-1", result: "won", updatedAt: "2026-07-13T03:00:00Z" }] }] },
    { saved_parlays: [{ id: "shared", notes: "Nota anterior", updatedAt: "2026-07-13T01:00:00Z", legs: [{ id: "leg-1", result: "pending", updatedAt: "2026-07-13T01:00:00Z" }, { id: "leg-2", result: "pending" }] }] }
  );
  assert.equal(merged.savedParlays[0].notes, "Nota nueva");
  assert.equal(merged.savedParlays[0].legs.find((leg) => leg.id === "leg-1").result, "won");
  assert.deepEqual(merged.savedParlays[0].legs.map((leg) => leg.id), ["leg-1", "leg-2"]);
});

test("extrae el usuario del JWT y rechaza sesiones invalidas", () => {
  const userId = "123e4567-e89b-12d3-a456-426614174000";
  assert.equal(cloudSyncInternals.userIdFromToken(token({ sub: userId })), userId);
  assert.throws(() => cloudSyncInternals.userIdFromToken("invalido"), /sesion/);
});

test("normaliza y limita el estado sincronizable", () => {
  const state = cloudSyncInternals.normalizedState({ preferences: { theme: "dark" }, parlayDraft: Array.from({ length: 20 }, (_, id) => ({ id })) });
  assert.equal(state.parlay_draft.length, 12);
  assert.deepEqual(state.saved_picks, []);
  assert.equal(state.preferences.theme, "dark");
  assert.deepEqual(state.analysis_usage, {});
});

test("el respaldo del servidor combina filas existentes y entrantes sin borrar", () => {
  const merged = cloudSyncInternals.mergeNormalizedState(
    { saved_parlays: [{ id: "remote" }, { id: "same", value: "old" }], saved_picks: [{ id: "remote-pick" }] },
    { saved_parlays: [{ id: "local" }, { id: "same", value: "new" }], saved_picks: [] }
  );
  assert.deepEqual(merged.saved_parlays.map((row) => row.id), ["remote", "same", "local"]);
  assert.equal(merged.saved_parlays.find((row) => row.id === "same").value, "new");
  assert.deepEqual(merged.saved_picks.map((row) => row.id), ["remote-pick"]);
});

test("combina evidencias manuales y automaticas sin duplicar snapshots", () => {
  const rows = cloudSyncInternals.mergeEvidenceSnapshots(
    [{ id: "manual", capturedAt: "2026-07-12T16:00:00Z" }, { id: "same", capturedAt: "2026-07-12T15:00:00Z", source: "manual" }],
    [{ snapshot: { id: "auto", capturedAt: "2026-07-12T18:00:00Z" } }, { snapshot: { id: "same", capturedAt: "2026-07-12T17:00:00Z", source: "automatic" } }]
  );
  assert.deepEqual(rows.map((row) => row.id), ["auto", "same", "manual"]);
  assert.equal(rows.find((row) => row.id === "same").source, "automatic");
});
