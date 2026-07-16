import test from "node:test";
import assert from "node:assert/strict";
import { AnalysisSchema } from "../server/schemas/analysis.schema.js";
import { generateRuleBasedAnalysis } from "../server/services/rule-analysis.service.js";

function dataset() {
  const calculation = {
    marketKey: "over_under_2_5", selectionKey: "over_2_5", market: "Total de goles 2.5",
    selection: "Más de 2.5 goles", decimalOdds: 1.9, impliedProbabilityPct: 52.6,
    estimatedProbabilityPct: 61, expectedValuePct: 15.9, positiveValue: true,
    requiresReview: false, sampleSize: 10
  };
  const reviewed = {
    ...calculation, valueScore: 74, confidenceScore: 82, safetyScore: 76, riskScore: 10,
    finalPickScore: 78, riskFlags: [], pickCategory: "pick_fuerte", highlightColor: "green",
    confidenceLevel: "Alta", explanation: "El volumen ofensivo reciente respalda el mercado.", confirmations: []
  };
  return {
    fixture: {
      id: "100", home: "Equipo A", away: "Equipo B", date: "2026-06-30", stadium: "Estadio",
      country: "Mundial", leagueName: "Copa Mundial FIFA", neutralVenue: true,
      favorite: { probabilities: { home: 45, draw: 28, away: 27 } }
    },
    dataQuality: { score: 84, level: "Alta", canSuggest: true },
    qualityAlerts: [], marketAnalysis: [calculation],
    pickRecommendation: {
      matchProfile: "favorite_open", recommendedPick: reviewed, reviewedPicks: [reviewed],
      warning: "Sin contradicciones fuertes."
    },
    preMatch: {},
    researchData: {
      analysisStatus: "complete", totalConfidenceScore: 84, missingData: [], criticalMissingData: [],
      moduleScores: { statsForm: { status: "available" }, odds: { status: "available" } },
      homeTeam: { name: "Equipo A" }, awayTeam: { name: "Equipo B" },
      statsForm: { status: "available", homeWinRate: 60, awayWinRate: 40, homeGoalsFor: 8, awayGoalsFor: 6, homeGoalsAgainst: 4, awayGoalsAgainst: 7, homeCleanSheets: 2, awayCleanSheets: 1 },
      xgXga: { status: "partial", type: "historical_estimated", homeXG: 1.7, homeXGA: 1.0, awayXG: 1.3, awayXGA: 1.5, confidenceLabel: "medium" },
      injuriesSuspensions: { status: "partial" }, lineups: { status: "partial", confirmed: false },
      contextCalendar: { homeRestDays: 5, awayRestDays: 4 }, odds: { markets: [calculation] }
    }
  };
}

test("Motor de Reglas genera análisis y picks sin proveedor externo", () => {
  const result = generateRuleBasedAnalysis(dataset());
  assert.equal(result.analysisMode, "rule_engine");
  assert.equal(result.generatedBy, "internal-rule-engine");
  assert.equal(result.mercados_sugeridos[0].codigo_seleccion, "over_2_5");
  assert.match(result.mercados_sugeridos[0].razonamiento, /xG estimado 1\.7-1\.3/i);
  assert.equal(result.mercados_sugeridos[0].sourceModule, "odds_rule_engine");
  assert.equal(AnalysisSchema.safeParse(result).success, true);
});

test("Motor de Reglas no promueve mercados cuando la cobertura bloquea picks", () => {
  const input = dataset();
  input.researchData.analysisStatus = "needs_review";
  input.dataQuality.canSuggest = false;
  const result = generateRuleBasedAnalysis(input);
  assert.deepEqual(result.mercados_sugeridos, []);
  assert.equal(result.apto_para_parlay.respuesta, "No");
});
