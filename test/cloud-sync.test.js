import test from "node:test";
import assert from "node:assert/strict";
import { compactCloudStateForSync, mergeCloudState } from "../public/cloud-sync.js";
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

test("sincroniza auditorias de evidencias sin perder resultados de otro dispositivo", () => {
  const merged = mergeCloudState(
    { preferences: { evidenceAudits: { "ev-local": { auditedAt: "2026-07-18T10:00:00Z", auditSummary: { completed: true } } } } },
    { preferences: { evidenceAudits: { "ev-remote": { auditedAt: "2026-07-18T11:00:00Z", auditSummary: { completed: true } } } } }
  );
  assert.deepEqual(Object.keys(merged.preferences.evidenceAudits).sort(), ["ev-local", "ev-remote"]);
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

test("compacta evidencias grandes antes de sincronizar sin tocar picks ni parlays", () => {
  const heavyText = "dato ".repeat(10_000);
  const state = compactCloudStateForSync({
    savedPicks: [{ id: "pick-1" }],
    savedParlays: [{ id: "parlay-1" }],
    evidenceSnapshots: Array.from({ length: 30 }, (_, index) => ({
      id: `ev-${index}`,
      capturedAt: `2026-07-${String(index + 1).padStart(2, "0")}T10:00:00Z`,
      text: heavyText,
      raw: { very: "large" },
      picks: Array.from({ length: 100 }, (__, id) => ({ id }))
    }))
  });
  assert.equal(state.savedPicks.length, 1);
  assert.equal(state.savedParlays.length, 1);
  assert.equal(state.evidenceSnapshots.length, 25);
  assert.equal(state.evidenceSnapshots[0].raw, undefined);
  assert.equal(state.evidenceSnapshots[0].picks.length, 80);
  assert.equal(state.evidenceSnapshots[0].compactedForCloud, true);
  assert.ok(JSON.stringify(state).length < 900_000);
});

test("elimina bloques analiticos pesados y ofrece una segunda compactacion", () => {
  const oversizedBlock = Array.from({ length: 2_000 }, (_, index) => ({
    index,
    explanation: "detalle ".repeat(100),
    scoreMatrix: Array.from({ length: 100 }, () => Array(100).fill(0.01))
  }));
  const input = {
    savedPicks: [{ id: "pick-1", explanation: "razon ".repeat(2_000) }],
    evidenceSnapshots: Array.from({ length: 30 }, (_, index) => ({
      id: `ev-heavy-${index}`,
      capturedAt: `2026-07-${String(index + 1).padStart(2, "0")}T10:00:00Z`,
      preMatch: { oversizedBlock },
      marketAnalysis: oversizedBlock,
      researchData: { updatedAt: "2026-07-17T10:00:00Z", sourceCoverage: [{ module: "Cuotas", status: "available" }], oversizedBlock },
      modules: { poisson: { scoreMatrix: oversizedBlock, probabilities: { home: 45 } } }
    }))
  };
  const normal = compactCloudStateForSync(input);
  const aggressive = compactCloudStateForSync(input, { aggressive: true });
  assert.equal(normal.evidenceSnapshots.length, 25);
  assert.equal(aggressive.evidenceSnapshots.length, 10);
  assert.equal(normal.evidenceSnapshots[0].preMatch, undefined);
  assert.equal(normal.evidenceSnapshots[0].marketAnalysis, undefined);
  assert.equal(normal.evidenceSnapshots[0].researchData.oversizedBlock, undefined);
  assert.equal(normal.evidenceSnapshots[0].modules.poisson.scoreMatrix, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(aggressive), "utf8") < 1_500_000);
});

test("detecta schema faltante de sincronizacion con mensajes de Supabase", () => {
  assert.equal(cloudSyncInternals.isMissingCloudSchema(new Error("Could not find the table 'public.user_sync_state' in the schema cache")), true);
  assert.equal(cloudSyncInternals.isMissingCloudSchema(new Error("relation public.user_sync_state does not exist")), true);
});

test("detecta tablas opcionales de evidencia faltantes sin romper sincronizacion", () => {
  assert.equal(cloudSyncInternals.isMissingEvidenceSchema(new Error("Could not find the table 'public.evidence_watchlist' in the schema cache")), true);
  assert.equal(cloudSyncInternals.isMissingEvidenceSchema(new Error("relation public.automatic_evidence_snapshots does not exist")), true);
});

test("detecta RPC faltante o falla de timestamp para usar respaldo seguro", () => {
  assert.equal(cloudSyncInternals.isMissingRpc(new Error("Could not find the function public.merge_user_sync_state_v2"), "merge_user_sync_state_v2"), true);
  assert.equal(cloudSyncInternals.isRpcExecutionFailure(new Error('invalid input syntax for type timestamp with time zone: ""')), true);
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

test("la revision mas reciente del cupon permite borrar picks antiguos", () => {
  const merged = mergeCloudState(
    { preferences: { parlayDraftUpdatedAt: "2026-07-13T12:00:00Z" }, parlayDraft: [] },
    { preferences: { parlayDraftUpdatedAt: "2026-07-13T10:00:00Z" }, parlay_draft: [{ id: "deleted-pick" }] }
  );
  assert.deepEqual(merged.parlayDraft, []);
});

test("el cupon remoto gana cuando su revision es mas reciente", () => {
  const merged = mergeCloudState(
    { preferences: { parlayDraftUpdatedAt: "2026-07-13T10:00:00Z" }, parlayDraft: [{ id: "old-local" }] },
    { preferences: { parlayDraftUpdatedAt: "2026-07-13T12:00:00Z" }, parlay_draft: [{ id: "new-remote" }] }
  );
  assert.deepEqual(merged.parlayDraft.map((row) => row.id), ["new-remote"]);
});

test("la preferencia manual de tema mas reciente no es revertida por la nube", () => {
  const merged = mergeCloudState(
    { preferences: { theme: "light", themeUpdatedAt: "2026-07-13T12:00:00Z" } },
    { preferences: { theme: "dark", themeUpdatedAt: "2026-07-13T10:00:00Z" } }
  );
  assert.equal(merged.preferences.theme, "light");
});

test("sin marcas temporales se usa el tema guardado en la cuenta", () => {
  const merged = mergeCloudState({ preferences: { theme: "dark" } }, { preferences: { theme: "light" } });
  assert.equal(merged.preferences.theme, "light");
});

test("sincroniza altas y bajas de equipos favoritos por la revision mas reciente", () => {
  const merged = mergeCloudState(
    { preferences: { favoriteTeams: [{ id: "10", name: "Local", active: true, updatedAt: "2026-07-18T10:00:00Z" }] } },
    { preferences: { favoriteTeams: [{ id: "10", name: "Local", active: false, updatedAt: "2026-07-18T11:00:00Z" }, { id: "20", name: "Visitante", active: true, updatedAt: "2026-07-18T10:30:00Z" }] } }
  );
  assert.equal(merged.preferences.favoriteTeams.find((team) => team.id === "10").active, false);
  assert.equal(merged.preferences.favoriteTeams.find((team) => team.id === "20").active, true);
});
