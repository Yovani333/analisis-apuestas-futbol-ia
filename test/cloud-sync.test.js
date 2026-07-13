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
