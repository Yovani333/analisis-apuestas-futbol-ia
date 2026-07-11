import test from "node:test";
import assert from "node:assert/strict";
import {
  apiDelta,
  createSimulationAuditRecord,
  listSimulationAuditRecords,
  resetSimulationAuditStore,
  saveSimulationAuditRecord
} from "../server/services/simulation-audit-store.service.js";

test("calcula consumo incremental de API para una simulacion", () => {
  const delta = apiDelta(
    { networkRequests: 10, cacheHits: 4, cacheMisses: 6, pendingHits: 1, failures: 0 },
    { networkRequests: 13, cacheHits: 9, cacheMisses: 7, pendingHits: 2, failures: 1, lastEndpoint: "/fixtures" }
  );
  assert.equal(delta.networkRequests, 3);
  assert.equal(delta.cacheHits, 5);
  assert.equal(delta.cacheMisses, 1);
  assert.equal(delta.pendingHits, 1);
  assert.equal(delta.failures, 1);
  assert.equal(delta.lastEndpoint, "/fixtures");
});

test("guarda historial auditable de simulaciones sin recalcular modelos", () => {
  resetSimulationAuditStore();
  const record = createSimulationAuditRecord({
    status: "available",
    source: "API-Football + cache interna + modelos internos",
    comparison: {
      competition: "Mundial",
      windowSize: 5,
      source: "API-Football + cache interna",
      teamA: { name: "Equipo A", matchesWithStatistics: 5, fixturesUsed: [{ fixtureId: 1 }] },
      teamB: { name: "Equipo B", matchesWithStatistics: 5, fixturesUsed: [{ fixtureId: 2 }] }
    },
    audit: {
      fixtureId: 999,
      versions: { elo: "elo-rule-based-v1", dixonColes: "dixon-coles-provisional-v1" },
      dataMissing: ["Alineaciones confirmadas"]
    },
    finalProbabilities: { homeWin: 48, draw: 27, awayWin: 25 },
    marketComparison: [{ selection: "Equipo A gana", expectedValuePct: 5 }],
    summary: { decision: "apuesta_con_valor_pero_riesgo_alto", pick: "Equipo A gana" },
    warnings: ["Regresion ordinal no entrenada"]
  }, {
    fixtureId: 999,
    fixtureDate: "2026-07-10T18:00:00Z"
  }, {
    before: { networkRequests: 2, cacheHits: 1, cacheMisses: 1 },
    after: { networkRequests: 4, cacheHits: 3, cacheMisses: 2 }
  });
  saveSimulationAuditRecord(record);
  const rows = listSimulationAuditRecords({ fixtureId: 999 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fixtureId, "999");
  assert.equal(rows[0].modelVersions.elo, "elo-rule-based-v1");
  assert.equal(rows[0].dataUsed.matchesUsedHome, 5);
  assert.equal(rows[0].apiConsumption.networkRequests, 2);
  assert.equal(rows[0].decision.pick, "Equipo A gana");
});
