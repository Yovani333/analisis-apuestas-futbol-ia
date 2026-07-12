import test from "node:test";
import assert from "node:assert/strict";
import { buildPickAnalysisCollection } from "../server/services/pick-analysis-collection.service.js";

const basePick = {
  marketKey: "match_winner", selectionKey: "home_win", market: "Resultado 1X2", selection: "Local gana",
  decimalOdds: 2, modelProbabilityPct: 55, expectedValuePct: 10, confidenceScore: 70,
  decision: "PRECAUCIÓN", highlightColor: "orange", canAdd: true, supportingData: ["Forma reciente"]
};

test("fusiona la misma selección y conserva consenso independiente", () => {
  const dataset = {
    source: "api-football", fixture: { id: "9", home: "Local", away: "Visitante", leagueName: "Liga", date: "2026-07-12" },
    dataQuality: { score: 70 }, marketAnalysis: [basePick], cacheInfo: { status: "hit" }
  };
  const results = {
    dataPicks: { status: "partial", picks: [basePick] },
    outcome: { status: "available", resultMostLikely: "Local gana", confidenceLabel: "Media", scenarios: [{ label: "Local gana", probabilityPct: 55 }] },
    poisson: { status: "available", source: "Poisson", quality: { label: "Media" }, suggestedMarkets: [{ ...basePick, modelProbabilityPct: 75, confidenceScore: 76, highlightColor: "green" }] },
    teamGoals: { status: "partial", source: "Ataque", quality: { label: "Parcial" }, picks: [] },
    corners: { status: "not_available", picks: [] },
    teamPerformance: { status: "available", k: 5, picks: { home: [], away: [] } },
    playerGoals: { status: "insufficient_data", candidates: [], playersEvaluated: 5 },
    specificMarkets: { status: "partial", groups: [] }
  };
  const snapshot = buildPickAnalysisCollection(dataset, results, { networkRequests: 1, cacheHits: 4 });
  assert.equal(snapshot.candidateMarkets.length, 1);
  assert.equal(snapshot.candidateMarkets[0].backingModels.length, 2);
  assert.equal(snapshot.consensus[0].status, "contradictory");
  assert.ok(snapshot.contradictions.some((message) => /20 puntos/.test(message)));
  assert.equal(snapshot.summary.apiRequests, 1);
  assert.equal(snapshot.summary.cacheUsed, true);
  assert.equal(snapshot.candidateMarkets[0].canAdd, false);
});

test("Catálogo no cuenta como respaldo independiente si reutiliza Poisson", () => {
  const poissonPick = { ...basePick, modelProbabilityPct: 60, confidenceScore: 70, highlightColor: "green", sourceModule: "poisson" };
  const dataset = { fixture: { id: "10", home: "A", away: "B", leagueName: "Liga" }, dataQuality: { score: 70 }, marketAnalysis: [] };
  const results = {
    dataPicks: { picks: [] }, outcome: {}, poisson: { status: "available", suggestedMarkets: [poissonPick] },
    teamGoals: { picks: [] }, corners: { picks: [] }, teamPerformance: { picks: { home: [], away: [] } }, playerGoals: { candidates: [] },
    specificMarkets: { groups: [{ label: "Conservadores", picks: [poissonPick] }] }
  };
  const snapshot = buildPickAnalysisCollection(dataset, results);
  assert.equal(snapshot.candidateMarkets[0].independentFamilies.length, 1);
  assert.equal(snapshot.consensus[0].status, "single_source");
  assert.equal(snapshot.candidateMarkets[0].canAdd, false);
});
