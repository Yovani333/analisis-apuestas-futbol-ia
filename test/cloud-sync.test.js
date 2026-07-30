import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CloudSyncClient, compactCloudStateForSync, mergeCloudState, prepareEvidenceSyncBatches } from "../public/cloud-sync.js";
import { cloudSyncInternals } from "../server/services/cloud-sync.service.js";

const cloudSyncServiceSource = readFileSync(new URL("../server/services/cloud-sync.service.js", import.meta.url), "utf8");

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

test("un pick retirado del parlay no reaparece desde otro dispositivo", () => {
  const merged = mergeCloudState(
    { savedParlays: [{ id: "shared", updatedAt: "2026-07-23T12:00:00Z", legs: [{ id: "keep" }], removedLegs: [{ id: "removed", result: "won", removedFromParlayAt: "2026-07-23T12:00:00Z" }] }] },
    { saved_parlays: [{ id: "shared", updatedAt: "2026-07-23T11:00:00Z", legs: [{ id: "keep" }, { id: "removed", result: "won" }] }] }
  );
  assert.deepEqual(merged.savedParlays[0].legs.map((leg) => leg.id), ["keep"]);
  assert.deepEqual(merged.savedParlays[0].removedLegs.map((leg) => leg.id), ["removed"]);
});

test("un pick recuperado vuelve al parlay si la restauración es posterior", () => {
  const merged = mergeCloudState(
    { savedParlays: [{ id: "shared", updatedAt: "2026-07-23T12:05:00Z", legs: [{ id: "restored", restoredToParlayAt: "2026-07-23T12:05:00Z" }], removedLegs: [] }] },
    { saved_parlays: [{ id: "shared", updatedAt: "2026-07-23T12:00:00Z", legs: [], removedLegs: [{ id: "restored", removedFromParlayAt: "2026-07-23T12:00:00Z" }] }] }
  );
  assert.deepEqual(merged.savedParlays[0].legs.map((leg) => leg.id), ["restored"]);
  assert.deepEqual(merged.savedParlays[0].removedLegs, []);
});

test("sincroniza auditorias de evidencias sin perder resultados de otro dispositivo", () => {
  const merged = mergeCloudState(
    { preferences: { evidenceAudits: { "ev-local": { auditedAt: "2026-07-18T10:00:00Z", auditSummary: { completed: true } } } } },
    { preferences: { evidenceAudits: { "ev-remote": { auditedAt: "2026-07-18T11:00:00Z", auditSummary: { completed: true } } } } }
  );
  assert.deepEqual(Object.keys(merged.preferences.evidenceAudits).sort(), ["ev-local", "ev-remote"]);
});

test("una evidencia eliminada no reaparece desde otro dispositivo", () => {
  const validRemote = {
    version: 2,
    id: "ev-removed",
    capturedAt: "2026-07-18T10:00:00Z",
    fixture: { id: "81", home: "A", away: "B", status: "scheduled", utcDateTime: "2026-07-18T12:00:00Z" }
  };
  const merged = mergeCloudState(
    { preferences: { removedEvidenceIds: ["ev-removed"] }, evidenceSnapshots: [] },
    { preferences: { evidenceAudits: { "ev-removed": { auditedAt: "2026-07-19T10:00:00Z" } } }, evidence_snapshots: [validRemote] }
  );
  assert.deepEqual(merged.evidenceSnapshots, []);
  assert.deepEqual(merged.preferences.removedEvidenceIds, ["ev-removed"]);
  assert.equal(merged.preferences.evidenceAudits["ev-removed"], undefined);
});

