import assert from "node:assert/strict";
import test from "node:test";
import { clearBestBetsReports, latestBestBetsReport, saveBestBetsReport } from "../server/services/best-bets-store.service.js";

test("guardar dos veces el mismo resultado no duplica el reporte", () => {
  clearBestBetsReports();
  const base = {
    generatedAt: "2026-08-05T12:00:00.000Z", configVersion: "v1",
    candidates: [{ id: "fixture:market:pick", odds: 2, modelProbabilityPct: 60, dataQualityScore: 80, classification: "APTO" }]
  };
  const first = saveBestBetsReport(base);
  const second = saveBestBetsReport({ ...base, generatedAt: "2026-08-05T12:01:00.000Z" });
  assert.equal(second.id, first.id);
  assert.equal(second.fingerprint, first.fingerprint);
  assert.equal(latestBestBetsReport().generatedAt, "2026-08-05T12:01:00.000Z");
});
