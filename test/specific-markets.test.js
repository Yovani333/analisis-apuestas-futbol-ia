import test from "node:test";
import assert from "node:assert/strict";
import { buildSpecificMarkets } from "../server/services/specific-markets.service.js";

function dataset(overrides = {}) {
  const btts = { marketKey: "btts", selectionKey: "btts_yes", market: "Ambos anotan", selection: "Sí", decimalOdds: 1.9, impliedProbabilityPct: 52.6, modelProbabilityPct: 61, expectedValuePct: 15.9, confidenceScore: 72, highlightColor: "green", decision: "VALOR", sourceModule: "data_picks" };
  return {
    fixture: { id: 91, home: "A", away: "B", status: "scheduled" },
    dataQuality: { score: 78 }, marketAnalysis: [btts],
    researchData: { totalConfidenceScore: 78, odds: { markets: [btts] }, xgXga: {}, statsForm: {} },
    poissonModel: { status: "available", suggestedMarkets: [btts], probabilities: {}, warnings: [] },
    teamGoalProbability: { status: "available", picks: [btts], teams: {}, btts: {}, warnings: [] },
    cornersModel: { status: "not_available", picks: [], warning: "Sin muestra" },
    ...overrides
  };
}

test("habilita BTTS únicamente con cuota, probabilidad y confianza suficientes", () => {
  const result = buildSpecificMarkets(dataset());
  const btts = result.groups.find((group) => group.key === "btts");
  assert.equal(btts.status, "available");
  assert.equal(btts.picks[0].selectionKey, "btts_yes");
});

test("no inventa hándicap asiático ni goleador cuando faltan datos críticos", () => {
  const result = buildSpecificMarkets(dataset());
  const handicap = result.groups.find((group) => group.key === "asian_handicap");
  const player = result.groups.find((group) => group.key === "player_goal");
  assert.notEqual(handicap.status, "available");
  assert.notEqual(player.status, "available");
  assert.ok(handicap.missingData.includes("Línea de hándicap asiático verificable"));
  assert.ok(player.missingData.includes("Cobertura individual de API-Football"));
});

test("conecta candidatos reales de jugador con Mercados ofensivos sin duplicar lógica", () => {
  const candidate = { marketKey: "anytime_goalscorer", selectionKey: "player_goal_9", market: "Jugador anota en cualquier momento", selection: "Delantero A anota", confidenceScore: 76, highlightColor: "green", sourceModule: "player_goal_candidate", explanation: "Minutos y tiros suficientes." };
  const result = buildSpecificMarkets(dataset({ playerGoalCandidates: { status: "available", candidates: [candidate] } }));
  const player = result.groups.find((group) => group.key === "player_goal");
  assert.equal(player.status, "available");
  assert.equal(player.picks[0].sourceModule, "player_goal_candidate");
});

test("corners queda parcial si existe modelo pero falta cuota compatible", () => {
  const result = buildSpecificMarkets(dataset({ cornersModel: { status: "partial", totalExpectedCorners: 9.4, picks: [] } }));
  const corners = result.groups.find((group) => group.key === "corners");
  assert.equal(corners.status, "partial");
  assert.match(corners.alternativeData, /9.4/);
});