test("sincronizacion descarta evidencia estructurada capturada despues del inicio", () => {
  const invalid = {
    version: 2,
    id: "ev-invalid",
    capturedAt: "2026-07-18T12:01:00Z",
    fixture: { id: "82", home: "A", away: "B", status: "scheduled", utcDateTime: "2026-07-18T12:00:00Z" }
  };
  const merged = mergeCloudState({ evidenceSnapshots: [invalid] }, {});
  assert.deepEqual(merged.evidenceSnapshots, []);
  assert.deepEqual(merged.preferences.removedEvidenceIds, ["ev-invalid"]);
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

test("el estado principal ya no transporta evidencias completas", () => {
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
  assert.deepEqual(state.evidenceSnapshots, []);
  assert.ok(JSON.stringify(state).length < 20_000);
});

test("la sincronizacion compacta picks y parlays sin perder campos operativos", () => {
  const heavy = "detalle ".repeat(3_000);
  const state = compactCloudStateForSync({
    savedPicks: [{
      id: "pick-heavy",
      fixtureId: 100,
      league: "MLS",
      home: "A",
      away: "B",
      market: "Total de goles",
      selection: "Más de 1.5",
      result: "won",
      sourceModule: "h2h",
      finalScore: "2-1",
      explanationLong: heavy,
      modules: { poisson: { scoreMatrix: Array(100).fill([1, 2, 3]) } },
      supportingData: Array.from({ length: 30 }, () => heavy)
    }],
    savedParlays: [{
      id: "parlay-heavy",
      name: "Parlay",
      legs: [{
        id: "leg-heavy",
        fixtureId: 101,
        market: "BTTS",
        selection: "Ambos equipos anotan: Sí",
        result: "pending",
        sourceModule: "xg_btts",
        rawOdds: { huge: heavy }
      }],
      removedLegs: [{ id: "removed", fixtureId: 102, result: "lost", removedFromParlayAt: "2026-07-20T10:00:00Z" }],
      analysisDetails: { huge: heavy }
    }]
  });
  assert.equal(state.savedPicks[0].id, "pick-heavy");
  assert.equal(state.savedPicks[0].fixtureId, 100);
  assert.equal(state.savedPicks[0].result, "won");
  assert.equal(state.savedPicks[0].sourceModule, "h2h");
  assert.equal(state.savedPicks[0].modules, undefined);
  assert.equal(state.savedPicks[0].explanationLong, undefined);
  assert.ok(state.savedPicks[0].supportingData.length <= 8);
  assert.equal(state.savedParlays[0].legs[0].rawOdds, undefined);
  assert.equal(state.savedParlays[0].removedLegs[0].removedFromParlayAt, "2026-07-20T10:00:00Z");
  assert.ok(Buffer.byteLength(JSON.stringify(state), "utf8") < 25_000);
});

test("compacta auditorias y uso dentro de preferencias sin perder conteos", () => {
  const heavyDimension = Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`market-${index}`, { hits: index, misses: index, rows: Array(100).fill("detalle largo") }]));
  const state = compactCloudStateForSync({
    preferences: {
      theme: "light",
      removedEvidenceIds: Array.from({ length: 600 }, (_, index) => `ev-${index}`),
      performancePreviousRanks: Object.fromEntries(Array.from({ length: 700 }, (_, index) => [`origin:${index}`, index])),
      evidenceAudits: {
        "ev-audited": {
          auditedAt: "2026-07-21T10:00:00Z",
          auditSummary: {
            completed: true,
            decisivePicks: 4,
            discardedPicks: 2,
            counterfactualAssessable: 1,
            finalScore: "2-1",
            metrics: { total: 9, hits: 3, misses: 1, ROI: 12.5, rawRows: Array(100).fill("x") },
            dimensions: { market: heavyDimension, origin: heavyDimension }
          }
        }
      }
    },
    analysisUsage: { date: "2026-07-21", count: 8, history: Array.from({ length: 100 }, (_, index) => ({ index, text: "uso largo".repeat(100) })) }
  });
  assert.equal(state.preferences.theme, "light");
  assert.equal(state.preferences.removedEvidenceIds.length, 500);
  assert.equal(Object.keys(state.preferences.performancePreviousRanks).length, 500);
  assert.equal(state.preferences.evidenceAudits["ev-audited"].auditSummary.completed, true);
  assert.equal(state.preferences.evidenceAudits["ev-audited"].auditSummary.decisivePicks, 4);
  assert.equal(state.preferences.evidenceAudits["ev-audited"].auditSummary.dimensions, undefined);
  assert.equal(state.preferences.evidenceAudits["ev-audited"].auditSummary.metrics.hits, 3);
  assert.equal(state.analysisUsage.date, "2026-07-21");
  assert.ok(Buffer.byteLength(JSON.stringify(state), "utf8") < 80_000);
});

