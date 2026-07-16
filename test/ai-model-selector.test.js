import test from "node:test";
import assert from "node:assert/strict";
import { requireLiveConfiguration } from "../server/config/env.js";
import { generateRuleBasedAnalysis } from "../server/services/rule-analysis.service.js";

function dataset() {
  return {
    fixture: { id: "100", home: "Local", away: "Visitante", leagueName: "Liga", country: "MX", status: "scheduled", favorite: { probabilities: { home: 45, draw: 30, away: 25 } } },
    researchData: {
      totalConfidenceScore: 70,
      analysisStatus: "complete",
      moduleScores: {},
      criticalMissingData: [],
      missingData: [],
      homeTeam: { name: "Local" },
      awayTeam: { name: "Visitante" },
      statsForm: { homeGoalsFor: 7, awayGoalsFor: 5, homeGoalsAgainst: 4, awayGoalsAgainst: 6 },
      xgXga: { status: "not_available", type: "not_available" },
      odds: { markets: [] }
    },
    dataQuality: { score: 70, canSuggest: true },
    preMatch: { home: { team: "Local" }, away: { team: "Visitante" } },
    marketAnalysis: [],
    pickRecommendation: { reviewedPicks: [], recommendedPick: null, warning: "Sin pick principal" },
    qualityAlerts: []
  };
}

test("la configuración live ya no requiere credenciales OpenAI", () => {
  const missing = requireLiveConfiguration();
  assert.equal(missing.includes("OPENAI_API_KEY"), false);
  assert.equal(missing.includes("OPENAI_MODEL_DEFAULT"), false);
  assert.equal(missing.includes("OPENAI_MODEL_PREMIUM"), false);
});

test("el motor de reglas genera análisis sin proveedor OpenAI", () => {
  const analysis = generateRuleBasedAnalysis(dataset());
  assert.equal(analysis.analysisMode, "rule_engine");
  assert.equal(analysis.generatedBy, "internal-rule-engine");
  assert.match(analysis.resumen_partido, /Motor de Reglas/);
});