test("sincronizacion individual prepara todas las evidencias sin limite de 25", () => {
  const rows = Array.from({ length: 81 }, (_, index) => ({
    id: `evidence-${index}`,
    capturedAt: new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString(),
    raw: { omitted: true }
  }));
  const batches = prepareEvidenceSyncBatches(rows, 10);
  assert.equal(batches.length, 9);
  assert.equal(batches.flat().length, 81);
  assert.equal(batches.flat().every((row) => row.compactedForCloud && row.raw === undefined), true);
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
  assert.deepEqual(normal.evidenceSnapshots, []);
  assert.deepEqual(aggressive.evidenceSnapshots, []);
  assert.ok(Buffer.byteLength(JSON.stringify(aggressive), "utf8") < 1_500_000);
});

test("la huella persistente evita reenviar evidencias iguales tras recargar", async () => {
  const storage = new Map();
  const fakeStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, value); },
    removeItem(key) { storage.delete(key); }
  };
  const client = new CloudSyncClient(fakeStorage);
  client.session = { accessToken: "token", refreshToken: "refresh", expiresAt: Math.floor(Date.now() / 1000) + 3600, user: { id: "user-1" } };
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, json: async () => ({ received: 1 }) };
  };
  try {
    const rows = [{ id: "ev-1", capturedAt: "2026-07-20T10:00:00Z", raw: { heavy: true } }];
    await client.saveEvidenceSnapshots(rows);
    const secondClient = new CloudSyncClient(fakeStorage);
    secondClient.session = client.session;
    const result = await secondClient.saveEvidenceSnapshots(rows);
    assert.equal(calls, 1);
    assert.equal(result.unchanged, true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("detecta schema faltante de sincronizacion con mensajes de Supabase", () => {
  assert.equal(cloudSyncInternals.isMissingCloudSchema(new Error("Could not find the table 'public.user_sync_state' in the schema cache")), true);
  assert.equal(cloudSyncInternals.isMissingCloudSchema(new Error("relation public.user_sync_state does not exist")), true);
});

test("detecta tablas opcionales de evidencia faltantes sin romper sincronizacion", () => {
  assert.equal(cloudSyncInternals.isMissingEvidenceSchema(new Error("Could not find the table 'public.evidence_watchlist' in the schema cache")), true);
  assert.equal(cloudSyncInternals.isMissingEvidenceSchema(new Error("relation public.automatic_evidence_snapshots does not exist")), true);
});

test("la vigilancia de evidencia actualiza horarios reprogramados sin reabrir capturadas", () => {
  assert.match(cloudSyncServiceSource, /select=fixture_id,fixture_date,capture_due_at/);
  assert.match(cloudSyncServiceSource, /changedScheduledFixtures/);
  assert.match(cloudSyncServiceSource, /status=eq\.scheduled/);
  assert.match(cloudSyncServiceSource, /capture_due_at: fixture\.capture_due_at/);
  assert.match(cloudSyncServiceSource, /refreshed: changedScheduledFixtures\.length/);
});

test("detecta RPC faltante o falla de timestamp para usar respaldo seguro", () => {
  assert.equal(cloudSyncInternals.isMissingRpc(new Error("Could not find the function public.merge_user_sync_state_v2"), "merge_user_sync_state_v2"), true);
  assert.equal(cloudSyncInternals.isRpcExecutionFailure(new Error('invalid input syntax for type timestamp with time zone: ""')), true);
});

test("la respuesta compacta del estado no transporta evidencias completas", () => {
  const response = cloudSyncInternals.compactCloudStateResponse(
    {
      preferences: {
        theme: "dark",
        evidenceAudits: {
          "ev-audited": {
            auditedAt: "2026-07-21T10:00:00Z",
            auditSummary: { completed: true, decisivePicks: 3, dimensions: { market: { huge: Array(100).fill("x") } } }
          }
        }
      },
      saved_picks: [{ id: "pick-1", fixtureId: 1, market: "Total", selection: "Más de 1.5", result: "won", raw: { large: true } }],
      saved_parlays: [{ id: "parlay-1", name: "Parlay", legs: [{ id: "leg-1", fixtureId: 2, result: "pending", snapshot: { large: true } }] }],
      evidence_snapshots: [{ id: "ev-heavy", modules: { raw: "large" } }]
    },
    { automaticAvailable: 81, latestAutomaticCapturedAt: "2026-07-20T10:00:00Z" }
  );
  assert.deepEqual(response.evidence_snapshots, []);
  assert.equal(response.saved_picks.length, 1);
  assert.equal(response.saved_picks[0].raw, undefined);
  assert.equal(response.saved_parlays[0].legs[0].snapshot, undefined);
  assert.equal(response.preferences.evidenceAudits["ev-audited"].auditSummary.dimensions, undefined);
  assert.equal(response.preferences.evidenceAudits["ev-audited"].auditSummary.decisivePicks, 3);
  assert.equal(response.evidence_sync_summary.compacted, true);
  assert.equal(response.evidence_sync_summary.automaticAvailable, 81);
  assert.equal(response.evidence_sync_summary.latestAutomaticCapturedAt, "2026-07-20T10:00:00Z");
});

test("el estado compacto consulta solo conteo liviano de evidencias automaticas", () => {
  assert.match(cloudSyncServiceSource, /method: "HEAD"/);
  assert.match(cloudSyncServiceSource, /Prefer: "count=exact"/);
  assert.match(cloudSyncServiceSource, /automatic_evidence_snapshots\?select=fixture_id/);
  assert.match(cloudSyncServiceSource, /limit=1/);
});

test("el respaldo del servidor combina filas existentes y entrantes sin borrar", () => {
  const merged = cloudSyncInternals.mergeNormalizedState(
    { saved_parlays: [{ id: "remote" }, { id: "same", notes: "old" }], saved_picks: [{ id: "remote-pick" }] },
    { saved_parlays: [{ id: "local" }, { id: "same", notes: "new" }], saved_picks: [] }
  );
  assert.deepEqual(merged.saved_parlays.map((row) => row.id), ["remote", "same", "local"]);
  assert.equal(merged.saved_parlays.find((row) => row.id === "same").notes, "new");
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

test("la biblioteca en linea conserva mas de cincuenta evidencias unicas", () => {
  const automatic = Array.from({ length: 81 }, (_, index) => ({
    snapshot: { id: `ev-${index}`, capturedAt: new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString() }
  }));
  const rows = cloudSyncInternals.mergeEvidenceSnapshots([], automatic);
  assert.equal(rows.length, 81);
});

test("el cliente recupera evidencias de la biblioteca en linea por paginas", async () => {
  const storage = new Map();
  const fakeStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, value); },
    removeItem(key) { storage.delete(key); }
  };
  const client = new CloudSyncClient(fakeStorage);
  client.session = { accessToken: "token", refreshToken: "refresh", expiresAt: Math.floor(Date.now() / 1000) + 3600, user: { id: "user-1" } };
  const previousFetch = globalThis.fetch;
  const makeSnapshot = (index) => ({
    version: 3,
    id: `remote-ev-${index}`,
    capturedAt: new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString(),
    fixture: {
      id: String(10_000 + index),
      home: `Local ${index}`,
      away: `Visitante ${index}`,
      status: "scheduled",
      utcDateTime: new Date(Date.UTC(2026, 6, 1, 2, index)).toISOString(),
      leagueName: index % 2 ? "MLS" : "Clasificacion Conference League",
      leagueId: index % 2 ? 253 : 848
    }
  });
  const pages = [
    Array.from({ length: 200 }, (_, index) => makeSnapshot(index)),
    Array.from({ length: 30 }, (_, index) => makeSnapshot(index + 200))
  ];
  const requestedOffsets = [];
  globalThis.fetch = async (url) => {
    requestedOffsets.push(Number(new URL(url, "https://local.test").searchParams.get("offset") || 0));
    const pageIndex = requestedOffsets.length - 1;
    return {
      ok: true,
      json: async () => ({
        snapshots: pages[pageIndex] || [],
        nextOffset: pageIndex === 0 ? 200 : null
      })
    };
  };
  try {
    const result = await client.loadEvidenceSnapshots({ limit: 200, max: 500 });
    assert.equal(result.snapshots.length, 230);
    assert.deepEqual(requestedOffsets, [0, 200]);
    assert.equal(result.snapshots[0].fixture.leagueName, "Clasificacion Conference League");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("la ruta autenticada de biblioteca de evidencias esta registrada", () => {
  const routesSource = readFileSync(new URL("../server/routes/api.routes.js", import.meta.url), "utf8");
  assert.match(routesSource, /apiRouter\.get\("\/cloud\/evidence\/snapshots"/);
  assert.match(routesSource, /listCloudEvidenceSnapshots/);
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
